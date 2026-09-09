import { describe, expect, it } from 'vitest';
import {
  createInitialGame, reduceGame, canCompleteTurn, turnComplete, playableFor, BLACK, BOARD_CELLS,
} from './rules.js';
import { replay, parseText, parseUrl, formatText, formatUrl } from './record.js';

// Deterministic PRNG (mulberry32) so the corpus below is reproducible.
function mulberry32(seed) {
  let a = seed;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Play one full game of random LEGAL turns via the reducer, never reimplementing rules.
 * `playableFor` already excludes forbidden placements, so we pick uniformly from it. If a
 * turn is a genuine dead end (first stone chosen has no clean second, and the reducer
 * refuses to commit), RESET_TURN and try again from the same position — this is the
 * "let the dead-end case fall out naturally" behaviour, not a hand-rolled rule.
 */
function playRandomGame(rng) {
  let s = createInitialGame();
  let sawPass = false;
  let sawOpeningOne = false;
  let sawSkippedSecond = false;
  let guard = 0;
  while (!s.terminal) {
    guard += 1;
    if (guard > 4000) throw new Error('runaway random game');
    if (!canCompleteTurn(s)) {
      s = reduceGame(s, { type: 'COMMIT_TURN' }); // pass
      sawPass = true;
      continue;
    }
    const openingTurn = s.turnStart.turnNumber === 0;
    const base = openingTurn ? 1 : 2;
    if (openingTurn) sawOpeningOne = true;
    while (!turnComplete(s)) {
      const options = playableFor(s);
      if (!options.length) {
        s = reduceGame(s, { type: 'RESET_TURN' });
        continue;
      }
      const cell = options[Math.floor(rng() * options.length)];
      s = reduceGame(s, { type: 'PLACE', cell });
    }
    if (base === 2 && s.provisional.placements.length === 1) sawSkippedSecond = true;
    s = reduceGame(s, { type: 'COMMIT_TURN' });
  }
  return { state: s, sawPass, sawOpeningOne, sawSkippedSecond };
}

// Seed 228 is the first (of seeds 1..3000, checked separately) whose game passes at least
// once, under this exact random policy; N=250 is chosen to include it so the pass category
// is exercised deterministically rather than by luck. See the coverage test below for why
// "skipped second stone" is NOT included in this corpus's coverage requirement.
const N = 250;
const corpus = Array.from({ length: N }, (_, i) => playRandomGame(mulberry32(i + 1)));

describe('replay round-trips a corpus of random games', () => {
  it('reproduces the final board and terminal for every game in the corpus, via both codecs', () => {
    for (const { state } of corpus) {
      const rep = replay(state.history);
      expect(rep.error).toBe(null);
      expect(rep.state.board).toEqual(state.board);
      expect(rep.state.terminal).toEqual(state.terminal);

      const text = formatText(rep, { date: '2026-09-09', mode: 'net', human: 'BLACK' });
      const fromText = parseText(text);
      expect(fromText.cells).toEqual(state.history);

      const url = formatUrl(state.history);
      const fromUrl = parseUrl(url);
      expect(fromUrl.cells).toEqual(state.history);
    }
  });

  // "Skipped second stone" is deliberately NOT asserted here. It was searched for and not
  // found: 3000 uniform-random games played to terminal (this exact policy) never produced
  // one, nor did an exhaustive turn-by-turn search from the true starting position out to
  // 4 turns / ~150,000 nodes. Random/legal play overwhelmingly ends games early via a
  // failed check defence, long before the board is saturated enough to strand a second
  // stone — so under this policy the case is genuinely unreachable at any practical corpus
  // size. It is covered directly below with a hand-built position instead (matching the
  // technique rules.test.js already uses for the same rule).
  it('covers a pass and an opening single stone across the corpus', () => {
    const sawPass = corpus.some(g => g.sawPass);
    const everyOpeningOne = corpus.every(g => g.sawOpeningOne);
    expect(everyOpeningOne).toBe(true);
    expect(sawPass, 'expected at least one game in the corpus to include a pass').toBe(true);
  });
});

describe('a hand-built position where the second stone is skipped', () => {
  // Mirrors the board rules.test.js uses for "skips the second stone when nothing legal is
  // left": a single WHITE stone at (4,4) next to BLACK at (4,5). Taking (4,3) flips it and
  // leaves no legal follow-up anywhere, so placementsNeeded drops from 2 to 1 mid-turn.
  // Random play essentially never reaches a state this sparse-yet-locked (see the note
  // above), so this case is exercised directly instead of hunted for.
  const cell = (r, c) => r * 10 + c;
  const boardWith = (entries) => {
    const b = Array(BOARD_CELLS).fill(null);
    for (const [r, c, p] of entries) b[cell(r, c)] = p;
    return b;
  };
  const handBuiltState = (board, activePlayer = BLACK, turnNumber = 1) => ({
    board: board.slice(), activePlayer, checkedPlayer: null, turnNumber, consecutivePasses: 0,
    turnStart: { board: board.slice(), activePlayer, checkedPlayer: null, turnNumber },
    provisional: { placements: [], effects: [], board: board.slice() },
    recentEffects: [], announcement: '', terminal: null, events: [], history: [],
  });

  it('derives a one-stone turn via replay, using the exact same rule rules.test.js exercises', () => {
    const board = boardWith([[4, 4, 'WHITE'], [4, 5, 'BLACK']]);
    const start = handBuiltState(board, BLACK, 1); // turnNumber 1: a normal two-stone turn
    // Only one cell is supplied: with a sparse board like this, both sides then have
    // nothing left to flip, so the game passes out to a double-pass terminal right after —
    // that tail is expected and irrelevant here; what matters is the first turn.
    const rep = replay([cell(4, 3)], start);
    expect(rep.error).toBe(null);
    expect(rep.turns[0].cells).toEqual([cell(4, 3)]);
    expect(rep.turns[0].pass).toBe(false);
    expect(rep.state.provisional.placements).toEqual([]); // the turn committed cleanly
  });
});

describe('history matches replay', () => {
  it('replaying a played-out game history reproduces the final board', () => {
    const { state } = corpus[0];
    const rep = replay(state.history);
    expect(rep.state.board).toEqual(state.board);
    expect(rep.state.activePlayer).toEqual(state.activePlayer);
  });
});

describe('snapshot indexing', () => {
  it('states[0] is the initial position, and snapshot count equals stones plus passes', () => {
    const { state, } = corpus[0];
    const rep = replay(state.history);
    const initial = createInitialGame();
    expect(rep.states[0].board).toEqual(initial.board);
    const passCount = rep.turns.filter(t => t.pass).length;
    const stoneCount = state.history.length;
    // states[0] is the initial position, plus one snapshot per stone and per pass.
    expect(rep.states.length).toBe(1 + stoneCount + passCount);
  });
});

describe('corrupt input', () => {
  it('stops replay at an illegal placement and keeps the snapshots up to that point', () => {
    // A legal opening stone followed by a cell that is already occupied (the centre four).
    const cells = [34, 44]; // 44 is occupied by the initial WHITE stone
    const rep = replay(cells);
    expect(rep.error).not.toBe(null);
    expect(rep.error.index).toBe(1);
    expect(rep.error.cell).toBe(44);
    expect(rep.states.length).toBeGreaterThan(0);
    expect(rep.states[0].board).toEqual(createInitialGame().board);
  });

  it('throws on a url with a bad version byte', () => {
    const bytes = new Uint8Array([2, 34, 43]); // version 2, unsupported
    let binary = '';
    for (const b of bytes) binary += String.fromCharCode(b);
    const bad = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(() => parseUrl(bad)).toThrow();
  });

  it('throws on malformed base64url', () => {
    expect(() => parseUrl('***not base64***')).toThrow();
  });
});

// col letter A-J -> 0-9, row 1-10 -> 0-9, matching the coord scheme in rules.js / record.js
const toCell = str => {
  const col = str.charCodeAt(0) - 65;
  const row = parseInt(str.slice(1), 10) - 1;
  return row * 10 + col;
};

describe('text parsing is liberal', () => {
  it('parses a movetext-only string with no tags', () => {
    const { cells, result } = parseText('1. E5 2. D6 F4 3. -- 1-0');
    expect(cells).toEqual([toCell('E5'), toCell('D6'), toCell('F4')]);
    expect(result).toBe('1-0');
  });

  it('tolerates extra whitespace and missing tags', () => {
    const str = '\n\n  1.   E5    2.  D6   F4  \n 3.  --   1-0  \n';
    const { cells, result } = parseText(str);
    expect(cells).toEqual([toCell('E5'), toCell('D6'), toCell('F4')]);
    expect(result).toBe('1-0');
  });

  it('parses tags into meta and ignores +, #, and turn numbers', () => {
    const str = '[Format "reversix"]\n[Version "1"]\n[Date "2026-09-09"]\n[Mode "net"]\n[Human "BLACK"]\n\n1. E5 2. D6 F4+ 3. G7# 1-0';
    const { cells, meta, result } = parseText(str);
    expect(meta.date).toBe('2026-09-09');
    expect(meta.mode).toBe('net');
    expect(meta.human).toBe('BLACK');
    expect(cells).toEqual([toCell('E5'), toCell('D6'), toCell('F4'), toCell('G7')]);
    expect(result).toBe('1-0');
  });
});
