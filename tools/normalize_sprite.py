#!/usr/bin/env python3
"""Center each icon's visible bounds inside a regular RGBA PNG sprite grid."""

from __future__ import annotations

import argparse
import binascii
import os
from pathlib import Path
import struct
import tempfile
import zlib


PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


def paeth(left: int, above: int, upper_left: int) -> int:
    estimate = left + above - upper_left
    left_distance = abs(estimate - left)
    above_distance = abs(estimate - above)
    corner_distance = abs(estimate - upper_left)
    if left_distance <= above_distance and left_distance <= corner_distance:
        return left
    if above_distance <= corner_distance:
        return above
    return upper_left


def read_png(path: Path) -> tuple[int, int, list[tuple[bytes, bytes]], bytearray]:
    contents = path.read_bytes()
    if not contents.startswith(PNG_SIGNATURE):
        raise ValueError(f"{path} is not a PNG file")

    chunks: list[tuple[bytes, bytes]] = []
    compressed = bytearray()
    offset = len(PNG_SIGNATURE)

    while offset < len(contents):
        length = struct.unpack(">I", contents[offset : offset + 4])[0]
        chunk_type = contents[offset + 4 : offset + 8]
        chunk_data = contents[offset + 8 : offset + 8 + length]
        chunks.append((chunk_type, chunk_data))
        if chunk_type == b"IDAT":
            compressed.extend(chunk_data)
        offset += length + 12

    header = next(data for chunk_type, data in chunks if chunk_type == b"IHDR")
    width, height, depth, color_type, compression, filter_method, interlace = struct.unpack(
        ">IIBBBBB", header
    )
    if (depth, color_type, compression, filter_method, interlace) != (8, 6, 0, 0, 0):
        raise ValueError("expected a non-interlaced 8-bit RGBA PNG")

    bytes_per_pixel = 4
    stride = width * bytes_per_pixel
    filtered = zlib.decompress(compressed)
    pixels = bytearray(width * height * bytes_per_pixel)
    source_offset = 0
    previous = bytearray(stride)

    for row_index in range(height):
        filter_type = filtered[source_offset]
        source_offset += 1
        row = bytearray(filtered[source_offset : source_offset + stride])
        source_offset += stride

        for index in range(stride):
            left = row[index - bytes_per_pixel] if index >= bytes_per_pixel else 0
            above = previous[index]
            upper_left = previous[index - bytes_per_pixel] if index >= bytes_per_pixel else 0
            if filter_type == 1:
                row[index] = (row[index] + left) & 0xFF
            elif filter_type == 2:
                row[index] = (row[index] + above) & 0xFF
            elif filter_type == 3:
                row[index] = (row[index] + ((left + above) // 2)) & 0xFF
            elif filter_type == 4:
                row[index] = (row[index] + paeth(left, above, upper_left)) & 0xFF
            elif filter_type != 0:
                raise ValueError(f"unsupported PNG filter {filter_type}")

        start = row_index * stride
        pixels[start : start + stride] = row
        previous = row

    return width, height, chunks, pixels


def center_cells(
    pixels: bytearray,
    width: int,
    height: int,
    columns: int,
    rows: int,
    alpha_threshold: int,
) -> tuple[bytearray, list[int]]:
    if width % columns or height % rows:
        raise ValueError("image dimensions must divide evenly into the requested grid")

    cell_width = width // columns
    cell_height = height // rows
    result = bytearray(len(pixels))
    shifts: list[int] = []

    for cell_row in range(rows):
        for cell_column in range(columns):
            origin_x = cell_column * cell_width
            origin_y = cell_row * cell_height
            visible_rows: list[int] = []

            for local_y in range(cell_height):
                row_start = ((origin_y + local_y) * width + origin_x) * 4
                for local_x in range(cell_width):
                    if pixels[row_start + local_x * 4 + 3] >= alpha_threshold:
                        visible_rows.append(local_y)
                        break

            if not visible_rows:
                raise ValueError(f"cell {cell_column},{cell_row} has no visible pixels")

            visible_center_twice = min(visible_rows) + max(visible_rows)
            cell_center_twice = cell_height - 1
            shift = round((cell_center_twice - visible_center_twice) / 2)
            shifts.append(shift)

            for local_y in range(cell_height):
                target_y = local_y + shift
                if not 0 <= target_y < cell_height:
                    continue
                source_start = ((origin_y + local_y) * width + origin_x) * 4
                target_start = ((origin_y + target_y) * width + origin_x) * 4
                byte_count = cell_width * 4
                result[target_start : target_start + byte_count] = pixels[
                    source_start : source_start + byte_count
                ]

    return result, shifts


def filter_row(row: memoryview, previous: memoryview, bytes_per_pixel: int = 4) -> bytes:
    candidates: list[bytes] = []
    for filter_type in range(5):
        encoded = bytearray(len(row))
        for index, value in enumerate(row):
            left = row[index - bytes_per_pixel] if index >= bytes_per_pixel else 0
            above = previous[index]
            upper_left = previous[index - bytes_per_pixel] if index >= bytes_per_pixel else 0
            if filter_type == 0:
                predictor = 0
            elif filter_type == 1:
                predictor = left
            elif filter_type == 2:
                predictor = above
            elif filter_type == 3:
                predictor = (left + above) // 2
            else:
                predictor = paeth(left, above, upper_left)
            encoded[index] = (value - predictor) & 0xFF
        candidates.append(bytes(encoded))

    best_type, best_row = min(
        enumerate(candidates),
        key=lambda candidate: sum(min(value, 256 - value) for value in candidate[1]),
    )
    return bytes([best_type]) + best_row


def make_chunk(chunk_type: bytes, data: bytes) -> bytes:
    checksum = binascii.crc32(chunk_type)
    checksum = binascii.crc32(data, checksum) & 0xFFFFFFFF
    return struct.pack(">I", len(data)) + chunk_type + data + struct.pack(">I", checksum)


def write_png(
    path: Path,
    width: int,
    height: int,
    chunks: list[tuple[bytes, bytes]],
    pixels: bytearray,
    source_mode: int,
) -> None:
    stride = width * 4
    previous = memoryview(bytes(stride))
    filtered_rows: list[bytes] = []
    view = memoryview(pixels)

    for row_index in range(height):
        row = view[row_index * stride : (row_index + 1) * stride]
        filtered_rows.append(filter_row(row, previous))
        previous = row

    replacement = zlib.compress(b"".join(filtered_rows), level=9)
    output = bytearray(PNG_SIGNATURE)
    wrote_data = False

    for chunk_type, chunk_data in chunks:
        if chunk_type == b"IDAT":
            if not wrote_data:
                output.extend(make_chunk(b"IDAT", replacement))
                wrote_data = True
            continue
        output.extend(make_chunk(chunk_type, chunk_data))

    path.parent.mkdir(parents=True, exist_ok=True)
    handle, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(handle, "wb") as temporary:
            temporary.write(output)
        os.chmod(temporary_name, source_mode)
        os.replace(temporary_name, path)
    except Exception:
        os.unlink(temporary_name)
        raise


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("destination", type=Path)
    parser.add_argument("--columns", type=int, default=4)
    parser.add_argument("--rows", type=int, default=3)
    parser.add_argument("--alpha-threshold", type=int, default=32)
    arguments = parser.parse_args()

    width, height, chunks, pixels = read_png(arguments.source)
    normalized, shifts = center_cells(
        pixels,
        width,
        height,
        arguments.columns,
        arguments.rows,
        arguments.alpha_threshold,
    )
    source_mode = arguments.source.stat().st_mode & 0o777
    write_png(arguments.destination, width, height, chunks, normalized, source_mode)

    print("vertical shifts by row:")
    for start in range(0, len(shifts), arguments.columns):
        print(" ".join(f"{shift:+d}px" for shift in shifts[start : start + arguments.columns]))


if __name__ == "__main__":
    main()
