#!/usr/bin/env python3
"""一時的な診断: GitHub Actions の egress から乃木坂46公式スケジュールページの
HTML構造（class名と抜粋）を取得して probe-output/ に書き戻す。
パーサーが書けたらこのファイルとワークフローは削除する。"""
import re
import subprocess
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "probe-output"
UA = "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36"


def fetch(url: str) -> tuple[int, str]:
    r = subprocess.run(["curl", "-sL", "--max-time", "40", "-A", UA,
                        "-w", "\n%{http_code}", url],
                       capture_output=True, text=True)
    body, _, code = r.stdout.rpartition("\n")
    return (int(code) if code.isdigit() else 0), body


def main() -> None:
    OUT.mkdir(exist_ok=True)
    ym = date.today().strftime("%Y%m")
    lines = []
    code, body = fetch(f"https://www.nogizaka46.com/s/n46/media/list?dy={ym}")
    lines.append(f"media/list?dy={ym}: HTTP {code}, {len(body)} bytes")
    classes = sorted(set(re.findall(r'class="([^"]+)"', body)))
    lines.append(f"unique classes: {len(classes)}")
    lines.extend(f"  {c}" for c in classes)
    m = re.search(r"\d{1,2}:\d{2}", body)
    if m:
        i = max(0, m.start() - 2200)
        lines.append("\n--- excerpt around first time ---")
        lines.append(body[i:m.start() + 1200])
    code2, body2 = fetch(
        f"https://www.nogizaka46.com/s/n46/api/list/news_v2?dy={date.today().strftime('%Y%m%d')}")
    lines.append(f"\nnews_v2 API sanity: HTTP {code2}, {len(body2)} bytes")
    (OUT / "nogizaka-media-structure.txt").write_text("\n".join(lines), encoding="utf-8")
    print(lines[0])


if __name__ == "__main__":
    main()
