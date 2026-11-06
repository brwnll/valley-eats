#!/usr/bin/env python3
"""Generate credits.html from img/dishes/credits.json. Run after changing any dish photo."""
import html, json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from page_shell import shell
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
credits = json.load(open(os.path.join(ROOT, "img/dishes/credits.json"), encoding="utf-8"))
rows = []
for key in sorted(credits):
    c = credits[key]
    artist = c.get("artist") or "Unknown photographer"
    rows.append(
        f'<li><img src="{html.escape(c["file"])}" alt="" width="56" height="56" loading="lazy">'
        f'<div><b>{html.escape(key.replace("-", " "))}</b><br>'
        f'<a href="{html.escape(c.get("page") or "")}" target="_blank" rel="noopener">{html.escape(c["title"].replace("File:", ""))}</a><br>'
        f'<span class="muted">{html.escape(artist)} · {html.escape(c["license"])}</span></div></li>')
body = f'''
  <main class="wrap">
    <div class="page">
      <h1>Photo credits</h1>
      <p class="lede">The dish pictures on the main page are representative photos of each kind of dish, taken from Wikimedia Commons under open licenses. They were not taken at the restaurants listed.</p>
      <p>Each entry links to its source page, where the full license text is available. Restaurant photos, where shown, come from Google Maps and are credited on the photo itself.</p>
    </div>
    <ul class="credits">
      {"".join(rows)}
    </ul>
    <p class="summary">{len(rows)} photos. Licenses are as stated on Wikimedia Commons at the time of download.</p>
  </main>'''
open(os.path.join(ROOT, "credits.html"), "w", encoding="utf-8").write(
    shell("Photo Credits", "Sources and licenses for the dish photos used on Valley Eats Today.", body, current="credits"))
print("credits.html:", len(rows), "entries")
