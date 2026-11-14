#!/usr/bin/env python3
"""Generate terms.html using the shared page shell."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from page_shell import shell
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
body = '''
  <main class="wrap">
    <div class="page">
      <h1>Terms and privacy</h1>
      <p class="lede">Valley Eats Today is a free, informational list of restaurants in North Bend and Snoqualmie, Washington.</p>
      <h2>Terms of use</h2>
      <p>Hours, menus, and dishes are compiled from public sources and can be wrong or out of date. Check with the restaurant before you rely on anything here. The site is provided as is, without warranty of any kind.</p>
      <p>Restaurant photos and ratings come from Google Maps Platform. By using this site you agree that your use of that content is also governed by the <a href="https://policies.google.com/terms" target="_blank" rel="noopener">Google Terms of Service</a>. Dish photos are openly licensed images from Wikimedia Commons; see the <a href="credits.html">photo credits</a>.</p>
      <h2>Privacy</h2>
      <p>This site has no accounts and no analytics. It is hosted on GitHub Pages, which keeps ordinary server logs under <a href="https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement" target="_blank" rel="noopener">GitHub's privacy statement</a>. Fonts load from Google Fonts, and restaurant photos load from Google, so Google receives the requests your browser makes for them under the <a href="https://policies.google.com/privacy" target="_blank" rel="noopener">Google Privacy Policy</a>.</p>
      <p>Dish Match saves games in progress in your browser. One-phone games stay on your device. Two-phone games are kept in a small record on Google Firebase so both phones can sync: the day and filters you picked, the first names you typed, how far each of you got, and which dishes each of you liked. Only someone with the game link can open that record, and records can't be listed or searched. Use a first name or nickname, not anything you'd mind sharing.</p>
    </div>
  </main>'''
open(os.path.join(ROOT, "terms.html"), "w", encoding="utf-8").write(
    shell("Terms and Privacy", "Terms of use and privacy notes for Valley Eats Today.", body, current="terms"))
print("terms.html written")
