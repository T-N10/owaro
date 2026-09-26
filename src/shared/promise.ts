// 「その止め時を受け付けてよいか」の判定。main(最終防衛)と renderer(入口の警告)の両方から
// 同じ関数を呼ぶ＝画面の出し分けと実際の受理条件がズレないようにする。

// 「今日のおわり」の境界。カレンダーの日付ではなく人間の一日で切る
// ＝23:30 に「00:30まで」を立てられないと、夜更かし中という一番の使いどころを塞ぐため。
export const DAY_END_HOUR = 5

// 日付上は今日でも遠すぎる約束を止める保険。
// 例=深夜0:30 に前回値の 23:00 を誤タップ(22.5時間先)は日付ルールをすり抜ける。
export const MAX_AHEAD_HOURS = 18

// 'grace-over' は evaluatePromise では出ない。予約中の変更が立てて5分を過ぎたときに
// main の setPromise が返す(2026-08-30 裁定(d)。renderer はボタン無効化、main が最終防衛)。
export type PromiseRejectReason = 'invalid' | 'past-day-end' | 'too-far' | 'grace-over'

export type PromiseVerdict =
  | { ok: true; target: Date }
  | { ok: false; reason: 'invalid' }
  | { ok: false; reason: 'past-day-end' | 'too-far'; target: Date }

export function parseHHMM(hhmm: string): { h: number; m: number } | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm.trim())
  if (!match) return null
  return { h: Number(match[1]), m: Number(match[2]) }
}

// HH:MM を実際の日時にする。指定時刻が既に過ぎていれば翌日として解釈する
// (この「黙って翌日にする」挙動こそが誤爆の温床なので、後段の判定で弾く)。
export function resolveTarget(hhmm: string, now: Date): Date | null {
  const parsed = parseHHMM(hhmm)
  if (!parsed) return null
  const target = new Date(now)
  target.setHours(parsed.h, parsed.m, 0, 0)
  if (target.getTime() <= now.getTime()) {
    target.setDate(target.getDate() + 1)
  }
  return target
}

// now から見た「今日のおわり」= 次に来る朝5:00。
// 深夜(0:00-4:59)は"まだ今日"なので当日の5:00、それ以外は翌日の5:00。
export function dayEndAfter(now: Date): Date {
  const end = new Date(now)
  end.setHours(DAY_END_HOUR, 0, 0, 0)
  if (end.getTime() <= now.getTime()) {
    end.setDate(end.getDate() + 1)
  }
  return end
}

// 受理してよい止め時かを判定する。作業しすぎを止めるアプリに日をまたぐ約束は存在しない
// ＝確認して通すのではなく、そもそも登録させない(本人裁定 2026-08-16)。
export function evaluatePromise(hhmm: string, now: Date): PromiseVerdict {
  const target = resolveTarget(hhmm, now)
  if (!target) return { ok: false, reason: 'invalid' }
  if (target.getTime() > dayEndAfter(now).getTime()) {
    return { ok: false, reason: 'past-day-end', target }
  }
  if (target.getTime() - now.getTime() > MAX_AHEAD_HOURS * 60 * 60 * 1000) {
    return { ok: false, reason: 'too-far', target }
  }
  return { ok: true, target }
}
