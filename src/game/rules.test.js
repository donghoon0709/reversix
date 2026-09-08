import { describe, expect, it } from 'vitest';
import { BOARD_SIZE, BLACK, WHITE, createInitialGame, requiredPlacements, applyPlacement, getLegalPlacements, hasLegalFullTurn, findWinningLines, reduceGame } from './rules.js';
const N = BOARD_SIZE * BOARD_SIZE;
const cell = (r, c) => r * BOARD_SIZE + c;
const boardWith = (entries = []) => { const b = Array(N).fill(null); for (const [r, c, p] of entries) b[cell(r, c)] = p; return b; };
const stateFor = (board, activePlayer = BLACK, opening = false, checkedPlayer = null) => ({ board: board.slice(), activePlayer, checkedPlayer, turnStart: { board: board.slice(), activePlayer, checkedPlayer, opening }, provisional: { placements: [], effects: [], board: board.slice() }, recentEffects: [], announcement: '', terminal: null });
const place = (s, ...cells) => cells.reduce((x, c) => reduceGame(x, { type: 'PLACE', cell: c }), s);

describe('pure placement engine', () => {
  it('starts with four center stones and black legal placements', () => {
    const game = createInitialGame();
    expect(game.board[cell(4, 4)]).toBe(BLACK);
    expect(game.board[cell(4, 5)]).toBe(WHITE);
    expect(game.board[cell(5, 4)]).toBe(WHITE);
    expect(game.board[cell(5, 5)]).toBe(BLACK);
    expect(getLegalPlacements(game.board, BLACK)).toEqual([cell(3, 5), cell(4, 6), cell(5, 3), cell(6, 4)]);
  });
  it('flips bracketed runs in all eight directions and records each once', () => {
    const dirs = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
    for (const [dr, dc] of dirs) {
      const b = Array(N).fill(null), target = cell(7, 7);
      b[cell(7 + dr, 7 + dc)] = WHITE; b[cell(7 + 2 * dr, 7 + 2 * dc)] = BLACK;
      const r = applyPlacement(b, BLACK, target);
      expect(r.ok).toBe(true); expect(r.effect.flips).toEqual([cell(7 + dr, 7 + dc)]);
    }
  });
  it('flips multiple directions without chaining through newly flipped stones', () => {
    const b = boardWith([[7, 6, WHITE], [7, 5, WHITE], [7, 4, BLACK], [6, 7, WHITE], [5, 7, BLACK]]);
    const r = applyPlacement(b, BLACK, cell(7, 7));
    expect(r.effect.flips.sort()).toEqual([cell(7, 6), cell(7, 5), cell(6, 7)].sort());
    expect(r.board[cell(7, 5)]).toBe(BLACK);
  });
  it('rejects occupied and invalid cells atomically', () => { const b = boardWith([[2, 2, BLACK]]); for (const c of [cell(2, 2), -1, N]) { const r = applyPlacement(b, WHITE, c); expect(r.ok).toBe(false); expect(b[cell(2, 2)]).toBe(BLACK); } });
  it('rejects an empty cell that does not flip an opposing stone', () => {
    const b = boardWith([[7, 7, BLACK]]);
    const r = applyPlacement(b, WHITE, cell(7, 8));
    expect(r).toEqual({ ok: false, reason: 'NO_FLIPS' });
    expect(b[cell(7, 8)]).toBeNull();
  });
});

describe('second placement is unrestricted', () => {
  it('lets a turn bracket a long opposing run, making six in one turn', () => {
    // W W W W in a row, plus a vertical anchor so the first stone is itself legal.
    // Under the old rule this exact pair was the banned "pincer".
    const b = boardWith([[5, 1, WHITE], [5, 2, WHITE], [5, 3, WHITE], [5, 4, WHITE],
                         [4, 0, WHITE], [3, 0, BLACK]]);
    const first = reduceGame(stateFor(b, BLACK, false), { type: 'PLACE', cell: cell(5, 0) });
    expect(first.announcement).toBe('');
    expect(getLegalPlacements(first.provisional.board, BLACK)).toContain(cell(5, 5));
    const second = reduceGame(first, { type: 'PLACE', cell: cell(5, 5) });
    expect(second.announcement).toBe('');
    expect(second.provisional.placements).toEqual([cell(5, 0), cell(5, 5)]);
    for (let c = 0; c <= 5; c += 1) expect(second.board[cell(5, c)]).toBe(BLACK);
    expect(findWinningLines(second.board, BLACK)).toHaveLength(1);
  });
  it('still requires every placement to flip at least one opposing stone', () => {
    const b = boardWith([[5, 1, WHITE], [5, 2, WHITE], [5, 3, WHITE], [5, 4, WHITE],
                         [4, 0, WHITE], [3, 0, BLACK]]);
    const first = reduceGame(stateFor(b, BLACK, false), { type: 'PLACE', cell: cell(5, 0) });
    expect(getLegalPlacements(first.provisional.board, BLACK)).not.toContain(cell(9, 9));
  });
});

describe('turn counts and reducer guards', () => {
  it('uses one placement on black opening, two normally, and one at the final empty cell', () => {
    const g = createInitialGame();
    expect(requiredPlacements(g.turnStart)).toBe(1);
    const afterOpening = reduceGame(place(g, cell(3, 5)), { type: 'COMMIT_TURN' });
    expect(afterOpening.activePlayer).toBe(WHITE);
    expect(requiredPlacements(afterOpening.turnStart)).toBe(2);
    const b = Array(N).fill(BLACK); b[N - 1] = null;
    expect(requiredPlacements({ board: b, opening: false })).toBe(1);
    const c = b.slice(); c[N - 2] = null;
    expect(requiredPlacements({ board: c, opening: false })).toBe(2);
  });
  it('resets provisional placements including flips', () => { const s = stateFor(boardWith([[7, 6, WHITE], [7, 5, BLACK]]), BLACK, true); const p = place(s, cell(7, 7)); expect(p.board[cell(7, 6)]).toBe(BLACK); const r = reduceGame(p, { type: 'RESET_TURN' }); expect(r.board).toEqual(s.board); expect(r.provisional.placements).toEqual([]); });
  it('undoes only the latest provisional placement and restores its flips', () => {
    let state = reduceGame(place(createInitialGame(), cell(3, 5)), { type: 'COMMIT_TURN' });
    const first = getLegalPlacements(state.board, WHITE)[0];
    const afterFirst = place(state, first);
    const second = getLegalPlacements(afterFirst.board, WHITE)[0];
    const afterSecond = place(afterFirst, second);

    expect(reduceGame(afterSecond, { type: 'UNDO_PLACEMENT', cell: first })).toBe(afterSecond);
    const undone = reduceGame(afterSecond, { type: 'UNDO_PLACEMENT', cell: second });
    expect(undone.provisional.placements).toEqual([first]);
    expect(undone.provisional.effects).toEqual(afterFirst.provisional.effects);
    expect(undone.board).toEqual(afterFirst.board);
  });
  it('guards incomplete, illegal, and excess actions', () => {
    const first = cell(3, 5), illegal = cell(0, 0);
    let s = place(createInitialGame(), illegal);
    expect(s.announcement).toBe('NO_FLIPS');
    s = reduceGame(place(s, first), { type: 'COMMIT_TURN' });
    expect(s.activePlayer).toBe(WHITE);
    const whiteFirst = getLegalPlacements(s.board, WHITE)[0];
    s = place(s, whiteFirst);
    const incomplete = reduceGame(s, { type: 'COMMIT_TURN' });
    expect(incomplete.announcement).toBe('Incomplete turn');
    const whiteSecond = getLegalPlacements(s.provisional.board, WHITE)[0];
    s = reduceGame(s, { type: 'PLACE', cell: whiteSecond });
    expect(s.provisional.placements).toHaveLength(2);
    expect(reduceGame(s, { type: 'PLACE', cell: cell(0, 0) })).toBe(s);
  });
  it('does not mutate terminal states', () => { const s = { ...createInitialGame(), terminal: { winner: BLACK, reason: 'DRAW' } }; expect(reduceGame(s, { type: 'PLACE', cell: 0 })).toBe(s); });
});

describe('lines, checks, and terminal resolution', () => {
  it('finds six-line wins on horizontal, vertical, and both diagonals', () => {
    for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
      const r0 = 2, c0 = dc < 0 ? BOARD_SIZE - 3 : 2;   // keep all six stones on the board
      const b = Array(N).fill(null);
      for (let i = 0; i < 6; i++) b[cell(r0 + dr * i, c0 + dc * i)] = BLACK;
      expect(findWinningLines(b, BLACK).length).toBe(1);
    }
  });
  it('detects legal full turns and no legal turn', () => {
    expect(hasLegalFullTurn(createInitialGame().turnStart)).toBe(true);
    const b = Array(N).fill(BLACK); b[N - 1] = null;
    expect(hasLegalFullTurn({ board: b, activePlayer: WHITE, opening: false })).toBe(false);
  });
  it('resolves checked defense failure, successful defense, and counter-check', () => {
    const line = Array.from({ length: 6 }, (_, i) => [2, i, WHITE]);
    const fail = stateFor(boardWith([...line, [5, 3, BLACK], [5, 4, WHITE]]), BLACK, true, BLACK); const failed = reduceGame(place(fail, cell(5, 5)), { type: 'COMMIT_TURN' }); expect(failed.terminal.reason).toBe('DEFENSE_FAILED');
    const ok = stateFor(boardWith([[7, 6, WHITE], [7, 5, BLACK]]), BLACK, true, BLACK); const defended = reduceGame(place(ok, cell(7, 7)), { type: 'COMMIT_TURN' }); expect(defended.checkedPlayer).toBe(null);
    const counter = stateFor(boardWith([[2, 0, BLACK], [2, 1, BLACK], [2, 2, BLACK], [2, 3, BLACK], [2, 4, BLACK], [2, 5, BLACK], [4, 2, BLACK], [4, 3, WHITE]]), BLACK, true, BLACK); const checked = reduceGame(place(counter, cell(4, 4)), { type: 'COMMIT_TURN' }); expect(checked.checkedPlayer).toBe(WHITE);
  });
  it('reports no-legal-turn and keeps provisional dead-end resettable', () => {
    const b = Array(N).fill(BLACK); b[cell(7, 7)] = null; b[cell(7, 8)] = WHITE;
    const one = stateFor(b, BLACK, true); const finished = reduceGame(place(one, cell(7, 7)), { type: 'COMMIT_TURN' });
    expect(finished.terminal).toEqual({ winner: BLACK, reason: 'NO_LEGAL_TURN' });
    const dead = stateFor(Array(N).fill(BLACK), BLACK, false); dead.board[N - 1] = null; dead.turnStart.board[N - 1] = null; dead.provisional.board[N - 1] = null; const p = place(dead, N - 1); expect(reduceGame(p, { type: 'RESET_TURN' }).terminal).toBe(null);
  });
});
