import { test, expect } from '@playwright/test'

test.describe('Reversix public UI', () => {
  test('renders all labelled board buttons and the initial turn', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByText('현재 플레이어:').locator('..')).toContainText('검은색')
    await expect(page.getByText('필요한 배치:').locator('..')).toContainText('1')
    await expect(page.locator('button[role="gridcell"][aria-label]')).toHaveCount(225)
  })

  test('alternates light and dark backgrounds across adjacent cells', async ({ page }) => {
    await page.goto('/')
    const backgrounds = await page.locator('[role="gridcell"]').evaluateAll(cells =>
      [0, 1, 15, 16].map(index => getComputedStyle(cells[index]).backgroundColor),
    )
    expect(backgrounds[0]).not.toBe(backgrounds[1])
    expect(backgrounds[0]).not.toBe(backgrounds[2])
    expect(backgrounds[0]).toBe(backgrounds[3])
  })

  test('fills cells with stones and centers contrasting placement numbers', async ({ page }) => {
    await page.goto('/')
    const black = page.getByRole('gridcell', { name: /H8 검은 돌/ })
    const white = page.getByRole('gridcell', { name: /I8 흰 돌/ })
    for (const stone of [black, white]) {
      expect(await stone.evaluate(element => {
        const style = getComputedStyle(element, '::after')
        return style.top === '0px' && style.right === '0px' && style.bottom === '0px' && style.left === '0px'
      })).toBe(true)
    }

    await page.getByRole('gridcell', { name: /I7 빈 칸/ }).click()
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
    const cell = page.getByRole('gridcell', { name: /I7 빈 칸/ })
    await cell.click()
    await expect(page.getByText('현재 배치:').locator('..')).toContainText('1')
    await expect(page.getByRole('button', { name: '턴 확정' })).toBeEnabled()
    await page.getByRole('button', { name: '턴 초기화' }).click()
    await expect(page.getByText('현재 배치:').locator('..')).toContainText('0')
    await expect(page.getByRole('button', { name: '턴 확정' })).toBeDisabled()
    await cell.click()
    await expect(page.getByRole('button', { name: '턴 확정' })).toBeEnabled()
    await page.getByRole('button', { name: '턴 확정' }).click()
    await expect(page.getByText('현재 플레이어:').locator('..')).toContainText('흰색')
  })

  test('cancels only the latest provisional stone', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('gridcell', { name: /I7 빈 칸/ }).click()
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
    await page.getByRole('gridcell', { name: /I7 빈 칸/ }).click()
    const blackFlip = page.getByRole('gridcell', { name: /I8 검은 돌/ })
    await expect(blackFlip).toHaveClass(/is-flipping-to-black/)
    expect(await blackFlip.evaluate(element => {
      const style = getComputedStyle(element, '::after')
      return style.animationName === 'flip-to-black'
        && style.animationDuration === '0.5s'
        && style.animationTimingFunction === 'ease'
    })).toBe(true)

    await page.getByRole('button', { name: '턴 확정' }).click()
    await page.locator('.is-legal').first().click()
    const whiteFlip = page.getByRole('gridcell', { name: /H8 흰 돌/ })
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
    await page.getByRole('gridcell', { name: /I7 빈 칸/ }).click()
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
    await page.getByRole('gridcell', { name: /I7 빈 칸/ }).click()
    await page.getByRole('button', { name: '새 게임' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('button', { name: '취소' })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(page.locator('button[role="gridcell"]').first()).toHaveAttribute('aria-disabled', 'true')
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
    await expect(page.getByText('현재 배치:').locator('..')).toContainText('0')
    await cells.nth(98).focus()
    await page.keyboard.press('Space')
    await expect(cells.nth(98)).toBeFocused()
    await expect(page.getByText('현재 배치:').locator('..')).toContainText('1')
    await page.getByRole('button', { name: '턴 초기화' }).click()
    await expect(page.getByText('현재 배치:').locator('..')).toContainText('0')
    await cells.nth(98).focus()
    await expect(cells.nth(98)).toBeFocused()
  })

  test('marks and accepts only legal placements', async ({ page }) => {
    await page.goto('/')
    const legal = page.getByRole('gridcell', { name: /I7 빈 칸/ })
    const illegal = page.getByRole('gridcell', { name: /A1 빈 칸/ })
    await expect(page.locator('.is-legal')).toHaveCount(4)
    await expect(legal).toHaveClass(/is-legal/)
    await expect(illegal).not.toHaveClass(/is-legal/)
    await expect(illegal).toHaveAttribute('aria-disabled', 'true')
    await legal.click()
    await expect(page.getByText('현재 배치:').locator('..')).toContainText('1')
    await expect(page.locator('.is-legal')).toHaveCount(0)
  })

  test('keeps arrow navigation within all four board edges', async ({ page }) => {
    await page.goto('/')
    const cells = page.locator('button[role="gridcell"]')
    const last = await cells.count() - 1
    for (const [index, key] of [[0, 'ArrowLeft'], [14, 'ArrowRight'], [210, 'ArrowDown'], [last, 'ArrowDown']]) {
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
    await expect(page.locator('button[role="gridcell"]').nth(224)).toBeVisible()
  })

  test('accepts the browser reload notice when present', async ({ page }) => {
    await page.goto('/')
    page.on('dialog', dialog => dialog.accept())
    await page.reload()
    await expect(page.getByText('현재 플레이어:').locator('..')).toContainText('검은색')
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
})
