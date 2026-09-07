import { useEffect, useRef } from 'react'
export default function RulesDialog({ open, onClose }) {
  const ref = useRef(null)
  useEffect(() => { const d = ref.current; if (open && d && !d.open) d.showModal(); if (!open && d?.open) d.close() }, [open])
  return <dialog ref={ref} className="dialog" onCancel={e => { e.preventDefault(); onClose() }} onClose={onClose}><h2>게임 규칙</h2><p>게임은 중앙의 흑·백 돌 두 개씩으로 시작하며, 흑은 첫 턴에 한 수를 둡니다. 이후에는 한 턴에 두 수를 둡니다. 상대 돌을 한 개 이상 양끝에서 끼워 뒤집을 수 있는 빈칸에만 착수할 수 있습니다. 돌을 놓으면 8방향으로 둘러싼 상대 돌을 즉시 뒤집으며 연쇄 뒤집기는 없습니다. 같은 턴 두 돌 사이에 상대 돌이 끊기지 않고 4개 이상이면 둘째 수는 금수입니다. 여섯 개 이상 연속하면 상대에게 체크를 선언하고, 체크 상태에서 상대 육목을 모두 끊지 못하면 패배합니다.</p><button className="control" onClick={onClose}>닫기</button></dialog>
}
