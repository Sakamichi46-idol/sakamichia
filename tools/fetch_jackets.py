#!/usr/bin/env python3
"""リリース（シングル／アルバム）ごとのジャケット画像を取得する。

楽曲個別ページ（tools/build_song_pages.py）が「初収録リリースのジャケ写」を
表示するための取得スクリプト。iTunes Search API（JP）のアートワークを
リリース日で照合して assets/jackets/ に自前ホストし、対応表を
data/jackets.json（キー "<リリースコード>|<発売日>"）に書く。
再実行しても取得済みはダウンロードし直さない（差分だけ取る）。
"""
import json
import os
import subprocess
import sys
import time
import urllib.parse

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
OUT_DIR = os.path.join(ROOT, "assets", "jackets")
ARTISTS = ["乃木坂46", "櫻坂46", "欅坂46", "けやき坂46", "日向坂46", "AKB48"]


def curl_json(url):
    out = subprocess.run(["curl", "-s", "--max-time", "40", url],
                         capture_output=True, text=True)
    return json.loads(out.stdout)


def main():
    with open(os.path.join(ROOT, "data", "songs.json"), encoding="utf-8") as f:
        songs = json.load(f)
    if isinstance(songs, dict):
        songs = songs["songs"]

    # リリース一覧: (code, date) -> {groups, title}
    # コードはグループをまたいで重複する（例 13thSG）ので発売日と組で一意にする
    releases = {}
    for s in songs:
        code = s.get("release") or ""
        if not code or not s.get("date"):
            continue
        key = (code, s["date"])
        r = releases.setdefault(key, {"groups": set(), "title": "", "ord": 999})
        r["groups"].add(s.get("group") or "")
        # 代表曲: 表題曲→アルバムリード曲→収録順の先頭
        rank = 0 if s.get("type") == "表題曲" else (1 if s.get("type") == "アルバムリード曲" else 2)
        score = (rank, s.get("ord") or 99)
        if score < (r.get("_score") or (9, 999)):
            r["_score"] = score
            r["title"] = s.get("title") or ""
    print(f"releases: {len(releases)}")

    # iTunes のコレクションを発売日で引けるようにする
    by_date = {}
    for artist in ARTISTS:
        q = urllib.parse.urlencode({
            "term": artist, "country": "JP", "entity": "album", "limit": 200,
            "attribute": "artistTerm",
        })
        try:
            d = curl_json(f"https://itunes.apple.com/search?{q}")
        except Exception as e:
            print(f"WARN search failed {artist}: {e}")
            continue
        n = 0
        for c in d.get("results", []):
            if c.get("artistName") != artist:
                continue
            date = (c.get("releaseDate") or "")[:10]
            if not date or not c.get("artworkUrl100"):
                continue
            by_date.setdefault(date, []).append(c)
            n += 1
        print(f"{artist}: {n} collections")
        time.sleep(0.4)

    def pref_artists(code, groups, date):
        """コードと年代から優先アーティストを返す。"""
        if code.startswith("N"):
            return ["乃木坂46"]
        if code.startswith("HK"):
            return ["けやき坂46", "日向坂46", "欅坂46"]
        if code.startswith("H"):
            return ["日向坂46"]
        if code.startswith("K"):
            # 欅坂46のシングル。けやき坂46の曲もここに載る
            return ["欅坂46", "けやき坂46"]
        if code.startswith("S"):
            return ["櫻坂46"] if (date or "") >= "2020-10-01" else ["欅坂46", "櫻坂46"]
        return ARTISTS

    os.makedirs(OUT_DIR, exist_ok=True)
    mapping = {}
    misses = []
    from datetime import date as _date, timedelta

    def near_dates(ds):
        try:
            d0 = _date.fromisoformat(ds)
        except Exception:
            return [ds]
        return [ds, (d0 - timedelta(days=1)).isoformat(), (d0 + timedelta(days=1)).isoformat()]

    for (code, date), r in sorted(releases.items()):
        cands = []
        for nd in near_dates(date):  # iTunes の releaseDate はTZで前後1日ずれることがある
            cands += by_date.get(nd, [])
        prefs = pref_artists(code, r["groups"], date)
        pick = None
        for pa in prefs:
            for c in cands:
                if c.get("artistName") == pa:
                    pick = c
                    break
            if pick:
                break
        if not pick and len(cands) == 1:
            pick = cands[0]
        if not pick and r["title"]:
            # フォールバック: 代表曲のタイトルで検索し、同アーティストで
            # コレクション名にタイトルを含むものを発売日45日以内から選ぶ
            try:
                q = urllib.parse.urlencode({
                    "term": r["title"], "country": "JP", "entity": "album", "limit": 20})
                d = curl_json(f"https://itunes.apple.com/search?{q}")
                base = _date.fromisoformat(date)
                best = None
                for c in d.get("results", []):
                    if c.get("artistName") not in prefs:
                        continue
                    if r["title"] not in (c.get("collectionName") or ""):
                        continue
                    try:
                        dd = _date.fromisoformat((c.get("releaseDate") or "")[:10])
                    except Exception:
                        continue
                    gap = abs((dd - base).days)
                    if gap <= 45 and (best is None or gap < best[0]):
                        best = (gap, c)
                if best:
                    pick = best[1]
            except Exception as e:
                print(f"WARN title search failed {code}: {e}")
            time.sleep(0.3)
        if not pick:
            misses.append((code, date, sorted(r["groups"]),
                           [c.get("collectionName") for c in cands]))
            continue
        fname = f"{code.lower()}-{date}.jpg"  # コードはグループ間で重複するため日付も入れる
        dest = os.path.join(OUT_DIR, fname)
        if not os.path.exists(dest) or os.path.getsize(dest) < 3000:
            url = pick["artworkUrl100"].replace("100x100bb.jpg", "600x600bb.jpg")
            res = subprocess.run(["curl", "-s", "--max-time", "40", "-o", dest, url])
            if res.returncode != 0 or not os.path.exists(dest) or os.path.getsize(dest) < 3000:
                misses.append((code, date, sorted(r["groups"]), ["DL失敗: " + str(pick.get("collectionName"))]))
                continue
            time.sleep(0.25)
        mapping[f"{code}|{date}"] = {
            "img": f"assets/jackets/{fname}",
            "name": pick.get("collectionName") or "",
            "artist": pick.get("artistName") or "",
        }

    with open(os.path.join(ROOT, "data", "jackets.json"), "w", encoding="utf-8") as f:
        json.dump(mapping, f, ensure_ascii=False, indent=1, sort_keys=True)
    print(f"matched: {len(mapping)} / {len(releases)}")
    for m in misses:
        print("MISS:", m)
    return 0 if not misses else 2


if __name__ == "__main__":
    sys.exit(main())
