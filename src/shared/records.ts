// 延長(再開)を1回押した記録。押した時刻と、その時選んだ分数。
export interface ResumeEvent {
  at: string
  minutes: number
}

// 確定済みの1件。records.json = この配列。
// resumes.length===0 で守れたか、closedAt-targetAt で超過量が後から復元できる。
export interface PromiseRecord {
  date: string
  startedAt: string
  targetAt: string
  resumes: ResumeEvent[]
  closedAt: string
}

// OK を押さずに終わった約束の1件。missed.json = この配列。
// records.json とは別のファイル＝帯判定の元データを汚さない。
// closedAt は持たない＝OK を押していないので終えた時刻は分からない(推測で埋めると作業時間に嘘が混ざる)。
export interface MissedRecord {
  date: string // startedAt のローカル日付。startedAt が壊れていれば noticedAt の日付
  startedAt: string
  targetAt: string
  resumes: ResumeEvent[]
  nextFireAt: string // 最後に鳴るはずだった時刻
  firedAt?: string // その回のおわり画面が出た時刻(出ていなければ無し)
  noticedAt: string // アプリが気づいた時刻(次の起動時、または画面が全部閉じられた時)
  reason: MissedReason
}

// missed = その回のおわり画面が一度も出ていない(firedAt 無し)
// no-ok = おわり画面は出たが OK を押さずに終わった(firedAt 有り)
// invalid = メモ(state.json)が壊れていて時刻が読めない(読めた範囲だけ残し、読めない項目は空文字)
export type MissedReason = 'missed' | 'no-ok' | 'invalid'

// アプリ設定。settings.json の中身。無ければ DEFAULT_SETTINGS。
export interface Settings {
  // PC起動(ログイン)時にアプリを開くか。既定オフ。実際のOS登録は配布用exe(app.isPackaged)のときだけ main が行う。
  openAtLogin: boolean
  // 終了画面で曲(Hanadoki)を流すか。既定オン＝2026-09-23 本人決定。
  playEndMusic: boolean
}
export const DEFAULT_SETTINGS: Settings = { openAtLogin: false, playEndMusic: true }
