/* Home screen support, loaded on every page.
   - Registers sw.js, which keeps a copy of the site so it opens on a weak or missing signal.
   - On phones, fills #install-hint (where a page has one) with a one-time tip for adding the site to the home
     screen: an Install button where the browser offers one (Chrome on Android), or where to find
     Add to Home Screen on iPhone and iPad. Closing the tip hides it for good on that device. */
(function () {
  'use strict';

  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () { /* the site still works without it */ }); });
  }

  var KEY = 'valley-eats-install-hint-v1';
  var box = document.getElementById('install-hint');
  if (!box) return;

  function media(q) { return !!(window.matchMedia && window.matchMedia(q).matches); }
  function standalone() { return media('(display-mode: standalone)') || navigator.standalone === true; }
  function dismissed() { try { return !!localStorage.getItem(KEY); } catch (e) { return false; } }
  if (standalone() || dismissed()) return;

  var ua = navigator.userAgent || '';
  var ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  // In-app browsers (Facebook, Instagram, the Google app) have no Add to Home Screen, so skip the tip there.
  var iosCanAdd = ios && /Safari\//.test(ua) && !/FBAN|FBAV|Instagram|Line\/|GSA\//.test(ua);
  var deferred = null;

  function render(canPrompt) {
    box.innerHTML = '<img src="img/icons/icon-192.png" alt="" width="40" height="40">' +
      '<p><strong>Put Valley Eats on your home screen.</strong> ' +
      (canPrompt ? 'It opens like an app and still works on a weak signal.'
        : 'Open the Share menu and choose Add to Home Screen. It opens like an app and still works on a weak signal.') + '</p>' +
      '<div class="install-actions">' +
        (canPrompt ? '<button type="button" class="install-go">Install</button>' : '') +
        '<button type="button" class="install-x" aria-label="Close and don’t show this again">' +
          '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" fill="none"/></svg></button>' +
      '</div>';
    box.hidden = false;
  }

  box.addEventListener('click', function (e) {
    if (e.target.closest('.install-x')) {
      try { localStorage.setItem(KEY, String(Date.now())); } catch (err) { /* private mode: it just comes back next time */ }
      box.hidden = true;
    } else if (e.target.closest('.install-go') && deferred) {
      var ev = deferred; deferred = null;
      ev.prompt();
      ev.userChoice.then(function (choice) { if (choice && choice.outcome === 'accepted') box.hidden = true; }, function () {});
    }
  });

  window.addEventListener('beforeinstallprompt', function (e) {
    if (!media('(pointer: coarse)')) return;   // desktop browsers show their own install button
    e.preventDefault();
    deferred = e;
    render(true);
  });
  window.addEventListener('appinstalled', function () { box.hidden = true; });

  if (iosCanAdd) render(false);
})();
