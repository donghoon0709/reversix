"""Cross-check librxenv against traces from the JS engine, which is itself verified
move-for-move against the reference implementation."""
import json, sys
import numpy as np
import rx

rx.configure(10, 6)
games = json.load(open(sys.argv[1] if len(sys.argv) > 1 else "/tmp/js_traces2.json"))

pos = bad_legal = bad_meta = bad_winner = 0
for gi, g in enumerate(games):
    G = rx.Game()
    for i, t in enumerate(g["trace"]):
        st = G.st
        mask, cnt = G.legal(0)
        legal = np.nonzero(mask)[0].tolist()
        if legal != t["legal"]:
            bad_legal += 1
            if bad_legal <= 3: print(f"legal g{gi} #{i}: C={legal} JS={t['legal']}")
        meta = (st.player, st.placed, st.checkBy, st.turnNumber)
        want = (t["player"], t["placed"], t["checkBy"], t["turn"])
        if meta != want:
            bad_meta += 1
            if bad_meta <= 3: print(f"meta g{gi} #{i}: C={meta} JS={want}")
        pos += 1
        G.step(g["moves"][i])
    w = G.winner if G.terminal else -1
    if w != g["winner"]:
        bad_winner += 1
        print(f"winner g{gi}: C={w} JS={g['winner']}")

print(f"\ngames={len(games)} positions={pos}  legal={bad_legal} meta={bad_meta} winner={bad_winner}")
print("PASS — C environment matches the JS engine" if bad_legal + bad_meta + bad_winner == 0 else "FAIL")
