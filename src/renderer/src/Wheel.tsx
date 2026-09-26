import { useEffect, useRef, useState } from 'react'

// 回して選ぶドラム(1列)。起動画面の時刻(時／分の2列)と、おわり画面の延長分数(1列)で共用する。
// 状態は持たない controlled 部品＝親が index を所有し、ここは表示と入力の変換だけ。
//
// 入力は4系統を併設する(docs/research-2026-08-29-ui-refresh.md §3.5)。
//   ホイール: 移動量を貯め、WHEEL_NOTCH_PX たまったら1段(1イベント最大1段・余りは捨てる)。
//            方向が変わったら貯めを捨てる。
//            符号量子化(1イベント=1段)だと Mac のトラックパッド/Magic Mouse が細かい
//            イベントを連打し慣性でも走り続けるため、何段も通り越した(2026-09-12)。
//            deltaMode が行/ページ単位の機種は 1イベント=1段として扱う。
//   ドラッグ: 粗く動かし、離した瞬間に「1行ぶん動くごとに1段」で切り捨ててスナップ
//            (四捨五入だと半行で次に行き、狙いより1段ずれやすかった)。
//   隣接クリック: 薄く見えている上下の行を直接押して一発移動。
//   キーボード: ↑↓(±1)・PageUp/Down(±3)・Home/End。
// CSS scroll-snap は使わない(Chromium の二重スナップ報告があり、JS 量子化のほうが挙動を読み切れる)。

export const WHEEL_ROWS = 5 // 見える行数(中央＋上下2行ずつ)
// 1行の高さ(px)。Figma の c-wheel(字16px)は 14+24+24+24+14=100 ＝ 5行で 20 だったが、
// 字を 24px に上げた(2026-09-12 本人指示・起動画面/おわり画面とも)ので行も 30 に。5行で 150。
// index.css の .wheel-row の font-size(24px)と組で見る。
export const WHEEL_ROW_H = 30

// 1段進むのに必要なホイールの移動量(px)。行の高さと同じにして「指の動き＝ドラムの動き」に揃える。
const WHEEL_NOTCH_PX = WHEEL_ROW_H
// 慣性の尻尾(指を離した後の小さなイベント)が次の操作に混ざらないよう、間が空いたら貯めを捨てる。
const WHEEL_IDLE_RESET_MS = 150
// 段を進める最短間隔。慣性で走り続けても毎秒10段が上限(従来のスロットルと同じ)。
const WHEEL_STEP_MIN_MS = 100
const DRAG_CLICK_TOLERANCE_PX = 4

type Props = {
  items: string[]
  index: number
  onChange: (index: number) => void
  ariaLabel: string
  /** 各行の右に添える単位(おわり画面の「分」)。 */
  unit?: string
  disabled?: boolean
  /** 黒地(おわり画面)用の配色。 */
  variant?: 'light' | 'dark'
}

const clamp = (i: number, max: number): number => Math.max(0, Math.min(max, i))

export default function Wheel({
  items,
  index,
  onChange,
  ariaLabel,
  unit,
  disabled = false,
  variant = 'light'
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null)
  const lastWheelAt = useRef(0) // 最後にホイールのイベントが来た時刻(貯めの鮮度判定)
  const lastStepAt = useRef(0) // 最後に段を進めた時刻(連打の上限)
  const wheelAcc = useRef(0)
  // ドラッグ中の指の移動量(px)。表示だけに使い、離した瞬間に index へ丸める。
  const [dragOffset, setDragOffset] = useState(0)
  const drag = useRef<{ startY: number; startIndex: number; pointerId: number } | null>(null)
  const last = items.length - 1

  // ホイール。React の onWheel は passive で preventDefault が効かないため、ref で直接張る。
  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault()
      if (disabled) return
      if (e.deltaY === 0) return
      // Magic Mouse は押したまま(ドラッグ中)でも表面なぞりのイベントを出す。ドラッグ優先。
      if (drag.current) return
      const now = Date.now()
      // 行/ページ単位の機種はそのまま 1イベント=1段。px 単位(Win マウス・Mac 全般)は貯める。
      const px = e.deltaMode === WheelEvent.DOM_DELTA_PIXEL ? e.deltaY : Math.sign(e.deltaY) * WHEEL_NOTCH_PX
      const acc = wheelAcc.current
      const staleOrReversed = now - lastWheelAt.current > WHEEL_IDLE_RESET_MS || Math.sign(acc) !== Math.sign(px)
      lastWheelAt.current = now
      const sum = (staleOrReversed ? 0 : acc) + px
      if (Math.abs(sum) < WHEEL_NOTCH_PX) {
        wheelAcc.current = sum
        return
      }
      // 1イベントで進むのは最大1段(Win のマウスは1ノッチ≈100px＝5段ぶん来るが、今までどおり1段)。
      // 余りは持ち越さない＝1ノッチで2段目が漏れないように。
      wheelAcc.current = 0
      if (now - lastStepAt.current < WHEEL_STEP_MIN_MS) return
      lastStepAt.current = now
      const next = clamp(index + Math.sign(sum), last)
      if (next !== index) onChange(next)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [index, last, disabled, onChange])

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (disabled || e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { startY: e.clientY, startIndex: index, pointerId: e.pointerId }
  }

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    const d = drag.current
    if (!d || d.pointerId !== e.pointerId) return
    setDragOffset(d.startY - e.clientY)
  }

  const finishDrag = (e: React.PointerEvent<HTMLDivElement>): void => {
    const d = drag.current
    if (!d || d.pointerId !== e.pointerId) return
    drag.current = null
    const offset = d.startY - e.clientY
    setDragOffset(0)
    if (Math.abs(offset) < DRAG_CLICK_TOLERANCE_PX) {
      // ほぼ動かしていない＝クリック。押した行へ移動(現在行ならそのまま)。
      // setPointerCapture 中は e.target が捕まえた要素(.wheel)になるため、座標から行を引く
      // (target 頼みだと行が取れず、隣接クリックが一度も効いていなかった。2026-09-12 CDP で実測)。
      const hit = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null
      const row = hit?.closest<HTMLElement>('[data-row]') ?? null
      const i = row ? Number(row.dataset.row) : NaN
      if (!Number.isNaN(i) && i !== index) onChange(clamp(i, last))
      return
    }
    const next = clamp(d.startIndex + Math.trunc(offset / WHEEL_ROW_H), last)
    if (next !== index) onChange(next)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (disabled) return
    let next: number | null = null
    switch (e.key) {
      case 'ArrowUp':
        next = index - 1
        break
      case 'ArrowDown':
        next = index + 1
        break
      case 'PageUp':
        next = index - 3
        break
      case 'PageDown':
        next = index + 3
        break
      case 'Home':
        next = 0
        break
      case 'End':
        next = last
        break
      default:
        return
    }
    e.preventDefault()
    next = clamp(next, last)
    if (next !== index) onChange(next)
  }

  // 中央(3行目)に現在行が来るよう、行の並び全体をずらす。ドラッグ中は指に追従。
  const translate = (WHEEL_ROWS - 1) / 2 - index
  const y = translate * WHEEL_ROW_H - dragOffset

  return (
    <div
      className={`wheel wheel--${variant}${disabled ? ' is-disabled' : ''}`}
      ref={rootRef}
      role="listbox"
      aria-label={ariaLabel}
      aria-activedescendant={`${ariaLabel}-${index}`}
      tabIndex={disabled ? -1 : 0}
      style={{ height: WHEEL_ROWS * WHEEL_ROW_H }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finishDrag}
      onPointerCancel={finishDrag}
      onKeyDown={onKeyDown}
    >
      <div
        className={`wheel-track${drag.current ? ' is-dragging' : ''}`}
        style={{ transform: `translateY(${y}px)` }}
      >
        {items.map((it, i) => {
          const d = Math.abs(i - index)
          const cls =
            d === 0 ? ' is-current' : d === 1 ? ' is-near' : d === 2 ? ' is-far' : ' is-hidden'
          return (
            <div
              key={it}
              id={`${ariaLabel}-${i}`}
              className={`wheel-row${cls}`}
              role="option"
              aria-selected={i === index}
              data-row={i}
              style={{ height: WHEEL_ROW_H }}
            >
              <span className="wheel-val">{it}</span>
              {unit && <span className="wheel-unit">{unit}</span>}
            </div>
          )
        })}
      </div>
    </div>
  )
}
