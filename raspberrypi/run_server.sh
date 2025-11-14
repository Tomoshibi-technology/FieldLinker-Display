#!/bin/bash
# FieldLinker Display 起動スクリプト

cd /home/tomoshibi/FieldLinker-Display/raspberrypi || exit 1

# uv のフルパスを指定するか、仮想環境の python を使う
exec /home/tomoshibi/.local/bin/uv run python3 -m uvicorn app.main:app --host 0.0.0.0 --port 8000

