import { useEffect, useRef } from 'react'
export default function RulesDialog({ open, onClose }) {
  const ref = useRef(null)
  useEffect(() => { const d = ref.current; if (open && d && !d.open) d.showModal(); if (!open && d?.open) d.close() }, [open])
  return <dialog ref={ref} className="dialog" onCancel={e => { e.preventDefault(); onClose() }} onClose={onClose}><h2>게임 규칙</h2><p>게임은 중앙의 흑·백 돌 두 개씩으로 시작하며, 흑은 첫 턴에 한 수를 둡니다. 이후에는 한 턴에 두 수를 둡니다. 상대 돌을 한 개 이상 양끝에서 끼워 뒤집을 수 있는 빈칸에만 착수할 수 있습니다. 돌을 놓으면 8방향으로 둘러싼 상대 돌을 즉시 뒤집으며 연쇄 뒤집기는 없습니다. 가로·세로·대각선으로 끊긴 데 없이 <strong>정확히 여섯 개</strong>가 이어지면 SIX이며 상대에게 체크를 겁니다. 일곱 개 이상은 SIX가 아니므로, 자기 SIX를 늘리면 오히려 체크가 풀립니다. 체크를 받은 쪽은 다음 한 턴 안에 상대의 SIX를 모두 없애야 하고, 실패하면 패배합니다. 둘 곳이 없으면 패스하며, 양쪽이 연달아 패스하면 돌 개수로 승패를 가립니다.</p><button className="control" onClick={onClose}>닫기</button></dialog>
}
