#!/usr/bin/env python3
"""Turn a top Global Newsflix story into a narrated vertical news Short (9:16, under a minute).

Open-source stack: Kokoro (natural female neural voice, Apache-2.0) with Piper as fallback,
Pillow (graphics and infographics), FFmpeg (motion, compositing, encoding).
Visuals: only photos and clips from news outlets that reported the story (one outlet's picture is enough;
pictures shared by several outlets rank first), with no outlet branding, watermark or added text. Each one is
checked by two AI models against the line being narrated. Credited as published by those outlets.
Output: out/video.mp4, out/thumbnail.png, out/meta.json
"""
import base64, hashlib, html, io, json, math, os, re, subprocess, sys, textwrap, urllib.error, urllib.parse, urllib.request, wave
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from article_media import article_image_urls, photo_request_headers, same_publisher_host, approved_photo_url
from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps

SITE = os.environ.get("SITE", "https://globalnewsflix.com")
VOICE = os.environ.get("KOKORO_VOICE", "af_heart")
# Vertical 9:16 for YouTube Shorts, Instagram and Facebook Reels and TikTok.
W, H, FPS = 1080, 1920, 30
BG_W, BG_H = 1296, 2304  # backgrounds are 20% larger than the frame so they can slowly zoom and pan
PHOTO_CY = 0.33  # where a photo's centre sits, as a share of the frame height (clear of the captions)
MAX_SECONDS = 58  # Shorts over a minute are blocked worldwide if anything in them gets a copyright claim
OUT = Path("out"); OUT.mkdir(exist_ok=True)
ASSETS = Path("assets"); ASSETS.mkdir(exist_ok=True)
UA = "GlobalNewsFlixVideoBot/1.0 (https://globalnewsflix.com/about)"
BRAND = "#e10d0f"
BRAND_DIR = Path(__file__).resolve().parent / "brand"
_logos = {}


def logo(name, height):
    key = (name, height)
    if key not in _logos:
        try:
            im = Image.open(BRAND_DIR / name).convert("RGBA")
            _logos[key] = im.resize((max(1, int(im.width * height / im.height)), height), Image.LANCZOS)
        except Exception:
            _logos[key] = None
    return _logos[key]
TONE = {"neutral": ("#5b8cff", "NEUTRAL VIEW"), "positive": ("#22c55e", "POSITIVE VIEW"), "negative": ("#f43f5e", "NEGATIVE VIEW")}


# ---------------------------------------------------------------- helpers
def fetch(url, dest=None, timeout=60, data=None, headers=None):
    req = urllib.request.Request(url, data=data, headers={"user-agent": UA, **(headers or {})})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        body = r.read()
    if dest:
        Path(dest).write_bytes(body)
    return body


def font(kind, size, weight="Bold"):
    files = {"sans": [ASSETS / "Inter.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"],
             "serif": [ASSETS / "SourceSerif.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf"]}[kind]
    for f in files:
        try:
            ft = ImageFont.truetype(str(f), size)
            try: ft.set_variation_by_name(weight)
            except Exception: pass
            return ft
        except Exception:
            continue
    return ImageFont.load_default()


def get_assets():
    items = {
        "Inter.ttf": "https://raw.githubusercontent.com/google/fonts/main/ofl/inter/Inter%5Bopsz,wght%5D.ttf",
        "SourceSerif.ttf": "https://raw.githubusercontent.com/google/fonts/main/ofl/sourceserif4/SourceSerif4%5Bopsz,wght%5D.ttf",
        "kokoro-v1.0.onnx": "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx",
        "voices-v1.0.bin": "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin",
    }
    for name, url in items.items():
        if not (ASSETS / name).exists():
            try: fetch(url, ASSETS / name, timeout=300)
            except Exception as e: print("asset download failed", name, e)


def oidc_token():
    u, t = os.environ.get("ACTIONS_ID_TOKEN_REQUEST_URL"), os.environ.get("ACTIONS_ID_TOKEN_REQUEST_TOKEN")
    if not u or not t: return None
    try: return json.loads(fetch(u + "&audience=globalnewsflix", headers={"authorization": "Bearer " + t}))["value"]
    except Exception as e:
        print("oidc failed", e); return None


def rgb(h): h = h.lstrip("#"); return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def sentences(text):
    parts = re.split(r'(?<=[.!?])\s+(?=[A-Z0-9"“‘(])', (text or "").strip())
    return [p.strip() for p in parts if p.strip()]


def duration(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)], capture_output=True, text=True).stdout
    return float(out.strip() or 3)


# ---------------------------------------------------------------- voice
_kokoro = None
def tts(text, path):
    """Natural female voice (Kokoro af_heart). Falls back to Piper (female) and finally silence."""
    global _kokoro
    try:
        import numpy as np, soundfile as sf
        if _kokoro is None:
            from kokoro_onnx import Kokoro
            _kokoro = Kokoro(str(ASSETS / "kokoro-v1.0.onnx"), str(ASSETS / "voices-v1.0.bin"))
        samples, sr = _kokoro.create(text, voice=VOICE, speed=1.0, lang="en-us")
        pad = np.zeros(int(sr * 0.22), dtype=samples.dtype)
        sf.write(str(path), np.concatenate([samples, pad]), sr)
        return duration(path)
    except Exception as e:
        print("kokoro failed:", e)
    model = ASSETS / "en_US-lessac-high.onnx"
    try:
        if not model.exists():
            base = "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/high/en_US-lessac-high"
            fetch(base + ".onnx", model, timeout=300); fetch(base + ".onnx.json", str(model) + ".json")
        r = subprocess.run([sys.executable, "-m", "piper", "-m", str(model), "-f", str(path)], input=text.encode(), capture_output=True)
        if r.returncode == 0: return duration(path)
    except Exception as e:
        print("piper failed:", e)
    secs = max(2.5, len(text.split()) / 2.6)
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "anullsrc=r=24000:cl=mono", "-t", f"{secs:.2f}", str(path)], check=True)
    return secs


def concat_wavs(paths, out):
    (OUT / "alist.txt").write_text("".join(f"file '{Path(p).resolve()}'\n" for p in paths))
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", str(OUT / "alist.txt"),
                    "-ar", "44100", "-ac", "2", str(out)], check=True)


# ---------------------------------------------------------------- images
ACCEPT = re.compile(r"CC0|Public domain|PD|CC BY(?!-NC|-ND)", re.I)
REJECT = re.compile(r"logo|map|flag|coat of arms|signature|diagram|chart|icon|seal|emblem|\.svg|\.tif|scan|document|letter", re.I)


def commons_search(query, want=1, landscape=True):
    url = "https://commons.wikimedia.org/w/api.php?" + urllib.parse.urlencode({
        "action": "query", "format": "json", "generator": "search", "gsrnamespace": 6, "gsrlimit": 15,
        "gsrsearch": f"{query} filetype:bitmap", "prop": "imageinfo", "iiprop": "url|size|mime|extmetadata", "iiurlwidth": 1920})
    try: data = json.loads(fetch(url, timeout=30))
    except Exception as e:
        print("commons failed", e); return []
    found = []
    pages = sorted((data.get("query") or {}).get("pages", {}).values(), key=lambda p: p.get("index", 99))
    for p in pages:
        ii = (p.get("imageinfo") or [{}])[0]
        meta = ii.get("extmetadata") or {}
        lic = re.sub("<[^>]+>", "", (meta.get("LicenseShortName") or {}).get("value", ""))
        if REJECT.search(p.get("title", "")) or not ACCEPT.search(lic): continue
        if ii.get("mime") not in ("image/jpeg", "image/png") or ii.get("width", 0) < 900: continue
        if landscape and ii.get("width", 0) < ii.get("height", 1) * 1.1: continue
        artist = re.sub(r"\s+", " ", re.sub("<[^>]+>", "", (meta.get("Artist") or {}).get("value", "Unknown"))).strip()[:60]
        dest = ASSETS.parent / OUT / f"img_{abs(hash(p['title'])) % 10**8}.jpg"
        try: fetch(ii.get("thumburl") or ii["url"], dest, timeout=60)
        except Exception: continue
        found.append({"path": str(dest), "credit": f"Photo: {artist} / {lic} via Wikimedia Commons", "kind": "photo"})
        if len(found) >= want: break
    return found


def pexels_photos(query, want=1):
    key = os.environ.get("PEXELS_API_KEY", "").strip()
    if not key: return []
    url = "https://api.pexels.com/v1/search?" + urllib.parse.urlencode({"query": query, "orientation": "landscape", "per_page": 6})
    try: data = json.loads(fetch(url, timeout=30, headers={"Authorization": key}))
    except Exception as e:
        print("pexels photos failed", e); return []
    out = []
    for ph in data.get("photos", []):
        dest = OUT / f"px_{ph['id']}.jpg"
        try: fetch(ph["src"].get("large2x") or ph["src"]["original"], dest, timeout=60)
        except Exception: continue
        out.append({"path": str(dest), "credit": f"Photo: {ph.get('photographer', 'Pexels')} / Pexels", "kind": "photo"})
        if len(out) >= want: break
    return out


def collect_images(art, need=5):
    """Real, licensed photos only: people and places from Wikimedia Commons, topical stock photos from Pexels."""
    imgs = []
    for person in (art.get("people") or [])[:2]:
        imgs += commons_search(f'"{person}"', 1, landscape=False)
    tags = (art.get("tags") or [])[:3]
    for t in tags:
        if len(imgs) >= need: break
        imgs += commons_search(f"{t} {art.get('country_name', '')}".strip(), 1) or commons_search(t, 1)
    cat = art.get("category") or "world"
    for t in [*tags, *STOCK_TERMS.get(cat, STOCK_TERMS["world"])]:
        if len(imgs) >= need: break
        imgs += pexels_photos(t, 1)
    if art.get("country") not in (None, "WW") and len(imgs) < need:
        imgs += commons_search(f"{art.get('country_name')} city", 2)
    return imgs[:need]


STOCK_TERMS = {
    "world": ["city aerial", "crowd street"], "politics": ["parliament building", "government flags"], "business": ["stock market screen", "city business district"],
    "technology": ["technology data center", "smartphone close up"], "science": ["laboratory research", "space stars"], "health": ["hospital corridor", "doctor"],
    "sports": ["stadium crowd", "football match"], "entertainment": ["concert lights", "cinema"], "celebrity": ["red carpet", "paparazzi cameras"],
    "climate": ["storm clouds", "forest aerial"], "lifestyle": ["people city walking", "coffee shop"], "crime": ["police lights night", "courthouse"],
}


def pexels_videos(query, want=1):
    key = os.environ.get("PEXELS_API_KEY", "").strip()
    if not key: return []
    url = "https://api.pexels.com/videos/search?" + urllib.parse.urlencode({"query": query, "orientation": "landscape", "size": "medium", "per_page": 8})
    try: data = json.loads(fetch(url, timeout=30, headers={"Authorization": key}))
    except Exception as e:
        print("pexels failed", e); return []
    out = []
    for v in data.get("videos", []):
        files = sorted([f for f in v.get("video_files", []) if f.get("file_type") == "video/mp4" and (f.get("width") or 0) >= 1280], key=lambda f: f["width"])
        if not files or v.get("duration", 0) < 5: continue
        dest = OUT / f"pexels_{v['id']}.mp4"
        try: fetch(files[0]["link"], dest, timeout=120)
        except Exception: continue
        out.append({"video": str(dest), "credit": f"Stock footage: {v.get('user', {}).get('name', 'Pexels')} / Pexels", "kind": "video"})
        if len(out) >= want: break
    return out


def commons_videos(query, want=1):
    url = "https://commons.wikimedia.org/w/api.php?" + urllib.parse.urlencode({
        "action": "query", "format": "json", "generator": "search", "gsrnamespace": 6, "gsrlimit": 12,
        "gsrsearch": f"{query} filetype:video", "prop": "videoinfo", "viprop": "url|size|mime|extmetadata|derivatives"})
    try: data = json.loads(fetch(url, timeout=30))
    except Exception as e:
        print("commons video failed", e); return []
    out = []
    for p in sorted((data.get("query") or {}).get("pages", {}).values(), key=lambda p: p.get("index", 99)):
        vi = (p.get("videoinfo") or [{}])[0]
        meta = vi.get("extmetadata") or {}
        lic = re.sub("<[^>]+>", "", (meta.get("LicenseShortName") or {}).get("value", ""))
        if not ACCEPT.search(lic) or REJECT.search(p.get("title", "")): continue
        words = [w.lower() for w in re.findall(r"\w+", query) if len(w) > 3]
        if words and not any(w in p.get("title", "").lower() for w in words): continue  # keep footage on-topic
        if vi.get("width", 0) < 1200 or vi.get("width", 0) < vi.get("height", 1) or not (6 <= float(vi.get("duration") or 0) <= 900): continue
        ders = sorted([d for d in vi.get("derivatives", []) if (d.get("width") or 0) >= 1200 and "webm" in d.get("type", "")], key=lambda d: d["width"])
        src = ders[0]["src"] if ders else (vi.get("url") if vi.get("size", 1e10) < 60e6 else None)
        if not src: continue
        raw = OUT / f"cv_{abs(hash(p['title'])) % 10**8}"
        clip = OUT / f"{raw.name}.mp4"
        try:
            fetch(src, raw, timeout=180)
            subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(raw), "-t", "20", "-an", "-vf", "scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,fps=30",
                            "-c:v", "libx264", "-preset", "veryfast", "-crf", "22", str(clip)], check=True, timeout=300)
        except Exception as e:
            print("commons clip failed", e); continue
        artist = re.sub(r"\s+", " ", re.sub("<[^>]+>", "", (meta.get("Artist") or {}).get("value", "Unknown"))).strip()[:60]
        out.append({"video": str(clip), "credit": f"Footage: {artist} / {lic} via Wikimedia Commons", "kind": "video"})
        if len(out) >= want: break
    return out


def collect_videos(art, need=3):
    cat = art.get("category") or "world"
    terms = list(dict.fromkeys([*(art.get("tags") or [])[:2], *STOCK_TERMS.get(cat, STOCK_TERMS["world"])]))
    vids = []
    for t in terms:
        if len(vids) >= need: break
        vids += pexels_videos(t, 1)
    if art.get("country") not in (None, "WW") and len(vids) < need:
        vids += commons_videos(f"{art.get('country_name')}", 1)
    for t in terms:
        if len(vids) >= need: break
        vids += commons_videos(t, 1)
    return vids[:need]


def cover(path, w=BG_W, h=BG_H):
    """Fill the vertical frame: the photo sits whole in the upper half over a blurred copy of itself.
    Portrait photos simply fill the frame."""
    try: im = ImageOps.exif_transpose(Image.open(path)).convert("RGB")
    except Exception: return None
    if im.width / im.height < 0.8:
        return ImageOps.fit(im, (w, h), Image.LANCZOS)
    bg = ImageOps.fit(im, (w, h)).filter(ImageFilter.GaussianBlur(48))
    bg = Image.blend(bg, Image.new("RGB", (w, h), (8, 10, 16)), 0.35)
    fg = ImageOps.contain(im, (w, int(h * 0.5)), Image.LANCZOS)
    bg.paste(fg, ((w - fg.width) // 2, int(h * PHOTO_CY) - fg.height // 2))
    return bg

def gradient_bg(c1, c2, w=BG_W, h=BG_H):
    a, b = rgb(c1), rgb(c2)
    base = Image.new("RGB", (w, h))
    d = ImageDraw.Draw(base)
    for y in range(h):
        t = y / h
        d.line([(0, y), (w, y)], fill=tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3)))
    return base

# ---------------------------------------------------------------- overlays (vertical 9:16 Shorts)
# Phone apps cover the top ~8%, the bottom ~20% (title, channel) and a strip on the right (buttons),
# so all text stays inside the safe box below.
SAFE_X0, SAFE_X1, SAFE_Y1 = 64, 900, 1500

def shade(strength=235, start=0.42):
    """Dark gradient over the lower part so captions stay readable, plus a light one at the top."""
    g = Image.new("L", (W, H))
    d = ImageDraw.Draw(g)
    for y in range(H):
        low = strength * max(0, (y - H * start) / (H * (1 - start))) ** 0.7
        top = 140 * max(0, 1 - y / (H * 0.14))
        d.line([(0, y), (W, y)], fill=int(min(255, max(low, top))))
    layer = Image.new("RGBA", (W, H), (6, 10, 22, 0)); layer.putalpha(g)
    return layer

def brand_bar(ov, d, ctx, flag=None, credit=""):
    """Country pill near the top, with the picture credit underneath."""
    label = f"TOP STORY · {ctx['country'].upper()}"
    ft = font("sans", 30)
    x, y = SAFE_X0, 170
    pad = 70 if flag else 26
    d.rounded_rectangle([x, y, x + pad + d.textlength(label, font=ft) + 26, y + 58], radius=29, fill=(10, 10, 12, 210))
    if flag: ov.paste(flag.resize((42, 28)), (x + 18, y + 15))
    d.text((x + pad, y + 13), label, font=ft, fill="#eef2ff")
    if credit:
        d.text((x + 6, y + 74), textwrap.shorten(credit, 52, placeholder="…"), font=font("sans", 28, "Medium"), fill=(235, 238, 245, 215))

def wrap_words(d, words, ft, width):
    lines, cur, curw = [], [], 0
    space = d.textlength(" ", font=ft)
    for w_, idx in words:
        tw = d.textlength(w_, font=ft)
        if cur and curw + space + tw > width:
            lines.append(cur); cur, curw = [], 0
        cur.append((w_, idx, tw)); curw += (space if len(cur) > 1 else 0) + tw
    if cur: lines.append(cur)
    return lines

def fit_text(d, text, kind, sizes, width, height, weight="Bold", leading=1.22):
    """Largest font size at which the text fits the box. Returns (font, size, lines)."""
    for size in sizes:
        ft = font(kind, size, weight)
        lines = wrap_words(d, [(w_, 0) for w_ in text.split()], ft, width)
        if len(lines) * size * leading <= height: return ft, size, lines
    return ft, size, lines

def draw_lines(d, lines, ft, size, x, y, fill, leading=1.22, stroke=0):
    for line in lines:
        d.text((x, y), " ".join(w_ for w_, _, _ in line), font=ft, fill=fill, stroke_width=stroke, stroke_fill=(0, 0, 0, 160))
        y += int(size * leading)
    return y

def label_chip(d, x, y, label, color, icon=None):
    ft = font("sans", 36)
    d.rounded_rectangle([x, y, x + 12, y + 52], radius=5, fill=color)
    d.text((x + 28, y + 4), label, font=ft, fill=color)
    if icon: icon(d, x + 28 + d.textlength(label, font=ft) + 34, y + 26, color)

def text_overlay(art, ctx, label, color, sents, active, credit, icon=None):
    """One narrated sentence at a time, large, in the lower half."""
    ov = Image.alpha_composite(Image.new("RGBA", (W, H)), shade())
    d = ImageDraw.Draw(ov)
    brand_bar(ov, d, ctx, None, credit)
    label_chip(d, SAFE_X0, 1000, label, color, icon)
    ft, size, lines = fit_text(d, sents[active] if 0 <= active < len(sents) else "", "serif", range(68, 40, -2),
                               SAFE_X1 - SAFE_X0, SAFE_Y1 - 1085 - 50, "SemiBold", 1.24)
    draw_lines(d, lines, ft, size, SAFE_X0, 1085, "white", 1.24, stroke=1)
    if len(sents) > 1:  # progress dots for this section
        for i in range(len(sents)):
            cx = SAFE_X0 + 8 + i * 30
            d.ellipse([cx - 7, 1468 - 7, cx + 7, 1468 + 7], fill=color if i == active else (255, 255, 255, 90))
    return ov

def arrow(direction):
    def draw(d, cx, cy, color):
        s = 20
        pts = [(cx - s, cy + s * 0.6), (cx, cy - s), (cx + s, cy + s * 0.6)] if direction == "up" else \
              [(cx - s, cy - s * 0.6), (cx, cy + s), (cx + s, cy - s * 0.6)] if direction == "down" else None
        if pts: d.polygon(pts, fill=color)
        else:
            d.line([(cx - s, cy), (cx + s, cy)], fill=color, width=6); d.line([(cx, cy - s), (cx, cy + s)], fill=color, width=6)
            d.line([(cx - s, cy - 4), (cx - s - 8, cy + 10)], fill=color, width=4); d.line([(cx + s, cy - 4), (cx + s + 8, cy + 10)], fill=color, width=4)
    return draw

def title_overlay(art, ctx, credit, flag):
    """Opening frame: category, the headline in large type and the promise of three perspectives."""
    ov = Image.alpha_composite(Image.new("RGBA", (W, H)), shade(245, 0.38))
    d = ImageDraw.Draw(ov)
    brand_bar(ov, d, ctx, flag, credit)
    cat = (art.get("category") or "news").upper()
    cw = d.textlength(cat, font=font("sans", 32))
    d.rounded_rectangle([SAFE_X0, 960, SAFE_X0 + cw + 44, 1014], radius=10, fill=BRAND)
    d.text((SAFE_X0 + 22, 966), cat, font=font("sans", 32), fill="white")
    ft, size, lines = fit_text(d, art["title"], "serif", range(88, 46, -2), SAFE_X1 - SAFE_X0, 400, "Bold", 1.1)
    y = draw_lines(d, lines, ft, size, SAFE_X0, 1040, "white", 1.1, stroke=1)
    d.text((SAFE_X0, min(y + 24, SAFE_Y1 - 60)), "Every side of the story", font=font("sans", 34, "Medium"), fill="#d6deef")
    return ov

def keypoints_overlay(art, ctx, points, upto, credit):
    """The key fact on a card in the middle of the frame."""
    ov = Image.new("RGBA", (W, H), (6, 10, 22, 170))
    d = ImageDraw.Draw(ov)
    brand_bar(ov, d, ctx, None, credit)
    p = points[max(0, min(upto, len(points) - 1))] if points else ""
    ft, size, lines = fit_text(d, p, "sans", range(54, 32, -2), SAFE_X1 - SAFE_X0 - 80, 520, "SemiBold", 1.25)
    card_h = int(len(lines) * size * 1.25) + 150
    y0 = 760
    d.text((SAFE_X0, y0 - 80), "KEY FACT", font=font("sans", 44), fill=BRAND)
    d.rounded_rectangle([SAFE_X0, y0, SAFE_X1, y0 + card_h], radius=28, fill=(255, 255, 255, 34), outline=(255, 255, 255, 90), width=2)
    d.rectangle([SAFE_X0, y0 + 30, SAFE_X0 + 10, y0 + card_h - 30], fill=BRAND)
    draw_lines(d, lines, ft, size, SAFE_X0 + 50, y0 + 75, "white", 1.25)
    return ov

def outro_overlay(art, ctx, credits):
    ov = Image.new("RGBA", (W, H), (6, 10, 22, 200))
    d = ImageDraw.Draw(ov)
    brand_bar(ov, d, ctx)
    ft, size, lines = fit_text(d, "Every side of the story.", "serif", range(92, 60, -2), SAFE_X1 - SAFE_X0, 260)
    y = draw_lines(d, lines, ft, size, SAFE_X0, 640, "white", 1.1)
    d.text((SAFE_X0, y + 40), "Follow for the next story.", font=font("sans", 44), fill=BRAND)
    cr = "; ".join(sorted(set(c for c in credits if c)))
    if cr:
        y = 1180
        for line in textwrap.wrap("Images and footage: " + cr, 48)[:6]:
            d.text((SAFE_X0, y), line, font=font("sans", 28, "Medium"), fill="#b8c2da"); y += 40
    return ov

# ---------------------------------------------------------------- rendering
MOTIONS = [
    "z='min(zoom+0.0006,1.15)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'",
    "z='1.12':x='(iw-iw/zoom)*on/{F}':y='ih/2-(ih/zoom/2)'",
    "z='if(eq(on,0),1.15,max(zoom-0.0006,1.0))':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'",
    "z='1.12':x='(iw-iw/zoom)*(1-on/{F})':y='(ih-ih/zoom)*0.4'",
]


def render_segment(n, bg, shots, audio, motion, blur=0):
    """bg: {"img": PIL image BG_W x BG_H} or {"video": path}; shots: [(overlay RGBA, seconds)]; audio: wav path."""
    total = sum(s for _, s in shots) + 0.5
    frames = int(total * FPS) + 2
    if bg.get("video"):
        inputs = ["-stream_loop", "-1", "-i", bg["video"]]
    else:
        img = bg["img"].filter(ImageFilter.GaussianBlur(blur)) if blur else bg["img"]
        bgp = OUT / f"bg{n}.jpg"; img.convert("RGB").save(bgp, quality=92)
        inputs = ["-i", str(bgp)]
    for k, (ov, _) in enumerate(shots):
        p = OUT / f"ov{n}_{k}.png"; ov.save(p); inputs += ["-i", str(p)]
    inputs += ["-i", str(audio)]
    z = MOTIONS[motion % len(MOTIONS)].replace("{F}", str(frames))
    if bg.get("video"):
        # Landscape clips play whole in the upper half over a blurred, darkened copy that fills the frame.
        cy = int(H * PHOTO_CY)
        graph = (f"[0:v]fps={FPS},split=2[v1][v2];"
                 f"[v1]scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},boxblur=24:2,eq=brightness=-0.22:saturation=0.8[vb];"
                 f"[v2]scale={W}:{H}:force_original_aspect_ratio=decrease,eq=brightness=-0.08:saturation=0.9[vf];"
                 f"[vb][vf]overlay=x=(main_w-overlay_w)/2:y='if(gt(main_h-overlay_h,{H // 3}),{cy}-overlay_h/2,(main_h-overlay_h)/2)',setsar=1"
                 + (f",boxblur={blur}" if blur else "") + "[b0];")
    else:
        graph = f"[0:v]zoompan={z}:d={frames}:s={W}x{H}:fps={FPS},setsar=1[b0];"
    t = 0.0
    for k, (_, secs) in enumerate(shots):
        end = total if k == len(shots) - 1 else t + secs
        graph += f"[b{k}][{k + 1}:v]overlay=0:0:enable='between(t,{t:.3f},{end:.3f})'[b{k + 1}];"
        t += secs
    graph += f"[b{len(shots)}]fade=t=in:st=0:d=0.25,fade=t=out:st={total - 0.25:.2f}:d=0.25,format=yuv420p[v]"
    out = OUT / f"seg{n}.mp4"
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *inputs, "-filter_complex", graph, "-map", "[v]",
                    "-map", f"{len(shots) + 1}:a", "-af", "apad", "-t", f"{total:.2f}", "-r", str(FPS),
                    "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-c:a", "aac", "-b:a", "160k", "-ar", "44100", "-ac", "2", str(out)], check=True)
    return out

def fit_length(path, limit):
    """Speed the finished Short up slightly (at most 20%) if it runs over the limit."""
    secs = duration(path)
    if secs <= limit: return secs
    f = min(1.2, secs / (limit - 0.5))  # aim a little under: encoding adds a few hundred milliseconds
    fast = OUT / "video_fit.mp4"
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(path), "-filter_complex", f"[0:v]setpts=PTS/{f:.4f}[v];[0:a]atempo={f:.4f}[a]",
                    "-map", "[v]", "-map", "[a]", "-t", f"{limit - 0.2:.2f}", "-r", str(FPS), "-c:v", "libx264", "-preset", "medium", "-crf", "20",
                    "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", str(fast)], check=True)
    fast.replace(path)
    print(f"Short sped up x{f:.2f} to fit {limit}s")
    return duration(path)

WORDS_PER_SEC, SEG_OVERHEAD, OUTRO_SECS = 2.6, 0.72, 5.5

def plan_short(title, story, points, views):
    """Choose what the Short narrates so it fits MAX_SECONDS: the headline, the perspectives, then as much of the
    story as fits, then the key fact. views: [(key, sentence)]. Returns (story lines, key points)."""
    story = [s for s in story if s][:4] or [title]
    points = [p for p in points if p][:1]
    def secs(st, pts):
        spoken = [title] + st + [f"Key fact. {p}" for p in pts] + [f"The {k} view. {v}" for k, v in views]
        return sum(len(x.split()) for x in spoken) / WORDS_PER_SEC + len(spoken) * SEG_OVERHEAD + OUTRO_SECS
    while len(story) > 1 and secs(story, points) > MAX_SECONDS:
        story = story[:-1]
    if points and secs(story, points) > MAX_SECONDS:
        points = []
    return story, points

def narrate_parts(n, parts):
    """Synthesise each part separately so the visuals can follow the narration. Returns (wav, [seconds])."""
    paths, secs = [], []
    for k, text in enumerate(parts):
        p = OUT / f"a{n}_{k}.wav"; secs.append(tts(text, p)); paths.append(p)
    out = OUT / f"a{n}.wav"; concat_wavs(paths, out)
    narrate_parts.paths = paths
    return out, secs



# ---------------------------------------------------------------- visuals that follow the narration
def site_api(path, payload, timeout=180):
    tok = oidc_token()
    return json.loads(fetch(f"{SITE}{path}", data=json.dumps(payload).encode(), timeout=timeout,
                            headers={"authorization": f"Bearer {tok}", "content-type": "application/json"}))


def still_of(cand):
    """JPEG bytes (max 768px) of a candidate photo, or a frame two seconds into a candidate clip."""
    try:
        if cand.get("video"):
            fr = OUT / f"fr_{abs(hash(cand['video'])) % 10**8}.jpg"
            subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-ss", "2", "-i", cand["video"], "-frames:v", "1", str(fr)], check=True, timeout=60)
            im = Image.open(fr).convert("RGB")
        else:
            im = Image.open(cand["path"]).convert("RGB")
        im.thumbnail((768, 768)); b = io.BytesIO(); im.save(b, "JPEG", quality=85); return b.getvalue()
    except Exception as e:
        print("still failed", e); return None


QA_LOG = []
BOARD = []    # the picture finally chosen for each narration line (what the final reviewer sees)
REDO = {}     # board index -> (segment index, function that re-renders the segment with a given background)
def visual_fits(cand, line, title):
    """Two-model check on the site: a vision model describes the picture, a separate model judges the fit."""
    jpg = still_of(cand)
    if not jpg: return False
    try:
        r = site_api("/api/video/check", {"image": base64.b64encode(jpg).decode(), "line": line, "title": title})
    except Exception as e:
        print("check failed", e); return False
    QA_LOG.append({"line": line, "visual": cand.get("credit"), "description": r.get("description"), "ok": r.get("ok"), "reason": r.get("reason")})
    cand["_desc"] = r.get("description") or ""
    if str(r.get("reason", "")).startswith("watermark"): cand["_ok"] = False   # branded pictures are never used
    return bool(r.get("ok"))


# ---------------------------------------------------------------- media used by several outlets
BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36"
# Publisher article pages are read under the site's own identified crawler name (the same one the news
# collector uses), never a browser disguise; a refusal is respected and not retried.
PUBLISHER_UA = "Mozilla/5.0 (compatible; GlobalNewsFlixBot/1.0; +https://globalnewsflix.com/about)"
# The site's native-photo gate (photo-policy.js PHOTO_MAX_PIXELS, media.js goodSize and fetchImageBytes).
# A copy outside it is always refused there, so offering it only wastes one of the story's attempts.
PHOTO_MAX_PIXELS = 1_600_000
# The site's smallest native photo (photo-policy.js PHOTO_MIN_WIDTH/HEIGHT, owner 22 Oct 2026: 800x400, was 1200x600).
PHOTO_MIN_W, PHOTO_MIN_H = 800, 400
PHOTO_MAX_BYTES = 4_500_000
BAD_IMG = re.compile(r"logo|icon|sprite|avatar|placeholder|default|blank|pixel|1x1|badge|banner|ads?[/_-]|advert|promo|newsletter|author|byline|favicon|\.svg|\.gif", re.I)
MIN_MEDIA = int(os.environ.get("MIN_MEDIA", "1"))
POOL = []


def get(url, timeout=25, limit=8_000_000, referer=None, headers=None):
    req = urllib.request.Request(url, headers={"user-agent": BROWSER_UA, "accept": "*/*", **({"referer": referer} if referer else {}), **(headers or {})})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read(limit + 1)[:limit + 1]


class PublisherRedirectHandler(urllib.request.HTTPRedirectHandler):
    def __init__(self, original):
        self.original = original

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if not same_publisher_host(self.original, newurl):
            raise ValueError("publisher redirect crossed the registered host")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def publisher_html(url):
    request = urllib.request.Request(url, headers={"user-agent": PUBLISHER_UA, "accept": "text/html"})
    with urllib.request.build_opener(PublisherRedirectHandler(url)).open(request, timeout=20) as response:
        if "text/html" not in response.headers.get("content-type", "").lower():
            raise ValueError("publisher did not return HTML")
        raw = response.read(3_000_001)
        if len(raw) > 3_000_000:
            raise ValueError("publisher page exceeds bounded read")
        return raw.decode("utf-8", "ignore"), response.geturl()


def page_media(url):
    """Photo and video URLs on one article page: share images, structured data and large in-article images."""
    try:
        raw, url = publisher_html(url)
    except Exception as e:
        print("page failed", url[:80], e); return [], []
    absu = lambda u: urllib.parse.urljoin(url, html.unescape(u.strip()))
    imgs, vids = [(u, True) for u in article_image_urls(raw, url)], []
    for m in re.finditer(r'<meta[^>]+(?:property|name)=["\'](og:video(?::secure_url|:url)?)["\'][^>]*>', raw, re.I):
        c = re.search(r'content=["\']([^"\']+\.mp4[^"\']*)', m.group(0), re.I)
        if c: vids.append(absu(c.group(1)))
    for m in re.finditer(r'"(?:contentUrl|embedUrl)"\s*:\s*"(https?:[^"]+?\.mp4[^"]*)"', raw, re.I):
        vids.append(m.group(1).replace("\\/", "/"))
    match = re.search(r"<article\b[^>]*>[\s\S]*?</article\s*>", raw, re.I)
    body = match.group(0) if match else ""
    for m in re.finditer(r'<(?:video|source)[^>]+src=["\']([^"\']+\.mp4[^"\']*)', body, re.I):
        vids.append(absu(m.group(1)))
    clean = lambda xs: [u for i, u in enumerate(xs) if u.startswith("http") and not BAD_IMG.search(u.split("?")[0]) and u not in xs[:i]]
    seen, out = set(), []
    for u, lead in imgs:
        if u.startswith("http") and not BAD_IMG.search(u.split("?")[0]) and u not in seen:
            seen.add(u); out.append((u, lead))
    return out[:14], clean(vids)[:3]


def dhash(im, size=8):
    g = im.convert("L").resize((size + 1, size), Image.LANCZOS)
    px = list(g.getdata()); v = 0
    for r in range(size):
        for c in range(size):
            v = (v << 1) | (px[r * (size + 1) + c] > px[r * (size + 1) + c + 1])
    return v


def fingerprints(im):
    """Hashes of the whole picture and of its centre, so the same photo matches even when outlets crop it differently."""
    w, h = im.size; side = min(w, h)
    sq = im.crop(((w - side) // 2, (h - side) // 2, (w + side) // 2, (h + side) // 2))
    mid = im.crop((w // 4, h // 4, 3 * w // 4, 3 * h // 4))
    return [dhash(im), dhash(sq), dhash(mid)]


def same_picture(a, b, limit=10):
    return any(bin(x ^ y).count("1") <= limit for x in a for y in b)


try:
    import cv2, numpy as np
    ORB = cv2.ORB_create(nfeatures=800)
    BF = cv2.BFMatcher(cv2.NORM_HAMMING)
except Exception:
    cv2 = None


def features(path_or_frame):
    """Keypoints of a picture, so the same photo is recognised even when outlets crop, resize or recompress it."""
    if not cv2: return None
    img = cv2.imread(path_or_frame, cv2.IMREAD_GRAYSCALE) if isinstance(path_or_frame, str) else path_or_frame
    if img is None: return None
    h, w = img.shape[:2]; k = 900 / max(h, w)
    if k < 1: img = cv2.resize(img, (int(w * k), int(h * k)), interpolation=cv2.INTER_AREA)
    kp, des = ORB.detectAndCompute(img, None)
    return (kp, des) if des is not None and len(kp) >= 40 else None


def same_photo(a, b):
    if same_picture(a["fp"], b["fp"]): return True
    fa, fb = a.get("feat"), b.get("feat")
    if not fa or not fb: return False
    try:
        good = [m for m, n in (p for p in BF.knnMatch(fa[1], fb[1], k=2) if len(p) == 2) if m.distance < 0.75 * n.distance]
        if len(good) < 25: return False
        src = np.float32([fa[0][m.queryIdx].pt for m in good]).reshape(-1, 1, 2)
        dst = np.float32([fb[0][m.trainIdx].pt for m in good]).reshape(-1, 1, 2)
        _, mask = cv2.findHomography(src, dst, cv2.RANSAC, 6.0)
        return mask is not None and int(mask.sum()) >= 20
    except Exception:
        return False


def native_fits(w, h, size=0, fmt="JPEG", animated=False):
    """True when the site's own checks can accept these exact bytes (format, byte size and native pixel bounds)."""
    return (fmt in ("JPEG", "PNG", "WEBP") and not animated and size <= PHOTO_MAX_BYTES and PHOTO_MIN_W <= w <= 20000 and
            PHOTO_MIN_H <= h <= 20000 and w * h <= PHOTO_MAX_PIXELS and 0.5 <= w / h <= 2.5)


def load_image(url, referer, n, tag=""):
    try:
        data = get(url, headers=photo_request_headers(url))
        if len(data) > 8_000_000: return None
        raw = Image.open(io.BytesIO(data))
        # The site measures the stored (unrotated) header size, so the gate uses it too.
        fits = native_fits(raw.width, raw.height, len(data), raw.format, getattr(raw, "is_animated", False))
        im = ImageOps.exif_transpose(raw).convert("RGB")
        if im.width < PHOTO_MIN_W or im.height < PHOTO_MIN_H or im.width / im.height < 0.5 or im.width / im.height > 2.5: return None
        dest = OUT / f"news_{tag}{n}.jpg"; im.save(dest, "JPEG", quality=92)
        # Copies outside the site's gate still count towards "several outlets used this photo"; they are just never offered.
        return {"path": str(dest), "url": url, "w": im.width, "h": im.height, "fits": fits, "fp": fingerprints(im), "feat": features(str(dest)), "perceptual": {"algorithm": "dhash-v1", "sha256": hashlib.sha256(data).hexdigest(), "hashes": [f"{value:016x}" for value in fingerprints(im)]}}
    except Exception:
        return None


def load_video(url, referer, n, tag=""):
    try:
        data = get(url, timeout=90, limit=80_000_000, referer=referer)
        if len(data) > 80_000_000: return None
        dest = OUT / f"newsclip_{tag}{n}.mp4"; dest.write_bytes(data)
        fr = OUT / f"newsclip_{tag}{n}.jpg"
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-ss", "2", "-i", str(dest), "-frames:v", "1", str(fr)], check=True, timeout=60)
        im = Image.open(fr).convert("RGB")
        if im.width < 960 or duration(dest) < 5: return None
        return {"video": str(dest), "w": im.width, "h": im.height, "fp": fingerprints(im), "feat": features(str(fr))}
    except Exception:
        return None


STOPWORDS = set("the a an of to in on for and or is are was were be by with at from as after over into its his her their this that new says say said de la el le les des du en y und der die das il di da do na no o e".split())
def words(t):
    return {w for w in re.findall(r"[^\W_]+", (t or "").lower()) if len(w) > 2 and w not in STOPWORDS}


def decode_gnews(link):
    """Publisher URL behind a Google News article link."""
    try:
        gid = urllib.parse.urlparse(link).path.rsplit("/", 1)[-1]
        page = get(f"https://news.google.com/rss/articles/{gid}", timeout=15, limit=600_000).decode("utf-8", "ignore")
        sg = re.search(r'data-n-a-sg="([^"]+)"', page); ts = re.search(r'data-n-a-ts="([^"]+)"', page)
        if not sg or not ts: return None
        inner = json.dumps(["garturlreq", [["X", "X", ["X", "X"], None, None, 1, 1, "US:en", None, 1, None, None, None, None, None, 0, 1], "X", "X", 1, [1, 1, 1], 1, 1, None, 0, 0, None, 0], gid, int(ts.group(1)), sg.group(1)])
        body = ("f.req=" + urllib.parse.quote(json.dumps([[["Fbv4je", inner, None, "generic"]]]))).encode()
        req = urllib.request.Request("https://news.google.com/_/DotsSplashUi/data/batchexecute", data=body,
                                     headers={"user-agent": BROWSER_UA, "content-type": "application/x-www-form-urlencoded;charset=UTF-8"})
        with urllib.request.urlopen(req, timeout=15) as r: t = r.read().decode("utf-8", "ignore")
        arr = json.loads(t.split("\n\n")[1]); url = json.loads(arr[0][2])[1]
        return url if isinstance(url, str) and url.startswith("http") else None
    except Exception as e:
        print("decode failed", str(e)[:80]); return None


def google_news_sources(art, want=10):
    """Other outlets' reports of the same story, found by searching Google News for its headline."""
    title = art.get("title") or ""
    key = words(title)
    q = " ".join(sorted(key, key=lambda w: -len(w))[:8]) or title
    cc = (art.get("country") or "US").upper(); cc = "US" if cc == "WW" else cc
    lang = (art.get("lang") or "en").split("-")[0]
    qq = urllib.parse.quote(q + " when:3d")   # only this week's coverage of the event
    feeds = [f"https://news.google.com/rss/search?q={qq}&hl={lang}&gl={cc}&ceid={cc}:{lang}"]
    if (lang, cc) != ("en", "US"): feeds.append(f"https://news.google.com/rss/search?q={qq}&hl=en-US&gl=US&ceid=US:en")
    import email.utils, time
    found = []
    for f in feeds:
        try: xml = get(f, timeout=20, limit=2_000_000).decode("utf-8", "ignore")
        except Exception as e:
            print("news search failed", str(e)[:80]); continue
        for it in re.findall(r"<item>(.*?)</item>", xml, re.S)[:30]:
            t = html.unescape(re.sub(r"<[^>]+>", "", (re.search(r"<title>(.*?)</title>", it, re.S) or [None, ""])[1]))
            link = (re.search(r"<link>(.*?)</link>", it, re.S) or [None, ""])[1].strip()
            src = html.unescape((re.search(r"<source[^>]*>(.*?)</source>", it, re.S) or [None, ""])[1])
            pd = (re.search(r"<pubDate>(.*?)</pubDate>", it, re.S) or [None, ""])[1]
            try:
                if pd and time.time() - email.utils.parsedate_to_datetime(pd).timestamp() > 4 * 86400: continue
            except Exception: pass
            tw = words(re.sub(r"\s+-\s+[^-]+$", "", t))
            overlap = len(tw & key) / max(1, min(len(tw), len(key)))
            if link and overlap >= 0.4: found.append((overlap, link, src))
    found.sort(key=lambda x: -x[0])
    seen, links = set(), []
    for _, link, src in found:
        if src in seen: continue
        seen.add(src); links.append((link, src))
        if len(links) >= want: break
    with ThreadPoolExecutor(5) as ex:
        urls = list(ex.map(lambda l: decode_gnews(l[0]), links))
    return [{"url": u, "outlet": src} for u, (_, src) in zip(urls, links) if u]


def stored_lead_images(source, page_imgs):
    """The outlet's lead images the site recorded from its report at ingest, then any read now from the page."""
    out, seen = [], set()
    for e in source.get("images") or []:
        u = e.get("url") if isinstance(e, dict) else None
        if isinstance(u, str) and u.startswith("https://") and not BAD_IMG.search(u.split("?")[0]) and u not in seen:
            seen.add(u); out.append((u, True))
    for u, lead in page_imgs:
        if u not in seen:
            seen.add(u); out.append((u, lead))
    return out[:14]


def corroborated_media(art, videos=True, tag=""):
    """Photos and clips from the news outlets that reported this story (one is enough; shared pictures rank first)."""
    try:
        # Photo jobs work on unpublished drafts and hold only the photos workflow identity, so they
        # read sources from the photo route; the video route serves public stories to daily-video only.
        evidence = site_api("/api/video/sources" if videos else "/api/photos/sources", {"article_id": art["id"]})
        if videos:
            approved = evidence.get("approved_image") or {}
            url = approved_photo_url(approved.get("url"), SITE)
            if not url:
                return []
            item = load_image(url, SITE, 0, tag)
            if not item or item["perceptual"]["sha256"] != approved.get("image_hash"):
                return []
            return [{"path":item["path"],"kind":"photo","credit":approved.get("credit") or "Publisher photo independently reviewed for this story", "outlets":1,"urls":[url],"lead":True}]
        sources = evidence.get("sources") or []
    except Exception as e:
        print("sources failed", e); sources = []
    sources = sources[:12]
    print(f"Checking {len(sources)} outlets:", ", ".join(s.get("outlet", "") for s in sources))
    with ThreadPoolExecutor(6) as ex:
        pages = list(ex.map(lambda s: page_media(s["url"]), sources))
    jobs = []
    for s_, (imgs, vids) in zip(sources, pages):
        dom = urllib.parse.urlparse(s_["url"]).hostname or s_["url"]
        imgs = stored_lead_images(s_, imgs)
        print(f"  {s_.get('outlet') or dom}: {len(imgs)} photos, {len(vids)} clips found")
        for u, lead in imgs: jobs.append(("img", u, s_, dom, lead))
        if videos:
            for u in vids: jobs.append(("vid", u, s_, dom, True))
    def load(j):
        i, (kind, u, s_, dom, lead) = j
        it = load_image(u, s_["url"], i, tag) if kind == "img" else load_video(u, s_["url"], i, tag)
        if it: it.update({"domain": dom, "outlet": s_.get("outlet") or dom, "lead": lead})
        return it
    with ThreadPoolExecutor(8) as ex:
        items = [x for x in ex.map(load, enumerate(jobs)) if x]
    # Group the same picture across outlets.
    groups = []
    for it in items:
        for g in groups:
            if any(o["domain"] != it["domain"] and same_photo(it, o) for o in g) or any(same_picture(it["fp"], o["fp"]) for o in g):
                g.append(it); break
        else:
            groups.append([it])
    # Pictures come from the outlets that reported the story (one outlet is enough). Pictures can differ: each outlet's own
    # photos and clips for the story are used (a picture several outlets share ranks first). Lead photos (the one an
    # outlet chose to illustrate the story) rank above other pictures on the page.
    covering = {urllib.parse.urlparse(x["url"]).hostname for x in sources if x.get("url")}
    if not covering:
        print("No outlet reports found for this story")
        return []
    out = []
    for g in groups:
        outlets = sorted({o["outlet"] for o in g}); domains = {o["domain"] for o in g}
        best = max(g, key=lambda o: (bool(o.get("video")), o["w"] * o["h"]))
        credit = "Published by " + ", ".join(outlets[:3])
        # Largest copy first, among the copies the site's native-size gate accepts (too-large ones are always refused).
        urls = [o["url"] for o in sorted(g, key=lambda o: -(o["w"] * o["h"])) if o.get("url") and o.get("fits", native_fits(o["w"], o["h"]))]
        out.append({**({"video": best["video"]} if best.get("video") else {"path": best["path"]}), "credit": credit,
                    "kind": "video" if best.get("video") else "photo", "outlets": len(domains), "urls": urls,
                    "lead": any(o.get("lead") for o in g), "perceptual_by_url": {o["url"]: o["perceptual"] for o in g if o.get("url") and o.get("perceptual")}})
    out.sort(key=lambda c: (-c["outlets"], not c["lead"], c["kind"] != "video"))
    print(f"{len(covering)} outlets covered the story; {len(items)} pictures usable ({sum(c['outlets'] > 1 for c in out)} shared by several outlets)")
    return out


def candidates_for(item, art):
    return POOL


def plan_visuals(lines, art):
    try:
        r = site_api("/api/video/plan", {"title": art["title"], "lines": lines, "country": art.get("country_name", "")})
        plan = r.get("plan") or []
    except Exception as e:
        print("plan failed", e); plan = []
    return [plan[i] if i < len(plan) and isinstance(plan[i], dict) else {"queries": (art.get("tags") or [])[:2]} for i in range(len(lines))]


def text_card(n):
    """A clean branded background, used when no picture truly fits the line (never a mismatched one)."""
    return {"img": gradient_bg("#111111", "#3a0d0e"), "credit": "", "card": True}


# Nothing a Short says or shows may mention AI. Stories whose narrated or published text does are skipped.
# The acronyms need capitals, so names such as "Ai Weiwei" and words such as "Mai" never match.
AI_ACRONYM = re.compile(r"\b(?:A\.I\.?|AI|GenAI|LLMs?)(?!\w)")
AI_PHRASE = re.compile(r"\b(?:artificial[ -]intelligence|machine[ -]learning|chat ?bots?|generative|large language models?|"
                       r"neural networks?|chatgpt|openai|deepfakes?|(?:synthetic|computer)[ -]generated)\b", re.I)


def ai_mention(art):
    """The first words in the story's video text that mention AI, or None."""
    fields = [art.get(k) for k in ("title", "dek", "summary", "neutral", "positive", "negative")]
    fields += list(art.get("body") or [])[:2] + list(art.get("key_points") or [])
    for text in fields:
        m = isinstance(text, str) and (AI_ACRONYM.search(text) or AI_PHRASE.search(text))
        if m: return m.group(0)
    return None


STORY_TRIES = int(os.environ.get("STORY_TRIES", "3"))  # stories one run may build before giving the slot up


def pick_story(tried=()):
    """The next story waiting for a Short that has outlet pictures; exits 2 (none waiting) or 4 (no pictures)."""
    art = None
    for attempt in range(6):
        art = json.loads(Path(sys.argv[1]).read_text()) if len(sys.argv) > 1 and sys.argv[1].endswith(".json") else json.loads(fetch(f"{SITE}/api/top"))
        if not art or not art.get("id"):
            print("No story available"); sys.exit(2)
        if art["id"] in tried:
            # The site could not record the earlier failure, so it offers the same story again.
            print("No further story available this run"); sys.exit(2)
        if ai_mention(art):
            print(f"Skipping '{art['title'][:70]}': its text mentions '{ai_mention(art)}'")
            try: site_api("/api/video", {"article_id": art["id"], "youtube_id": "qa-failed"})
            except Exception as e: print("could not mark story", e)
            if len(sys.argv) > 1: sys.exit(4)
            continue
        POOL[:] = corroborated_media(art)
        if len(POOL) >= MIN_MEDIA: return art
        print(f"Skipping '{art['title'][:70]}': no usable picture from the outlets that reported it")
        try: site_api("/api/video", {"article_id": art["id"], "youtube_id": "no-media"})
        except Exception as e: print("could not mark story", e)
        if len(sys.argv) > 1: sys.exit(4)
    print("No story had a usable picture"); sys.exit(4)


def main():
    """Builds one Short. A story that fails the final review is marked qa-failed and the next story is tried
    in the same run (up to STORY_TRIES), so one rejected storyboard no longer costs the whole slot."""
    get_assets()
    tried = []
    for n in range(max(1, STORY_TRIES)):
        art = pick_story(tried)
        tried.append(art["id"])
        BOARD.clear(); QA_LOG.clear(); REDO.clear()
        if build_short(art): return
        if len(sys.argv) > 1: break
    print(f"{len(tried)} stories failed quality assurance; not publishing this run.")
    sys.exit(3)


def build_short(art):
    """Renders the Short for one story into out/. Returns False when the final review rejects it."""
    country = art.get("country_name") or "the World"
    ctx = {"country": "Worldwide" if art.get("country") in (None, "WW") else country, "rank": art.get("rank", 1)}
    flag = None
    if art.get("country") and art["country"] != "WW":
        try: flag = Image.open(io.BytesIO(fetch(f"https://flagcdn.com/w160/{art['country'].lower()}.png"))).convert("RGB")
        except Exception: pass

    title = art["title"]
    used, credits, segs = set(), [], []
    last_good = [None]

    def choose(line, item, still=False):
        """First candidate that both models accept for this line; otherwise a text card."""
        tried = 0
        pool = candidates_for(item, art)
        ordered = [c for c in pool if (c.get("video") or c.get("path")) not in used] + [c for c in pool if (c.get("video") or c.get("path")) in used]
        for c in ordered:
            ident = c.get("video") or c.get("path")
            if still and c.get("video"): continue
            tried += 1
            if tried > 5: break
            if c.get("_ok") is False: continue
            if visual_fits(c, line, title):
                used.add(ident)
                bg = {"video": c["video"], "credit": c["credit"]} if c.get("video") else {"img": cover(c["path"]), "credit": c["credit"]}
                if bg.get("img") is None and not bg.get("video"): continue
                if c["credit"] not in credits: credits.append(c["credit"])
                last_good[0] = (c, bg)
                BOARD.append({"line": line, "visual": c.get("credit"), "description": c.get("_desc", "")})
                return bg
        if last_good[0] and not (still and last_good[0][1].get("video")) and visual_fits(last_good[0][0], line, title):
            BOARD.append({"line": line, "visual": last_good[0][0].get("credit"), "description": last_good[0][0].get("_desc", "")})
            return last_good[0][1]
        QA_LOG.append({"line": line, "visual": "text card", "ok": True, "reason": "no picture fitted this line"})
        BOARD.append({"line": line, "visual": "text card", "description": ""})
        return text_card(0)

    # A Short of about 45-58 seconds: headline, the core of the story, one key fact and one line per perspective.
    # The narration is line by line, so each picture can follow what is being said.
    story = [art.get("dek") or ""] + list(art.get("body") or [])[:2]
    ss_all = [x for p in story if p for x in sentences(p)] or sentences(art.get("summary") or title)
    persp = {k: sentences(art.get(k) or "")[:1] for k in ("neutral", "positive", "negative")}
    ss, pts = plan_short(title, ss_all, art.get("key_points") or [], [(k, v[0]) for k, v in persp.items() if v])
    lines = [title] + ss + pts + [x for k in persp for x in persp[k]]
    plan = [{} for _ in lines]  # pictures come only from the outlets' own coverage
    li = iter(range(len(lines)))

    # 1. Title (a still image so it also makes the thumbnail)
    i = next(li); title_bg = choose(title, plan[i], still=True)
    if title_bg.get("card"): title_bg = {"img": gradient_bg("#111111", "#3a0d0e"), "credit": ""}
    audio, secs = narrate_parts(0, [f"{title}."])
    title_audio, title_secs = audio, secs[0]
    title_ov = title_overlay(art, ctx, title_bg["credit"], flag)
    segs.append(render_segment(0, title_bg, [(title_ov, secs[0])], audio, 0))
    thumb = Image.alpha_composite(ImageOps.fit(title_bg["img"], (W, H)).convert("RGBA"), title_ov).convert("RGB"); thumb.save(OUT / "thumbnail.png")

    seg_no = [100]
    def per_line(parts, spoken, overlay_for, blur=0, motion=1):
        audio, secs = narrate_parts(seg_no[0], spoken)
        paths = list(narrate_parts.paths)
        for k, line in enumerate(parts):
            bg = choose(line, plan[next(li)])
            seg_no[0] += 1
            redo = lambda bg, n=seg_no[0], k=k: render_segment(n, bg, [(overlay_for(k, bg["credit"]), secs[k])], paths[k], motion + k, blur=blur)
            REDO[len(BOARD) - 1] = (len(segs), redo)
            segs.append(redo(bg))

    # 2. The story
    per_line(ss, ss, lambda k, cr: text_overlay(art, ctx, "THE STORY", BRAND, ss, k, cr))
    # 3. Key fact
    if pts:
        per_line(pts, ["Key fact. " + pts[0]], lambda k, cr: keypoints_overlay(art, ctx, pts, k, cr), blur=6, motion=2)
    # 4-6. Perspectives
    for key, icon in (("neutral", arrow("scale")), ("positive", arrow("up")), ("negative", arrow("down"))):
        color, label = TONE[key]; ps = persp[key]
        if not ps: continue
        per_line(ps, [f"The {key} view. " + ps[0]], lambda k, cr, ps=ps, color=color, label=label, icon=icon: text_overlay(art, ctx, label, color, ps, k, cr, icon))
    # 7. Outro
    audio, secs = narrate_parts(8, ["That's every side of the story. Follow for the next one."])
    outro_audio, outro_secs = audio, secs[0] + 1.0
    segs.append(render_segment(8, title_bg, [(outro_overlay(art, ctx, credits), outro_secs)], audio, 1, blur=14))

    # Final quality assurance: an independent model reviews the whole storyboard.
    try:
        verdict = site_api("/api/video/qa", {"title": title, "storyboard": BOARD})
    except Exception as e:
        verdict = {"ok": False, "lines": [], "problems": [f"final review unavailable ({e})"]}
    print("QA verdict:", verdict)
    # Lines the reviewer flags as misleading or inappropriate get a plain text card instead of the picture.
    fixed = []
    for n in verdict.get("lines") or []:
        try: idx = int(n) - 1
        except Exception: continue
        if idx in REDO:
            si, redo = REDO[idx]
            segs[si] = redo(text_card(0)); fixed.append(idx + 1)
        elif idx == 0:
            title_bg = {"img": gradient_bg("#111111", "#3a0d0e"), "credit": ""}
            title_ov = title_overlay(art, ctx, "", flag)
            segs[0] = render_segment(0, title_bg, [(title_ov, title_secs)], title_audio, 0)
            segs[-1] = render_segment(8, title_bg, [(outro_overlay(art, ctx, credits), outro_secs)], outro_audio, 1, blur=14)
            Image.alpha_composite(ImageOps.fit(title_bg["img"], (W, H)).convert("RGBA"), title_ov).convert("RGB").save(OUT / "thumbnail.png")
            fixed.append(1)
        else: continue
        BOARD[idx]["visual"] = "text card (replaced after review)"
    if fixed: print("Replaced pictures on lines", fixed)
    (OUT / "qa.json").write_text(json.dumps({"verdict": verdict, "storyboard": BOARD, "checks": QA_LOG}, indent=1))
    if not verdict.get("ok") and not fixed:
        print("Video failed quality assurance; not publishing.")
        try: site_api("/api/video", {"article_id": art["id"], "youtube_id": "qa-failed"})
        except Exception: pass
        return False

    (OUT / "list.txt").write_text("".join(f"file '{p.name}'\n" for p in segs))
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", str(OUT / "list.txt"),
                    "-c", "copy", "-movflags", "+faststart", str(OUT / "video.mp4")], check=True)
    secs = fit_length(OUT / "video.mp4", MAX_SECONDS)

    url = f"{SITE}/a/{art['id']}"
    title = textwrap.shorten(f"{art['title']} | {ctx['country']}", 98, placeholder="…")
    image_credits = "\n".join(f"- {c}" for c in sorted(set(credits)) if c)
    body = (art.get("dek") or art.get("summary") or "").strip()
    desc = (f"{body}\n\nNEUTRAL: {art.get('neutral', '')}\n\nPOSITIVE: {art.get('positive', '')}\n\nNEGATIVE: {art.get('negative', '')}\n\n"
            f"Images and footage:\n{image_credits}\n\n"
            "#Shorts #news #worldnews #" + re.sub(r"\W+", "", art.get("category") or "news"))
    meta = {"title": title, "description": desc[:4900], "article_id": art["id"], "url": url, "seconds": round(secs, 1),
            "caption": textwrap.shorten(f"{art['title']}. Every side of the story.", 300, placeholder="…") + " #news #worldnews",
            "tags": ["news", "world news", ctx["country"], art.get("category") or "news"] + (art.get("people") or [])[:4]}
    (OUT / "meta.json").write_text(json.dumps(meta, indent=1))
    print("Short ready", round(secs, 1), "s")
    return True


if __name__ == "__main__":
    main()
