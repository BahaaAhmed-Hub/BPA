import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

// Which build this is. "It is not deployed" and "your browser is holding the
// last one" look identical from the outside, and the only way to tell them
// apart is for the page to say what it is running. GitHub Actions sets
// GITHUB_SHA; a local build says so.
const BUILD_SHA = (process.env.GITHUB_SHA ?? 'local').slice(0, 7)
const BUILD_AT = new Date().toISOString()

export default defineConfig({
  base: '/BPA/',
  define: {
    __BUILD_SHA__: JSON.stringify(BUILD_SHA),
    __BUILD_AT__: JSON.stringify(BUILD_AT),
  },
  plugins: [
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
