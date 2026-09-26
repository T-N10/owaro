import type { ReactNode } from 'react'
import Wheel from './Wheel'
import { WHEEL_HOURS, WHEEL_MINUTES } from '../../shared/constants'

// 時刻カード(Figma: c-timepicker)。頭(アイコン＋ラベル＋シェブロン)を押すと下に
// 時／分のドラムが開く。開閉は親が持つ(窓の伸縮と同期させるため)。
// 値は "HH:MM" の純 controlled。分は5分刻み(WHEEL_MINUTES)。

type Props = {
  label: ReactNode
  open: boolean
  onToggle: () => void
  time: string
  onTimeChange: (hhmm: string) => void
  disabled?: boolean
}

// "HH:MM" を [時index, 分index] に分解。壊れていれば 23:00 に倒す(親でバリデ済みだが保険)。
function splitIndex(value: string): [number, number] {
  const m = /^(\d{2}):(\d{2})$/.exec(value)
  const h = m ? WHEEL_HOURS.indexOf(m[1]) : -1
  const mi = m ? WHEEL_MINUTES.indexOf(m[2]) : -1
  return [h < 0 ? 23 : h, mi < 0 ? 0 : mi]
}

// Material Symbols "alarm"(design/material/alarm_24dp_*.svg)をインライン化。色は currentColor。
export function AlarmIcon() {
  return (
    <svg className="tp-icon" viewBox="0 -960 960 960" width="16" height="16" aria-hidden="true">
      <path
        fill="currentColor"
        d="M339.5-108.5q-65.5-28.5-114-77t-77-114Q120-365 120-440t28.5-140.5q28.5-65.5 77-114t114-77Q405-800 480-800t140.5 28.5q65.5 28.5 114 77t77 114Q840-515 840-440t-28.5 140.5q-28.5 65.5-77 114t-114 77Q555-80 480-80t-140.5-28.5ZM480-440Zm112 168 56-56-128-128v-184h-80v216l152 152ZM224-866l56 56-170 170-56-56 170-170Zm512 0 170 170-56 56-170-170 56-56ZM480-160q117 0 198.5-81.5T760-440q0-117-81.5-198.5T480-720q-117 0-198.5 81.5T200-440q0 117 81.5 198.5T480-160Z"
      />
    </svg>
  )
}

export function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      className={`tp-chevron${open ? ' is-open' : ''}`}
      viewBox="0 0 16 16"
      width="16"
      height="16"
      aria-hidden="true"
    >
      <path
        d="M3 5.5 8 10.5 13 5.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export default function TimePickerCard({
  label,
  open,
  onToggle,
  time,
  onTimeChange,
  disabled = false
}: Props) {
  const [hourIdx, minuteIdx] = splitIndex(time)

  return (
    <div className={`tp-card${open ? ' is-open' : ''}`}>
      <button
        type="button"
        className="tp-head"
        onClick={onToggle}
        disabled={disabled}
        aria-expanded={open}
      >
        <span className="tp-info">
          <AlarmIcon />
          <span className="tp-label">{label}</span>
        </span>
        <Chevron open={open} />
      </button>
      {/* ドラムは常に置き、.tp-body の高さ(grid の 0fr↔1fr)で開閉をなめらかに見せる。
          閉じている間は disabled で触れない・Tab で止まらない。 */}
      <div className={`tp-body${open ? ' is-open' : ''}`} aria-hidden={!open}>
        <div className="tp-wheels">
          <Wheel
            items={WHEEL_HOURS}
            index={hourIdx}
            onChange={(i) => onTimeChange(`${WHEEL_HOURS[i]}:${WHEEL_MINUTES[minuteIdx]}`)}
            ariaLabel="時"
            disabled={disabled || !open}
          />
          <Wheel
            items={WHEEL_MINUTES}
            index={minuteIdx}
            onChange={(i) => onTimeChange(`${WHEEL_HOURS[hourIdx]}:${WHEEL_MINUTES[i]}`)}
            ariaLabel="分"
            disabled={disabled || !open}
          />
        </div>
      </div>
    </div>
  )
}
