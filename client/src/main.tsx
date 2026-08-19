import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { AuthGate } from './components/AuthGate'
import './styles/globals.css'

const root = document.getElementById('root')

if (!root) {
  throw new Error('React root element was not found')
}

createRoot(root).render(
  <StrictMode>
    <AuthGate />
  </StrictMode>,
)
