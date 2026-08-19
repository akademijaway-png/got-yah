import os
from datetime import datetime, timezone

from flask import Flask, jsonify, render_template, send_from_directory

app = Flask(__name__, static_folder="static", template_folder="templates")
app.config["SEND_FILE_MAX_AGE_DEFAULT"] = 31536000


@app.after_request
def add_headers(response):
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["X-Frame-Options"] = "SAMEORIGIN"
    return response


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/manifest.json")
def manifest():
    return send_from_directory(
        app.static_folder, "manifest.json", mimetype="application/manifest+json"
    )


@app.route("/sw.js")
def service_worker():
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
    return jsonify(ok=True, app="GOT YAH", time=datetime.now(timezone.utc).isoformat())


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    debug = os.environ.get("FLASK_DEBUG", "0") == "1"
    app.run(host="0.0.0.0", port=port, debug=debug)
