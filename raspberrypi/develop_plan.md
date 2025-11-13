# Raspberry Pi 側実装計画 (WebSocket 経由で 3,600 バイト送信)

## 1. ゴール
- Web ブラウザや外部サービスから WebSocket で送られてくる JSON（Base64 文字列として 3,600 バイトの RGB フレームを埋め込む）を受信し、FPGA へ SPI ( `/dev/spidev4.0`, mode3, 10 MHz ) で転送できる常駐アプリを Raspberry Pi 上に実装する。
- 遅延を最小限に抑えつつ、エラー時のリカバリと運用時の状態可視化ができる構成にする。

## 2. 技術スタック候補
| レイヤー | 選定理由 |
| --- | --- |
| 言語/ランタイム | Python 3.11 (標準ライブラリが豊富、`spidev` バインディングが成熟、asyncio で WebSocket/キュー/ワーカー制御がしやすい) |
| WebSocket サーバー | FastAPI + `uvicorn[standard]` を採用。OpenAPI が自動で生成され、将来 REST API を追加したい場合も楽に共存させられる。 |
| SPI 制御 | `spidev` モジュール。mode3/10 MHz/8bit word 設定が容易。 |
| ロギング | Python `logging` + systemd journal。必要に応じて Prometheus exporter を後付け予定。 |

## 3. アーキテクチャ概要
1. **WebSocket エンドポイント**  
   - URL 例: `ws://<pi-host>:8080/ws/frame`  
   - クライアントは JSON を送信（例: `{"frame_id":123,"data":"<base64>","meta":{"gamma":1.8}}`）。`data` は Base64 文字列で 3,600 バイト分をエンコードする。  
   - LAN 内運用を前提にハートビートは省略し、切断は WebSocket のコネクションイベントで検知する。

2. **バリデーション & ACK**  
   - `data` を Base64 デコードし、長さ 3,600 バイトであることを確認。異常時は WebSocket のエラーコード + JSON で通知。  
   - 正常時は `{ "status": "ok", "frame_id": <n> }` を返し、クライアント側の再送制御に利用。

3. **フレームキュー**  
   - `asyncio.Queue`(初期値は長さ 2〜3) で WebSocket 受信スレッドと SPI 送信ワーカーをデカップル。  
   - バックプレッシャー: 満杯になったら最古のフレームを破棄し、常に最新フレームを優先する（キュー長は設定値として外出し予定）。

4. **SPI 送信ワーカー**  
   - 専用スレッド/タスクがキューから取り出したバッファにヘッダ `0x55 0x5B` とフッタ `0xAA` を付けて `spidev.xfer2()` で一括送信。  
   - エラー捕捉時は SPI デバイスを閉じてリトライ。リトライ失敗は WebSocket 側へ `error` イベントをブロードキャスト。

5. **状態監視**  
   - 現在の接続数、最新 `frame_id`, 転送 FPS, 直近エラーをメトリクスとして保持。 `/healthz` (HTTP GET) で単純な死活監視も実装。

## 4. 実装タスク
1. **環境準備**  
   - `raspi-config` で SPI 有効化、`apt` で Python 3.11 を導入。  
   - [Astral `uv`](https://github.com/astral-sh/uv) をインストール (`curl -Ls https://astral.sh/uv/install.sh | sh` など)。  
   - `uv pip install fastapi uvicorn[standard] websockets spidev` 等で依存を管理し、`uv.lock` をバージョン管理する。  
   - 実行時は `uv run python3 app/main.py` のように `uv run` 越しで Python を呼び出し、専用 venv を作らずにプロジェクト単位で隔離された環境を利用する。

2. **プロジェクトひな形作成**  
   - `raspberrypi/app/` 配下に Python パッケージを作成し、`main.py`, `spi.py`, `ws.py`, `config.py` などモジュールを分離。  
   - `pyproject.toml` を追加。

3. **SPI ラッパ実装 (`spi.py`)**  
   - 初期化 (`SpiDev().open(bus=4, device=0)`) とパラメータ設定。  
   - `send_frame(bytes payload)` でヘッダ/フッタ付与、長さチェック、例外処理を実装。  

4. **WebSocket ハンドラ (`ws.py`)**  
   - 接続時にコンテキスト (client_id, last_frame_id) を保持。  
   - JSON 受信 → スキーマ検証 → `data` を Base64 デコード → フレームキューへ投入。  
   - キュー満杯時の扱い（最新優先 or ブロック）を設定で切り替え可能にする。

5. **キュー & ワーカー (`worker.py`)**  
   - `asyncio.create_task` で送信ワーカー開始。  
   - キューからの取り出しで `asyncio.Queue.get()` を使用し、`CancelledError` 処理も実装。

6. **最小限ロギング**  
   - Python 標準の `logging` を INFO/ERROR レベルで使用し、接続・フレーム受信・SPI 失敗など主要イベントのみ記録。

## 5. リスクと対策
- **高頻度フレーム時の遅延**: キュー長とバックプレッシャー方針を調整し、必要に応じて一定 FPS で送信 (スロットリング)。
- **SPI 転送失敗**: リトライとアラート（ログ出力 + WebSocket broadcast）。`spidev` を periodic self-test するヘルスチェックを入れる。

## 6. 次のアクション
1. `uv pip install ...` で依存ライブラリを導入し、`uv run python3` で動作確認。
2. SPI ラッパのスタブと WebSocket サーバーの骨格を作成。
3. WebSocket 経由で受信したフレームを実際に SPI 経路へ流し、FPGA/パネルまでの動作を確認。
