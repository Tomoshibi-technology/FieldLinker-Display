"""Application entrypoints."""

from __future__ import annotations

import logging

from fastapi import FastAPI

from .config import AppConfig
from .spi import SpiTransmitter
from .worker import FrameQueue, FrameWorker
from .ws import register_websocket_routes

logger = logging.getLogger(__name__)


def create_app(config: AppConfig | None = None) -> FastAPI:
    """Build a FastAPI instance with shared configuration."""
    config = config or AppConfig()

    app = FastAPI(title="FieldLinker Display Raspberry Pi Service")
    app.state.config = config

    frame_queue = FrameQueue(config.queue_size)
    spi = SpiTransmitter(config)
    worker = FrameWorker(frame_queue, spi)

    app.state.frame_queue = frame_queue
    app.state.frame_worker = worker
    app.state.spi_transmitter = spi

    @app.on_event("startup")
    async def _startup() -> None:
        worker.start()

    @app.on_event("shutdown")
    async def _shutdown() -> None:
        await worker.stop()
        spi.close()

    @app.get("/healthz")
    async def healthz() -> dict[str, object]:
        stats = getattr(app.state, "connection_stats", None)
        response = {"status": "ok"}
        if stats:
            response.update(
                {
                    "active_connections": stats.active,
                    "total_frames": stats.total_frames,
                    "last_frame_id": stats.last_frame_id,
                }
            )
        return response

    register_websocket_routes(app)
    return app


app = create_app()
