"""Cross-check librxenv against an independent pure-Python reimplementation of the rules."""
import numpy as np, random, rx

N, K = 10, 6
CELLS, PLANES = rx.configure(N, K)
DIRS = [(-1,-1),(-1,0),(-1,1),(0,-1),(0,1),(1,-1),(1,0),(1,1)]
AXES = [(0,1),(1,0),(1,1),(1,-1)]
inside = lambda r,c: 0 <= r < N and 0 <= c < N
idx = lambda r,c: r*N+c

def flips(b, p, s):
    r, c = divmod(s, N); o = 3-p; out = []
    for dr, dc in DIRS:
        rr, cc, run = r+dr, c+dc, []
        while inside(rr,cc) and b[idx(rr,cc)] == o:
            run.append(idx(rr,cc)); rr += dr; cc += dc
        if run and inside(rr,cc) and b[idx(rr,cc)] == p:
            out += run
    return out

def forbidden(b, s1, s2, p):
    return False        # rule removed from the game

def has_line(b, p):
    for dr, dc in AXES:
        for r in range(N):
            for c in range(N):
                if not inside(r+dr*(K-1), c+dc*(K-1)): continue
                if all(b[idx(r+dr*i, c+dc*i)] == p for i in range(K)): return True
    return False

def any_turn(b, p, need):
    for s1 in range(CELLS):
        if b[s1]: continue
        f1 = flips(b, p, s1)
        if not f1: continue
        if need == 1: return True
        b2 = list(b); b2[s1] = p
        for x in f1: b2[x] = p
        for s2 in range(CELLS):
            if b2[s2] or forbidden(b2, s1, s2, p): continue
            if flips(b2, p, s2): return True
    return False

def ref_legal(b, p, checked, placed, first, opening, safe, need):
    o = 3-p; must = checked and safe; out = set()
    if placed == 1:
        for s2 in range(CELLS):
            if b[s2] or forbidden(b, first, s2, p): continue
            f = flips(b, p, s2)
            if not f: continue
            if must:
                b2 = list(b); b2[s2] = p
                for x in f: b2[x] = p
                if has_line(b2, o): continue
            out.add(s2)
    else:
        # Defined from the rules: a first stone is legal iff there is a COMPLETE legal
        # turn starting with it (and, under check, one that clears every opponent line).
        for s1 in range(CELLS):
            if b[s1]: continue
            f1 = flips(b, p, s1)
            if not f1: continue
            b2 = list(b); b2[s1] = p
            for x in f1: b2[x] = p
            if need == 1:
                ok = (not has_line(b2, o)) if must else True
            else:
                ok = False
                for s2 in range(CELLS):
                    if b2[s2] or forbidden(b2, s1, s2, p): continue
                    f2 = flips(b2, p, s2)
                    if not f2: continue
                    if not must: ok = True; break
                    b3 = list(b2); b3[s2] = p
                    for x in f2: b3[x] = p
                    if not has_line(b3, o): ok = True; break
            if ok: out.add(s1)
    if not out and must:
        return ref_legal(b, p, checked, placed, first, opening, False, need)
    return out

rng = random.Random(20260907)
games = 0; positions = 0; mism = 0
results = {"B":0,"W":0,"D":0}; turns_total = 0
for g in range(250):
    G = rx.Game(); games += 1
    guard = 0
    while not G.terminal:
        st = G.st
        b = list(np.frombuffer(bytes(st.board), dtype=np.int8, count=CELLS))
        b = [int(x) for x in b]
        for safe in (1, 0):
            mask, cnt = G.legal(safe)
            cset = set(np.nonzero(mask)[0].tolist())
            rset = ref_legal(b, st.player, bool(st.checked), st.placed, st.first, bool(st.opening), bool(safe), st.need)
            if cset != rset:
                mism += 1
                print(f"MISMATCH game{g} safe={safe} C-only={sorted(cset-rset)} ref-only={sorted(rset-cset)}")
            if safe == 1 and cnt != len(cset):
                mism += 1; print("count mismatch")
        positions += 1
        mask, cnt = G.legal(1)
        choices = np.nonzero(mask)[0]
        if len(choices) == 0:      # INVARIANT: a running game always has a legal move
            print(f"INVARIANT BROKEN game{g}: no legal move but not terminal "
                  f"(placed={st.placed} checked={st.checked})"); mism += 1; break
        G.step(int(rng.choice(choices.tolist())))
        guard += 1
        if guard > 500: break
    w = G.winner
    results["B" if w == 1 else "W" if w == 2 else "D"] += 1
    turns_total += G.st.turn

print(f"\ngames={games} positions checked={positions} mismatches={mism}")
print(f"outcomes {results}  avg turns={turns_total/games:.1f}")
