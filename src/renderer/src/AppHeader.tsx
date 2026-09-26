// 窓の上端の薄い帯(Figma: app_head)。OS のタイトルバーを隠した代わりに、ここが
// ドラッグ領域(-webkit-app-region: drag)になり窓を動かせる。
// 右端の最小化/閉じるも自前で描く＝Windows 標準のボタン(titleBarOverlay)は地の色と
// 記号の色しか変えられず、hover の灰色の四角を消せないため(2026-09-12 本人決定)。
// ボタンだけは no-drag にする＝ドラッグ領域はクリックを吸うため。
// Figma の左の丸3つは Mac 風の飾りなので描かない(2026-09-12 本人決定)。
export default function AppHeader() {
  return (
    <header className="app-header" aria-label="Owaro">
      <span className="app-header-title">Owaro</span>
      <div className="app-header-controls">
        <button
          type="button"
          className="app-header-btn"
          aria-label="最小化"
          onClick={() => window.api.minimizeWindow()}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path d="M0 5h10" stroke="currentColor" strokeWidth="2" />
          </svg>
        </button>
        <button
          type="button"
          className="app-header-btn"
          aria-label="閉じる"
          onClick={() => window.api.closeWindow()}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path d="M0 0l10 10M10 0L0 10" stroke="currentColor" strokeWidth="2" />
          </svg>
        </button>
      </div>
    </header>
  )
}
