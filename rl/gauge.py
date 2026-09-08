"""Estimate one agent's Elo against a fixed panel of references.

A full round-robin costs half an hour, which is too much to run at every evaluation.
Instead the references keep the ratings the ladder gave them and only the new agent is
fitted, so the number stays on the same scale (random = 0) for a fraction of the cost.
"""
import json, math, os
import numpy as np
import torch

import rx, net as netmod
from ladder import NetPlayer, ScriptPlayer, match

PANEL = os.path.join(os.path.dirname(os.path.abspath(__file__)), "panel", "panel.json")


def load_panel(dev, path=PANEL):
    spec = json.load(open(path))
    out = []
    for r in spec["references"]:
        if r["kind"] == "script":
            out.append((ScriptPlayer(r["name"], r["name"]), r["elo"]))
        else:
            root = os.path.dirname(os.path.dirname(os.path.abspath(path)))
            p = r["path"] if os.path.isabs(r["path"]) else os.path.join(root, r["path"])
            ck = torch.load(p, map_location="cpu")
            a = ck["args"]
            nn = netmod.Net(planes=rx.PLANES, ch=a["ch"], blocks=a["blocks"]).to(dev)
            nn.load_state_dict(ck["net"]); nn.eval()
            out.append((NetPlayer(r["name"], nn, a["sims"], a["m"]), r["elo"]))
    return out


def fit_elo(results, prior=0.5):
    """results: list of (reference_elo, score, games). Bisect on the log-likelihood."""
    def dll(r):                       # derivative of the log-likelihood wrt r
        g = 0.0
        for ref, s, n in results:
            n_eff = n + 2 * prior
            s_eff = (s * n + prior) / n_eff        # a virtual win and loss keep it finite
            p = 1.0 / (1.0 + 10 ** ((ref - r) / 400.0))
            g += n_eff * (s_eff - p)
        return g
    lo, hi = -2000.0, 6000.0
    for _ in range(200):
        mid = (lo + hi) / 2
        if dll(mid) > 0: lo = mid
        else: hi = mid
    return (lo + hi) / 2


def gauge(model, dev, sims, m, games=15, seed=0, panel=None):
    """Play the model against every reference and return (elo, per-reference scores)."""
    panel = panel if panel is not None else load_panel(dev)
    me = NetPlayer("current", model, sims, m)
    results, detail = [], []
    for i, (ref, elo) in enumerate(panel):
        w = d = 0
        total = 0
        for a_plays in (1, 2):
            r = match(me, ref, dev, games, a_plays, seed=seed * 131 + i * 17 + a_plays)
            w += r[a_plays]; d += r[0]; total += sum(r.values())
        s = (w + 0.5 * d) / total
        results.append((elo, s, total))
        detail.append((ref.name, elo, s, total))
    return fit_elo(results), detail
