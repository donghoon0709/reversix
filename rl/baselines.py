"""Baseline opponents and head-to-head evaluation."""
import numpy as np, rx

def agent_random(game, rng):
    return [rx.random_move(game, rng)]

def make_greedy(eps=0.1):
    def f(game, rng):
        return rx.greedy_turn(game, eps, rng)
    return f

def play_match(black, white, n_games, seed=0):
    """Each agent returns a list of cells for the whole turn (or one cell)."""
    res = {1: 0, 2: 0, 0: 0}
    for i in range(n_games):
        g = rx.Game()
        rng = rx._Rng(seed * 100003 + i * 7919 + 1)
        guard = 0
        while not g.terminal:
            act = black if g.player == 1 else white
            cells = act(g, rng)
            cells = [c for c in cells if c is not None and c >= 0]
            if not cells:
                # A scripted agent with nothing to play means a lost position, NOT a draw.
                raise RuntimeError("agent returned no move in a non-terminal position")
            for c in cells:
                if g.terminal:
                    break
                g.step(int(c))
            guard += 1
            if guard > 1000:
                break
        res[g.winner] += 1
    return res
