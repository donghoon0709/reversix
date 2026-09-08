"""High-volume invariant check: a running game must always have a legal placement."""
import numpy as np, rx
rx.configure(10, 6)
rng = np.random.default_rng(1)
bad = 0; games = 4000; plies = 0; res = {0:0,1:0,2:0}; turns = 0
for g in range(games):
    G = rx.Game()
    while not G.terminal:
        m, c = G.legal(1)
        idx = np.nonzero(m)[0]
        if len(idx) == 0:
            bad += 1
            print(f"INVARIANT BROKEN g={g} placed={G.st.placed} checked={G.st.checked} first={G.st.first}")
            break
        if c != len(idx): bad += 1; print("count mismatch")
        G.step(int(rng.choice(idx))); plies += 1
    res[G.winner] += 1; turns += G.st.turn
print(f"games={games} plies={plies} invariant violations={bad}")
print(f"outcomes B={res[1]} W={res[2]} D={res[0]}  black%={res[1]/(res[1]+res[2])*100:.1f}  avg turns={turns/games:.1f}")
