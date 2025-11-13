"""Runtime configuration objects for the Raspberry Pi service."""

from dataclasses import dataclass


@dataclass
class AppConfig:
    """Holds tunable parameters for the SPI/WebSocket bridge."""

    spi_bus: int = 4
    spi_device: int = 0
    spi_max_speed_hz: int = 10_000_000
    frame_size: int = 3_600
    frame_header: bytes = bytes([0x55, 0x5B])
    frame_footer: bytes = bytes([0xAA])
    queue_size: int = 3  # drop-oldest policy when exceeded
