"""Gumbel AlphaZero search (Danihelka et al. 2022).

Reversix specifics:
  * one action = one placement; a turn is two placements by the SAME player, so a
    backed-up value is negated only when the player actually differs;
  * the legal mask from the C env already drops placements that lose on the spot
    to a standing check, so the net never has to learn that class of blunder.
"""
import numpy as np
import rx

C_VISIT, C_SCALE = 50.0, 1.0

def softmax(x):
    e = np.exp(x - x.max()); return e / e.sum()

def sigma(q, maxn):
    return (C_VISIT + maxn) * C_SCALE * q

def halving_schedule(n_sim, m):
    """(candidates, visits each) per sequential-halving phase."""
    n_phases = max(1, int(np.ceil(np.log2(max(m, 2)))))
    out, cand = [], m
    for _ in range(n_phases):
        if cand < 1: break
        out.append((cand, max(1, n_sim // (n_phases * cand))))
        if cand == 1: break
        cand //= 2
    return out


class Node:
    __slots__ = ("game", "player", "terminal", "expanded", "legal", "prior",
                 "N", "W", "child", "value")

    def __init__(self, game):
        self.game = game
        self.player = game.player
        self.terminal = game.terminal
        self.expanded = False
        self.legal = self.prior = self.N = self.W = self.child = None
        self.value = 0.0

    def expand(self, logits, value):
        mask, _ = self.game.legal(1)
        self.legal = np.nonzero(mask)[0]
        lg = logits[self.legal].astype(np.float32)
        self.prior = lg - lg.max()
        k = len(self.legal)
        self.N = np.zeros(k, dtype=np.int32)
        self.W = np.zeros(k, dtype=np.float32)
        self.child = [None] * k
        self.value = float(value)
        self.expanded = True

    def q(self):
        return np.where(self.N > 0, self.W / np.maximum(self.N, 1), 0.0).astype(np.float32)

    def completed_q(self):
        """Unvisited actions take v_mix, the visit-weighted blend of node value and child Qs."""
        n_sum = int(self.N.sum())
        q = self.q()
        if n_sum == 0:
            return np.full(len(self.legal), self.value, dtype=np.float32)
        pi = softmax(self.prior)
        vis = self.N > 0
        w = float(pi[vis].sum())
        v_mix = (self.value + (n_sum / max(w, 1e-8)) * float((pi[vis] * q[vis]).sum())) / (1 + n_sum)
        return np.where(vis, q, v_mix).astype(np.float32)


class GumbelSearch:
    """One game's search. The caller batches leaf evaluations across many searches."""

    def __init__(self, game, n_sim=32, m=16, rng=None):
        self.root = Node(game)
        self.n_sim, self.m = n_sim, m
        self.rng = rng if rng is not None else np.random.default_rng()
        self.gumbel = self.cands = self.phases = None
        self.phase_i = self.slot = self.visit_i = 0
        self.done = False

    # ---- search bookkeeping -------------------------------------------------
    def _start(self):
        k = len(self.root.legal)
        self.gumbel = self.rng.gumbel(size=k).astype(np.float32)
        m = min(self.m, k)
        self.cands = np.argsort(-(self.gumbel + self.root.prior))[:m]
        self.phases = halving_schedule(self.n_sim, m)
        self.phase_i = self.slot = self.visit_i = 0
        if k == 1:
            self.done = True

    def _interior_select(self, node):
        maxn = int(node.N.max()) if node.N.size else 0
        pi = softmax(node.prior + sigma(node.completed_q(), maxn))
        return int(np.argmax(pi - node.N / (1 + int(node.N.sum()))))

    def next_leaf(self):
        """(path, game_needing_eval) — game is None for a terminal leaf; None when finished."""
        if self.done:
            return None
        if not self.root.expanded:
            return ([], self.root.game)
        if self.gumbel is None:
            self._start()
            if self.done:
                return None
        while self.phase_i < len(self.phases):
            cand_n, per = self.phases[self.phase_i]
            cur = self.cands[:cand_n]
            if self.slot >= len(cur):
                self.slot = 0
                self.visit_i += 1
            if self.visit_i >= per:
                maxn = int(self.root.N.max())
                sc = self.gumbel[cur] + self.root.prior[cur] + sigma(self.root.completed_q()[cur], maxn)
                self.cands = cur[np.argsort(-sc)[:max(1, cand_n // 2)]]
                self.phase_i += 1
                self.slot = self.visit_i = 0
                continue
            ai = int(cur[self.slot])
            self.slot += 1
            path, node = [], self.root
            while True:
                path.append((node, ai))
                nxt = node.child[ai]
                if nxt is None:
                    g = node.game.copy()
                    g.step(int(node.legal[ai]))
                    node.child[ai] = Node(g)
                    return (path, None if node.child[ai].terminal else g)
                if nxt.terminal or not nxt.expanded:
                    return (path, None if nxt.terminal else nxt.game)
                node = nxt
                ai = self._interior_select(node)
        self.done = True
        return None

    def backup(self, path, value, leaf_player):
        """`value` is from leaf_player's perspective."""
        for node, ai in path:
            node.N[ai] += 1
            node.W[ai] += value if node.player == leaf_player else -value

    # ---- output -------------------------------------------------------------
    def result(self):
        root = self.root
        if self.gumbel is None:
            self._start()
        maxn = int(root.N.max()) if root.N.size else 0
        cq = root.completed_q()
        improved = softmax(root.prior + sigma(cq, maxn))
        sc = self.gumbel + root.prior + sigma(cq, maxn)
        allowed = np.full(len(root.legal), -np.inf, dtype=np.float32)
        allowed[self.cands] = sc[self.cands]
        a_i = int(np.argmax(allowed))
        target = np.zeros(rx.CELLS, dtype=np.float32)
        target[root.legal] = improved
        return int(root.legal[a_i]), target
