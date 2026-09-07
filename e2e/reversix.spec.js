import { test, expect } from '@playwright/test'

test.describe('Reversix public UI', () => {
  test('renders all labelled board buttons and the initial turn', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByText('현재 플레이어:').locator('..')).toContainText('검은색')
    await expect(page.getByText('필요한 배치:').locator('..')).toContainText('1')
    await expect(page.locator('button[role="gridcell"][aria-label]')).toHaveCount(225)
  })

  test('places one black stone, resets, and commits a turn', async ({ page }) => {
    await page.goto('/')
    const cell = page.locator('button[role="gridcell"]').first()
    await cell.click()
    await expect(page.getByText('현재 배치:').locator('..')).toContainText('1')
    await expect(page.getByRole('button', { name: '턴 확정' })).toBeEnabled()
    await page.getByRole('button', { name: '턴 초기화' }).click()
    await expect(page.getByText('현재 배치:').locator('..')).toContainText('0')
    await expect(page.getByRole('button', { name: '턴 확정' })).toBeDisabled()
    await cell.click()
    await page.getByRole('button', { name: '턴 확정' }).click()
    await expect(page.getByText('현재 플레이어:').locator('..')).toContainText('흰색')
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
    await page.locator('button[role="gridcell"]').first().click()
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
    await expect(page.getByText('현재 배치:').locator('..')).toContainText('1')
    await page.getByRole('button', { name: '턴 확정' }).click()
    await cells.nth(11).focus()
    await page.keyboard.press('Space')
    await expect(cells.nth(11)).toBeFocused()
    await expect(page.getByText('현재 배치:').locator('..')).toContainText('1')
    await page.getByRole('button', { name: '턴 초기화' }).click()
    await expect(page.getByText('현재 배치:').locator('..')).toContainText('0')
    await cells.nth(11).focus()
    await expect(cells.nth(11)).toBeFocused()
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
