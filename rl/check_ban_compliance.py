"""Every scripted agent must respect the ban: no move it returns may be forbidden."""
import numpy as np, rx, baselines as B
rx.configure(10, 6)
rng = rx._Rng(4242)
bad_g = bad_r = moves_g = moves_r = 0
for g in range(400):
    for name in ("greedy", "random"):
        G = rx.Game()
        r = rx._Rng(g * 7919 + (1 if name == "greedy" else 2))
        while not G.terminal:
            playable = set(np.nonzero(G.legal(0)[0])[0].tolist())   # rules legality incl. ban
            cells = rx.greedy_turn(G, 0.1, r) if name == "greedy" else [rx.random_move(G, r)]
            cells = [c for c in cells if c is not None and c >= 0]
            if not cells: break
            for c in cells:
                if G.terminal: break
                legal_now = set(np.nonzero(G.legal(0)[0])[0].tolist())
                if c not in legal_now:
                    if name == "greedy": bad_g += 1
                    else: bad_r += 1
                    if bad_g + bad_r <= 3:
                        print(f"  {name} played a forbidden/illegal cell {c} (game {g})")
                if name == "greedy": moves_g += 1
                else: moves_r += 1
                G.step(int(c))
print(f"greedy: {moves_g} moves, {bad_g} illegal")
print(f"random: {moves_r} moves, {bad_r} illegal")
print("PASS — both baselines respect the ban" if bad_g + bad_r == 0 else "FAIL")
