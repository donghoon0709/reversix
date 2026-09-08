"""Dump encodings + safe masks from the C training env for the JS side to match."""
import json, numpy as np, rx
rx.configure(10, 6)
rng = np.random.default_rng(31337)
games = []
for g in range(8):
    G = rx.Game(); moves=[]; steps=[]
    while not G.terminal and len(moves) < 400:
        m, n = G.legal(1)
        legal = np.nonzero(m)[0].tolist()
        if not legal: break
        steps.append({"safe": legal, "planes": G.encode(1).ravel().tolist()})
        c = int(rng.choice(legal)); moves.append(c); G.step(c)
    games.append({"moves": moves, "steps": steps})
json.dump(games, open("/tmp/enc_traces.json","w"))
print(f"{len(games)} games, {sum(len(x['steps']) for x in games)} positions")
