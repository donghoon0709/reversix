import { describe, expect, it } from 'vitest';
import {
  BOARD_SIZE, BOARD_CELLS, SIX, BLACK, WHITE, createInitialGame, placementsNeeded, turnComplete,
  applyPlacement, getLegalPlacements, getSixLines, reduceGame, turnComplete as isTurnComplete,
  isForbiddenPlacement, getPlayablePlacements, playableFor, forbiddenFor, completesTurn,
} from './rules.js';

const cell = (r, c) => r * BOARD_SIZE + c;
const boardWith = (entries = []) => { const b = Array(BOARD_CELLS).fill(null); for (const [r, c, p] of entries) b[cell(r, c)] = p; return b; };
const fill = (b, cells, p = BLACK) => { for (const i of cells) b[i] = p; return b; };
const stateFor = (board, activePlayer = BLACK, turnNumber = 1, checkedPlayer = null) => ({
  board: board.slice(), activePlayer, checkedPlayer, turnNumber, consecutivePasses: 0,
  turnStart: { board: board.slice(), activePlayer, checkedPlayer, turnNumber },
  provisional: { placements: [], effects: [], board: board.slice() },
  recentEffects: [], announcement: '', terminal: null, events: [],
});
const place = (s, ...cells) => cells.reduce((x, c) => reduceGame(x, { type: 'PLACE', cell: c }), s);
const commit = s => reduceGame(s, { type: 'COMMIT_TURN' });

describe('board and placement', () => {
  it('starts with white on the main diagonal of the centre block', () => {
    const g = createInitialGame();
    expect([g.board[44], g.board[55]]).toEqual([WHITE, WHITE]);
    expect([g.board[45], g.board[54]]).toEqual([BLACK, BLACK]);
    expect(getLegalPlacements(g.board, BLACK)).toEqual([34, 43, 56, 65]);
  });
  it('flips bracketed runs in all eight directions', () => {
    for (const [dr, dc] of [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]]) {
      const b = Array(BOARD_CELLS).fill(null);
      b[cell(4 + dr, 4 + dc)] = WHITE; b[cell(4 + 2 * dr, 4 + 2 * dc)] = BLACK;
      const r = applyPlacement(b, BLACK, cell(4, 4));
      expect(r.ok).toBe(true);
      expect(r.effect.flips).toEqual([cell(4 + dr, 4 + dc)]);
    }
  });
  it('rejects occupied cells and cells that flip nothing', () => {
    const b = boardWith([[2, 2, BLACK]]);
    expect(applyPlacement(b, WHITE, cell(2, 2)).reason).toBe('OCCUPIED');
    expect(applyPlacement(b, WHITE, cell(7, 7)).reason).toBe('NO_FLIPS');
  });
  it('does not chain through stones flipped by the same placement', () => {
    const b = boardWith([[4, 3, WHITE], [4, 2, WHITE], [4, 1, BLACK], [3, 4, WHITE], [2, 4, BLACK]]);
    const r = applyPlacement(b, BLACK, cell(4, 4));
    expect(r.effect.flips.sort()).toEqual([cell(4, 3), cell(4, 2), cell(3, 4)].sort());
  });
});

describe('SIX is a maximal run of exactly six', () => {
  it('finds a six on every axis', () => {
    for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [-1, 1]]) {
      const r0 = dr < 0 ? 7 : 2, c0 = 2;
      const b = Array(BOARD_CELLS).fill(null);
      for (let i = 0; i < SIX; i++) b[cell(r0 + dr * i, c0 + dc * i)] = BLACK;
      expect(getSixLines(b, BLACK)).toHaveLength(1);
    }
  });
  it('does not count an overline of seven, and never splits it into windows', () => {
    const b = fill(Array(BOARD_CELLS).fill(null), [40, 41, 42, 43, 44, 45, 46]);
    expect(getSixLines(b, BLACK)).toHaveLength(0);
  });
  it('recognises a six created by flipping', () => {
    const b = Array(BOARD_CELLS).fill(null);
    b[40] = BLACK; fill(b, [41, 42, 43, 44], WHITE);
    expect(getSixLines(applyPlacement(b, BLACK, 45).board, BLACK)).toEqual([[40, 41, 42, 43, 44, 45]]);
  });
  it('keeps a six that coexists with an unrelated overline', () => {
    const b = fill(Array(BOARD_CELLS).fill(null), [0, 1, 2, 3, 4, 5, 6]);
    fill(b, [40, 41, 42, 43, 44, 45]);
    expect(getSixLines(b, BLACK)).toEqual([[40, 41, 42, 43, 44, 45]]);
  });
});

describe('turn structure', () => {
  it('uses one stone on the opening turn and two afterwards', () => {
    const g = createInitialGame();
    expect(placementsNeeded(g)).toBe(1);
    const after = commit(place(g, 34));
    expect(after.activePlayer).toBe(WHITE);
    expect(placementsNeeded(after)).toBe(2);
  });
  it('skips the second stone when nothing legal is left', () => {
    // black to move with a single white stone to take; after taking it, nothing remains
    const b = boardWith([[4, 4, WHITE], [4, 5, BLACK]]);
    const s = place(stateFor(b, BLACK), cell(4, 3));
    expect(getLegalPlacements(s.provisional.board, BLACK)).toHaveLength(0);
    expect(placementsNeeded(s)).toBe(1);
    expect(turnComplete(s)).toBe(true);
  });
  it('undoes only the latest provisional stone', () => {
    const g = commit(place(createInitialGame(), 34));
    const first = getLegalPlacements(g.provisional.board, WHITE)[0];
    const one = place(g, first);
    expect(reduceGame(one, { type: 'UNDO_PLACEMENT', cell: 999 })).toBe(one);
    const undone = reduceGame(one, { type: 'UNDO_PLACEMENT', cell: first });
    expect(undone.provisional.placements).toEqual([]);
    expect(undone.board).toEqual(g.board);
  });
});

describe('forbidden placements (may not hand the opponent a SIX)', () => {
  // white holds an overline of seven, which counts for nothing; shrinking it to exactly
  // six would create a real SIX for white
  const overlineBoard = () => {
    const b = Array(BOARD_CELLS).fill(null);
    for (let c = 2; c <= 8; c++) b[cell(4, c)] = WHITE;
    b[cell(2, 2)] = BLACK; b[cell(5, 2)] = BLACK;
    return b;
  };

  it('leaves the first of two stones alone when the turn can still finish cleanly', () => {
    const b = overlineBoard();
    expect(getSixLines(b, WHITE)).toHaveLength(0);
    const s = stateFor(b, BLACK);                 // a normal two-stone turn
    expect(completesTurn(s)).toBe(false);
    expect(forbiddenFor(s)).toEqual([]);
    // C4 gifts White a six on its own, yet stays playable: a second stone can undo it
    expect(playableFor(s)).toContain(cell(3, 2));
    const after = reduceGame(s, { type: 'PLACE', cell: cell(3, 2) });
    expect(after.announcement).toBe('');
    expect(after.provisional.placements).toEqual([cell(3, 2)]);
    expect(playableFor(after).length).toBeGreaterThan(0);
  });

  it('refuses a first stone from which no clean finish exists', () => {
    // white overline with only one black stone able to reach it, and nothing else on the
    // board to play a second stone with: the turn could only end having gifted a six
    const b = Array(BOARD_CELLS).fill(null);
    for (let c = 2; c <= 8; c++) b[cell(4, c)] = WHITE;
    b[cell(2, 2)] = BLACK; b[cell(5, 2)] = BLACK;
    const s = stateFor(b, BLACK);
    for (const first of getLegalPlacements(b, BLACK)) {
      const a = applyPlacement(b, BLACK, first);
      const seconds = getLegalPlacements(a.board, BLACK);
      const clean = seconds.length
        ? seconds.some(sec => {
            const c2 = applyPlacement(a.board, BLACK, sec);
            return c2.ok && getSixLines(c2.board, WHITE).length === 0;
          })
        : getSixLines(a.board, WHITE).length === 0;
      expect(playableFor(s).includes(first)).toBe(clean);
    }
  });

  it('bans a second stone that would leave the gift standing', () => {
    const s = reduceGame(stateFor(overlineBoard(), BLACK), { type: 'PLACE', cell: cell(3, 2) });
    expect(completesTurn(s)).toBe(true);
    // the first stone made White a six; any second stone that leaves it is banned
    for (const c of forbiddenFor(s)) {
      const a = applyPlacement(s.provisional.board, BLACK, c);
      expect(getSixLines(a.board, WHITE).length).toBeGreaterThan(0);
    }
    for (const c of playableFor(s)) {
      const a = applyPlacement(s.provisional.board, BLACK, c);
      expect(getSixLines(a.board, WHITE)).toHaveLength(0);
    }
  });

  it('bans a one-stone turn that gifts a six, since that stone ends the turn', () => {
    const s = stateFor(overlineBoard(), BLACK, 0);      // Black's opening: one stone
    expect(completesTurn(s)).toBe(true);
    expect(forbiddenFor(s)).toContain(cell(3, 2));
    expect(reduceGame(s, { type: 'PLACE', cell: cell(3, 2) }).announcement)
      .toBe('FORBIDDEN_GIVES_SIX');
  });

  it('does not ban breaking a six that was already there', () => {
    // white already has an exact six: black is obliged to break it, not banned from touching it
    const b = Array(BOARD_CELLS).fill(null);
    for (let c = 2; c <= 7; c++) b[cell(4, c)] = WHITE;
    b[cell(2, 2)] = BLACK; b[cell(5, 2)] = BLACK;
    expect(getSixLines(b, WHITE)).toHaveLength(1);
    const s = stateFor(b, BLACK, 3, BLACK);
    expect(forbiddenFor(s)).toEqual([]);
    expect(playableFor(s)).toContain(cell(3, 2));
  });

  it('leaves ordinary positions untouched', () => {
    const g = createInitialGame();
    expect(forbiddenFor(g)).toEqual([]);
    expect(playableFor(g)).toEqual(getLegalPlacements(g.board, BLACK));
  });
});

describe('passing when there is nothing to play', () => {
  // a board where neither colour can flip anything
  const deadBoard = () => {
    const b = Array(BOARD_CELLS).fill(null);
    b[0] = BLACK; b[1] = BLACK; b[cell(9, 9)] = WHITE;
    return b;
  };

  it('treats a turn with no playable cell as complete, and committing it passes', () => {
    const s = stateFor(deadBoard(), BLACK, 3);
    expect(getLegalPlacements(s.board, BLACK)).toEqual([]);
    expect(playableFor(s)).toEqual([]);
    expect(turnComplete(s)).toBe(true);          // so the UI can offer the pass
    const after = reduceGame(s, { type: 'COMMIT_TURN' });
    expect(after.events.some(e => e.endsWith('PASS'))).toBe(true);
  });

  it('ends on stone count once both sides have passed', () => {
    let s = stateFor(deadBoard(), BLACK, 3);
    s = reduceGame(s, { type: 'COMMIT_TURN' });   // black passes
    expect(s.terminal).toBe(null);               // one pass is not the end
    s = reduceGame(s, { type: 'COMMIT_TURN' });   // white cannot move either
    expect(s.terminal).toEqual({ winner: BLACK, reason: 'PASSES' });  // 2 black vs 1 white
  });
});

describe('a first stone that leads nowhere', () => {
  // White to move, checked, with exactly three legal cells — each of which shrinks a
  // black overline down to a six. Every turn from here is banned, so White must pass.
  const stuckState = () => {
    const moves = [56,66,53,52,43,33,62,34,77,57,23,63,58,72,35,12,74,65,42,22,81,32,67,
      24,76,64,2,1,71,68,61,51,69,78,80,46,21,36,14,5,26,48,27,15,87,47,16,18,3,91,50,25,
      59,75,13,38,70,39,31,49,41,40,28,11,84,73,85,60,94,95,0,20,90,98,9,30,92,88,4,83,93,
      37,82,7,99,79,86,97,17,6,10,8,96];
    let s = createInitialGame();
    for (const m of moves) {
      s = reduceGame(s, { type: 'PLACE', cell: m });
      if (turnComplete(s)) s = reduceGame(s, { type: 'COMMIT_TURN' });
    }
    return s;
  };

  it('offers the legal first stones so the player can see the trap, and passes', () => {
    const s = stuckState();
    expect(s.activePlayer).toBe(WHITE);
    expect(playableFor(s)).toEqual([19, 29, 89]);   // J2, J3, J9
    expect(forbiddenFor(s)).toEqual([]);            // no ban marks on the first stone
    expect(turnComplete(s)).toBe(true);             // with nothing placed, that is the pass
  });

  it('marks every second stone forbidden and refuses to commit the turn', () => {
    const s = place(stuckState(), 19);
    expect(playableFor(s)).toEqual([]);
    expect(forbiddenFor(s)).toEqual([29, 89]);      // the reason, spelled out on the board
    expect(turnComplete(s)).toBe(false);            // the dead end cannot be committed
    expect(reduceGame(s, { type: 'COMMIT_TURN' }).announcement).toBe('Incomplete turn');
    expect(turnComplete(reduceGame(s, { type: 'RESET_TURN' }))).toBe(true);
  });
});

describe('check, defence and passes', () => {
  // Move lists replayed through the engine, so the fixtures are real positions.
  const replay = moves => {
    let s = createInitialGame();
    for (const m of moves) {
      s = reduceGame(s, { type: 'PLACE', cell: m });
      if (turnComplete(s)) s = reduceGame(s, { type: 'COMMIT_TURN' });
    }
    return s;
  };
  const CHECK_LINE = [34,53,35,64,26,73,24,13,33,25,43,63,65,42,52,66,62,32,51,71,36,46,14,57,82,37,16];
  const LOSS_LINE = [...CHECK_LINE, 60,6,47,50,15,22,70,77,27,61,91,11];

  it('declares check when a turn ends with a six', () => {
    const s = replay(CHECK_LINE);
    expect(s.terminal).toBe(null);
    expect(s.checkedPlayer).toBe(BLACK);
    expect(getSixLines(s.board, WHITE)).toHaveLength(1);
  });

  it('loses when the opposing six survives the defending turn', () => {
    const s = replay(LOSS_LINE);
    expect(s.terminal).toEqual({ winner: BLACK, reason: 'DEFENSE_FAILED' });
  });

  it('releases the check when the six grows into an overline', () => {
    const b = Array(BOARD_CELLS).fill(null);
    fill(b, [41, 42, 43, 44, 45, 46], WHITE);
    expect(getSixLines(b, WHITE)).toHaveLength(1);
    b[40] = WHITE;                       // seven in a row is no longer a SIX
    expect(getSixLines(b, WHITE)).toHaveLength(0);
  });

  it('passes and then settles on stone count when neither side can move', () => {
    const b = Array(BOARD_CELLS).fill(null);
    fill(b, [0, 1, 2], BLACK); b[9] = WHITE;      // nothing is flippable for anyone
    const s = stateFor(b, BLACK, 1);
    expect(getLegalPlacements(b, BLACK)).toHaveLength(0);
    expect(getLegalPlacements(b, WHITE)).toHaveLength(0);
  });
});
