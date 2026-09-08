"""Record positions + encodings from the training env so the JS side can be compared."""
import json, sys, numpy as np, rx
rx.configure(10, 6)
rng = np.random.default_rng(11)
games = []
for g in range(6):
    G = rx.Game(); moves = []; steps = []
    while not G.terminal and len(moves) < 400:
        mask, n = G.legal(1)
        legal = np.nonzero(mask)[0].tolist()
        if not legal: break
        steps.append({"legal": legal, "planes": G.encode(1).ravel().tolist(),
                      "need": int(G.st.need), "placed": int(G.st.placed),
                      "checked": int(G.st.checked), "player": int(G.st.player)})
        c = int(rng.choice(legal)); moves.append(c); G.step(c)
    games.append({"moves": moves, "steps": steps, "winner": int(G.winner)})
json.dump(games, open(sys.argv[1], "w"))
print(f"{len(games)} games, {sum(len(x['steps']) for x in games)} positions")
