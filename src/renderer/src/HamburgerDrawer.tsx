import { useEffect, useState } from 'react'

// 引き出しメニュー(Figma: l-hamburger-menu 105:450)。別窓ではなく画面内の DOM で描く
// ＝かつての時刻ピッカー別窓(ready の握手・フェード)のような複雑さを持ち込まない。
// 帯(app-header)の下から幅210の白いパネルが出て、残りは暗く落ちる。
// 項目は4つ: 記録を保存する(B-16) / PC起動時に開く(起動設定。スイッチは実装側の提案) /
// おわりに曲を流す(終了画面の Hanadoki。既定オン・2026-09-23 追加) /
// このアプリについて(クレジット表示。AboutPanel を開く)。
//
// 出入りはフェード(2026-09-12 本人依頼「チカチカする」)。開くときは CSS アニメで現れ、
// 閉じるときは open=false になっても消えかけ(is-closing)のまま描き続け、
// フェードアウトの animationend で初めて DOM から消す。時間は CSS 側の --drawer-fade が唯一の出どころ。

type Props = {
  open: boolean
  onClose: () => void
  onExport: () => void
  /** null = まだ読み込めていない(スイッチは押せない)。 */
  settings: { openAtLogin: boolean; playEndMusic: boolean } | null
  onToggleLogin: (next: boolean) => void
  onToggleMusic: (next: boolean) => void
  onAbout: () => void
  busy?: boolean
}

export default function HamburgerDrawer({
  open,
  onClose,
  onExport,
  settings,
  onToggleLogin,
  onToggleMusic,
  onAbout,
  busy = false
}: Props) {
  // open が false になった後も、フェードアウトが終わるまで描き続けるための「見えている」状態。
  const [visible, setVisible] = useState(open)
  useEffect(() => {
    if (open) setVisible(true)
  }, [open])
  if (!visible) return null

  const closing = !open
  const on = settings?.openAtLogin ?? false
  const musicOn = settings?.playEndMusic ?? true
  // 閉じるアニメが終わったら消す。暗幕とパネルの両方から届くが、どちらでも結果は同じ。
  const onAnimationEnd = (): void => {
    if (closing) setVisible(false)
  }
  return (
    <>
      <button
        type="button"
        className={`drawer-dim${closing ? ' is-closing' : ''}`}
        aria-label="メニューを閉じる"
        onClick={onClose}
        onAnimationEnd={onAnimationEnd}
        disabled={closing}
      />
      <aside
        className={`drawer${closing ? ' is-closing' : ''}`}
        role="dialog"
        aria-label="メニュー"
        aria-hidden={closing}
        onAnimationEnd={onAnimationEnd}
      >
        <button type="button" className="drawer-close" aria-label="閉じる" onClick={onClose} />
        <nav className="drawer-menu">
          <button type="button" className="drawer-item" onClick={onExport} disabled={busy || closing}>
            記録を保存する
          </button>
          <button
            type="button"
            className="drawer-item"
            role="switch"
            aria-checked={on}
            onClick={() => onToggleLogin(!on)}
            disabled={busy || closing || settings === null}
          >
            PC起動時に開く
            <span className={`switch${on ? ' is-on' : ''}`} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="drawer-item"
            role="switch"
            aria-checked={musicOn}
            onClick={() => onToggleMusic(!musicOn)}
            disabled={busy || closing || settings === null}
          >
            おわりに曲を流す
            <span className={`switch${musicOn ? ' is-on' : ''}`} aria-hidden="true" />
          </button>
          <button type="button" className="drawer-item" onClick={onAbout} disabled={busy || closing}>
            このアプリについて
          </button>
        </nav>
      </aside>
    </>
  )
}
