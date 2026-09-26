import { contextBridge, ipcRenderer } from 'electron'
import type { PromiseRejectReason } from '../shared/promise'

// renderer が使える唯一の契約。仕様の window.api に厳密一致させる。
// 約束入力窓とオーバーレイ窓は同じ preload を読む(使う関数が違うだけ)。
export interface PromiseApi {
  // 受理されなければ reason が返る(日をまたぐ止め時などは main が拒否する)。
  setPromise: (
    targetHHMM: string
  ) => Promise<
    | { ok: true; startedAt: string; targetAt: string }
    | { ok: false; reason: PromiseRejectReason }
  >
  getPending: () => Promise<{
    startedAt: string
    targetAt: string
    resumes: { at: string; minutes: number }[]
    nextFireAt: string
  } | null>
  // 進行中の約束を取り消す(記録は残さない＝守れた/破ったのどちらでもないため)。
  cancelPromise: () => Promise<{ ok: boolean }>
  // 止め時を待たずに、その場でおわりの儀式(30秒ロック＋記録)を出す(予約から5分過ぎの起動画面)。
  endNow: () => Promise<{ ok: boolean }>
  extendOverlay: (minutes: number) => Promise<{ ok: boolean; nextFireAt: string }>
  closeOverlay: () => Promise<void>

  // ---- 設定・書き出し ----
  getSettings: () => Promise<{ openAtLogin: boolean; playEndMusic: boolean }>
  setSettings: (patch: {
    openAtLogin?: boolean
    playEndMusic?: boolean
  }) => Promise<{ openAtLogin: boolean; playEndMusic: boolean }>
  // OS の保存ダイアログを開いて記録を書き出す。形式は選んだ拡張子で決まる。
  exportRecords: () => Promise<
    { ok: true; path: string } | { ok: false; cancelled?: true; error?: string }
  >

  // 時刻のドラムの開閉に合わせて起動画面の窓の高さ(内寸px)を変える。main が CLOSED〜OPEN に丸める。
  resizePromiseWindow: (height: number) => void
  // 帯の右端の自前ボタン(最小化/閉じる)。OS のボタンをやめたぶん renderer から頼む。
  minimizeWindow: () => void
  closeWindow: () => void
  // 「このアプリについて」のリンクを既定のブラウザで開く。main が https の許可リストだけ通す。
  openExternal: (url: string) => void

  // ---- 画面カタログ用(開発ビルド限定。本番では main 側が握り潰す) ----
  previewOverlay: (query: string) => void
  closePreviewOverlay: () => Promise<void>
}

const api: PromiseApi = {
  setPromise: (targetHHMM) => ipcRenderer.invoke('setPromise', targetHHMM),
  getPending: () => ipcRenderer.invoke('getPending'),
  cancelPromise: () => ipcRenderer.invoke('cancelPromise'),
  endNow: () => ipcRenderer.invoke('endNow'),
  extendOverlay: (minutes) => ipcRenderer.invoke('extendOverlay', minutes),
  closeOverlay: () => ipcRenderer.invoke('closeOverlay'),

  getSettings: () => ipcRenderer.invoke('getSettings'),
  setSettings: (patch) => ipcRenderer.invoke('setSettings', patch),
  exportRecords: () => ipcRenderer.invoke('exportRecords'),
  resizePromiseWindow: (height) => ipcRenderer.send('resizePromiseWindow', height),
  minimizeWindow: () => ipcRenderer.send('minimizeWindow'),
  closeWindow: () => ipcRenderer.send('closeWindow'),
  openExternal: (url) => ipcRenderer.send('openExternal', url),

  previewOverlay: (query) => ipcRenderer.send('previewOverlay', query),
  closePreviewOverlay: () => ipcRenderer.invoke('closePreviewOverlay')
}

// renderer 側で window.api を型付けするためのグローバル宣言(契約の唯一の出所)。
declare global {
  interface Window {
    api: PromiseApi
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // contextIsolation 無効時のフォールバック(基本は使わない)。
  window.api = api
}
