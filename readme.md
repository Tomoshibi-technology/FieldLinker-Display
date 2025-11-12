# FieldLinker ディスプレイシステム構築

## 概要
FieldLinker-Display は、1200 個の NeoPixel（6ch × 200）で構成された円形ディスプレイを、Raspberry Pi と Tang Primer 25K (Gowin GW5A) で駆動するためのリファレンス実装です。  
Raspberry Pi 側で物理シミュレーションベースのアニメーションを生成し、SPI 経由で FPGA に送出、FPGA 内の並列 NeoPixel ドライバが電気的タイミングを保証します。

## ディレクトリ構成
| パス | 内容 |
| --- | --- |
| `raspberrypi/` | フレーム生成アプリ (`spi-led.c`)、物理シミュレーション (`ball_physics.*`)、1200 点の座標データ (`neopixel_cordinates.h`) |
| `neopixel-engine/` | Tang Primer 25K 向け SPI→NeoPixel エンジン（SystemVerilog / Gowin プロジェクト / シミュレーション環境） |
| `neopixel-engine/sim/` | Icarus Verilog 用テストベンチと GTKWave 設定 |
| `neopixel-engine/gowin_neopixel-engine/` | Gowin EDA でそのまま開けるプロジェクト、制約ファイル (`.cst`, `.sdc`) |

## システム構成とデータフロー
1. **Raspberry Pi**  
   - `/dev/spidev4.0` を SPI Mode 3 / 10 MHz で使用。  
   - `ball_physics.c` の HSV ベース粒子シミュレーションで 1200px の RGB フレームを用意。  
   - フレーム毎に Start バイト `0x55 0x5B` → `1200×3` バイトの RGB → Stop バイト `0xAA` を送信。
2. **Tang Primer 25K**  
   - SPI Slave がフレームを 3,600 バイトのダブルバッファに格納。  
   - 6ch NeoPixel ドライバが同期スタートし、各 200px を 50 MHz から生成した WS2812 タイミングで出力。
3. **FieldLinker LED アレイ**  
   - `neopixel_cordinates.h` に保存された 0.01 mm 単位の XY 座標をもとに、ボールの陰影を計算。

## 必要なもの
- Raspberry Pi（SPI4 を引き出せるモデル。例: CM4 + Carrier、Pi 5 等） + 64bit Raspberry Pi OS
- Tang Primer 25K（GW5A-LV25）と 50 MHz 外部クロック
- 6 系統に分岐した NeoPixel（WS2812/WS2812C）× 1200
- SPI 配線（Pi → FPGA）: `SCLK`, `MOSI`, `CS`, `GND`
- ソフトウェア: `gcc`, `make`, `iverilog`, `gtkwave`, Gowin EDA (V1.9.9 以降推奨)

## Raspberry Pi 側アプリケーション
### ビルド
```bash
cd raspberrypi
gcc -O2 -Wall -Wextra -lm spi-led.c ball_physics.c -o spi-led
# または ./tmp.sh （最低限の gcc 呼び出し）
```

### 実行前チェック
- `sudo raspi-config` → *Interface Options* → *SPI* を有効化（SPI4 を使う場合は dtoverlay 設定も忘れずに）。
- `/boot/firmware/config.txt` 例:
  ```
  dtoverlay=spi4-1cs,cs0_pin=8,mosi_pin=10,sclk_pin=9
  ```
- `/dev/spidev4.0` のアクセス権があることを確認。

### 起動
```bash
sudo ./spi-led
```
- 3 ms 間隔で新しいフレームを送り続けます（およそ 333 fps）。  
- `BallConfigHSV` 配列（`spi-led.c` 内）を編集すると、位置・速度・半径・HSV 変化を個別に調整できます。  
- 座標は `COORD_TO_FLOAT()` マクロで mm に変換し、`draw_ball()` が加算合成モード（mode=2）で描画します。

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
1. Raspberry Pi 側で他のエフェクト（FFT ビジュアライザ等）を実装し、`ball_physics.c` と入れ替える。  
2. SPI プロトコルを DMA 対応にし、フレーム同期割り込みを付けてソフト側で映像同期を取る。  
3. FPGA 側でガンマ補正やダブルバッファを 3 枚に拡張し、ギガビット Ethernet 等からの入力にも対応する。

ライセンスは未定です。利用ポリシーを決める場合はプロジェクトルートに `LICENSE` を追加してください。
