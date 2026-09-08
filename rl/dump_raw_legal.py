"""Reference traces using RAW legality (safe=0) — the rules, without the AI's blunder filter."""
import json, sys, numpy as np, rx
rx.configure(10, 6)
rng = np.random.default_rng(23)
games = []
for g in range(8):
    G = rx.Game(); moves=[]; steps=[]
    while not G.terminal and len(moves) < 400:
        raw, nraw = G.legal(0)
        legal = np.nonzero(raw)[0].tolist()
        if not legal: break
        steps.append({"raw": legal})
        c = int(rng.choice(legal)); moves.append(c); G.step(c)
    games.append({"moves": moves, "steps": steps, "winner": int(G.winner)})
json.dump(games, open(sys.argv[1], "w"))
print(f"{len(games)} games, {sum(len(x['steps']) for x in games)} positions")
