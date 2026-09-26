import Gallery from './Gallery'
import Overlay from './Overlay'
import PromiseScreen from './PromiseScreen'

// 1つの index.html を main がハッシュ付きでロードする。
//   '/overlay' → 止め時オーバーレイ
//   '/gallery' → 画面カタログ(開発ビルド限定) / それ以外('/promise' 等) → 約束入力。
// ハッシュは窓を開く時に main が固定で付与し、実行中は変化しないため一度だけ読む。
// '?' 以降は見た目確認用の指定(例 '/overlay?lock=0&silent=1')。
const raw = window.location.hash.replace(/^#/, '')
const [path, query] = raw.split('?')
const params = new URLSearchParams(query ?? '')

export default function App() {
  if (path === '/overlay') {
    // パラメータが1つも無いときは本物の発火。preview を渡さない。
    const preview = query
      ? {
          lock: params.has('lock') ? Number(params.get('lock')) : undefined,
          pick: params.has('pick') ? Number(params.get('pick')) : null,
          silent: params.get('silent') === '1',
          extended: params.get('extended') === '1'
        }
      : undefined
    return <Overlay preview={preview} />
  }
  // 開発ビルドのみ。この条件はビルド時に false へ畳まれ、Gallery ごとバンドルから消える。
  if (import.meta.env.DEV && path === '/gallery') {
    return <Gallery />
  }
  return <PromiseScreen />
}
