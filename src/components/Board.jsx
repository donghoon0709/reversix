import { useEffect, useRef, useState } from 'react'
import { BOARD_SIZE, BLACK, WHITE, findWinningLines, requiredPlacements } from '../game/rules.js'

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
  const lineOwner = state.checkedPlayer
    ? (state.checkedPlayer === BLACK ? WHITE : BLACK)
    : state.activePlayer
  const winning = new Set(findWinningLines(state.provisional.board, lineOwner).flat())

  useEffect(() => {
    refs.current[focusCell]?.focus()
  }, [focusCell])

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
    if (state.terminal || state.provisional.board[cell] != null || state.provisional.placements.length >= requiredPlacements(state.turnStart)) return
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
              const quotaReached = state.provisional.placements.length >= requiredPlacements(state.turnStart)
              const unavailable = occupied || Boolean(state.terminal) || quotaReached
              const label = `${coordinate(cell)} ${value === BLACK ? '검은 돌' : value === WHITE ? '흰 돌' : '빈 칸'}${unavailable && !occupied ? ' 현재 턴에 착수 불가' : ''}`
              return (
                <button
                  aria-disabled={unavailable || undefined}
                  aria-label={label}
                  className={`board-cell ${value === BLACK ? 'is-black' : value === WHITE ? 'is-white' : 'is-empty'} ${provisionalIndex >= 0 ? 'is-provisional' : ''} ${recent.has(cell) ? 'is-recent' : ''} ${winning.has(cell) ? 'is-winning' : ''}`}
                  key={cell}
                  onClick={() => place(cell)}
                  onKeyDown={event => {
                    if (event.key.startsWith('Arrow')) {
                      event.preventDefault()
                      move(cell, event.key)
                    }
                    if ((event.key === 'Enter' || event.key === ' ') && !occupied) {
                      event.preventDefault()
                      place(cell)
                    }
                  }}
                  ref={element => { refs.current[cell] = element }}
                  role="gridcell"
                  tabIndex={cell === focusCell ? 0 : -1}
                  type="button"
                >
                  <span aria-hidden="true">{value === BLACK ? '●' : value === WHITE ? '○' : ''}</span>
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
