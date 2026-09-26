// main / renderer 共有の定数。
// オーバーレイのOKボタンが押せるようになるまでのロック秒数。
// 30秒のカウントダウン自体は renderer 側ローカルで実装する(IPC不要)。
export const LOCK_SECONDS = 30

// 延長(再開)で選べる分数。最大15分。as const を付けないことで型を number[] に保ち、
// EXTEND_OPTIONS.includes(任意の number) が main / renderer 両方で型エラーなく書ける。
export const EXTEND_OPTIONS = [5, 10, 15]

// 立てた直後だけ止め時を変えたり取り消したりできる猶予(5分)。立て間違いは直後に気づき、
// 逃げたい衝動は締切間際に湧く＝この窓なら訂正だけを拾い、逃げ道にはならない。
// 2026-08-30 裁定(d): 猶予の掛け先は「変更」側。5分を過ぎたら「時間をかえる」は押せない。
// renderer はボタンを無効化し、main は setPromise で拒否する(最終防衛)。
export const GRACE_MS = 5 * 60 * 1000

// 約束入力窓の内寸(useContentSize=true と同じ「中身の寸法」)。
// OS のタイトルバーは隠し(titleBarStyle:'hidden')、上端 HEADER_H の帯を自前で描くので、
// 高さには帯のぶんが含まれる。時刻のドラムを開くと OPEN の高さへ伸び、閉じると戻る
// (2026-08-30 本人裁定「一旦伸縮で作る」)。値は Figma(2:36=353 / 77:739=471)。
// CLOSED は Figma 77:693(予約中)の 386 ＝ ボタン下端312 + 24 + 一行(14px cap 10) + 40。一行が無い
// 初期画面でも同じ高さ(状態で窓が動かない。2026-09-12 本人裁定)。
// OPEN はドラム(字24px・行30px)で中身が +167 伸びるぶん ＝ 553。
// ギャラリー('#/gallery')もこの値で実寸の枠を作るので、ここが唯一の出どころ。
export const PROMISE_W = 384
export const PROMISE_H_CLOSED = 386
export const PROMISE_H_OPEN = 553
export const HEADER_H = 40
// カードの中身(.tp-body)の開閉にかける時間(ms)。
// 開く: 窓を一回で伸ばし→中身が伸びる。閉じる: 中身が縮み終わってから窓を戻す。
// index.css の --tp-open-ms と手で揃える(CSS は import できない)。
export const PROMISE_RESIZE_MS = 180
// 閉じるとき、窓を OPEN→CLOSED へ刻んで縮めるのにかける時間(ms)。中身が動いている最中に窓を刻むと
// Windows が古い描画(ドラムの数字)を貼り残した(2026-09-12)ので、中身が止まってから刻む(2026-09-20)。
export const PROMISE_WINDOW_SHRINK_MS = 150

// ドラムの選択肢。時=00..23 / 分=5分刻み。
export const WHEEL_HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'))
export const WHEEL_MINUTES = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, '0'))
