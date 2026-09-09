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
    recentEffects: [], announcement: '', terminal: null, events: [], history: [],
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

/** Identity of a six line, so "the same six" can be told from "a new six". */
const signature = line => line.join(',');
export function sixSignatures(board, player) {
  return new Set(getSixLines(board, player).map(signature));
}

/**
 * A placement is forbidden when it would hand the opponent a SIX they did not have when
 * the turn began. Shrinking an opposing overline of seven leaves exactly six behind, so
 * without this you could gift the opponent a check with your own stone.
 * Sixes that were already on the board (the ones a check obliges you to break) are the
 * baseline and never count as newly given.
 */
export function isForbiddenPlacement(turnStartBoard, board, player, cell) {
  const a = placementEffect(board, player, cell);
  if (!a.ok) return false;
  const opp = opponent(player);
  const before = sixSignatures(turnStartBoard, opp);
  for (const line of getSixLines(a.board, opp)) if (!before.has(signature(line))) return true;
  return false;
}

/**
 * Placements the player may actually make.
 *
 * The ban is a property of the TURN, not of a single stone: a turn may not end having
 * handed the opponent a six. So the first of two stones is judged by whether the turn
 * can still be finished cleanly from there — it is never banned for what it does on its
 * own, since the second stone may undo it. When no first stone leads to a clean finish
 * the player has no legal turn at all and passes.
 */
export function getPlayablePlacements(turnStartBoard, board, player, completesTurn = true) {
  const legal = getLegalPlacements(board, player);
  if (completesTurn) {
    return legal.filter(cell => !isForbiddenPlacement(turnStartBoard, board, player, cell));
  }
  return legal.filter(first => {
    const a = placementEffect(board, player, first);
    if (!a.ok) return false;
    const seconds = getLegalPlacements(a.board, player);
    // with no legal second the first stone ends the turn, so it is judged directly
    if (!seconds.length) return !isForbiddenPlacement(turnStartBoard, board, player, first);
    return seconds.some(sec => !isForbiddenPlacement(turnStartBoard, a.board, player, sec));
  });
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
/** Would a stone played now end the turn? Only then does the ban apply. */
export function completesTurn(state) {
  return state.provisional.placements.length + 1 >= baseNeed(state.turnStart.turnNumber);
}
/**
 * Cells the side to move may put a stone on right now.
 *
 * The ban judges a whole TURN, so only the stone that ends one is filtered here. The
 * first of two stones stays open even when every second stone after it turns out to be
 * banned: the player may try it and watch the follow-ups light up as forbidden, which is
 * the only way to see WHY a position has no move. Such a turn simply cannot be committed
 * — see turnComplete — so the set of turns the game accepts is unchanged.
 */
export function playableFor(state) {
  const board = state.provisional.board, player = state.activePlayer;
  const legal = getLegalPlacements(board, player);
  if (!completesTurn(state)) return legal;
  return legal.filter(cell => !isForbiddenPlacement(state.turnStart.board, board, player, cell));
}
/** Cells that satisfy the Reversi rule — they flip something — but the ban keeps out. */
export function forbiddenFor(state) {
  const playable = new Set(playableFor(state));
  return getLegalPlacements(state.provisional.board, state.activePlayer)
    .filter(cell => !playable.has(cell));
}

/** Has the turn so far handed the opponent a six it did not have when the turn began? */
function turnGivesSix(state) {
  const opp = opponent(state.activePlayer);
  const before = sixSignatures(state.turnStart.board, opp);
  for (const line of getSixLines(state.provisional.board, opp)) {
    if (!before.has(signature(line))) return true;
  }
  return false;
}

/** Can the turn still be brought to a legal end from where it stands? */
export function canCompleteTurn(state) {
  if (state.provisional.placements.length >= placementsNeeded(state)) return !turnGivesSix(state);
  return getPlayablePlacements(state.turnStart.board, state.provisional.board,
                               state.activePlayer, completesTurn(state)).length > 0;
}

/** Whether COMMIT_TURN is a legal action right now. */
export function turnComplete(state) {
  if (canCompleteTurn(state)) return state.provisional.placements.length >= placementsNeeded(state);
  // this turn leads nowhere: only an untouched one may be committed, and that is a pass
  return state.provisional.placements.length === 0;
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

function resolve(state) {
  const events = [];
  // committing without a stone is a pass, and has to count towards the double-pass end
  const passed = state.provisional.placements.length === 0;
  const s = {
    board: state.provisional.board.slice(),
    activePlayer: state.turnStart.activePlayer,
    checkedPlayer: state.turnStart.checkedPlayer,
    turnNumber: state.turnStart.turnNumber,
    consecutivePasses: passed ? (state.consecutivePasses || 0) + 1 : 0,
    terminal: null,
  };
  if (passed) events.push(`${s.activePlayer} PASS`);
  finishTurn(s, events);
  if (passed && !s.terminal && s.consecutivePasses >= 2 && !s.checkedPlayer) {
    const { black, white } = countStones(s.board);
    s.terminal = { winner: black === white ? null : black > white ? BLACK : WHITE, reason: 'PASSES' };
    events.push('DOUBLE PASS');
  }
  const turnStart = {
    board: s.board.slice(), activePlayer: s.activePlayer,
    checkedPlayer: s.checkedPlayer, turnNumber: s.turnNumber,
  };
  return {
    board: s.board, activePlayer: s.activePlayer, checkedPlayer: s.checkedPlayer,
    turnNumber: s.turnNumber, consecutivePasses: s.consecutivePasses, turnStart,
    provisional: { placements: [], effects: [], board: s.board.slice() },
    recentEffects: state.provisional.effects, announcement: '',
    terminal: s.terminal, events, history: [...(state.history || []), ...state.provisional.placements],
  };
}

export function reduceGame(state, action) {
  if (action.type === 'NEW_GAME') return createInitialGame();
  if (state.terminal) return state;

  if (action.type === 'RESET_TURN') {
    return { ...state, board: state.turnStart.board.slice(),
      provisional: { placements: [], effects: [], board: state.turnStart.board.slice() },
      announcement: '', events: [] };
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
    return { ...state, board, provisional: { placements, effects, board }, announcement: '', events: [] };
  }

  if (action.type === 'PLACE') {
    // only a full turn refuses another stone; a dead-end turn stays open to be explored
    if (state.provisional.placements.length >= placementsNeeded(state)) return state;
    const a = placementEffect(state.provisional.board, state.activePlayer, action.cell);
    if (!a.ok) return { ...state, announcement: a.reason };
    if (completesTurn(state)
        && isForbiddenPlacement(state.turnStart.board, state.provisional.board, state.activePlayer, action.cell))
      return { ...state, announcement: 'FORBIDDEN_GIVES_SIX' };
    const provisional = {
      placements: [...state.provisional.placements, action.cell],
      effects: [...state.provisional.effects, a.effect],
      board: a.board,
    };
    return { ...state, board: a.board, provisional, announcement: '', events: [] };
  }

  if (action.type === 'COMMIT_TURN') {
    if (!turnComplete(state)) return { ...state, announcement: 'Incomplete turn' };
    return resolve(state);
  }
  return state;
}
