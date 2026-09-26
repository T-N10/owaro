import type { MissedReason, MissedRecord, PromiseRecord } from './records'

// 記録の書き出し(B-16)。electron を import しない純粋な整形＝main からも将来のテストからも呼べる。
// 用途は「AIとの壁打ちに記録を渡す」。だから中身は事実だけ＝日時・武装時間・超過・延長の内訳。
// 「守れた率」「連続日数」のような評価は入れない(熱量を要求しない思想。蓄積画面 B-10 を
// 消したのと同じ理由。評価は読む側＝人とAIがする)。
export type ExportFormat = 'csv' | 'md' | 'html'

// 保存ダイアログで選んだ拡張子から形式を決める(形式選択のUIは持たない＝OSの
// 「ファイルの種類」がそのまま形式の選択)。不明な拡張子は CSV に倒す。
export function formatFromExtension(ext: string): ExportFormat {
  switch (ext.toLowerCase().replace(/^\./, '')) {
    case 'md':
    case 'markdown':
      return 'md'
    case 'html':
    case 'htm':
      return 'html'
    default:
      return 'csv'
  }
}

// 「種類」= その回の終わり方。OK を押した回(records.json)は「おわり」、
// OK を押さずに終わった回(missed.json)は reason に応じた呼び名(2026-09-24 本人決定)。
// 判定をしない言葉にする(「逃げ」「失敗」は使わない)。
const KIND_OK = 'おわり'
const KIND_MISSED: Record<MissedReason, string> = {
  missed: '見逃し',
  'no-ok': 'OKなし',
  invalid: '読めない記録'
}

const HEADERS = [
  '日付',
  '種類',
  '開始',
  '止め時',
  '終了',
  '武装時間(分)',
  '超過(分)',
  '延長回数',
  '延長合計(分)',
  '延長の内訳',
  '開始ISO',
  '止め時ISO',
  '終了ISO'
]

const pad2 = (n: number): string => String(n).padStart(2, '0')

// ISO → ローカルの「YYYY-MM-DD HH:MM」。壊れた値はそのまま返す(捨てない)。
function localDateTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

function localTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

// 2つのISOの差を分で。小数1桁。どちらかが壊れていれば空。
function minutesBetween(fromIso: string, toIso: string): string {
  const a = new Date(fromIso).getTime()
  const b = new Date(toIso).getTime()
  if (Number.isNaN(a) || Number.isNaN(b)) return ''
  return ((b - a) / 60_000).toFixed(1)
}

// 延長の列(回数・合計・内訳)。おわりの回も OK なしの回も同じ作り。
function resumeCells(value: unknown): [string, string, string] {
  const resumes = Array.isArray(value) ? (value as PromiseRecord['resumes']) : []
  const total = resumes.reduce((sum, e) => sum + (Number(e.minutes) || 0), 0)
  const detail = resumes.map((e) => `${localTime(e.at)} +${e.minutes}`).join('; ')
  return [String(resumes.length), String(total), detail]
}

// 1件を文字列のセル配列にする。列の順は HEADERS と一致させること。
export function recordToRow(r: PromiseRecord): string[] {
  const [count, total, detail] = resumeCells(r.resumes)
  return [
    r.date ?? '',
    KIND_OK,
    localDateTime(r.startedAt),
    localDateTime(r.targetAt),
    localDateTime(r.closedAt),
    minutesBetween(r.startedAt, r.closedAt),
    minutesBetween(r.targetAt, r.closedAt),
    count,
    total,
    detail,
    r.startedAt ?? '',
    r.targetAt ?? '',
    r.closedAt ?? ''
  ]
}

// OK を押さずに終わった1件。終了・武装時間・超過・終了ISO は空欄
// (OK を押していないので終えた時刻は分からない。推測で埋めない)。延長の列はそのまま埋める。
export function missedToRow(m: MissedRecord): string[] {
  const [count, total, detail] = resumeCells(m.resumes)
  return [
    m.date ?? '',
    KIND_MISSED[m.reason] ?? String(m.reason ?? ''),
    localDateTime(m.startedAt),
    localDateTime(m.targetAt),
    '',
    '',
    '',
    count,
    total,
    detail,
    m.startedAt ?? '',
    m.targetAt ?? '',
    ''
  ]
}

// 並べ替えの鍵=開始時刻。開始が壊れた OK なしの回は気づいた時刻で代える。どちらも読めなければ末尾。
function sortKey(iso: string | undefined, fallback?: string): number {
  const a = new Date(iso ?? '').getTime()
  if (!Number.isNaN(a)) return a
  const b = new Date(fallback ?? '').getTime()
  return Number.isNaN(b) ? Number.POSITIVE_INFINITY : b
}

// 表の説明の一文。件数の内訳だけを足す(割合や連続日数は入れない)。
function summary(kinds: string[]): string {
  const order = [KIND_OK, KIND_MISSED.missed, KIND_MISSED['no-ok'], KIND_MISSED.invalid]
  const counts = order
    .map((k) => [k, kinds.filter((x) => x === k).length] as const)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${k} ${n}`)
  const breakdown = counts.length > 0 ? `（${counts.join('・')}）` : ''
  const blanks = kinds.some((k) => k !== KIND_OK)
    ? 'おわり以外の回は OK を押していないので、終了・武装時間・超過は空欄。'
    : ''
  return `${kinds.length} 件${breakdown}。武装時間＝開始から終了まで。超過＝止め時から終了まで(負なら早く終えた)。${blanks}`
}

// ---- CSV ----
// Excel(Windows)で日本語見出しが化けないよう UTF-8 BOM を先頭に置き、改行は CRLF。
// すべてのセルを "" で囲む(内訳に ; や空白が入るため、悩まず全部囲む)。
function csvCell(s: string): string {
  return `"${s.replace(/"/g, '""')}"`
}

function toCsv(rows: string[][]): string {
  const lines = [HEADERS, ...rows].map((cells) => cells.map(csvCell).join(','))
  return `\uFEFF${lines.join('\r\n')}\r\n`
}

// ---- Markdown ----
function mdCell(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')
}

function toMarkdown(rows: string[][], note: string): string {
  const line = (cells: string[]): string => `| ${cells.map(mdCell).join(' | ')} |`
  const out = [
    '# Owaroの記録',
    '',
    note,
    '',
    line(HEADERS),
    `| ${HEADERS.map(() => '---').join(' | ')} |`,
    ...rows.map(line)
  ]
  return `${out.join('\n')}\n`
}

// ---- HTML(整形) ----
// 同じ表に最小限の見た目だけ。グラフや集計は置かない(蓄積画面を作り直さない)。
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function toHtml(rows: string[][], note: string): string {
  const tr = (cells: string[], tag: 'th' | 'td'): string =>
    `      <tr>${cells.map((c) => `<${tag}>${escapeHtml(c)}</${tag}>`).join('')}</tr>`
  return [
    '<!doctype html>',
    '<html lang="ja">',
    '<head>',
    '  <meta charset="utf-8">',
    '  <title>Owaroの記録</title>',
    '  <style>',
    "    body { font-family: 'IBM Plex Sans JP', 'Segoe UI', system-ui, sans-serif; color: #241f18; background: #fbf8f2; margin: 32px; }",
    '    h1 { font-size: 18px; font-weight: 500; }',
    '    p { color: #7b7264; font-size: 13px; }',
    '    table { border-collapse: collapse; font-size: 13px; }',
    '    th, td { border-bottom: 1px solid #e7dfd0; padding: 6px 10px; text-align: left; white-space: nowrap; }',
    '    th { color: #7b7264; font-weight: 500; }',
    '    td:nth-child(6), td:nth-child(7), td:nth-child(8), td:nth-child(9) { text-align: right; font-variant-numeric: tabular-nums; }',
    '  </style>',
    '</head>',
    '<body>',
    '  <h1>Owaroの記録</h1>',
    `  <p>${escapeHtml(note)}</p>`,
    '  <table>',
    '    <thead>',
    tr(HEADERS, 'th'),
    '    </thead>',
    '    <tbody>',
    ...rows.map((r) => tr(r, 'td')),
    '    </tbody>',
    '  </table>',
    '</body>',
    '</html>',
    ''
  ].join('\n')
}

// records.json(おわり)と missed.json(OK なし)を開始時刻の順に並べて1つの表にする。
// 開始時刻が同じなら元の並び(おわり→OK なし、各ファイル内は記録順)を保つ。
export function buildExport(
  records: PromiseRecord[],
  missed: MissedRecord[],
  format: ExportFormat
): string {
  const entries = [
    ...records.map((r) => ({ key: sortKey(r.startedAt), row: recordToRow(r) })),
    ...missed.map((m) => ({ key: sortKey(m.startedAt, m.noticedAt), row: missedToRow(m) }))
  ]
  entries.sort((a, b) => (a.key === b.key ? 0 : a.key < b.key ? -1 : 1))
  const rows = entries.map((e) => e.row)
  const note = summary(rows.map((r) => r[1]))
  switch (format) {
    case 'md':
      return toMarkdown(rows, note)
    case 'html':
      return toHtml(rows, note)
    default:
      return toCsv(rows)
  }
}
