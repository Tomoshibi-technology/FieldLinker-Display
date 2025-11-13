"""Frame queue and background sender."""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from typing import Optional

from .spi import SpiTransmitter

logger = logging.getLogger(__name__)


@dataclass
class FrameMessage:
    frame_id: Optional[int]
    payload: bytes


class FrameQueue:
    """Drop-oldest queue backed by asyncio.Queue."""

    def __init__(self, max_length: int):
        self._queue: asyncio.Queue[FrameMessage] = asyncio.Queue(maxsize=max_length)

    async def put(self, item: FrameMessage) -> None:
        if self._queue.full():
            try:
                dropped = self._queue.get_nowait()
                logger.debug("Dropped oldest frame_id=%s due to full queue", dropped.frame_id)
            except asyncio.QueueEmpty:  # pragma: no cover
                pass
        await self._queue.put(item)

    async def get(self) -> FrameMessage:
        return await self._queue.get()


class FrameWorker:
    """Consumes queued frames and pushes them to SPI."""

    def __init__(self, queue: FrameQueue, transmitter: SpiTransmitter):
        self._queue = queue
        self._transmitter = transmitter
        self._task: Optional[asyncio.Task[None]] = None

    def start(self) -> None:
        if self._task is not None:
            return
        loop = asyncio.get_running_loop()
        self._task = loop.create_task(self._run(), name="frame-worker")
        logger.info("Frame worker started")

    async def _run(self) -> None:
        try:
            while True:
                message = await self._queue.get()
                try:
                    self._transmitter.send_frame(message.payload)
                except Exception as exc:  # pragma: no cover - hardware dependent
                    logger.error("SPI transfer failed for frame_id=%s: %s", message.frame_id, exc)
        except asyncio.CancelledError:
            logger.info("Frame worker stopped")
            raise

    async def stop(self) -> None:
        if self._task is None:
            return
        self._task.cancel()
        try:
            await self._task
        except asyncio.CancelledError:
            pass
        self._task = None
