export default function ReviewControls({ index, total, caption, onSeek }) {
  const atStart = index <= 0
  const atEnd = index >= total - 1

  function seek(nextIndex) {
    const clamped = Math.max(0, Math.min(total - 1, nextIndex))
    if (clamped === index) return
    onSeek(clamped)
  }

  return (
    <div className="control-group review-controls" aria-label="감상 모드 탐색">
      <button className="control" disabled={atStart} onClick={() => seek(0)} type="button">처음</button>
      <button className="control" disabled={atStart} onClick={() => seek(index - 1)} type="button">이전</button>
      <button className="control" disabled={atEnd} onClick={() => seek(index + 1)} type="button">다음</button>
      <button className="control" disabled={atEnd} onClick={() => seek(total - 1)} type="button">마지막</button>
      <span className="review-position" aria-live="polite">
        {`${index + 1} / ${total}`}
        {caption ? ` — ${caption}` : ''}
      </span>
    </div>
  )
}
