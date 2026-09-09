"""Round-robin between candidate checkpoints only, to pick the strongest one.

The greedy/random baselines are useless here — every late checkpoint beats them — and the
per-iteration swing in this run was far larger than the measurement error, so the choice
has to come from the checkpoints playing each other.
"""
import itertools, sys
import numpy as np, torch

import rx, net as netmod
from ladder import NetPlayer, match, bradley_terry


def load(path, dev):
    ck = torch.load(path, map_location="cpu")
    a = ck["args"]
    nn = netmod.Net(planes=rx.PLANES, ch=a["ch"], blocks=a["blocks"]).to(dev)
    nn.load_state_dict(ck["net"]); nn.eval()
    return NetPlayer(f"iter{ck['iter']:02d}", nn, a["sims"], a["m"])


def main():
    rx.configure(10, 6)
    dev = netmod.pick_device()
    args = sys.argv[1:]
    games = int(args[-1]) if args and args[-1].isdigit() else 30
    paths = [a for a in args if a.endswith(".pt")]
    players = [load(p, dev) for p in paths]

    n = len(players)
    wins = [[0] * n for _ in range(n)]
    draws = [[0] * n for _ in range(n)]
    print(f"round-robin: {n} checkpoints, {games} games per colour per pair "
          f"({n*(n-1)//2*games*2} games)\n", flush=True)
    for i, j in itertools.combinations(range(n), 2):
        for a_plays in (1, 2):
            r = match(players[i], players[j], dev, games, a_plays, seed=i*977 + j*31 + a_plays)
            wins[i][j] += r[a_plays]; wins[j][i] += r[3 - a_plays]
            draws[i][j] += r[0]; draws[j][i] += r[0]
        tot = wins[i][j] + wins[j][i] + draws[i][j]
        print(f"  {players[i].name} vs {players[j].name}  "
              f"{wins[i][j]:3d}-{wins[j][i]:3d}-{draws[i][j]:2d}   "
              f"score {(wins[i][j] + 0.5*draws[i][j]) / tot:.3f}", flush=True)

    elo = bradley_terry(wins, draws, anchor=0)
    played = [sum(wins[k]) + sum(draws[k]) + sum(wins[r][k] for r in range(n) if r != k) for k in range(n)]
    total = [(sum(wins[k]) + 0.5 * sum(draws[k])) for k in range(n)]
    order = np.argsort(-elo)
    print(f"\n{'checkpoint':>10} {'Elo':>6} {'전체승률':>9}   (기준 {players[0].name})")
    for k in order:
        n_games = sum(wins[k][r] + wins[r][k] + draws[k][r] for r in range(n) if r != k)
        print(f"{players[k].name:>10} {elo[k]-elo[order[-1]]:6.0f} {total[k]/n_games*100:8.1f}%")
    print(f"\n가장 강한 체크포인트: {players[order[0]].name}")


if __name__ == "__main__":
    main()
