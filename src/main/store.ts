import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import {
  DEFAULT_SETTINGS,
  type MissedRecord,
  type PromiseRecord,
  type ResumeEvent,
  type Settings
} from '../shared/records'

// 呼び出し元(index.ts等)が引き続き store.ts からインポートできるように再エクスポート。
// 型の実体は electron に依存しない src/shared/records.ts に置く。
export type { MissedRecord, PromiseRecord, ResumeEvent, Settings } from '../shared/records'

// 進行中の約束（未クローズ時のみ存在）。state.json の中身 = これ | null。
// resumes が空のまま最終OK = 一度も延長せず約束を守れた（勝ち）。
// nextFireAt = 次にオーバーレイを出す時刻。初回は targetAt と同じ。延長ごとに更新。
// firedAt = その回のおわり画面を本物として出した時刻。延長すると消える(次の画面はまだ出ていない)。
//   OK を押さずに終わったとき「見逃し」か「OKなし」かを見分けるためだけに使い、records.json には入れない。
export interface PromiseState {
  startedAt: string
  targetAt: string
  resumes: ResumeEvent[]
  nextFireAt: string
  firedAt?: string
}

// 未知の値から ResumeEvent[] を取り出す。配列でない/要素が欠けるものは捨てる（壊さない）。
function coerceResumes(value: unknown): ResumeEvent[] {
  if (!Array.isArray(value)) return []
  return value.filter(
    (r): r is ResumeEvent =>
      !!r &&
      typeof r === 'object' &&
      typeof (r as ResumeEvent).at === 'string' &&
      typeof (r as ResumeEvent).minutes === 'number'
  )
}

function stateFile(): string {
  return join(app.getPath('userData'), 'state.json')
}

function recordsFile(): string {
  return join(app.getPath('userData'), 'records.json')
}

function missedFile(): string {
  return join(app.getPath('userData'), 'missed.json')
}

function settingsFile(): string {
  return join(app.getPath('userData'), 'settings.json')
}

// 壊れた/想定外のファイルを上書き消滅させず、退避してから作り直す（データ保全）。
function backupCorrupt(file: string): void {
  try {
    const bak = `${file}.corrupt-${Date.now()}`
    renameSync(file, bak)
    console.error(`[store] corrupt file preserved at ${bak}`)
  } catch (err) {
    console.error('[store] failed to back up corrupt file:', err)
  }
}

// state.json を読む内部ヘルパー。
//   state = 正常に読めたメモ(無い/空/null/読めないときは null)
//   unreadable = 中身はあるのに読めないメモ(壊れた JSON・開始時刻か止め時が無い)から、読めた範囲の値。
//                壊れた JSON なら {}。中身が無い/正常に読めた/ファイル自体を開けなかったときは null。
function parseStateFile(): { state: PromiseState | null; unreadable: Partial<PromiseState> | null } {
  const none = { state: null, unreadable: null }
  const file = stateFile()
  if (!existsSync(file)) return none

  let text: string
  try {
    text = readFileSync(file, 'utf-8')
  } catch (err) {
    // 開けなかっただけ(一時的なロック等)で中身が壊れたとは限らない＝読めない記録にはしない。
    console.error('[store] failed to read state.json:', err)
    return none
  }

  const trimmed = text.trim()
  if (trimmed === '' || trimmed === 'null') return none

  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch (err) {
    // 壊れたJSONは握り潰さずログ。進行中なしとして扱う。
    console.error('[store] state.json is corrupt, treating as none:', err)
    return { state: null, unreadable: {} }
  }

  const p = (parsed && typeof parsed === 'object' ? parsed : {}) as Partial<
    Record<keyof PromiseState, unknown>
  >
  if (typeof p.startedAt === 'string' && typeof p.targetAt === 'string') {
    // 後方互換: 旧形状(resumes / nextFireAt が無い state.json)は
    // resumes=[]・nextFireAt=targetAt で補完して新形状に揃える（壊さない）。
    return {
      state: {
        startedAt: p.startedAt,
        targetAt: p.targetAt,
        resumes: coerceResumes(p.resumes),
        nextFireAt: typeof p.nextFireAt === 'string' ? p.nextFireAt : p.targetAt,
        ...(typeof p.firedAt === 'string' ? { firedAt: p.firedAt } : {})
      },
      unreadable: null
    }
  }
  console.error('[store] state.json has unexpected shape, treating as none:', parsed)
  // 読めた範囲だけ拾う(分からない項目は推測で埋めない)。
  const partial: Partial<PromiseState> = { resumes: coerceResumes(p.resumes) }
  if (typeof p.startedAt === 'string') partial.startedAt = p.startedAt
  if (typeof p.targetAt === 'string') partial.targetAt = p.targetAt
  if (typeof p.nextFireAt === 'string') partial.nextFireAt = p.nextFireAt
  if (typeof p.firedAt === 'string') partial.firedAt = p.firedAt
  return { state: null, unreadable: partial }
}

// state.json を読む。無ければ/空/null → null。壊れたJSONは握り潰さずログして null（割り切り）。
export function readState(): PromiseState | null {
  return parseStateFile().state
}

// 起動時用(B-18)。中身はあるのに読めないメモ(壊れた JSON・開始時刻か止め時が無い)なら、
// 読めた範囲の値を返す。それ以外は null。「読めない記録」として missed.json へ移すために使う。
export function readUnreadableState(): Partial<PromiseState> | null {
  return parseStateFile().unreadable
}

export function writeState(s: PromiseState): void {
  writeFileSync(stateFile(), JSON.stringify(s, null, 2), 'utf-8')
}

// 保留をクリア（= null を書き込む）。
export function clearState(): void {
  writeFileSync(stateFile(), JSON.stringify(null), 'utf-8')
}

// 読めないメモを消さずに別名(state.json.corrupt-<数字>)で残してから、保留をクリアする(B-18)。
// 後でメモ帳で開けば、途中まで書けていた時刻などが読めることがある(2026-09-24 本人決定)。
// 別名にできなくてもクリアは必ずする(残ると次の起動でまた読めない記録が入る)。
export function setAsideUnreadableState(): void {
  backupCorrupt(stateFile())
  clearState()
}

// records.json を読むだけの内部ヘルパー。退避や書き戻しは呼び出し側の責務にする
// （appendRecord は壊れていたら退避するが、readRecords は読むだけで何も変えない）。
function loadRecords(file: string): { records: PromiseRecord[]; corrupt: boolean } {
  if (!existsSync(file)) return { records: [], corrupt: false }

  let text = ''
  try {
    text = readFileSync(file, 'utf-8')
  } catch (err) {
    console.error('[store] failed to read records.json:', err)
    return { records: [], corrupt: false }
  }

  const trimmed = text.trim()
  if (trimmed === '') return { records: [], corrupt: false }

  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (Array.isArray(parsed)) {
      return { records: parsed as PromiseRecord[], corrupt: false }
    }
    console.error('[store] records.json is not an array')
    return { records: [], corrupt: true }
  } catch (err) {
    // 壊れたJSONは握り潰さずログ。
    console.error('[store] records.json is corrupt:', err)
    return { records: [], corrupt: true }
  }
}

// records.json を読み→push→書き戻し。無ければ初期化。
// 壊れた/配列でない場合は握り潰さずログし、退避してから新規配列で続行（記録を消さない）。
export function appendRecord(rec: PromiseRecord): void {
  const file = recordsFile()
  const { records, corrupt } = loadRecords(file)

  if (corrupt) {
    // データ保全のため退避してから作り直す。
    backupCorrupt(file)
  }

  records.push(rec)
  writeFileSync(file, JSON.stringify(records, null, 2), 'utf-8')
}

// 読み出し専用。records.json は帯判定の一次データなので、読むだけで絶対に退避・書き戻しをしない。
export function readRecords(): PromiseRecord[] {
  const { records, corrupt } = loadRecords(recordsFile())
  if (corrupt) {
    console.error('[store] records.json is corrupt; returning empty (read-only, no backup)')
  }
  return records
}

// missed.json を読むだけの内部ヘルパー。loadRecords と同じ流儀(退避や書き戻しは呼び出し側)。
function loadMissed(file: string): { records: MissedRecord[]; corrupt: boolean } {
  if (!existsSync(file)) return { records: [], corrupt: false }

  let text = ''
  try {
    text = readFileSync(file, 'utf-8')
  } catch (err) {
    console.error('[store] failed to read missed.json:', err)
    return { records: [], corrupt: false }
  }

  const trimmed = text.trim()
  if (trimmed === '') return { records: [], corrupt: false }

  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (Array.isArray(parsed)) {
      return { records: parsed as MissedRecord[], corrupt: false }
    }
    console.error('[store] missed.json is not an array')
    return { records: [], corrupt: true }
  } catch (err) {
    console.error('[store] missed.json is corrupt:', err)
    return { records: [], corrupt: true }
  }
}

// OK を押さずに終わった約束を missed.json に1件足す(B-18)。records.json とは別の帳面
// ＝作業時間の集計(帯判定)には入らない。壊れていたら退避してから作り直す(記録を消さない)。
export function appendMissed(rec: MissedRecord): void {
  const file = missedFile()
  const { records, corrupt } = loadMissed(file)

  if (corrupt) {
    backupCorrupt(file)
  }

  records.push(rec)
  writeFileSync(file, JSON.stringify(records, null, 2), 'utf-8')
}

// 読み出し専用(書き出し用)。readRecords と同じく、読むだけで退避・書き戻しをしない。
export function readMissed(): MissedRecord[] {
  const { records, corrupt } = loadMissed(missedFile())
  if (corrupt) {
    console.error('[store] missed.json is corrupt; returning empty (read-only, no backup)')
  }
  return records
}

// settings.json を読む。無ければ既定値。壊れている/形が想定外でも握り潰さずログして既定値
// （settings は補助データなので、records.json のような退避はしない）。
export function readSettings(): Settings {
  const file = settingsFile()
  if (!existsSync(file)) return { ...DEFAULT_SETTINGS }

  let text: string
  try {
    text = readFileSync(file, 'utf-8')
  } catch (err) {
    console.error('[store] failed to read settings.json:', err)
    return { ...DEFAULT_SETTINGS }
  }

  try {
    const parsed = JSON.parse(text.trim()) as Partial<Settings> | null
    if (!parsed || typeof parsed !== 'object') {
      console.error('[store] settings.json has unexpected shape, using defaults:', parsed)
      return { ...DEFAULT_SETTINGS }
    }
    return {
      openAtLogin:
        typeof parsed.openAtLogin === 'boolean' ? parsed.openAtLogin : DEFAULT_SETTINGS.openAtLogin,
      playEndMusic:
        typeof parsed.playEndMusic === 'boolean' ? parsed.playEndMusic : DEFAULT_SETTINGS.playEndMusic
    }
  } catch (err) {
    console.error('[store] settings.json is corrupt, using defaults:', err)
    return { ...DEFAULT_SETTINGS }
  }
}

export function writeSettings(s: Settings): void {
  writeFileSync(settingsFile(), JSON.stringify(s, null, 2), 'utf-8')
}
