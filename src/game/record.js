// Game-record codecs: a flat list of placed cell indices is the canonical model of a
// game. Turn boundaries and passes are never stored — they are always re-derived by
// replaying the cells through the rules engine, which is the only place that knows
// whose turn it is, how many stones a turn needs, and when a side must pass.
import {
  createInitialGame, reduceGame, canCompleteTurn, placementsNeeded, BLACK, WHITE,
} from './rules.js';

const coord = cell => String.fromCharCode(65 + (cell % 10)) + (Math.floor(cell / 10) + 1);
const COORD_RE = /[A-J](?:10|[1-9])/g;
const coordToCell = str => {
  const col = str.charCodeAt(0) - 65;
  const row = parseInt(str.slice(1), 10) - 1;
  return row * 10 + col;
};

/**
 * Fold `cells` through the reducer, re-deriving passes and turn boundaries as we go.
 * Never reimplements a rule: every decision is delegated to canCompleteTurn /
 * placementsNeeded / reduceGame.
 *
 * `startState` defaults to a fresh game and is what every real caller uses. It is
 * exposed as a second parameter purely so tests can drive replay from a hand-built
 * mid-game position — e.g. one crafted, the same way rules.test.js does, to force the
 * rare case where a turn's second stone has no legal continuation and is skipped.
 */
export function replay(cells, startState = createInitialGame()) {
  let state = startState;
  const states = [state];
  const turns = [];
  let i = 0;
  let error = null;
  let turnNumber = 0;

  while (state.terminal == null) {
    if (!canCompleteTurn(state)) {
      // no legal turn for the side to move: a pass, consuming no cells
      const player = state.activePlayer;
      state = reduceGame(state, { type: 'COMMIT_TURN' });
      states.push(state);
      turnNumber += 1;
      turns.push({
        number: turnNumber, player, cells: [], pass: true,
        check: state.checkedPlayer != null, stateIndex: states.length - 1,
      });
      continue;
    }

    if (i >= cells.length) break; // out of moves, game not yet terminal — stop here cleanly

    const player = state.activePlayer;
    const turnCells = [];
    let placedSnapshotIndex = null;
    while (state.provisional.placements.length < placementsNeeded(state) && i < cells.length) {
      const cell = cells[i];
      const before = state.provisional.placements.length;
      const next = reduceGame(state, { type: 'PLACE', cell });
      if (next.provisional.placements.length <= before || next.announcement) {
        error = { index: i, cell, reason: next.announcement || 'REJECTED' };
        break;
      }
      state = next;
      turnCells.push(cell);
      states.push(state);
      placedSnapshotIndex = states.length - 1;
      i += 1;
    }
    if (error) break;

    state = reduceGame(state, { type: 'COMMIT_TURN' });
    if (placedSnapshotIndex != null) states[placedSnapshotIndex] = state;
    else states.push(state); // shouldn't normally happen (canCompleteTurn was true) but stay safe
    turnNumber += 1;
    turns.push({
      number: turnNumber, player, cells: turnCells, pass: turnCells.length === 0,
      check: state.checkedPlayer != null, stateIndex: states.length - 1,
    });
  }

  return { states, turns, state, error };
}

function resultToken(state) {
  if (!state.terminal) return '*';
  const { winner } = state.terminal;
  if (winner === BLACK) return '1-0';
  if (winner === WHITE) return '0-1';
  return '1/2-1/2';
}

export function formatText(rep, meta = {}) {
  const tags = [];
  tags.push('[Format "reversix"]');
  tags.push('[Version "1"]');
  if (meta.date) tags.push(`[Date "${meta.date}"]`);
  if (meta.mode) tags.push(`[Mode "${meta.mode}"]`);
  if (meta.human) tags.push(`[Human "${meta.human}"]`);

  const lastTurnIndex = rep.turns.length - 1;
  const movetextParts = rep.turns.map((turn, idx) => {
    let body;
    if (turn.pass) {
      body = '--';
    } else {
      const coords = turn.cells.map(coord);
      const last = coords.length - 1;
      let suffix = '';
      if (turn.check) suffix += '+';
      if (idx === lastTurnIndex && rep.state.terminal) suffix += '#';
      coords[last] += suffix;
      body = coords.join(' ');
    }
    return `${turn.number}. ${body}`;
  });
  movetextParts.push(resultToken(rep.state));

  return `${tags.join('\n')}\n\n${movetextParts.join(' ')}`;
}

export function parseText(str) {
  const lines = str.split('\n');
  const meta = {};
  const bodyLines = [];
  const tagRe = /^\s*\[(\w+)\s+"([^"]*)"\]\s*$/;
  for (const line of lines) {
    const m = line.match(tagRe);
    if (m) {
      const [, key, value] = m;
      const lower = key.toLowerCase();
      if (lower === 'date') meta.date = value;
      else if (lower === 'mode') meta.mode = value;
      else if (lower === 'human') meta.human = value;
      else meta[lower] = value;
    } else {
      bodyLines.push(line);
    }
  }
  const movetext = bodyLines.join(' ');

  // The result token is only ever the LAST token of the movetext — search for it there,
  // not with an unanchored regex, so a stray annotation elsewhere can't be mistaken for it.
  let result = null;
  const tokens = movetext.trim().split(/\s+/).filter(Boolean);
  if (tokens.length) {
    const last = tokens[tokens.length - 1];
    if (/^(1-0|0-1|1\/2-1\/2|\*)$/.test(last)) result = last;
  }

  const cells = [];
  const coords = movetext.match(COORD_RE) || [];
  for (const c of coords) cells.push(coordToCell(c));

  return { cells, meta, result };
}

export function formatUrl(cells) {
  const bytes = new Uint8Array([1, ...cells]);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  const b64 = btoa(binary);
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function parseUrl(str) {
  if (typeof str !== 'string' || !str.length) throw new Error('Empty game record URL');
  let token = str;
  const qMatch = str.match(/[?&]g=([^&#]+)/);
  if (qMatch) token = qMatch[1];

  let b64 = token.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4;
  if (pad) b64 += '='.repeat(4 - pad);

  let binary;
  try {
    binary = atob(b64);
  } catch {
    throw new Error('Malformed game record: not valid base64url');
  }
  if (!binary.length) throw new Error('Malformed game record: empty payload');

  const bytes = [];
  for (let i = 0; i < binary.length; i++) bytes.push(binary.charCodeAt(i));

  if (bytes[0] !== 1) throw new Error(`Unsupported game record version: ${bytes[0]}`);

  const cells = bytes.slice(1);
  for (const c of cells) {
    if (!Number.isInteger(c) || c < 0 || c > 99) {
      throw new Error(`Malformed game record: invalid cell byte ${c}`);
    }
  }
  return { cells };
}

/**
 * Choose the codec by SHAPE, never by trying one and seeing what falls out.
 *
 * This has to be exact because the two formats genuinely overlap: a base64url token is a
 * bare run of [A-Za-z0-9_-], and about two in five of them contain a coordinate-shaped
 * substring like "C3". Letting the movetext parser have first refusal therefore turns a
 * valid share link into a bogus two-move game, silently, most of the time.
 */
export function parseRecord(str) {
  if (typeof str !== 'string' || !str.trim()) throw new Error('Empty game record');
  const text = str.trim();
  // a share link names its own payload, so nothing else can claim it
  if (/[?&]g=/.test(text)) return parseUrl(text);
  // movetext always carries structure around its coordinates: tags, turn numbers, pass
  // markers, or simply the whitespace between moves
  if (/[[\s.]/.test(text) || text.includes('--')) {
    const parsed = parseText(text);
    if (!parsed.cells.length) throw new Error('Malformed game record: no moves found');
    return parsed;
  }
  // one bare run of characters: only a whole-string coordinate sequence is movetext
  if (/^(?:[A-J](?:10|[1-9]))+$/.test(text)) return parseText(text);
  return parseUrl(text);
}
