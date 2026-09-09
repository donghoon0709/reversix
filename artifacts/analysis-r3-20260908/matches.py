#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.13"
# dependencies = ["numpy", "torch"]
# ///
# ─── How to run ───
# Install uv: https://docs.astral.sh/uv/getting-started/installation/
# From rl/: PYTHONDONTWRITEBYTECODE=1 uv run --no-project --python .venv/bin/python
#   python ../artifacts/analysis-r3-20260908/matches.py cpu 32 48
# Args: device, simulations, games per colour. Uses existing evaluation code.
# ──────────────────
"""Reevaluate immutable checkpoints against the same opponent and seeds."""
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
from evaluate import evaluate


def main() -> None:
    torch.set_num_threads(2)
    torch.set_num_interop_threads(1)
    device = torch.device(sys.argv[1])
    sims = int(sys.argv[2])
    games = int(sys.argv[3])
    iterations = [int(value) for value in sys.argv[4:]] or [20, 29]
    records = []
    for iteration in iterations:
        filename = "latest.pt" if iteration == 29 else f"ck_{iteration:04d}.pt"
        checkpoint = torch.load(ROOT / "rl/runs/r3" / filename, map_location="cpu", weights_only=True)
        model = netmod.Net(planes=9, ch=64, blocks=6).to(device)
        model.load_state_dict(checkpoint["net"])
        model.eval()
        started = time.monotonic()
        score, black, white, count = evaluate(model, device, games, sims, 16, seed=7241, parallel=32, opponent="greedy", eps=0.1)
        z2 = 1.96 ** 2
        center = (score + z2 / (2 * count)) / (1 + z2 / count)
        half = 1.96 * np.sqrt(score * (1 - score) / count + z2 / (4 * count ** 2)) / (1 + z2 / count)
        record = {"iter": iteration, "sims": sims, "score": score, "as_black": black, "as_white": white, "games": count, "wilson95": [center - half, center + half], "seed": 7241, "parallel": 32, "opponent": "greedy eps=.1", "seconds": round(time.monotonic() - started, 1), "device": str(device)}
        records.append(record)
        print(json.dumps(record), flush=True)
        with (Path(__file__).parent / f"matches-{device}-{sims}-{games}-{'-'.join(map(str, iterations))}.json").open("w") as stream:
            json.dump(records, stream, indent=2)


if __name__ == "__main__":
    main()
