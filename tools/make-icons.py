# -*- coding: utf-8 -*-
"""ホーム画面に追加したときのアイコンを作る
   src/config.json  ->  src/icons/<slug>-180.png / -192.png / -512.png

   iPhone で「ホーム画面に追加」すると、今は白い四角か画面の写真になる。
   作品の色を地にして題名の一文字を白で置くと、3作を並べても見分けがつく。
   角は iOS が自動で丸めるので、こちらは四角のまま作る。

   作ったあと node tools/build.js を走らせると docs/<path>/ に入り、
   apple-touch-icon と manifest の icons も一緒に付く。
   作品を足したときだけ作り直せばよい。

   使い方:  python tools/make-icons.py
"""

import json
import os

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'src')
OUT = os.path.join(SRC, 'icons')

SIZES = (180, 192, 512)
MINCHO_BOLD = r'C:\Windows\Fonts\yumindb.ttf'


def icon(path, char, accent, size):
    img = Image.new('RGB', (size, size), accent)
    d = ImageDraw.Draw(img)

    # 字の大きさは一辺の 62%。小さく表示されても潰れない太さにする
    fnt = ImageFont.truetype(MINCHO_BOLD, int(size * 0.62))
    box = d.textbbox((0, 0), char, font=fnt)
    x = (size - (box[2] - box[0])) / 2 - box[0]
    y = (size - (box[3] - box[1])) / 2 - box[1]
    d.text((x, y), char, font=fnt, fill='#ffffff')

    img.save(path, 'PNG', optimize=True)


def title_of(slug):
    p = os.path.join(SRC, 'raw', slug + '.txt')
    if not os.path.exists(p):
        return slug
    with open(p, encoding='utf-8') as fh:
        for line in fh:
            t = line.strip()
            if t.startswith('# ') and not t.startswith('## '):
                return t[2:].strip()
    return slug


def build(slug, char, accent):
    for s in SIZES:
        icon(os.path.join(OUT, '%s-%d.png' % (slug, s)), char, accent, s)
    print('  %s  「%s」 → src/icons/%s-{180,192,512}.png' % (slug, char, slug))


def main():
    with open(os.path.join(SRC, 'config.json'), encoding='utf-8') as fh:
        cfg = json.load(fh)
    os.makedirs(OUT, exist_ok=True)

    for w in cfg.get('works', []):
        build(w['slug'], title_of(w['slug'])[0], w['accent'])

    for col in cfg.get('collections', []):
        build(col['slug'], '三', col['accent'])

    # 作品一覧（ルート）の分
    build('index', '文', '#3f7f8c')


if __name__ == '__main__':
    main()
