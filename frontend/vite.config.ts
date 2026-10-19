import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// In dev, Vite forwards /api to FastAPI so the session cookie stays same-origin.
// Override the backend address with API_TARGET=http://localhost:8001 npm run dev
const apiTarget = process.env.API_TARGET ?? 'http://localhost:8000'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': { target: apiTarget, changeOrigin: false },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    testTimeout: 15_000, // first render of Radix/Motion under jsdom is slow on cold CI runners
    css: { include: [/tokens\.css/] }, // the token test reads the raw palette
    coverage: { provider: 'v8', include: ['src/**/*.{ts,tsx}'], exclude: ['src/**/*.test.*', 'src/test/**'] },
  },
})
