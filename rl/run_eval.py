import sys, time, math, torch, rx, net as netmod
from evaluate import evaluate
rx.configure(10, 6)
ck = torch.load(sys.argv[1], map_location="cpu")
a = ck["args"]; G = int(sys.argv[2]); par = int(sys.argv[3]) if len(sys.argv) > 3 else 64
dev = netmod.pick_device()
net = netmod.Net(planes=rx.PLANES, ch=a["ch"], blocks=a["blocks"]).to(dev)
net.load_state_dict(ck["net"]); net.eval()
for opp in ("greedy", "random"):
    t0 = time.time()
    s, sb, sw, n = evaluate(net, dev, G, a["sims"], a["m"], seed=7, parallel=par, opponent=opp)
    se = math.sqrt(0.25 / n)
    print(f"iter {ck['iter']}  vs {opp:6s}: {s:.3f} ± {1.96*se:.3f}   (black {sb:.3f} / white {sw:.3f})"
          f"   n={n}  {time.time()-t0:.0f}s", flush=True)
