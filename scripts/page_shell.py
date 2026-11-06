"""Shared masthead and footer for the secondary pages, so they match index.html."""
HEAD = '''<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>{title}</title>
  <meta name="description" content="{description}">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,700;12..96,800&family=Source+Sans+3:ital,wght@0,400;0,600;1,400&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="styles.css">
  <link rel="icon" href="img/favicon.svg" type="image/svg+xml">
</head>
<body>
  <header class="masthead">
    <div class="wrap masthead-inner">
      <a class="brand" href="index.html" aria-label="Valley Eats Today home">
        <svg class="brand-mark" viewBox="0 0 28 28" aria-hidden="true"><path d="M2 22 L10 8 L14 14 L18 6 L26 22 Z" fill="currentColor"/><path d="M2 24 H26" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        <span class="brand-name">Valley Eats Today</span>
      </a>
      <nav class="masthead-nav" aria-label="Site">
        <a href="credits.html"{credits_current}>Photo credits</a>
        <a href="terms.html"{terms_current}>Terms</a>
      </nav>
    </div>
    <svg class="ridge" viewBox="0 0 1200 34" preserveAspectRatio="none" aria-hidden="true"><polygon points="0,34 0,26 90,20 170,24 260,10 340,18 430,12 520,22 600,6 690,16 780,10 870,20 960,14 1050,22 1130,16 1200,20 1200,34"/></svg>
  </header>
'''
FOOT = '''
  <footer class="site-footer">
    <div class="wrap">
      <div><h2>Valley Eats Today</h2><p>Restaurants open today in North Bend and Snoqualmie, Washington.</p><p><a href="index.html">Back to the list</a></p></div>
      <div><h2>More</h2><p><a href="credits.html">Photo credits</a> · <a href="terms.html">Terms and privacy</a> · <a href="https://github.com/brwnll/valley-eats">Source on GitHub</a></p></div>
    </div>
  </footer>
</body>
</html>
'''

def shell(title, description, body, current=None):
    return HEAD.format(title=title, description=description,
                       credits_current=' aria-current="page"' if current == "credits" else "",
                       terms_current=' aria-current="page"' if current == "terms" else "") + body + FOOT
