import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

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
})
