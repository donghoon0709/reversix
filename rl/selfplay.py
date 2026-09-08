"""Batched self-play: many games advance together so every NN call is one big batch."""
import numpy as np, torch, rx
from mcts import GumbelSearch


class Evaluator:
    def __init__(self, net, device):
        self.net, self.device = net, device

    @torch.no_grad()
    def __call__(self, games):
        x = np.stack([g.encode(1) for g in games])
        t = torch.from_numpy(x).to(self.device)
        logits, v = self.net(t)
        return logits.float().cpu().numpy(), v.float().cpu().numpy()


def terminal_value(game, player):
    w = game.winner
    return 0.0 if w == 0 else (1.0 if w == player else -1.0)


def _drive(slots, ev):
    """Run every slot's search to completion, batching leaf evaluations."""
    for s in slots:
        s["done"] = False
    while True:
        reqs = []
        for s in slots:
            if s["done"]:
                continue
            while True:
                item = s["search"].next_leaf()
                if item is None:
                    s["done"] = True
                    break
                path, g = item
                if g is None:                                  # terminal leaf: exact value
                    parent, ai = path[-1]
                    leaf = parent.child[ai]
                    s["search"].backup(path, terminal_value(leaf.game, leaf.player), leaf.player)
                    continue                                   # fetch another leaf
                reqs.append((s, path, g))
                break
        if not reqs:
            return
        logits, values = ev([r[2] for r in reqs])
        for (s, path, _), lg, v in zip(reqs, logits, values):
            if not path:
                s["search"].root.expand(lg, float(v))
            else:
                parent, ai = path[-1]
                child = parent.child[ai]
                child.expand(lg, float(v))
                s["search"].backup(path, float(v), child.player)


def run_selfplay(net, device, n_games, n_parallel=64, n_sim=32, m=16,
                 temp_moves=12, seed=0, progress=0):
    rng = np.random.default_rng(seed)
    ev = Evaluator(net, device)
    S, P, V = [], [], []
    stats = {"B": 0, "W": 0, "D": 0, "turns": [], "plies": []}

    def new_slot():
        g = rx.Game()
        return {"game": g, "hist": [], "search": GumbelSearch(g, n_sim, m, rng), "ply": 0, "done": False}

    live = [new_slot() for _ in range(min(n_parallel, n_games))]
    started, finished = len(live), 0

    while live:
        _drive(live, ev)
        nxt = []
        for s in live:
            g = s["game"]
            cell, target = s["search"].result()
            if s["ply"] < temp_moves:                          # sample early for diversity
                p = target.copy()
                tot = p.sum()
                if tot > 0:
                    cell = int(rng.choice(rx.CELLS, p=p / tot))
            s["hist"].append((g.encode(1), target, g.player))
            g.step(cell)
            s["ply"] += 1
            if g.terminal:
                w = g.winner
                stats["B" if w == 1 else "W" if w == 2 else "D"] += 1
                stats["turns"].append(int(g.st.turn)); stats["plies"].append(s["ply"])
                for enc, tgt, pl in s["hist"]:
                    S.append(enc); P.append(tgt)
                    V.append(0.0 if w == 0 else (1.0 if w == pl else -1.0))
                finished += 1
                if progress and finished % progress == 0:
                    print(f"    selfplay {finished}/{n_games}", flush=True)
                if started < n_games:
                    nxt.append(new_slot()); started += 1
            else:
                s["search"] = GumbelSearch(g, n_sim, m, rng)
                nxt.append(s)
        live = nxt
    return np.array(S, np.float32), np.array(P, np.float32), np.array(V, np.float32), stats
