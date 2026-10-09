"""Generate crisp, dependency-free AquaWise PNG icons for the PWA manifest."""

from __future__ import annotations

import math
import struct
import zlib
from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / "public" / "icons"
BG = (35, 77, 63, 255)
DROP = (238, 244, 224, 255)
INK = (35, 77, 63, 255)


def inside_polygon(x: float, y: float, points: list[tuple[float, float]]) -> bool:
    inside = False
    j = len(points) - 1
    for i, (xi, yi) in enumerate(points):
        xj, yj = points[j]
        if (yi > y) != (yj > y):
            cross_x = (xj - xi) * (y - yi) / ((yj - yi) or 1e-12) + xi
            if x < cross_x:
                inside = not inside
        j = i
    return inside


def png_chunk(name: bytes, payload: bytes) -> bytes:
    return (
        struct.pack(">I", len(payload)) + name + payload
        + struct.pack(">I", zlib.crc32(name + payload) & 0xFFFFFFFF)
    )


def render_icon(size: int) -> bytes:
    scale = 2
    side = size * scale
    leaf_a = [(0.50, 0.55), (0.34, 0.42), (0.36, 0.36), (0.45, 0.38), (0.52, 0.48)]
    leaf_b = [(0.50, 0.59), (0.61, 0.44), (0.68, 0.42), (0.67, 0.50), (0.55, 0.61)]
    leaf_c = [(0.50, 0.65), (0.39, 0.57), (0.37, 0.61), (0.47, 0.69)]
    high_rows: list[list[tuple[int, int, int, int]]] = []
    for py in range(side):
        y = (py + 0.5) / side
        if y < 0.50:
            width = 0.345 * max(0.0, min(1.0, (y - 0.14) / 0.36))
        elif y < 0.84:
            width = 0.345 * math.sqrt(max(0.0, 1.0 - ((y - 0.50) / 0.34) ** 2))
        else:
            width = 0.0
        row = []
        for px in range(side):
            x = (px + 0.5) / side
            color = DROP if abs(x - 0.5) <= width else BG
            if color == DROP:
                if (0.33 < y < 0.56 and inside_polygon(x, y, leaf_a)) or \
                   (0.40 < y < 0.63 and inside_polygon(x, y, leaf_b)) or \
                   (0.55 < y < 0.70 and inside_polygon(x, y, leaf_c)):
                    color = INK
                elif 0.38 < y < 0.70 and abs(x - 0.5) < 0.012:
                    color = INK
            row.append(color)
        high_rows.append(row)

    rows = []
    for y in range(size):
        row = bytearray()
        for x in range(size):
            samples = [
                high_rows[y * 2 + oy][x * 2 + ox]
                for oy in range(2) for ox in range(2)
            ]
            row.extend(
                sum(pixel[channel] for pixel in samples) // 4
                for channel in range(4)
            )
        rows.append(b"\x00" + bytes(row))
    raw = b"".join(rows)
    header = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + png_chunk(b"IHDR", header)
        + png_chunk(b"IDAT", zlib.compress(raw, 9))
        + png_chunk(b"IEND", b"")
    )


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for size in (192, 512):
        (OUT / f"aquawise-{size}.png").write_bytes(render_icon(size))


if __name__ == "__main__":
    main()
