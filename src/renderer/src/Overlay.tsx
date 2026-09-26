import { useEffect, useRef, useState } from 'react'
import Wheel from './Wheel'
import { AlarmIcon, Chevron } from './TimePickerCard'
import { LOCK_SECONDS, EXTEND_OPTIONS } from '../../shared/constants'
import bgmUrl from './assets/hanadoki-pianosolo.ogg?url'

// BGM の音量(0〜1)。穏やかに流す程度。
const BGM_GAIN = 0.35
// 画面表示から BGM_GAIN に届くまでのフェードイン秒数。
const BGM_FADE_IN_SEC = 1
// OK / 延長 / プレビュー閉じで 0 まで下げるフェードアウト秒数(その後 AudioContext を閉じる)。
const BGM_FADE_OUT_SEC = 1

// 止め時オーバーレイ(Figma 5:81「03_完了（待ち）」/ 105:362「（分岐）」/ 99:329「延長」)。
// 画面いっぱいの黒地に「おわり」と、BGM(Hanadoki ピアノソロ版)のループ再生。
// 音の経緯: 880Hz ビープ → 生成音の鐘 → 音源 Hanadoki ピアノソロ版(2026-09-23 本人決定・鐘は廃止)。
// 音源: PeriTune「Hanadoki」/ CC BY 4.0 / クレジットは AboutPanel。
// 最初の LOCK_SECONDS 秒は何も押せず、残り秒を下の一行に出す。0 で有効化。
// ロック解除後、OK は1つだけ:
//   「あとちょっと」カードを閉じたまま OK = 本当に終わり(最終)。音停止 → closeOverlay(記録)。
//   カードを開いて分数を選ぶと OK の文字が「あと N 分」に変わる。押す = extendOverlay(分)。
// 延長は1回だけ(2026-09-04 本人確定)。延長済み(resumes≥1)ならカードもその説明も出さない。
// どちらも窓は main 側が閉じる(延長時は再走して新しいオーバーレイが出る)。
// 見た目の確認用に状態を固定して出すための指定(ギャラリーから開く)。
// preview のときは記録にも約束にも触らない＝OKを押しても閉じるだけ。
export type OverlayPreview = {
  lock?: number
  pick?: number | null
  silent?: boolean
  extended?: boolean
}

const EXTEND_ITEMS = EXTEND_OPTIONS.map(String)

export default function Overlay({ preview }: { preview?: OverlayPreview } = {}) {
  const [remaining, setRemaining] = useState(preview?.lock ?? LOCK_SECONDS)
  const [closing, setClosing] = useState(false)
  // 「あとちょっと」カードの開閉と、ドラムで選んでいる分数(index)。
  const initialPick = preview?.pick != null ? EXTEND_OPTIONS.indexOf(preview.pick) : -1
  const [pickOpen, setPickOpen] = useState(initialPick >= 0)
  const [minuteIdx, setMinuteIdx] = useState(initialPick >= 0 ? initialPick : 0)
  // 延長済みか(1回だけの規則)。本物は state.json の resumes を見る。
  const [alreadyExtended, setAlreadyExtended] = useState(preview?.extended ?? false)
  // 延長IPCの送信中フラグ(二重送信防止)。
  const [extending, setExtending] = useState(false)
  // 音を止める関数。OK / 延長 押下時にも呼べるよう ref に保持する。
  const stopAudioRef = useRef<() => void>(() => {})

  // Web Audio API で音源 Hanadoki(ピアノソロ版)を画面表示と同時にフェードインしてループ再生。
  // OK / 延長 / プレビュー閉じで BGM_FADE_OUT_SEC かけて消してから止める。
  // この画面は警報ではなく「ここで区切り」の儀式なので、叩き起こす音ではなく穏やかな曲で落ち着かせる。
  // 読み込みや再生に失敗したら無音のまま(画面は通常どおり動く)。
  useEffect(() => {
    if (preview?.silent) return // 見た目の確認中に鳴らし続けない
    // 設定(おわりに曲を流す)の取得は非同期。取得が返るより先に OK/延長/アンマウントが
    // 来たら、曲は「始めない」を stop 扱いにする(あとから鳴り出さない)。
    let cancelled = false
    let realStop: (() => void) | null = null

    const stop = (): void => {
      cancelled = true
      realStop?.()
    }
    stopAudioRef.current = stop

    // 「おわりに曲を流す」設定を見てから鳴らす(既定オン・2026-09-23)。取得に失敗したら
    // 既定どおり鳴らす(フォールバック)。
    window.api
      .getSettings()
      .then((s) => {
        if (!cancelled && s.playEndMusic !== false) startAudio()
      })
      .catch(() => {
        if (!cancelled) startAudio()
      })

    // 実際に曲を鳴らし始める(Web Audio API)。設定確認の後に呼ぶ。
    function startAudio(): void {
      const ctx = new AudioContext()
      let stopped = false

      // 曲は <audio> で読みながら鳴らす(ストリーミング)。5.9MB を丸ごと decode してから
      // 鳴らす方式だと始まりが 1 秒以上遅れた(2026-09-23 本人「0.3秒後には鳴ってほしい」)。
      // 音量の上げ下げは <audio> を Web Audio に繋いだ GainNode で行う。
      const audio = new Audio(bgmUrl)
      audio.loop = true
      const gain = ctx.createGain()
      gain.gain.setValueAtTime(0, ctx.currentTime)
      ctx.createMediaElementSource(audio).connect(gain)
      gain.connect(ctx.destination)
      audio.addEventListener('error', () => {
        if (!stopped) console.warn('[overlay] BGM を読み込めませんでした(無音で続行):', audio.error)
      })
      void audio
        .play()
        .then(() => {
          if (stopped) return
          const now = ctx.currentTime
          gain.gain.setValueAtTime(0, now)
          gain.gain.linearRampToValueAtTime(BGM_GAIN, now + BGM_FADE_IN_SEC)
        })
        .catch((err: unknown) => {
          if (!stopped) console.warn('[overlay] BGM を再生できませんでした(無音で続行):', err)
        })

      // Electron 既定では gesture 不要で鳴るが、保険として resume を試みる。
      void ctx.resume().catch(() => {})

      // 自動再生が抑止された場合のフォールバック: 最初の操作で resume。
      const resume = (): void => {
        void ctx.resume().catch(() => {})
      }
      window.addEventListener('pointerdown', resume)
      window.addEventListener('keydown', resume)

      realStop = (): void => {
        if (stopped) return
        stopped = true
        window.removeEventListener('pointerdown', resume)
        window.removeEventListener('keydown', resume)
        const now = ctx.currentTime
        gain.gain.cancelScheduledValues(now)
        gain.gain.setValueAtTime(gain.gain.value, now)
        gain.gain.linearRampToValueAtTime(0, now + BGM_FADE_OUT_SEC)
        window.setTimeout(() => {
          audio.pause()
          audio.removeAttribute('src')
          void ctx.close().catch(() => {})
        }, BGM_FADE_OUT_SEC * 1000 + 50)
      }
    }

    return stop
  }, [preview?.silent])

  // 本物のときだけ、延長済みかを state から読む(1回だけの規則の表示側)。
  useEffect(() => {
    if (preview) return
    let alive = true
    window.api
      .getPending()
      .then((p) => {
        if (alive && p) setAlreadyExtended(p.resumes.length >= 1)
      })
      .catch(() => {
        // 読めなければ「未延長」として出す。main 側が2回目を拒否するので安全。
      })
    return () => {
      alive = false
    }
  }, [preview])

  // 確認用オーバーレイの脱出口(preview 限定)。
  // preview は下のカウントダウンを止めて見た目を固定する＝「ロック中」の残り秒は
  // 永久に減らず OK が一生押せない。全画面・最前面・タスクバーの上なので、
  // 出口が無いとアプリを殺すまで画面が触れなくなる。必ず抜けられる道を用意する。
  const closePreview = (): void => {
    stopAudioRef.current()
    void window.api.closePreviewOverlay()
  }
  useEffect(() => {
    if (!preview) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') closePreview()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [preview])

  // 残り秒のカウントダウン（renderer ローカル、IPC 不要）。0 で停止。
  useEffect(() => {
    if (preview) return // プレビューは状態を固定する(カウントが進んで別の見た目になるのを防ぐ)
    if (remaining <= 0) return
    const id = window.setTimeout(() => {
      setRemaining((r) => Math.max(0, r - 1))
    }, 1000)
    return () => window.clearTimeout(id)
  }, [remaining, preview])

  const locked = remaining > 0
  // ロック中・送信中はどのボタンも不可。
  const busy = locked || closing || extending
  const canExtend = !alreadyExtended
  const minutes = EXTEND_OPTIONS[minuteIdx]

  async function onOk(): Promise<void> {
    if (busy) return
    if (preview) {
      // 記録も約束も触らずに窓だけ閉じる(本物の records を汚さないため)。
      closePreview()
      return
    }
    setClosing(true)
    stopAudioRef.current()
    try {
      await window.api.closeOverlay()
    } catch {
      // 窓は main が閉じる。失敗しても音は止めているので再度押せるよう戻す。
      setClosing(false)
    }
  }

  async function onExtend(): Promise<void> {
    if (busy || !canExtend) return
    if (preview) {
      closePreview()
      return
    }
    setExtending(true)
    stopAudioRef.current()
    try {
      const res = await window.api.extendOverlay(minutes)
      // 成功時は main が窓を閉じ、再走後に新しいオーバーレイが出る(状態は破棄される)。
      if (!res.ok) {
        // main が拒否(延長済みなど)。カードを畳んで OK だけにする。
        setAlreadyExtended(true)
        setPickOpen(false)
        setExtending(false)
      }
    } catch {
      // 失敗時は音を止めたまま再度押せるよう戻す。
      setExtending(false)
    }
  }

  // OK の意味はカードの開閉で決まる: 閉＝おわり / 開＝あと N 分(延長)。文字で示す。
  const extendMode = pickOpen && canExtend

  return (
    <main className="screen overlay">
      {preview && (
        <button type="button" className="overlay-preview-close" onClick={closePreview}>
          閉じる（確認用・Esc）
        </button>
      )}
      <div className="overlay-inner">
        {/* 文言は Figma(node 5:81)。宣告(「止め時です」)ではなく、
            ねぎらって終わらせる声にする＝責めない・急かさない。 */}
        <h1 className="overlay-title">おわり</h1>
        <p className="overlay-sub">今回はここまで、おつかれさまでした。</p>
        <div className="overlay-controls">
          {canExtend && (
            <div className={`ov-card${pickOpen ? ' is-open' : ''}${busy ? ' is-locked' : ''}`}>
              <button
                type="button"
                className="ov-card-head"
                onClick={() => setPickOpen((o) => !o)}
                disabled={busy}
                aria-expanded={pickOpen}
              >
                <span className="tp-info">
                  <AlarmIcon />
                  <span className="tp-label">あとちょっと</span>
                </span>
                <Chevron open={pickOpen} />
              </button>
              {pickOpen && (
                <div className="ov-card-body">
                  <Wheel
                    items={EXTEND_ITEMS}
                    index={minuteIdx}
                    onChange={setMinuteIdx}
                    ariaLabel="延長する分"
                    unit="分"
                    variant="dark"
                    disabled={busy}
                  />
                </div>
              )}
            </div>
          )}
          <button
            type="button"
            className="overlay-ok"
            onClick={extendMode ? onExtend : onOk}
            disabled={busy}
          >
            {extendMode ? `あと ${minutes} 分` : 'OK'}
          </button>
          <p className="ov-label">
            {locked ? (
              <>
                <span>
                  あと <span className="num">{remaining}</span> 秒 だけまっててね
                </span>
                <span aria-hidden="true">(ｰｰ;)</span>
              </>
            ) : canExtend ? (
              <>
                <span>あとちょっと は 1 回 だけ選ぶことができるよ</span>
                <span aria-hidden="true">(._.)</span>
              </>
            ) : null}
          </p>
        </div>
      </div>
    </main>
  )
}
