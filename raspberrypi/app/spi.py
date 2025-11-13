"""SPI transmission helpers."""

from __future__ import annotations

import logging
from typing import Optional

from .config import AppConfig

try:
    import spidev  # type: ignore
except ImportError:  # pragma: no cover
    spidev = None

logger = logging.getLogger(__name__)


class SpiTransmitter:
    """Wraps low-level SPI transfers to the FPGA."""

    def __init__(self, config: AppConfig):
        self._config = config
        self._device: Optional["spidev.SpiDev"] = None

        if spidev is None:
            logger.warning(
                "spidev module is not available; SPI transfers will be disabled until "
                "the module is installed (typically only possible on Raspberry Pi)."
            )
            return

        dev = spidev.SpiDev()
        dev.open(config.spi_bus, config.spi_device)
        dev.mode = 0b11
        dev.max_speed_hz = config.spi_max_speed_hz
        self._device = dev
        logger.info(
            "SPI initialized (bus=%s device=%s speed=%sHz)",
            config.spi_bus,
            config.spi_device,
            config.spi_max_speed_hz,
        )

    def send_frame(self, payload: bytes) -> None:
        """Transmit a single RGB frame with header/footer applied."""
        if len(payload) != self._config.frame_size:
            raise ValueError(
                f"payload must be {self._config.frame_size} bytes, got {len(payload)}"
            )
        if self._device is None:
            raise RuntimeError("SPI device is not initialized on this platform")

        frame = bytes(self._config.frame_header) + payload + bytes(self._config.frame_footer)
        self._device.xfer2(list(frame))

    def close(self) -> None:
        if self._device:
            self._device.close()
            self._device = None

    def __del__(self) -> None:  # pragma: no cover
        try:
            self.close()
        except Exception:
            pass
