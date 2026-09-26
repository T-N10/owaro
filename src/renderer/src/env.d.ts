/// <reference types="vite/client" />

// renderer 側で window.api を型付けする「契約の写し」。
// preload(src/preload/index.ts)が公開する API と構造を厳密に一致させること。
// （tsconfig.json が src 全体を含むため preload の declare global と同居する。
//   両者は構造的に同一なのでマージされる。renderer を将来の tsconfig 分割でも
//   独立して型付けできるよう、ここでも明示的に宣言しておく。）
declare global {
  interface Window {
    api: {
      setPromise: (
        targetHHMM: string
      ) => Promise<
        | { ok: true; startedAt: string; targetAt: string }
        | { ok: false; reason: 'invalid' | 'past-day-end' | 'too-far' | 'grace-over' }
      >
      getPending: () => Promise<{
        startedAt: string
        targetAt: string
        resumes: { at: string; minutes: number }[]
        nextFireAt: string
      } | null>
      cancelPromise: () => Promise<{ ok: boolean }>
      endNow: () => Promise<{ ok: boolean }>
      extendOverlay: (minutes: number) => Promise<{ ok: boolean; nextFireAt: string }>
      closeOverlay: () => Promise<void>
      getSettings: () => Promise<{ openAtLogin: boolean; playEndMusic: boolean }>
      setSettings: (patch: {
        openAtLogin?: boolean
        playEndMusic?: boolean
      }) => Promise<{ openAtLogin: boolean; playEndMusic: boolean }>
      exportRecords: () => Promise<
        { ok: true; path: string } | { ok: false; cancelled?: true; error?: string }
      >
      resizePromiseWindow: (height: number) => void
      previewOverlay: (query: string) => void
      closePreviewOverlay: () => Promise<void>
    }
  }
}

export {}
