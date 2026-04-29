import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

const bufferEntry = fileURLToPath(new URL('./node_modules/buffer/index.js', import.meta.url))

export default defineConfig({
  plugins: [react()],
  define: {
    global: 'globalThis',
  },
  resolve: {
    alias: {
      buffer: bufferEntry,
    },
  },
  optimizeDeps: {
    include: ['buffer'],
  },
  server: {
    host: '127.0.0.1',
    port: 5175,
    strictPort: true,
  },
})
