"""A restart must not change the training state.

Runs two iterations in one go, then the same two with a stop and resume in between, and
compares the resulting weights. Without the optimiser state the second iteration starts
Adam from scratch and the runs diverge.
"""
import json, os, shutil, subprocess, sys
import numpy as np, torch

PY = "./.venv/bin/python"
BASE = ["--n", "10", "--k", "6", "--ch", "32", "--blocks", "2",
        "--games", "24", "--parallel", "24", "--workers", "2",
        "--sims", "16", "--m", "8", "--buffer", "20000", "--batch", "128",
        "--lr", "2e-3", "--eval-every", "0", "--ckpt-every", "0", "--gauge-games", "0"]

def run(out, iters, resume=None):
    cmd = [PY, "train.py", *BASE, "--iters", str(iters), "--out", out]
    if resume: cmd += ["--resume", resume]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode: print(r.stdout[-2000:], r.stderr[-2000:]); sys.exit(1)
    return r.stdout

for d in ("runs/_v_cont", "runs/_v_cont2", "runs/_v_split"):
    shutil.rmtree(d, ignore_errors=True)

print("A: two iterations without interruption")
run("runs/_v_cont", 2)

print("A': the same again, to measure how deterministic training is at all")
run("runs/_v_cont2", 2)

print("B: one iteration, stop, resume for the second")
run("runs/_v_split", 1)
out = run("runs/_v_split", 2, resume="runs/_v_split/latest.pt")
print("  ", [l for l in out.splitlines() if "optimiser" in l or "resumed" in l])

a = torch.load("runs/_v_cont/latest.pt", map_location="cpu")
b = torch.load("runs/_v_split/latest.pt", map_location="cpu")
print(f"\ncheckpoint keys: {sorted(a.keys())}")
print(f"optimiser state present: {'opt' in a and bool(a['opt']['state'])}")

a2 = torch.load("runs/_v_cont2/latest.pt", map_location="cpu")
def maxdiff(x, y):
    return max(float((x["net"][k].float() - y["net"][k].float()).abs().max())
               for k in x["net"] if x["net"][k].is_floating_point())
print(f"\nA vs A'  (no restart, baseline nondeterminism): {maxdiff(a, a2):.3e}")
print(f"A vs B   (with a stop and resume)              : {maxdiff(a, b):.3e}")

zb = np.load("runs/_v_split/buffer.npz")
print(f"buffer persisted: {len(zb['S'])} samples")
