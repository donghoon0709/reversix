#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.13"
# dependencies = ["numpy", "torch"]
# ///
# ─── How to run ───
# Install uv: https://docs.astral.sh/uv/getting-started/installation/
# From rl/: PYTHONDONTWRITEBYTECODE=1 uv run --no-project --python .venv/bin/python
#   python ../artifacts/analysis-r3-20260908/probe.py
# ──────────────────
"""Measure fixed-state policy/search changes without changing trained weights."""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import numpy as np
import torch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "rl"))
import net as netmod
import rx
from diag_search import sample_positions
from mcts import GumbelSearch, halving_schedule, softmax
from selfplay import Evaluator, _drive


def load_model(path: Path) -> netmod.Net:
    checkpoint = torch.load(path, map_location="cpu", weights_only=True)
    args = checkpoint["args"]
    model = netmod.Net(planes=9, ch=args["ch"], blocks=args["blocks"])
    model.load_state_dict(checkpoint["net"])
    model.eval()
    return model


def tree_depths(search: GumbelSearch) -> tuple[list[int], int, int]:
    """Count expanded tree structure; depths count individual placements."""
    stack = [(search.root, 0)]
    depths: list[int] = []
    terminals = nodes = 0
    while stack:
        node, depth = stack.pop()
        if depth:
            nodes += 1
            terminals += int(node.terminal)
        children = [] if node.child is None else [c for c in node.child if c is not None]
        if children:
            stack.extend((child, depth + 1) for child in children)
        else:
            depths.append(depth)
    return depths, terminals, nodes


def main() -> None:
    torch.set_num_threads(2)
    torch.set_num_interop_threads(1)
    device = torch.device("cpu")
    paths = {i: ROOT / "rl/runs/r3" / f"ck_{i:04d}.pt" for i in (9, 14, 20, 24)}
    paths[29] = ROOT / "rl/runs/r3/latest.pt"
    models = {i: load_model(path) for i, path in paths.items()}
    rng = np.random.default_rng(20260908)
    positions = []
    for iteration in (20, 29):
        candidates = sample_positions(models[iteration], device, 256, 32, 16, rng)
        indices = rng.choice(len(candidates), 64, replace=False)
        positions.extend(candidates[int(index)] for index in indices)
    print(json.dumps({"fixed_positions": len(positions), "source": "64 raw-policy positions each from iter20/29; identical positions for every model", "sims32_m16_schedule": halving_schedule(32, 16)}), flush=True)
    records = []
    priors = {}
    values = {}
    for iteration, model in models.items():
        started = time.monotonic()
        logits, value = Evaluator(model, device)(positions)
        values[iteration] = value
        prior_rows = []
        entropies = []
        max_probs = []
        for game, row in zip(positions, logits, strict=True):
            legal = np.flatnonzero(game.legal(1)[0])
            prior = softmax(row[legal])
            prior_rows.append(prior)
            entropies.append(float(-(prior * np.log(prior + 1e-12)).sum()))
            max_probs.append(float(prior.max()))
        priors[iteration] = prior_rows
        for sims in ((32, 128) if iteration in (20, 29) else (32,)):
            slots = [{"search": GumbelSearch(game.copy(), sims, 16, np.random.default_rng(9000 + j))} for j, game in enumerate(positions)]
            _drive(slots, Evaluator(model, device))
            kls = []
            target_entropy = []
            changed = []
            depths = []
            max_depths = []
            terminals = nodes = 0
            root_visits = []
            for slot in slots:
                search = slot["search"]
                action, target = search.result()
                root = search.root
                prior = softmax(root.prior)
                improved = target[root.legal]
                kls.append(float((improved * np.log((improved + 1e-12) / (prior + 1e-12))).sum()))
                target_entropy.append(float(-(improved * np.log(improved + 1e-12)).sum()))
                changed.append(action != int(root.legal[int(np.argmax(prior))]))
                leaf_depths, terminal_count, node_count = tree_depths(search)
                depths.extend(leaf_depths)
                max_depths.append(max(leaf_depths))
                terminals += terminal_count
                nodes += node_count
                root_visits.append(int(root.N.sum()))
            record = {"iter": iteration, "sims": sims, "positions": len(positions), "prior_entropy": float(np.mean(entropies)), "prior_max_probability": float(np.mean(max_probs)), "target_entropy": float(np.mean(target_entropy)), "target_kl_from_prior": float(np.mean(kls)), "action_differs_from_prior_argmax": float(np.mean(changed)), "value_std": float(value.std()), "value_mean_abs": float(np.abs(value).mean()), "mean_leaf_depth": float(np.mean(depths)), "median_max_depth": float(np.median(max_depths)), "terminal_nodes": terminals, "tree_nodes": nodes, "mean_visits": float(np.mean(root_visits)), "elapsed_seconds": round(time.monotonic() - started, 1)}
            records.append(record)
            print(json.dumps(record), flush=True)
    changes = {"iter20_to_29_argmax_changed_fraction": float(np.mean([int(a.argmax()) != int(b.argmax()) for a, b in zip(priors[20], priors[29], strict=True)])), "iter20_to_29_policy_kl": float(np.mean([float((b * np.log((b + 1e-12) / (a + 1e-12))).sum()) for a, b in zip(priors[20], priors[29], strict=True)])), "value_correlation": float(np.corrcoef(values[20], values[29])[0, 1])}
    print(json.dumps(changes), flush=True)
    with np.load(ROOT / "rl/runs/r3/buffer.npz") as buffer:
        indices = rng.choice(len(buffer["S"]), 4096, replace=False)
        states = buffer["S"][indices].astype(np.float32)
        outcomes = buffer["V"][indices]
        targets = buffer["P"][indices]
    replay = []
    for iteration, model in models.items():
        predicted = []
        ce = []
        with torch.no_grad():
            for start in range(0, len(states), 128):
                logits, value = model(torch.from_numpy(states[start:start + 128]))
                predicted.extend(value.numpy())
                log_p = torch.log_softmax(logits, dim=1).numpy()
                ce.extend(-(targets[start:start + 128] * log_p).sum(axis=1))
        v = np.asarray(predicted)
        record = {"iter": iteration, "samples": len(v), "recent_replay_value_mse": float(np.mean((v - outcomes) ** 2)), "value_zero_mse": float(np.mean(outcomes ** 2)), "value_sign_accuracy": float(np.mean(np.sign(v) == np.sign(outcomes))), "recent_replay_policy_ce": float(np.mean(ce)), "note": "common recent replay; training data for later checkpoints, NOT held-out validation"}
        replay.append(record)
        print(json.dumps(record), flush=True)
    out = {"search": records, "checkpoint_difference": changes, "replay": replay}
    with (Path(__file__).parent / "probe-results.json").open("w") as stream:
        json.dump(out, stream, indent=2)


if __name__ == "__main__":
    main()
