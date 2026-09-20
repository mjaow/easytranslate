/// <reference types="vite/client" />
import type { EasyTranslateApi } from '../preload/index.js'

declare global {
  interface Window {
    easytranslate: EasyTranslateApi
  }
}

export {}
