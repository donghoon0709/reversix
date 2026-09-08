import sys, json
for line in sys.stdin:
    line = line.strip()
    if not line.startswith("{"):
        continue
    d = json.loads(line)
    parts = [
        f"iter {d['iter']:>2}/80",
        f"black {d['black_share']*100:4.1f}%",
        f"turns {d['turns']:4.1f}",
        f"vloss {d['value_loss']:.3f}",
        f"ploss {d['policy_loss']:.3f}",
        f"{d.get('games_per_sec', 0):.2f} g/s",
        f"buf {d['samples']//1000}k",
    ]
    if "elo" in d:
        parts.append(f"** Elo {d['elo']} (random=0) **")
    if "vs_greedy" in d:
        parts.append(f"** vs_greedy {d['vs_greedy']:.3f} ±{d.get('vs_greedy_ci', 0):.3f} "
                     f"(B {d['vs_greedy_asB']:.2f}/W {d['vs_greedy_asW']:.2f}) | "
                     f"vs_random {d.get('vs_random', 0):.3f} | n={d.get('eval_n', 0)} {d.get('t_eval', 0):.0f}s **")
    print(" | ".join(parts), flush=True)
