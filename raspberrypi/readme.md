# FieldLinker Display Raspberry Pi 実装手順

WebSocket で受信した RGB フレーム（3,600 B）を Raspberry Pi から SPI (`/dev/spidev4.0`, mode3, 10 MHz) で FPGA へ送信するサービスです。ここでは scp を使って Pi に展開し、起動するまでの手順をまとめます。

## 0. Raspberry Pi 側の準備
1. `raspi-config` → *Interface Options* → **SPI** を Enable。
2. `/boot/config.txt` に以下を追記し再起動。
   ```
   dtoverlay=spi0-1cs
   dtoverlay=spi4-1cs
   ```
3. 再起動後に `ls /dev/spidev*` で `/dev/spidev4.0` が見えることを確認。

## 1. 開発マシンでリポジトリ取得
```bash
git clone https://github.com/<your-account>/FieldLinker-Display.git
cd FieldLinker-Display/raspberrypi
```

ローカルで動作確認したい場合は（`spidev` は不要）:
```bash
uv pip install fastapi 'uvicorn[standard]' websockets
uv run python3 -m uvicorn app.main:app --reload
curl http://127.0.0.1:8000/healthz
```

## 2. scp で Raspberry Pi にコピー
```bash
scp -r FieldLinker-Display pi@<raspi-ip>:~
```
> `<raspi-ip>` は Pi の IP アドレス。ユーザー名が `pi` 以外なら適宜読み替えてください。

## 3. Raspberry Pi 上で依存インストール
```bash
ssh pi@<raspi-ip>
cd ~/FieldLinker-Display/raspberrypi
curl -Ls https://astral.sh/uv/install.sh | sh   # uv 未導入なら
uv pip install .[raspi] fastapi 'uvicorn[standard]' websockets
```
`.[raspi]` には Raspberry Pi 専用の `spidev` 依存が含まれます。

## 4. サービス起動
```bash
uv run python3 -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

## 5. 動作確認
```bash
printf '{"frame_id":1,"data":"BASE64DATA"}\n' | websocat ws://4b-01.local:8000/ws/frame
```
実際にデータを入れたバージョン
```
printf '{"frame_id":1,"data":"'"$(head -c 3600 /dev/urandom | base64)"'"}\n' | websocat ws://<raspi-ip>:8000/ws/frame
```



- ヘルスチェック: `curl http://<raspi-ip>:8000/healthz`
- WebSocket: `ws://<raspi-ip>:8000/ws/frame` に `{"frame_id":1,"data":"<3600BをBase64>"}` を送信すると、キュー経由で SPI に流れます。ACK (`{"status":"ok","frame_id":1}`) が返れば成功です。


## 5. テスト用 Web クライアント
`webclient/` 配下にブラウザから実行できる簡易ツールを用意しています。

### 使い方
```bash
cd raspberrypi/webclient
python -m http.server 8080
```
ブラウザで `http://127.0.0.1:8080` を開き、WebSocket URL に `ws://<raspi-ip>:8000/ws/frame` を入力して接続すると、ランダムまたは単色フレームを簡単に送信できます。自動送信機能を使えば連続フレーム送信も確認できます。
必要に応じて systemd サービス化や TLS 終端は別途設定してください。
