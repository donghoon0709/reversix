import { useEffect, useRef, useState } from 'react'
import { BOARD_SIZE, BLACK, WHITE, getSixLines, playableFor, forbiddenFor, placementsNeeded } from '../game/rules.js'

function coordinate(cell) {
  return `${String.fromCharCode(65 + (cell % BOARD_SIZE))}${Math.floor(cell / BOARD_SIZE) + 1}`
}

export default function Board({ state, dispatch, locked = false, review = false, onStep = () => {} }) {
  const [focusCell, setFocusCell] = useState(0)
  const refs = useRef([])
  // Separate the stones the opponent actually placed from the stones those moves flipped:
  // the placements are the move, the flips are its consequence.
  const lastMoves = new Map()          // cell -> order within the turn (1-based)
  const lastFlips = new Set()
  state.recentEffects?.forEach((effect, i) => {
    if (effect?.cell != null) lastMoves.set(effect.cell, i + 1)
    effect?.flips?.forEach(cell => lastFlips.add(cell))
  })

  const flipping = new Map()
  state.provisional.effects.forEach(effect => {
    effect.flips.forEach(cell => flipping.set(cell, effect.player))
  })
  const flipEpoch = state.provisional.effects.length
  const lineOwner = state.checkedPlayer
    ? (state.checkedPlayer === BLACK ? WHITE : BLACK)
    : state.activePlayer
  const winning = new Set(getSixLines(state.provisional.board, lineOwner).flat())
  const quotaReached = state.provisional.placements.length >= placementsNeeded(state)
  const latestProvisional = state.provisional.placements.at(-1)
  // review never places a stone, so skip the legality scan entirely: it runs
  // getSixLines over every legal cell and would fire on each step through a record
  const idle = review || state.terminal || quotaReached || locked
  const legal = new Set(idle ? [] : playableFor(state))
  // cells that flip stones but would hand the opponent a six
  const forbidden = new Set(idle ? [] : forbiddenFor(state))

  useEffect(() => {
    if (review) return
    refs.current[focusCell]?.focus()
  }, [review, focusCell, state.provisional.placements.length])

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

  function handleWrapperKeyDown(event) {
    if (!review) return
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      onStep(-1)
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      onStep(1)
    } else if (event.key === 'Home') {
      event.preventDefault()
      onStep(-Infinity)
    } else if (event.key === 'End') {
      event.preventDefault()
      onStep(Infinity)
    }
  }

  return (
    <div
      className="board-wrapper"
      role={review ? 'group' : undefined}
      tabIndex={review ? 0 : undefined}
      aria-label={review ? '감상 모드 보드, 화살표 키로 착수를 넘겨볼 수 있습니다' : undefined}
      onKeyDown={review ? handleWrapperKeyDown : undefined}
    >
      <div className="board" role={review ? 'table' : 'grid'} aria-label={`${BOARD_SIZE}×${BOARD_SIZE} Reversix game board`}>
        {Array.from({ length: BOARD_SIZE }, (_, row) => (
          <div role="row" key={row}>
            {Array.from({ length: BOARD_SIZE }, (_, column) => {
              const cell = row * BOARD_SIZE + column
              const value = state.provisional.board[cell]
              const occupied = value != null
              const provisionalIndex = state.provisional.placements.indexOf(cell)
              const canPlace = legal.has(cell)
              const isForbidden = forbidden.has(cell)
              const canUndo = cell === latestProvisional
              const flippingPlayer = flipping.get(cell)
              const unavailable = !canPlace && !canUndo
              const moveOrder = lastMoves.get(cell)
              const lastNote = moveOrder ? `, 직전 상대 착수 ${moveOrder}번째`
                : lastFlips.has(cell) ? ', 직전 착수로 뒤집힘' : ''
              const banNote = isForbidden ? ' 금수: 상대에게 SIX를 만들어 줍니다' : ''
              const label = review
                ? `${coordinate(cell)} ${value === BLACK ? '흑돌' : value === WHITE ? '백돌' : '빈 칸'}${lastNote}`
                : `${coordinate(cell)} ${value === BLACK ? '흑돌' : value === WHITE ? '백돌' : '빈 칸'}${lastNote}${canUndo ? ' 최신 착수 취소 가능' : !occupied ? canPlace ? ' 현재 턴에 착수 가능' : banNote || ' 현재 턴에 착수 불가' : ''}`
              const className = `board-cell ${value === BLACK ? 'is-black' : value === WHITE ? 'is-white' : 'is-empty'} ${!review && canPlace ? 'is-legal' : ''} ${!review && isForbidden ? 'is-forbidden-move' : ''} ${provisionalIndex >= 0 ? 'is-provisional' : ''} ${flippingPlayer ? `is-flipping is-flipping-to-${flippingPlayer === BLACK ? 'black' : 'white'}` : ''} ${moveOrder ? 'is-last-move' : ''} ${lastFlips.has(cell) ? 'is-recent' : ''} ${winning.has(cell) ? 'is-winning' : ''}`
              const content = (
                <>
                  {row === 0 && <span className="coord coord-file" aria-hidden="true">{String.fromCharCode(65 + column)}</span>}
                  {column === 0 && <span className="coord coord-rank" aria-hidden="true">{row + 1}</span>}
                  {!review && isForbidden && <span className="ban-mark" aria-hidden="true">🚫</span>}
                  {provisionalIndex >= 0 && <small>{provisionalIndex + 1}</small>}
                  {provisionalIndex < 0 && moveOrder && <small>{moveOrder}</small>}
                </>
              )
              if (review) {
                return (
                  <div
                    aria-label={label}
                    className={className}
                    data-flip-epoch={flippingPlayer ? flipEpoch : undefined}
                    key={flippingPlayer ? `${cell}-${flipEpoch}` : cell}
                    role="cell"
                  >
                    {content}
                  </div>
                )
              }
              return (
                <button
                  aria-disabled={unavailable || undefined}
                  aria-label={label}
                  className={className}
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
                  {content}
                </button>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
