"""Is the search still teaching the network anything?

AlphaZero improves because the search-improved policy is better than the raw network
policy; that gap is the entire training signal. If it closes, the network trains on its
own output and the run flattens no matter how long it goes.

For each checkpoint we sample positions from its own self-play and compare, per position:
  * entropy of the raw policy (has it collapsed to a single move?)
  * KL(improved || prior) — how much the search moved the distribution
  * how often the search picks a different move than the policy's argmax
"""
import sys, numpy as np, torch
import rx, net as netmod
from mcts import GumbelSearch, softmax
from selfplay import Evaluator, terminal_value


def sample_positions(model, dev, n_pos, sims, m, rng):
    """Positions from the checkpoint's own play, so the diagnosis matches training."""
    ev = Evaluator(model, dev)
    out = []
    while len(out) < n_pos:
        g = rx.Game()
        ply = 0
        while not g.terminal and len(out) < n_pos:
            out.append(g.copy())
            mask, n = g.legal(1)
            if n == 0: break
            idx = np.nonzero(mask)[0]
            # follow the policy loosely so positions look like training ones
            logits, _ = ev([g])
            lg = logits[0][idx]; lg = lg - lg.max()
            p = np.exp(lg / 1.0); p /= p.sum()
            g.step(int(rng.choice(idx, p=p)))
            ply += 1
            if ply > 200: break
    return out[:n_pos]


def run_search(model, dev, game, sims, m, rng):
    s = GumbelSearch(game.copy(), sims, m, rng)
    ev = Evaluator(model, dev)
    while True:
        item = s.next_leaf()
        if item is None: break
        path, g = item
        if g is None:
            parent, ai = path[-1]; leaf = parent.child[ai]
            s.backup(path, terminal_value(leaf.game, leaf.player), leaf.player)
            continue
        lg, v = ev([g])
        if not path: s.root.expand(lg[0], float(v[0]))
        else:
            parent, ai = path[-1]; child = parent.child[ai]
            child.expand(lg[0], float(v[0])); s.backup(path, float(v[0]), child.player)
    cell, target = s.result()
    prior = softmax(s.root.prior)
    improved = target[s.root.legal]
    return prior, improved, s.root.legal, cell


def main():
    rx.configure(10, 6)
    dev = netmod.pick_device()
    n_pos = int(sys.argv[-1]) if sys.argv[-1].isdigit() else 120
    paths = [a for a in sys.argv[1:] if a.endswith(".pt")]
    print(f"{'checkpoint':>11} {'entropy':>8} {'maxP':>6} {'KL(imp||prior)':>15} {'argmax changed':>15} {'legal':>6}")
    for p in paths:
        ck = torch.load(p, map_location="cpu"); a = ck["args"]
        model = netmod.Net(planes=rx.PLANES, ch=a["ch"], blocks=a["blocks"]).to(dev)
        model.load_state_dict(ck["net"]); model.eval()
        rng = np.random.default_rng(7)
        games = sample_positions(model, dev, n_pos, a["sims"], a["m"], rng)
        ents, kls, changed, maxps, nlegal = [], [], 0, [], []
        for g in games:
            if g.terminal: continue
            prior, improved, legal, cell = run_search(model, dev, g, a["sims"], a["m"], rng)
            if len(legal) < 2: continue
            ents.append(float(-(prior * np.log(prior + 1e-12)).sum()))
            maxps.append(float(prior.max()))
            imp = improved / max(improved.sum(), 1e-12)
            kls.append(float((imp * np.log((imp + 1e-12) / (prior + 1e-12))).sum()))
            if int(legal[int(np.argmax(prior))]) != int(cell): changed += 1
            nlegal.append(len(legal))
        k = len(ents)
        print(f"{'iter%02d' % ck['iter']:>11} {np.mean(ents):8.3f} {np.mean(maxps):6.3f} "
              f"{np.mean(kls):15.4f} {changed / k * 100:14.1f}% {np.mean(nlegal):6.1f}", flush=True)


if __name__ == "__main__":
    main()
