# サカミチア（作り直し版 v1）

乃木坂46・櫻坂46・日向坂46（欅坂46・けやき坂46含む）の非公式ファンサイト。
まとめ・歴代ライブ・ブログ・楽曲・ミニゲームを横断検索できます。ビルド不要の静的サイトです。

## Cloudflare Pages へのデプロイ

### 方法A：Git連携
1. このフォルダを GitHub 等のリポジトリに push
2. Cloudflare Pages で「Connect to Git」→ リポジトリ選択
3. 設定：Framework preset = **None** / Build command = **（空欄）** / Build output directory = **/**（ルート）
4. Deploy

### 方法B：直接アップロード
1. このフォルダを zip 化（`sakamichi-biyori.zip` が同梱されている場合はそれを使用）
2. Cloudflare Pages →「Upload assets」で zip をアップロード

## 構成

```
index.html          トップ＋横断検索
live/               歴代ライブ（グループ・年・会場・曲名で検索、セトリ表示）
matome/             まとめ（番組・メンバー・タグで検索、要約＋公式リンク）
blog/               ブログアーカイブ（グループ・メンバー・期間で検索）
songs/              楽曲図鑑（表題曲・センター・年）
games/              ミニゲーム（センター当て／グループ当て／条件ドラフト）
setlist/            マイセットリスト（localStorage保存、曲名隠しクイズ表示）
data/               全データをJSONで管理（ページはfetchで読むだけ＝初回表示が軽い）
  lives.json / matome.json / blogs.json / songs.json / members.json
assets/css/style.css, assets/js/*.js
templates/          データ追加用テンプレート
```

## データの足し方
- 楽曲：`data/songs.json` に `{"title":"曲名","group":"乃木坂46","center":"名前","year":2026,"type":"表題曲"}`
- ライブ：`data/lives.json` に既存形式で追加。`setlist` 配列に曲順を入れると詳細ダイアログに出ます
- まとめ：`data/matome.json` に追加。要約は独自文で書き、`sourceUrl` に公式リンクを入れる
- ブログ：`data/blogs.json` に `{"date":"YYYY-MM-DD","group":"...","member":"...","title":"...","url":"公式URL","hasPhoto":true}`
  - CSVで管理したい場合は `templates/blogs-template.csv` に書いてからJSONへ変換
- メンバー：`data/members.json`（センター曲は songs.json から自動生成可能。生成は scripts 参照）

## 注意
- 非公式ファンサイトです。本文・写真の転載はせず、情報と要約＋公式リンクにとどめています
- v1のライブのセットリストは確認できたものだけ掲載し、未確認のものは空欄にしています（推測で埋めない方針）
