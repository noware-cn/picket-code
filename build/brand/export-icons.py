#!/usr/bin/env python3
"""Export the Picket Code emblem to every raster the product ships.

The emblem is pure geometry (four corner modules plus a central diamond), so it
is drawn here directly instead of rasterizing favicon.svg: no SVG renderer, no
text, and identical output on any machine with Pillow. The OG banner is the one
exception — it embeds the traced wordmark, so that file is rendered through
ImageMagick.

Usage:
  uv run --with pillow python build/brand/export-icons.py

Prerequisites: Pillow (the command above installs it) and ImageMagick on PATH
(`magick`, or `convert` from the 6.x line) for the wordmark. The script checks
for ImageMagick before the first write, so a missing renderer leaves every file
untouched instead of half-updated.

Writes (paths relative to the repository root):
  vscode/resources/win32/code.ico              16..256, flat plate
  vscode/resources/win32/code_70x70.png        toast notifications
  vscode/resources/win32/code_150x150.png      dev window icon
  vscode/resources/darwin/code.icns            16..1024, macOS 824/1024 plate
  vscode/resources/linux/code.png              512, flat plate
  vscode/extensions/picket-remote-wsl/resources/icon.png   128
  website/public/og-image.png                  1200x630 wordmark on deep navy

Colours, radii and the 10/160 emblem inset come from docs/brand-guidelines.md;
do not hand-edit the outputs, change this script and re-run it.
"""
import argparse
import pathlib
import struct

from PIL import Image, ImageDraw

# Night Navy / Cloud / Signal Cyan, as documented.
PLATE = "#081A2B"
MARK = "#F4F8FC"
CORE = "#19C6D8"

# Emblem geometry in favicon.svg's 160x160 canvas: the four modules occupy a
# 140-wide box that the SVG insets by 10 units, so cover=140/160 reproduces the
# SVG exactly and cover=1.0 fills the plate edge to edge.
CANVAS = 160.0
MODULES_W = 140.0
MARK_COVER = MODULES_W / CANVAS
MODULES = [
    [(0, 0), (58, 0), (58, 40), (40, 58), (0, 58)],
    [(82, 0), (140, 0), (140, 58), (100, 58), (82, 40)],
    [(0, 82), (40, 82), (58, 100), (58, 140), (0, 140)],
    [(100, 82), (140, 82), (140, 140), (82, 140), (82, 100)],
]
DIAMOND = [(70, 54), (86, 70), (70, 86), (54, 70)]

FLAT_RADIUS = 28.0 / CANVAS  # favicon.svg uses rx=28 on the 160 canvas
MAC_PLATE = 824.0 / 1024.0  # Big Sur: 100pt margin around an 824pt plate
MAC_RADIUS = 185.0 / 824.0

SUPERSAMPLE = 4
MASTER = 4096


def render_plate(
    size: int,
    *,
    plate: "str | None",
    radius: float,
    plate_pad_ratio: float = 0.0,
    cover: float = MARK_COVER,
    master: int = MASTER,
) -> Image.Image:
    """Draw the emblem at `size`.

    `plate` is `None` for a transparent background. `plate_pad_ratio` shrinks the
    plate inside the canvas (macOS needs 100pt of air for its own shadow), and
    `cover` is the share of the plate edge the four modules span — 140/160 keeps
    favicon.svg's margin, 1.0 fills the plate.
    """
    ss = max(1, min(SUPERSAMPLE, master // size or 1))
    box = size * ss
    image = Image.new("RGBA", (box, box), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)

    pad = round(box * plate_pad_ratio)
    edge = box - 2 * pad
    if plate is not None:
        draw.rounded_rectangle(
            [pad, pad, box - pad - 1, box - pad - 1],
            radius=round(edge * radius),
            fill=plate,
        )

    span = edge * cover
    scale = span / MODULES_W
    offset = pad + (edge - span) / 2

    def point(x: float, y: float) -> "tuple[float, float]":
        return (offset + x * scale, offset + y * scale)

    for module in MODULES:
        draw.polygon([point(x, y) for x, y in module], fill=MARK)
    draw.polygon([point(x, y) for x, y in DIAMOND], fill=CORE)

    return image.resize((size, size), Image.LANCZOS) if ss > 1 else image


def ico_frames() -> "dict[int, Image.Image]":
    return {s: render_plate(s, plate=PLATE, radius=FLAT_RADIUS) for s in (16, 24, 32, 48, 64, 128, 256)}


def write_ico(path: pathlib.Path) -> None:
    frames = ico_frames()
    largest = frames[256]
    largest.save(
        path,
        format="ICO",
        sizes=[(s, s) for s in frames],
        append_images=[frames[s] for s in sorted(frames) if s != 256],
    )


def write_icns(path: pathlib.Path) -> None:
    """Write a PNG-based .icns.

    macOS reads the PNG chunks by type; the 100pt margin and 22.45% corners are
    baked in because the Dock does not clip icons for us.
    """
    entries = [
        (b"icp4", 16),
        (b"icp5", 32),
        (b"icp6", 64),
        (b"ic07", 128),
        (b"ic08", 256),
        (b"ic09", 512),
        (b"ic10", 1024),
    ]
    chunks = []
    for kind, size in entries:
        frame = render_plate(
            size,
            plate=PLATE,
            radius=MAC_RADIUS,
            plate_pad_ratio=(1 - MAC_PLATE) / 2,
            cover=1.0,
        )
        buffer = _png_bytes(frame)
        chunks.append(kind + struct.pack(">I", len(buffer) + 8) + buffer)
    body = b"".join(chunks)
    path.write_bytes(b"icns" + struct.pack(">I", len(body) + 8) + body)


def _png_bytes(image: Image.Image) -> bytes:
    import io

    buffer = io.BytesIO()
    image.save(buffer, format="PNG", optimize=True)
    return buffer.getvalue()


def write_png(path: pathlib.Path, size: int, radius: float = FLAT_RADIUS, plate: str = PLATE) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    render_plate(size, plate=plate, radius=radius).save(path, format="PNG", optimize=True)


def write_browser_icons(directory: pathlib.Path) -> None:
    """Server/web assets: the workbench HTML loads these by fixed name."""
    write_ico(directory / "favicon.ico")
    write_png(directory / "code-192.png", 192)
    write_png(directory / "code-512.png", 512)


def imagemagick() -> list[str]:
    """The ImageMagick entry point, or a stop taken before anything is written.

    Pillow draws every icon; only the OG banner needs the traced wordmark, and
    rasterizing an outlined SVG without a real renderer is not worth it.
    """
    import shutil
    for name in ("magick", "convert"):
        found = shutil.which(name)
        if found:
            return [found]
    raise SystemExit(
        "ImageMagick is required to render website/public/logo.svg; nothing was written.\n"
        "Install it and re-run:\n"
        "  Debian/Ubuntu: sudo apt-get install -y imagemagick\n"
        "  macOS:         brew install imagemagick\n"
        "  Windows:       winget install ImageMagick.ImageMagick"
    )


def write_og_image(path: pathlib.Path, logo: pathlib.Path, magick: list[str]) -> None:
    """1200x630 banner: the wordmark (already outlined) on deep navy.

    The wordmark is the only asset that is not pure geometry, so it goes through
    ImageMagick; the outlines mean no font has to be installed.
    """
    import io
    import subprocess

    width, height = 1200, 630
    canvas = Image.new("RGBA", (width, height), PLATE)
    result = subprocess.run(
        [*magick, "-background", "none", "-density", "192", str(logo), "png:-"],
        capture_output=True,
    )
    if result.returncode != 0 or not result.stdout:
        raise SystemExit(f"rendering {logo} failed:\n{result.stderr.decode(errors='replace')}")
    mark = Image.open(io.BytesIO(result.stdout)).convert("RGBA")
    target_w = 960
    mark = mark.resize((target_w, round(mark.height * target_w / mark.width)), Image.LANCZOS)
    canvas.alpha_composite(mark, ((width - mark.width) // 2, (height - mark.height) // 2))
    canvas.save(path, format="PNG", optimize=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-root", default=pathlib.Path(__file__).resolve().parents[2], type=pathlib.Path)
    args = parser.parse_args()
    root = args.repo_root
    vscode = root / "vscode"

    # Resolved before the first write: without a renderer the run would refresh
    # every icon and then stop, leaving both sharing images stale.
    magick = imagemagick()

    write_ico(vscode / "resources/win32/code.ico")
    print("wrote", vscode / "resources/win32/code.ico")
    write_png(vscode / "resources/win32/code_70x70.png", 70)
    write_png(vscode / "resources/win32/code_150x150.png", 150)
    print("wrote the two Windows PNG windows")
    write_icns(vscode / "resources/darwin/code.icns")
    print("wrote", vscode / "resources/darwin/code.icns")
    write_png(vscode / "resources/linux/code.png", 512)
    print("wrote", vscode / "resources/linux/code.png")
    write_browser_icons(vscode / "resources/server")
    print("wrote the web workbench icons (favicon.ico, code-192, code-512)")
    write_png(vscode / "extensions/picket-remote-wsl/resources/icon.png", 128)
    print("wrote the extension icon")
    write_og_image(root / "website/public/og-image.png", root / "website/public/logo.svg", magick)
    print("wrote", root / "website/public/og-image.png")
    # VitePress serves docs/public, so the site needs its own byte-identical copy.
    (root / "website/docs/public/og-image.png").write_bytes((root / "website/public/og-image.png").read_bytes())
    print("wrote", root / "website/docs/public/og-image.png")


if __name__ == "__main__":
    main()
