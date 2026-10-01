import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The bench's server answers /api and /audio; the dev server passes them on so that the app runs with live data,
// addressed to the bench's host, the only one it answers.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src'), '@bench': path.resolve(import.meta.dirname, '..', 'src') } },
  server: { proxy: { '/api': { target: 'http://127.0.0.1:5280', changeOrigin: true }, '/audio': { target: 'http://127.0.0.1:5280', changeOrigin: true } } }
})
