import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
// フォントの @font-face は index.css が直接持つ(パッケージ既定のCSSは読まない)。
// 理由=①同梱を必要な太さ(Plex JP 500 / Lexend 200・300・400) × woff2 のみに絞るため
//      ②パッケージの japanese-*.css と latin-*.css は両方とも unicode-range を持たず、
//        素直に併読すると後勝ちで日本語側が無効化される(latin だけが残り和文が消える)。
import './index.css'

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
