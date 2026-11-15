/* Valley Eats service worker: keeps a copy of the site on the phone so it opens on a weak or missing signal.

   - Pages, scripts, styles and data: fetched fresh when the network answers within a few seconds; otherwise the
     saved copy is shown. Every fresh copy replaces the saved one, so the site never gets stuck on an old version.
   - Dish photos, icons and fonts: the saved copy is used once there is one.
   - Left alone (straight to the network, never saved): Google Places lookups and restaurant photos, which
     Google's terms don't allow caching, and the Dish Match database.

   Bump VERSION to drop everything saved by older versions. */
var VERSION = 'v1';
var SHELL = 'valley-eats-shell-' + VERSION;
var MEDIA = 'valley-eats-media-' + VERSION;
var WAIT_MS = 3000;
var SHELL_FILES = [
  './', 'index.html', 'play.html', 'credits.html', 'terms.html',
  'styles.css', 'play.css', 'app.js', 'play.js', 'data.js', 'places.js', 'config.js', 'pwa.js',
  'manifest.webmanifest', 'img/favicon.svg', 'img/google-maps-logo-white.svg', 'img/icons/icon-192.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(caches.open(SHELL).then(function (cache) {
    return cache.addAll(SHELL_FILES.map(function (url) { return new Request(url, { cache: 'reload' }); }));
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (event) {
  event.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf('valley-eats-') === 0 && k !== SHELL && k !== MEDIA; })
      .map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin === self.location.origin) {
    var scope = new URL(self.registration.scope).pathname;
    if (url.pathname.indexOf(scope) !== 0) return;
    if (/\/img\//.test(url.pathname)) event.respondWith(savedFirst(req));
    else event.respondWith(freshFirst(req));
  } else if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(savedFirst(req));
  }
});

// index.html?day=sat and ./ are the same file, so save pages under one address.
function shellKey(req) {
  var u = new URL(req.url);
  u.search = ''; u.hash = '';
  if (/\/$/.test(u.pathname)) u.pathname += 'index.html';
  return u.href;
}

// After one request has had to wait, the network is treated as slow for a little while: the page's other files
// come straight from the saved copies (still refreshed in the background) instead of each waiting again.
var slowUntil = 0;
var SLOW_MS = 30000;

function freshFirst(req) {
  var key = shellKey(req);
  function saved() { return caches.open(SHELL).then(function (c) { return c.match(key); }); }
  return new Promise(function (resolve) {
    var done = false;
    function answer(res) { if (!done && res) { done = true; resolve(res); } }
    // Slow network: show the saved copy after a few seconds and let the fresh one replace it for next time.
    var timer = setTimeout(function () {
      saved().then(function (res) { if (res) slowUntil = Date.now() + SLOW_MS; answer(res); });
    }, Date.now() < slowUntil ? 0 : WAIT_MS);
    fetch(req).then(function (res) {
      clearTimeout(timer);
      slowUntil = 0;
      if (res.ok && res.type === 'basic' && !res.redirected) {
        var copy = res.clone();
        caches.open(SHELL).then(function (c) { return c.put(key, copy); });
      }
      answer(res);
    }, function () {
      clearTimeout(timer);
      saved().then(function (res) { answer(res || Response.error()); });
    });
  });
}

function savedFirst(req) {
  return caches.match(req).then(function (hit) {
    return hit || fetch(req).then(function (res) {
      if (res.ok || res.type === 'opaque') {
        var copy = res.clone();
        caches.open(MEDIA).then(function (c) { return c.put(req, copy); });
      }
      return res;
    });
  });
}
