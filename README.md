# GOT YAH

Installable mobile web app. Hand someone the phone. They fall for the trap. **GOT YAH.**

Flask backend + Tailwind frontend + PWA (Add to Home Screen). Ready for Render.

## Run locally

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python app.py
```

Open `http://localhost:5000`.

## Install on your phone

1. Deploy (or open the live URL) over HTTPS.
2. **iPhone:** Safari → Share → Add to Home Screen.
3. **Android:** Chrome → Install app / Add to Home screen.

The app opens full screen like a native app. Offline shell is cached by the service worker.

## Deploy on Render

1. Push this folder to GitHub.
2. New Web Service → connect the repo.
3. Runtime: Python. Build: `pip install -r requirements.txt`.
4. Start: `gunicorn app:app --bind 0.0.0.0:$PORT --workers 2 --threads 4 --timeout 60`
5. Health check: `/health`.

`Procfile`, `runtime.txt`, and `render.yaml` are already in the repo.

## Files

```
app.py                 Flask app
requirements.txt       Flask + gunicorn
Procfile               Render / Heroku process
runtime.txt            Python 3.12
render.yaml            Render blueprint
templates/index.html   Mobile UI
static/js/app.js       Traps, hits, install
static/sw.js           Service worker
static/manifest.json   PWA manifest
static/icons/          App icons
```
