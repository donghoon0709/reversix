import { describe, expect, it } from 'vitest'
import { BLACK, WHITE, BOARD_CELLS, createInitialGame, reduceGame } from './rules.js'
import { analyzePosition } from './analysis.js'

// Deterministic fake net: fixed value, logits that favour higher cell indices so the
// softmax ordering over legal moves is easy to predict.
const fakeNet = value => {
  let calls = 0
  return {
    calls: () => calls,
    forward: () => {
      calls++
      const policy = new Float32Array(BOARD_CELLS)
      for (let i = 0; i < BOARD_CELLS; i++) policy[i] = i * 0.01
      return { policy, value }
    },
  }
}

describe('analyzePosition', () => {
  it('maps a positive value above 0.5 and a negative one below, black to move', () => {
    const state = createInitialGame()
    expect(state.activePlayer).toBe(BLACK)

    const up = analyzePosition(fakeNet(0.6), state)
    expect(up.blackWin).toBeGreaterThan(0.5)
    expect(up.blackWin).toBeCloseTo(0.8, 10)

    const down = analyzePosition(fakeNet(-0.6), state)
    expect(down.blackWin).toBeLessThan(0.5)
    expect(down.blackWin).toBeCloseTo(0.2, 10)
  })

  it('mirrors the same value for white to move', () => {
    let state = createInitialGame()
    // Black's opening turn is a single placement; commit it to hand the move to white.
    state = reduceGame(state, { type: 'PLACE', cell: 34 })
    state = reduceGame(state, { type: 'COMMIT_TURN' })
    expect(state.activePlayer).toBe(WHITE)
    expect(state.terminal).toBeNull()

    const result = analyzePosition(fakeNet(0.6), state)
    expect(result.blackWin).toBeCloseTo(0.2, 10)
  })

  it('returns exactly the legal moves, sorted descending, probabilities summing to 1', () => {
    const state = createInitialGame()
    const { moves } = analyzePosition(fakeNet(0), state)

    expect(moves.map(m => m.cell).slice().sort((a, b) => a - b)).toEqual([34, 43, 56, 65])
    for (let i = 1; i < moves.length; i++) expect(moves[i - 1].prob).toBeGreaterThanOrEqual(moves[i].prob)
    const total = moves.reduce((s, m) => s + m.prob, 0)
    expect(total).toBeCloseTo(1, 10)
  })

  it('short-circuits terminal states without calling the network', () => {
    const state = createInitialGame()

    const blackWon = { ...state, terminal: { winner: BLACK, reason: 'PASSES' } }
    const net1 = fakeNet(0)
    expect(analyzePosition(net1, blackWon)).toEqual({ blackWin: 1, moves: [], terminal: true })
    expect(net1.calls()).toBe(0)

    const whiteWon = { ...state, terminal: { winner: WHITE, reason: 'PASSES' } }
    const net2 = fakeNet(0)
    expect(analyzePosition(net2, whiteWon)).toEqual({ blackWin: 0, moves: [], terminal: true })
    expect(net2.calls()).toBe(0)

    const draw = { ...state, terminal: { winner: null, reason: 'PASSES' } }
    const net3 = fakeNet(0)
    expect(analyzePosition(net3, draw)).toEqual({ blackWin: 0.5, moves: [], terminal: true })
    expect(net3.calls()).toBe(0)
  })
})
