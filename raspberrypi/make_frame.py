#!/usr/bin/env python3
"""
Utility to build 1200*3 byte RGB frame files for spi-led.c.

Examples:
  python3 make_frame.py --output frame.bin --pattern solid --color 0 0 32
  python3 make_frame.py --pattern rainbow --output /tmp/frame.bin
"""
import argparse
import math
from pathlib import Path

LED_COUNT = 1200
CHANNELS = 3
FRAME_SIZE = LED_COUNT * CHANNELS


def clamp_byte(value: int) -> int:
    return max(0, min(255, int(value)))


def build_solid_frame(color):
    return bytes(color * LED_COUNT)


def build_rainbow_frame():
    data = bytearray(FRAME_SIZE)
    for i in range(LED_COUNT):
        t = i / LED_COUNT
        angle = t * 2 * math.pi
        r = (math.sin(angle) * 0.5 + 0.5) * 255
        g = (math.sin(angle + 2 * math.pi / 3) * 0.5 + 0.5) * 255
        b = (math.sin(angle + 4 * math.pi / 3) * 0.5 + 0.5) * 255
        base = i * CHANNELS
        data[base] = clamp_byte(r)
        data[base + 1] = clamp_byte(g)
        data[base + 2] = clamp_byte(b)
    return bytes(data)


def build_edge_pulse_frame():
    data = bytearray(FRAME_SIZE)
    for i in range(LED_COUNT):
        ratio = i / LED_COUNT
        edge = ratio if ratio < 0.5 else 1.0 - ratio
        intensity = clamp_byte(edge * 512)
        base = i * CHANNELS
        data[base] = intensity
        data[base + 1] = 0
        data[base + 2] = clamp_byte(255 - intensity)
    return bytes(data)


PATTERNS = ("solid", "rainbow", "edge")


def parse_args():
    parser = argparse.ArgumentParser(description="Generate RGB frame data for spi-led.")
    parser.add_argument(
        "--pattern",
        choices=PATTERNS,
        default="rainbow",
        help="Frame pattern to generate (default: %(default)s)",
    )
    parser.add_argument(
        "--color",
        nargs=3,
        type=int,
        metavar=("R", "G", "B"),
        help="RGB values 0-255 for solid pattern.",
    )
    parser.add_argument(
        "--output",
        "-o",
        type=Path,
        default=Path("frame.bin"),
        help="Output file path (default: %(default)s)",
    )
    return parser.parse_args()


def main():
    args = parse_args()

    if args.pattern == "solid":
        if args.color is None:
            raise SystemExit("--color R G B is required for solid pattern")
        color = tuple(clamp_byte(v) for v in args.color)
        frame = build_solid_frame(color)
    else:
        if args.color is not None:
            print("--color is ignored unless pattern=solid")
        if args.pattern == "rainbow":
            frame = PATTERNS["rainbow"]()
        elif args.pattern == "edge":
            frame = PATTERNS["edge"]()
        else:
            raise SystemExit(f"Unknown pattern: {args.pattern}")

    args.output.write_bytes(frame)
    print(f"Wrote {FRAME_SIZE} bytes to {args.output}")


if __name__ == "__main__":
    main()
