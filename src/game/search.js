// Gumbel AlphaZero search (Danihelka et al. 2022), ported from the training code
// (rl/mcts.py) so the browser agent plays the same way the network was trained to.
//
// One action = one placement. A turn is two placements by the SAME player, so a value
// is negated on backup only when the player actually changes.
import { reduceGame, turnComplete } from './rules.js'
import { viewOf, safePlacements, encode } from './ai.js'

const C_VISIT = 50, C_SCALE = 1

const softmax = x => {
  let mx = -Infinity
  for (const v of x) if (v > mx) mx = v
  const e = x.map(v => Math.exp(v - mx))
  const s = e.reduce((a, b) => a + b, 0)
  return e.map(v => v / s)
}
const sigma = (q, maxN) => (C_VISIT + maxN) * C_SCALE * q

// Gumbel(0,1)
const gumbel = rand => -Math.log(-Math.log(Math.max(rand(), 1e-12)) + 1e-12)

function halvingSchedule(nSim, m) {
  const phases = Math.max(1, Math.ceil(Math.log2(Math.max(m, 2))))
  const out = []
  let cand = m
  for (let i = 0; i < phases; i++) {
    if (cand < 1) break
    out.push([cand, Math.max(1, Math.floor(nSim / (phases * cand)))])
    if (cand === 1) break
    cand = Math.floor(cand / 2)
  }
  return out
}

/** A game position that advances one placement at a time, auto-resolving turns. */
function stepGame(state, cell) {
  let s = reduceGame(state, { type: 'PLACE', cell })
  if (turnComplete(s)) s = reduceGame(s, { type: 'COMMIT_TURN' })
  return s
}
const terminalValue = (state, player) => {
  const w = state.terminal.winner
  return w == null ? 0 : w === player ? 1 : -1
}

class Node {
  constructor(state) {
    this.state = state
    this.player = state.activePlayer
    this.terminal = !!state.terminal
    this.expanded = false
  }
  expand(logits, value) {
    this.legal = safePlacements(viewOf(this.state))
    let mx = -Infinity
    for (const c of this.legal) if (logits[c] > mx) mx = logits[c]
    this.prior = this.legal.map(c => logits[c] - mx)
    const k = this.legal.length
    this.N = new Int32Array(k)
    this.W = new Float64Array(k)
    this.child = new Array(k).fill(null)
    this.value = value
    this.expanded = true
  }
  q() {
    return Array.from(this.N, (n, i) => (n > 0 ? this.W[i] / n : 0))
  }
  completedQ() {
    let sum = 0
    for (const n of this.N) sum += n
    const q = this.q()
    if (sum === 0) return this.legal.map(() => this.value)
    const pi = softmax(this.prior)
    let w = 0, wq = 0
    for (let i = 0; i < this.N.length; i++) if (this.N[i] > 0) { w += pi[i]; wq += pi[i] * q[i] }
    const vMix = (this.value + (sum / Math.max(w, 1e-8)) * wq) / (1 + sum)
    return q.map((v, i) => (this.N[i] > 0 ? v : vMix))
  }
  maxN() {
    let m = 0
    for (const n of this.N) if (n > m) m = n
    return m
  }
}

/**
 * Runs the search and returns the chosen cell.
 * `onProgress(done, total)` is called between simulations so the caller can yield.
 */
export async function searchPlacement(net, state, { sims = 32, m = 16, rand = Math.random, onProgress } = {}) {
  const root = new Node(state)
  const evalNode = node => {
    const { policy, value } = net.forward(encode(viewOf(node.state)))
    node.expand(policy, value)
  }
  evalNode(root)
  if (root.legal.length === 0) return -1
  if (root.legal.length === 1) return root.legal[0]

  const g = root.legal.map(() => gumbel(rand))
  let cands = root.prior
    .map((p, i) => [p + g[i], i])
    .sort((a, b) => b[0] - a[0])
    .slice(0, Math.min(m, root.legal.length))
    .map(x => x[1])
  const phases = halvingSchedule(sims, cands.length)

  let done = 0
  const total = phases.reduce((a, [c, per]) => a + c * per, 0)
  for (const [candN, per] of phases) {
    const cur = cands.slice(0, candN)
    for (let v = 0; v < per; v++) {
      for (const ai of cur) {
        // descend from the root through this candidate
        const path = []
        let node = root, idx = ai
        for (;;) {
          path.push([node, idx])
          let next = node.child[idx]
          if (!next) {
            next = new Node(stepGame(node.state, node.legal[idx]))
            node.child[idx] = next
          }
          if (next.terminal) {
            backup(path, terminalValue(next.state, next.player), next.player)
            break
          }
          if (!next.expanded) {
            evalNode(next)
            backup(path, next.value, next.player)
            break
          }
          node = next
          idx = interiorSelect(node)
        }
        done++
        if (onProgress) await onProgress(done, total)
      }
    }
    if (candN > 1) {
      const cq = root.completedQ(), mn = root.maxN()
      cands = cur
        .map(i => [g[i] + root.prior[i] + sigma(cq[i], mn), i])
        .sort((a, b) => b[0] - a[0])
        .slice(0, Math.max(1, Math.floor(candN / 2)))
        .map(x => x[1])
    }
  }

  const cq = root.completedQ(), mn = root.maxN()
  let best = cands[0], bestScore = -Infinity
  for (const i of cands) {
    const s = g[i] + root.prior[i] + sigma(cq[i], mn)
    if (s > bestScore) { bestScore = s; best = i }
  }
  return root.legal[best]
}

function interiorSelect(node) {
  const cq = node.completedQ(), mn = node.maxN()
  const pi = softmax(node.prior.map((p, i) => p + sigma(cq[i], mn)))
  let sum = 0
  for (const n of node.N) sum += n
  let best = 0, bestVal = -Infinity
  for (let i = 0; i < pi.length; i++) {
    const v = pi[i] - node.N[i] / (1 + sum)
    if (v > bestVal) { bestVal = v; best = i }
  }
  return best
}

function backup(path, value, leafPlayer) {
  for (const [node, ai] of path) {
    node.N[ai] += 1
    node.W[ai] += node.player === leafPlayer ? value : -value
  }
}
