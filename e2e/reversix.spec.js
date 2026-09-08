import { test, expect } from '@playwright/test'

test.describe('Reversix public UI', () => {
  test('renders all labelled board buttons and the initial turn', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByText('현재 플레이어:')).toContainText('검은색')
    await expect(page.getByText('필요한 배치:')).toContainText('1')
    await expect(page.locator('button[role="gridcell"][aria-label]')).toHaveCount(100)
  })

  test('alternates light and dark backgrounds across adjacent cells', async ({ page }) => {
    await page.goto('/')
    const backgrounds = await page.locator('[role="gridcell"]').evaluateAll(cells =>
      [0, 1, 10, 11].map(index => getComputedStyle(cells[index]).backgroundColor),
    )
    expect(backgrounds[0]).not.toBe(backgrounds[1])
    expect(backgrounds[0]).not.toBe(backgrounds[2])
    expect(backgrounds[0]).toBe(backgrounds[3])
  })

  test('fills cells with stones and centers contrasting placement numbers', async ({ page }) => {
    await page.goto('/')
    const black = page.getByRole('gridcell', { name: /E5 흰 돌/ })
    const white = page.getByRole('gridcell', { name: /F5 검은 돌/ })
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
    await page.goto('/')
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
    await expect(page.getByText('현재 플레이어:')).toContainText('흰색')
  })

  test('cancels only the latest provisional stone', async ({ page }) => {
    await page.goto('/')
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
    await page.goto('/')
    await page.getByRole('gridcell', { name: /E4 빈 칸/ }).click()
    const blackFlip = page.getByRole('gridcell', { name: /E5 검은 돌/ })
    await expect(blackFlip).toHaveClass(/is-flipping-to-black/)
    expect(await blackFlip.evaluate(element => {
      const style = getComputedStyle(element, '::after')
      return style.animationName === 'flip-to-black'
        && style.animationDuration === '0.5s'
        && style.animationTimingFunction === 'ease'
    })).toBe(true)

    await page.getByRole('button', { name: '턴 확정' }).click()
    await page.locator('.is-legal').first().click()
    const whiteFlip = page.getByRole('gridcell', { name: /E5 흰 돌/ })
    await expect(whiteFlip).toHaveClass(/is-flipping-to-white/)
    expect(await whiteFlip.evaluate(element => {
      const style = getComputedStyle(element, '::after')
      return style.animationName === 'flip-to-white'
        && style.animationDuration === '0.5s'
        && style.animationTimingFunction === 'ease'
    })).toBe(true)
  })

  test('keeps all provisional flip animations in the same phase', async ({ page }) => {
    await page.goto('/')
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
    await page.goto('/')
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

  test('confirms a destructive new game with Cancel focused first', async ({ page }) => {
    await page.goto('/')
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
    await page.goto('/')
    await page.locator('button[role="gridcell"]').nth(34).click()
    await page.getByRole('button', { name: '턴 확정' }).click()
    await expect(page.getByText('현재 플레이어:')).toContainText('흰색')
    await expect(page.locator('.is-last-move')).toHaveCount(1)
    await expect(page.getByText('직전 수 —')).toContainText('검은색')
    // a one-stone opening turn still gets its order number
    await expect(page.locator('.is-last-move').first()).toContainText('1')
    await expect(page.locator('.is-last-move').first()).toHaveAttribute('aria-label', /1번째/)
  })

  test('lets the human take white and moves the computer first', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: '새 게임' }).click()
    await page.getByRole('button', { name: /휴리스틱/ }).click()
    await page.getByRole('button', { name: /후공/ }).click()
    await expect(page.getByText('모드:')).toContainText('나는 흰색')
    // black is the computer here, so it opens on its own and hands the turn to us
    await expect(page.getByText('현재 플레이어:')).toContainText('흰색', { timeout: 20000 })
    await expect(page.getByText('최근 효과:')).toContainText('검은')
  })

  test('can step back from the side choice to the opponent list', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: '새 게임' }).click()
    await page.getByRole('button', { name: /휴리스틱/ }).click()
    await expect(page.getByRole('heading', { name: '선공 · 후공' })).toBeVisible()
    await page.getByRole('button', { name: '뒤로' }).click()
    await expect(page.getByRole('heading', { name: '새 게임' })).toBeVisible()
  })

  test('supports keyboard board navigation', async ({ page }) => {
    await page.goto('/')
    const first = page.locator('button[role="gridcell"]').first()
    await first.focus()
    await first.press('ArrowRight')
    await expect(page.locator('button[role="gridcell"]').nth(1)).toBeFocused()
  })

  test('places with Enter and Space while retaining cell focus', async ({ page }) => {
    await page.goto('/')
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
    await page.goto('/')
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
    await page.goto('/')
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
    await page.goto('/')
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
    await page.goto('/')
    page.on('dialog', dialog => dialog.accept())
    await page.reload()
    await expect(page.getByText('현재 플레이어:')).toContainText('검은색')
  })

  test('serves built assets and does not rewrite missing paths', async ({ page, request }) => {
    await page.goto('/')
    const asset = await page.locator('script[type="module"]').getAttribute('src')
    const assetResponse = await request.get(asset)
    expect(assetResponse.status()).toBe(200)
    expect(assetResponse.headers()['content-type']).toContain('javascript')
    const missingResponse = await request.get('/missing-route')
    expect(missingResponse.status()).toBe(404)
  })

  test('plays a full turn as the heuristic computer', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: '새 게임' }).click()
    await page.getByRole('button', { name: /휴리스틱/ }).click()
    await page.getByRole('button', { name: /선공/ }).click()
    await expect(page.getByText('모드:')).toContainText('휴리스틱')
    await page.getByRole('gridcell', { name: /E4 빈 칸/ }).click()
    await page.getByRole('button', { name: '턴 확정' }).click()
    // white is the computer: it should take its two stones and hand the turn back
    await expect(page.getByText('현재 플레이어:')).toContainText('검은색', { timeout: 15000 })
    await expect(page.getByText('최근 효과:')).toContainText('흰')
    const whites = await page.locator('.board-cell.is-white').count()
    expect(whites).toBeGreaterThan(0)
  })

  test('plays a full turn as the trained network', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: '새 게임' }).click()
    await page.getByRole('button', { name: /학습 에이전트/ }).click()
    await page.getByRole('button', { name: /선공/ }).click()
    await expect(page.getByText('모드:')).toContainText('학습 에이전트', { timeout: 20000 })
    await page.getByRole('gridcell', { name: /E4 빈 칸/ }).click()
    await page.getByRole('button', { name: '턴 확정' }).click()
    await expect(page.getByText('현재 플레이어:')).toContainText('검은색', { timeout: 120000 })
    await expect(page.getByText('최근 효과:')).toContainText('흰')
  })

  test('shows search progress and places the two stones separately', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: '새 게임' }).click()
    await page.getByRole('button', { name: /학습 에이전트/ }).click()
    await page.getByRole('button', { name: /선공/ }).click()
    await expect(page.getByText('모드:')).toContainText('학습 에이전트', { timeout: 20000 })
    await page.getByRole('gridcell', { name: /E4 빈 칸/ }).click()
    await page.getByRole('button', { name: '턴 확정' }).click()
    // the search reports progress while it runs
    await expect(page.locator('.thinking')).toContainText('/', { timeout: 30000 })
    // and the first of the computer's two stones lands before the turn resolves
    await expect(page.getByText('현재 배치:')).toContainText('1', { timeout: 60000 })
    await expect(page.getByText('현재 플레이어:')).toContainText('검은색', { timeout: 120000 })
  })

  test('marks the stones the opponent just placed', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: '새 게임' }).click()
    await page.getByRole('button', { name: /휴리스틱/ }).click()
    await page.getByRole('button', { name: /선공/ }).click()
    await page.getByRole('gridcell', { name: /E4 빈 칸/ }).click()
    await page.getByRole('button', { name: '턴 확정' }).click()
    await expect(page.getByText('현재 플레이어:')).toContainText('검은색', { timeout: 20000 })
    // the computer places two stones, and only those carry the last-move marker
    await expect(page.locator('.is-last-move')).toHaveCount(2)
    await expect(page.getByText('직전 수 —')).toContainText('흰색')
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

  test('marks a cell that would hand the opponent a SIX', async ({ page }) => {
    await page.goto('/')
    // a real line where White holds an overline; shrinking it would gift a SIX
    const moves = [34,35,23,24,26,43,53,62,56,46,17,57,22,47,67,8,52,51,73]
    const cells = page.locator('button[role="gridcell"]')
    for (const m of moves) {
      await cells.nth(m).click()
      const placed = await page.getByText('현재 배치:').innerText()
      const need = await page.getByText('필요한 배치:').innerText()
      if (placed.match(/현재 배치: (\d+)/)[1] === need.match(/필요한 배치: (\d+)/)[1]) {
        await page.getByRole('button', { name: '턴 확정' }).click()
      }
    }
    const banned = cells.nth(68)
    await expect(banned).toHaveClass(/is-forbidden-move/)
    await expect(banned).toContainText('🚫')
    await expect(banned).not.toHaveClass(/is-legal/)
    await expect(banned).toHaveAttribute('aria-label', /금수/)
    // clicking it does nothing (forced: the cell is deliberately not actionable)
    const before = await page.getByText('현재 배치:').innerText()
    await banned.click({ force: true })
    await expect(page.getByText('현재 배치:')).toHaveText(before)
  })

  test('blocks board input while the computer is to move', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: '새 게임' }).click()
    await page.getByRole('button', { name: /휴리스틱/ }).click()
    await page.getByRole('button', { name: /선공/ }).click()
    await page.getByRole('gridcell', { name: /E4 빈 칸/ }).click()
    await page.getByRole('button', { name: '턴 확정' }).click()
    await expect(page.getByText('현재 플레이어:')).toContainText('검은색', { timeout: 15000 })
    await expect(page.locator('.is-legal').first()).toBeVisible()   // black may move again
  })
})
