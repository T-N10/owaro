import { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage, dialog, shell } from 'electron'
import { join, extname } from 'node:path'
import { writeFileSync } from 'node:fs'
import {
  readState,
  readUnreadableState,
  setAsideUnreadableState,
  writeState,
  clearState,
  appendRecord,
  readRecords,
  appendMissed,
  readMissed,
  readSettings,
  writeSettings,
  type PromiseState,
  type Settings
} from './store'
import type { MissedReason } from '../shared/records'
import { buildExport, formatFromExtension } from '../shared/export'
import {
  EXTEND_OPTIONS,
  GRACE_MS,
  PROMISE_H_CLOSED,
  PROMISE_H_OPEN,
  PROMISE_W
} from '../shared/constants'
import { evaluatePromise, type PromiseRejectReason } from '../shared/promise'
// アプリのアイコン(16〜256px の9サイズ入り)。?asset で out/ へ同梱され、実パスが入る。
// exe・インストーラには electron-builder.yml の win.icon で同じファイルが入る。
import appIcon from '../../build/icon.ico?asset'

// setTimeout の上限(約24.8日 = 2^31-1 ms)。これを超える待ちは分割して再予約する。
const MAX_TIMEOUT = 2_147_483_647

// electron-vite dev のときだけ true(この env はビルド版には存在しない)。
// 寸法合わせ用の仕掛け(リサイズ可・DevTools)をここで一括して切り替える。
const IS_DEV = !!process.env['ELECTRON_RENDERER_URL']

// 窓の内寸(PROMISE_W / PROMISE_H_CLOSED / PROMISE_H_OPEN)は shared/constants.ts が正
// ＝ギャラリーが同じ値で実寸の枠を作るため、数字の出どころを1つにしてある。

// トレイの予備アイコン(16x16 の紫の四角)。本来は appIcon(icon.ico)を使う。ico が読めず
// 空の画像になったときだけこれを出す＝トレイが見えなくなって常駐を開けなくなるのを防ぐ。
const TRAY_ICON_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAO0lEQVR4nGNgoAVITvv4HxumSDNRhhDSjNcQYjVjNYRUzRiGjBpABQMojkaqJCRiDcGrmZAhRGkmFQAAO4CozD/vc/EAAAAASUVORK5CYII='

// 記録の置き場所(userData)は製品名に関係なく %APPDATA%\yakusoku-guard に固定する。
// 配布版の productName を Owaro にした(2026-09-23)ため、放っておくと %APPDATA%\Owaro に
// 変わって過去の記録が見えなくなる。単一起動ロックもこのフォルダ単位。--gallery / --demo の
// 別名化はこの後で上書きする。
app.setPath('userData', join(app.getPath('appData'), 'yakusoku-guard'))

// --gallery: 画面カタログ専用の起動(デスクトップのショートカット用・開発ビルド限定)。
// 記録フォルダ(userData)を別名にして本体と切り離す＝本体が約束中でも2つ目として立ち上がり、
// state.json / records.json は一切触らない。トレイも出さず、カタログを閉じたら終了する。
const GALLERY_MODE = IS_DEV && process.argv.includes('--gallery')
if (GALLERY_MODE) {
  app.setPath('userData', `${app.getPath('userData')}-gallery`)
}

// --demo: デモ専用の起動(デスクトップのショートカット用・開発ビルド限定)。
// 中身は通常起動と同じ(トレイも約束も動く)が、--gallery と同じく userData を
// 別名にして本体と切り離す＝本番が常駐中でも2つ目として立ち上がり(インスタンス
// ロックは userData 単位)、デモで立てた約束が本物の state.json / records.json に混ざらない。
if (IS_DEV && !GALLERY_MODE && process.argv.includes('--demo')) {
  app.setPath('userData', `${app.getPath('userData')}-demo`)
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
}

let tray: Tray | null = null
let promiseWindow: BrowserWindow | null = null
let overlayWindows: BrowserWindow[] = []
// アプリ自身が閉じた(closeAllOverlays 経由の)おわり画面の印。これが付いていない窓が閉じたら
// 本人が閉じた(Alt+F4 など)と分かる。
const closedByApp = new WeakSet<BrowserWindow>()
// アプリの終了中・Windows の終了中は、おわり画面が閉じても「本人が閉じた」とは扱わない
// (メモを残し、次の起動時に resumePending が「OKなし」として拾う)。
let appQuitting = false
let fireTimer: ReturnType<typeof setTimeout> | null = null

// dev では ELECTRON_RENDERER_URL、prod では index.html を、ハッシュルートでロードする。
function loadRoute(win: BrowserWindow, hash: string): void {
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  const p = devUrl
    ? win.loadURL(`${devUrl}#${hash}`)
    : win.loadFile(join(__dirname, '../renderer/index.html'), { hash })
  p.catch((err) => console.error('[main] failed to load route', hash, err))
}

function openPromiseWindow(): void {
  if (promiseWindow && !promiseWindow.isDestroyed()) {
    promiseWindow.show()
    promiseWindow.focus()
    return
  }
  promiseWindow = new BrowserWindow({
    // useContentSize=true で width/height を「中身(レンダラ)の寸法」として扱う。
    // 外形指定だと Win の枠にカード幅が食われ縮むため(内寸で確定させる)。
    width: PROMISE_W,
    // 閉じた状態の高さ。時刻のドラムを開いたときだけ PROMISE_H_OPEN へ伸びる
    // (renderer が resizePromiseWindow で頼む)。それ以外の状態変化では伸縮しない。
    height: PROMISE_H_CLOSED,
    useContentSize: true,
    show: true,
    // 本番は固定窓。dev だけ伸縮可にして、下辺を掴んで決めた高さを実寸ログから読む
    // (height の数値を勘で当てないため)。ビルド版は IS_DEV=false で必ず固定に戻る。
    resizable: IS_DEV,
    // 帯のダブルクリックで最大化されないように(titleBarOverlay を使うと既定で可能になる)。
    maximizable: false,
    // OS のタイトルバーは隠し、上端の帯(Owaro)と最小化/閉じるボタンは renderer(AppHeader)が
    // 描く。Windows 標準の重ね描き(titleBarOverlay)は地の色と記号の色しか変えられず、
    // hover の見た目を変えられないため使わない(2026-09-12 本人決定)。
    titleBarStyle: 'hidden',
    backgroundColor: '#fbf8f2',
    // 表示名。記録の置き場所は名前に引きずられないよう app.setPath で固定している(上の userData)。
    title: 'Owaro',
    // 本番は exe に入ったアイコンが出るので実質デモ(Electron 本体で起動)向け。
    icon: appIcon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })
  promiseWindow.on('closed', () => {
    promiseWindow = null
  })
  if (IS_DEV) {
    // 既定メニューを外した副作用で F12/Ctrl+Shift+I のアクセラレータが無いため明示的に開く。
    // detach=別窓。内寸384pxの窓に docking させると計測したい寸法が変わってしまう。
    // 注: DevTools が開いていると Chromium が窓の伸縮のたびに右上へ「384px × 471px」の
    // 寸法表示を数秒出し、その左端がヘッダーの隙間から「3」に見える。dev/--demo 限定で
    // ビルド版(IS_DEV=false)には出ないため、そのままにする(2026-09-12 本人決定)。
    promiseWindow.webContents.openDevTools({ mode: 'detach' })
    promiseWindow.on('resize', () => {
      if (!promiseWindow || promiseWindow.isDestroyed()) return
      const [w, h] = promiseWindow.getContentSize()
      // useContentSize:true と同じ「内寸」。ここに出る数字をそのまま height に書ける。
      console.log(`[size] contentSize = ${w} x ${h}`)
    })
  }
  loadRoute(promiseWindow, '/promise')
}

// 画面カタログ(開発ビルド限定)。各画面を実寸で並べて見た目を確認するための窓。
let galleryWindow: BrowserWindow | null = null
function openGalleryWindow(): void {
  if (galleryWindow && !galleryWindow.isDestroyed()) {
    galleryWindow.show()
    galleryWindow.focus()
    return
  }
  galleryWindow = new BrowserWindow({
    width: 1280,
    height: 900,
    title: '画面カタログ',
    icon: appIcon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })
  galleryWindow.on('closed', () => {
    galleryWindow = null
    if (GALLERY_MODE) app.quit()
  })
  loadRoute(galleryWindow, '/gallery')
}

function clearFireTimer(): void {
  if (fireTimer) {
    clearTimeout(fireTimer)
    fireTimer = null
  }
}

// targetAt(ISO) に発火するよう予約。既存タイマーはクリア。
// 上限超え・大きな差は分割して再予約し、到来時に showOverlays() を呼ぶ。
function scheduleAt(targetAtISO: string): void {
  clearFireTimer()
  const tick = (): void => {
    const delay = new Date(targetAtISO).getTime() - Date.now()
    if (Number.isNaN(delay)) {
      console.error('[main] invalid targetAt, not scheduling:', targetAtISO)
      fireTimer = null
      return
    }
    if (delay <= 0) {
      fireTimer = null
      showOverlays()
      return
    }
    fireTimer = setTimeout(tick, Math.min(delay, MAX_TIMEOUT))
  }
  tick()
}

// 接続中の全ディスプレイそれぞれに、その bounds を覆う最前面オーバーレイ窓を出す。
// マルチモニタでの確実な被覆のため OS の fullscreen フラグに頼らず bounds で覆う(kiosk寄り)。
// query を渡すと見た目確認用のオーバーレイになる(記録にも約束にも触らない)。
function showOverlays(query?: string): void {
  if (overlayWindows.length > 0) return // 既に表示中
  // 本物のおわり画面か(画面カタログの確認用でないか)。
  const isReal = query === undefined
  if (isReal) {
    // 本物のおわり画面を出した時刻をメモに残す(B-18)。OK を押さずに終わったとき
    // 「見逃し」(画面が出ていない)と「OKなし」(出たが OK なし)を見分けるため。
    // 確認用(query 有り)では絶対に書かない。
    const state = readState()
    if (state) writeState({ ...state, firedAt: new Date().toISOString() })
  }
  const displays = screen.getAllDisplays()
  for (const display of displays) {
    const { x, y, width, height } = display.bounds
    const win = new BrowserWindow({
      x,
      y,
      width,
      height,
      frame: false,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      alwaysOnTop: true,
      backgroundColor: '#000000',
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false
      }
    })
    // タスクバーより上に出すため screen-saver レベルで最前面固定。
    win.setAlwaysOnTop(true, 'screen-saver')
    win.setBounds({ x, y, width, height })
    win.on('closed', () => {
      overlayWindows = overlayWindows.filter((w) => w !== win)
      if (isReal && !closedByApp.has(win) && !appQuitting && overlayWindows.length === 0) {
        abandonClosedOverlay()
      }
    })
    // Windows の終了・再起動・ログオフ。アプリの終了と同じく「本人が閉じた」とは扱わない。
    win.on('session-end', () => {
      appQuitting = true
    })
    loadRoute(win, query ? `/overlay?${query}` : '/overlay')
    overlayWindows.push(win)
  }
  // キーボードは主ディスプレイ側の窓に向ける(複数ディスプレイでは最後に作った窓が
  // フォーカスを持ち、確認用の Esc がどこにも届かないことがあったため)。
  overlayWindows[0]?.focus()
}

function closeAllOverlays(): void {
  for (const win of overlayWindows) {
    closedByApp.add(win)
    if (!win.isDestroyed()) win.destroy()
  }
  overlayWindows = []
}

// OK を押さずに終わった約束を missed.json へ移す(B-18)。records.json には入れない。
// 書けなくても例外を外へ出さない＝呼び出し側が必ずメモを消せるように(残ると次の起動で二重に入る)。
function saveMissed(state: PromiseState, reason: MissedReason, noticedAt: string): void {
  const startMs = new Date(state.startedAt).getTime()
  const date =
    reason === 'invalid' || Number.isNaN(startMs) ? localDate(noticedAt) : localDate(state.startedAt)
  try {
    appendMissed({
      date,
      startedAt: state.startedAt,
      targetAt: state.targetAt,
      resumes: state.resumes,
      nextFireAt: state.nextFireAt,
      ...(state.firedAt ? { firedAt: state.firedAt } : {}),
      noticedAt,
      reason
    })
  } catch (err) {
    console.error('[main] failed to write missed.json:', err)
  }
}

// アプリは生きたまま、本物のおわり画面が全部閉じられた(Alt+F4 など)。
// その場で「OKなし」として記録し、約束を終える(2026-09-24 本人決定)。
// 閉じた画面を出し直したり、閉じる操作を塞いだりはしない。
function abandonClosedOverlay(): void {
  const state = readState()
  if (state) {
    console.warn('[main] end screens were closed without OK; recording as no-ok')
    saveMissed(state, 'no-ok', new Date().toISOString())
  }
  clearState()
  clearFireTimer()
}

// ISO文字列からローカル日付 YYYY-MM-DD を作る(UTCではなくローカル)。
function localDate(iso: string): string {
  const d = new Date(iso)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// HH:MM から新しい約束 state を作る。受理できない止め時なら理由を返す。
//   startedAt = 今 / targetAt = 今日のHH:MM(過ぎていれば翌日、以後不変)
//   resumes = [] / nextFireAt = targetAt(初回はオーバーレイを targetAt に出す)
// 画面側でも同じ判定で先に警告を出すが、ここが最終防衛
// (選択から送信までの間に時刻が進んで境界を越える場合もあるため)。
function computePromise(hhmm: string): PromiseState | { reason: PromiseRejectReason } {
  const now = new Date()
  const verdict = evaluatePromise(hhmm, now)
  if (!verdict.ok) return { reason: verdict.reason }
  const targetAt = verdict.target.toISOString()
  return { startedAt: now.toISOString(), targetAt, resumes: [], nextFireAt: targetAt }
}

function registerIpc(): void {
  // 約束を立てる: state を保存し、タイマー予約し、入力窓を閉じる。
  // 予約中の変更(「時間をかえる」)も同じ経路。ただし
  //   ・立てて5分(GRACE_MS)を過ぎていれば拒否する(2026-08-30 裁定(d)。画面のボタン無効化は
  //     見た目で、ここが最終防衛)
  //   ・startedAt は最初に立てた時刻を引き継ぐ＝変えるたびに猶予が延びる抜け穴を塞ぎ、
  //     記録の武装時間(closedAt−startedAt)も「最初に立てた時」からになる。
  ipcMain.handle('setPromise', (_event, targetHHMM: string) => {
    const existing = readState()
    if (existing && Date.now() - new Date(existing.startedAt).getTime() > GRACE_MS) {
      console.warn('[main] setPromise rejected: grace over', existing.startedAt)
      return { ok: false as const, reason: 'grace-over' as const }
    }
    const result = computePromise(targetHHMM)
    if ('reason' in result) {
      console.warn('[main] setPromise rejected:', targetHHMM, result.reason)
      return { ok: false as const, reason: result.reason }
    }
    const state: PromiseState = existing
      ? { ...result, startedAt: existing.startedAt, resumes: existing.resumes }
      : result
    writeState(state)
    scheduleAt(state.nextFireAt)
    if (promiseWindow && !promiseWindow.isDestroyed()) {
      promiseWindow.close()
    }
    return { ok: true, startedAt: state.startedAt, targetAt: state.targetAt }
  })

  // 進行中の約束を返す(なければ null)。
  ipcMain.handle('getPending', () => {
    return readState()
  })

  // 約束の取り消し。予約(タイマー)と保留(state)の両方を落とす
  // ＝ファイルだけ消しても起動中の予約は生き残り、その時刻にオーバーレイが出てしまうため。
  // 記録は残さない。守れた/破ったのどちらでもない(立て間違いの取り消し)ものを
  // records に混ぜると band 判定の一次データが濁る。
  // 取り消し自体も記録しない(missed.json にも入れない)＝立て間違いの訂正であって逃げではない
  // (2026-08-16・09-04・09-24 本人確定)。
  ipcMain.handle('cancelPromise', () => {
    clearFireTimer()
    clearState()
    return { ok: true }
  })

  // 起動画面の伸縮(時刻のドラムの開閉)。送り元が起動画面の窓のときだけ効かせる。
  // setContentSize は resizable:false でも効く(resizable は利用者の操作を止めるだけ)。
  // main は言われた高さへ一回で変えるだけ。刻むかどうかは renderer が決める(描画のコマに合わせるため)。
  // 中身が動いている最中に刻む(16ms ごとに setContentSize)と、Windows が古い描画の切れ端(ドラムの
  // 数字)を窓の上端に数秒貼り残した(2026-09-12 本人報告・デモ実機)。renderer は中身が止まってから刻む。
  // 高さは CLOSED〜OPEN の外へ出さない。
  ipcMain.on('resizePromiseWindow', (event, height: unknown) => {
    if (typeof height !== 'number' || !Number.isFinite(height)) return
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || win !== promiseWindow || win.isDestroyed()) return
    const h = Math.min(PROMISE_H_OPEN, Math.max(PROMISE_H_CLOSED, Math.round(height)))
    win.setContentSize(PROMISE_W, h)
  })

  // 「このアプリについて」のリンク。開けるのは許可リストの https URL だけ(renderer から任意の URL や
  // file: を開かせない)。音源のクレジット先へ確実に飛べるようにする(2026-09-23 本人)。
  const EXTERNAL_LINKS = new Set([
    'https://peritune.com/blog/2025/03/03/hanadoki/',
    'https://creativecommons.org/licenses/by/4.0/'
  ])
  ipcMain.on('openExternal', (event, url: unknown) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || win !== promiseWindow || win.isDestroyed()) return
    if (typeof url !== 'string' || !EXTERNAL_LINKS.has(url)) return
    void shell.openExternal(url).catch(() => {})
  })

  // 帯の右端の自前ボタン(AppHeader)から。約束入力窓だけが対象(オーバーレイ窓には最小化/閉じるを置かない)。
  ipcMain.on('minimizeWindow', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || win !== promiseWindow || win.isDestroyed()) return
    win.minimize()
  })
  ipcMain.on('closeWindow', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || win !== promiseWindow || win.isDestroyed()) return
    win.close()
  })

  // ---- 画面カタログ用(開発ビルド限定) ----
  // 見た目確認のオーバーレイを出す。IS_DEV でしか動かさない＝本番に確認用の経路を残さない。
  ipcMain.on('previewOverlay', (_event, query: string) => {
    if (!IS_DEV) return
    showOverlays(String(query))
  })
  // 確認用オーバーレイの閉じ方。closeOverlay と違い state も records も触らない。
  ipcMain.handle('closePreviewOverlay', () => {
    if (!IS_DEV) return
    closeAllOverlays()
  })

  // 延長(再開): 選んだ分だけ再走し、同じオーバーレイをまた出す。
  // resumes に1件積み(=約束を破った痕跡)、nextFireAt を now+minutes に更新して再予約。
  // minutes は EXTEND_OPTIONS のいずれかのみ許可(不正は記録せず {ok:false})。
  ipcMain.handle('extendOverlay', (_event, minutes: number) => {
    if (!EXTEND_OPTIONS.includes(minutes)) {
      console.error('[main] extendOverlay received invalid minutes:', minutes)
      return { ok: false, nextFireAt: '' }
    }
    const state = readState()
    if (!state) {
      console.error('[main] extendOverlay called with no pending state; ignoring')
      return { ok: false, nextFireAt: '' }
    }
    // 延長は1回だけ(2026-09-04 本人確定)。画面はカードを出さないが、ここが最終防衛。
    if (state.resumes.length >= 1) {
      console.warn('[main] extendOverlay rejected: already extended once')
      return { ok: false, nextFireAt: '' }
    }
    const now = new Date()
    const nextFireAt = new Date(now.getTime() + minutes * 60_000).toISOString()
    // firedAt は消す＝延長後のおわり画面はまだ出ていない(このまま PC を切った夜は「見逃し」)。
    const { firedAt: _firedAt, ...rest } = state
    const updated: PromiseState = {
      ...rest,
      resumes: [...state.resumes, { at: now.toISOString(), minutes }],
      nextFireAt
    }
    writeState(updated)
    closeAllOverlays()
    scheduleAt(nextFireAt)
    return { ok: true, nextFireAt }
  })

  // 「いますぐ おわる」(予約から5分過ぎの起動画面から): 止め時を待たずに、その場で
  // おわりの儀式(30秒ロック＋記録)を出す。記録の経路は closeOverlay と同じ＝
  // コストゼロ・記録ゼロの逃げ道ではない(2026-09-12 本人決定・9/4 の案(a))。
  // 起動画面は先に閉じる。残すと OK 後に古い「予約中」表示が取り残されるため。
  ipcMain.handle('endNow', () => {
    const state = readState()
    if (!state) {
      console.error('[main] endNow called with no pending state; ignoring')
      return { ok: false }
    }
    if (promiseWindow && !promiseWindow.isDestroyed()) {
      promiseWindow.close()
    }
    clearFireTimer()
    showOverlays()
    return { ok: true }
  })

  // ---- 設定 ----
  ipcMain.handle('getSettings', () => readSettings())
  // renderer から来る値は信用せず型を見てから取り込む。保存と同時にOS側の登録も更新する。
  ipcMain.handle('setSettings', (_event, patch: unknown) => {
    const current = readSettings()
    const p = (patch && typeof patch === 'object' ? patch : {}) as Partial<Settings>
    const next: Settings = {
      openAtLogin: typeof p.openAtLogin === 'boolean' ? p.openAtLogin : current.openAtLogin,
      playEndMusic: typeof p.playEndMusic === 'boolean' ? p.playEndMusic : current.playEndMusic
    }
    writeSettings(next)
    applyLoginItem(next)
    return next
  })

  // ---- 記録の書き出し(B-16) ----
  // 形式の選択画面は持たない。OS の「名前を付けて保存」の「ファイルの種類」が形式の選択
  // (拡張子から決める)。records.json と missed.json は読むだけ(readRecords / readMissed)で一切書き換えない。
  ipcMain.handle('exportRecords', async (event) => {
    const parent = BrowserWindow.fromWebContents(event.sender)
    const defaultName = `owaro-records-${localDate(new Date().toISOString())}.csv`
    const options: Electron.SaveDialogOptions = {
      title: '記録を保存する',
      defaultPath: join(app.getPath('documents'), defaultName),
      filters: [
        { name: 'CSV', extensions: ['csv'] },
        { name: 'Markdown', extensions: ['md'] },
        { name: 'HTML', extensions: ['html'] }
      ],
      properties: ['showOverwriteConfirmation']
    }
    const result = parent
      ? await dialog.showSaveDialog(parent, options)
      : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) {
      return { ok: false as const, cancelled: true as const }
    }
    try {
      const format = formatFromExtension(extname(result.filePath))
      writeFileSync(result.filePath, buildExport(readRecords(), readMissed(), format), 'utf-8')
      return { ok: true as const, path: result.filePath }
    } catch (err) {
      console.error('[main] exportRecords failed:', err)
      return { ok: false as const, error: String(err) }
    }
  })

  // オーバーレイのOK(=最終/本当に終わり): closedAt を刻んで1件追記し、保留をクリアし、全オーバーレイを閉じる。
  // resumes をそのまま記録するので、後から「守れたか(length===0)/超過量」が復元できる。
  ipcMain.handle('closeOverlay', () => {
    const state = readState()
    if (state) {
      const closedAt = new Date().toISOString()
      appendRecord({
        date: localDate(state.startedAt),
        startedAt: state.startedAt,
        targetAt: state.targetAt,
        resumes: state.resumes,
        closedAt
      })
    } else {
      console.error('[main] closeOverlay called with no pending state; closing overlays only')
    }
    clearState()
    clearFireTimer()
    closeAllOverlays()
  })
}

function createTray(): void {
  // ico のまま渡すと、Windows が画面の拡大率に合う大きさ(100%なら16px)を選ぶ(Electron 公式の推奨)。
  let icon = nativeImage.createFromPath(appIcon)
  if (icon.isEmpty()) {
    console.error(`[main] tray icon could not be loaded from ${appIcon}; using the fallback square`)
    icon = nativeImage.createFromDataURL(TRAY_ICON_DATA_URL)
  }
  tray = new Tray(icon)
  tray.setToolTip('Owaro')
  const menu = Menu.buildFromTemplate([
    { label: 'Owaro を開く', click: () => openPromiseWindow() },
    // カタログは開発ビルドだけに出す(本番の常駐メニューに確認用の項目を置かない)。
    ...(IS_DEV
      ? [{ label: '画面カタログ（開発用）', click: () => openGalleryWindow() }]
      : []),
    { type: 'separator' as const },
    {
      // 約束の「おわり」ではなくアプリ自体の終了。混同されると常駐を落として
      // しまうので、ここだけは「おわり」語彙を使わず主語を明示する。
      label: 'アプリを終了',
      click: () => {
        app.quit()
      }
    }
  ])
  tray.setContextMenu(menu)
  tray.on('click', () => openPromiseWindow())
}

// ログイン時の自動起動をOSに登録/解除する。配布用exe(app.isPackaged)のときだけ実際に触る
// ＝開発ビルド(node_modules の electron.exe 直叩き)では登録が壊れる(2026-07-30 の発見)うえ、
// デモ起動の切り替えが本番の挙動を変えてしまうため。--hidden は渡さない(窓を出す)。
function applyLoginItem(s: Settings): void {
  if (!app.isPackaged) return
  // 注: インストーラが完了直後に自動起動した1回目だけは、この登録が書き換わらなかった
  // (2026-09-13 実測・原因未特定)。手で起動した回は必ず今の exe を指す。そのためインストーラの
  // 自動起動は切ってある(electron-builder.yml の runAfterFinish: false)。
  app.setLoginItemSettings({ openAtLogin: s.openAtLogin })
}

// 起動時の保留チェック: nextFireAt が未来→再予約(延長履歴ごと復帰) /
// 過去・読めない→ missed.json へ移してからクリア(B-18。OK を押さずに終わった回を黙って捨てない)。
//   firedAt 無し=その回のおわり画面が一度も出ていない(止め時にアプリが動いていなかった)→「見逃し」
//   firedAt 有り=おわり画面が出たまま、OK を押さずにアプリが終わった→「OKなし」
//   メモの中身が壊れている(開始時刻か止め時が無い・JSON として読めない)→「読めない記録」
//     (読めた範囲の値だけ残し、分からない項目は空欄。壊れたメモ自体も別名で残す。2026-09-24 本人決定)
// 記録に失敗してもクリアは必ずする(メモが残ると次の起動でまた同じ処理が走り、二重に入る)。
function resumePending(): void {
  const noticedAt = new Date().toISOString()
  const unreadable = readUnreadableState()
  if (unreadable) {
    console.error('[main] pending state is unreadable; recording as invalid')
    saveMissed(
      {
        startedAt: unreadable.startedAt ?? '',
        targetAt: unreadable.targetAt ?? '',
        resumes: unreadable.resumes ?? [],
        nextFireAt: unreadable.nextFireAt ?? '',
        ...(unreadable.firedAt ? { firedAt: unreadable.firedAt } : {})
      },
      'invalid',
      noticedAt
    )
    setAsideUnreadableState()
    return
  }
  const state = readState()
  if (!state) return
  const fireMs = new Date(state.nextFireAt).getTime()
  if (Number.isNaN(fireMs)) {
    console.error('[main] pending state has invalid nextFireAt; recording as invalid:', state.nextFireAt)
    saveMissed(state, 'invalid', noticedAt)
    clearState()
    return
  }
  if (fireMs > Date.now()) {
    scheduleAt(state.nextFireAt)
  } else {
    const reason: MissedReason = state.firedAt ? 'no-ok' : 'missed'
    console.warn(`[main] pending promise already past next fire; recording as ${reason}:`, state.nextFireAt)
    saveMissed(state, reason, noticedAt)
    clearState()
  }
}

if (gotLock) {
  // 2つ目の起動はトレイ常駐の本体に集約し、入力窓を前面に出す。
  app.on('second-instance', () => {
    openPromiseWindow()
  })

  app.whenReady().then(() => {
    // Electron 既定のメニューバー(File/Edit/View...)を外す。
    // 使わない英語メニューが載るだけでなく、その26pxぶん窓が実際より高くなり
    // BrowserWindow の height 指定と実寸が食い違う(=高さを数字で詰められなくなる)ため。
    Menu.setApplicationMenu(null)

    // ログイン時の自動起動は設定(settings.json・既定オフ)に従う。毎回呼ぶ＝以前の
    // 「常時ON・--hidden」登録を、新しいビルドの初回起動で必ず設定どおりに上書きするため。
    applyLoginItem(readSettings())

    registerIpc()
    if (GALLERY_MODE) {
      openGalleryWindow()
      return
    }
    createTray()
    resumePending()

    // 手動起動でもログイン時の自動起動でも、必ず起動画面を開く(2026-09-12 本人要望
    // 「PC起動時に画面が立ち上がる」)。かつての --hidden(トレイのみ)は廃止。
    openPromiseWindow()
  })

  // アプリの終了で閉じるおわり画面は「本人が閉じた」扱いにしない(次の起動時に拾う)。
  app.on('before-quit', () => {
    appQuitting = true
  })

  // トレイ常駐アプリ: 全ウィンドウを閉じても終了しない。終了はトレイメニューから。
  app.on('window-all-closed', () => {
    // 何もしない(トレイで待機)。
  })
}
