import { useEffect, useReducer, useRef, useState } from 'react'
import Board from './components/Board.jsx'
import RulesDialog from './components/RulesDialog.jsx'
import NewGameDialog from './components/NewGameDialog.jsx'
import { createInitialGame, reduceGame, requiredPlacements, BLACK, WHITE } from './game/rules.js'

export default function App() {
  const [state, dispatch] = useReducer(reduceGame, undefined, createInitialGame)
  const [rulesOpen, setRulesOpen] = useState(false), [newOpen, setNewOpen] = useState(false)
  const rulesButton = useRef(null), newButton = useRef(null)
  const pristine = state.provisional.placements.length === 0 && !state.terminal && !state.checkedPlayer && !state.recentEffects?.length
  useEffect(() => { if (performance.getEntriesByType('navigation')[0]?.type === 'reload') window.setTimeout(() => alert('페이지를 새로고침했습니다. 새 게임 상태로 시작합니다.'), 0) }, [])
  const player = state.activePlayer === BLACK ? '검은색' : '흰색'
  const openRules = () => { rulesButton.current = document.activeElement; setRulesOpen(true) }
  const closeRules = () => { setRulesOpen(false); rulesButton.current?.focus() }
  const openNew = () => { newButton.current = document.activeElement; pristine ? dispatch({ type: 'RESET_TURN' }) : setNewOpen(true) }
  const confirmNew = () => { setNewOpen(false); dispatch({ type: 'NEW_GAME' }); newButton.current?.focus() }
  const recentSummary = state.recentEffects?.length
    ? state.recentEffects.map(effect => `${effect.player === BLACK ? '검은' : '흰'} ${effect.cell != null ? String.fromCharCode(65 + effect.cell % 15) + (Math.floor(effect.cell / 15) + 1) : ''} 착수 · ${effect.flips?.length ?? 0}개 뒤집힘`).join(', ')
    : '없음'
  return <div className="app-shell"><header className="app-header"><h1>Reversix</h1><div className="control-group"><button ref={rulesButton} className="control" onClick={openRules}>규칙</button><button ref={newButton} className="control" onClick={openNew}>새 게임</button></div></header><main className="app-main"><section aria-live="polite"><p>현재 플레이어: <strong>{player}</strong></p><p>필요한 배치: {requiredPlacements(state.turnStart)} / 현재 배치: {state.provisional.placements.length}</p>{state.checkedPlayer && <p>체크: {state.checkedPlayer === BLACK ? '검은색' : '흰색'}</p>}{state.announcement && <p>{state.announcement}</p>}{state.terminal && <p>게임 종료: {state.terminal.winner ? `${state.terminal.winner === BLACK ? '검은색' : '흰색'} 승리` : '무승부'}</p>}</section><Board state={state} dispatch={dispatch}/><div className="control-group"><button className="control" disabled={state.provisional.placements.length === 0 || !!state.terminal} onClick={() => dispatch({ type: 'RESET_TURN' })}>턴 초기화</button><button className="control primary" disabled={state.provisional.placements.length !== requiredPlacements(state.turnStart) || !!state.terminal} onClick={() => dispatch({ type: 'COMMIT_TURN' })}>턴 확정</button></div><p>최근 효과: {recentSummary}</p></main><RulesDialog open={rulesOpen} onClose={closeRules}/><NewGameDialog open={newOpen} onClose={() => { setNewOpen(false); newButton.current?.focus() }} onConfirm={confirmNew}/></div>
}
