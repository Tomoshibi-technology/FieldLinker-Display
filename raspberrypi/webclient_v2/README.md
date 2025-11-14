# FieldLinker WebClient v2

2 つの螺旋ディスプレイ (Display A/B) を同時に制御するためのシンプルなブラウザクライアントです。既存の `webclient/` と同じく、静的ファイルのみで構成されています。

## 特徴
- HTML/CSS/バニラ JS のみで構成 (依存ライブラリなし)
- Display A/B それぞれに別ホスト/ポートを設定可能
- `pixel_map.json` は共通で、2 つのプレビュー Canvas に同じ配置を描画
- 単色生成・ランダム生成・手動送信に対応し、送信操作は A/B 同期で実行
- 連続送信は 2 台のディスプレイを同時に行うモードのみ用意（frame_id を毎回+1）
- ログビューで 2 つの WebSocket の状態をまとめて確認

## セットアップ
```bash
cd raspberrypi/webclient_v2
python -m http.server 8080
# あるいは任意の静的サーバー
```

ブラウザで `http://127.0.0.1:8080` を開きます。

> `pixel_map.json` は暫定的に `../webclient/assets/pixel_map.json` を参照しています。同一ホストで `webclient` も配信されている前提です。独立配信したい場合は `webclient_v2/assets/` にコピーし、`PIXEL_MAP_URL` を変更してください。

## 使い方
1. Display A/B それぞれの Host/IP と Port を入力 (例: `4b-01.local` と `4b-02.local`)。
2. `接続` ボタンで WebSocket を確立。ステータスが「接続中」に変われば成功。自動送信は 2 台とも接続した時のみ有効です。
3. 「フレーム生成」で単色またはランダムを選択し、共通の「両方へ 1 回送信」ボタンで同じ frame_id を送出します（送信後に+1され、次回も同期したIDになります）。
4. `frame_id` 入力欄は 2 台で共有され、1回送信・自動送信とも送信が成功したタイミングで +1 されます。
5. ログ欄で ACK/エラーを確認し、必要なら `ログをクリア` で消去。

## TODO / 今後の拡張
- ブラシ描画やリング/ストライプなど追加パターン
- Display A/B 跨ぎでコピー/同期するユーティリティ
- 設定の localStorage 保存
- `pixel_map.json` の独立配信 (assets 同梱)
