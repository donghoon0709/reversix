"""Round-robin between agents -> relative Elo, anchored on the random player.

Anchoring on a checkpoint makes ratings incomparable between training runs, because
"iteration 4" means something different each time. The random player is fixed and
reproducible, so it is the natural zero — but nothing can be rated against it directly
once agents beat it every game. The chain random -> greedy -> early checkpoints -> later
ones carries the anchor across, which is why the early checkpoints are worth keeping.
"""
import glob, itertools, sys
import numpy as np
import torch

import rx, net as netmod, baselines as B
from evaluate import play_match as net_vs_script
from mcts import GumbelSearch
from selfplay import Evaluator, _drive


class NetPlayer:
    kind = "net"
    def __init__(self, name, model, sims, m):
        self.name, self.model, self.sims, self.m = name, model, sims, m


class ScriptPlayer:
    kind = "script"
    def __init__(self, name, opponent, eps=0.1):
        self.name, self.opponent, self.eps = name, opponent, eps
    def turn_fn(self):
        return B.make_greedy(self.eps) if self.opponent == "greedy" else B.agent_random


def net_vs_net(a, b, dev, n_games, a_plays, seed, parallel=48):
    rng = np.random.default_rng(seed)
    evA, evB = Evaluator(a.model, dev), Evaluator(b.model, dev)
    res = {0: 0, 1: 0, 2: 0}
    new = lambda: {"game": rx.Game(), "search": None}
    live = [new() for _ in range(min(parallel, n_games))]
    started = len(live)
    while live:
        for s in live:
            s["search"] = GumbelSearch(s["game"].copy(), a.sims, a.m, rng)
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
                if started < n_games: nxt.append(new()); started += 1
            else:
                nxt.append(s)
        live = nxt
    return res


def match(a, b, dev, n_games, a_plays, seed):
    """Result dict keyed by winner (0 = draw), with `a` playing colour `a_plays`."""
    if a.kind == "net" and b.kind == "net":
        return net_vs_net(a, b, dev, n_games, a_plays, seed)
    if a.kind == "net":
        return net_vs_script(a.model, dev, n_games, a_plays, a.sims, a.m, seed,
                             parallel=48, opponent=b.opponent, eps=b.eps)
    if b.kind == "net":
        return net_vs_script(b.model, dev, n_games, 3 - a_plays, b.sims, b.m, seed,
                             parallel=48, opponent=a.opponent, eps=a.eps)
    black, white = (a, b) if a_plays == 1 else (b, a)
    return B.play_match(black.turn_fn(), white.turn_fn(), n_games, seed=seed)


def bradley_terry(wins, draws, anchor, iters=2000, prior=0.5):
    """MM algorithm. `prior` adds a virtual drawn game to every pair so a player that
    never loses still gets a finite rating."""
    n = len(wins)
    W = np.zeros((n, n))
    for i in range(n):
        for j in range(n):
            if i != j:
                W[i, j] = wins[i][j] + 0.5 * draws[i][j] + prior
    r = np.ones(n)
    for _ in range(iters):
        new = r.copy()
        for i in range(n):
            num = W[i].sum()
            den = sum((W[i, j] + W[j, i]) / (r[i] + r[j]) for j in range(n) if j != i)
            if den > 0 and num > 0:
                new[i] = num / den
        r = new / new.mean()
    elo = 400 * np.log10(np.maximum(r, 1e-12))
    return elo - elo[anchor]


def main():
    rx.configure(10, 6)
    dev = netmod.pick_device()
    args = sys.argv[1:]
    games = int(args[-1]) if args and args[-1].isdigit() else 30
    paths = [a for a in args if a.endswith(".pt")] or sorted(glob.glob("runs/r3/ck_*.pt"))

    players = [ScriptPlayer("random", "random"), ScriptPlayer("greedy", "greedy")]
    for p in paths:
        ck = torch.load(p, map_location="cpu")
        a = ck["args"]
        nn = netmod.Net(planes=rx.PLANES, ch=a["ch"], blocks=a["blocks"]).to(dev)
        nn.load_state_dict(ck["net"]); nn.eval()
        players.append(NetPlayer(f"iter{ck['iter']:02d}", nn, a["sims"], a["m"]))

    n = len(players)
    wins = [[0] * n for _ in range(n)]
    draws = [[0] * n for _ in range(n)]
    print(f"round-robin: {n} players, {games} games per colour per pair "
          f"({n*(n-1)//2*games*2} games)\n", flush=True)
    for i, j in itertools.combinations(range(n), 2):
        for a_plays in (1, 2):
            r = match(players[i], players[j], dev, games, a_plays, seed=i*977 + j*31 + a_plays)
            wins[i][j] += r[a_plays]; wins[j][i] += r[3 - a_plays]
            draws[i][j] += r[0]; draws[j][i] += r[0]
        tot = wins[i][j] + wins[j][i] + draws[i][j]
        print(f"  {players[i].name:>8} vs {players[j].name:<8} "
              f"{wins[i][j]:3d}-{wins[j][i]:3d}-{draws[i][j]:3d}   "
              f"score {(wins[i][j] + 0.5*draws[i][j]) / tot:.3f}", flush=True)

    elo = bradley_terry(wins, draws, anchor=0)
    print(f"\n{'player':>10} {'Elo':>7}   (random = 0)")
    for k in np.argsort(elo):
        print(f"{players[k].name:>10} {elo[k]:7.0f}")


if __name__ == "__main__":
    main()
