// Reversix rules, mirroring the reference engine (nowyoullnever/ReverSIX, src/game/).
//
// Points that are easy to get wrong and are deliberate here:
//   * a SIX is a MAXIMAL run of exactly six. Seven or more in a row is an overline and
//     counts for nothing, so extending your own six can release the opponent's check.
//   * a turn is two stones, except Black's very first turn, and except that the second
//     stone is simply skipped when no legal one exists.
//   * a player with no legal move passes; two passes in a row with no check outstanding
//     ends the game on stone count.
export const BOARD_SIZE = 10;
export const BOARD_CELLS = BOARD_SIZE * BOARD_SIZE;
export const SIX = 6;
export const BLACK = 'BLACK';
export const WHITE = 'WHITE';

const DIRS = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
const AXES = [[0,1],[1,0],[1,1],[-1,1]];
const opponent = p => (p === BLACK ? WHITE : BLACK);
const inside = (r, c) => r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE;
const idx = (r, c) => r * BOARD_SIZE + c;

export function createInitialGame() {
  const board = Array(BOARD_CELLS).fill(null);
  board[44] = WHITE; board[55] = WHITE;
  board[45] = BLACK; board[54] = BLACK;
  const turnStart = { board: board.slice(), activePlayer: BLACK, checkedPlayer: null, turnNumber: 0 };
  return {
    board, activePlayer: BLACK, checkedPlayer: null, turnNumber: 0, consecutivePasses: 0,
    turnStart, provisional: { placements: [], effects: [], board: board.slice() },
    recentEffects: [], announcement: '', terminal: null, events: [],
  };
}

function placementEffect(board, player, cell) {
  if (!Number.isInteger(cell) || cell < 0 || cell >= BOARD_CELLS) return { ok: false, reason: 'INVALID_CELL' };
  if (board[cell] != null) return { ok: false, reason: 'OCCUPIED' };
  const next = board.slice();
  next[cell] = player;
  const opp = opponent(player);
  const flips = [];
  const r = Math.floor(cell / BOARD_SIZE), c = cell % BOARD_SIZE;
  for (const [dr, dc] of DIRS) {
    let rr = r + dr, cc = c + dc; const run = [];
    while (inside(rr, cc) && next[idx(rr, cc)] === opp) { run.push(idx(rr, cc)); rr += dr; cc += dc; }
    if (run.length && inside(rr, cc) && next[idx(rr, cc)] === player) flips.push(...run);
  }
  if (!flips.length) return { ok: false, reason: 'NO_FLIPS' };
  for (const x of flips) next[x] = player;
  return { ok: true, board: next, effect: { cell, player, flips: [...new Set(flips)] } };
}
export function applyPlacement(board, player, cell) { return placementEffect(board, player, cell); }

/** Every empty cell that flips at least one opposing stone. */
export function getLegalPlacements(board, player) {
  const out = [];
  for (let i = 0; i < BOARD_CELLS; i++) if (placementEffect(board, player, i).ok) out.push(i);
  return out;
}

/** Maximal runs of EXACTLY six. An overline of seven or more is not a SIX. */
export function getSixLines(board, player) {
  const lines = [];
  for (const [dr, dc] of AXES) {
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        if (board[idx(r, c)] !== player) continue;
        if (inside(r - dr, c - dc) && board[idx(r - dr, c - dc)] === player) continue;
        const line = []; let rr = r, cc = c;
        while (inside(rr, cc) && board[idx(rr, cc)] === player) { line.push(idx(rr, cc)); rr += dr; cc += dc; }
        if (line.length === SIX) lines.push(line);
      }
    }
  }
  return lines;
}

const baseNeed = turnNumber => (turnNumber === 0 ? 1 : 2);

/**
 * Stones still expected this turn. Two, except on Black's opening turn and except when
 * the second stone has to be skipped because nothing legal is left.
 */
export function placementsNeeded(state) {
  const base = baseNeed(state.turnStart.turnNumber);
  if (base === 2 && state.provisional.placements.length === 1
      && !getLegalPlacements(state.provisional.board, state.activePlayer).length) return 1;
  return base;
}
export function turnComplete(state) {
  return state.provisional.placements.length >= placementsNeeded(state);
}

function countStones(board) {
  let black = 0, white = 0;
  for (const v of board) { if (v === BLACK) black++; else if (v === WHITE) white++; }
  return { black, white };
}

/** End-of-turn bookkeeping shared by real turns and passes. Mutates `s`. */
function finishTurn(s, events) {
  const mover = s.activePlayer, opp = opponent(mover);
  if (s.checkedPlayer === mover && getSixLines(s.board, opp).length) {
    s.terminal = { winner: opp, reason: 'DEFENSE_FAILED' };
    events.push('CHECK DEFENSE FAILED');
    return;
  }
  s.checkedPlayer = getSixLines(s.board, mover).length ? opp : null;
  if (s.checkedPlayer) events.push(`${mover} CHECK`);
  s.activePlayer = opp;
  s.turnNumber += 1;
}

/** Pass for as long as the player to move has nothing legal. Mutates `s`. */
function settlePasses(s, events) {
  while (!s.terminal && !getLegalPlacements(s.board, s.activePlayer).length) {
    events.push(`${s.activePlayer} PASS`);
    s.consecutivePasses += 1;
    finishTurn(s, events);
    if (!s.terminal && s.consecutivePasses >= 2 && !s.checkedPlayer) {
      const { black, white } = countStones(s.board);
      s.terminal = { winner: black === white ? null : black > white ? BLACK : WHITE, reason: 'PASSES' };
      events.push('DOUBLE PASS');
    }
  }
}

function resolve(state) {
  const events = [];
  const s = {
    board: state.provisional.board.slice(),
    activePlayer: state.turnStart.activePlayer,
    checkedPlayer: state.turnStart.checkedPlayer,
    turnNumber: state.turnStart.turnNumber,
    consecutivePasses: 0,
    terminal: null,
  };
  finishTurn(s, events);
  settlePasses(s, events);
  const turnStart = {
    board: s.board.slice(), activePlayer: s.activePlayer,
    checkedPlayer: s.checkedPlayer, turnNumber: s.turnNumber,
  };
  return {
    board: s.board, activePlayer: s.activePlayer, checkedPlayer: s.checkedPlayer,
    turnNumber: s.turnNumber, consecutivePasses: s.consecutivePasses, turnStart,
    provisional: { placements: [], effects: [], board: s.board.slice() },
    recentEffects: state.provisional.effects, announcement: '',
    terminal: s.terminal, events,
  };
}

export function reduceGame(state, action) {
  if (action.type === 'NEW_GAME') return createInitialGame();
  if (state.terminal) return state;

  if (action.type === 'RESET_TURN') {
    return { ...state, board: state.turnStart.board.slice(),
      provisional: { placements: [], effects: [], board: state.turnStart.board.slice() }, announcement: '' };
  }

  if (action.type === 'UNDO_PLACEMENT') {
    const latest = state.provisional.placements.at(-1);
    if (action.cell !== latest) return state;
    const placements = state.provisional.placements.slice(0, -1), effects = [];
    let board = state.turnStart.board.slice();
    for (const cell of placements) {
      const a = placementEffect(board, state.activePlayer, cell);
      if (!a.ok) return state;
      board = a.board; effects.push(a.effect);
    }
    return { ...state, board, provisional: { placements, effects, board }, announcement: '' };
  }

  if (action.type === 'PLACE') {
    if (turnComplete(state)) return state;
    const a = placementEffect(state.provisional.board, state.activePlayer, action.cell);
    if (!a.ok) return { ...state, announcement: a.reason };
    const provisional = {
      placements: [...state.provisional.placements, action.cell],
      effects: [...state.provisional.effects, a.effect],
      board: a.board,
    };
    return { ...state, board: a.board, provisional, announcement: '' };
  }

  if (action.type === 'COMMIT_TURN') {
    if (!turnComplete(state)) return { ...state, announcement: 'Incomplete turn' };
    return resolve(state);
  }
  return state;
}
