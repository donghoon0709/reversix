import json, sys, numpy as np, torch, rx, net as netmod
rx.configure(10, 6)
ck = torch.load(sys.argv[1], map_location="cpu"); a = ck["args"]
m = netmod.Net(planes=rx.PLANES, ch=a["ch"], blocks=a["blocks"]); m.load_state_dict(ck["net"]); m.eval()
g = rx.Game(); rng = np.random.default_rng(0)
for _ in range(9):
    if g.terminal: break
    mask, n = g.legal(1)
    g.step(int(rng.choice(np.nonzero(mask)[0])))
x = g.encode(1)[None]
with torch.no_grad():
    p, v = m(torch.from_numpy(x))
json.dump({"input": x.ravel().tolist(), "policy": p[0].tolist(), "value": float(v[0])},
          open(sys.argv[2], "w"))
print(f"test vector: policy[0:5]={[round(t,3) for t in p[0][:5].tolist()]} value={float(v[0]):.4f}")
