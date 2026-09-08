"""Round-robin between saved checkpoints -> relative Elo.

Once the agent saturates the scripted baselines, the only yardstick left is its own
past selves. Both sides search with their own network, so games are batched per side.
"""
import sys, glob, math, itertools
import numpy as np, torch
import rx, net as netmod
from mcts import GumbelSearch
from selfplay import Evaluator, _drive


def play_pair(netA, netB, dev, n_games, a_plays, sims, m, seed, parallel=48):
    """netA plays colour `a_plays` (1=black, 2=white). Returns {winner: count}."""
    rng = np.random.default_rng(seed)
    evA, evB = Evaluator(netA, dev), Evaluator(netB, dev)
    res = {0: 0, 1: 0, 2: 0}
    started = 0

    def new_slot():
        return {"game": rx.Game(), "search": None}

    live = [new_slot() for _ in range(min(parallel, n_games))]
    started = len(live)

    while live:
        for s in live:
            s["search"] = GumbelSearch(s["game"].copy(), sims, m, rng)
        ga = [s for s in live if s["game"].player == a_plays]
        gb = [s for s in live if s["game"].player != a_plays]
        if ga: _drive(ga, evA)
        if gb: _drive(gb, evB)
        nxt = []
        for s in live:
            cell, _ = s["search"].result()
            s["game"].step(cell)
            if s["game"].terminal:
                res[s["game"].winner] += 1
                if started < n_games:
                    nxt.append(new_slot()); started += 1
            else:
                nxt.append(s)
        live = nxt
    return res


def bradley_terry(names, wins, draws, iters=500):
    """MM algorithm; returns Elo with the first player pinned to 0."""
    n = len(names)
    r = np.ones(n)
    W = np.zeros((n, n))
    for i in range(n):
        for j in range(n):
            if i != j:
                W[i, j] = wins[i][j] + 0.5 * draws[i][j]
    for _ in range(iters):
        new = r.copy()
        for i in range(n):
            num = W[i].sum()
            den = sum((W[i, j] + W[j, i]) / (r[i] + r[j]) for j in range(n) if j != i)
            if den > 0 and num > 0:
                new[i] = num / den
        r = new / new.mean()
    elo = 400 * np.log10(np.maximum(r, 1e-9))
    return elo - elo[0]


def main():
    rx.configure(10, 6)
    dev = netmod.pick_device()
    paths = sys.argv[1:-1] if len(sys.argv) > 2 else sorted(glob.glob("runs/r1/ck_*.pt"))
    G = int(sys.argv[-1]) if len(sys.argv) > 2 else 40
    paths = list(paths)
    nets, names, sims, m = [], [], 32, 16
    for p in paths:
        ck = torch.load(p, map_location="cpu")
        a = ck["args"]; sims, m = a["sims"], a["m"]
        nn = netmod.Net(planes=rx.PLANES, ch=a["ch"], blocks=a["blocks"]).to(dev)
        nn.load_state_dict(ck["net"]); nn.eval()
        nets.append(nn); names.append(f"iter{ck['iter']:02d}")
    n = len(nets)
    wins = [[0] * n for _ in range(n)]
    draws = [[0] * n for _ in range(n)]
    print(f"round-robin: {n} checkpoints, {G} games per colour per pair "
          f"({n*(n-1)//2*G*2} games total)\n")
    for i, j in itertools.combinations(range(n), 2):
        tot = {0: 0, 1: 0, 2: 0}
        for a_plays in (1, 2):
            r = play_pair(nets[i], nets[j], dev, G, a_plays, sims, m, seed=i * 977 + j * 31 + a_plays)
            iw = r[a_plays]; jw = r[3 - a_plays]
            wins[i][j] += iw; wins[j][i] += jw
            draws[i][j] += r[0]; draws[j][i] += r[0]
            for k in tot: tot[k] += r[k]
        tn = 2 * G
        s = (wins[i][j] + 0.5 * draws[i][j]) / tn
        print(f"  {names[i]} vs {names[j]}: {wins[i][j]}-{wins[j][i]}-{draws[i][j]}  "
              f"score {s:.3f}", flush=True)
    elo = bradley_terry(names, wins, draws)
    print(f"\n{'checkpoint':>12s} {'Elo':>8s}")
    for nm, e in zip(names, elo):
        print(f"{nm:>12s} {e:8.0f}")


if __name__ == "__main__":
    main()
