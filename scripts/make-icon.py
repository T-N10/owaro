# アイコンの元画像(1024px の PNG)から Windows 用の build/icon.ico を作る。
# アイコンを描き直したら、リポジトリ直下でこれを流すだけで作り直せる:
#   python scripts/make-icon.py
# 9サイズを1つの .ico に詰める。Windows が場面(トレイ16・タスクバー24・拡大率など)に合う大きさを選ぶ。
# サイズは Microsoft の最低線 16/24/32/48/256 に、拡大率ぶんの 20/40/64/96 を足したもの
# (docs/research-2026-09-13-app-icon.md §1-4)。小さいサイズも元画像からの自動縮小(2026-09-23 本人決定)。
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'design' / 'icon' / 'app_icon.png'
OUT = ROOT / 'build' / 'icon.ico'
SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 256]

src = Image.open(SRC).convert('RGBA')
OUT.parent.mkdir(exist_ok=True)
src.save(OUT, format='ICO', sizes=[(s, s) for s in SIZES])

packed = sorted(Image.open(OUT).info['sizes'])
print(f'{OUT.relative_to(ROOT)}: {[w for w, _ in packed]}')
if [w for w, _ in packed] != SIZES:
    raise SystemExit('icon.ico に入ったサイズが想定と違います')
