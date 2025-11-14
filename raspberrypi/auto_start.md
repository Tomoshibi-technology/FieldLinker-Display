# FieldLinker Display — 自動起動 (systemd) 設定

この文書は、以下のコマンドを Raspberry Pi 起動時に自動で実行するための手順を説明します：

```
uv run python3 -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

主に systemd サービスを用いた方法を解説します。環境に合わせて「`uv` のフルパス」や「仮想環境の Python」を指定してください。

## 概要（契約）
- 入力: Raspberry Pi 上の `~/FieldLinker-Display/raspberrypi` ディレクトリにあるアプリ
- 出力: 起動時に FastAPI (uvicorn) サービスが自動で起動し、`/ws/frame` 等のエンドポイントを提供
- エラー: 起動に失敗した場合は systemd ログ (journalctl) を参照し原因を特定

## 推奨パターン
1. 推奨（堅牢）: プロジェクトルートに「ラッパースクリプト」を置き、systemd からそのスクリプトを実行する。
   - 理由: 環境変数、パス、仮想環境の有効化を柔軟に扱えるため。
2. 代替: `ExecStart` に直接 `uv` のフルパスまたは仮想環境の Python を指定する。

---

## 手順 A — ラッパースクリプト + systemd (推奨)

1) ラッパースクリプトを作成（例: `run_server.sh`）

作業ディレクトリ: `~/FieldLinker-Display/raspberrypi`

```bash
# ファイル作成
cat > ~/FieldLinker-Display/raspberrypi/run_server.sh <<'EOF'
#!/bin/bash
# FieldLinker Display 起動スクリプト

cd /home/tomoshibi/FieldLinker-Display/raspberrypi || exit 1

# uv のフルパスを指定するか、仮想環境の python を使う
exec /home/tomoshibi/.local/bin/uv run python3 -m uvicorn app.main:app --host 0.0.0.0 --port 8000

EOF

# 実行権限を付与
chmod +x ~/FieldLinker-Display/raspberrypi/run_server.sh
```

注意: ユーザー名が異なる場合は `/home/tomoshibi` 部分を適宜置き換えてください。

2) systemd ユニットファイルを作成

```bash
sudo tee /etc/systemd/system/fieldlinker-display.service > /dev/null <<'EOF'
[Unit]
Description=FieldLinker Display (uvicorn)
After=network.target

[Service]
Type=simple
User=tomoshibi
Group=tomoshibi
WorkingDirectory=/home/tomoshibi/FieldLinker-Display/raspberrypi
# 必要に応じて PATH を調整（uv が ~/.local/bin にある場合など）
Environment=PATH=/home/tomoshibi/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin
# ラッパースクリプトを実行
ExecStart=/home/tomoshibi/FieldLinker-Display/raspberrypi/run_server.sh
Restart=on-failure
RestartSec=5
LimitNOFILE=4096

[Install]
WantedBy=multi-user.target
EOF
```

3) systemd に読み込ませ、有効化して起動

```bash
# systemd を再読み込み
sudo systemctl daemon-reload

# ブート時に有効化
sudo systemctl enable fieldlinker-display.service

# 今すぐ起動
sudo systemctl start fieldlinker-display.service

# ステータス確認
sudo systemctl status fieldlinker-display.service

# ログを追いかける
sudo journalctl -u fieldlinker-display.service -f
```
