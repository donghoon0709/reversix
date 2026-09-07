import { describe, expect, it } from 'vitest';
import { BOARD_SIZE, BLACK, WHITE, createInitialGame, requiredPlacements, applyPlacement, isForbiddenSecondPlacement, getLegalSecondPlacements, hasLegalFullTurn, findWinningLines, reduceGame } from './rules.js';
const N = BOARD_SIZE * BOARD_SIZE;
const cell = (r, c) => r * BOARD_SIZE + c;
const boardWith = (entries = []) => { const b = Array(N).fill(null); for (const [r, c, p] of entries) b[cell(r, c)] = p; return b; };
const stateFor = (board, activePlayer = BLACK, opening = false, checkedPlayer = null) => ({ board: board.slice(), activePlayer, checkedPlayer, turnStart: { board: board.slice(), activePlayer, checkedPlayer, opening }, provisional: { placements: [], effects: [], board: board.slice() }, recentEffects: [], announcement: '', terminal: null });
const place = (s, ...cells) => cells.reduce((x, c) => reduceGame(x, { type: 'PLACE', cell: c }), s);

describe('pure placement engine', () => {
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
});

describe('second-placement geometry', () => {
  it('forbids opponent-only interiors of length 4, 5, and 3 is allowed', () => {
    for (const len of [3, 4, 5]) { const b = boardWith(Array.from({ length: len }, (_, i) => [5, 1 + i, WHITE])); const forbidden = isForbiddenSecondPlacement(b, cell(5, 0), cell(5, len + 1), BLACK); expect(forbidden).toBe(len >= 4); }
  });
  it('allows gaps, friendly interiors, nonaligned and reversed order', () => {
    const b = boardWith([[5, 1, WHITE], [5, 2, BLACK], [5, 3, WHITE], [5, 4, WHITE]]);
    expect(isForbiddenSecondPlacement(b, cell(5, 0), cell(5, 5), BLACK)).toBe(false);
    expect(isForbiddenSecondPlacement(b, cell(5, 0), cell(6, 2), BLACK)).toBe(false);
    const rev = boardWith([[5, 1, WHITE], [5, 2, WHITE], [5, 3, WHITE], [5, 4, WHITE], [5, 5, BLACK]]);
    expect(isForbiddenSecondPlacement(rev, cell(5, 5), cell(5, 0), BLACK)).toBe(true);
  });
  it('enumerates only legal empty second placements', () => { const b = boardWith([[5, 1, WHITE], [5, 2, WHITE], [5, 3, WHITE], [5, 4, WHITE]]); expect(getLegalSecondPlacements(b, cell(5, 0), BLACK)).not.toContain(cell(5, 5)); });
});

describe('turn counts and reducer guards', () => {
  it('uses one placement on first turn, two normally, and one at final empty cell', () => { const g = createInitialGame(); expect(requiredPlacements(g.turnStart)).toBe(1); const b = Array(N).fill(BLACK); b[N - 1] = null; expect(requiredPlacements({ board: b, opening: false })).toBe(1); const c = b.slice(); c[N - 2] = null; expect(requiredPlacements({ board: c, opening: false })).toBe(2); });
  it('resets provisional placements including flips', () => { const s = stateFor(boardWith([[7, 6, WHITE], [7, 5, BLACK]]), BLACK, true); const p = place(s, cell(7, 7)); expect(p.board[cell(7, 6)]).toBe(BLACK); const r = reduceGame(p, { type: 'RESET_TURN' }); expect(r.board).toEqual(s.board); expect(r.provisional.placements).toEqual([]); });
  it('guards incomplete and excess actions', () => { let s = place(createInitialGame(), 0); const c = reduceGame(s, { type: 'COMMIT_TURN' }); expect(c.activePlayer).toBe(WHITE); s = reduceGame(s, { type: 'PLACE', cell: 1 }); expect(s.provisional.placements).toEqual([0]); });
  it('does not mutate terminal states', () => { const s = { ...createInitialGame(), terminal: { winner: BLACK, reason: 'DRAW' } }; expect(reduceGame(s, { type: 'PLACE', cell: 0 })).toBe(s); });
});

describe('lines, checks, and terminal resolution', () => {
  it('finds six-line wins on horizontal, vertical, and both diagonals', () => { for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) { const b = Array(N).fill(null); for (let i = 0; i < 6; i++) b[cell(7 + dr * i, 7 + dc * i)] = BLACK; expect(findWinningLines(b, BLACK).length).toBe(1); } });
  it('detects legal full turns and no legal turn', () => { const b = Array(N).fill(BLACK); b[N - 1] = null; expect(hasLegalFullTurn({ board: b, activePlayer: WHITE, opening: false })).toBe(true); expect(hasLegalFullTurn({ board: Array(N).fill(BLACK), activePlayer: WHITE, opening: false })).toBe(false); });
  it('resolves checked defense failure, successful defense, and counter-check', () => {
    const line = Array.from({ length: 6 }, (_, i) => [2, i, WHITE]);
    const fail = stateFor(boardWith(line), BLACK, true, BLACK); const failed = reduceGame(place(fail, cell(5, 5)), { type: 'COMMIT_TURN' }); expect(failed.terminal.reason).toBe('DEFENSE_FAILED');
    const ok = stateFor(boardWith([[7, 6, WHITE], [7, 5, BLACK]]), BLACK, true, BLACK); const defended = reduceGame(place(ok, cell(7, 7)), { type: 'COMMIT_TURN' }); expect(defended.checkedPlayer).toBe(null);
    const counter = stateFor(boardWith([[2, 0, BLACK], [2, 1, BLACK], [2, 2, BLACK], [2, 3, BLACK], [2, 4, BLACK], [2, 5, BLACK]]), BLACK, true, BLACK); const checked = reduceGame(place(counter, cell(4, 4)), { type: 'COMMIT_TURN' }); expect(checked.checkedPlayer).toBe(WHITE);
  });
  it('reports draw/no-legal-turn, final-cell precedence, and keeps provisional dead-end resettable', () => {
    const full = Array(N).fill(BLACK); full[N - 1] = null; const one = stateFor(full, WHITE, false); const draw = reduceGame(place(one, N - 1), { type: 'COMMIT_TURN' }); expect(draw.terminal).toEqual({ winner: null, reason: 'DRAW' });
    const dead = stateFor(Array(N).fill(BLACK), BLACK, false); dead.board[N - 1] = null; dead.turnStart.board[N - 1] = null; dead.provisional.board[N - 1] = null; const p = place(dead, N - 1); expect(reduceGame(p, { type: 'RESET_TURN' }).terminal).toBe(null);
  });
});
