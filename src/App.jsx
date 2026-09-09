import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import Board from './components/Board.jsx'
import RulesDialog from './components/RulesDialog.jsx'
import ModeDialog, { MODES } from './components/ModeDialog.jsx'
import { createInitialGame, reduceGame, placementsNeeded, turnComplete, canCompleteTurn, BLACK, WHITE, BOARD_SIZE } from './game/rules.js'
import { searchPlacement } from './game/search.js'
import { ReversixNet } from './game/nn.js'

const MODEL_URL = '/model/latest'
const SEARCH_SIMS = 32          // same budget the network was trained with
const SEARCH_CANDIDATES = 16
const STONE_GAP_MS = 500        // pause between the two stones of one turn
const sleep = ms => new Promise(r => window.setTimeout(r, ms))
const label = p => (p === BLACK ? '흑' : '백')

const countStones = board => board.reduce(
  (a, v) => (v === BLACK ? { ...a, black: a.black + 1 } : v === WHITE ? { ...a, white: a.white + 1 } : a),
  { black: 0, white: 0 },
)

/** Why the game ended, in words — the winner alone does not explain it. */
function outcomeText(state) {
  const { winner, reason } = state.terminal
  const who = winner ? `${label(winner)} 승리` : '무승부'
  if (reason === 'DEFENSE_FAILED') return `${who} — 체크를 막지 못했습니다`
  if (reason === 'PASSES') {
    const { black, white } = countStones(state.board)
    return `${who} — 양쪽이 연달아 패스하여 돌 개수로 가렸습니다 (흑 ${black} : 백 ${white})`
  }
  if (reason === 'NO_LEGAL_TURN') return `${who} — 상대가 둘 곳을 잃었습니다`
  return who
}

/** Passes are resolved inside the engine, so they need saying out loud. */
const passNotice = state => (state.events || [])
  .filter(e => e.endsWith('PASS'))
  .map(e => `${label(e.startsWith('BLACK') ? BLACK : WHITE)}은(는) 둘 곳이 없어 패스했습니다`)
const coord = cell => `${String.fromCharCode(65 + (cell % BOARD_SIZE))}${Math.floor(cell / BOARD_SIZE) + 1}`

export default function App() {
  const [state, dispatch] = useReducer(reduceGame, undefined, createInitialGame)
  const [rulesOpen, setRulesOpen] = useState(false)
  const [modeOpen, setModeOpen] = useState(true)     // the opponent chooser greets the visitor
  const [mode, setMode] = useState('human')
  const [humanSide, setHumanSide] = useState(BLACK)
  const [thinking, setThinking] = useState(false)
  const [netStatus, setNetStatus] = useState('')
  const [progress, setProgress] = useState(null)
  const rulesButton = useRef(null), newButton = useRef(null)
  const netRef = useRef(null)
  const busy = useRef(false)
  const [modelMissing, setModelMissing] = useState(false)

  useEffect(() => {
    fetch(`${MODEL_URL}.json`, { method: 'HEAD' })
      .then(r => setModelMissing(!r.ok))
      .catch(() => setModelMissing(true))
  }, [])

  useEffect(() => {
    if (performance.getEntriesByType('navigation')[0]?.type === 'reload') {
      window.setTimeout(() => alert('페이지를 새로고침했습니다. 새 게임 상태로 시작합니다.'), 0)
    }
  }, [])

  const openRules = () => { rulesButton.current = document.activeElement; setRulesOpen(true) }
  const closeRules = () => { setRulesOpen(false); rulesButton.current?.focus() }
  const openNew = () => { newButton.current = document.activeElement; setModeOpen(true) }

  const chooseMode = useCallback(async (id, side) => {
    setModeOpen(false)
    if (id === 'net' && !netRef.current) {
      setNetStatus('신경망 불러오는 중…')
      try {
        netRef.current = await ReversixNet.load(MODEL_URL)
        setNetStatus('')
      } catch (err) {
        setNetStatus(`신경망을 불러오지 못했습니다: ${err.message}`)
        setMode('human'); dispatch({ type: 'NEW_GAME' }); newButton.current?.focus()
        return
      }
    }
    setMode(id)
    setHumanSide(side === 'white' ? WHITE : BLACK)
    dispatch({ type: 'NEW_GAME' })
    newButton.current?.focus()
  }, [])
  const computerSide = humanSide === BLACK ? WHITE : BLACK

  const computerToMove = mode !== 'human' && state.activePlayer === computerSide && !state.terminal

  // The computer places one stone at a time so the two stones of a turn are visible
  // separately; the search itself yields to the event loop so the board stays responsive.
  useEffect(() => {
    if (!computerToMove || busy.current) return
    busy.current = true
    let cancelled = false
    const placed = state.provisional.placements.length
    const need = placementsNeeded(state)
    setThinking(true)
    setProgress(null)

    const run = async () => {
      await sleep(placed > 0 ? STONE_GAP_MS : 60)
      if (cancelled) return
      if (!canCompleteTurn(state)) {              // no legal turn from here: pass
        dispatch({ type: 'COMMIT_TURN' })
        return
      }
      let cell = -1
      if (netRef.current) {
        cell = await searchPlacement(netRef.current, state, {
          sims: SEARCH_SIMS,
          m: SEARCH_CANDIDATES,
          onProgress: async (done, total) => {
            if (cancelled) return
            setProgress([done, total])
            await sleep(0)                       // let React paint between simulations
          },
        })
      }
      if (cancelled || cell < 0) return
      dispatch({ type: 'PLACE', cell })
      if (placed + 1 === need) dispatch({ type: 'COMMIT_TURN' })
    }

    run().finally(() => {
      busy.current = false
      if (!cancelled) { setThinking(false); setProgress(null) }
    })
    return () => { cancelled = true; busy.current = false; setThinking(false); setProgress(null) }
  }, [computerToMove, state, mode])

  const recentSummary = state.recentEffects?.length
    ? state.recentEffects.map(e => `${e.player === BLACK ? '흑' : '백'} ${e.cell != null ? coord(e.cell) : ''} 착수 · ${e.flips?.length ?? 0}개 뒤집힘`).join(', ')
    : '없음'
  const lastMove = state.recentEffects?.length
    ? { who: state.recentEffects[0].player, cells: state.recentEffects.map(e => e.cell).filter(c => c != null) }
    : null
  const modeLabel = MODES.find(m => m.id === mode)?.label ?? '2인 대전'
  const need = placementsNeeded(state)
  // A turn that cannot be finished: with no stone down the player passes, and with one
  // down they have walked into a dead end and must take it back.
  const placedNow = state.provisional.placements.length
  const deadTurn = !state.terminal && !canCompleteTurn(state)
  const stuck = deadTurn && placedNow === 0
  const deadEnd = deadTurn && placedNow > 0
  const shortTurn = !deadTurn && placedNow === 1 && placementsNeeded(state) === 1
    && state.turnStart.turnNumber !== 0
  const passes = passNotice(state)
  // with a stone already down this is the second-stone skip, not a pass
  const commitLabel = stuck ? '턴 패스' : shortTurn ? '턴 확정 (둘째 수 생략)' : '턴 확정'

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>Reversix</h1>
        <div className="control-group">
          <button ref={rulesButton} className="control" onClick={openRules}>규칙</button>
          <button ref={newButton} className="control" onClick={openNew}>새 게임</button>
        </div>
      </header>
      <main className="app-main">
        <section aria-live="polite">
          <p>모드: <strong>{modeLabel}</strong>{mode !== 'human' && <> · 나는 {label(humanSide)}, 컴퓨터는 {label(computerSide)}</>}</p>
          <p>현재 플레이어: <strong>{label(state.activePlayer)}</strong>{thinking && <span className="thinking"> · 생각 중{progress ? ` ${progress[0]}/${progress[1]}` : ''}…</span>}</p>
          <p>필요한 배치: {need} / 현재 배치: {state.provisional.placements.length}</p>
          {lastMove && <p className="last-move-line">직전 수 — <strong>{label(lastMove.who)}</strong> {lastMove.cells.map(coord).join(' → ')}</p>}
          {passes.map((t, i) => <p key={i} className="pass-notice">{t}</p>)}
          {stuck && <p className="stuck-notice">둘 수 있는 곳이 없습니다.</p>}
          {deadEnd && <p className="stuck-notice">이 수를 두면 둘째 수를 둘 곳이 없습니다. 턴을 초기화하고 다른 곳에 두세요.</p>}
          {state.checkedPlayer && <p>체크: {label(state.checkedPlayer)}</p>}
          {netStatus && <p>{netStatus}</p>}
          {state.announcement && <p>{state.announcement}</p>}
          {state.terminal && <p>게임 종료: {outcomeText(state)}</p>}
        </section>
        <Board state={state} dispatch={dispatch} locked={computerToMove || thinking}/>
        <div className="control-group">
          <button className="control" disabled={state.provisional.placements.length === 0 || !!state.terminal || computerToMove} onClick={() => dispatch({ type: 'RESET_TURN' })}>턴 초기화</button>
          <button className="control primary" disabled={!turnComplete(state) || !!state.terminal || computerToMove} onClick={() => dispatch({ type: 'COMMIT_TURN' })}>{commitLabel}</button>
        </div>
        <p>최근 효과: {recentSummary}</p>
      </main>
      <RulesDialog open={rulesOpen} onClose={closeRules}/>
      <ModeDialog unavailable={modelMissing ? { net: '학습된 가중치가 아직 없습니다' } : {}} open={modeOpen} onClose={() => { setModeOpen(false); newButton.current?.focus() }} onStart={chooseMode}/>
    </div>
  )
}
