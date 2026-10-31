#!/usr/bin/env python3
"""楽曲→ライブの逆引き索引 data/song-live.json を生成する。

元データは歴代ライブのセットリスト（data/shows/*.json）。楽曲図鑑の楽曲詳細で
「この曲が披露されたライブ」を出すため、songs.js が遅延読み込みする。
daily ワークフローで再生成される。

照合は曲名の完全一致のみ（songs.json の曲名は全件ユニークであることを確認済み）。
1公演で同じ曲が複数回出てきても、その公演は1件として数える。

出力形式:
{
  "shows": {公演id: [日付, 公演名, 会場], ...},   # 表示リストで参照される公演だけ
  "songs": {曲名: {"n": 総公演数, "ids": [公演id, ...新しい順・最大 MAX_PER_SONG]}, ...}
}
"""
import glob
import json
import os

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
MAX_PER_SONG = 20


def main():
    data = os.path.join(ROOT, "data")
    with open(os.path.join(data, "songs.json"), encoding="utf-8") as f:
        song_titles = {s["title"] for s in json.load(f)}
    with open(os.path.join(data, "lives.json"), encoding="utf-8") as f:
        lives = {l["id"]: l for l in json.load(f)}

    per_song = {}  # title -> set(show id)
    skipped = 0
    for path in sorted(glob.glob(os.path.join(data, "shows", "*.json"))):
        with open(path, encoding="utf-8") as f:
            show = json.load(f)
        sid = show.get("id")
        if sid not in lives:
            skipped += 1
            continue
        seen = {e.get("title") for e in (show.get("setlist") or [])}
        for title in seen & song_titles:
            per_song.setdefault(title, set()).add(sid)

    songs_out = {}
    used_shows = {}
    for title, sids in per_song.items():
        ordered = sorted(sids,
                         key=lambda sid: (lives[sid].get("date") or "", sid),
                         reverse=True)
        top = ordered[:MAX_PER_SONG]
        songs_out[title] = {"n": len(ordered), "ids": top}
        for sid in top:
            l = lives[sid]
            used_shows[sid] = [l.get("date") or "", l.get("title") or "",
                               l.get("venue") or ""]

    out = {"shows": used_shows, "songs": songs_out}
    dest = os.path.join(data, "song-live.json")
    with open(dest, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print(f"song-live: {len(songs_out)} songs, {len(used_shows)} shows, "
          f"skipped {skipped} show files -> {dest}")


if __name__ == "__main__":
    main()
