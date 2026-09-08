"""Diagnose the value head: does it vary at all, and is it accurate late in the game?"""
import sys, numpy as np, torch, rx, net as netmod

rx.configure(10, 6)
dev = torch.device("cpu")           # keep MPS free for the running trainer
torch.set_num_threads(2)
ck = torch.load(sys.argv[1] if len(sys.argv) > 1 else "runs/r1/latest.pt", map_location="cpu")
a = ck["args"]
net = netmod.Net(planes=rx.PLANES, ch=a["ch"], blocks=a["blocks"]).to(dev)
net.load_state_dict(ck["net"]); net.eval()
print(f"checkpoint iter={ck['iter']}  ch={a['ch']} blocks={a['blocks']}")

rng = np.random.default_rng(0)
GAMES = int(sys.argv[2]) if len(sys.argv) > 2 else 120

@torch.no_grad()
def policy_value(games):
    x = np.stack([g.encode(1) for g in games])
    p, v = net(torch.from_numpy(x))
    return p.numpy(), v.numpy()

# play on-policy (raw net, no search) and record every position with its ply index
recs = []
batch = 48
while len(recs) < GAMES * 20:
    live = [{"g": rx.Game(), "h": []} for _ in range(batch)]
    done = 0
    while live:
        p, v = policy_value([s["g"] for s in live])
        nxt = []
        for s, logits in zip(live, p):
            g = s["g"]
            mask, _ = g.legal(1)
            idx = np.nonzero(mask)[0]
            lg = logits[idx]; lg = lg - lg.max()
            pr = np.exp(lg); pr /= pr.sum()
            s["h"].append((g.encode(1), g.player))
            g.step(int(rng.choice(idx, p=pr)))
            if g.terminal:
                w = g.winner
                n = len(s["h"])
                for i, (enc, pl) in enumerate(s["h"]):
                    z = 0.0 if w == 0 else (1.0 if w == pl else -1.0)
                    recs.append((enc, z, i / max(n - 1, 1)))
                done += 1
            else:
                nxt.append(s)
        live = nxt
    if done == 0: break

X = np.stack([r[0] for r in recs]); Z = np.array([r[1] for r in recs], np.float32)
F = np.array([r[2] for r in recs], np.float32)
with torch.no_grad():
    V = np.concatenate([net(torch.from_numpy(X[i:i+512]))[1].numpy() for i in range(0, len(X), 512)])

print(f"\npositions={len(V)}   predicted value: mean={V.mean():+.4f}  std={V.std():.4f}  "
      f"min={V.min():+.3f}  max={V.max():+.3f}")
if V.std() < 0.02:
    print("  >>> COLLAPSED: the head emits a near-constant value <<<")
print(f"outcome targets: mean={Z.mean():+.4f}  (draws={np.mean(Z==0)*100:.1f}%)")
print(f"\noverall  MSE={np.mean((V-Z)**2):.4f}   (predicting 0 everywhere = {np.mean(Z**2):.4f})")
print(f"         sign accuracy={np.mean(np.sign(V)==np.sign(Z))*100:.1f}%   corr={np.corrcoef(V,Z)[0,1]:.3f}")
print(f"\n{'game phase':>14s} {'n':>7s} {'MSE':>8s} {'MSE(v=0)':>9s} {'sign acc':>9s} {'corr':>7s} {'mean|v|':>8s}")
edges = [0,.2,.4,.6,.8,1.01]
for lo, hi in zip(edges[:-1], edges[1:]):
    m = (F >= lo) & (F < hi)
    if m.sum() < 20: continue
    v, z = V[m], Z[m]
    c = np.corrcoef(v, z)[0,1] if v.std() > 1e-6 else float("nan")
    print(f"{f'{lo:.0%}-{hi:.0%}':>14s} {m.sum():7d} {np.mean((v-z)**2):8.4f} {np.mean(z**2):9.4f} "
          f"{np.mean(np.sign(v)==np.sign(z))*100:8.1f}% {c:7.3f} {np.abs(v).mean():8.3f}")
