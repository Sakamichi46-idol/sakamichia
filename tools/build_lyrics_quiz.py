# -*- coding: utf-8 -*-
"""歌詞クイズ（漢字だけクイズ）の出題データを生成する。

入力: ~/workspace/sakamichia-import/lyrics-source.json
  [{"title": "...", "group": "...", "lyrics": "歌詞全文"}, ...]
  ※歌詞の原文ファイルはリポジトリには入れない（このスクリプトの入力専用）。
出力: data/lyrics-quiz.json
  [{"title": "...", "group": "...", "year": 0, "kanji": "歌詞に出てくる漢字だけを順番に並べた文字列"}]
楽曲図鑑（data/songs.json）に同名の曲があれば group/year をそちらに合わせる。
使い方: python3 tools/build_lyrics_quiz.py
"""
import json, os, re, sys

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.expanduser('~/workspace/sakamichia-import/lyrics-source.json')
KANJI = re.compile(r'[一-龯㐀-䶿々〆]')


def main():
    if not os.path.exists(SRC):
        print(f'入力がありません: {SRC}')
        return 1
    src = json.load(open(SRC, encoding='utf-8'))
    songs = json.load(open(os.path.join(BASE, 'data/songs.json'), encoding='utf-8'))
    by_title = {}
    for s in songs:
        by_title.setdefault(s['title'], s)
    out = []
    for e in src:
        kanji = ''.join(KANJI.findall(e.get('lyrics') or ''))
        if not kanji:
            print(f"skip (漢字なし): {e.get('title')}")
            continue
        cat = by_title.get(e['title'])
        out.append({'title': e['title'],
                    'group': (cat or {}).get('group') or e.get('group') or '',
                    'year': (cat or {}).get('year') or 0,
                    'kanji': kanji})
    path = os.path.join(BASE, 'data/lyrics-quiz.json')
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
    print(f'wrote {path}: {len(out)}曲')
    for o in out:
        print(f"  {o['title']} ({o['group']}) 漢字{len(o['kanji'])}文字")
    return 0


if __name__ == '__main__':
    sys.exit(main())
