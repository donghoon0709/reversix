// Computer opponents. The encoding here must match the training environment
// (rl/rxenv.c rx_encode) exactly, or the network sees a different game.
import {
  BOARD_SIZE, BOARD_CELLS, WIN_LENGTH, BLACK, WHITE,
  applyPlacement, findWinningLines, requiredPlacements, getPlaceableCells,
} from './rules.js'

const N = BOARD_SIZE
const other = p => (p === BLACK ? WHITE : BLACK)
const hasLine = (board, p) => findWinningLines(board, p).length > 0

/** What the agent needs to know about the position, pulled out of the reducer state. */
export function viewOf(state) {
  return {
    board: state.provisional.board,
    player: state.activePlayer,
    checked: state.checkedPlayer === state.activePlayer,
    placed: state.provisional.placements.length,
    first: state.provisional.placements[0] ?? -1,
    need: requiredPlacements(state.turnStart),
  }
}

/**
 * Legal placements for the current sub-move, dropping ones that lose on the spot.
 * A first stone only counts when the whole turn can still be completed — otherwise the
 * player would be stranded mid-turn. Mirrors rx_legal(..., safe=1).
 */
export function safePlacements(v, safe = true) {
  const { board, player, placed, need } = v
  const opp = other(player)
  const mustDefend = v.checked && safe
  const out = []

  if (placed >= 1) {
    for (let s2 = 0; s2 < BOARD_CELLS; s2++) {
      const a = applyPlacement(board, player, s2)
      if (!a.ok) continue
      if (mustDefend && hasLine(a.board, opp)) continue
      out.push(s2)
    }
  } else {
    for (let s1 = 0; s1 < BOARD_CELLS; s1++) {
      const a = applyPlacement(board, player, s1)
      if (!a.ok) continue
      let ok
      if (need === 1) {
        ok = mustDefend ? !hasLine(a.board, opp) : true
      } else {
        ok = false
        for (let s2 = 0; s2 < BOARD_CELLS && !ok; s2++) {
          const b = applyPlacement(a.board, player, s2)
          if (!b.ok) continue
          ok = mustDefend ? !hasLine(b.board, opp) : true
        }
      }
      if (ok) out.push(s1)
    }
  }
  if (!out.length && mustDefend) return safePlacements(v, false)  // lost anyway: play on
  return out
}

/** 9 input planes, from the side to move's point of view. */
export function encode(v) {
  const { board, player, placed, first, need } = v
  const opp = other(player)
  const x = new Float32Array(9 * BOARD_CELLS)
  const P = i => i * BOARD_CELLS
  for (let i = 0; i < BOARD_CELLS; i++) {
    if (board[i] === player) x[P(0) + i] = 1
    else if (board[i] === opp) x[P(1) + i] = 1
    x[P(8) + i] = 1
  }
  if (v.checked) x.fill(1, P(2), P(3))
  for (const line of findWinningLines(board, opp)) for (const c of line) x[P(3) + c] = 1
  if (placed) x.fill(1, P(4), P(5))
  if (first >= 0) x[P(5) + first] = 1
  if (need === 2) x.fill(1, P(6), P(7))
  for (const c of safePlacements(v)) x[P(7) + c] = 1
  return x
}

// ---- opponent 1: window-potential heuristic, scored over complete turns ----
const WGT = [0, 1, 5, 25, 120, 600, 3000, 15000, 60000]
const AXES = [[0, 1], [1, 0], [1, 1], [1, -1]]
const inside = (r, c) => r >= 0 && r < N && c >= 0 && c < N

function evalBoard(board, p) {
  const opp = other(p)
  let s = 0
  for (const [dr, dc] of AXES) {
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        if (!inside(r + dr * (WIN_LENGTH - 1), c + dc * (WIN_LENGTH - 1))) continue
        let mine = 0, they = 0
        for (let i = 0; i < WIN_LENGTH; i++) {
          const v = board[(r + dr * i) * N + (c + dc * i)]
          if (v === p) mine++
          else if (v === opp) they++
        }
        if (!they && mine) s += WGT[mine]
        else if (!mine && they) s -= WGT[they]
      }
    }
  }
  let m = 0, t = 0
  for (let i = 0; i < BOARD_CELLS; i++) { if (board[i] === p) m++; else if (board[i] === opp) t++ }
  return s + (m - t) * 0.5
}

/** Best complete turn under the heuristic. Returns the cells to play, in order. */
export function greedyTurn(v) {
  const { board, player, need, placed } = v
  const opp = other(player)
  let best = null, bestScore = -Infinity

  const consider = (cells, b) => {
    let s = evalBoard(b, player)
    if (hasLine(b, player)) s += 5000
    if (s > bestScore) { bestScore = s; best = cells }
  }
  for (const pass of [true, false]) {          // 2nd pass drops defence: the position is lost
    const mustDefend = v.checked && pass
    const roots = safePlacements({ ...v, checked: v.checked && pass })
    for (const s1 of roots) {
      const a = applyPlacement(board, player, s1)
      if (!a.ok) continue
      if (placed >= 1 || need === 1) {
        if (mustDefend && hasLine(a.board, opp)) continue
        consider([s1], a.board)
        continue
      }
      for (let s2 = 0; s2 < BOARD_CELLS; s2++) {
        const b = applyPlacement(a.board, player, s2)
        if (!b.ok) continue
        if (mustDefend && hasLine(b.board, opp)) continue
        consider([s1, s2], b.board)
      }
    }
    if (best) break
  }
  return best || []
}

// ---- opponent 2: the trained network, one placement at a time ----
export function neuralPlacement(net, v) {
  const legal = safePlacements(v)
  if (!legal.length) return -1
  const { policy } = net.forward(encode(v))
  let best = legal[0]
  for (const c of legal) if (policy[c] > policy[best]) best = c
  return best
}
