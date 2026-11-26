"""Make an exposure sheet and an editable cutout-animation proof from local artwork."""

import argparse
import json
import math
import subprocess
import tempfile
from fractions import Fraction
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


def pixels(value, count, label):
    if (
        not isinstance(value, list)
        or len(value) != count
        or any(type(v) is not int for v in value)
    ):
        raise ValueError(f"{label}: expected {count} integer coordinates")
    return value


def named(items, section):
    if not isinstance(items, list) or not items:
        raise ValueError(f"expected at least one {section} entry")
    names = set()
    for item in items:
        name = item["id"]
        if not isinstance(name, str) or not name.strip() or name in names:
            raise ValueError(f"{section}: empty or repeated ID {name!r}")
        names.add(name)
        yield name, item


def input_layers(manifest, base):
    poses = {}
    for name, entry in named(manifest["poses"], "poses"):
        image = Image.open(base / entry["file"]).convert("RGBA")
        alpha = image.getchannel("A")
        if alpha.getextrema()[0] != 0 or alpha.getextrema()[1] < 128:
            raise ValueError(
                f"{name}: supply an isolated pose with transparent and solid pixels"
            )
        x, y = pixels(entry["anchor"], 2, name)
        if not 0 <= x < image.width or not 0 <= y < image.height:
            raise ValueError(f"{name}: anchor outside pose")
        poses[name] = (image, (x, y), entry.get("label", name))
    plates = {}
    for name, entry in named(manifest["plates"], "plates"):
        image = Image.open(base / entry["file"]).convert("RGBA")
        if image.getchannel("A").getextrema() != (255, 255):
            raise ValueError(f"{name}: the background plate must cover the frame")
        plates[name] = image
    return poses, plates


def plate_view(plate, shot, size):
    x, y, w, h = pixels(shot.get("plateView", [0, 0, *plate.size]), 4, "plateView")
    if min(x, y) < 0 or min(w, h) <= 0 or x + w > plate.width or y + h > plate.height:
        raise ValueError(f"{shot['id']}: plateView outside the background")
    if w * size[1] != h * size[0]:
        raise ValueError(
            f"{shot['id']}: plateView and output must have the same aspect ratio"
        )
    return plate.crop((x, y, x + w, y + h)).resize(size, Image.Resampling.LANCZOS)


def exposures(manifest, poses, plates, size):
    cursor = 0
    for name, shot in named(manifest["shots"], "shots"):
        plate = plate_view(plates[shot["plate"]], shot, size)
        at = pixels(shot["at"], 2, name)
        scale = shot.get("scale", 1)
        if type(scale) not in (float, int) or not math.isfinite(scale) or scale <= 0:
            raise ValueError(f"{name}: expected a positive scale")
        if not isinstance(shot["exposures"], list) or not shot["exposures"]:
            raise ValueError(f"{name}: empty exposure list")
        for cue in shot["exposures"]:
            key, duration = cue["pose"], cue["frames"]
            if type(duration) is not int or duration < 1:
                raise ValueError(f"{name}/{key}: expected a positive frame count")
            asset, anchor, _ = poses[key]
            contact = cue.get("contact", False)
            if type(contact) is not bool:
                raise ValueError(f"{name}/{key}: contact must be true or false")
            if contact and asset.getpixel(anchor)[3] < 128:
                raise ValueError(f"{name}/{key}: contact point misses the character")
            x, y = pixels(cue.get("at", at), 2, name)
            sw, sh = (
                max(1, round(asset.width * scale)),
                max(1, round(asset.height * scale)),
            )
            layer = asset.resize((sw, sh), Image.Resampling.LANCZOS)
            dx = x - round(anchor[0] * sw / asset.width)
            dy = y - round(anchor[1] * sh / asset.height)
            bounds = layer.getchannel("A").getbbox()
            if bounds is None:
                raise ValueError(f"{name}/{key}: character disappears at this scale")
            left, top, right, bottom = bounds
            bbox = [dx + left, dy + top, dx + right, dy + bottom]
            if not shot.get("allowCrop", False) and (
                bbox[0] < 0 or bbox[1] < 0 or bbox[2] > size[0] or bbox[3] > size[1]
            ):
                raise ValueError(
                    f"{name}/{key}: character clipped at output {bbox}; adjust framing or set allowCrop"
                )
            frame = plate.copy()
            frame.alpha_composite(layer, (dx, dy))
            yield (
                frame.convert("RGB"),
                {
                    "shot": name,
                    "plate": shot["plate"],
                    "pose": key,
                    "in": cursor,
                    "out": cursor + duration,
                    "anchor": [x, y],
                    "origin": [dx, dy],
                    "layerSize": [sw, sh],
                    "bbox": bbox,
                    "contact": contact,
                },
            )
            cursor += duration


def pose_sheet(poses):
    cols = min(4, len(poses))
    rows = math.ceil(len(poses) / cols)
    tile_w, tile_h = 340, 262
    sheet = Image.new("RGB", (cols * tile_w, rows * tile_h), "#151820")
    draw = ImageDraw.Draw(sheet)
    for font_file in ("DejaVuSans.ttf", "arial.ttf"):
        try:
            font = ImageFont.truetype(font_file, 14)
            break
        except OSError:
            pass
    else:
        font = ImageFont.load_default()
    for i, (name, (im, anchor, label)) in enumerate(poses.items()):
        x, y = i % cols * tile_w, i // cols * tile_h
        for j in range(0, 216, 16):
            for k in range(0, tile_w, 16):
                c = "#66717f" if (j // 16 + k // 16) % 2 else "#7b8796"
                draw.rectangle(
                    (
                        x + k,
                        y + j,
                        x + min(tile_w, k + 16) - 1,
                        y + min(216, j + 16) - 1,
                    ),
                    fill=c,
                )
        preview = im.copy()
        preview.thumbnail((tile_w - 12, 206), Image.Resampling.LANCZOS)
        left, top = x + (tile_w - preview.width) // 2, y + (216 - preview.height) // 2
        sheet.paste(preview, (left, top), preview)
        ax = left + round(anchor[0] * preview.width / im.width)
        ay = top + round(anchor[1] * preview.height / im.height)
        draw.line((ax - 6, ay, ax + 6, ay), fill="#f9cd47", width=1)
        draw.line((ax, ay - 6, ax, ay + 6), fill="#f9cd47", width=1)
        draw.text((x + 8, y + 218), name, fill="white", font=font)
        if label != name:
            draw.text((x + 8, y + 239), label, fill="#d7dce3", font=font)
    return sheet


def build(source, dest):
    if dest.exists():
        raise ValueError(f"choose a new output folder: {dest}")
    spec = json.loads(source.read_text(encoding="utf-8-sig"))
    size = pixels(spec["size"], 2, "size")
    if min(size) <= 0 or any(v % 2 for v in size):
        raise ValueError("use positive even canvas dimensions")
    try:
        if type(spec["fps"]) not in (int, str):
            raise ValueError
        rate = Fraction(spec["fps"])
        if rate <= 0:
            raise ValueError
    except (ValueError, ZeroDivisionError) as exc:
        raise ValueError(
            "fps must be a positive integer or an exact fraction string"
        ) from exc
    fps = rate.numerator if rate.denominator == 1 else str(rate)
    poses, plates = input_layers(spec, source.parent)
    dest.parent.mkdir(exist_ok=True, parents=True)
    with tempfile.TemporaryDirectory(dir=dest.parent) as work:
        folder = Path(work) / "result"
        folder.mkdir()
        pose_sheet(poses).save(folder / "poses.png")
        command = [
            "ffmpeg",
            "-v",
            "error",
            "-nostdin",
            "-f",
            "rawvideo",
            "-pix_fmt",
            "rgb24",
            "-s",
            f"{size[0]}x{size[1]}",
            "-r",
            str(fps),
            "-i",
            "pipe:0",
            "-an",
            "-c:v",
            "libx264",
            "-preset",
            "fast",
            "-crf",
            "16",
            "-pix_fmt",
            "yuv420p",
            "-movflags",
            "+faststart",
            str(folder / "take.mp4"),
        ]
        timeline = []
        with (
            tempfile.TemporaryFile() as errors,
            subprocess.Popen(command, stdin=subprocess.PIPE, stderr=errors) as ffmpeg,
        ):
            try:
                for frame, cue in exposures(spec, poses, plates, size):
                    pixels_rgb = frame.tobytes()
                    for _ in range(cue["out"] - cue["in"]):
                        ffmpeg.stdin.write(pixels_rgb)
                    timeline.append(cue)
                ffmpeg.stdin.close()
            except BrokenPipeError:
                pass
            finally:
                if not ffmpeg.stdin.closed:
                    try:
                        ffmpeg.stdin.close()
                    except BrokenPipeError:
                        pass
            if ffmpeg.wait() != 0:
                errors.seek(0)
                raise ValueError(errors.read().decode(errors="replace"))
        data = {
            "size": size,
            "fps": fps,
            "frames": timeline[-1]["out"],
            "exposures": timeline,
        }
        (folder / "timing.json").write_text(
            json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        folder.rename(dest)
    return data


if __name__ == "__main__":
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("manifest", type=Path)
    cli.add_argument("--out", required=True, type=Path)
    args = cli.parse_args()
    try:
        result = build(args.manifest, args.out)
        print(f"{result['frames']} frames at {result['fps']} fps")
    except (ValueError, OSError, KeyError, TypeError) as err:
        cli.exit(2, f"pose_plates: {err}\n")
