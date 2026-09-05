import { useEffect, useState } from 'react'
import { api } from './api.ts'
import type { RendererReadyResult } from '../shared/api'

export default function App() {
  const [host, setHost] = useState<RendererReadyResult | null>(null)

  useEffect(() => {
    void api.app.rendererReady().then(setHost)
  }, [])

  return (
    <main style={{ padding: '4rem 2rem', textAlign: 'center' }}>
      <h1 style={{ fontWeight: 600 }}>Markdown Reader</h1>
      <p style={{ color: 'var(--text-muted)' }}>
        {host ? `Bridge ready — v${host.version} on ${host.platform}` : 'Connecting to host…'}
      </p>
    </main>
  )
}
