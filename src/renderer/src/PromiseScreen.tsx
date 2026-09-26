import { useCallback, useEffect, useRef, useState } from 'react'
import AppHeader from './AppHeader'
import TimePickerCard from './TimePickerCard'
import HamburgerDrawer from './HamburgerDrawer'
import AboutPanel from './AboutPanel'
import { evaluatePromise, type PromiseRejectReason } from '../../shared/promise'
import {
  GRACE_MS,
  PROMISE_H_CLOSED,
  PROMISE_H_OPEN,
  PROMISE_RESIZE_MS,
  PROMISE_WINDOW_SHRINK_MS
} from '../../shared/constants'

// 「このアプリについて」のパネルの上端位置と下の余白(px)。CSS の .about { top } / max-height と対にする。
const ABOUT_TOP = 56
const ABOUT_BOTTOM = 24

type Pending = { startedAt: string; targetAt: string }
type Settings = { openAtLogin: boolean; playEndMusic: boolean }

// 受理されなかった理由を画面の言葉にする。責めず、どうすればよいかだけ言う(文言 2026-09-12 本人)。
// 一行(14px)に収める都合で選んだ時刻は繰り返さない(大きな時刻に出ている)。
function rejectMessage(reason: PromiseRejectReason): string {
  switch (reason) {
    case 'past-day-end':
      return 'おわりは今日のうちにきめてね (＞＜)'
    case 'too-far':
      return '18時間以上先の予定は設定できないよ |ω·`)'
    case 'grace-over':
      return '5分をすぎたので、もう変えられない。'
    default:
      return '時刻を選び直して。'
  }
}

// 初期値は「起動した今」を起点にする(2026-08-22確定)。前回時刻の記憶は廃止＝
// このアプリは決まった時刻に立ち上げる道具ではなく、使う人が立ち上げた時刻から
// 止め時を決める道具。今+5分を5分区切りへ切り上げ(8:42起動→8:50)、
// 立てる操作にかかる数十秒を飲み込んでも最低5分の走行時間が残るようにする。
// 繰り上がり(60分・24時)は Date に任せる。
function readInitialTime(now = new Date()): string {
  const t = new Date(now)
  t.setSeconds(0, 0)
  t.setMinutes(Math.ceil((now.getMinutes() + 5) / 5) * 5)
  return hhmmOf(t)
}

function hhmmOf(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// ISO → "HH:MM"。大きな時刻表示と「HH:MM に予約中」に使う。
function hhmmOfIso(iso: string): string {
  return hhmmOf(new Date(iso))
}

// ギャラリー('#/gallery')から状態を固定して描くための指定。
// これが渡っているときは IPC も時計も触らない＝本物の約束に一切影響しない。
export type PromisePreview = {
  time?: string
  pending?: Pending | null
  submitting?: boolean
  error?: string | null
  /** 判定の基準時刻(固定)。ブロック警告や猶予の内外を再現するために使う。 */
  now?: number
  wheelOpen?: boolean
  drawerOpen?: boolean
  settings?: Settings | null
}

// 起動画面(Figma 2:2「01_起動時」/ 74:52「02_予約後」)。
// 主役は大きな時刻＝止め時。カードのドラムで選び「はじめる」→ window.api.setPromise。
// 予約中は「HH:MM に予約中」と「時間をかえる」(立てて5分以内だけ)に変わる。
// コピーは淡々と、責めない(やくそくの声)。
export default function PromiseScreen({ preview }: { preview?: PromisePreview } = {}) {
  const [time, setTime] = useState(() => preview?.time ?? readInitialTime())
  const [pending, setPending] = useState<Pending | null>(preview?.pending ?? null)
  const [submitting, setSubmitting] = useState(preview?.submitting ?? false)
  const [error, setError] = useState<string | null>(preview?.error ?? null)
  const [wheelOpen, setWheelOpen] = useState(preview?.wheelOpen ?? false)
  const [drawerOpen, setDrawerOpen] = useState(preview?.drawerOpen ?? false)
  const [aboutOpen, setAboutOpen] = useState(false)
  const [settings, setSettings] = useState<Settings | null>(preview?.settings ?? null)
  // 1秒ごとに進む現在時刻。猶予の残りと、選んだ時刻の可否の再判定に使う
  // (窓を開いたまま日をまたぐ・猶予が切れる、が起こりうるため)。
  const [now, setNow] = useState(() => preview?.now ?? Date.now())

  useEffect(() => {
    if (preview) return // プレビューは時刻を固定する(状態が勝手に移り変わらないように)
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [preview])

  // 入口のゲート。押してから怒られるより、選んだ時点で分かるほうが優しい。
  const verdict = evaluatePromise(time, new Date(now))
  const blocked = !verdict.ok ? rejectMessage(verdict.reason) : null

  // 立てて5分以内だけ「時間をかえる」「とりけす」ができる(2026-08-30 裁定(d))。
  const withinGrace = pending ? now - new Date(pending.startedAt).getTime() < GRACE_MS : false
  const graceOver = !!pending && !withinGrace

  // 進行中の約束を読む。開いた時と、窓が前面に戻った時(トレイから開き直す・
  // 開いたまま止め時が来た、の取り残しを直す)。
  const loadPending = useCallback(() => {
    window.api
      .getPending()
      .then((p) => {
        setPending(p ? { startedAt: p.startedAt, targetAt: p.targetAt } : null)
        if (p) setTime(hhmmOfIso(p.targetAt))
      })
      .catch(() => {
        // 取得失敗は「進行中なし」として扱う。
      })
  }, [])

  useEffect(() => {
    if (preview) return
    loadPending()
    // 変更の途中(ドラムを開いている間)は取り直さない＝選びかけの時刻が止め時に戻らないように。
    const onFocus = (): void => {
      if (!wheelOpen) loadPending()
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [preview, loadPending, wheelOpen])

  // 設定(起動時に開く)。メニューのスイッチに出す。
  useEffect(() => {
    if (preview) return
    window.api
      .getSettings()
      .then(setSettings)
      .catch(() => setSettings(null))
  }, [preview])

  // ドラムの開閉に合わせて窓を伸縮させる(main が setContentSize)。
  // 開く: 一回で伸ばす(中身のアニメは伸びた窓の中で進む)。
  // 閉じる: 中身が縮み終わる(PROMISE_RESIZE_MS)まで待ち、画面が止まってから描画のコマごとに窓を
  // 刻んで縮める。中身が動いている最中に刻むと Windows が古い描画を貼り残した(2026-09-12)。
  // 「このアプリについて」は、パネルの実寸(AboutPanel が測って知らせる)＋上下の余白ぶんだけ伸ばす
  // (固定の OPEN まで伸ばすと下に無駄な余白が出た。2026-09-23 本人)。中身が動かないので、
  // 開くときも描画のコマごとに刻んで滑らかに伸ばす。main が CLOSED〜OPEN に丸める。
  const windowHeightRef = useRef(PROMISE_H_CLOSED) // いま窓に頼んでいる高さ(縮めの起点)
  const [aboutHeight, setAboutHeight] = useState(0)
  const aboutTarget = Math.min(PROMISE_H_OPEN, ABOUT_TOP + aboutHeight + ABOUT_BOTTOM)
  const target = wheelOpen ? PROMISE_H_OPEN : aboutOpen && aboutHeight > 0 ? aboutTarget : PROMISE_H_CLOSED
  const wantTall = wheelOpen || aboutOpen
  useEffect(() => {
    if (preview) return
    const from = windowHeightRef.current
    if (target === from) return
    // ドラム: 一回で伸ばす。
    if (wheelOpen) {
      windowHeightRef.current = PROMISE_H_OPEN
      window.api.resizePromiseWindow(PROMISE_H_OPEN)
      return
    }
    // このアプリについて: 開くとき、または開いたままパネルの高さが変わったとき、刻んで合わせる。
    // 閉じるとき: 中身が縮み終わるまで待ってから刻む(ドラムの縮めと同じ理由)。
    const delay = wantTall ? 0 : PROMISE_RESIZE_MS
    let raf = 0
    const id = window.setTimeout(() => {
      const start = performance.now()
      let last = from
      const tick = (now: number): void => {
        const t = Math.min(1, (now - start) / PROMISE_WINDOW_SHRINK_MS)
        const eased = 1 - (1 - t) * (1 - t)
        const h = Math.round(from + (target - from) * eased)
        if (h !== last) {
          last = h
          windowHeightRef.current = h
          window.api.resizePromiseWindow(h)
        }
        if (t < 1) raf = requestAnimationFrame(tick)
      }
      raf = requestAnimationFrame(tick)
    }, delay)
    return () => {
      window.clearTimeout(id)
      cancelAnimationFrame(raf)
    }
  }, [target, wantTall, wheelOpen, preview])

  // Esc で開いているもの(このアプリについて→メニュー→ドラム)を閉じる。
  useEffect(() => {
    if (preview) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      if (aboutOpen) setAboutOpen(false)
      else if (drawerOpen) setDrawerOpen(false)
      else if (wheelOpen) setWheelOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [preview, aboutOpen, drawerOpen, wheelOpen])

  async function onStart(): Promise<void> {
    if (preview) return
    setError(null)
    setSubmitting(true)
    try {
      const res = await window.api.setPromise(time)
      if (res.ok) {
        // 成功時は main 側が窓を閉じる(A1: 立てた直後の画面は持たない)。
        setPending({ startedAt: res.startedAt, targetAt: res.targetAt })
        setWheelOpen(false)
      } else {
        setError(rejectMessage(res.reason))
      }
    } catch {
      setError('うまくはじめられなかった、もう一度 (ว˙˘˙)ง')
    } finally {
      setSubmitting(false)
    }
  }

  // 予約の取り消し(猶予内のみ・記録なし)。窓は閉じず、そのまま立て直せる状態に戻す。
  async function onCancel(): Promise<void> {
    if (preview) return
    setError(null)
    setSubmitting(true)
    try {
      const res = await window.api.cancelPromise()
      if (res.ok) {
        setPending(null)
        setTime(readInitialTime())
      } else {
        setError('とりけせなかった。もう一度。')
      }
    } catch {
      setError('とりけせなかった。もう一度。')
    } finally {
      setSubmitting(false)
    }
  }

  // 「いますぐ おわる」(猶予外)。止め時を待たずにおわりの儀式を出す。窓は main が閉じる。
  async function onEndNow(): Promise<void> {
    if (preview) return
    setError(null)
    setSubmitting(true)
    try {
      const res = await window.api.endNow()
      if (!res.ok) setError('いまは おわれなかった。もう一度。')
    } catch {
      setError('いまは おわれなかった。もう一度。')
    } finally {
      setSubmitting(false)
    }
  }

  // 記録の書き出し(B-16)。形式は OS の保存ダイアログの「ファイルの種類」で選ぶ。
  async function onExport(): Promise<void> {
    if (preview) return
    setError(null)
    setSubmitting(true)
    try {
      const res = await window.api.exportRecords()
      if (res.ok) {
        setDrawerOpen(false)
      } else if (!res.cancelled) {
        setError('保存できなかった。もう一度。')
      }
    } catch {
      setError('保存できなかった。もう一度。')
    } finally {
      setSubmitting(false)
    }
  }

  async function onToggleLogin(next: boolean): Promise<void> {
    if (preview) return
    try {
      setSettings(await window.api.setSettings({ openAtLogin: next }))
    } catch {
      setError('設定を保存できなかった。もう一度。')
    }
  }

  async function onToggleMusic(next: boolean): Promise<void> {
    if (preview) return
    try {
      setSettings(await window.api.setSettings({ playEndMusic: next }))
    } catch {
      setError('設定を保存できなかった。もう一度。')
    }
  }

  // 大きな時刻＝止め時。予約中はその止め時、ドラムを開いて変えている間は選択中の値。
  const targetHHMM = pending ? hhmmOfIso(pending.targetAt) : null
  const bigTime = pending && !wheelOpen ? targetHHMM : time
  const cardDisabled = submitting || graceOver
  const primaryDisabled = submitting || !!blocked || graceOver

  return (
    <main className="screen promise">
      <div className="card">
        <AppHeader />
        <div className="hamburger">
          <button
            type="button"
            className="hamburger-btn"
            aria-label="メニュー"
            aria-expanded={drawerOpen}
            onClick={() => setDrawerOpen(true)}
          >
            <span />
            <span />
            <span />
          </button>
        </div>
        <section className="section">
          {/* 説明文は持たない。何をする画面かは大きな時刻と「はじめる」で足りる(本人裁定 2026-07-31)。 */}
          <p className="big-time">{bigTime}</p>
          <div className="controls">
            <TimePickerCard
              label={
                pending ? (
                  <>
                    <span className="num">{targetHHMM}</span> に予約中
                  </>
                ) : (
                  '時間をきめる'
                )
              }
              open={wheelOpen}
              onToggle={() => setWheelOpen((o) => !o)}
              time={time}
              onTimeChange={setTime}
              disabled={cardDisabled}
            />
            <button type="button" className="primary" onClick={onStart} disabled={primaryDisabled}>
              {pending ? '時間をかえる' : 'はじめる'}
            </button>
          </div>
          {/* 下の一行。優先順位: エラー > 入口ブロック > 予約中のリンク。
              猶予内は「とりけす」(記録なし)、猶予外は「いますぐ おわる」(儀式込み＝記録あり)。
              常設のコストゼロ・記録ゼロの逃げ道は置かない(本人裁定 2026-08-16 / 2026-09-04)。 */}
          <div className="status">
            {error || blocked ? (
              <p className="status-error">{error ?? blocked}</p>
            ) : pending && withinGrace ? (
              <button type="button" className="status-link" onClick={onCancel} disabled={submitting}>
                <u>とりけす</u>
                <span aria-hidden="true">( .  ̫ . ̥ )</span>
              </button>
            ) : pending ? (
              <button type="button" className="status-link" onClick={onEndNow} disabled={submitting}>
                <u>いますぐ おわる</u>
                <span aria-hidden="true">( ᵕᴗᵕ )</span>
              </button>
            ) : null}
          </div>
        </section>
        {/* 常に置く。閉じた直後のフェードアウトは部品側が面倒を見る。 */}
        <HamburgerDrawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          onExport={onExport}
          settings={settings}
          onToggleLogin={onToggleLogin}
          onToggleMusic={onToggleMusic}
          onAbout={() => {
            setDrawerOpen(false)
            setAboutOpen(true)
          }}
          busy={submitting}
        />
        <AboutPanel open={aboutOpen} onClose={() => setAboutOpen(false)} onHeight={setAboutHeight} />
      </div>
    </main>
  )
}
