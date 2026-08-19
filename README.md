# GOT YAH — Web → App Forge

Paste a website URL. GOT YAH reads the title, icon, and theme, then forges an installable phone app (PWA). Open it full screen, add it to the home screen, or download an app-kit zip.

## Use it

1. Open the site on your phone.
2. Paste a URL → **FORGE APP**.
3. Set name / icon / colors → **CREATE APP**.
4. **OPEN APP** then **Add to Home Screen**, or **DOWNLOAD APP KIT .ZIP**.

Install GOT YAH itself the same way (Install tab) so the forge lives on your home screen.

## Run locally

```bash
pip install -r requirements.txt
python app.py
```

## Render

- Build: `pip install -r requirements.txt`
- Start: `gunicorn app:app --bind 0.0.0.0:$PORT --workers 2 --threads 4 --timeout 60`
- Health: `/health`
