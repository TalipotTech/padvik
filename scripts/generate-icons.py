"""
Generate all icon/logo variants from the source Padvik logo.
Usage: python scripts/generate-icons.py
"""
import os
from PIL import Image, ImageDraw

PROJECT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(PROJECT, "public", "padvik_logo_1 (1748 x 2480 px).png")
ICONS_DIR = os.path.join(PROJECT, "public", "icons")
PUBLIC = os.path.join(PROJECT, "public")
APP_DIR = os.path.join(PROJECT, "src", "app")

BRAND_COLOR = (124, 58, 237)  # #7C3AED violet-600

os.makedirs(ICONS_DIR, exist_ok=True)

print(f"Loading source: {SRC}")
src = Image.open(SRC).convert("RGBA")
W, H = src.size  # 1748 x 2480
print(f"Source size: {W}x{H}")

# --Crop regions ──
# The PV monogram is roughly in the center-upper area
# Looking at the image: monogram is approx 35-65% width, 25-55% height
mono_left = int(W * 0.22)
mono_top = int(H * 0.28)
mono_right = int(W * 0.78)
mono_bottom = int(H * 0.55)
monogram = src.crop((mono_left, mono_top, mono_right, mono_bottom))

# Make it square (center crop)
mw, mh = monogram.size
if mw > mh:
    offset = (mw - mh) // 2
    monogram = monogram.crop((offset, 0, offset + mh, mh))
elif mh > mw:
    offset = (mh - mw) // 2
    monogram = monogram.crop((0, offset, mw, offset + mw))

print(f"Monogram crop: {monogram.size}")

# Full logo with text (the entire logo area)
logo_top = int(H * 0.25)
logo_bottom = int(H * 0.72)
full_logo = src.crop((0, logo_top, W, logo_bottom))
print(f"Full logo crop: {full_logo.size}")


def save_resized(img, size, path):
    """Resize with high-quality lanczos and save."""
    resized = img.resize((size, size), Image.LANCZOS)
    # Flatten to white background for PNG icons
    if resized.mode == "RGBA":
        bg = Image.new("RGBA", resized.size, (255, 255, 255, 255))
        bg.paste(resized, mask=resized)
        resized = bg.convert("RGB")
    resized.save(path, "PNG", optimize=True)
    print(f"  Saved: {os.path.basename(path)} ({size}x{size})")


def save_resized_rgba(img, size, path):
    """Resize preserving transparency."""
    resized = img.resize((size, size), Image.LANCZOS)
    resized.save(path, "PNG", optimize=True)
    print(f"  Saved: {os.path.basename(path)} ({size}x{size})")


# --PWA icons (white bg, square monogram) ──
print("\n--PWA Icons --")
pwa_sizes = [72, 96, 128, 144, 152, 192, 384, 512]
for s in pwa_sizes:
    save_resized(monogram, s, os.path.join(ICONS_DIR, f"icon-{s}x{s}.png"))

# Also generate icon-32x32 and icon-16x16 for browser tabs
save_resized(monogram, 32, os.path.join(ICONS_DIR, "icon-32x32.png"))
save_resized(monogram, 16, os.path.join(ICONS_DIR, "icon-16x16.png"))

# --Maskable icon (monogram on purple bg with safe zone) ──
print("\n--Maskable Icon --")
mask_size = 512
safe_zone = 0.2  # 20% padding for safe zone
inner = int(mask_size * (1 - 2 * safe_zone))
mask_bg = Image.new("RGB", (mask_size, mask_size), BRAND_COLOR)

# Resize monogram to fit safe zone (preserving transparency for compositing)
mono_rgba = monogram.resize((inner, inner), Image.LANCZOS)
offset_x = (mask_size - inner) // 2
offset_y = (mask_size - inner) // 2
if mono_rgba.mode == "RGBA":
    mask_bg.paste(mono_rgba, (offset_x, offset_y), mono_rgba)
else:
    mask_bg.paste(mono_rgba, (offset_x, offset_y))
mask_bg.save(os.path.join(ICONS_DIR, "maskable-icon-512x512.png"), "PNG", optimize=True)
print(f"  Saved: maskable-icon-512x512.png (512x512)")

# --Favicon.ico (multi-size) ──
print("\n--Favicon --")
favicon_sizes = [16, 32, 48]
favicon_imgs = []
for s in favicon_sizes:
    img = monogram.resize((s, s), Image.LANCZOS)
    # Keep as RGBA — Next.js requires RGBA PNGs inside ICO
    if img.mode != "RGBA":
        img = img.convert("RGBA")
    favicon_imgs.append(img)

favicon_path = os.path.join(APP_DIR, "favicon.ico")
favicon_imgs[0].save(
    favicon_path,
    format="ICO",
    sizes=[(s, s) for s in favicon_sizes],
    append_images=favicon_imgs[1:],
)
print(f"  Saved: src/app/favicon.ico ({', '.join(str(s) for s in favicon_sizes)})")

# --Apple touch icon ──
print("\n--Apple Touch Icon --")
save_resized(monogram, 180, os.path.join(PUBLIC, "apple-touch-icon.png"))

# --OG image (1200x630, logo centered on purple gradient) ──
print("\n--OG Image --")
og_w, og_h = 1200, 630
og = Image.new("RGB", (og_w, og_h), BRAND_COLOR)

# Simple gradient effect - darken bottom half slightly
draw = ImageDraw.Draw(og)
for y in range(og_h):
    factor = 1.0 - (y / og_h) * 0.3
    r = int(BRAND_COLOR[0] * factor)
    g = int(BRAND_COLOR[1] * factor)
    b = int(BRAND_COLOR[2] * factor)
    draw.line([(0, y), (og_w, y)], fill=(r, g, b))

# Paste full logo centered
logo_for_og = full_logo.copy()
# Scale to fit (max 800px wide, keeping aspect ratio)
lw, lh = logo_for_og.size
target_w = 700
scale = target_w / lw
target_h = int(lh * scale)
logo_for_og = logo_for_og.resize((target_w, target_h), Image.LANCZOS)

paste_x = (og_w - target_w) // 2
paste_y = (og_h - target_h) // 2
if logo_for_og.mode == "RGBA":
    og.paste(logo_for_og, (paste_x, paste_y), logo_for_og)
else:
    og.paste(logo_for_og, (paste_x, paste_y))
og.save(os.path.join(PUBLIC, "og-image.png"), "PNG", optimize=True)
print(f"  Saved: og-image.png (1200x630)")

# --In-app logos ──
print("\n--In-app Logos --")

# logo.png — full logo with text, 400px wide
full_w, full_h = full_logo.size
target_w = 400
scale = target_w / full_w
target_h = int(full_h * scale)
logo_full = full_logo.resize((target_w, target_h), Image.LANCZOS)
logo_full.save(os.path.join(PUBLIC, "logo.png"), "PNG", optimize=True)
print(f"  Saved: logo.png ({target_w}x{target_h})")

# logo-icon.png — just the PV monogram, transparent bg, 200x200
save_resized_rgba(monogram, 200, os.path.join(PUBLIC, "logo-icon.png"))

print("\nOK: All icons generated successfully!")
print(f"   PWA icons: {len(pwa_sizes) + 2} files in public/icons/")
print(f"   Maskable: 1 file")
print(f"   Favicon: src/app/favicon.ico")
print(f"   Apple touch: public/apple-touch-icon.png")
print(f"   OG image: public/og-image.png")
print(f"   App logos: public/logo.png, public/logo-icon.png")
