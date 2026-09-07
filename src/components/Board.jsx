import { useEffect, useRef, useState } from 'react'
import { BOARD_SIZE, BLACK, WHITE, findWinningLines, getLegalPlacements, requiredPlacements } from '../game/rules.js'

function coordinate(cell) {
  return `${String.fromCharCode(65 + (cell % BOARD_SIZE))}${Math.floor(cell / BOARD_SIZE) + 1}`
}

export default function Board({ state, dispatch }) {
  const [focusCell, setFocusCell] = useState(0)
  const refs = useRef([])
  const recent = new Set()
  state.recentEffects?.forEach(effect => {
    if (effect?.cell != null) recent.add(effect.cell)
    effect?.flips?.forEach(cell => recent.add(cell))
  })
  const flipping = new Map()
  state.provisional.effects.forEach(effect => {
    effect.flips.forEach(cell => flipping.set(cell, effect.player))
  })
  const flipEpoch = state.provisional.effects.length
  const lineOwner = state.checkedPlayer
    ? (state.checkedPlayer === BLACK ? WHITE : BLACK)
    : state.activePlayer
  const winning = new Set(findWinningLines(state.provisional.board, lineOwner).flat())
  const quotaReached = state.provisional.placements.length >= requiredPlacements(state.turnStart)
  const latestProvisional = state.provisional.placements.at(-1)
  const legal = new Set(
    state.terminal || quotaReached
      ? []
      : getLegalPlacements(state.provisional.board, state.activePlayer, state.provisional.placements[0] ?? null),
  )

  useEffect(() => {
    refs.current[focusCell]?.focus()
  }, [focusCell, state.provisional.placements.length])

  function move(cell, key) {
    let row = Math.floor(cell / BOARD_SIZE)
    let column = cell % BOARD_SIZE
    if (key === 'ArrowUp') row = Math.max(0, row - 1)
    if (key === 'ArrowDown') row = Math.min(BOARD_SIZE - 1, row + 1)
    if (key === 'ArrowLeft') column = Math.max(0, column - 1)
    if (key === 'ArrowRight') column = Math.min(BOARD_SIZE - 1, column + 1)
    setFocusCell(row * BOARD_SIZE + column)
  }

  function place(cell) {
    if (cell === latestProvisional) {
      dispatch({ type: 'UNDO_PLACEMENT', cell })
      setFocusCell(cell)
      return
    }
    if (!legal.has(cell)) return
    dispatch({ type: 'PLACE', cell })
    setFocusCell(cell)
  }

  return (
    <div className="board-wrapper">
      <div className="board" role="grid" aria-label="15×15 Reversix game board">
        {Array.from({ length: BOARD_SIZE }, (_, row) => (
          <div role="row" key={row}>
            {Array.from({ length: BOARD_SIZE }, (_, column) => {
              const cell = row * BOARD_SIZE + column
              const value = state.provisional.board[cell]
              const occupied = value != null
              const provisionalIndex = state.provisional.placements.indexOf(cell)
              const canPlace = legal.has(cell)
              const canUndo = cell === latestProvisional
              const flippingPlayer = flipping.get(cell)
              const unavailable = !canPlace && !canUndo
              const label = `${coordinate(cell)} ${value === BLACK ? '검은 돌' : value === WHITE ? '흰 돌' : '빈 칸'}${canUndo ? ' 최신 착수 취소 가능' : !occupied ? canPlace ? ' 현재 턴에 착수 가능' : ' 현재 턴에 착수 불가' : ''}`
              return (
                <button
                  aria-disabled={unavailable || undefined}
                  aria-label={label}
                  className={`board-cell ${value === BLACK ? 'is-black' : value === WHITE ? 'is-white' : 'is-empty'} ${canPlace ? 'is-legal' : ''} ${provisionalIndex >= 0 ? 'is-provisional' : ''} ${flippingPlayer ? `is-flipping is-flipping-to-${flippingPlayer === BLACK ? 'black' : 'white'}` : ''} ${recent.has(cell) ? 'is-recent' : ''} ${winning.has(cell) ? 'is-winning' : ''}`}
                  data-flip-epoch={flippingPlayer ? flipEpoch : undefined}
                  key={flippingPlayer ? `${cell}-${flipEpoch}` : cell}
                  onClick={() => place(cell)}
                  onKeyDown={event => {
                    if (event.key.startsWith('Arrow')) {
                      event.preventDefault()
                      move(cell, event.key)
                    }
                    if ((event.key === 'Enter' || event.key === ' ') && (canPlace || canUndo)) {
                      event.preventDefault()
                      place(cell)
                    }
                  }}
                  ref={element => { refs.current[cell] = element }}
                  role="gridcell"
                  tabIndex={cell === focusCell ? 0 : -1}
                  type="button"
                >
                  {provisionalIndex >= 0 && <small>{provisionalIndex + 1}</small>}
                </button>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
