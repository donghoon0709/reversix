"""Statistics for the checkpoint that is actually deployed to the web app."""
import json, math, sys, time
import numpy as np, torch
import rx, net as netmod
from evaluate import evaluate, play_match, score
from ladder import play_pair

rx.configure(10, 6)
dev = netmod.pick_device()
ck = torch.load(sys.argv[1], map_location="cpu")
a = ck["args"]
model = netmod.Net(planes=rx.PLANES, ch=a["ch"], blocks=a["blocks"]).to(dev)
model.load_state_dict(ck["net"]); model.eval()
SIMS, M = a["sims"], a["m"]
print(f"deployed checkpoint: iter {ck['iter']}  (ch{a['ch']}x{a['blocks']}, search {SIMS} sims / {M} candidates)\n")

def wil(k, n, z=1.96):
    if not n: return 0, 0
    p = k / n; d = 1 + z*z/n
    c = (p + z*z/(2*n)) / d
    m = z*math.sqrt(p*(1-p)/n + z*z/(4*n*n)) / d
    return c-m, c+m

GAMES = int(sys.argv[2]) if len(sys.argv) > 2 else 100   # per colour
t0 = time.time()
s, sb, sw, n = evaluate(model, dev, GAMES, SIMS, M, seed=11, parallel=64, opponent="greedy")
lo, hi = wil(s * n, n)
print(f"vs greedy  score {s:.3f} [{lo:.3f}-{hi:.3f}]   as black {sb:.3f} / as white {sw:.3f}   n={n}  {time.time()-t0:.0f}s")
