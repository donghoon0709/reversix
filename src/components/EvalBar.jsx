import { BOARD_SIZE } from '../game/rules.js'

function coordinate(cell) {
  return `${String.fromCharCode(65 + (cell % BOARD_SIZE))}${Math.floor(cell / BOARD_SIZE) + 1}`
}

// Below 24 stones the value head's sign accuracy is ~0.51 (barely better than a coin
// flip); it climbs to ~0.76 past 64 stones. See artifacts/analysis-r3-20260908/value-by-phase.json.
const LOW_CONFIDENCE_OCCUPIED = 24

export default function EvalBar({ blackWin, occupied, moves, stale }) {
  const blackPct = Math.round(blackWin * 100)
  const whitePct = 100 - blackPct
  const lowConfidence = occupied < LOW_CONFIDENCE_OCCUPIED

  return (
    <div className={`eval-panel${stale ? ' eval-panel-stale' : ''}`}>
      <div
        aria-label={`흑 승률 ${blackPct}퍼센트, 백 승률 ${whitePct}퍼센트`}
        className="eval-bar"
        data-testid="eval-bar"
        role="img"
      >
        <div className="eval-bar-black" style={{ width: `${blackPct}%` }} />
        <div className="eval-bar-white" style={{ width: `${whitePct}%` }} />
      </div>
      <p aria-live="polite" className="eval-value" data-testid="eval-value">
        흑 {blackPct}% : 백 {whitePct}%
        {stale && <span aria-hidden="true" className="eval-stale-mark"> (재계산 중)</span>}
      </p>
      {stale && <span className="sr-only">평가값을 다시 계산하고 있습니다</span>}
      {lowConfidence && <p className="eval-caveat">초반 평가는 신뢰도가 낮습니다</p>}
      <p className="eval-hints" data-testid="eval-hints">
        {moves.length === 0
          ? '추천 착수 없음'
          : `추천 — ${moves.slice(0, 3).map(({ cell, prob }) => `${coordinate(cell)} ${Math.round(prob * 100)}%`).join(' · ')}`}
      </p>
    </div>
  )
}
