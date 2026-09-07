import { useEffect, useRef } from 'react'
export default function NewGameDialog({ open, onClose, onConfirm }) {
  const ref = useRef(null)
  const cancelRef = useRef(null)
  useEffect(() => { const d = ref.current; if (open && d && !d.open) { d.showModal(); cancelRef.current?.focus() } if (!open && d?.open) d.close() }, [open])
  return <dialog ref={ref} className="dialog" onCancel={e => { e.preventDefault(); onClose() }} onClose={onClose}><h2>새 게임</h2><p>현재 게임을 끝내고 새 게임을 시작할까요?</p><div className="control-group"><button className="control primary" onClick={onConfirm}>새 게임 시작</button><button ref={cancelRef} className="control" onClick={onClose}>취소</button></div></dialog>
}
