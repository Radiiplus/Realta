import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { initJoyId } from './lib/joyid'
import { Buffer } from 'buffer'

if (!(globalThis as any).Buffer) {
  (globalThis as any).Buffer = Buffer
}

void initJoyId().catch((err) => {
  console.warn('[joyid] init failed:', err?.message || err)
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
