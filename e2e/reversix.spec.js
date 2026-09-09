import { test, expect } from '@playwright/test'

/** The site greets every visitor with the opponent chooser, and it is modal — nothing on
 *  the board can be touched until a mode is picked. */
const startTwoPlayer = async page => {
  await page.goto('/')
  await page.getByRole('button', { name: '2인 대전' }).click()
  // choosing a mode closes the dialog, starts a new game and moves focus onto the board;
  // a test that touches the board before that would have its focus stolen
  await expect(page.getByRole('dialog')).toBeHidden()
  await expect(page.getByText('모드:')).toContainText('2인 대전')
  // focus settles on 새 게임 a moment after the dialog closes; touching the board before
  // that would have its focus stolen back
  await expect(page.getByRole('button', { name: '새 게임' })).toBeFocused()
}

/** Pick AZ-32 and a colour, then wait for the weights to land: the board is only reset
 *  once they have, and a stone placed before that is thrown away. */
const startVsAgent = async (page, side = /선공/) => {
  await page.goto('/')
  await page.getByRole('button', { name: /AZ-32/ }).click()
  await page.getByRole('button', { name: side }).click()
  await expect(page.getByText('모드:')).toContainText('AZ-32', { timeout: 60000 })
}

/** Same as startTwoPlayer, but checks the practice toggle before starting — the shortest
 *  path into a two-player game with the eval bar and move hints turned on. */
const startTwoPlayerPractice = async page => {
  await page.goto('/')
  await page.getByTestId('practice-toggle').check()
  await page.getByRole('button', { name: '2인 대전' }).click()
  await expect(page.getByRole('dialog')).toBeHidden()
  await expect(page.getByText('모드:')).toContainText('2인 대전')
  await expect(page.getByRole('button', { name: '새 게임' })).toBeFocused()
}

/** Plays Black's one-stone opening and White's full two-stone turn, saves the result, and
 *  opens the share link — the shortest deterministic path into review mode for tests that
 *  only care about the review UI itself, not about how the game got there. */
const startReview = async page => {
  await startTwoPlayer(page)
  await page.getByRole('gridcell', { name: /E4 빈 칸/ }).click()
  await page.getByRole('button', { name: '턴 확정' }).click()
  await page.locator('.is-legal').first().click()
  await page.locator('.is-legal').first().click()
  await page.getByRole('button', { name: '턴 확정' }).click()
  const link = await page.getByRole('textbox', { name: '공유 링크' }).inputValue()
  await page.goto(link)
  await expect(page.getByText('모드:')).toContainText('기보 감상')
}

test.describe('Reversix public UI', () => {
  test('greets a visitor with the opponent chooser', async ({ page }) => {
    await page.goto('/')
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('heading', { name: '새 게임' })).toBeVisible()
    await expect(dialog.getByRole('button', { name: '2인 대전' })).toBeVisible()
    await expect(dialog.getByRole('button', { name: /AZ-32/ })).toBeVisible()
    // it is modal: the board behind it cannot be played until a mode is chosen
    await expect(page.locator('button[role="gridcell"]').nth(34)).not.toBeFocused()
    await dialog.getByRole('button', { name: '2인 대전' }).click()
    await expect(dialog).toBeHidden()
    await expect(page.getByText('모드:')).toContainText('2인 대전')
  })

  test('renders all labelled board buttons and the initial turn', async ({ page }) => {
    await startTwoPlayer(page)
    await expect(page.getByText('현재 플레이어:')).toContainText('흑')
    await expect(page.getByText('필요한 배치:')).toContainText('1')
    await expect(page.locator('button[role="gridcell"][aria-label]')).toHaveCount(100)
  })

  test('alternates light and dark backgrounds across adjacent cells', async ({ page }) => {
    await startTwoPlayer(page)
    const backgrounds = await page.locator('[role="gridcell"]').evaluateAll(cells =>
      [0, 1, 10, 11].map(index => getComputedStyle(cells[index]).backgroundColor),
    )
    expect(backgrounds[0]).not.toBe(backgrounds[1])
    expect(backgrounds[0]).not.toBe(backgrounds[2])
    expect(backgrounds[0]).toBe(backgrounds[3])
  })

  test('fills cells with stones and centers contrasting placement numbers', async ({ page }) => {
    await startTwoPlayer(page)
    const black = page.getByRole('gridcell', { name: /E5 백돌/ })
    const white = page.getByRole('gridcell', { name: /F5 흑돌/ })
    for (const stone of [black, white]) {
      expect(await stone.evaluate(element => {
        const style = getComputedStyle(element, '::after')
        return style.top === '0px' && style.right === '0px' && style.bottom === '0px' && style.left === '0px'
      })).toBe(true)
    }

    await page.getByRole('gridcell', { name: /E4 빈 칸/ }).click()
    const blackNumber = page.locator('.is-provisional small')
    await expect(blackNumber).toHaveText('1')
    await expect(blackNumber).toHaveCSS('color', 'rgb(255, 255, 255)')
    await page.getByRole('button', { name: '턴 확정' }).click()
    await page.locator('.is-legal').first().click()
    const whiteNumber = page.locator('.is-provisional small')
    await expect(whiteNumber).toHaveText('1')
    await expect(whiteNumber).toHaveCSS('color', 'rgb(23, 32, 51)')
  })

  test('places legal black stones, resets, and commits a turn', async ({ page }) => {
    await startTwoPlayer(page)
    const cell = page.getByRole('gridcell', { name: /E4 빈 칸/ })
    await cell.click()
    await expect(page.getByText('현재 배치:')).toContainText('1')
    await expect(page.getByRole('button', { name: '턴 확정' })).toBeEnabled()
    await page.getByRole('button', { name: '턴 초기화' }).click()
    await expect(page.getByText('현재 배치:')).toContainText('0')
    await expect(page.getByRole('button', { name: '턴 확정' })).toBeDisabled()
    await cell.click()
    await expect(page.getByRole('button', { name: '턴 확정' })).toBeEnabled()
    await page.getByRole('button', { name: '턴 확정' }).click()
    await expect(page.getByText('현재 플레이어:')).toContainText('백')
  })

  test('cancels only the latest provisional stone', async ({ page }) => {
    await startTwoPlayer(page)
    await page.getByRole('gridcell', { name: /E4 빈 칸/ }).click()
    await page.getByRole('button', { name: '턴 확정' }).click()
    await page.locator('.is-legal').first().click()
    await page.locator('.is-legal').first().click()

    const first = page.locator('.is-provisional').filter({ hasText: '1' })
    const latest = page.locator('.is-provisional').filter({ hasText: '2' })
    await expect(first).toHaveAttribute('aria-disabled', 'true')
    await expect(latest).not.toHaveAttribute('aria-disabled')
    await first.click({ force: true })
    await expect(page.locator('.is-provisional')).toHaveCount(2)
    await latest.click()
    await expect(page.locator('.is-provisional')).toHaveCount(1)
    await expect(page.locator('.is-provisional small')).toHaveText('1')
  })

  test('animates provisional flips between the original and new colors', async ({ page }) => {
    await startTwoPlayer(page)
    await page.getByRole('gridcell', { name: /E4 빈 칸/ }).click()
    const blackFlip = page.getByRole('gridcell', { name: /E5 흑돌/ })
    await expect(blackFlip).toHaveClass(/is-flipping-to-black/)
    expect(await blackFlip.evaluate(element => {
      const style = getComputedStyle(element, '::after')
      return style.animationName === 'flip-to-black'
        && style.animationDuration === '0.5s'
        && style.animationTimingFunction === 'ease'
    })).toBe(true)

    await page.getByRole('button', { name: '턴 확정' }).click()
    await page.locator('.is-legal').first().click()
    const whiteFlip = page.getByRole('gridcell', { name: /E5 백돌/ })
    await expect(whiteFlip).toHaveClass(/is-flipping-to-white/)
    expect(await whiteFlip.evaluate(element => {
      const style = getComputedStyle(element, '::after')
      return style.animationName === 'flip-to-white'
        && style.animationDuration === '0.5s'
        && style.animationTimingFunction === 'ease'
    })).toBe(true)
  })

  test('keeps all provisional flip animations in the same phase', async ({ page }) => {
    await startTwoPlayer(page)
    await page.getByRole('gridcell', { name: /E4 빈 칸/ }).click()
    await page.getByRole('button', { name: '턴 확정' }).click()
    await page.locator('.is-legal').first().click()
    await page.locator('.is-legal').first().click()

    const epochs = await page.locator('.is-flipping').evaluateAll(elements =>
      elements.map(element => element.getAttribute('data-flip-epoch')),
    )
    expect(epochs.length).toBeGreaterThan(1)
    expect(epochs).toEqual(['2', '2'])
  })

  test('opens and closes the rules dialog', async ({ page }) => {
    await startTwoPlayer(page)
    const rulesButton = page.getByRole('button', { name: '규칙' })
    await rulesButton.click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('게임 규칙')
    await expect(dialog.getByRole('button', { name: '닫기' })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(rulesButton).toBeFocused()
    await rulesButton.click()
    await dialog.getByRole('button', { name: '닫기' }).click()
    await expect(dialog).toBeHidden()
    await expect(rulesButton).toBeFocused()
  })

  test('pages through the rules with the buttons and arrow keys', async ({ page }) => {
    await startTwoPlayer(page)
    await page.getByRole('button', { name: '규칙' }).click()
    const dialog = page.getByRole('dialog')
    const prev = dialog.getByRole('button', { name: '이전' })
    const next = dialog.getByRole('button', { name: '다음' })

    await expect(dialog).toContainText('1 / 9')
    await expect(dialog.getByRole('heading', { level: 3 })).toContainText('첫 수')
    await expect(prev).toBeDisabled()

    // the buttons must not move as you page, or clicking through means chasing them
    const spot = await next.boundingBox()
    const titles = ['착수 (1/3)', '착수 (2/3)', '착수 (3/3)', '체크 (SIX)', '체크 방어', '정확히 여섯 개만', '금수', '패스']
    for (const [i, title] of titles.entries()) {
      await next.click()
      await expect(dialog.getByRole('heading', { level: 3 })).toContainText(title)
      await expect(dialog).toContainText(`${i + 2} / 9`)
      expect(await next.boundingBox()).toEqual(spot)
    }
    await expect(next).toBeDisabled()

    // arrow keys move too, and going back works
    await page.keyboard.press('ArrowLeft')
    await expect(dialog).toContainText('8 / 9')
    await prev.click()
    await expect(dialog).toContainText('7 / 9')

    // reopening starts from the first page again
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: '규칙' }).click()
    await expect(dialog).toContainText('1 / 9')
  })

  test('confirms a destructive new game with Cancel focused first', async ({ page }) => {
    await startTwoPlayer(page)
    await page.getByRole('gridcell', { name: /E4 빈 칸/ }).click()
    await page.getByRole('button', { name: '새 게임' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('button', { name: '취소' })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(page.locator('button[role="gridcell"]').first()).toHaveAttribute('aria-disabled', 'true')
  })

  test('marks the human own move as black in two-player mode', async ({ page }) => {
    await startTwoPlayer(page)
    await page.locator('button[role="gridcell"]').nth(34).click()
    await page.getByRole('button', { name: '턴 확정' }).click()
    await expect(page.getByText('현재 플레이어:')).toContainText('백')
    await expect(page.locator('.is-last-move')).toHaveCount(1)
    await expect(page.getByText('직전 수 —')).toContainText('흑')
    // a one-stone opening turn still gets its order number
    await expect(page.locator('.is-last-move').first()).toContainText('1')
    await expect(page.locator('.is-last-move').first()).toHaveAttribute('aria-label', /1번째/)
  })

  test('lets the human take white and moves the computer first', async ({ page }) => {
    await startVsAgent(page, /후공/)
    await expect(page.getByText('모드:')).toContainText('나는 백')
    // black is the computer here, so it opens on its own and hands the turn to us
    await expect(page.getByText('현재 플레이어:')).toContainText('흑')
    await expect(page.getByText('현재 플레이어:')).toContainText('백', { timeout: 120000 })
    await expect(page.getByText('최근 효과:')).toContainText('흑')
  })

  test('can step back from the side choice to the opponent list', async ({ page }) => {
    await startTwoPlayer(page)
    await page.getByRole('button', { name: '새 게임' }).click()
    await page.getByRole('button', { name: /AZ-32/ }).click()
    await expect(page.getByRole('heading', { name: '선공 · 후공' })).toBeVisible()
    await page.getByRole('button', { name: '뒤로' }).click()
    await expect(page.getByRole('heading', { name: '새 게임' })).toBeVisible()
  })

  test('supports keyboard board navigation', async ({ page }) => {
    await startTwoPlayer(page)
    const first = page.locator('button[role="gridcell"]').first()
    await first.focus()
    await first.press('ArrowRight')
    await expect(page.locator('button[role="gridcell"]').nth(1)).toBeFocused()
  })

  test('places with Enter and Space while retaining cell focus', async ({ page }) => {
    await startTwoPlayer(page)
    const cells = page.locator('button[role="gridcell"]')
    await cells.nth(10).focus()
    await page.keyboard.press('Enter')
    await expect(cells.nth(10)).toBeFocused()
    await expect(page.getByText('현재 배치:')).toContainText('0')
    await cells.nth(34).focus()
    await page.keyboard.press('Space')
    await expect(cells.nth(34)).toBeFocused()
    await expect(page.getByText('현재 배치:')).toContainText('1')
    await page.getByRole('button', { name: '턴 초기화' }).click()
    await expect(page.getByText('현재 배치:')).toContainText('0')
    await cells.nth(34).focus()
    await expect(cells.nth(34)).toBeFocused()
  })

  test('marks and accepts only legal placements', async ({ page }) => {
    await startTwoPlayer(page)
    const legal = page.getByRole('gridcell', { name: /E4 빈 칸/ })
    const illegal = page.getByRole('gridcell', { name: /A1 빈 칸/ })
    await expect(page.locator('.is-legal')).toHaveCount(4)
    await expect(legal).toHaveClass(/is-legal/)
    await expect(illegal).not.toHaveClass(/is-legal/)
    await expect(illegal).toHaveAttribute('aria-disabled', 'true')
    await legal.click()
    await expect(page.getByText('현재 배치:')).toContainText('1')
    await expect(page.locator('.is-legal')).toHaveCount(0)
  })

  test('keeps arrow navigation within all four board edges', async ({ page }) => {
    await startTwoPlayer(page)
    const cells = page.locator('button[role="gridcell"]')
    const last = await cells.count() - 1
    for (const [index, key] of [[0, 'ArrowLeft'], [9, 'ArrowRight'], [90, 'ArrowDown'], [last, 'ArrowDown']]) {
      await cells.nth(index).focus()
      await page.keyboard.press(key)
      await expect(cells.nth(index)).toBeFocused()
    }
  })

  test('keeps the board reachable at narrow viewport without document overflow', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await startTwoPlayer(page)
    await expect(page.locator('html')).toHaveJSProperty('scrollWidth', 375)
    const wrapper = page.locator('.board-wrapper')
    await expect(wrapper).toBeVisible()
    expect(await wrapper.evaluate(el => el.scrollWidth)).toBeGreaterThan(await wrapper.evaluate(el => el.clientWidth))
    await expect(page.locator('button[role="gridcell"]').first()).toBeVisible()
    const size = await page.locator('button[role="gridcell"]').first().evaluate(el => ({
      width: el.getBoundingClientRect().width,
      height: el.getBoundingClientRect().height
    }))
    expect(size).toEqual({ width: 44, height: 44 })
    await wrapper.evaluate(el => { el.scrollLeft = el.scrollWidth })
    await expect(page.locator('button[role="gridcell"]').nth(99)).toBeVisible()
  })

  test('accepts the browser reload notice when present', async ({ page }) => {
    await startTwoPlayer(page)
    page.on('dialog', dialog => dialog.accept())
    await page.reload()
    await expect(page.getByText('현재 플레이어:')).toContainText('흑')
  })

  test('serves built assets and does not rewrite missing paths', async ({ page, request }) => {
    await startTwoPlayer(page)
    const asset = await page.locator('script[type="module"]').getAttribute('src')
    const assetResponse = await request.get(asset)
    expect(assetResponse.status()).toBe(200)
    expect(assetResponse.headers()['content-type']).toContain('javascript')
    const missingResponse = await request.get('/missing-route')
    expect(missingResponse.status()).toBe(404)
  })

  test('plays a full turn as the trained network', async ({ page }) => {
    await startVsAgent(page)
    await page.getByRole('gridcell', { name: /E4 빈 칸/ }).click()
    await page.getByRole('button', { name: '턴 확정' }).click()
    await expect(page.getByText('현재 플레이어:')).toContainText('흑', { timeout: 120000 })
    await expect(page.getByText('최근 효과:')).toContainText('백')
  })

  test('shows search progress and places the two stones separately', async ({ page }) => {
    await startVsAgent(page)
    await page.getByRole('gridcell', { name: /E4 빈 칸/ }).click()
    await page.getByRole('button', { name: '턴 확정' }).click()
    // the search reports progress while it runs
    await expect(page.locator('.thinking')).toContainText('/', { timeout: 30000 })
    // and the first of the computer's two stones lands before the turn resolves
    await expect(page.getByText('현재 배치:')).toContainText('1', { timeout: 60000 })
    await expect(page.getByText('현재 플레이어:')).toContainText('흑', { timeout: 120000 })
  })

  test('marks the stones the opponent just placed', async ({ page }) => {
    test.setTimeout(180000)
    await startVsAgent(page)
    await page.getByRole('gridcell', { name: /E4 빈 칸/ }).click()
    await page.getByRole('button', { name: '턴 확정' }).click()
    await expect(page.getByText('현재 플레이어:')).toContainText('백')
    await expect(page.getByText('현재 플레이어:')).toContainText('흑', { timeout: 120000 })
    // the computer places two stones, and only those carry the last-move marker
    await expect(page.locator('.is-last-move')).toHaveCount(2, { timeout: 120000 })
    await expect(page.getByText('직전 수 —')).toContainText('백')
    // flipped stones are marked separately, never as the move itself
    const both = await page.locator('.is-last-move.is-recent').count()
    expect(both).toBe(0)
    // the stone itself must render exactly like any other stone: the marker lives on the
    // cell, never on the ::after that draws the disc
    const marked = page.locator('.board-cell.is-last-move').first()
    const plain = page.locator('.board-cell.is-white:not(.is-last-move):not(.is-recent)').first()
    const shape = el => el.evaluate(n => {
      const s = getComputedStyle(n, '::after')
      return [s.inset, s.width, s.height, s.borderRadius, s.borderStyle]
    })
    expect(await shape(marked)).toEqual(await shape(plain))

    await expect(page.getByRole('gridcell', { name: /직전 상대 착수/ }).first()).toBeVisible()
  })

  test('marks a cell that would hand the opponent a SIX, but only for the closing stone', async ({ page }) => {
    await startTwoPlayer(page)
    // a real line; the ban appears while choosing the SECOND stone of the turn
    const moves = [34,35,43,56,25,64,16,33,53,65,52,46,51,61,67,36,42,31,41,40,22,37]
    const cells = page.locator('button[role="gridcell"]')
    for (const m of moves) {
      await cells.nth(m).click()
      const placed = await page.getByText('현재 배치:').innerText()
      const need = await page.getByText('필요한 배치:').innerText()
      if (placed.match(/현재 배치: (\d+)/)[1] === need.match(/필요한 배치: (\d+)/)[1]) {
        await page.getByRole('button', { name: '턴 확정' }).click()
      }
    }
    // one stone is down, so the next one closes the turn and the ban is live
    await expect(page.getByText('현재 배치:')).toContainText('1')
    const banned = cells.nth(47)
    await expect(banned).toHaveClass(/is-forbidden-move/)
    await expect(banned).toContainText('🚫')
    await expect(banned).not.toHaveClass(/is-legal/)
    await expect(banned).toHaveAttribute('aria-label', /금수/)
    const before = await page.getByText('현재 배치:').innerText()
    await banned.click({ force: true })
    await expect(page.getByText('현재 배치:')).toHaveText(before)
  })

  test('shows no ban while choosing the first of two stones', async ({ page }) => {
    await startTwoPlayer(page)
    const cells = page.locator('button[role="gridcell"]')
    await cells.nth(34).click()
    await page.getByRole('button', { name: '턴 확정' }).click()      // Black's opening
    await expect(page.getByText('필요한 배치:')).toContainText('2')
    await expect(page.getByText('현재 배치:')).toContainText('0')
    // the first stone of a two-stone turn can never be banned: the second may undo it
    await expect(page.locator('.is-forbidden-move')).toHaveCount(0)
  })

  test('lets a doomed first stone be tried, but not committed', async ({ page }) => {
    test.setTimeout(120000)
    await startTwoPlayer(page)
    // White reaches a position whose only three legal cells each shrink a black overline
    // into a six. Every turn from here is banned, so White has to pass — and must be able
    // to SEE that by trying a stone, not just stare at a board with nothing marked.
    const moves = [56,66,53,52,43,33,62,34,77,57,23,63,58,72,35,12,74,65,42,22,81,32,67,24,
      76,64,2,1,71,68,61,51,69,78,80,46,21,36,14,5,26,48,27,15,87,47,16,18,3,91,50,25,59,75,
      13,38,70,39,31,49,41,40,28,11,84,73,85,60,94,95,0,20,90,98,9,30,92,88,4,83,93,37,82,7,
      99,79,86,97,17,6,10,8,96]
    const cells = page.locator('button[role="gridcell"]')
    for (const m of moves) {
      await cells.nth(m).click()
      const counters = await page.getByText('현재 배치:').innerText()
      if (counters.match(/현재 배치: (\d+)/)[1] === counters.match(/필요한 배치: (\d+)/)[1]) {
        await page.getByRole('button', { name: /턴 확정|턴 패스/ }).click()
      }
    }
    await expect(page.getByText('둘 수 있는 곳이 없습니다')).toBeVisible()
    await expect(page.getByRole('button', { name: '턴 패스' })).toBeEnabled()
    await expect(page.locator('.is-forbidden-move')).toHaveCount(0)   // no marks on the first stone
    await expect(page.locator('.is-legal')).toHaveCount(3)            // but the cells are offered

    await cells.nth(19).click()                                       // J2, legal and doomed
    await expect(page.getByText('이 수를 두면 둘째 수를')).toBeVisible()
    await expect(page.locator('.is-forbidden-move')).toHaveCount(2)   // J3 and J9, the reason
    await expect(page.getByRole('button', { name: '턴 확정' })).toBeDisabled()

    await page.getByRole('button', { name: '턴 초기화' }).click()
    await expect(page.getByRole('button', { name: '턴 패스' })).toBeEnabled()
  })

  test('explains why the game ended', async ({ page }) => {
    test.setTimeout(120000)
    await startTwoPlayer(page)
    // two-player mode: no thinking time, so a whole game fits in the budget
    for (let turn = 0; turn < 400; turn++) {
      if (await page.getByText('게임 종료:').count()) break
      const legal = page.locator('.is-legal')
      if (await legal.count()) await legal.first().click()
      const commit = page.getByRole('button', { name: /턴 확정|턴 패스/ })
      if (await commit.isEnabled()) await commit.click()
    }
    const ended = page.getByText('게임 종료:')
    await expect(ended).toBeVisible()
    await expect(ended).toContainText(/체크를 막지 못했습니다|돌 개수로 가렸습니다|둘 곳을 잃었습니다/)
  })

  test('blocks board input while the computer is to move', async ({ page }) => {
    test.setTimeout(180000)
    await startVsAgent(page)
    await page.getByRole('gridcell', { name: /E4 빈 칸/ }).click()
    await page.getByRole('button', { name: '턴 확정' }).click()
    await expect(page.getByText('현재 플레이어:')).toContainText('백')
    await expect(page.getByText('현재 플레이어:')).toContainText('흑', { timeout: 120000 })
    await expect(page.locator('.is-legal').first()).toBeVisible()   // black may move again
  })

  test('offers the save controls only once there is something to save', async ({ page }) => {
    await startTwoPlayer(page)
    const saveButton = page.getByRole('button', { name: '기보 저장' })
    const shareLink = page.getByRole('textbox', { name: '공유 링크' })
    // a fresh game has no committed history, so there is nothing to share yet
    await expect(saveButton).toBeDisabled()
    await expect(shareLink).toHaveValue('')

    await page.getByRole('gridcell', { name: /E4 빈 칸/ }).click()
    await page.getByRole('button', { name: '턴 확정' }).click()

    await expect(saveButton).toBeEnabled()
    await expect(shareLink).toHaveValue(/\?g=.+$/)
  })

  test('a share link round-trips into review with the same final position', async ({ page }) => {
    await startTwoPlayer(page)
    await page.getByRole('gridcell', { name: /E4 빈 칸/ }).click()
    await page.getByRole('button', { name: '턴 확정' }).click()
    const firstWhite = page.locator('.is-legal').first()
    const firstWhiteCoord = (await firstWhite.getAttribute('aria-label')).match(/^[A-J]\d+/)[0]
    await firstWhite.click()
    await page.locator('.is-legal').first().click()
    await page.getByRole('button', { name: '턴 확정' }).click()

    // read the live board's final colours before leaving play mode, so review can be
    // checked against ground truth rather than against another guess
    const e4Colour = (await page.getByRole('gridcell', { name: /^E4 / }).getAttribute('aria-label')).match(/(흑돌|백돌|빈 칸)/)[1]
    const firstWhiteColour = (await page.locator(`button[role="gridcell"][aria-label^="${firstWhiteCoord} "]`).getAttribute('aria-label')).match(/(흑돌|백돌|빈 칸)/)[1]

    const link = await page.getByRole('textbox', { name: '공유 링크' }).inputValue()
    expect(link).toMatch(/\?g=[^&]+$/)

    await page.goto(link)
    // a shared link bypasses the mode chooser entirely — it opens straight into review
    await expect(page.getByRole('dialog')).toBeHidden()
    await expect(page.getByText('모드:')).toContainText('기보 감상')
    const [, cur, total] = (await page.locator('.review-position').innerText()).match(/(\d+) \/ (\d+)/)
    expect(cur).toBe(total)   // opens on the LAST snapshot, not the start

    // this is the load-bearing check: the replayed board must show the exact same stones
    // the live game ended with, not just "some" review UI
    await expect(page.getByRole('cell', { name: new RegExp(`^E4 ${e4Colour}`) })).toBeVisible()
    await expect(page.locator(`[role="cell"][aria-label^="${firstWhiteCoord} "]`)).toHaveAttribute('aria-label', new RegExp(`^${firstWhiteCoord} ${firstWhiteColour}`))
  })

  test('steps through review positions with the buttons, and the board actually changes', async ({ page }) => {
    await startReview(page)
    const e5 = () => page.getByRole('cell', { name: /^E5 / })

    await page.getByRole('button', { name: '처음' }).click()
    await expect(page.locator('.review-position')).toContainText('1 / 4')
    await expect(e5()).toHaveAttribute('aria-label', /^E5 백돌/)   // untouched opening position

    await page.getByRole('button', { name: '다음' }).click()
    await expect(page.locator('.review-position')).toContainText('2 / 4')
    // Black's E4 opening flips E5 — a deterministic, concrete board change to check for,
    // not just a readout that happens to move
    await expect(e5()).toHaveAttribute('aria-label', /^E5 흑돌/)

    await page.getByRole('button', { name: '마지막' }).click()
    await expect(page.locator('.review-position')).toContainText('4 / 4')
  })

  test('steps through review with the keyboard, focused on the board wrapper', async ({ page }) => {
    await startReview(page)
    const wrapper = page.locator('.board-wrapper')
    await wrapper.focus()
    await expect(page.locator('.review-position')).toContainText('4 / 4')

    await page.keyboard.press('ArrowLeft')
    await expect(page.locator('.review-position')).toContainText('3 / 4')
    await page.keyboard.press('ArrowRight')
    await expect(page.locator('.review-position')).toContainText('4 / 4')
    await page.keyboard.press('Home')
    await expect(page.locator('.review-position')).toContainText('1 / 4')
    await page.keyboard.press('End')
    await expect(page.locator('.review-position')).toContainText('4 / 4')
  })

  test('keeps the review board read-only', async ({ page }) => {
    await startReview(page)
    // review cells are role="cell" divs, never the role="gridcell" buttons play mode uses
    await expect(page.locator('button[role="gridcell"]')).toHaveCount(0)
    await expect(page.getByRole('cell')).toHaveCount(100)
    await expect(page.getByRole('button', { name: '턴 확정' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '턴 초기화' })).toHaveCount(0)

    const cell = page.getByRole('cell', { name: /^E5 / })
    const before = await cell.getAttribute('aria-label')
    await cell.click()
    await expect(cell).toHaveAttribute('aria-label', before)
  })

  test('loads a pasted share link straight into review', async ({ page }) => {
    await startTwoPlayer(page)
    await page.getByRole('gridcell', { name: /E4 빈 칸/ }).click()
    await page.getByRole('button', { name: '턴 확정' }).click()
    const link = await page.getByRole('textbox', { name: '공유 링크' }).inputValue()

    await page.getByRole('button', { name: '새 게임' }).click()
    await page.getByRole('button', { name: '기보 감상' }).click()
    await page.getByTestId('record-paste-input').fill(link)
    await page.getByRole('button', { name: '불러오기' }).click()

    await expect(page.getByRole('dialog')).toBeHidden()
    await expect(page.getByText('모드:')).toContainText('기보 감상')
    // Black's opening turn alone: the initial position plus the one after it
    await expect(page.locator('.review-position')).toContainText('2 / 2')
  })

  test('shows an error and keeps the dialog open for a garbage paste', async ({ page }) => {
    await startTwoPlayer(page)
    await page.getByRole('button', { name: '새 게임' }).click()
    await page.getByRole('button', { name: '기보 감상' }).click()
    await page.getByTestId('record-paste-input').fill('not a game record at all')
    await page.getByRole('button', { name: '불러오기' }).click()

    await expect(page.getByTestId('record-load-error')).toBeVisible()
    await expect(page.getByRole('dialog')).toBeVisible()
  })

  test('loads a saved .txt game record from disk', async ({ page }) => {
    await startTwoPlayer(page)
    await page.getByRole('gridcell', { name: /E4 빈 칸/ }).click()
    await page.getByRole('button', { name: '턴 확정' }).click()

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: '기보 저장' }).click(),
    ])
    const filePath = await download.path()

    await page.getByRole('button', { name: '새 게임' }).click()
    await page.getByRole('button', { name: '기보 감상' }).click()
    await page.getByTestId('record-file-input').setInputFiles(filePath)

    await expect(page.getByRole('dialog')).toBeHidden()
    await expect(page.getByText('모드:')).toContainText('기보 감상')
    await expect(page.locator('.review-position')).toContainText('2 / 2')
  })

  test('leaves the board plain when practice mode is off', async ({ page }) => {
    await startTwoPlayer(page)
    await page.getByRole('gridcell', { name: /E4 빈 칸/ }).click()
    await page.getByRole('button', { name: '턴 확정' }).click()
    await expect(page.getByTestId('eval-bar')).toHaveCount(0)
    await expect(page.locator('.is-hint')).toHaveCount(0)
  })

  test('shows the eval bar and move hints when practice mode is on, and stays consistent after a move', async ({ page }) => {
    await startTwoPlayerPractice(page)
    // the network weights are the same ones the AZ-32 tests wait on, so give the first
    // load the same generous timeout
    await expect(page.getByTestId('eval-bar')).toBeVisible({ timeout: 60000 })
    await expect(page.getByTestId('eval-hints')).toContainText('추천 —')
    await expect(page.locator('.is-hint-1')).toHaveCount(1)
    expect(await page.locator('.is-hint').count()).toBeLessThanOrEqual(3)

    await page.getByRole('gridcell', { name: /E4 빈 칸/ }).click()
    await page.getByRole('button', { name: '턴 확정' }).click()
    await expect(page.getByTestId('eval-bar')).toBeVisible()
    await expect(page.getByTestId('eval-value')).toContainText(/흑 \d+% : 백 \d+%/)
  })

  test('always analyses in review mode regardless of the practice toggle', async ({ page }) => {
    await startReview(page)
    await expect(page.getByTestId('eval-bar')).toBeVisible({ timeout: 60000 })
    await expect(page.getByTestId('eval-hints')).toContainText('추천 —')

    await page.getByRole('button', { name: '처음' }).click()
    await expect(page.locator('.review-position')).toContainText('1 / 4')
    await expect(page.getByTestId('eval-bar')).toBeVisible()
    await expect(page.getByTestId('eval-hints')).toContainText('추천 —')
  })

  test('only ever marks empty, legal cells as suggestions', async ({ page }) => {
    await startTwoPlayerPractice(page)
    await expect(page.getByTestId('eval-bar')).toBeVisible({ timeout: 60000 })
    await expect(page.locator('.is-hint').first()).toBeVisible()
    await expect(page.locator('.is-hint.is-black')).toHaveCount(0)
    await expect(page.locator('.is-hint.is-white')).toHaveCount(0)
  })

  test('keeps the 다음 button at a fixed height while stepping through a longer record', async ({ page }) => {
    test.setTimeout(120000)
    // startReview's own record is only 4 snapshots long (Black's opening, White's reply) —
    // every position after the first shows the same 직전 수 line and nothing else in the
    // status section ever changes, so stepping through it would never actually exercise the
    // bug. This prefix of the move list from the "doomed first stone" test above is verified
    // (via a standalone replay of src/game/record.js) to reach a position with a 체크 line
    // that the earlier positions don't have, AND to cross EvalBar's 24-stone low-confidence
    // threshold partway through — two independent reasons for the status section, and so the
    // eval panel and the space above the board, to change height mid-record.
    const moves = [56, 66, 53, 52, 43, 33, 62, 34, 77, 57, 23, 63, 58, 72, 35, 12, 74, 65, 42, 22, 81]
    const cells = page.locator('button[role="gridcell"]')
    await startTwoPlayer(page)
    for (const m of moves) {
      await cells.nth(m).click()
      const placed = await page.getByText('현재 배치:').innerText()
      const need = await page.getByText('필요한 배치:').innerText()
      if (placed.match(/현재 배치: (\d+)/)[1] === need.match(/필요한 배치: (\d+)/)[1]) {
        await page.getByRole('button', { name: '턴 확정' }).click()
      }
    }
    // confirms the record really does gain a 체크 line, not just that it plays out
    await expect(page.getByText('체크:')).toBeVisible()

    const link = await page.getByRole('textbox', { name: '공유 링크' }).inputValue()
    await page.goto(link)
    await expect(page.getByText('모드:')).toContainText('기보 감상')

    // review always analyses; let the eval panel finish appearing before the first reading,
    // or its arrival mid-loop would itself shift the buttons and produce a false failure
    await expect(page.getByTestId('eval-bar')).toBeVisible({ timeout: 60000 })

    await page.getByRole('button', { name: '처음' }).click()
    const [, , total] = (await page.locator('.review-position').innerText()).match(/(\d+) \/ (\d+)/)
    expect(Number(total)).toBeGreaterThan(4)   // longer than startReview's record, as intended

    const nextButton = page.getByRole('button', { name: '다음' })
    const firstY = (await nextButton.boundingBox()).y
    for (let i = 1; i < Number(total); i++) {
      await nextButton.click()
      await expect(page.locator('.review-position')).toContainText(`${i + 1} / ${total}`)
      const box = await nextButton.boundingBox()
      expect(box.y).toBe(firstY)
    }
  })
})
