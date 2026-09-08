"""Batched head-to-head evaluation: the network (with Gumbel search) vs a scripted opponent.

Many games run together so every network call is one big batch — the same trick self-play
uses. Without it a 500-game match costs ~50 min; with it, a few minutes.
"""
import numpy as np, rx
from mcts import GumbelSearch
from selfplay import Evaluator, _drive


def _opponent_turn(game, rng, kind, eps):
    """Always makes progress: a scripted agent that returns nothing would spin forever."""
    cells = rx.greedy_turn(game, eps, rng) if kind == "greedy" else [rx.random_move(game, rng)]
    cells = [c for c in cells if c is not None and c >= 0]
    if not cells:                       # last resort: any legal placement
        import numpy as _np
        mask, n = game.legal(1)
        if n == 0:
            raise RuntimeError("opponent has no legal move in a non-terminal position")
        cells = [int(_np.nonzero(mask)[0][0])]
    before = (game.st.player, game.st.placed, game.terminal)
    for c in cells:
        if game.terminal:
            break
        game.step(int(c))
    if not game.terminal and (game.st.player, game.st.placed) == before[:2]:
        raise RuntimeError("opponent turn made no progress")


def play_match(net, dev, n_games, net_plays, sims=32, m=16, seed=0,
               parallel=64, opponent="greedy", eps=0.1):
    """net_plays: 1 = network is black, 2 = network is white. Returns {winner: count}."""
    rng = np.random.default_rng(seed)
    ev = Evaluator(net, dev)
    res = {0: 0, 1: 0, 2: 0}
    started = 0

    def new_slot(i):
        return {"game": rx.Game(), "rng": rx._Rng(seed * 7919 + i * 104729 + 1),
                "search": None, "done": False}

    live = [new_slot(i) for i in range(min(parallel, n_games))]
    started = len(live)

    while live:
        pending, nxt = [], []
        for s in live:
            g = s["game"]
            while not g.terminal and g.player != net_plays:
                _opponent_turn(g, s["rng"], opponent, eps)
            if g.terminal:
                res[g.winner] += 1
                if started < n_games:
                    nxt.append(new_slot(started)); started += 1
                continue
            s["search"] = GumbelSearch(g.copy(), sims, m, rng)
            pending.append(s); nxt.append(s)
        if pending:
            _drive(pending, ev)
            for s in pending:
                cell, _ = s["search"].result()
                s["game"].step(cell)
                if s["game"].terminal:
                    res[s["game"].winner] += 1
                    nxt.remove(s)
                    if started < n_games:
                        nxt.append(new_slot(started)); started += 1
        live = nxt
    return res


def score(res, side):
    n = sum(res.values())
    return (res[side] + 0.5 * res[0]) / n if n else 0.0


def evaluate(net, dev, games_per_side, sims=32, m=16, seed=0, parallel=64,
             opponent="greedy", eps=0.1):
    """Colour-balanced match. Returns (overall, as_black, as_white, n)."""
    rb = play_match(net, dev, games_per_side, 1, sims, m, seed * 3 + 1, parallel, opponent, eps)
    rw = play_match(net, dev, games_per_side, 2, sims, m, seed * 3 + 2, parallel, opponent, eps)
    sb, sw = score(rb, 1), score(rw, 2)
    return (sb + sw) / 2, sb, sw, sum(rb.values()) + sum(rw.values())
