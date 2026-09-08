import numpy as np, rx
rx.configure(10, 6)
# find a position where the greedy opponent is checked and cannot defend
rng = np.random.default_rng(3)
for g in range(400):
    G = rx.Game(); r = rx._Rng(g * 7919 + 1)
    for _ in range(400):
        if G.terminal: break
        if G.st.checked:
            cells = rx.greedy_turn(G, 0.1, r)
            if not cells:
                m, c = G.legal(1)
                print(f"REPRO: greedy_turn returned {cells} while game is NOT terminal")
                print(f"  checked={G.st.checked} placed={G.st.placed} player={G.st.player} "
                      f"legal placements available={c}")
                print("  -> _opponent_turn loops forever here (no state change, 100% CPU)")
                raise SystemExit
        m, c = G.legal(1)
        idx = np.nonzero(m)[0]
        if len(idx) == 0: break
        G.step(int(rng.choice(idx)))
print("no repro in 400 games")
