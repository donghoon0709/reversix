import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import Board from './components/Board.jsx'
import RulesDialog from './components/RulesDialog.jsx'
import ModeDialog, { MODES } from './components/ModeDialog.jsx'
import ReviewControls from './components/ReviewControls.jsx'
import EvalBar from './components/EvalBar.jsx'
import { createInitialGame, reduceGame, placementsNeeded, turnComplete, canCompleteTurn, BLACK, WHITE, BOARD_SIZE } from './game/rules.js'
import { searchPlacement } from './game/search.js'
import { ReversixNet } from './game/nn.js'
import { analyzePosition } from './game/analysis.js'
import { replay, parseUrl, formatText, formatUrl } from './game/record.js'

const MODEL_URL = '/model/latest'
const SEARCH_SIMS = 32          // same budget the network was trained with
const SEARCH_CANDIDATES = 16
const STONE_GAP_MS = 500        // pause between the two stones of one turn
// The only modes that drive their own stones; review just plays back a recorded game
// and must never be mistaken for an opponent that needs to move.
const COMPUTER_MODE_IDS = MODES.map(m => m.id).filter(id => id !== 'human' && id !== 'review')
const sleep = ms => new Promise(r => window.setTimeout(r, ms))
const label = p => (p === BLACK ? '흑' : '백')
const NO_HINTS = new Map()          // stable identity so Board does not see a new Map every render

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

/** The move at a given snapshot index, in words — e.g. "흑 E5", "백 D6 → F4", "흑 패스".
 *  A turn "owns" every snapshot from just after the previous turn's up to its own, so the
 *  first turn whose stateIndex has not been passed yet is the one covering `index`. */
function reviewCaption(rep, index) {
  if (!rep || index <= 0) return ''
  const turn = rep.turns.find(t => t.stateIndex >= index)
  if (!turn) return ''
  if (turn.pass) return `${label(turn.player)} 패스`
  return `${label(turn.player)} ${turn.cells.map(coord).join(' → ')}`
}

const todayISO = () => new Date().toISOString().slice(0, 10)

export default function App() {
  const [state, dispatch] = useReducer(reduceGame, undefined, createInitialGame)
  const [rulesOpen, setRulesOpen] = useState(false)
  const [modeOpen, setModeOpen] = useState(true)     // the opponent chooser greets the visitor
  const [mode, setMode] = useState('human')
  const [humanSide, setHumanSide] = useState(BLACK)
  const [thinking, setThinking] = useState(false)
  const [netStatus, setNetStatus] = useState('')
  const [progress, setProgress] = useState(null)
  const [review, setReview] = useState(null)          // { cells, rep, index } while reading a record
  const [linkError, setLinkError] = useState('')
  const [copyStatus, setCopyStatus] = useState('')
  const rulesButton = useRef(null), newButton = useRef(null)
  const netRef = useRef(null)
  const netLoading = useRef(false)    // guards the analysis loader against racing chooseMode's own load
  const busy = useRef(false)
  const [modelMissing, setModelMissing] = useState(false)
  const [practice, setPractice] = useState(false)
  const [netReady, setNetReady] = useState(false)   // netRef is a ref, so this is what triggers a re-render once it loads
  const [analysis, setAnalysis] = useState(null)

  const reviewing = review != null
  const view = reviewing ? review.rep.states[review.index] : state
  // Practice hints and the eval bar need the same AZ-32 weights as the computer opponent;
  // review always analyses regardless of the practice toggle.
  const analysisOn = (reviewing || practice) && !modelMissing

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

  // A shared link (?g=…) opens straight into review mode — someone who followed it wants
  // the game, not the mode chooser. A malformed link falls back to the usual dialog.
  useEffect(() => {
    const g = new URLSearchParams(location.search).get('g')
    if (!g) return
    try {
      const { cells } = parseUrl(g)
      const rep = replay(cells)
      setReview({ cells, rep, index: rep.states.length - 1 })
      setMode('review')
      setModeOpen(false)
    } catch (err) {
      setLinkError(err.message)
    }
  }, [])

  const openRules = () => { rulesButton.current = document.activeElement; setRulesOpen(true) }
  const closeRules = () => { setRulesOpen(false); rulesButton.current?.focus() }
  const openNew = () => { newButton.current = document.activeElement; setModeOpen(true) }

  const chooseMode = useCallback(async (id, side, cells, practiceOn) => {
    setModeOpen(false)
    if (id === 'review') {
      // review analyses regardless of the toggle, so the practice flag is left alone here
      const rep = replay(cells)
      setReview({ cells, rep, index: rep.states.length - 1 })
      setMode('review')
      newButton.current?.focus()
      return
    }
    setReview(null)
    setPractice(practiceOn)
    if (id === 'net' && !netRef.current) {
      setNetStatus('신경망 불러오는 중…')
      netLoading.current = true
      try {
        netRef.current = await ReversixNet.load(MODEL_URL)
        setNetReady(true)          // a ref alone does not re-render
        setNetStatus('')
      } catch (err) {
        setNetStatus(`신경망을 불러오지 못했습니다: ${err.message}`)
        setMode('human'); dispatch({ type: 'NEW_GAME' }); newButton.current?.focus()
        netLoading.current = false
        return
      }
      netLoading.current = false
    }
    setMode(id)
    setHumanSide(side === 'white' ? WHITE : BLACK)
    dispatch({ type: 'NEW_GAME' })
    newButton.current?.focus()
  }, [])
  const computerSide = humanSide === BLACK ? WHITE : BLACK

  const computerToMove = COMPUTER_MODE_IDS.includes(mode) && !reviewing
    && state.activePlayer === computerSide && !state.terminal

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

  // Practice hints and the eval bar need the same weights as the AZ-32 opponent. This
  // loads them independently of chooseMode's own load, guarded so the two never race.
  useEffect(() => {
    if (!analysisOn || netRef.current || netLoading.current) return
    let cancelled = false
    netLoading.current = true
    setNetStatus('신경망 불러오는 중…')
    ReversixNet.load(MODEL_URL).then(net => {
      if (cancelled) return
      netRef.current = net
      setNetReady(true)
      setNetStatus('')
    }).catch(err => {
      if (cancelled) return
      setNetStatus(`신경망을 불러오지 못했습니다: ${err.message}`)
    }).finally(() => { netLoading.current = false })
    return () => { cancelled = true }
  }, [analysisOn])

  // Recompute whenever the displayed position changes. Deferred a tick so the just-placed
  // stone paints before the ~66ms forward pass blocks the main thread.
  useEffect(() => {
    if (!analysisOn) { setAnalysis(null); return }
    if (thinking || !netRef.current) return   // the search already owns the main thread; keep the last reading up
    let cancelled = false
    const timer = window.setTimeout(() => {
      if (cancelled) return
      setAnalysis({ ...analyzePosition(netRef.current, view), for: view })
    }, 0)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [analysisOn, thinking, view, netReady])

  const fresh = analysis?.for === view
  const occupied = view.provisional.board.filter(v => v != null).length
  // A stale reading points at cells that may now be occupied, so hints only ever come
  // from a reading that matches what is on screen; review always shows them, otherwise
  // only on the human's own turn.
  const hints = useMemo(() => {
    if (!fresh || !analysis || analysis.terminal || (!reviewing && computerToMove)) return NO_HINTS
    return new Map(analysis.moves.slice(0, 3).map((m, i) => [m.cell, { rank: i + 1, prob: m.prob }]))
  }, [fresh, analysis, reviewing, computerToMove])

  const recentSummary = view.recentEffects?.length
    ? view.recentEffects.map(e => `${e.player === BLACK ? '흑' : '백'} ${e.cell != null ? coord(e.cell) : ''} 착수 · ${e.flips?.length ?? 0}개 뒤집힘`).join(', ')
    : '없음'
  const lastMove = view.recentEffects?.length
    ? { who: view.recentEffects[0].player, cells: view.recentEffects.map(e => e.cell).filter(c => c != null) }
    : null
  const modeLabel = MODES.find(m => m.id === mode)?.label ?? '2인 대전'
  const need = placementsNeeded(view)
  // A turn that cannot be finished: with no stone down the player passes, and with one
  // down they have walked into a dead end and must take it back.
  const placedNow = state.provisional.placements.length
  const deadTurn = !state.terminal && !canCompleteTurn(state)
  const stuck = deadTurn && placedNow === 0
  const deadEnd = deadTurn && placedNow > 0
  const shortTurn = !deadTurn && placedNow === 1 && placementsNeeded(state) === 1
    && state.turnStart.turnNumber !== 0
  const passes = passNotice(view)
  // with a stone already down this is the second-stone skip, not a pass
  const commitLabel = stuck ? '턴 패스' : shortTurn ? '턴 확정 (둘째 수 생략)' : '턴 확정'

  const canSave = !reviewing && state.history.length > 0
  const shareLink = canSave ? `${location.origin}${location.pathname}?g=${formatUrl(state.history)}` : ''

  const handleDownload = () => {
    if (!canSave) return
    const humanColor = humanSide === BLACK ? 'BLACK' : 'WHITE'
    const text = formatText(replay(state.history), { date: todayISO(), mode, human: humanColor })
    const blob = new Blob([text], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `reversix-${todayISO()}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareLink)
      setCopyStatus('링크를 복사했습니다.')
    } catch {
      setCopyStatus('링크 복사에 실패했습니다. 직접 선택해 복사하세요.')
    }
  }

  const handleReviewStep = useCallback(delta => {
    setReview(r => {
      if (!r) return r
      const total = r.rep.states.length
      const next = Math.max(0, Math.min(total - 1, r.index + delta))
      return next === r.index ? r : { ...r, index: next }
    })
  }, [])

  // In review mode this renders below ReviewControls instead of above the board (see the
  // <main> JSX below): its line count varies from position to position — 직전 수, pass
  // notices, 체크, announcements and 게임 종료 all come and go — and above the board that
  // shift carries the 처음/이전/다음/마지막 buttons along with it, sliding them out from under
  // the pointer while stepping. Below ReviewControls the same shifting is harmless.
  const statusSection = (
    <section aria-live="polite">
      <p>모드: <strong>{modeLabel}</strong>{mode !== 'human' && mode !== 'review' && <> · 나는 {label(humanSide)}, 컴퓨터는 {label(computerSide)}</>}</p>
      <p>현재 플레이어: <strong>{label(view.activePlayer)}</strong>{thinking && <span className="thinking"> · 생각 중{progress ? ` ${progress[0]}/${progress[1]}` : ''}…</span>}</p>
      <p>필요한 배치: {need} / 현재 배치: {view.provisional.placements.length}</p>
      {lastMove && <p className="last-move-line">직전 수 — <strong>{label(lastMove.who)}</strong> {lastMove.cells.map(coord).join(' → ')}</p>}
      {passes.map((t, i) => <p key={i} className="pass-notice">{t}</p>)}
      {!reviewing && stuck && <p className="stuck-notice">둘 수 있는 곳이 없습니다.</p>}
      {!reviewing && deadEnd && <p className="stuck-notice">이 수를 두면 둘째 수를 둘 곳이 없습니다. 턴을 초기화하고 다른 곳에 두세요.</p>}
      {view.checkedPlayer && <p>체크: {label(view.checkedPlayer)}</p>}
      {netStatus && <p>{netStatus}</p>}
      {view.announcement && <p>{view.announcement}</p>}
      {view.terminal && <p>게임 종료: {outcomeText(view)}</p>}
      {reviewing && review.rep.error && (
        <p className="stuck-notice">
          기보가 {review.rep.error.index + 1}번째 수({coord(review.rep.error.cell)})에서 깨졌습니다: {review.rep.error.reason} — 그 앞까지는 넘겨볼 수 있습니다.
        </p>
      )}
    </section>
  )

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>Reversix</h1>
        <div className="control-group">
          <button ref={rulesButton} className="control" onClick={openRules}>규칙</button>
          <button ref={newButton} className="control" onClick={openNew}>새 게임</button>
        </div>
        <div className="control-group save-controls">
          <button className="control" disabled={!canSave} onClick={handleDownload}>기보 저장</button>
          <input
            className="share-link-input"
            type="text"
            readOnly
            value={shareLink}
            placeholder="대국을 시작하면 공유 링크가 생깁니다"
            aria-label="공유 링크"
            onFocus={e => e.target.select()}
          />
          <button className="control" disabled={!canSave} onClick={handleCopyLink}>복사</button>
          {copyStatus && <span className="copy-status" aria-live="polite">{copyStatus}</span>}
        </div>
      </header>
      <main className="app-main">
        {linkError && <p className="stuck-notice">공유 링크를 열지 못했습니다: {linkError}</p>}
        {!reviewing && statusSection}
        {analysisOn && analysis && (
          <EvalBar blackWin={analysis.blackWin} occupied={occupied} moves={analysis.moves} stale={!fresh}/>
        )}
        <Board state={view} dispatch={dispatch} locked={computerToMove || thinking} review={reviewing} onStep={handleReviewStep} hints={hints}/>
        {reviewing ? (
          <ReviewControls
            index={review.index}
            total={review.rep.states.length}
            caption={reviewCaption(review.rep, review.index)}
            onSeek={idx => setReview(r => (r ? { ...r, index: idx } : r))}
          />
        ) : (
          <div className="control-group">
            <button className="control" disabled={state.provisional.placements.length === 0 || !!state.terminal || computerToMove} onClick={() => dispatch({ type: 'RESET_TURN' })}>턴 초기화</button>
            <button className="control primary" disabled={!turnComplete(state) || !!state.terminal || computerToMove} onClick={() => dispatch({ type: 'COMMIT_TURN' })}>{commitLabel}</button>
          </div>
        )}
        {reviewing && statusSection}
        <p>최근 효과: {recentSummary}</p>
      </main>
      <RulesDialog open={rulesOpen} onClose={closeRules}/>
      <ModeDialog unavailable={modelMissing ? { net: '학습된 가중치가 아직 없습니다' } : {}} practiceDisabled={modelMissing} defaultPractice={practice} open={modeOpen} onClose={() => { setModeOpen(false); newButton.current?.focus() }} onStart={chooseMode}/>
    </div>
  )
}
