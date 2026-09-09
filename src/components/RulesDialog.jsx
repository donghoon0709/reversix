import { Fragment, useEffect, useRef, useState } from 'react'

// '.' empty, 'B' black, 'W' white, '*' a cell you may play, 'x' a banned cell, and a
// digit for a stone the side to move has just placed, numbered as the board numbers them.
// The squares alternate the same way the real board does, so a figure reads as a board.
const Grid = ({ rows, mover = 'B' }) => (
  <div className="rule-grid">
    {rows.map((row, r) => (
      <div className="rule-row" key={r}>
        {[...row].map((ch, c) => (
          <span key={c} className={`rule-cell${(r + c) % 2 ? ' rule-cell--dark' : ''}`}>
            {r === 0 && <span className="coord coord-file" aria-hidden="true">{String.fromCharCode(65 + c)}</span>}
            {c === 0 && <span className="coord coord-rank" aria-hidden="true">{r + 1}</span>}
            {ch === 'B' && <i className="rule-stone rule-stone--black" />}
            {ch === 'W' && <i className="rule-stone rule-stone--white" />}
            {ch === '*' && <i className="rule-dot" />}
            {ch === 'x' && '🚫'}
            {'12'.includes(ch) && (
              <i className={`rule-stone rule-stone--${mover === 'W' ? 'white' : 'black'}`}>{ch}</i>
            )}
          </span>
        ))}
      </div>
    ))}
  </div>
)

const BoardRow = ({ boards, mover }) => (
  <div className="rule-boards">
    {boards.map((grid, i) => (
      <Fragment key={i}>
        {i > 0 && <span className="rule-arrow" aria-hidden="true">→</span>}
        <Grid rows={grid} mover={mover} />
      </Fragment>
    ))}
  </div>
)

/**
 * One board (`rows`), several joined by arrows (`boards`), or several such rows stacked
 * (`pairs`) when a chapter shows two independent examples side by side.
 */
const Figure = ({ rows, boards, pairs, mover, caption }) => (
  <figure className="rule-figure">
    <div className="rule-stack">
      {(pairs ?? [boards ?? [rows]]).map((row, i) => <BoardRow key={i} boards={row} mover={mover} />)}
    </div>
    {caption && <figcaption>{caption}</figcaption>}
  </figure>
)

export const PAGES = [
  {
    title: '첫 수',
    body: (
      <>
        <p>중앙 2×2에 백돌과 흑돌이 두 개씩 놓인 채로 시작하고, <strong>흑이 먼저</strong> 둡니다.</p>
        <p>흑의 <strong>첫 턴만 한 수</strong>이고, 그 뒤로는 양쪽 모두 <strong>한 턴에 두 수</strong>를 둡니다.</p>
      </>
    ),
    figure: {
      rows: ['..........', '..........', '..........', '..........', '....WB....',
             '....BW....', '..........', '..........', '..........', '..........'],
      caption: '10×10 판 한가운데 2×2 시작 배치',
    },
  },
  {
    title: '착수 (1/3)',
    body: (
      <>
        <p><strong>상대 돌을 자기 돌 사이에 끼울 수 있는 빈칸</strong>에만 둘 수 있고, 착수하면 끼인 상대 돌이 즉시 뒤집힙니다.</p>
      </>
    ),
    figure: {
      boards: [
        ['.*..', '*WB.', '.BW*', '..*.'],
        ['....', '.WB.', '.BB.', '..1.'],
      ],
      caption: '흑이 둘 수 있는 네 곳 · 그중 C4에 두면 끼인 백돌이 뒤집힙니다',
    },
  },
  {
    title: '착수 (2/3)',
    body: (
      <>
        <p>한 턴은 <strong>두 수</strong>입니다. 첫 수를 두면 끼인 돌이 <strong>그 자리에서 바로 뒤집히고</strong>, 바뀐 판을 기준으로 둘째 수의 착수 가능 구역을 다시 계산합니다.</p>
        <p>그래서 첫 수 전에는 없던 자리가 둘째 수에서 열리기도 합니다. 위 예시에서는 D2에 첫 수를 둬 C2가 뒤집힌 덕분에 <strong>A4가 새로 생겼고</strong>, 거기에 둘째 수를 둡니다.</p>
      </>
    ),
    figure: {
      mover: 'W',
      boards: [
        ['....', '.WB*', '.BB.', '.*B*'],
        ['....', '.WW1', '.BB.', '**B*'],
        ['....', '.WW1', '.WB.', '2.B.'],
      ],
      caption: '백의 차례 — 착수 가능한 세 곳 · D2에 첫 수 · 새로 열린 A4에 둘째 수',
    },
  },
  {
    title: '착수 (3/3)',
    body: (
      <>
        <p>한 수가 뒤집는 것은 한 개가 아닙니다. 놓은 자리에서 <strong>여덟 방향을 모두 살펴</strong>, 자기 돌로 막힌 상대 돌 줄을 <strong>전부 한꺼번에</strong> 뒤집습니다.</p>
        <p>줄이 두 개 이상 이어져 있으면 그만큼 통째로 뒤집히고, <strong>여러 방향이 동시에</strong> 걸리면 그 방향들이 함께 뒤집힙니다.</p>
      </>
    ),
    figure: {
      pairs: [
        [['....', '*WWB', '....', '....'], ['....', '1BBB', '....', '....']],
        [['....', '.*WB', '.W..', '.B..'], ['....', '.1BB', '.B..', '.B..']],
      ],
      caption: '위: 한 방향으로 이어진 백돌 두 개를 한꺼번에 · 아래: 서로 다른 두 방향의 백돌을 한 수로',
    },
  },
  {
    title: '체크 (SIX)',
    body: (
      <>
        <p>가로·세로·대각선으로 자기 돌이 <strong>정확히 여섯 개</strong> 이어지면 SIX이고, 턴이 끝나는 순간 상대에게 <strong>체크</strong>가 걸립니다.</p>
        <p>SIX를 만들었다고 바로 이기는 것은 아닙니다. 상대가 다음 한 턴 안에 그것을 없애지 못해야 승리합니다.</p>
      </>
    ),
    figure: {
      rows: ['........', '.BBBBBB.', '.BB.....', '.B.B....', '.B..B...', '.B...B..', '.B....B.', '........'],
      caption: 'B2의 한 돌을 공유하는 가로·세로·대각선 SIX 세 개',
    },
  },
  {
    title: '체크 방어',
    body: (
      <>
        <p>체크를 받은 쪽은 <strong>다음 한 턴 안에 상대의 SIX를 모두 없애야</strong> 합니다. 하나라도 남으면 그 자리에서 패배합니다.</p>
        <p>없애는 방법은 그 줄의 돌을 뒤집는 것입니다. 방어에 성공하면서 자기 SIX를 만들면 이번에는 <strong>상대가 체크</strong>를 받습니다.</p>
      </>
    ),
    figure: {
      boards: [
        ['........', '........', '...*....', '.WWWWWW.', '...B....', '...B....', '...B....', '...B....'],
        ['........', '........', '...B....', '.WWBWWW.', '...B....', '...B....', '...B....', '...B....'],
      ],
      caption: '흑이 백 SIX의 한 돌을 뒤집어 끊으면서, 그 돌로 세로 SIX를 완성 — 이번엔 백이 체크',
    },
  },
  {
    title: '정확히 여섯 개만',
    body: (
      <>
        <p>일곱 개 이상 이어진 줄은 <strong>SIX가 아닙니다</strong>. 길수록 좋은 것이 아니라, 정확히 여섯일 때만 효력이 있습니다.</p>
      </>
    ),
    figure: { rows: ['.BBBBBB.', 'BBBBBBB.'], caption: '위: SIX · 아래: 일곱 개, 효력 없음' },
  },
  {
    title: '금수',
    body: (
      <>
        <p>상대의 일곱 줄 끝을 뒤집으면 여섯 개가 남아 <strong>상대에게 SIX를 만들어 주게</strong> 됩니다. 그런 자리는 <strong>금수</strong>이고 🚫로 표시됩니다.</p>
        <p>판정은 <strong>둘째 수</strong>에만 적용됩니다. 즉, 첫 수에는 금수가 없고, 둘째 수를 고를 때 첫 수까지 반영해 금수가 결정됩니다.</p>
      </>
    ),
    figure: {
      rows: ['..........', '..........', '..........', '.......x..', '.WWWWWWW..', '.......B..',
             '..........', '..........', '..........', '..........'],
      caption: '여기에 두면 백 일곱 줄의 끝 한 개가 뒤집혀 정확히 여섯이 남습니다 — 금수',
    },
  },
  {
    title: '패스',
    body: (
      <>
        <p>둘 곳이 아예 없거나, 둘 수 있는 자리가 <strong>모두 금수</strong>여서 턴을 마칠 수 없으면 그 턴은 <strong>패스</strong>입니다. 그 턴에는 한 수도 두지 못하고 상대방에게 턴이 넘어갑니다.</p>
        <p>양쪽이 <strong>연달아 패스</strong>하면 판 위의 돌을 세어 많은 쪽이 <strong>승리</strong>하고, 같으면 <strong>무승부</strong>입니다.</p>
      </>
    ),
    figure: {
      rows: ['WWWWWWWBBW', 'WWWWWWWBBx', 'BWWBWBBBBx', 'BBWBBBWBBW', 'BBBWBWWBBW',
             'BBBBWWBBBW', 'BBWBBWBBBW', 'BBWWBBWBBW', 'BBWWWBBBBx', 'BBBBBBBBBB'],
      caption: '백 차례 — 빈 세 칸 모두 백에게 금수라 둘 수 없고, 패스합니다',
    },
  },
]

export default function RulesDialog({ open, onClose }) {
  const ref = useRef(null)
  const closeRef = useRef(null)
  const prevRef = useRef(null)
  const nextRef = useRef(null)
  const [page, setPage] = useState(0)

  useEffect(() => {
    const d = ref.current
    if (open && d && !d.open) { d.showModal(); setPage(0); closeRef.current?.focus() }
    if (!open && d?.open) d.close()
  }, [open])

  const last = PAGES.length - 1
  const p = PAGES[page]

  // reaching either end disables the button that was just used; without moving focus it
  // lands on nothing and the arrow-key handler below stops receiving events
  useEffect(() => {
    const active = document.activeElement
    if (active === prevRef.current && page === 0) closeRef.current?.focus()
    if (active === nextRef.current && page === last) closeRef.current?.focus()
  }, [page, last])

  return (
    <dialog ref={ref} className="dialog rules-dialog"
            onCancel={e => { e.preventDefault(); onClose() }} onClose={onClose}
            onKeyDown={e => {
              if (e.key === 'ArrowRight') { e.preventDefault(); setPage(n => Math.min(last, n + 1)) }
              if (e.key === 'ArrowLeft') { e.preventDefault(); setPage(n => Math.max(0, n - 1)) }
            }}>
      <div className="dialog-head">
        <h2>게임 규칙</h2>
        <button ref={closeRef} className="dialog-close" aria-label="닫기" onClick={onClose}>×</button>
      </div>
      <div className="rule-page" aria-live="polite">
        <h3>{page + 1}. {p.title}</h3>
        {p.figure && <Figure {...p.figure} />}
        {p.body}
      </div>
      <p className="rule-count">{page + 1} / {PAGES.length}</p>
      <div className="control-group">
        <button ref={prevRef} className="control" onClick={() => setPage(n => Math.max(0, n - 1))} disabled={page === 0}>이전</button>
        <button ref={nextRef} className="control" onClick={() => setPage(n => Math.min(last, n + 1))} disabled={page === last}>다음</button>
      </div>
    </dialog>
  )
}
