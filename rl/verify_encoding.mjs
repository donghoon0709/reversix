// The browser agent must see exactly what the training environment produced.
import fs from 'fs'
const R = await import('../src/game/rules.js')
const A = await import('../src/game/ai.js')
const games = JSON.parse(fs.readFileSync('/tmp/enc_traces.json', 'utf8'))
let pos = 0, badSafe = 0, badPlanes = 0
for (const [gi, g] of games.entries()) {
  let s = R.createInitialGame()
  for (let i = 0; i < g.steps.length; i++) {
    const v = A.viewOf(s)
    const safe = A.safePlacements(v)
    if (safe.join(',') !== g.steps[i].safe.join(',')) {
      badSafe++
      if (badSafe <= 3) console.log(`safe g${gi} #${i}: js=[${safe}] C=[${g.steps[i].safe}]`)
    }
    const planes = A.encode(v)
    let d = 0
    for (let k = 0; k < planes.length; k++) d = Math.max(d, Math.abs(planes[k] - g.steps[i].planes[k]))
    if (d > 0) {
      badPlanes++
      if (badPlanes <= 3) for (let p = 0; p < 9; p++) {
        let pd = 0
        for (let k = 0; k < 100; k++) pd = Math.max(pd, Math.abs(planes[p*100+k] - g.steps[i].planes[p*100+k]))
        if (pd > 0) console.log(`  plane ${p} differs (g${gi} #${i})`)
      }
    }
    pos++
    s = R.reduceGame(s, { type: 'PLACE', cell: g.moves[i] })
    if (R.turnComplete(s)) s = R.reduceGame(s, { type: 'COMMIT_TURN' })
  }
}
console.log(`positions=${pos}  safe-mask mismatches=${badSafe}  plane mismatches=${badPlanes}`)
console.log(badSafe + badPlanes === 0 ? 'PASS — JS encoding matches the training environment' : 'FAIL')
