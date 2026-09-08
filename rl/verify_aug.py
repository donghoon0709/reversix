"""Check that the rules really are D4-invariant, i.e. that 8-fold augmentation is exact."""
import numpy as np, ctypes, rx, random
N, K = 10, 6
rx.configure(N, K)

def transform_board(b, k, flip):
    a = np.rot90(b.reshape(N, N), k)
    if flip: a = a[:, ::-1]
    return np.ascontiguousarray(a).reshape(-1)

def transform_idx(i, k, flip):
    grid = np.arange(N * N).reshape(N, N)
    a = np.rot90(grid, k)
    if flip: a = a[:, ::-1]
    return int(np.nonzero(np.ascontiguousarray(a).reshape(-1) == i)[0][0])

def set_state(g, board, turn_start, player, checked, placed, first, turn):
    """turn_start is the ban baseline and must be transformed alongside the board."""
    for i in range(N * N):
        g.st.board[i] = int(board[i])
        g.st.turnStart[i] = int(turn_start[i])
    g.st.player, g.st.checkBy, g.st.placed = player, checked, placed
    g.st.first, g.st.turnNumber, g.st.terminal = first, turn, 0
    return g

rng = random.Random(7)
bad = 0; checked_positions = 0
for trial in range(400):
    g = rx.Game()
    for _ in range(rng.randint(0, 60)):
        if g.terminal: break
        m, c = g.legal(1)
        if c == 0: break
        g.step(int(rng.choice(np.nonzero(m)[0].tolist())))
    if g.terminal: continue
    b0 = np.frombuffer(bytes(g.st.board), dtype=np.int8, count=N*N).copy()
    t0b = np.frombuffer(bytes(g.st.turnStart), dtype=np.int8, count=N*N).copy()
    st0 = (g.st.player, g.st.checkBy, g.st.placed, g.st.first, g.st.turnNumber)
    m0, _ = g.legal(1)
    base = set(np.nonzero(m0)[0].tolist())
    checked_positions += 1
    for k in range(4):
        for flip in (0, 1):
            b1 = transform_board(b0, k, flip)
            t1 = transform_board(t0b, k, flip)
            f1 = transform_idx(st0[3], k, flip) if st0[3] >= 0 else -1
            g2 = set_state(rx.Game(), b1, t1, st0[0], st0[1], st0[2], f1, st0[4])
            m1, _ = g2.legal(1)
            got = set(np.nonzero(m1)[0].tolist())
            want = {transform_idx(i, k, flip) for i in base}
            if got != want:
                bad += 1
                if bad <= 3:
                    print(f"MISMATCH trial={trial} k={k} flip={flip} extra={sorted(got-want)} missing={sorted(want-got)}")
print(f"positions={checked_positions}  transforms checked={checked_positions*8}  mismatches={bad}")
