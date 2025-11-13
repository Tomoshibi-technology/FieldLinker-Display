"""WebSocket endpoint registration."""

from __future__ import annotations

import base64
import binascii
import logging
from dataclasses import dataclass
from typing import Any, Optional

from fastapi import FastAPI, WebSocket
from fastapi.websockets import WebSocketDisconnect

from .config import AppConfig
from .worker import FrameMessage, FrameQueue

logger = logging.getLogger(__name__)


@dataclass
class ConnectionStats:
    active: int = 0
    total_frames: int = 0
    last_frame_id: Optional[int] = None


def register_websocket_routes(app: FastAPI) -> None:
    """Attach WebSocket endpoints to the FastAPI app."""

    stats: ConnectionStats = getattr(app.state, "connection_stats", ConnectionStats())
    app.state.connection_stats = stats

    @app.websocket("/ws/frame")
    async def frame_stream(websocket: WebSocket) -> None:
        await websocket.accept()
        stats.active += 1
        logger.info("WebSocket connected from %s", websocket.client)

        config: AppConfig = websocket.app.state.config
        queue: FrameQueue = websocket.app.state.frame_queue

        try:
            while True:
                message = await websocket.receive_json()
                try:
                    frame_id, payload = _parse_message(message, config.frame_size)
                except ValueError as exc:
                    await websocket.send_json({"status": "error", "reason": str(exc)})
                    continue

                await queue.put(FrameMessage(frame_id=frame_id, payload=payload))
                stats.total_frames += 1
                stats.last_frame_id = frame_id
                await websocket.send_json({"status": "ok", "frame_id": frame_id})
        except WebSocketDisconnect:
            logger.info("WebSocket disconnected from %s", websocket.client)
        finally:
            stats.active = max(0, stats.active - 1)


def _parse_message(message: Any, expected_len: int) -> tuple[Optional[int], bytes]:
    if not isinstance(message, dict):
        raise ValueError("payload must be a JSON object")

    raw_payload = message.get("data")
    if not isinstance(raw_payload, str):
        raise ValueError("`data` field must be a Base64 string")

    try:
        decoded = base64.b64decode(raw_payload, validate=True)
    except (binascii.Error, ValueError):
        raise ValueError("`data` field is not valid Base64") from None

    if len(decoded) != expected_len:
        raise ValueError(f"payload must be {expected_len} bytes after decode")

    frame_id = message.get("frame_id")
    if frame_id is not None and not isinstance(frame_id, int):
        raise ValueError("`frame_id` must be an integer if provided")

    return frame_id, decoded
