// 「このアプリについて」パネル。引き出しメニューの3項目目から開く画面内の DOM。
// 終了画面の BGM(PeriTune「Hanadoki」ピアノソロ版)は CC BY 4.0 ＝クレジット常設が条件なので、ここに出す。
// URL は押すと既定のブラウザで開く(window.api.openExternal → main の許可リスト)。作者への敬意として
// クレジット先へ確実に飛べるようにする(2026-09-23 本人)。main 側の許可リストと同じ URL を並べる。
// 暗幕クリック・閉じるボタンで閉じる。Escape は PromiseScreen の一括ハンドラが受け持つ。
// 窓の高さは PromiseScreen が PROMISE_H_OPEN まで刻んで伸ばす(中身が見切れないように)。
// 出入りは引き出しメニューと同じディゾルブ(--drawer-fade)。メニューが消える最中に暗幕が一瞬で出ると
// 暗さが二重になって明滅して見えた(2026-09-23 本人「ちらつく」)ので、同じ速さで溶かして重ねる。
// 閉じるときは open=false でも消えかけ(is-closing)のまま描き、animationend で DOM から外す。

import { useEffect, useLayoutEffect, useRef, useState } from 'react'

const LINKS = [
  'https://peritune.com/blog/2025/03/03/hanadoki/',
  'https://creativecommons.org/licenses/by/4.0/'
]

type Props = {
  open: boolean
  onClose: () => void
  /** パネルの実寸(px)。PromiseScreen が窓の高さをこれに合わせる。閉じたら 0。 */
  onHeight?: (height: number) => void
}

export default function AboutPanel({ open, onClose, onHeight }: Props) {
  const [visible, setVisible] = useState(open)
  useEffect(() => {
    if (open) setVisible(true)
  }, [open])
  // 描いた直後に実寸を測って知らせる(CSS の max-height で切られる前の自然な高さ)。
  const panelRef = useRef<HTMLElement>(null)
  useLayoutEffect(() => {
    if (!onHeight) return
    if (!open || !panelRef.current) {
      onHeight(0)
      return
    }
    onHeight(panelRef.current.scrollHeight)
  }, [open, visible, onHeight])
  if (!visible) return null

  const closing = !open
  const onAnimationEnd = (): void => {
    if (closing) setVisible(false)
  }

  return (
    <>
      <button
        type="button"
        className={`about-dim${closing ? ' is-closing' : ''}`}
        aria-label="閉じる"
        onClick={onClose}
        onAnimationEnd={onAnimationEnd}
        disabled={closing}
      />
      <section
        ref={panelRef}
        className={`about${closing ? ' is-closing' : ''}`}
        role="dialog"
        aria-label="このアプリについて"
        aria-hidden={closing}
        onAnimationEnd={onAnimationEnd}
      >
        {/* 見出し＋本文を1箱(.about-section)にし、箱同士の間隔は .about-sections の gap で取る。 */}
        <div className="about-sections">
          <div className="about-section">
            <h2 className="about-heading">
              Owaro <span className="about-yomi">(おわろ～)</span>
            </h2>
            <p className="about-text">決めた時間になったら、作業を終わらせるためのアプリです。</p>
          </div>
          <div className="about-section">
            <h2 className="about-heading">音楽</h2>
            <p className="about-text">
              「Hanadoki」(ピアノソロ版) PeriTune(むつき醒 様) / CC BY 4.0 (フェード・ループ処理を加えています)
            </p>
          </div>
          <div className="about-section">
            <h2 className="about-heading">配布元とライセンス</h2>
            {LINKS.map((url) => (
              <a
                key={url}
                className="about-url"
                href={url}
                onClick={(e) => {
                  e.preventDefault()
                  window.api.openExternal(url)
                }}
              >
                {url}
              </a>
            ))}
          </div>
        </div>
        <button type="button" className="about-close" onClick={onClose}>
          閉じる
        </button>
      </section>
    </>
  )
}
