# Raspberry Pi Side Tools

FieldLinker-Display の Raspberry Pi 向けユーティリティ群（`spi-led.c` / `deploy.sh`）の使い方をまとめました。  
LED へ **1200 × 3 バイト** の RGB フレームを送る最小構成になっています。

## 必要ファイル

| ファイル | 内容 |
| --- | --- |
| `spi-led.c` | SPI 経由で FPGA へ 1 フレームを送信する C プログラム。`-f` で外部フレームを指定可能。 |
| `deploy.sh` | SSH 経由で Raspberry Pi に同期 → ビルド（gcc）→ テストフレーム送信まで実行。 |
| `neopixel_cordinates.h` | 1200 個の XY 座標テーブル。`spi-led.c` のテストパターン生成に使用。 |
| （任意）`frame.bin` | 任意の 3,600 バイト RGB フレーム。指定しない場合はプログラムが簡易パターンを生成。 |

## ビルド

Raspberry Pi 上、または Linux クロスコンパイラで以下を実行してください。

```bash
cd raspberrypi/src
gcc -O2 -Wall -Wextra -std=c11 spi-led.c -lm -o spi-led
```

- `CC`, `CFLAGS`, `LDFLAGS` 環境変数でクロスコンパイル用ツールチェーンを指定できます（例: `CC=aarch64-linux-gnu-gcc`）。

## フレーム生成ツール

`make_frame.py` でテスト用の `frame.bin` を作成できます。

```bash
cd raspberrypi
python3 make_frame.py --pattern solid --color 0 0 32 --output frame.bin
```

- `pattern` は `solid` / `rainbow` / `edge` の 3 種類。`solid` を選んだ場合のみ `--color R G B` (0-255) が必要です。
- 生成されるファイルは `1200 * 3 = 3600` バイトの RAW RGB データで、そのまま `spi-led -f` に渡せます。

## 使い方

```bash
sudo ./spi-led [-f frame.bin] [--loop] [-d /dev/spidevX.Y] [-s 10000000]
```

- `-f frame.bin` : 3,600 バイト (1200 LED × RGB) の生データファイルを送信。ファイル不足時はエラー。
- オプション未指定時は `neopixel_cordinates.h` を利用した簡易テストパターンを 1 フレーム送信。
- `--loop` : 同じバッファを `DEFAULT_DELAY_US` (3ms) 間隔で繰り返し送信。
- `-d` / `-s` : SPI デバイスとクロックを変更。デフォルトは `/dev/spidev4.0`, 10 MHz。
- `--help` : オプション一覧を表示。

### テストフレームの例

全 LED を消灯したい場合:

```bash
dd if=/dev/zero bs=3600 count=1 of=/tmp/blank.bin
sudo ./spi-led -f /tmp/blank.bin
```

## リモートデプロイ & テスト

Raspberry Pi 上での動作確認をリモートで行う場合は `deploy.sh` を使用します。

```bash
cd raspberrypi
./deploy.sh
```

- `PI_HOST`, `PI_KEY`, `PI_DIR` を環境変数で上書き可能（デフォルトは `/home/tomoshibi/fieldlinker-display`）。例: `PI_HOST=raspi.local PI_DIR=/home/pi/fieldlinker ./deploy.sh`
- スクリプトは `rsync` でこのフォルダー一式を Pi へコピー後、Pi 側の `src/` で `gcc -O2 -Wall -Wextra -std=c11 spi-led.c -lm -o spi-led` を実行します。
- `frame.bin` が存在しなければ `dd` でゼロフレームを生成し、`sudo ./spi-led -f frame.bin --loop` を実行します。
- `sudo` にはパスワード無し実行権限が必要です。難しい場合は `deploy.sh` 内の `sudo` を外してください。

## ハードウェア依存ポイント（`spi-led.c`）

現在の `spi-led.c` は固定 3,600 バイトのフレームを 1 回だけ送信するミニマル実装ですが、以下のハードウェア条件に強く依存しています。

- **デバイスノード**: `DEFAULT_DEVICE` は `/dev/spidev4.0` に固定 (`raspberrypi/src/spi-led.c:13-15`)。CM4 や Pi 5 で SPI4 を有効化する `dtoverlay=spi4-1cs` などの設定が必須で、別デバイスを使う場合はソースを再ビルドする必要があります。
- **SPI モード/クロック**: `configure_spi()` で Mode 3 / 10 MHz を書き込んでおり (`raspberrypi/src/spi-led.c:17-29`)、想定している FPGA 側ロジックも同じ条件で動作する前提です。ハード側で許容されない場合はコードを修正してください。
- **フレーム構造**: `send_frame()` が `0x55 0x5B`（ヘッダ）→3600 バイト→`0xAA` の順で送信します (`raspberrypi/src/spi-led.c:32-45`)。FPGA もこのフレーミングをトリガーにしているため、並びを変えると受信できません。
- **データサイズ**: `FRAME_BYTES` が 3600 にハードコードされており (`raspberrypi/src/spi-led.c:13`)、LED 数やチャネル構成が変わる場合はソースを合わせて変更する必要があります。
- **ペイロード初期値**: `main()` は `memset(frame, 3, sizeof(frame));` で値 3 を全 LED に書き込みます (`raspberrypi/src/spi-led.c:48-64`)。周辺ハードが 0 以外のデータで正しく点灯することを確認した上で調整してください。

上記以外にも、`open(DEFAULT_DEVICE, O_WRONLY)` を `sudo` なしで通すには `/dev/spidev4.0` のアクセス権を変更する必要があります。環境ごとに udev ルールを用意するなどして対応してください。
