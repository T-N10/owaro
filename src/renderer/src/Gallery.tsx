import PromiseScreen, { type PromisePreview } from './PromiseScreen'
import { PROMISE_H_CLOSED, PROMISE_H_OPEN, PROMISE_W } from '../../shared/constants'

// 見た目の確認用カタログ('#/gallery'・開発ビルド限定)。
// 実際には一瞬で消える状態(送信中など)も並べて、実装そのものを実寸で描く
// ＝マークアップを書き写さないので、本体を直せばここも一緒に直る。
// 本物の IPC・時計には触らない(preview を渡した PromiseScreen は副作用を持たない)。

// 基準時刻を 22:00 に固定して、どの枠も同じ前提で見えるようにする。
const BASE = new Date(2026, 7, 16, 22, 0, 0, 0).getTime()
const iso = (h: number, m: number, addDay = 0): string =>
  new Date(2026, 7, 16 + addDay, h, m, 0, 0).toISOString()

type Item = { title: string; note?: string; preview: PromisePreview; height?: number }

const ITEMS: Item[] = [
  {
    title: '初期（閉）',
    note: '起動直後。既定値＝起動時刻+5分の切り上げ',
    preview: { now: BASE, time: '23:00' }
  },
  {
    title: 'ドラム開',
    note: '時刻カードを開いたところ。窓が伸びる',
    preview: { now: BASE, time: '23:00', wheelOpen: true },
    height: PROMISE_H_OPEN
  },
  {
    title: 'メニュー開',
    note: '三本線を押したところ。記録を保存する／PC起動時に開く／おわりに曲を流す',
    preview: {
      now: BASE,
      time: '23:00',
      drawerOpen: true,
      settings: { openAtLogin: true, playEndMusic: true }
    }
  },
  {
    title: '予約中（猶予内）',
    note: '立てた直後の5分間。時間をかえる＋とりけす',
    preview: { now: BASE, time: '23:00', pending: { startedAt: iso(21, 58), targetAt: iso(23, 0) } }
  },
  {
    title: '予約中（猶予外）',
    note: '立ててから5分以上。変更は不可、いますぐ おわる',
    preview: { now: BASE, time: '23:00', pending: { startedAt: iso(21, 0), targetAt: iso(23, 0) } }
  },
  {
    title: '送信中',
    note: 'ボタンが押せない一瞬の状態',
    preview: { now: BASE, time: '23:00', submitting: true }
  },
  {
    title: '入口ブロック（明日になる）',
    note: '朝5時を越える止め時は登録させない',
    preview: { now: BASE, time: '10:00' }
  },
  {
    title: '入口ブロック（遠すぎる）',
    note: '18時間より先',
    preview: { now: new Date(2026, 7, 16, 5, 30).getTime(), time: '00:00' }
  },
  {
    title: '送信エラー',
    note: '保存に失敗したとき',
    preview: { now: BASE, time: '23:00', error: 'うまくはじめられなかった、もう一度 (ว˙˘˙)ง' }
  }
]

const OVERLAYS: { title: string; note: string; query: string }[] = [
  { title: 'ロック中', note: 'OKが押せない30秒', query: 'lock=30&silent=1' },
  { title: 'ロック解除', note: 'OKと あとちょっと が押せる', query: 'lock=0&silent=1' },
  { title: 'あとちょっと 開', note: 'ドラムで分数を選んでいる', query: 'lock=0&pick=10&silent=1' },
  { title: '延長済み', note: '2回目のおわり。あとちょっと は出ない', query: 'lock=0&extended=1&silent=1' },
  { title: '音つき（実物）', note: '曲も鳴らして確認', query: 'lock=3' }
]

export default function Gallery() {
  return (
    <main className="gallery">
      <header className="gallery-head">
        <h1>画面カタログ</h1>
        <p>
          実装そのものを実寸（{PROMISE_W}×{PROMISE_H_CLOSED}、ドラム開は{PROMISE_H_OPEN}
          ）で描いています。本物の記録・予約には触れません。
        </p>
      </header>

      <section className="gallery-grid">
        {ITEMS.map((it) => (
          <figure className="gallery-item" key={it.title}>
            <div
              className="gallery-frame"
              style={{ width: PROMISE_W, height: it.height ?? PROMISE_H_CLOSED }}
              aria-label={it.title}
            >
              <PromiseScreen preview={it.preview} />
            </div>
            <figcaption>
              <b>{it.title}</b>
              {it.note && <span>{it.note}</span>}
            </figcaption>
          </figure>
        ))}
      </section>

      <header className="gallery-head">
        <h2>おわりの画面</h2>
        <p>
          全画面のため実物を開いて確認します。OKや「あとちょっと」を押しても記録は残りません。
          残り秒は止めてあるので、抜けるときは <b>Esc</b> か右上の「閉じる」。
        </p>
      </header>
      <section className="gallery-launch">
        {OVERLAYS.map((o) => (
          <button
            key={o.title}
            type="button"
            className="gallery-btn"
            onClick={() => window.api.previewOverlay(o.query)}
          >
            {o.title}
            <span>{o.note}</span>
          </button>
        ))}
      </section>
    </main>
  )
}
