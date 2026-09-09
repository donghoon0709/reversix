// One-shot position analysis: a single network forward pass, with no search behind it.
// The value head is unreliable in the opening — per
// artifacts/analysis-r3-20260908/value-by-phase.json, sign accuracy is only about 0.51
// below 24 stones on the board, climbing to about 0.76 above 64. Treat blackWin as a
// rough signal early on, not a verdict.
import { BLACK, WHITE } from './rules.js'
import { viewOf, safePlacements, encode } from './ai.js'

const softmax = x => {
  let mx = -Infinity
  for (const v of x) if (v > mx) mx = v
  const e = x.map(v => Math.exp(v - mx))
  const s = e.reduce((a, b) => a + b, 0)
  return e.map(v => v / s)
}

/** { blackWin, moves, terminal } for the current position, from one net.forward call. */
export function analyzePosition(net, state) {
  if (state.terminal) {
    const { winner } = state.terminal
    const blackWin = winner === BLACK ? 1 : winner === WHITE ? 0 : 0.5
    return { blackWin, moves: [], terminal: true }
  }

  const view = viewOf(state)
  const legal = safePlacements(view)
  const { policy, value } = net.forward(encode(view))
  const blackWin = state.activePlayer === BLACK ? (1 + value) / 2 : (1 - value) / 2

  const probs = softmax(legal.map(c => policy[c]))
  const moves = legal
    .map((cell, i) => ({ cell, prob: probs[i] }))
    .sort((a, b) => b.prob - a.prob)

  return { blackWin, moves, terminal: false }
}
