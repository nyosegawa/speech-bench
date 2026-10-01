import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The bench's server answers /api and /audio; the dev server passes them on so that the app runs with live data.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src'), '@bench': path.resolve(import.meta.dirname, '..', 'src') } },
  server: { proxy: { '/api': 'http://127.0.0.1:5280', '/audio': 'http://127.0.0.1:5280' } }
})
