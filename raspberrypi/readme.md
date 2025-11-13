#　









## ハードウェア依存ポイント（`spi-led.c`）

現在の `spi-led.c` は固定 3,600 バイトのフレームを 1 回だけ送信するミニマル実装ですが、以下のハードウェア条件に強く依存しています。

- **デバイスノード**: `DEFAULT_DEVICE` は `/dev/spidev4.0` に固定 (`raspberrypi/src/spi-led.c:13-15`)。CM4 や Pi 5 で SPI4 を有効化する `dtoverlay=spi4-1cs` などの設定が必須で、別デバイスを使う場合はソースを再ビルドする必要があります。
- **SPI モード/クロック**: `configure_spi()` で Mode 3 / 10 MHz を書き込んでおり (`raspberrypi/src/spi-led.c:17-29`)、想定している FPGA 側ロジックも同じ条件で動作する前提です。ハード側で許容されない場合はコードを修正してください。
- **フレーム構造**: `send_frame()` が `0x55 0x5B`（ヘッダ）→3600 バイト→`0xAA` の順で送信します (`raspberrypi/src/spi-led.c:32-45`)。FPGA もこのフレーミングをトリガーにしているため、並びを変えると受信できません。
- **データサイズ**: `FRAME_BYTES` が 3600 にハードコードされており (`raspberrypi/src/spi-led.c:13`)、LED 数やチャネル構成が変わる場合はソースを合わせて変更する必要があります。
- **ペイロード初期値**: `main()` は `memset(frame, 3, sizeof(frame));` で値 3 を全 LED に書き込みます (`raspberrypi/src/spi-led.c:48-64`)。周辺ハードが 0 以外のデータで正しく点灯することを確認した上で調整してください。

上記以外にも、`open(DEFAULT_DEVICE, O_WRONLY)` を `sudo` なしで通すには `/dev/spidev4.0` のアクセス権を変更する必要があります。環境ごとに udev ルールを用意するなどして対応してください。

