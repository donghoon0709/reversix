"""Do the checkpoint's self-play games actually repeat themselves?

The policy narrowing is measured; whether it makes the games converge is not. This plays
the same self-play the trainer would (Gumbel search, sampled opening) and asks how much
the games overlap:
  * branch ply     - where two games first differ, averaged over all pairs
  * unique openings- distinct first-8-ply move sequences
  * position reuse - share of visited positions seen in more than one game
  * distinct moves - distinct cells actually played, per ply index
"""
import sys, time
from collections import Counter
import numpy as np, torch
import rx, net as netmod
from selfplay import run_selfplay


def play_games(model, dev, n_games, sims, m, seed, temp_moves):
    """Replay the trainer's own self-play and keep the move sequences."""
    import rx as _rx
    from mcts import GumbelSearch
    from selfplay import Evaluator, _drive, terminal_value
    rng = np.random.default_rng(seed)
    ev = Evaluator(model, dev)
    seqs, boards = [], []
    parallel = min(24, n_games)
    slots, started = [], 0

    def new():
        g = _rx.Game()
        return {"game": g, "seq": [], "keys": [], "search": GumbelSearch(g, sims, m, rng), "ply": 0}

    slots = [new() for _ in range(parallel)]
    started = len(slots)
    while slots:
        _drive(slots, ev)
        nxt = []
        for s in slots:
            cell, target = s["search"].result()
            if s["ply"] < temp_moves:
                p = target.copy(); t = p.sum()
                if t > 0: cell = int(rng.choice(_rx.CELLS, p=p / t))
            s["seq"].append(int(cell))
            s["keys"].append(bytes(s["game"].st.board))
            s["game"].step(cell)
            s["ply"] += 1
            if s["game"].terminal or s["ply"] > 300:
                seqs.append(s["seq"]); boards.append(s["keys"])
                if started < n_games:
                    nxt.append(new()); started += 1
            else:
                s["search"] = GumbelSearch(s["game"], sims, m, rng)
                nxt.append(s)
        slots = nxt
    return seqs, boards


def branch_ply(a, b):
    for i, (x, y) in enumerate(zip(a, b)):
        if x != y: return i
    return min(len(a), len(b))


def main():
    rx.configure(10, 6)
    dev = netmod.pick_device()
    n_games = 40
    paths = [a for a in sys.argv[1:] if a.endswith(".pt")]
    print(f"{n_games} self-play games per checkpoint, same settings as training\n")
    print(f"{'checkpoint':>11} {'branch ply':>11} {'uniq open8':>11} {'reused pos':>11} "
          f"{'moves@ply0':>11} {'moves@ply4':>11} {'moves@ply10':>12}")
    for p in paths:
        ck = torch.load(p, map_location="cpu"); a = ck["args"]
        model = netmod.Net(planes=rx.PLANES, ch=a["ch"], blocks=a["blocks"]).to(dev)
        model.load_state_dict(ck["net"]); model.eval()
        t0 = time.time()
        seqs, boards = play_games(model, dev, n_games, a["sims"], a["m"], seed=11, temp_moves=12)
        pairs = [branch_ply(seqs[i], seqs[j]) for i in range(len(seqs)) for j in range(i + 1, len(seqs))]
        opens = len({tuple(s[:8]) for s in seqs})
        allpos = Counter(k for ks in boards for k in set(ks))
        reused = sum(1 for v in allpos.values() if v > 1) / max(len(allpos), 1)
        per_ply = lambda i: len({s[i] for s in seqs if len(s) > i})
        print(f"{'iter%02d' % ck['iter']:>11} {np.mean(pairs):11.1f} {opens:>7}/{len(seqs)} "
              f"{reused*100:10.1f}% {per_ply(0):11d} {per_ply(4):11d} {per_ply(10):12d}"
              f"   ({time.time()-t0:.0f}s)", flush=True)


if __name__ == "__main__":
    main()
