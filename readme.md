# FieldLinker Dispaly 実装
## このリポジトリではFieldLinker Displayのソフトウェア実装を管理しています。

## ディレクトリ構成
- `raspberrypi/`: Raspberry Pi 向けの実装を格納
- `fpga/`: FPGA 側の実装を格納
- `panel/`: 螺旋配置NeoPixel LED パネルの設計データを格納

## ハードウェア構成
Raspberry Pi -> FPGA -> NeoPixel LED ストリップ の順にデータが流れます。
- **Raspberry Pi**: SPI マスターとして動作し、LED データを送信
- **FPGA**: SPI スレーブとして動作し、Raspberry Pi からのデータを受信
- **NeoPixel LED パネル**: FPGA からのデータを受信して表示

## NeoPixel LED パネルの概要
螺旋状に配置された NeoPixel LED パネルは、1 チャネルあたり 200 個の LED で構成され、合計 6 チャネル、1,200 個の LED があります。各 LED は RGB 形式でデータを受信します。各 LED は 3 バイト（R、G、B）で表現されるため、1 チャネルあたり 600 バイト、6 チャネル合計で 3,600 バイトのデータが必要です。
チャネルについてはFPGA 側でマルチプレクスされ、RaspberryPi からは単一チャネルとして見えます。RaspberryPi 側では 3,600 バイトのデータを一括で送信します。
各LEDのX,Y座標については、`panel/neopixel_map.csv` に記載されています。

## Raspberry Pi と FPGA 間の SPI 通信
Raspberry Pi は SPI マスターとして動作し、FPGA は SPI スレーブとして動作します。Raspberry Pi から FPGA へ 3,600 バイトのデータを送信します。SPI 通信は以下の設定で行われます。
- **SPI モード**: Mode 3 (CPOL=1, CPHA=1)
- **クロック速度**: 10 MHz
- **デバイスノード**: `/dev/spidev4.0` (SPI4 チャネル 0)
- **フレーム構造**: ヘッダ `0x55 0x5B` + 3,600 バイトのデータ + フッタ `0xAA`
- **データ内容**: 1,200 個の LED それぞれに R/G/B の 1 バイトずつを割り当てた連続 3,600 バイトの RGB フレーム。例として全バイトを `0x03` にすると暗いグレーで点灯します。


## 書き換え
Raspberry Pi の `/boot/config.txt` に以下の行を追加してください。
```
dtoverlay=spi0-1cs
dtoverlay=spi4-1cs
```