# FieldLinker ディスプレイシステム構築

## 概要
FieldLinker-Display は、1200 個の NeoPixel（6ch × 200）で構成された円形ディスプレイを、Raspberry Pi と Tang Primer 25K (Gowin GW5A) で駆動するためのリファレンス実装です。  
Raspberry Pi 側で任意の 1200px RGB フレームを用意して SPI 経由で FPGA に送出し、FPGA 内の並列 NeoPixel ドライバが電気的タイミングを保証します。

## ディレクトリ構成
| パス | 内容 |
| --- | --- |
| `raspberrypi/` | SPI 送信用ユーティリティ (`spi-led.c`)、1200 点の座標データ (`neopixel_cordinates.h`) |
| `neopixel-engine/` | Tang Primer 25K 向け SPI→NeoPixel エンジン（SystemVerilog / Gowin プロジェクト / シミュレーション環境） |
| `neopixel-engine/sim/` | Icarus Verilog 用テストベンチと GTKWave 設定 |
| `neopixel-engine/gowin_neopixel-engine/` | Gowin EDA でそのまま開けるプロジェクト、制約ファイル (`.cst`, `.sdc`) |

## システム構成とデータフロー
1. **Raspberry Pi**  
   - `/dev/spidev4.0` を SPI Mode 3 / 10 MHz で使用。  
   - `spi-led.c` が 1200px × 3byte の RGB データ（ファイル入力または内蔵テストパターン）を用意。  
   - 各フレームを Start バイト `0x55 0x5B` → `1200×3` バイトの RGB → Stop バイト `0xAA` で送信。
2. **Tang Primer 25K**  
   - SPI Slave がフレームを 3,600 バイトのダブルバッファに格納。  
   - 6ch NeoPixel ドライバが同期スタートし、各 200px を 50 MHz から生成した WS2812 タイミングで出力。
3. **FieldLinker LED アレイ**  
   - `neopixel_cordinates.h` に保存された 0.01 mm 単位の XY 座標をもとに、任意エフェクトで利用。

## 必要なもの
- Raspberry Pi（SPI4 を引き出せるモデル。例: CM4 + Carrier、Pi 5 等） + 64bit Raspberry Pi OS
- Tang Primer 25K（GW5A-LV25）と 50 MHz 外部クロック
- 6 系統に分岐した NeoPixel（WS2812/WS2812C）× 1200
- SPI 配線（Pi → FPGA）: `SCLK`, `MOSI`, `CS`, `GND`
- ソフトウェア: `gcc`, `make`, `iverilog`, `gtkwave`, Gowin EDA (V1.9.9 以降推奨)

## Raspberry Pi 側アプリケーション
### ビルド
```bash
cd raspberrypi/src
gcc -O2 -Wall -Wextra -std=c11 spi-led.c -lm -o spi-led
```

#### フレーム生成ヘルパー
```bash
cd raspberrypi
python3 make_frame.py --pattern solid --color 0 0 32 --output frame.bin
```
- `pattern` は `solid` / `rainbow` / `edge` が選択可能。`solid` のみ `--color R G B` が必須です。
- 出力は `1200 * 3` バイトの RGB ファイルで、そのまま `spi-led` の `-f` へ渡せます。

### リモートテスト
Raspberry Pi をネットワーク越しにテストしたい場合は `raspberrypi/deploy.sh` を使うと、同期→ビルド→簡易フレーム送信まで一括で行えます。
```bash
cd raspberrypi
./deploy.sh                     # PI_HOST/PI_KEY/PI_DIR は必要に応じて環境変数で上書き
```
- `PI_DIR` 配下へ `rsync` でファイルを送り（デフォルト `/home/tomoshibi/fieldlinker-display`）、Pi 側の `src/` ディレクトリで `gcc -O2 -Wall -Wextra -std=c11 spi-led.c -lm -o spi-led` を実行。  
- `frame.bin` が無ければゼロフレームを自動生成し、`sudo ./spi-led -f frame.bin --loop` を実行。  
- SSH 鍵やホスト名を変える場合は `PI_HOST`, `PI_KEY`, `PI_DIR` を環境変数として指定してください。

### 実行前チェック
- `sudo raspi-config` → *Interface Options* → *SPI* を有効化（SPI4 を使う場合は dtoverlay 設定も忘れずに）。
- `/boot/firmware/config.txt` 例:
  ```
  dtoverlay=spi4-1cs,cs0_pin=8,mosi_pin=10,sclk_pin=9
  ```
- `/dev/spidev4.0` のアクセス権があることを確認。

### 起動
```bash
sudo ./spi-led [-f frame.bin] [--loop] [-d /dev/spidevX.Y]
```
- `-f frame.bin` : ちょうど `1200 * 3 = 3600` バイトの RGB (R,G,B) 生データを読み込んで送信。  
- オプション未指定時は `neopixel_cordinates.h` を使った簡易テストパターンを1フレーム送信。  
- `--loop` を付けると 3 ms 間隔（`DEFAULT_DELAY_US`）で同じバッファを送り続ける。  
- デバイス名/クロック速度は `-d` / `-s` で変更可能。  
サンプル: 全 LED を消灯するフレームを送信する場合
```bash
dd if=/dev/zero bs=3600 count=1 of=/tmp/blank.bin
sudo ./spi-led -f /tmp/blank.bin
```

## FPGA NeoPixel エンジン
### シミュレーション
```bash
cd neopixel-engine
make sim           # 1200px フルトップレベル動作検証 (tmp/wave.vcd)
make wave          # GTKWAVE が入っていれば自動で VCD を開く
make neopixel      # 単体 NeoPixel ドライバテスト (tmp/neopixel.vcd)
```
- `sim/tb_top.v` は SPI プロトコルを模倣し、初期 3px と 30px のテストパターンを送信します。

### Tang Primer 25K への書き込み
1. Gowin EDA で `neopixel-engine/gowin_neopixel-engine/gowin_spi-led.gprj` を開く。  
2. `impl/gwsynthesis` → `Run`、`impl/pnr` → `Run` で bitstream を生成。  
3. `impl/pnr/gowin_spi-led.fs` を JTAG または内蔵 Program Tool で書き込み。

### HDL のポイント
- `top.sv`  
  - 6 チャネル × 200 LED、各チャネル専用の `double_buffer` + `neopixel_driver`。  
  - SPI 受信はスタート `0x55 0x5B`／ストップ `0xAA` を状態機械で認識し、フレーム単位でダブルバッファをスワップ。  
- `double_buffer.sv`  
  - 書き込み側と読み出し側を完全分離し、フレーム境界で `i_swap` によるトグルを実施。  
- `neopixel.sv`  
  - 50 MHz クロックから WS2812 用 `T0H/T0L/T1H/T1L/RST` を定数化。  
  - `o_rd_addr` は `(LEDS*3 - r_byte_cnt - 1)` となるため、BRAM 側はリトルエンディアン配置に注意。

## SPI フレーム仕様
| 項目 | 値 |
| --- | --- |
| モード | SPI Mode 3 (CPOL=1, CPHA=1) |
| クロック | 10 MHz（`spi-led.c` の `speed` で変更可） |
| フレーム | `0x55 0x5B` → `LEDS_TOTAL * 3` バイト（R, G, B の順） → `0xAA` |
| LED 割り当て | チャネル 0〜5 に 200px ずつ。`INDEX = channel * 200 + local_index` |

## NeoPixel 座標データ
- `raspberrypi/neopixel_cordinates.h` に 1200 点すべての *ID / X / Y / 極座標* を 0.01 mm 精度で格納。  
- 変換マクロ:  
  - `COORD_TO_FLOAT(x)` → 実測 mm  
  - `theta_deg / ROTATION_SCALE` → deg  
- 自動生成ファイルのため、再配置したい場合は CAD/Excel などから同形式で再エクスポートしてください。

## トラブルシューティング
- **`/dev/spidev4.0` が存在しない**: `dtoverlay` 設定と再起動、もしくは `spi-led.c` の `dev` を既存デバイスに合わせて変更。  
- **LED が点滅/明るさが暴れる**: 5 V/GND のリファレンス共通化、FPGA 側 `o_neopixel_out` にシリーズ抵抗 (33 Ω) を追加。  
- **SPI CRC エラー的な挙動**: `send_led_data()` は単純なフレーミングのみなので、ノイズが多い場合は CS の配線長を見直すか速度を落としてください。  
- **シミュレーション波形が空**: `tmp/` ディレクトリが生成済みか確認し、`make clean` → `make sim` を実行。

## 今後の拡張アイデア
1. Raspberry Pi 側で他のエフェクト（FFT ビジュアライザ等）を実装し、`spi-led.c` に読み込ませるフレームバッファを生成する。  
2. SPI プロトコルを DMA 対応にし、フレーム同期割り込みを付けてソフト側で映像同期を取る。  
3. FPGA 側でガンマ補正やダブルバッファを 3 枚に拡張し、ギガビット Ethernet 等からの入力にも対応する。

ライセンスは未定です。利用ポリシーを決める場合はプロジェクトルートに `LICENSE` を追加してください。
