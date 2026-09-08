// End-to-end check of the shipped browser agent: search + net vs the scripted baselines.
import fs from 'fs'
const R = await import('../src/game/rules.js')
const A = await import('../src/game/ai.js')
const S = await import('../src/game/search.js')
const { ReversixNet } = await import('../src/game/nn.js')

const base = new URL('../public/model/latest', import.meta.url).pathname
const meta = JSON.parse(fs.readFileSync(base + '.json', 'utf8'))
const buf = fs.readFileSync(base + '.bin')
const net = new ReversixNet(meta, new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4))
console.log(`model: iter ${meta.iter}, ch${meta.ch}x${meta.blocks}`)

let seed = 4242
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296)

const turnOf = async (s, pick) => {
  const cells = []; let t = s
  while (!R.turnComplete(t)) {
    const c = await pick(t); if (c < 0) break
    cells.push(c); t = R.reduceGame(t, { type: 'PLACE', cell: c })
  }
  return cells
}
const agents = {
  search: s => turnOf(s, t => S.searchPlacement(net, t, { sims: 32, m: 16, rand })),
  policy: s => turnOf(s, async t => A.neuralPlacement(net, A.viewOf(t))),
  greedy: async s => A.greedyTurn(A.viewOf(s)),
  random: s => turnOf(s, async t => {
    const l = A.safePlacements(A.viewOf(t)); return l.length ? l[Math.floor(rand() * l.length)] : -1
  }),
}
async function play(bf, wf) {
  let s = R.createInitialGame()
  for (let i = 0; i < 500 && !s.terminal; i++) {
    const cells = await (s.activePlayer === R.BLACK ? bf : wf)(s)
    if (!cells.length) break
    for (const c of cells) s = R.reduceGame(s, { type: 'PLACE', cell: c })
    s = R.reduceGame(s, { type: 'COMMIT_TURN' })
  }
  return s.terminal ? (s.terminal.winner === R.BLACK ? 1 : s.terminal.winner === R.WHITE ? 2 : 0) : -1
}
const N = Number(process.argv[2] || 4)
for (const [name, b, w] of [
  ['search(B) vs greedy(W)', agents.search, agents.greedy],
  ['greedy(B) vs search(W)', agents.greedy, agents.search],
  ['search(B) vs policy(W)', agents.search, agents.policy],
]) {
  const res = { 0: 0, 1: 0, 2: 0, '-1': 0 }; const t0 = Date.now()
  for (let i = 0; i < N; i++) res[await play(b, w)]++
  console.log(`${name}: B=${res[1]} W=${res[2]} D=${res[0]}  ${((Date.now()-t0)/N/1000).toFixed(0)}s/game`)
}
