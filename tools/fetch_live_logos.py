#!/usr/bin/env python3
"""旧サイト『坂道日和』の公演ロゴ登録（/api/live-logos）を取り込む。

セトリ画像のヘッダーに実物の公演ロゴを使うための同期ツール。
旧サイトのレジストリ（R2登録分）を読み、ロゴ画像を assets/live-logos/ に
保存し、画像生成モジュール（setlist-image-export.js の resolveLogo）が
読める形式の assets/live-logos.json を書き出す。

- 公演IDは旧サイト形式（時刻が "18:30"）→ サカミチア形式（"1830"）に正規化する
- 画像はマジックバイトで検証し、壊れた応答は保存しない
- 既存マニフェストの tours（ツアー共通ロゴ）は保持する
- 変更があるときだけファイルを書き換える
"""
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OLD_BASE = 'https://sakamichi-biyori.pages.dev'
LOGO_DIR = ROOT / 'assets' / 'live-logos'
MANIFEST = ROOT / 'assets' / 'live-logos.json'


def fetch(url, binary=False):
    r = subprocess.run(['curl', '-sL', '--max-time', '30', url],
                       capture_output=True)
    if r.returncode != 0 or not r.stdout:
        return None
    return r.stdout if binary else r.stdout.decode('utf-8', 'replace')


def ext_of(data, url):
    if data[:8] == b'\x89PNG\r\n\x1a\n':
        return '.png'
    if data[:3] == b'\xff\xd8\xff':
        return '.jpg'
    if data[:4] == b'RIFF' and data[8:12] == b'WEBP':
        return '.webp'
    if data[:6] in (b'GIF87a', b'GIF89a'):
        return '.gif'
    return None


def main():
    raw = fetch(OLD_BASE + '/api/live-logos')
    if not raw:
        print('live-logos: registry fetch failed', file=sys.stderr)
        return 1
    try:
        reg = json.loads(raw)
    except Exception as e:
        print(f'live-logos: registry parse failed: {e}', file=sys.stderr)
        return 1
    shows_in = reg.get('shows') or {}
    LOGO_DIR.mkdir(parents=True, exist_ok=True)

    prev = {}
    if MANIFEST.exists():
        try:
            prev = json.loads(MANIFEST.read_text(encoding='utf-8'))
        except Exception:
            prev = {}
    shows_out = {}
    added = updated = kept = 0
    for old_id, ent in sorted(shows_in.items()):
        if not isinstance(ent, dict) or not ent.get('url'):
            continue
        nid = old_id.replace(':', '')
        data = fetch(OLD_BASE + ent['url'], binary=True)
        if not data:
            print(f'live-logos: download failed for {old_id}')
            continue
        ext = ext_of(data, ent['url'])
        if not ext:
            print(f'live-logos: not an image for {old_id}')
            continue
        dest = LOGO_DIR / (nid + ext)
        if dest.exists() and dest.read_bytes() == data:
            kept += 1
        else:
            # 拡張子が変わった旧ファイルがあれば消す
            for old in LOGO_DIR.glob(nid + '.*'):
                if old != dest:
                    old.unlink()
            dest.write_bytes(data)
            if nid in (prev.get('shows') or {}):
                updated += 1
            else:
                added += 1
        shows_out[nid] = {'group': ent.get('group', ''),
                          'url': '/assets/live-logos/' + nid + ext,
                          'source': ent.get('source', '')}
    manifest = {'version': 1, 'shows': shows_out,
                'tours': prev.get('tours') or []}
    text = json.dumps(manifest, ensure_ascii=False, indent=1) + '\n'
    changed = True
    if MANIFEST.exists() and MANIFEST.read_text(encoding='utf-8') == text:
        changed = False
    if changed:
        MANIFEST.write_text(text, encoding='utf-8')
    print(f'live-logos: total={len(shows_out)} added={added} updated={updated} '
          f'unchanged={kept} manifest_changed={changed}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
