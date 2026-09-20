/**
 * The only bridge between the renderer and the main process.
 *
 * Context isolation is on and node integration is off, so the popup and settings UIs
 * can reach exactly these calls and nothing else.
 */
import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type AppConfig, type SecretId, type PopupPayload } from '../shared/types.js'

const api = {
  /** Subscribe to explanation updates. Returns an unsubscribe function. */
  onUpdate(callback: (payload: PopupPayload) => void): () => void {
    const listener = (_e: Electron.IpcRendererEvent, payload: PopupPayload): void => callback(payload)
    ipcRenderer.on(IPC.popupUpdate, listener)
    return () => ipcRenderer.removeListener(IPC.popupUpdate, listener)
  },

  close(): void {
    ipcRenderer.send(IPC.popupClose)
  },

  /** Report measured content height so the window can size itself to fit. */
  resize(height: number): void {
    ipcRenderer.send(IPC.popupResize, height)
  },

  speak(
    text: string,
    slow: boolean
  ): Promise<{ url?: string; usedProvider?: string; fallbackReason?: string; error?: string }> {
    return ipcRenderer.invoke(IPC.ttsSpeak, { text, slow })
  },

  getConfig(): Promise<AppConfig> {
    return ipcRenderer.invoke(IPC.configGet)
  },

  setConfig(patch: Partial<AppConfig>): Promise<AppConfig> {
    return ipcRenderer.invoke(IPC.configSet, patch)
  },

  setSecret(provider: SecretId, value: string): Promise<{ ok: boolean; error?: string }> {
    return ipcRenderer.invoke(IPC.configSecretSet, { provider, value })
  },

  /** Whether an accelerator is bindable, for inline feedback in Settings. */
  checkHotkey(accelerator: string): Promise<{ ok: boolean; why?: string }> {
    return ipcRenderer.invoke(IPC.hotkeyCheck, accelerator)
  },

  /** Check the saved key and model against the configured endpoint. */
  testLlm(): Promise<{ ok: boolean; message: string; models?: string[]; modelMissing?: boolean }> {
    return ipcRenderer.invoke(IPC.llmTest)
  },

  /** Which providers have a key stored. Never returns the keys themselves. */
  secretStatus(): Promise<Record<string, boolean>> {
    return ipcRenderer.invoke(IPC.configSecretStatus)
  }
}

contextBridge.exposeInMainWorld('easytranslate', api)

export type EasyTranslateApi = typeof api
