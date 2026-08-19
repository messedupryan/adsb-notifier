import math
import os
import struct
import time
import zlib
from hashlib import sha256
from io import BytesIO
from dataclasses import dataclass
from pathlib import Path
from urllib.request import Request, urlopen

from adsb_notifier.version import __version__
from adsb_notifier.models import Sighting

MAP_SNAPSHOT_CID = "adsb-notifier-map-snapshot"
MAP_SNAPSHOT_SIZE_PX = 640
MAP_SNAPSHOT_MARGIN_PX = 54
MILES_PER_LATITUDE_DEGREE = 69.0
TILE_SIZE_PX = 256
MILE_METERS = 1609.344
EARTH_CIRCUMFERENCE_METERS = 40075016.68557849
WEB_MERCATOR_MAX_LAT = 85.05112878
DEFAULT_TILE_URL_TEMPLATE = "https://tile.openstreetmap.org/{z}/{x}/{y}.png"
DEFAULT_TILE_CACHE_DIR = "/tmp/adsb-notifier-map-tiles"
DEFAULT_BASE_MAP_CACHE_DIR = "/tmp/adsb-notifier-map-snapshots"
DEFAULT_BASE_MAP_CACHE_SECONDS = 86400
DEFAULT_TILE_TIMEOUT_SECONDS = 10
RADIUS_FILL_ALPHA = 128
MAP_TINT_ALPHA = 32
MIN_TILE_ZOOM = 3
MAX_TILE_ZOOM = 18
USER_AGENT = f"adsb-notifier/{__version__} (+https://github.com/messedUpRyan/adsb-notifier)"


@dataclass(frozen=True)
class SnapshotTheme:
    background: tuple[int, int, int]
    grid: tuple[int, int, int]
    radius: tuple[int, int, int]
    home: tuple[int, int, int]
    aircraft: tuple[int, int, int]


SNAPSHOT_THEMES = {
    "amber": SnapshotTheme(
        background=(31, 23, 14),
        grid=(121, 81, 26),
        radius=(255, 177, 42),
        home=(255, 230, 139),
        aircraft=(255, 89, 39),
    ),
    "blue": SnapshotTheme(
        background=(12, 24, 39),
        grid=(40, 91, 141),
        radius=(67, 181, 255),
        home=(159, 219, 255),
        aircraft=(255, 94, 106),
    ),
    "rose": SnapshotTheme(
        background=(37, 17, 29),
        grid=(125, 45, 88),
        radius=(255, 104, 171),
        home=(255, 187, 216),
        aircraft=(111, 231, 183),
    ),
    "teal": SnapshotTheme(
        background=(12, 31, 32),
        grid=(25, 105, 105),
        radius=(45, 212, 191),
        home=(199, 255, 244),
        aircraft=(255, 89, 94),
    ),
    "violet": SnapshotTheme(
        background=(27, 21, 45),
        grid=(86, 62, 151),
        radius=(177, 132, 255),
        home=(230, 218, 255),
        aircraft=(255, 118, 99),
    ),
}


def can_render_snapshot(sighting: Sighting) -> bool:
    plane = sighting.aircraft
    return (
        plane.lat is not None
        and plane.lon is not None
        and sighting.home_lat is not None
        and sighting.home_lon is not None
        and sighting.rule_radius_miles is not None
        and sighting.rule_radius_miles > 0
    )


def render_alert_snapshot(
    sighting: Sighting,
    theme_name: str = "teal",
    tile_url_template: str = DEFAULT_TILE_URL_TEMPLATE,
) -> bytes:
    if not can_render_snapshot(sighting):
        raise ValueError("sighting does not include enough location context for a snapshot")

    theme = SNAPSHOT_THEMES.get(theme_name, SNAPSHOT_THEMES["teal"])
    if tile_url_template:
        try:
            return _render_tile_snapshot(sighting, theme, tile_url_template)
        except Exception:
            pass

    return _render_radar_snapshot(sighting, theme)


@dataclass(frozen=True)
class SnapshotViewport:
    home_lat: float
    home_lon: float
    radius_miles: float
    zoom: int
    render_scale: float
    crop_left: float
    crop_top: float
    crop_right: float
    crop_bottom: float
    radius_px: int
    center: int = MAP_SNAPSHOT_SIZE_PX // 2


def _render_tile_snapshot(sighting: Sighting, theme: SnapshotTheme, tile_url_template: str) -> bytes:
    from PIL import Image

    viewport = _snapshot_viewport(sighting)
    base_image = _cached_base_map(viewport, tile_url_template)
    image = base_image.copy()
    _draw_base_overlay(image, theme, viewport.center, viewport.radius_px)
    aircraft_x, aircraft_y = _project_aircraft_on_tiles(
        sighting,
        viewport.zoom,
        viewport.crop_left,
        viewport.crop_top,
        viewport.render_scale,
    )
    _draw_aircraft_overlay(image, theme, viewport.center, aircraft_x, aircraft_y, sighting.aircraft.track_deg)
    output = BytesIO()
    image.save(output, format="PNG")
    return output.getvalue()


def _snapshot_viewport(sighting: Sighting) -> SnapshotViewport:
    center = MAP_SNAPSHOT_SIZE_PX // 2
    radius_px = center - MAP_SNAPSHOT_MARGIN_PX
    home_lat = float(sighting.home_lat or 0)
    home_lon = float(sighting.home_lon or 0)
    radius_miles = max(float(sighting.rule_radius_miles or 1), 0.1)
    rule_radius_meters = radius_miles * MILE_METERS
    zoom_float = math.log2(
        radius_px * math.cos(math.radians(home_lat)) * EARTH_CIRCUMFERENCE_METERS / (rule_radius_meters * TILE_SIZE_PX)
    )
    zoom = max(MIN_TILE_ZOOM, min(MAX_TILE_ZOOM, math.ceil(zoom_float)))
    render_scale = 2 ** (zoom_float - zoom)
    source_half_size = center / render_scale
    home_world_x, home_world_y = _lat_lon_to_world_pixels(home_lat, home_lon, zoom)
    crop_left = home_world_x - source_half_size
    crop_top = home_world_y - source_half_size
    crop_right = home_world_x + source_half_size
    crop_bottom = home_world_y + source_half_size
    return SnapshotViewport(
        home_lat=home_lat,
        home_lon=home_lon,
        radius_miles=radius_miles,
        zoom=zoom,
        render_scale=render_scale,
        crop_left=crop_left,
        crop_top=crop_top,
        crop_right=crop_right,
        crop_bottom=crop_bottom,
        radius_px=radius_px,
    )


def _cached_base_map(viewport: SnapshotViewport, tile_url_template: str) -> "Image.Image":
    from PIL import Image

    cache_path = _base_map_cache_path(viewport, tile_url_template)
    if _cache_file_is_fresh(cache_path, _base_map_cache_seconds()):
        return Image.open(cache_path).convert("RGBA")

    image = _render_base_map(viewport, tile_url_template)
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    image.save(cache_path, format="PNG")
    return image.copy()


def _render_base_map(viewport: SnapshotViewport, tile_url_template: str) -> "Image.Image":
    from PIL import Image

    tile_canvas = _compose_tiles(
        tile_url_template,
        viewport.zoom,
        viewport.crop_left,
        viewport.crop_top,
        viewport.crop_right,
        viewport.crop_bottom,
    )
    crop = tile_canvas.crop(
        _tile_canvas_crop_box(viewport.crop_left, viewport.crop_top, viewport.crop_right, viewport.crop_bottom)
    )
    return crop.resize((MAP_SNAPSHOT_SIZE_PX, MAP_SNAPSHOT_SIZE_PX), Image.Resampling.LANCZOS).convert("RGBA")


def _render_radar_snapshot(sighting: Sighting, theme: SnapshotTheme) -> bytes:
    image = _Image(MAP_SNAPSHOT_SIZE_PX, MAP_SNAPSHOT_SIZE_PX, (*theme.background, 255))
    center = MAP_SNAPSHOT_SIZE_PX // 2
    # The alert radius is the scale anchor: it fills the square with a small
    # margin so the home point and edge-of-radius aircraft remain visible.
    scale = (center - MAP_SNAPSHOT_MARGIN_PX) / max(float(sighting.rule_radius_miles or 1), 0.1)
    aircraft_x, aircraft_y = _project_aircraft(sighting, center, scale)
    radius_px = int(round(float(sighting.rule_radius_miles or 1) * scale))

    _draw_grid(image, center, radius_px, theme)
    image.circle(center, center, radius_px, (*theme.radius, 80), fill=True)
    image.circle(center, center, radius_px, (*theme.radius, 235), fill=False, width=3)
    image.line(center, center, aircraft_x, aircraft_y, (*theme.radius, 210), width=3)
    _draw_track_arrow(image, aircraft_x, aircraft_y, sighting.aircraft.track_deg, theme.aircraft)
    image.circle(center, center, 9, (*theme.home, 255), fill=True)
    image.circle(center, center, 14, (*theme.home, 160), fill=False, width=3)
    image.circle(aircraft_x, aircraft_y, 11, (*theme.aircraft, 255), fill=True)
    image.circle(aircraft_x, aircraft_y, 17, (*theme.aircraft, 150), fill=False, width=3)
    return image.png()


def _compose_tiles(
    tile_url_template: str,
    zoom: int,
    crop_left: float,
    crop_top: float,
    crop_right: float,
    crop_bottom: float,
) -> "Image.Image":
    from PIL import Image

    first_tile_x = math.floor(crop_left / TILE_SIZE_PX)
    first_tile_y = math.floor(crop_top / TILE_SIZE_PX)
    last_tile_x = math.floor((crop_right - 1) / TILE_SIZE_PX)
    last_tile_y = math.floor((crop_bottom - 1) / TILE_SIZE_PX)
    canvas = Image.new(
        "RGB",
        ((last_tile_x - first_tile_x + 1) * TILE_SIZE_PX, (last_tile_y - first_tile_y + 1) * TILE_SIZE_PX),
        (240, 240, 236),
    )
    tile_count = 2**zoom
    for tile_x in range(first_tile_x, last_tile_x + 1):
        for tile_y in range(first_tile_y, last_tile_y + 1):
            if tile_y < 0 or tile_y >= tile_count:
                continue
            image = _fetch_tile(tile_url_template, zoom, tile_x % tile_count, tile_y)
            canvas.paste(image, ((tile_x - first_tile_x) * TILE_SIZE_PX, (tile_y - first_tile_y) * TILE_SIZE_PX))
    return canvas


def _tile_canvas_crop_box(crop_left: float, crop_top: float, crop_right: float, crop_bottom: float) -> tuple[int, int, int, int]:
    first_tile_x = math.floor(crop_left / TILE_SIZE_PX)
    first_tile_y = math.floor(crop_top / TILE_SIZE_PX)
    origin_x = first_tile_x * TILE_SIZE_PX
    origin_y = first_tile_y * TILE_SIZE_PX
    return (
        int(round(crop_left - origin_x)),
        int(round(crop_top - origin_y)),
        int(round(crop_right - origin_x)),
        int(round(crop_bottom - origin_y)),
    )


def _fetch_tile(tile_url_template: str, zoom: int, tile_x: int, tile_y: int) -> "Image.Image":
    from PIL import Image

    cache_path = _tile_cache_path(zoom, tile_x, tile_y)
    if cache_path.exists():
        return Image.open(cache_path).convert("RGB")

    request = Request(
        tile_url_template.format(z=zoom, x=tile_x, y=tile_y),
        headers={"User-Agent": USER_AGENT},
    )
    with urlopen(request, timeout=DEFAULT_TILE_TIMEOUT_SECONDS) as response:
        data = response.read()

    cache_path.parent.mkdir(parents=True, exist_ok=True)
    cache_path.write_bytes(data)
    return Image.open(BytesIO(data)).convert("RGB")


def _tile_cache_path(zoom: int, tile_x: int, tile_y: int) -> Path:
    return Path(os.environ.get("ADSB_MAP_TILE_CACHE_DIR", DEFAULT_TILE_CACHE_DIR)) / str(zoom) / str(tile_x) / f"{tile_y}.png"


def _base_map_cache_path(viewport: SnapshotViewport, tile_url_template: str) -> Path:
    key = "|".join(
        [
            tile_url_template,
            f"{viewport.home_lat:.5f}",
            f"{viewport.home_lon:.5f}",
            f"{viewport.radius_miles:.2f}",
            str(viewport.zoom),
        ]
    )
    digest = sha256(key.encode("utf-8")).hexdigest()
    label = f"z{viewport.zoom}-r{viewport.radius_miles:.2f}-{digest[:16]}.png"
    return Path(os.environ.get("ADSB_MAP_SNAPSHOT_CACHE_DIR", DEFAULT_BASE_MAP_CACHE_DIR)) / label


def _base_map_cache_seconds() -> int:
    try:
        return max(0, int(os.environ.get("ADSB_MAP_SNAPSHOT_CACHE_SECONDS", DEFAULT_BASE_MAP_CACHE_SECONDS)))
    except ValueError:
        return DEFAULT_BASE_MAP_CACHE_SECONDS


def _cache_file_is_fresh(path: Path, ttl_seconds: int) -> bool:
    return ttl_seconds > 0 and path.exists() and time.time() - path.stat().st_mtime <= ttl_seconds


def _lat_lon_to_world_pixels(lat: float, lon: float, zoom: int) -> tuple[float, float]:
    lat = max(-WEB_MERCATOR_MAX_LAT, min(WEB_MERCATOR_MAX_LAT, lat))
    world_size = TILE_SIZE_PX * (2**zoom)
    sin_lat = math.sin(math.radians(lat))
    x = (lon + 180.0) / 360.0 * world_size
    y = (0.5 - math.log((1 + sin_lat) / (1 - sin_lat)) / (4 * math.pi)) * world_size
    return x, y


def _project_aircraft_on_tiles(
    sighting: Sighting,
    zoom: int,
    crop_left: float,
    crop_top: float,
    render_scale: float,
) -> tuple[int, int]:
    plane = sighting.aircraft
    aircraft_world_x, aircraft_world_y = _lat_lon_to_world_pixels(float(plane.lat or 0), float(plane.lon or 0), zoom)
    return int(round((aircraft_world_x - crop_left) * render_scale)), int(round((aircraft_world_y - crop_top) * render_scale))


def _draw_base_overlay(
    image: "Image.Image",
    theme: SnapshotTheme,
    center: int,
    radius_px: int,
) -> None:
    from PIL import Image, ImageDraw

    overlay = Image.new("RGBA", image.size, (*theme.background, MAP_TINT_ALPHA))
    image.alpha_composite(overlay)
    draw = ImageDraw.Draw(image, "RGBA")
    for offset in range(-radius_px, radius_px + 1, max(radius_px // 4, 1)):
        draw.line((center - radius_px, center + offset, center + radius_px, center + offset), fill=(*theme.grid, 95), width=1)
        draw.line((center + offset, center - radius_px, center + offset, center + radius_px), fill=(*theme.grid, 95), width=1)
    # Draw translucent radius fill on a separate layer so it blends with the
    # map underneath instead of replacing map pixels in some email clients.
    radius_overlay = Image.new("RGBA", image.size, (0, 0, 0, 0))
    radius_draw = ImageDraw.Draw(radius_overlay, "RGBA")
    radius_draw.ellipse(_circle_box(center, center, radius_px), fill=(*theme.radius, RADIUS_FILL_ALPHA))
    image.alpha_composite(radius_overlay)
    draw.ellipse(_circle_box(center, center, radius_px), outline=(*theme.radius, 235), width=4)
    draw.ellipse(_circle_box(center, center, radius_px // 2), outline=(*theme.radius, 120), width=2)
    draw.line((center - radius_px, center, center + radius_px, center), fill=(*theme.radius, 175), width=2)
    draw.line((center, center - radius_px, center, center + radius_px), fill=(*theme.radius, 175), width=2)
    draw.ellipse(_circle_box(center, center, 10), fill=(*theme.home, 255), outline=(44, 42, 60, 255), width=2)
    _draw_attribution(draw, image.size[0], image.size[1])


def _draw_aircraft_overlay(
    image: "Image.Image",
    theme: SnapshotTheme,
    center: int,
    aircraft_x: int,
    aircraft_y: int,
    track_deg: float | None,
) -> None:
    from PIL import ImageDraw

    draw = ImageDraw.Draw(image, "RGBA")
    draw.line((center, center, aircraft_x, aircraft_y), fill=(*theme.radius, 220), width=3)
    _draw_pillow_track_arrow(draw, aircraft_x, aircraft_y, track_deg, theme.aircraft)
    draw.ellipse(_circle_box(aircraft_x, aircraft_y, 12), fill=(*theme.aircraft, 255), outline=(44, 42, 60, 255), width=2)


def _draw_pillow_track_arrow(draw: "ImageDraw.ImageDraw", x: int, y: int, track_deg: float | None, color: tuple[int, int, int]) -> None:
    if track_deg is None:
        return
    angle = math.radians(track_deg)
    tip_x = int(round(x + math.sin(angle) * 34))
    tip_y = int(round(y - math.cos(angle) * 34))
    draw.line((x, y, tip_x, tip_y), fill=(*color, 255), width=5)
    for wing_angle in (angle + math.radians(145), angle - math.radians(145)):
        wing_x = int(round(tip_x + math.sin(wing_angle) * 12))
        wing_y = int(round(tip_y - math.cos(wing_angle) * 12))
        draw.line((tip_x, tip_y, wing_x, wing_y), fill=(*color, 255), width=4)


def _draw_attribution(draw: "ImageDraw.ImageDraw", width: int, height: int) -> None:
    text = "© OpenStreetMap contributors"
    box = (width - 176, height - 22, width - 6, height - 6)
    draw.rounded_rectangle(box, radius=4, fill=(255, 255, 255, 190))
    draw.text((box[0] + 6, box[1] + 3), text, fill=(24, 31, 42, 230))


def _circle_box(cx: int, cy: int, radius: int) -> tuple[int, int, int, int]:
    return (cx - radius, cy - radius, cx + radius, cy + radius)


def _project_aircraft(sighting: Sighting, center: int, scale: float) -> tuple[int, int]:
    plane = sighting.aircraft
    lat_scale = MILES_PER_LATITUDE_DEGREE
    lon_scale = lat_scale * math.cos(math.radians(float(sighting.home_lat or 0)))
    north_miles = (float(plane.lat or 0) - float(sighting.home_lat or 0)) * lat_scale
    east_miles = (float(plane.lon or 0) - float(sighting.home_lon or 0)) * lon_scale
    return int(round(center + east_miles * scale)), int(round(center - north_miles * scale))


def _draw_grid(image: "_Image", center: int, radius_px: int, theme: SnapshotTheme) -> None:
    grid = (*theme.grid, 160)
    for offset in range(-radius_px, radius_px + 1, max(radius_px // 4, 1)):
        image.line(center - radius_px, center + offset, center + radius_px, center + offset, grid)
        image.line(center + offset, center - radius_px, center + offset, center + radius_px, grid)
    image.circle(center, center, radius_px // 2, grid, fill=False, width=2)
    image.line(center - radius_px, center, center + radius_px, center, (*theme.grid, 210), width=2)
    image.line(center, center - radius_px, center, center + radius_px, (*theme.grid, 210), width=2)


def _draw_track_arrow(image: "_Image", x: int, y: int, track_deg: float | None, color: tuple[int, int, int]) -> None:
    if track_deg is None:
        return
    angle = math.radians(track_deg)
    tip_x = int(round(x + math.sin(angle) * 34))
    tip_y = int(round(y - math.cos(angle) * 34))
    image.line(x, y, tip_x, tip_y, (*color, 255), width=4)
    for wing_angle in (angle + math.radians(145), angle - math.radians(145)):
        wing_x = int(round(tip_x + math.sin(wing_angle) * 12))
        wing_y = int(round(tip_y - math.cos(wing_angle) * 12))
        image.line(tip_x, tip_y, wing_x, wing_y, (*color, 255), width=3)


class _Image:
    def __init__(self, width: int, height: int, color: tuple[int, int, int, int]):
        self.width = width
        self.height = height
        self.pixels = bytearray(color * width * height)

    def png(self) -> bytes:
        raw = bytearray()
        stride = self.width * 4
        for y in range(self.height):
            raw.append(0)
            raw.extend(self.pixels[y * stride : (y + 1) * stride])
        return (
            b"\x89PNG\r\n\x1a\n"
            + _chunk(b"IHDR", struct.pack(">IIBBBBB", self.width, self.height, 8, 6, 0, 0, 0))
            + _chunk(b"IDAT", zlib.compress(bytes(raw), 9))
            + _chunk(b"IEND", b"")
        )

    def pixel(self, x: int, y: int, color: tuple[int, int, int, int]) -> None:
        if x < 0 or y < 0 or x >= self.width or y >= self.height:
            return
        offset = (y * self.width + x) * 4
        alpha = color[3] / 255
        inv_alpha = 1 - alpha
        self.pixels[offset] = round(color[0] * alpha + self.pixels[offset] * inv_alpha)
        self.pixels[offset + 1] = round(color[1] * alpha + self.pixels[offset + 1] * inv_alpha)
        self.pixels[offset + 2] = round(color[2] * alpha + self.pixels[offset + 2] * inv_alpha)
        self.pixels[offset + 3] = 255

    def line(self, x1: int, y1: int, x2: int, y2: int, color: tuple[int, int, int, int], width: int = 1) -> None:
        dx = abs(x2 - x1)
        dy = -abs(y2 - y1)
        sx = 1 if x1 < x2 else -1
        sy = 1 if y1 < y2 else -1
        err = dx + dy
        while True:
            self.circle(x1, y1, max(width // 2, 0), color, fill=True)
            if x1 == x2 and y1 == y2:
                return
            step = 2 * err
            if step >= dy:
                err += dy
                x1 += sx
            if step <= dx:
                err += dx
                y1 += sy

    def circle(self, cx: int, cy: int, radius: int, color: tuple[int, int, int, int], fill: bool, width: int = 1) -> None:
        if radius <= 0:
            self.pixel(cx, cy, color)
            return
        outer = radius * radius
        inner = max(radius - width, 0) * max(radius - width, 0)
        for y in range(cy - radius, cy + radius + 1):
            for x in range(cx - radius, cx + radius + 1):
                distance = (x - cx) * (x - cx) + (y - cy) * (y - cy)
                if distance <= outer and (fill or distance >= inner):
                    self.pixel(x, y, color)


def _chunk(kind: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)
