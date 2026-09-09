import { useEffect, useRef, useState } from 'react'
import { parseRecord } from '../game/record.js'

export const MODES = [
  { id: 'human', label: '2인 대전', hint: '한 기기에서 번갈아 둡니다' },
  { id: 'net', label: 'AZ-32', hint: '자기대국으로 학습한 신경망 · 매 수 32회 탐색' },
  { id: 'review', label: '기보 감상', hint: '저장한 기보 파일이나 링크를 불러와 다시 봅니다' },
]

export const SIDES = [
  { id: 'black', label: '선공 (흑)', hint: '먼저 두며, 첫 턴은 한 수입니다' },
  { id: 'white', label: '후공 (백)', hint: '컴퓨터가 먼저 둡니다' },
]

export default function ModeDialog({ open, onClose, onStart, unavailable = {}, practiceDisabled = false, defaultPractice = false }) {
  const ref = useRef(null)
  const cancelRef = useRef(null)
  const [mode, setMode] = useState(null)
  const [pasted, setPasted] = useState('')
  const [loadError, setLoadError] = useState('')
  const [practice, setPractice] = useState(defaultPractice)

  useEffect(() => {
    const d = ref.current
    if (open && d && !d.open) { d.showModal(); cancelRef.current?.focus() }
    if (!open && d?.open) d.close()
    if (!open) { setMode(null); setPasted(''); setLoadError('') } else { setPractice(defaultPractice) }
  }, [open, defaultPractice])

  const pickMode = id => {
    if (id === 'human') { onStart(id, 'black', null, practice); return }
    setMode(id)                       // computer opponents need a side as well; review needs a file
  }

  const loadRecord = text => {
    try {
      const { cells } = parseRecord(text)
      setLoadError('')
      onStart('review', null, cells)
    } catch (err) {
      setLoadError(err.message)
    }
  }

  const handleFile = async event => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    loadRecord(await file.text())
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
          <label className="control-group practice-toggle">
            <input
              type="checkbox"
              data-testid="practice-toggle"
              checked={practice}
              disabled={practiceDisabled}
              onChange={e => setPractice(e.target.checked)}
            />
            <span>
              <strong>연습 모드</strong>
              <small>{practiceDisabled ? '학습된 가중치가 아직 없습니다' : '우세 막대와 추천 착수를 보드에 표시합니다'}</small>
            </span>
          </label>
          <div className="control-group">
            <button ref={cancelRef} className="control" onClick={onClose}>취소</button>
          </div>
        </>
      ) : mode === 'review' ? (
        <>
          <h2>기보 불러오기</h2>
          <p>저장한 .txt 기보 파일을 고르거나, 기보 텍스트 또는 공유 링크를 붙여넣으세요.</p>
          <p>기보 감상에서는 연습 모드와 상관없이 항상 우세 막대와 추천 착수가 표시됩니다.</p>
          <div className="control-group">
            <input type="file" accept=".txt" onChange={handleFile} data-testid="record-file-input"/>
          </div>
          <textarea
            className="record-paste"
            data-testid="record-paste-input"
            placeholder="기보 텍스트 또는 링크 붙여넣기"
            value={pasted}
            onChange={e => setPasted(e.target.value)}
            rows={6}
          />
          {loadError && <p className="stuck-notice" data-testid="record-load-error">{loadError}</p>}
          <div className="control-group">
            <button className="control primary" type="button" disabled={!pasted.trim()}
                    onClick={() => loadRecord(pasted)}>불러오기</button>
            <button className="control" onClick={() => setMode(null)}>뒤로</button>
            <button ref={cancelRef} className="control" onClick={onClose}>취소</button>
          </div>
        </>
      ) : (
        <>
          <h2>선공 · 후공</h2>
          <p>{MODES.find(m => m.id === mode)?.label} 상대로 어느 쪽을 잡으시겠습니까?</p>
          <div className="mode-list">
            {SIDES.map(sd => (
              <button key={sd.id} className="control mode-option" onClick={() => onStart(mode, sd.id, null, practice)} type="button">
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
