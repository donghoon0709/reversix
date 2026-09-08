import { useEffect, useRef } from 'react'

export const MODES = [
  { id: 'human', label: '2인 대전', hint: '한 기기에서 번갈아 둡니다' },
  { id: 'greedy', label: '컴퓨터 · 휴리스틱', hint: '창(window) 포텐셜로 한 턴을 통째로 평가합니다' },
  { id: 'iter24', label: '컴퓨터 · 학습 에이전트', hint: '자기대국 14,400판으로 학습한 신경망 (iter 24)' },
]

export default function ModeDialog({ open, onClose, onSelect }) {
  const ref = useRef(null)
  const cancelRef = useRef(null)
  useEffect(() => {
    const d = ref.current
    if (open && d && !d.open) { d.showModal(); cancelRef.current?.focus() }
    if (!open && d?.open) d.close()
  }, [open])
  return (
    <dialog ref={ref} className="dialog" onCancel={e => { e.preventDefault(); onClose() }} onClose={onClose}>
      <h2>새 게임</h2>
      <p>상대를 고르세요. 컴퓨터는 항상 흰색을 잡습니다.</p>
      <div className="mode-list">
        {MODES.map((m, i) => (
          <button
            key={m.id}
            className="control mode-option"
            onClick={() => onSelect(m.id)}
            type="button"
          >
            <strong>{m.label}</strong>
            <small>{m.hint}</small>
          </button>
        ))}
      </div>
      <div className="control-group"><button ref={cancelRef} className="control" onClick={onClose}>취소</button></div>
    </dialog>
  )
}
