import { useEffect, useRef, useState } from 'react'

export const MODES = [
  { id: 'human', label: '2인 대전', hint: '한 기기에서 번갈아 둡니다' },
  { id: 'greedy', label: '컴퓨터 · 휴리스틱', hint: '창(window) 포텐셜로 한 턴을 통째로 평가합니다' },
  { id: 'net', label: '컴퓨터 · 학습 에이전트', hint: '자기대국으로 학습한 신경망' },
]

export const SIDES = [
  { id: 'black', label: '선공 (검은색)', hint: '먼저 두며, 첫 턴은 한 수입니다' },
  { id: 'white', label: '후공 (흰색)', hint: '컴퓨터가 먼저 둡니다' },
]

export default function ModeDialog({ open, onClose, onStart, unavailable = {} }) {
  const ref = useRef(null)
  const cancelRef = useRef(null)
  const [mode, setMode] = useState(null)

  useEffect(() => {
    const d = ref.current
    if (open && d && !d.open) { d.showModal(); cancelRef.current?.focus() }
    if (!open && d?.open) d.close()
    if (!open) setMode(null)
  }, [open])

  const pickMode = id => {
    if (id === 'human') { onStart(id, 'black'); return }
    setMode(id)                       // computer opponents need a side as well
  }

  return (
    <dialog ref={ref} className="dialog" onCancel={e => { e.preventDefault(); onClose() }} onClose={onClose}>
      {!mode ? (
        <>
          <h2>새 게임</h2>
          <p>상대를 고르세요.</p>
          <div className="mode-list">
            {MODES.map(m => (
              <button key={m.id} className="control mode-option" onClick={() => pickMode(m.id)}
                      disabled={!!unavailable[m.id]} type="button">
                <strong>{m.label}</strong>
                <small>{unavailable[m.id] || m.hint}</small>
              </button>
            ))}
          </div>
          <div className="control-group">
            <button ref={cancelRef} className="control" onClick={onClose}>취소</button>
          </div>
        </>
      ) : (
        <>
          <h2>선공 · 후공</h2>
          <p>{MODES.find(m => m.id === mode)?.label} 상대로 어느 쪽을 잡으시겠습니까?</p>
          <div className="mode-list">
            {SIDES.map(sd => (
              <button key={sd.id} className="control mode-option" onClick={() => onStart(mode, sd.id)} type="button">
                <strong>{sd.label}</strong>
                <small>{sd.hint}</small>
              </button>
            ))}
          </div>
          <div className="control-group">
            <button className="control" onClick={() => setMode(null)}>뒤로</button>
            <button ref={cancelRef} className="control" onClick={onClose}>취소</button>
          </div>
        </>
      )}
    </dialog>
  )
}
