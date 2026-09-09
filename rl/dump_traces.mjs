// Dump JS-engine games as traces for verify_env.py. Only plies where a stone is actually
// placed are recorded: the JS engine passes with an explicit zero-stone commit while the
// C engine settles passes inside its step, so pass plies have no C counterpart.
import * as R from '../src/game/rules.js'

const N = Number(process.argv[2] ?? 40)
const out = []
let seed = 20260908
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
const side = p => (p === R.BLACK ? 1 : 2)

for (let g = 0; g < N; g++) {
  let s = R.createInitialGame()
  const trace = [], moves = []
  let guard = 0
  while (!s.terminal && guard++ < 4000) {
    // the engine-level playable set: the turn-level ban, not the UI's exploratory set
    const legal = R.getPlayablePlacements(s.turnStart.board, s.provisional.board,
                                          s.activePlayer, R.completesTurn(s))
    if (!legal.length) { s = R.reduceGame(s, { type: 'COMMIT_TURN' }); continue }   // pass
    trace.push({
      legal,
      player: side(s.activePlayer),
      placed: s.provisional.placements.length,
      checkBy: s.checkedPlayer ? side(s.checkedPlayer === R.BLACK ? R.WHITE : R.BLACK) : 0,
      turn: s.turnStart.turnNumber,
    })
    const cell = legal[Math.floor(rnd() * legal.length)]
    moves.push(cell)
    s = R.reduceGame(s, { type: 'PLACE', cell })
    if (R.turnComplete(s)) s = R.reduceGame(s, { type: 'COMMIT_TURN' })
  }
  out.push({ trace, moves, winner: s.terminal?.winner ? side(s.terminal.winner) : 0 })
}
process.stdout.write(JSON.stringify(out))
