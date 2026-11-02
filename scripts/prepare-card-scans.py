"""Make browser-sized surfaces from the paired flat scans; leave sources untouched.

Requires Pillow. Run with the local source directory as the first argument:
    python scripts/prepare-card-scans.py "../../Paired cards"

Outside spreads are back | front and inside spreads are left | right.
Card 07 is a single-sheet postcard. Card 14 folds across its horizontal centre.
"""
from __future__ import annotations

import io
import json
import re
import sys
from pathlib import Path

from PIL import Image, ImageCms, ImageOps, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
FINISH_ONLY = "--finish-only" in sys.argv[1:]
SOURCE = Path(next((arg for arg in sys.argv[1:] if arg != "--finish-only"), ROOT.parent.parent / "Paired cards")).resolve()
DEST = ROOT / "compatibility" / "assets" / "scans"
LONG_EDGE = 1800
PREVIEW_EDGE = 512
MANIFEST = []
CARDS = [
    (1, "Congratulations", "Congratulations"),
    (2, "Meeting zone", "A good wish"),
    (3, "Christmas moon", "Christmas"),
    (4, "Happy 30th birthday", "Birthday"),
    (5, "You are amazing", "Just because"),
    (6, "Happy holidays", "Christmas"),
    (7, "Newcastle postcard", "Postcard"),
    (8, "Festive wishes", "Christmas"),
    (9, "Winter wishes", "Christmas"),
    (10, "Jingle all the way", "Christmas"),
    (11, "Season’s greetings", "Christmas"),
    (12, "Christmas tree", "Christmas"),
    (13, "Penguin pair", "Christmas"),
    (14, "Polar bears", "Christmas"),
]


def millimetres(path: Path) -> tuple[float, float]:
    found = re.search(r"_(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)mm_", path.name)
    if not found:
        raise ValueError(f"No physical dimensions in {path.name}")
    return tuple(float(value) for value in found.groups())


def srgb(path: Path) -> Image.Image:
    with Image.open(path) as source:
        image = ImageOps.exif_transpose(source).convert("RGB")
        profile = source.info.get("icc_profile")
        if profile:
            image = ImageCms.profileToProfile(
                image, ImageCms.ImageCmsProfile(io.BytesIO(profile)),
                ImageCms.createProfile("sRGB"), outputMode="RGB",
            )
        # Derivatives carry no EXIF, scanner metadata or source profile.
        image.info.clear()
        return image


def export(image: Image.Image, number: int, face: str, width: float, height: float, preview: bool = False) -> str:
    factor = (PREVIEW_EDGE if preview else LONG_EDGE) / max(width, height)
    dimensions = (round(width * factor), round(height * factor))
    output = image.resize(dimensions, Image.Resampling.LANCZOS)
    filename = f"card-{number:02d}-{face}_{width:g}x{height:g}mm.webp"
    target = DEST / "previews" if preview else DEST
    output.save(target / filename, "WEBP", quality=85 if preview else 90, method=6)
    return f"assets/scans/{'previews/' if preview else ''}{filename}"


def export_gold_foil(image: Image.Image, width: float, height: float) -> str:
    """Mask card 03's gold sun only, without altering its scanned colour image.

    Linear material channels: green=roughness, blue=metalness. Outside the sun
    green stays white and blue black, preserving the matte navy/white printing.
    The broad region excludes scan-edge colour casts; warm colour selects the
    actual uneven foil boundary within it rather than imposing an ellipse.
    """
    factor = 1024 / max(width, height)
    size = (round(width * factor), round(height * factor))
    small = image.resize(size, Image.Resampling.LANCZOS)
    coverage = Image.new("L", size)
    def smooth(value: float) -> float:
        t = max(0.0, min(1.0, value))
        return t * t * (3 - 2 * t)
    values = []
    for y in range(size[1]):
        for x in range(size[0]):
            r, g, b = small.getpixel((x, y))
            if .35 <= x / size[0] <= .65 and .35 <= y / size[1] <= .53:
                amount = smooth((r - b - 28) / 36) * smooth((g - b - 14) / 28) * smooth((r - g - 3) / 14)
            else:
                amount = 0
            values.append(round(amount * 255))
    coverage.putdata(values)
    coverage = coverage.filter(ImageFilter.GaussianBlur(.6))
    roughness = coverage.point(lambda value: round(255 - value * .64))
    output = Image.merge("RGB", (Image.new("L", size, 255), roughness, coverage))
    filename = f"card-03-front-foil_{width:g}x{height:g}mm.png"
    output.save(DEST / filename, "PNG", optimize=True)
    return f"assets/scans/{filename}"


def prepare(number: int, title: str, occasion: str) -> dict:
    folder = SOURCE / f"Card_{number:02d}"
    outside_path, = folder.glob("1_Outside_*.jpg")
    inside_path, = folder.glob("2_Inside_*.jpg")
    flat_width, flat_height = millimetres(outside_path)
    outside, inside = srgb(outside_path), srgb(inside_path)
    if number == 7:
        kind, axis = "postcard", "none"
        width, height = flat_width, flat_height
        faces = {"front": outside, "back": inside}
        sources = {"front": (outside_path.name, [0, 0, *outside.size], 0),
                   "back": (inside_path.name, [0, 0, *inside.size], 0)}
    elif number == 14:
        kind, axis = "folded", "horizontal"
        width, height = flat_width, flat_height / 2
        ow, oh = outside.size
        iw, ih = inside.size
        faces = {
            "front": outside.crop((0, oh // 2, ow, oh)),
            "back": outside.crop((0, 0, ow, oh // 2)).rotate(180),
            "insideLeft": inside.crop((0, 0, iw, ih // 2)).rotate(180),
            "insideRight": inside.crop((0, ih // 2, iw, ih)),
        }
        sources = {
            "front": (outside_path.name, [0, oh // 2, ow, oh], 0),
            "back": (outside_path.name, [0, 0, ow, oh // 2], 180),
            "insideLeft": (inside_path.name, [0, 0, iw, ih // 2], 180),
            "insideRight": (inside_path.name, [0, ih // 2, iw, ih], 0),
        }
    else:
        kind, axis = "folded", "vertical"
        width, height = flat_width / 2, flat_height
        ow, oh = outside.size
        iw, ih = inside.size
        faces = {
            "front": outside.crop((ow // 2, 0, ow, oh)),
            "back": outside.crop((0, 0, ow // 2, oh)),
            "insideLeft": inside.crop((0, 0, iw // 2, ih)),
            "insideRight": inside.crop((iw // 2, 0, iw, ih)),
        }
        sources = {
            "front": (outside_path.name, [ow // 2, 0, ow, oh], 0),
            "back": (outside_path.name, [0, 0, ow // 2, oh], 0),
            "insideLeft": (inside_path.name, [0, 0, iw // 2, ih], 0),
            "insideRight": (inside_path.name, [iw // 2, 0, iw, ih], 0),
        }
    names = {"insideLeft": "inside-left", "insideRight": "inside-right"}
    record = {
        "id": f"card-{number:02d}", "number": number, "scanNumber": f"{number:02d}",
        "title": f"{number:02d} · {title}", "occasion": occasion,
        "type": kind, "foldAxis": axis, "width": width, "height": height,
        "paper": "#fffdf6",
        "scanSize": {"width": flat_width, "height": flat_height, "unit": "mm"},
        "scanSources": {"outside": outside_path.name, "inside": inside_path.name},
        "surfaces": {face: export(image, number, names.get(face, face), width, height)
                     for face, image in faces.items()},
        "previewSurfaces": {face: export(image, number, names.get(face, face), width, height, preview=True)
                            for face, image in faces.items()},
    }
    if number == 4:
        record["finish"] = "metallic-outside"
    if number == 3:
        record["finish"] = "gold-foil"
        record["finishMaps"] = {"front": export_gold_foil(faces["front"], width, height)}
    MANIFEST.append({
        "id": record["id"], "scanNumber": record["scanNumber"], "sourceFolder": folder.name,
        "type": kind, "foldAxis": axis, "closedSizeMm": [width, height],
        "outsideSizeMm": [flat_width, flat_height],
        "insideSizeMm": list(millimetres(inside_path)),
        **({"finish": record["finish"], "finishMaps": record["finishMaps"]} if number == 3 else {}),
        "surfaces": {face: {
            "source": sources[face][0], "cropPixels": sources[face][1],
            "rotationDegrees": sources[face][2],
            "full": record["surfaces"][face], "preview": record["previewSurfaces"][face],
        } for face in faces},
    })
    return record


def write_catalog(records: list) -> None:
    (ROOT / "compatibility" / "cards.js").write_text(
        "// Browser-sized surfaces derived from the user's paired flat scans.\n"
        "// width/height are the closed card's physical millimetres, not the flat spread.\n"
        "// Card 07 is a postcard; card 14 has a horizontal fold.\n"
        "// Rebuild with scripts/prepare-card-scans.py; original scans stay outside this repository.\n"
        "export const cards = " + json.dumps(records, ensure_ascii=False, indent=2) + ";\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    DEST.mkdir(parents=True, exist_ok=True)
    (DEST / "previews").mkdir(exist_ok=True)
    if FINISH_ONLY:
        # Rebuild only the new material data; every existing scan derivative is
        # left byte-for-byte unchanged, avoiding needless resampling/encoding.
        catalog = (ROOT / "compatibility" / "cards.js").read_text(encoding="utf-8")
        records = json.loads(catalog.split("export const cards = ", 1)[1].strip().removesuffix(";"))
        record = next(card for card in records if card["number"] == 3)
        outside_path, = (SOURCE / "Card_03").glob("1_Outside_*.jpg")
        outside = srgb(outside_path)
        ow, oh = outside.size
        record["finish"] = "gold-foil"
        record["finishMaps"] = {"front": export_gold_foil(outside.crop((ow // 2, 0, ow, oh)), record["width"], record["height"])}
        manifest = json.loads((DEST / "manifest.json").read_text(encoding="utf-8"))
        entry = next(card for card in manifest["cards"] if card["id"] == record["id"])
        entry.update({"finish": record["finish"], "finishMaps": record["finishMaps"]})
    else:
        records = [prepare(*card) for card in CARDS]
        manifest = {
            "formatVersion": 1, "codec": "WebP", "fullLongEdge": LONG_EDGE,
            "previewLongEdge": PREVIEW_EDGE, "fullQuality": 90, "previewQuality": 85,
            "colourSpace": "sRGB", "sourceMetadataIncluded": False,
            "cards": MANIFEST,
        }
    write_catalog(records)
    (DEST / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    files = list(DEST.rglob("*.webp"))
    print(f"Prepared {len(records)} cards / {len(files)} full and preview surfaces / {sum(p.stat().st_size for p in files):,} bytes, plus selective foil material data.")
