import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    // Anchored with **/ so nested copies are excluded too: git worktrees under
    // .claude/ carry their own node_modules and e2e specs, and unanchored patterns
    // let vitest glob into them and try to run Playwright specs.
    exclude: ['**/e2e/**', '**/node_modules/**', '**/dist/**', '**/.claude/**'],
  },
})
