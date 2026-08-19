import base64
import io
import ipaddress
import json
import os
import re
import socket
import threading
import uuid
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup
from flask import (
    Flask,
    abort,
    jsonify,
    render_template,
    request,
    send_file,
    send_from_directory,
)
from PIL import Image, ImageDraw, ImageFont

app = Flask(__name__, static_folder="static", template_folder="templates")
app.config["MAX_CONTENT_LENGTH"] = 4 * 1024 * 1024

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
FORGED_DIR = ROOT / "static" / "forged"
APPS_FILE = DATA_DIR / "apps.json"
LOCK = threading.Lock()

DATA_DIR.mkdir(exist_ok=True)
FORGED_DIR.mkdir(parents=True, exist_ok=True)

SESSION = requests.Session()
SESSION.headers.update(
    {
        "User-Agent": "GOTYAH-Forge/1.0 (+https://gotyah.app)",
        "Accept": "text/html,application/xhtml+xml,image/avif,image/webp,*/*;q=0.8",
    }
)


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def load_apps():
    if not APPS_FILE.exists():
        return {}
    try:
        return json.loads(APPS_FILE.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}


def save_apps(apps):
    tmp = APPS_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(apps, indent=2), encoding="utf-8")
    tmp.replace(APPS_FILE)


def get_app(app_id):
    with LOCK:
        return load_apps().get(app_id)


def is_safe_url(url):
    try:
        parsed = urlparse(url)
    except Exception:
        return False
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        return False
    host = parsed.hostname.strip("[]").lower()
    if host in {"localhost", "127.0.0.1", "0.0.0.0", "::1"} or host.endswith(".local"):
        return False
    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror:
        return False
    for info in infos:
        try:
            ip = ipaddress.ip_address(info[4][0])
        except ValueError:
            return False
        if (
            ip.is_private
            or ip.is_loopback
            or ip.is_link_local
            or ip.is_reserved
            or ip.is_multicast
            or ip.is_unspecified
        ):
            return False
    return True


def normalize_url(raw):
    url = (raw or "").strip()
    if not url:
        return ""
    if not re.match(r"^https?://", url, re.I):
        url = "https://" + url
    parsed = urlparse(url)
    if not parsed.netloc:
        return ""
    return url


def fetch(url, **kwargs):
    return SESSION.get(url, timeout=8, allow_redirects=True, **kwargs)


def frameable_from_headers(headers):
    xfo = (headers.get("X-Frame-Options") or "").lower()
    if "deny" in xfo or "sameorigin" in xfo:
        return False
    csp = headers.get("Content-Security-Policy") or ""
    m = re.search(r"frame-ancestors([^;]+)", csp, re.I)
    if m:
        val = m.group(1).lower()
        if "'none'" in val or "none" in val:
            return False
        if "'self'" in val and "http" not in val:
            return False
    return True


def pick_icon(soup, page_url):
    rels = []
    for tag in soup.find_all("link"):
        rel = " ".join(tag.get("rel") or []).lower()
        href = tag.get("href")
        if href and any(k in rel for k in ("apple-touch-icon", "icon", "shortcut")):
            rels.append((rel, urljoin(page_url, href)))
    rels.sort(key=lambda r: (0 if "apple-touch" in r[0] else 1, 0 if "192" in r[1] else 1))
    if rels:
        return rels[0][1]
    return urljoin(page_url, "/favicon.ico")


def letter_icon(name, theme="#C6FF2E"):
    letter = next((c.upper() for c in name if c.isalnum()), "G")
    img = Image.new("RGB", (512, 512), "#050505")
    draw = ImageDraw.Draw(img)
    draw.ellipse((48, 48, 464, 464), outline=theme, width=18)
    try:
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 260)
    except OSError:
        font = ImageFont.load_default()
    bbox = draw.textbbox((0, 0), letter, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    draw.text(((512 - tw) / 2, (512 - th) / 2 - 20), letter, fill=theme, font=font)
    return img


def save_icon(app_id, source):
    dest_512 = FORGED_DIR / f"{app_id}-512.png"
    dest_192 = FORGED_DIR / f"{app_id}-192.png"
    img = None
    if source:
        try:
            if source.startswith("data:"):
                raw = source.split(",", 1)[1]
                img = Image.open(io.BytesIO(base64.b64decode(raw))).convert("RGBA")
            elif source.startswith("http") and is_safe_url(source):
                r = fetch(source, stream=True)
                r.raise_for_status()
                img = Image.open(io.BytesIO(r.content)).convert("RGBA")
        except Exception:
            img = None
    if img is None:
        img = letter_icon("A")
    square = Image.new("RGBA", img.size, "#050505")
    square.paste(img, mask=img.split()[-1] if img.mode == "RGBA" else None)
    w, h = square.size
    side = min(w, h)
    cropped = square.crop(((w - side) // 2, (h - side) // 2, (w + side) // 2, (h + side) // 2))
    rgb = Image.new("RGB", cropped.size, "#050505")
    rgb.paste(cropped, mask=cropped.split()[-1] if cropped.mode == "RGBA" else None)
    rgb.resize((512, 512), Image.Resampling.LANCZOS).save(dest_512, "PNG")
    rgb.resize((192, 192), Image.Resampling.LANCZOS).save(dest_192, "PNG")
    return f"/static/forged/{app_id}-512.png"


def inspect_site(url):
    response = fetch(url)
    response.raise_for_status()
    final = response.url
    html = response.text[:400000]
    soup = BeautifulSoup(html, "html.parser")
    title = ""
    if soup.title and soup.title.string:
        title = soup.title.string.strip()
    og = soup.find("meta", property="og:title")
    if og and og.get("content"):
        title = og["content"].strip()
    desc = ""
    md = soup.find("meta", attrs={"name": "description"}) or soup.find(
        "meta", property="og:description"
    )
    if md and md.get("content"):
        desc = md["content"].strip()
    theme = "#050505"
    tc = soup.find("meta", attrs={"name": "theme-color"})
    if tc and tc.get("content"):
        theme = tc["content"].strip()
    icon = pick_icon(soup, final)
    return {
        "url": final,
        "title": title[:80] or urlparse(final).hostname,
        "description": desc[:180],
        "theme": theme,
        "icon": icon,
        "frameable": frameable_from_headers(response.headers),
        "host": urlparse(final).hostname,
    }


@app.after_request
def add_headers(response):
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    return response


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/manifest.json")
def studio_manifest():
    return send_from_directory(
        app.static_folder, "manifest.json", mimetype="application/manifest+json"
    )


@app.route("/sw.js")
def studio_sw():
    response = send_from_directory(
        app.static_folder, "sw.js", mimetype="application/javascript"
    )
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    response.headers["Service-Worker-Allowed"] = "/"
    return response


@app.route("/favicon.ico")
def favicon():
    return send_from_directory(
        os.path.join(app.static_folder, "icons"),
        "favicon.ico",
        mimetype="image/x-icon",
    )


@app.route("/health")
def health():
    return jsonify(ok=True, app="GOT YAH", time=now_iso())


@app.route("/api/inspect", methods=["POST"])
def api_inspect():
    url = normalize_url((request.get_json(silent=True) or {}).get("url"))
    if not url or not is_safe_url(url):
        return jsonify(error="Enter a public http(s) website."), 400
    try:
        data = inspect_site(url)
    except requests.RequestException:
        return jsonify(error="Could not reach that site. Check the URL."), 400
    return jsonify(data)


@app.route("/api/forge", methods=["POST"])
def api_forge():
    body = request.get_json(silent=True) or {}
    url = normalize_url(body.get("url"))
    if not url or not is_safe_url(url):
        return jsonify(error="Enter a public http(s) website."), 400
    name = (body.get("name") or urlparse(url).hostname or "Web App").strip()[:32]
    short_name = (body.get("short_name") or name)[:12]
    theme = body.get("theme") or "#050505"
    if not re.match(r"^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$", theme):
        theme = "#050505"
    display = body.get("display") if body.get("display") in ("standalone", "fullscreen") else "standalone"
    frameable = bool(body.get("frameable", True))
    app_id = uuid.uuid4().hex[:10]
    icon_src = body.get("icon") or ""
    try:
        icon_path = save_icon(app_id, icon_src)
    except Exception:
        icon_path = save_icon(app_id, "")
        letter = letter_icon(name, "#C6FF2E")
        letter.save(FORGED_DIR / f"{app_id}-512.png", "PNG")
        letter.resize((192, 192), Image.Resampling.LANCZOS).save(
            FORGED_DIR / f"{app_id}-192.png", "PNG"
        )
        icon_path = f"/static/forged/{app_id}-512.png"

    record = {
        "id": app_id,
        "url": url,
        "name": name,
        "short_name": short_name,
        "theme": theme,
        "display": display,
        "frameable": frameable,
        "icon": icon_path,
        "created": now_iso(),
    }
    with LOCK:
        apps = load_apps()
        apps[app_id] = record
        save_apps(apps)
    return jsonify(record)


@app.route("/api/app/<app_id>")
def api_get_app(app_id):
    record = get_app(app_id)
    if not record:
        abort(404)
    return jsonify(record)


@app.route("/a/<app_id>")
def wrap(app_id):
    record = get_app(app_id)
    if not record:
        abort(404)
    return render_template("wrap.html", app=record)


@app.route("/a/<app_id>/manifest.json")
def wrap_manifest(app_id):
    record = get_app(app_id)
    if not record:
        abort(404)
    manifest = {
        "id": f"/a/{app_id}",
        "name": record["name"],
        "short_name": record["short_name"],
        "start_url": f"/a/{app_id}",
        "scope": f"/a/{app_id}",
        "display": record["display"],
        "orientation": "portrait",
        "background_color": record["theme"],
        "theme_color": record["theme"],
        "icons": [
            {
                "src": f"/static/forged/{app_id}-192.png",
                "sizes": "192x192",
                "type": "image/png",
                "purpose": "any maskable",
            },
            {
                "src": f"/static/forged/{app_id}-512.png",
                "sizes": "512x512",
                "type": "image/png",
                "purpose": "any maskable",
            },
        ],
    }
    response = jsonify(manifest)
    response.headers["Content-Type"] = "application/manifest+json"
    response.headers["Cache-Control"] = "no-cache"
    return response


@app.route("/a/<app_id>/sw.js")
def wrap_sw(app_id):
    if not get_app(app_id):
        abort(404)
    body = f"""const CACHE = "gotyah-wrap-{app_id}";
const SHELL = ["/a/{app_id}"];
self.addEventListener("install", (e) => {{
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
}});
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (e) => {{
  if (e.request.mode === "navigate") {{
    e.respondWith(fetch(e.request).catch(() => caches.match("/a/{app_id}")));
  }}
}});
"""
    response = app.response_class(body, mimetype="application/javascript")
    response.headers["Cache-Control"] = "no-cache"
    response.headers["Service-Worker-Allowed"] = f"/a/{app_id}"
    return response


@app.route("/a/<app_id>/download")
def download_kit(app_id):
    record = get_app(app_id)
    if not record:
        abort(404)
    icon_512 = FORGED_DIR / f"{app_id}-512.png"
    icon_192 = FORGED_DIR / f"{app_id}-192.png"
    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="theme-color" content="{record["theme"]}" />
  <title>{record["name"]}</title>
  <link rel="manifest" href="manifest.json" />
  <link rel="apple-touch-icon" href="icon-192.png" />
  <style>
    html,body{{margin:0;height:100%;overflow:hidden;background:{record["theme"]};}}
    iframe{{border:0;width:100%;height:100%;}}
  </style>
</head>
<body>
  <iframe src="{record["url"]}" allow="fullscreen; geolocation; microphone; camera"></iframe>
  <script>
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js");
  </script>
</body>
</html>
"""
    manifest = json.dumps(
        {
            "id": "./",
            "name": record["name"],
            "short_name": record["short_name"],
            "start_url": "./",
            "display": record["display"],
            "background_color": record["theme"],
            "theme_color": record["theme"],
            "icons": [
                {"src": "icon-192.png", "sizes": "192x192", "type": "image/png"},
                {"src": "icon-512.png", "sizes": "512x512", "type": "image/png"},
            ],
        },
        indent=2,
    )
    sw = """self.addEventListener("install", (e) => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
"""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(f"{record['short_name']}/index.html", html)
        zf.writestr(f"{record['short_name']}/manifest.json", manifest)
        zf.writestr(f"{record['short_name']}/sw.js", sw)
        if icon_192.exists():
            zf.write(icon_192, f"{record['short_name']}/icon-192.png")
        if icon_512.exists():
            zf.write(icon_512, f"{record['short_name']}/icon-512.png")
        zf.writestr(
            f"{record['short_name']}/README.txt",
            f"GOT YAH app kit for {record['name']}\nOpen index.html over HTTPS and Add to Home Screen.\nTarget: {record['url']}\n",
        )
    buf.seek(0)
    filename = re.sub(r"[^a-zA-Z0-9_-]+", "-", record["short_name"]) + "-app-kit.zip"
    return send_file(buf, as_attachment=True, download_name=filename, mimetype="application/zip")


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    debug = os.environ.get("FLASK_DEBUG", "0") == "1"
    app.run(host="0.0.0.0", port=port, debug=debug)
