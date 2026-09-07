import { useEffect, useRef } from 'react'
export default function RulesDialog({ open, onClose }) {
  const ref = useRef(null)
  useEffect(() => { const d = ref.current; if (open && d && !d.open) d.showModal(); if (!open && d?.open) d.close() }, [open])
  return <dialog ref={ref} className="dialog" onCancel={e => { e.preventDefault(); onClose() }} onClose={onClose}><h2>게임 규칙</h2><p>각 턴에 필요한 수만큼 돌을 놓습니다. 여섯 개 이상 연속하면 상대에게 체크를 선언합니다. 체크 상태에서 방어하지 못하면 승리합니다.</p><button className="control" onClick={onClose}>닫기</button></dialog>
}
