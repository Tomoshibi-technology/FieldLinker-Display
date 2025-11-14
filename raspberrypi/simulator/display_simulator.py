#!/usr/bin/env python3
"""WebSocket-based FieldLinker display simulator with matplotlib preview."""

from __future__ import annotations

import argparse
import asyncio
import base64
import json
import signal
import socket
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

import matplotlib.pyplot as plt
from matplotlib.collections import PolyCollection
import numpy as np
from scipy.spatial import Voronoi
import websockets
from websockets.server import WebSocketServerProtocol

FRAME_SIZE = 3600
LED_COUNT = 1200
DEFAULT_MAX_BRIGHTNESS = 15
DEFAULT_HOST = "0.0.0.0"
DEFAULT_PORT = 8000
PIXEL_MAP_DEFAULT = Path(__file__).resolve().parents[1] / "webclient" / "assets" / "pixel_map.json"


@dataclass
class IncomingFrame:
    frame_id: int
    payload: bytes

    @classmethod
    def from_message(cls, message: str) -> "IncomingFrame":
        data = json.loads(message)
        if not isinstance(data, dict):
            raise ValueError("Payload must be a JSON object")
        frame_id = int(data.get("frame_id", 0))
        encoded = data.get("data")
        if not isinstance(encoded, str):
            raise ValueError("`data` must be Base64 string")
        payload = base64.b64decode(encoded)
        if len(payload) != FRAME_SIZE:
            raise ValueError(f"Expected {FRAME_SIZE} bytes, got {len(payload)}")
        return cls(frame_id=frame_id, payload=payload)


def voronoi_finite_polygons_2d(vor: Voronoi, radius: float | None = None) -> tuple[list[list[int]], np.ndarray]:
    if vor.points.shape[1] != 2:
        raise ValueError("Requires 2D input")
    new_regions: list[list[int]] = []
    new_vertices = vor.vertices.tolist()

    center = vor.points.mean(axis=0)
    if radius is None:
        radius = np.ptp(vor.points, axis=0).max() * 2

    all_ridges: dict[int, list[tuple[int, int, int]]] = {}
    for (point_idx, other_idx), ridge_vertices in zip(vor.ridge_points, vor.ridge_vertices, strict=False):
        all_ridges.setdefault(point_idx, []).append((other_idx, ridge_vertices[0], ridge_vertices[1]))
        all_ridges.setdefault(other_idx, []).append((point_idx, ridge_vertices[0], ridge_vertices[1]))

    for point_idx, region_idx in enumerate(vor.point_region):
        vertices = vor.regions[region_idx]
        if all(v >= 0 for v in vertices):
            new_regions.append(vertices)
            continue

        ridges = all_ridges.get(point_idx, [])
        new_region: list[int] = [v for v in vertices if v >= 0]

        for other_idx, v1, v2 in ridges:
            if v2 < 0:
                v1, v2 = v2, v1
            if v1 >= 0:
                continue

            tangent = vor.points[other_idx] - vor.points[point_idx]
            tangent /= np.linalg.norm(tangent)
            normal = np.array([-tangent[1], tangent[0]])

            midpoint = vor.points[[point_idx, other_idx]].mean(axis=0)
            direction = np.sign(np.dot(midpoint - center, normal)) * normal
            far_point = vor.vertices[v2] + direction * radius
            new_vertices.append(far_point.tolist())
            new_region.append(len(new_vertices) - 1)

        vs = np.asarray([new_vertices[v] for v in new_region])
        angles = np.arctan2(vs[:, 1] - center[1], vs[:, 0] - center[0])
        new_region = [v for _, v in sorted(zip(angles, new_region, strict=False))]
        new_regions.append(new_region)

    return new_regions, np.asarray(new_vertices)


def build_voronoi_polygons(points: np.ndarray) -> list[np.ndarray]:
    center = points.mean(axis=0)
    max_radius = np.max(np.linalg.norm(points - center, axis=1))
    boundary_radius = max_radius * 1.2
    boundary_angles = np.linspace(0, 2 * np.pi, 64, endpoint=False)
    boundary_points = center + boundary_radius * np.c_[np.cos(boundary_angles), np.sin(boundary_angles)]
    augmented_points = np.vstack([points, boundary_points])
    vor = Voronoi(augmented_points)
    regions, vertices = voronoi_finite_polygons_2d(vor, radius=boundary_radius * 2)
    polygons = [vertices[regions[i]] for i in range(len(points))]
    return polygons


def clamp_polygons_to_circle(polygons: list[np.ndarray], center: np.ndarray, radius: float) -> list[np.ndarray]:
    clamped: list[np.ndarray] = []
    for polygon in polygons:
        shifted = polygon - center
        distances = np.linalg.norm(shifted, axis=1)
        mask = distances > radius
        adjusted = np.array(polygon, copy=True)
        if np.any(mask):
            adjusted[mask] = center + shifted[mask] / distances[mask][:, None] * radius
        clamped.append(adjusted)
    return clamped


class DisplayRenderer:
    """Handles LED coordinate mapping and matplotlib drawing."""

    def __init__(self, pixel_map: Iterable[dict], max_brightness: int) -> None:
        self.max_brightness = max(1, max_brightness)
        coords = [(float(p["x"]), float(p["y"])) for p in pixel_map]
        if not coords:
            raise ValueError("Pixel map is empty")
        self.coords = np.array(coords, dtype=float)
        self.led_count = len(coords)
        if self.led_count != LED_COUNT:
            print(f"[!] Warning: pixel map has {self.led_count} LEDs (expected {LED_COUNT}).")
        self.frame = np.zeros((self.led_count, 3), dtype=np.uint8)
        self._init_plot()

    def _init_plot(self) -> None:
        plt.ion()
        self.fig, self.ax = plt.subplots(figsize=(8, 8))
        xs, ys = self.coords[:, 0], self.coords[:, 1]
        margin = 5
        self.ax.set_aspect("equal")
        self.ax.set_title("FieldLinker Display Simulator")
        self.ax.set_facecolor("#101010")
        self.ax.set_xlim(xs.min() - margin, xs.max() + margin)
        self.ax.set_ylim(ys.min() - margin, ys.max() + margin)
        self.ax.invert_yaxis()
        self.ax.axis("off")
        center = self.coords.mean(axis=0)
        self.display_radius = np.max(np.linalg.norm(self.coords - center, axis=1))
        self.polygons = build_voronoi_polygons(self.coords)
        self.polygons = clamp_polygons_to_circle(self.polygons, center, self.display_radius)
        if len(self.polygons) != self.led_count:
            raise ValueError("Voronoi polygon count mismatch")
        initial_colors = np.zeros((self.led_count, 4))
        initial_colors[:, 3] = 1.0
        self.collection = PolyCollection(self.polygons, edgecolors="#202020", linewidths=0.2)
        self.collection.set_facecolor(initial_colors)
        self.ax.add_collection(self.collection)
        self.ax.add_patch(plt.Circle(tuple(center), self.display_radius, facecolor="none", edgecolor="#505050", linewidth=1.2))
        self.text = self.ax.text(
            0.02,
            0.98,
            "frame: -",
            transform=self.ax.transAxes,
            color="#f0f0f0",
            ha="left",
            va="top",
            fontsize=10,
        )
        self.fig.canvas.draw()
        plt.pause(0.001)

    def update(self, frame: IncomingFrame) -> None:
        values = np.frombuffer(frame.payload, dtype=np.uint8).reshape(-1, 3)
        if values.shape[0] != self.led_count:
            raise ValueError(f"Payload LED count {values.shape[0]} does not match pixel map {self.led_count}")
        np.copyto(self.frame, values)
        base = 0.2
        scaled = np.clip(self.frame / self.max_brightness, 0, 1)
        scaled = base + (1 - base) * scaled
        rgba = np.ones((self.frame.shape[0], 4))
        rgba[:, :3] = scaled
        self.collection.set_facecolor(rgba)
        self.text.set_text(f"frame: {frame.frame_id}")
        self.fig.canvas.draw_idle()
        self.fig.canvas.flush_events()

    @staticmethod
    def pump_gui() -> None:
        plt.pause(0.001)


def get_connection_path(connection: WebSocketServerProtocol) -> str:
    path = getattr(connection, "path", None)
    if path is not None:
        return str(path)
    request = getattr(connection, "request", None)
    if request is not None:
        return getattr(request, "path", "unknown")
    return "unknown"


async def handle_client(websocket: WebSocketServerProtocol, renderer: DisplayRenderer) -> None:
    remote = websocket.remote_address or ("?", "?")
    client = f"{remote[0]}:{remote[1]}"
    print(f"[+] Connected: {client} (path={get_connection_path(websocket)})")
    try:
        async for message in websocket:
            try:
                frame = IncomingFrame.from_message(message)
                renderer.update(frame)
                response = {"status": "ok", "frame_id": frame.frame_id}
            except Exception as exc:
                print(f"[!] Error processing frame: {exc}")
                response = {"status": "error", "reason": str(exc)}
            await websocket.send(json.dumps(response))
    except websockets.ConnectionClosed:
        pass
    finally:
        print(f"[-] Disconnected: {client}")


def load_pixel_map(path: Path) -> list[dict]:
    with path.open(encoding="utf-8") as f:
        data = json.load(f)
        if not isinstance(data, list):
            raise ValueError("pixel_map must be a list")
        return data


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Simulate FieldLinker Display LEDs.")
    parser.add_argument("--host", default=DEFAULT_HOST, help=f"WebSocket bind host (default: {DEFAULT_HOST})")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help=f"WebSocket port (default: {DEFAULT_PORT})")
    parser.add_argument(
        "--pixel-map",
        type=Path,
        default=PIXEL_MAP_DEFAULT,
        help=f"Path to pixel_map.json (default: {PIXEL_MAP_DEFAULT})",
    )
    parser.add_argument(
        "--max-brightness",
        type=int,
        default=DEFAULT_MAX_BRIGHTNESS,
        help=f"Expected max LED value for scaling (default: {DEFAULT_MAX_BRIGHTNESS})",
    )
    return parser.parse_args()


def discover_access_urls(host: str, port: int) -> list[str]:
    urls = {f"ws://{host}:{port}/ws/frame"}
    candidates = []
    if host in {"0.0.0.0", "::", "0"}:
        candidates.extend(["127.0.0.1"])
        try:
            hostname = socket.gethostname()
            host_ip = socket.gethostbyname(hostname)
            if host_ip:
                candidates.append(host_ip)
        except OSError:
            pass
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
                sock.connect(("8.8.8.8", 80))
                candidates.append(sock.getsockname()[0])
        except OSError:
            pass
    for candidate in candidates:
        urls.add(f"ws://{candidate}:{port}/ws/frame")
    return sorted(urls)


async def main() -> None:
    args = parse_args()
    pixel_map_path = args.pixel_map.resolve()
    pixel_map = load_pixel_map(pixel_map_path)
    renderer = DisplayRenderer(pixel_map, args.max_brightness)

    server = await websockets.serve(lambda ws: handle_client(ws, renderer), args.host, args.port)
    urls = discover_access_urls(args.host, args.port)
    print("Simulator ready. Connect using:")
    for url in urls:
        print(f"  - {url}")

    stop_event = asyncio.Event()

    def handle_stop(*_: object) -> None:
        stop_event.set()

    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, handle_stop)
        except NotImplementedError:
            # Windows does not support add_signal_handler for SIGTERM
            pass

    try:
        while not stop_event.is_set():
            DisplayRenderer.pump_gui()
            await asyncio.sleep(0.02)
    finally:
        server.close()
        await server.wait_closed()
        plt.close("all")


if __name__ == "__main__":
    asyncio.run(main())
