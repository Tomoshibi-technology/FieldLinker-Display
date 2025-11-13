#!/usr/bin/env bash
set -euo pipefail # e: 一時停止 u: 未定義変数 t: パイプ失敗時もエラー扱い o: 直前コマンドの終了コードを返す

PI_HOST="${PI_HOST:-tomoshibi@4b-01.local}"
PI_KEY="${PI_KEY:-$HOME/.ssh/tomoshibi/4b-01-jumpei}"
PI_DIR="${PI_DIR:-/home/tomoshibi/fieldlinker-display}"

SCRIPT_DIR="$(cd -- "$(dirname "$0")" && pwd)"

# リモートディレクトリを準備
ssh -i "$PI_KEY" "$PI_HOST" "mkdir -p '$PI_DIR'"

# avz: アーカイブ、冗長、圧縮 -e: リモートシェル指定
rsync -avz -e "ssh -i $PI_KEY" "$SCRIPT_DIR/" "$PI_HOST:$PI_DIR/"

ssh -i "$PI_KEY" "$PI_HOST" "set -euo pipefail; cd '$PI_DIR/src'; gcc -O2 -Wall -Wextra -std=c11 spi-led.c -lm -o spi-led; if [ ! -f frame.bin ]; then dd if=/dev/zero bs=3600 count=1 of=frame.bin; fi; sudo ./spi-led -f frame.bin --loop"

# set -e

# PI_HOST="pi@raspberrypi.local"
# PI_KEY="~/.ssh/pi_key"
# PI_DIR="~/project"

# echo "==> Syncing files..."
# rsync -avz --delete -e "ssh -i $PI_KEY" ./src/ $PI_HOST:$PI_DIR/

# echo "==> Building & running on Raspberry Pi..."
# ssh -i $PI_KEY $PI_HOST "
#   cd $PI_DIR &&
#   cmake -S . -B build &&
#   cmake --build build -j &&
#   ./build/my_app
# "