#!/usr/bin/env python3
"""Rebuild the wordmarks with the letters outlined.

The wordmarks used to place "Picket" and "Code" as two <text> runs at fixed x
coordinates, which only holds if the viewer has Geist: an <img> never loads the
font, so a fallback like DejaVu Sans Bold pushed "Picket" past x=470 and the two
words collided. Outlines take the font out of the equation.

Geist is OFL-1.1; fetch it from
https://cdn.jsdelivr.net/npm/geist@1.3.1/dist/fonts/geist-sans/Geist-Variable.ttf

Usage:
  uv run --with fonttools python build/brand/build-wordmark.py \\
      --font /tmp/Geist-Variable.ttf --out website/docs/public
"""
import argparse
import pathlib

from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

UPM = 1000.0
SIZE = 88.0
WEIGHT = 650
TRACKING = -3.0
BASELINE = 116
FIRST_X = 224  # emblem ends at x=158, ink starts ~39 units later, right margin ~20
GAP = 34  # between the two words, in user units
RIGHT_MARGIN = 742

EMBLEM = (
    'M0 0h58v40L40 58H0z M82 0h58v58h-40L82 40z '
    'M0 82h40l18 18v40H0z M100 82h40v58H82v-40z'
)
CORE = 'm70 54 16 16-16 16-16-16z'


class _Shifted:
    """Re-emit a pen's coordinates with an x offset so glyphs advance."""

    def __init__(self, pen, dx):
        self._pen = pen
        self._dx = dx

    def __getattr__(self, name):
        return getattr(self._pen, name)

    def addComponent(self, glyphName, transformation):
        # "i" is a composite (dotlessi + uni0307). SVGPathPen draws components
        # onto itself at the font origin, so without this the dot and stem of
        # the "i" land on the first letter instead of their own slot.
        a, b, c, d, e, f = transformation
        self._pen.addComponent(glyphName, (a, b, c, d, e + self._dx, f))

    def _pt(self, pt):
        return (pt[0] + self._dx, pt[1])

    def moveTo(self, pt):
        self._pen.moveTo(self._pt(pt))

    def lineTo(self, pt):
        self._pen.lineTo(self._pt(pt))

    def curveTo(self, *points):
        self._pen.curveTo(*[self._pt(p) for p in points])

    def qCurveTo(self, *points):
        self._pen.qCurveTo(*[self._pt(p) for p in points])

    def closePath(self):
        self._pen.closePath()


def outline(font, text):
    """Path data for `text` on the baseline, y up, in font units.

    Returns (paths, advance, ink_left, ink_right): the advance is what the next
    run must clear, the ink extent is what actually has to stay in the viewBox.
    """
    glyphset = font.getGlyphSet()
    cmap = font.getBestCmap()
    pen = SVGPathPen(glyphset)
    x = 0.0
    ink_left = ink_right = None
    for char in text:
        glyph = glyphset[cmap[ord(char)]]
        glyph.draw(_Shifted(pen, x))
        bounds_pen = BoundsPen(glyphset)
        glyph.draw(_Shifted(bounds_pen, x))
        if bounds_pen.bounds:
            left, _, right, _ = bounds_pen.bounds
            local_left, local_right = left - x, right - x
            if local_left < -1 or local_right > glyph.width + 100:
                raise SystemExit(
                    f"glyph {char!r} draws outside its own slot "
                    f"([{local_left:.0f}, {local_right:.0f}] vs advance {glyph.width}): "
                    "a component lost its offset"
                )
            ink_left = left if ink_left is None else min(ink_left, left)
            ink_right = right if ink_right is None else max(ink_right, right)
        x += glyph.width + TRACKING * UPM / SIZE
    return pen.getCommands(), x - TRACKING * UPM / SIZE, ink_left, ink_right


def wordmark(font, picket_fill, code_fill):
    picket, picket_width, _, picket_right = outline(font, "Picket")
    code, _, code_left, code_right = outline(font, "Code")

    scale = SIZE / UPM
    second_x = FIRST_X + picket_width * scale + GAP
    right = second_x + code_right * scale
    gap = second_x + code_left * scale - (FIRST_X + picket_right * scale)
    if right > RIGHT_MARGIN:
        raise SystemExit(f"wordmark ends at {right:.0f}, past the {RIGHT_MARGIN} margin")
    print(f"  gap between words {gap:.1f}, right margin {760 - right:.1f}")

    def run(path, x, fill):
        return (
            f'  <g transform="translate({x:.2f} {BASELINE}) '
            f'scale({scale:.5f} {-scale:.5f})">\n'
            f'    <path d="{path}" fill="{fill}"/>\n'
            f'  </g>'
        )

    return "\n".join([
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 760 180" role="img" '
        'aria-labelledby="title desc">',
        '  <title id="title">Picket Code</title>',
        '  <desc id="desc">Geometric engineering emblem and the Picket Code wordmark, '
        'outlined so it renders without the Geist font.</desc>',
        '  <g transform="translate(18 20)">',
        f'    <path d="{EMBLEM}" fill="{picket_fill}"/>',
        f'    <path d="{CORE}" fill="#19C6D8"/>',
        '  </g>',
        run(picket, FIRST_X, picket_fill),
        run(code, second_x, code_fill),
        '</svg>',
        '',
    ])


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--font", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()

    font = instantiateVariableFont(TTFont(args.font), {"wght": WEIGHT})
    out = pathlib.Path(args.out)
    # Deep background: white mark, cyan "Code". Light: navy mark, teal "Code".
    for name, svg in {
        "logo.svg": wordmark(font, "#F4F8FC", "#19C6D8"),
        "logo-light.svg": wordmark(font, "#10243A", "#007E8A"),
    }.items():
        (out / name).write_text(svg)
        print("wrote", out / name)


if __name__ == "__main__":
    main()
