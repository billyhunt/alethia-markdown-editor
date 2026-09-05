/// <reference types="vite/client" />
import type { MarkdownApi } from '../shared/api'

declare global {
  interface Window {
    api: MarkdownApi
  }
}

export {}
