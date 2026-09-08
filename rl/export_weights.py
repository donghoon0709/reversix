"""Export a checkpoint for browser inference.

BatchNorm is folded into the preceding convolution so the JS side only needs
conv + relu + residual adds. Emits a flat float32 blob plus a JSON manifest.
"""
import json, sys, struct
import numpy as np, torch
import rx, net as netmod

ck_path, out_bin, out_json = sys.argv[1], sys.argv[2], sys.argv[3]
rx.configure(10, 6)
ck = torch.load(ck_path, map_location="cpu")
a = ck["args"]
model = netmod.Net(planes=rx.PLANES, ch=a["ch"], blocks=a["blocks"])
model.load_state_dict(ck["net"]); model.eval()
sd = model.state_dict()

blobs, manifest = [], {"board": a["n"], "k": a["k"], "planes": rx.PLANES,
                       "ch": a["ch"], "blocks": a["blocks"], "iter": ck["iter"],
                       "tensors": []}

def add(name, arr):
    arr = np.ascontiguousarray(arr.astype(np.float32))
    manifest["tensors"].append({"name": name, "shape": list(arr.shape)})
    blobs.append(arr.ravel())

def fold(conv_w, bn_prefix):
    """conv (no bias) + BN  ->  (W', b')"""
    g = sd[bn_prefix + ".weight"].numpy()
    b = sd[bn_prefix + ".bias"].numpy()
    mu = sd[bn_prefix + ".running_mean"].numpy()
    var = sd[bn_prefix + ".running_var"].numpy()
    eps = 1e-5
    s = g / np.sqrt(var + eps)
    W = conv_w.numpy() * s[:, None, None, None]
    bias = b - mu * s
    return W, bias

W, b = fold(sd["stem.0.weight"], "stem.1"); add("stem.w", W); add("stem.b", b)
for i in range(a["blocks"]):
    W, b = fold(sd[f"body.{i}.c1.weight"], f"body.{i}.b1"); add(f"blk{i}.c1.w", W); add(f"blk{i}.c1.b", b)
    W, b = fold(sd[f"body.{i}.c2.weight"], f"body.{i}.b2"); add(f"blk{i}.c2.w", W); add(f"blk{i}.c2.b", b)
W, b = fold(sd["ph.0.weight"], "ph.1"); add("ph0.w", W); add("ph0.b", b)
add("ph3.w", sd["ph.3.weight"].numpy()); add("ph3.b", sd["ph.3.bias"].numpy())
W, b = fold(sd["vh.0.weight"], "vh.1"); add("vh0.w", W); add("vh0.b", b)
add("vf0.w", sd["vf.0.weight"].numpy()); add("vf0.b", sd["vf.0.bias"].numpy())
add("vf2.w", sd["vf.2.weight"].numpy()); add("vf2.b", sd["vf.2.bias"].numpy())

flat = np.concatenate(blobs)
flat.tofile(out_bin)
manifest["total_floats"] = int(flat.size)
json.dump(manifest, open(out_json, "w"))
print(f"exported iter={ck['iter']} ch={a['ch']} blocks={a['blocks']}  "
      f"{flat.size} floats = {flat.nbytes/1e6:.2f} MB -> {out_bin}")

# numerical check: folded forward must match the torch model
x = torch.randn(2, rx.PLANES, a["n"], a["n"])
with torch.no_grad():
    p_ref, v_ref = model(x)
print(f"reference logits range [{p_ref.min():.3f}, {p_ref.max():.3f}]  value {v_ref.tolist()}")
np.save(out_bin + ".testin.npy", x.numpy())
np.save(out_bin + ".testout.npy", np.concatenate([p_ref.numpy(), v_ref.numpy()[:, None]], axis=1))
