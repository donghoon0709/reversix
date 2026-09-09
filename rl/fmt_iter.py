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
        parts.append(f"** 그리디 {d['vs_greedy']*100:.1f}% ±{d.get('vs_greedy_ci', 0)*100:.1f} "
                     f"(흑 {d['vs_greedy_asB']*100:.0f}/백 {d['vs_greedy_asW']*100:.0f}) · "
                     f"랜덤 {d.get('vs_random', 0)*100:.1f}% ±{d.get('vs_random_ci', 0)*100:.1f} "
                     f"(흑 {d.get('vs_random_asB', 0)*100:.0f}/백 {d.get('vs_random_asW', 0)*100:.0f}) · "
                     f"각 {d.get('eval_n', 0)}판 {d.get('t_eval', 0):.0f}s **")
    print(" | ".join(parts), flush=True)
