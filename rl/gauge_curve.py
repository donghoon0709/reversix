"""Gauge a series of checkpoints against the fixed panel to locate where a run turned."""
import glob, re, sys, time
import torch
import rx, net as netmod
from gauge import gauge, load_panel

rx.configure(10, 6)
dev = netmod.pick_device()
paths = sys.argv[1:] or sorted(glob.glob("runs/r3/ck_*.pt"))
games = 15
panel = load_panel(dev)
print(f"panel: {[(p.name, e) for p, e in panel]}\n")
print(f"{'checkpoint':>12} {'Elo':>6}   per-reference score")
for p in paths:
    ck = torch.load(p, map_location="cpu")
    a = ck["args"]
    m = netmod.Net(planes=rx.PLANES, ch=a["ch"], blocks=a["blocks"]).to(dev)
    m.load_state_dict(ck["net"]); m.eval()
    t0 = time.time()
    elo, detail = gauge(m, dev, a["sims"], a["m"], games=games, seed=ck["iter"], panel=panel)
    scores = "  ".join(f"{n}:{s:.2f}" for n, _, s, _ in detail)
    print(f"{'iter%02d' % ck['iter']:>12} {elo:6.0f}   {scores}   ({time.time()-t0:.0f}s)", flush=True)
