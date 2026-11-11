/* Valley Eats Today — filters the restaurant list in data.js by day of week.
   Everything runs in the browser; there is no build step. */
(function () {
  'use strict';

  var TZ = 'America/Los_Angeles';
  var DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  var DAY_NAMES = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };
  var TOWN_ORDER = ['North Bend', 'Snoqualmie'];

  var data = Array.isArray(window.RESTAURANTS) ? window.RESTAURANTS : [];
  var meta = window.RESTAURANTS_META || {};

  // ---- Google Places photos (optional; needs a key in config.js and place IDs in places.js) ----
  // Google's terms let a site store place IDs but not photos or photo references. So each photo is looked up
  // by the visitor's browser when its card comes into view, and is kept only for this page view.
  var PLACES = window.PLACES || {};
  var API_KEY = window.PLACES_API_KEY || '';
  var PLACES_BASE = 'https://places.googleapis.com/v1/';
  var photosEnabled = !!API_KEY && !!window.fetch && 'IntersectionObserver' in window;
  var photoCache = {};      // placeId -> { uri, author, authorUri }, or null when Google has no photo to give
  var photoPending = {};    // placeId -> true while a lookup is running
  var photoHits = 0, missesInARow = 0;
  var photoObserver = null, dwellTimers = typeof WeakMap === 'function' ? new WeakMap() : null;

  function placeIdFor(place) {
    var pl = PLACES[place.name + '|' + place.town];
    return (pl && pl.placeId) || '';
  }

  function googlePhotoInner(photo) {
    var author = photo.author
      ? ' · ' + (photo.authorUri ? '<a href="' + esc(photo.authorUri) + '" target="_blank" rel="noopener">' + esc(photo.author) + '</a>' : esc(photo.author))
      : '';
    return '<img src="' + esc(photo.uri) + '" alt="" decoding="async" onerror="this.parentNode.remove()">' +
      '<span class="photo-credit"><img class="glogo" src="img/google-maps-logo-white.svg" alt="Google Maps">' + author + '</span>';
  }

  function cardsFor(placeId) {
    return Array.prototype.filter.call(document.querySelectorAll('.card[data-place-id]'), function (c) { return c.getAttribute('data-place-id') === placeId; });
  }

  function loadPhoto(placeId) {
    if (!photosEnabled || photoPending[placeId] || (placeId in photoCache)) return;
    photoPending[placeId] = true;
    var key = encodeURIComponent(API_KEY);
    fetch(PLACES_BASE + 'places/' + encodeURIComponent(placeId) + '?fields=photos&key=' + key)
      .then(function (r) { if (!r.ok) throw new Error('details ' + r.status); return r.json(); })
      .then(function (d) {
        var photos = d.photos || [], pick = null;
        for (var i = 0; i < photos.length && i < 5; i++) {
          if ((photos[i].widthPx || 0) >= (photos[i].heightPx || 0)) { pick = photos[i]; break; }
        }
        pick = pick || photos[0];
        if (!pick) return null;
        // skipHttpRedirect returns the image address as JSON, so the photo is requested from Google once per page view.
        return fetch(PLACES_BASE + pick.name + '/media?maxWidthPx=640&maxHeightPx=360&skipHttpRedirect=true&key=' + key)
          .then(function (r) { if (!r.ok) throw new Error('photo ' + r.status); return r.json(); })
          .then(function (m) {
            var a = (pick.authorAttributions || [])[0] || {};
            return m.photoUri ? { uri: m.photoUri, author: a.displayName || '', authorUri: a.uri || '' } : null;
          });
      })
      .then(function (photo) { photoDone(placeId, photo); }, function () { photoDone(placeId, null); });
  }

  function photoDone(placeId, photo) {
    delete photoPending[placeId];
    photoCache[placeId] = photo;
    cardsFor(placeId).forEach(function (card) {
      card.removeAttribute('data-photo-pending');
      var slot = card.querySelector('.photo.is-loading');
      if (!photo) { if (slot) slot.remove(); return; }
      if (slot) { slot.classList.remove('is-loading'); slot.innerHTML = googlePhotoInner(photo); }
      else card.insertAdjacentHTML('afterbegin', '<div class="photo">' + googlePhotoInner(photo) + '</div>');
    });
    if (photo) { photoHits++; missesInARow = 0; return; }
    if (++missesInARow >= 3) {
      // Nothing is coming back: the Google project has no billing account, or today's request cap is used up.
      // Stop asking for the rest of this page view.
      photosEnabled = false;
      if (photoObserver) photoObserver.disconnect();
      Array.prototype.forEach.call(document.querySelectorAll('.photo.is-loading'), function (el) { el.remove(); });
    }
  }

  // Look a photo up only after its card has stayed near the viewport for a moment, so a fast scroll
  // down the page does not request every photo on it.
  function watchPhotos() {
    if (!photosEnabled) return;
    if (!photoObserver) {
      photoObserver = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          var card = entry.target, id = card.getAttribute('data-place-id');
          var timer = dwellTimers && dwellTimers.get(card);
          if (entry.isIntersecting && !timer) {
            timer = setTimeout(function () { photoObserver.unobserve(card); loadPhoto(id); }, 350);
            if (dwellTimers) dwellTimers.set(card, timer);
          } else if (!entry.isIntersecting && timer) {
            clearTimeout(timer); dwellTimers.delete(card);
          }
        });
      }, { rootMargin: '200px 0px' });
    }
    photoObserver.disconnect();
    Array.prototype.forEach.call(document.querySelectorAll('.card[data-photo-pending]'), function (card) { photoObserver.observe(card); });
  }

  // ---- Time helpers (always in Pacific time, so visitors elsewhere see the valley's day) ----
  function pacificNow() {
    var fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: TZ, weekday: 'short', hour: 'numeric', minute: 'numeric', hour12: false,
      month: 'long', day: 'numeric', year: 'numeric'
    });
    var parts = {};
    fmt.formatToParts(new Date()).forEach(function (p) { parts[p.type] = p.value; });
    var hour = parseInt(parts.hour, 10); if (hour === 24) hour = 0;
    var minute = parseInt(parts.minute, 10);
    var dayKey = parts.weekday.toLowerCase().slice(0, 3);
    var longDay = DAY_NAMES[dayKey] || parts.weekday;
    return {
      dayKey: dayKey,
      minutes: hour * 60 + minute,
      dateLabel: longDay + ', ' + parts.month + ' ' + parts.day + ', ' + parts.year
    };
  }

  function toMinutes(hhmm) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || '');
    if (!m) return null;
    return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  }

  function fmtTime(hhmm) {
    var mins = toMinutes(hhmm);
    if (mins === null) return hhmm;
    var h = Math.floor(mins / 60) % 24, mm = mins % 60;
    var suffix = h >= 12 ? 'PM' : 'AM';
    var h12 = h % 12; if (h12 === 0) h12 = 12;
    return h12 + (mm ? ':' + (mm < 10 ? '0' + mm : mm) : '') + ' ' + suffix;
  }

  // A range that closes at or before it opens is treated as running past midnight.
  function rangeSpan(range) {
    var open = toMinutes(range[0]), close = toMinutes(range[1]);
    if (open === null || close === null) return null;
    if (close <= open) close += 24 * 60;
    return { open: open, close: close };
  }

  function hoursFor(place, dayKey) {
    var h = place.hours || {};
    var ranges = h[dayKey];
    return Array.isArray(ranges) && ranges.length ? ranges : null;
  }

  function fmtRanges(ranges) {
    return ranges.map(function (r) { return fmtTime(r[0]) + ' – ' + fmtTime(r[1]); }).join(', ');
  }

  // Returns 'open', 'soon' (opens within 60 min), 'closing' (closes within 60 min), or 'closed' for right now.
  function statusNow(place, now) {
    var today = hoursFor(place, now.dayKey) || [];
    var prevKey = DAY_KEYS[(DAY_KEYS.indexOf(now.dayKey) + 6) % 7];
    var yesterday = hoursFor(place, prevKey) || [];
    var i, span, t = now.minutes;

    for (i = 0; i < today.length; i++) {
      span = rangeSpan(today[i]); if (!span) continue;
      if (t >= span.open && t < span.close) return (span.close - t) <= 60 ? 'closing' : 'open';
    }
    for (i = 0; i < yesterday.length; i++) {
      span = rangeSpan(yesterday[i]); if (!span) continue;
      if (span.close > 24 * 60 && t + 24 * 60 < span.close) return 'open';
    }
    for (i = 0; i < today.length; i++) {
      span = rangeSpan(today[i]); if (!span) continue;
      if (t < span.open && span.open - t <= 60) return 'soon';
    }
    return 'closed';
  }

  // ---- Popularity: review counts from Google and Yelp, gathered when the data was compiled ----
  function popularity(place) {
    if (typeof place.popularity === 'number') return place.popularity;
    return (place.googleReviews || 0) + (place.yelpReviews || 0);
  }

  function fmtCount(n) {
    if (n >= 1000) return (Math.round(n / 100) / 10).toFixed(1).replace(/\.0$/, '') + 'k';
    return String(n);
  }

  function ratingHTML(place) {
    var src, rating, count;
    if (place.googleReviews) { src = 'Google'; rating = place.googleRating; count = place.googleReviews; }
    else if (place.yelpReviews) { src = 'Yelp'; rating = place.yelpRating; count = place.yelpReviews; }
    else return '';
    return '<span class="rating" title="' + esc(src) + ' rating and review count when this list was compiled">' +
      (rating ? '<span class="star">★</span> ' + esc(rating.toFixed(1)) + ' · ' : '') +
      esc(fmtCount(count)) + ' ' + esc(src) + ' reviews</span>';
  }

  // ---- State ----
  var now = pacificNow();
  var params = new URLSearchParams(location.search);
  var state = {
    day: DAY_KEYS.indexOf(params.get('day')) >= 0 ? params.get('day') : now.dayKey,
    town: 'all',
    query: '',
    sort: params.get('sort') === 'name' ? 'name' : 'popular',
    showClosed: false,
    hideChains: false
  };

  // ---- DOM ----
  var $ = function (sel) { return document.querySelector(sel); };
  var dayPicker = $('#day-picker');
  var results = $('#results');
  var summary = $('#summary');
  var dayWord = $('#day-word');
  var dateLine = $('#date-line');

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function buildDayPicker() {
    dayPicker.innerHTML = '';
    DAY_KEYS.forEach(function (key) {
      var b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.dataset.day = key;
      var isToday = key === now.dayKey;
      b.className = (key === state.day ? 'is-active ' : '') + (isToday ? 'is-today' : '');
      b.setAttribute('aria-selected', key === state.day ? 'true' : 'false');
      b.innerHTML = esc(DAY_NAMES[key].slice(0, 3)) + '<small>' + (isToday ? 'today' : '&nbsp;') + '</small>';
      b.addEventListener('click', function () {
        state.day = key;
        var url = new URL(location.href);
        if (key === now.dayKey) url.searchParams.delete('day'); else url.searchParams.set('day', key);
        history.replaceState(null, '', url);
        buildDayPicker();
        render();
      });
      dayPicker.appendChild(b);
    });
  }

  function dishName(d) { return typeof d === 'string' ? d : (d && d.name) || ''; }
  function dishImage(d) { return typeof d === 'string' ? '' : (d && d.image) || ''; }

  function matchesQuery(place, q) {
    if (!q) return true;
    var hay = [place.name, place.cuisine, place.town, place.description].concat((place.dishes || []).map(dishName)).join(' ').toLowerCase();
    return q.split(/\s+/).every(function (word) { return hay.indexOf(word) >= 0; });
  }

  // Returns { html, attrs } for the top of a card: a hand-set photo, a Google photo already looked up
  // during this page view, or a marker that tells watchPhotos() to look one up.
  function photoFor(place) {
    // A photo set by hand in data.js wins: place.photo = { url, credit, creditUrl }
    if (place.photo && place.photo.url) {
      var credit = place.photo.credit
        ? '<span class="photo-credit">' + (place.photo.creditUrl ? '<a href="' + esc(place.photo.creditUrl) + '" target="_blank" rel="noopener">' + esc(place.photo.credit) + '</a>' : esc(place.photo.credit)) + '</span>'
        : '';
      return { html: '<div class="photo"><img src="' + esc(place.photo.url) + '" alt="" loading="lazy" decoding="async" onerror="this.parentNode.remove()">' + credit + '</div>', attrs: '' };
    }
    var id = placeIdFor(place);
    if (!id) return { html: '', attrs: '' };
    var idAttr = ' data-place-id="' + esc(id) + '"';
    if (photoCache[id]) return { html: '<div class="photo">' + googlePhotoInner(photoCache[id]) + '</div>', attrs: idAttr };
    if (!photosEnabled || (id in photoCache)) return { html: '', attrs: '' };
    // Once photos are known to be coming back, hold their space so cards do not jump as they arrive.
    return { html: photoHits ? '<div class="photo is-loading"></div>' : '', attrs: idAttr + ' data-photo-pending' };
  }

  function cardHTML(place, dayKey, isToday, rank) {
    var ranges = hoursFor(place, dayKey);
    var openThatDay = !!ranges;
    var status = isToday && openThatDay ? statusNow(place, now) : null;
    var townClass = place.town === 'North Bend' ? 'nb' : 'sq';
    var lowConfidence = place.hoursConfidence === 'low';

    var hoursLine;
    if (openThatDay) {
      hoursLine = '<span class="label">' + (isToday ? 'Today' : esc(DAY_NAMES[dayKey])) + ':</span> <strong>' + esc(fmtRanges(ranges)) + '</strong>';
      if (status === 'open') hoursLine += ' <span class="pill open">Open now</span>';
      else if (status === 'closing') hoursLine += ' <span class="pill soon">Closing soon</span>';
      else if (status === 'soon') hoursLine += ' <span class="pill soon">Opens soon</span>';
      else if (status === 'closed') hoursLine += ' <span class="pill closed">Closed right now</span>';
    } else {
      hoursLine = '<span class="pill closed">Closed ' + (isToday ? 'today' : 'on ' + esc(DAY_NAMES[dayKey])) + '</span>';
    }
    if (lowConfidence) hoursLine += ' <span class="pill unverified" title="We could not confirm these hours from a reliable source.">Hours unverified</span>';

    var dishes = (place.dishes || []).slice(0, 5);
    var dishesHTML = dishes.length
      ? '<p class="dishes-label">Popular dishes</p><ol class="dishes">' + dishes.map(function (d, i) {
          var img = dishImage(d);
          return '<li>' +
            (img ? '<img src="' + esc(img) + '" alt="" width="56" height="56" loading="lazy" decoding="async" title="Representative photo of this kind of dish, not the restaurant\'s own">'
                 : '<span class="dish-placeholder" aria-hidden="true"></span>') +
            '<span class="dish-num">' + (i + 1) + '</span><span class="dish-name">' + esc(dishName(d)) + '</span></li>';
        }).join('') + '</ol>'
      : '';

    var links = [];
    if (place.address) links.push('<a href="https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(place.name + ', ' + place.address) + '" target="_blank" rel="noopener">' + esc(place.address.replace(/,\s*(North Bend|Snoqualmie),\s*WA.*$/i, '')) + '</a>');
    if (place.phone) links.push('<a href="tel:' + esc(place.phone.replace(/[^\d+]/g, '')) + '">' + esc(place.phone) + '</a>');
    if (place.website) links.push('<a href="' + esc(place.website) + '" target="_blank" rel="noopener">Website</a>');

    var photo = photoFor(place);
    return '<article class="card' + (openThatDay ? '' : ' is-closed') + '"' + photo.attrs + '>' +
      photo.html +
      '<div class="card-head">' +
      (rank ? '<span class="rank" title="Rank by review count">#' + rank + '</span>' : '') +
      '<div><h3>' + esc(place.name) + '</h3>' +
      '<div class="meta"><span class="badge ' + townClass + '">' + esc(place.town) + '</span>' +
      (place.cuisine ? '<span>' + esc(place.cuisine) + '</span>' : '') +
      (place.price ? '<span>' + esc(place.price) + '</span>' : '') +
      (place.chain ? '<span class="badge chain">Chain</span>' : '') +
      '</div>' + ratingHTML(place) + '</div></div>' +
      '<p class="hours">' + hoursLine + '</p>' +
      dishesHTML +
      (place.description ? '<p class="desc">' + esc(place.description) + '</p>' : '') +
      (links.length ? '<div class="links">' + links.join('') + '</div>' : '') +
      '</article>';
  }

  var lastHtml = null;

  function render() {
    markActiveFilters();
    var dayKey = state.day;
    var isToday = dayKey === now.dayKey;
    var q = state.query.trim().toLowerCase();

    dayWord.textContent = isToday ? 'today' : 'on ' + DAY_NAMES[dayKey];
    dateLine.textContent = isToday
      ? now.dateLabel
      : 'Showing ' + DAY_NAMES[dayKey] + ' hours. Today is ' + now.dateLabel + '.';

    var visible = data.filter(function (p) {
      if (state.town !== 'all' && p.town !== state.town) return false;
      if (state.hideChains && p.chain) return false;
      if (!matchesQuery(p, q)) return false;
      if (!state.showClosed && !hoursFor(p, dayKey)) return false;
      return true;
    });

    var openCount = visible.filter(function (p) { return !!hoursFor(p, dayKey); }).length;
    var totalConsidered = data.filter(function (p) {
      return (state.town === 'all' || p.town === state.town) && !(state.hideChains && p.chain);
    }).length;

    summary.textContent = openCount + ' of ' + totalConsidered + ' places open ' + (isToday ? 'today' : 'on ' + DAY_NAMES[dayKey]) +
      (q ? ' matching “' + state.query.trim() + '”' : '') +
      (state.sort === 'popular' ? '. Most reviewed first.' : '. Alphabetical.');

    if (!visible.length) {
      lastHtml = null;
      results.innerHTML = '<div class="empty">Nothing matches. Try another day, clear the search, or tick “Show places closed that day”.</div>';
      return;
    }

    // Popularity rank is computed across the whole town list so the number means the same whatever filters are on.
    var rankByTown = {};
    TOWN_ORDER.forEach(function (town) {
      data.filter(function (p) { return p.town === town; })
        .sort(function (a, b) { return popularity(b) - popularity(a) || a.name.localeCompare(b.name); })
        .forEach(function (p, i) { rankByTown[town + '|' + p.name] = popularity(p) ? i + 1 : 0; });
    });

    function compare(a, b) {
      var ao = !!hoursFor(a, dayKey), bo = !!hoursFor(b, dayKey);
      if (ao !== bo) return ao ? -1 : 1;
      if (state.sort === 'popular') {
        var d = popularity(b) - popularity(a);
        if (d) return d;
      }
      return a.name.localeCompare(b.name);
    }

    var html = '';
    var towns = TOWN_ORDER.concat(Object.keys(visible.reduce(function (acc, p) { acc[p.town] = 1; return acc; }, {})).filter(function (t) { return TOWN_ORDER.indexOf(t) < 0; }));
    towns.forEach(function (town) {
      var inTown = visible.filter(function (p) { return p.town === town; });
      if (!inTown.length) return;
      inTown.sort(compare);
      var openInTown = inTown.filter(function (p) { return !!hoursFor(p, dayKey); }).length;
      var townTotal = data.filter(function (p) { return p.town === town && !(state.hideChains && p.chain); }).length;
      var other = towns.filter(function (t) { return t !== town && visible.some(function (p) { return p.town === t; }); })[0];
      var jump = other ? '<a class="jump" href="#town-' + esc(other.toLowerCase().replace(/\s+/g, '-')) + '">Jump to ' + esc(other) + ' ↓</a>' : '';
      html += '<section class="town-section" id="town-' + esc(town.toLowerCase().replace(/\s+/g, '-')) + '"><div class="town-head"><h2>' + esc(town) + '</h2><span class="count">' + openInTown + ' of ' + townTotal + ' open' + (isToday ? ' today' : '') + '</span>' + jump + '</div><div class="grid">' +
        inTown.map(function (p) { return cardHTML(p, dayKey, isToday, state.sort === 'popular' ? rankByTown[town + '|' + p.name] : 0); }).join('') + '</div></section>';
    });
    // The list is re-rendered every minute to keep the open/closed badges current. Leave the page alone
    // when nothing changed, so photos are not reloaded for no reason.
    if (html === lastHtml) return;
    lastHtml = html;
    results.innerHTML = html;
    watchPhotos();
  }

  // ---- Wire up controls ----
  $('#search').addEventListener('input', function (e) { state.query = e.target.value; render(); });
  $('#show-closed').addEventListener('change', function (e) { state.showClosed = e.target.checked; render(); });
  $('#hide-chains').addEventListener('change', function (e) { state.hideChains = e.target.checked; render(); });
  function wireSegmented(sel, key, after) {
    Array.prototype.forEach.call(document.querySelectorAll(sel + ' button'), function (b) {
      b.addEventListener('click', function () {
        state[key] = b.dataset[key];
        Array.prototype.forEach.call(document.querySelectorAll(sel + ' button'), function (x) {
          var on = x === b; x.classList.toggle('is-active', on); x.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
        if (after) after();
        render();
      });
    });
  }
  wireSegmented('#town-filter', 'town');
  wireSegmented('#sort-control', 'sort', function () {
    var url = new URL(location.href);
    if (state.sort === 'popular') url.searchParams.delete('sort'); else url.searchParams.set('sort', state.sort);
    history.replaceState(null, '', url);
  });
  if (state.sort === 'name') {
    Array.prototype.forEach.call(document.querySelectorAll('#sort-control button'), function (x) {
      var on = x.dataset.sort === 'name'; x.classList.toggle('is-active', on); x.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  var toolbar = $('.toolbar'), filtersToggle = $('#filters-toggle');
  if (filtersToggle) {
    filtersToggle.addEventListener('click', function () {
      var open = toolbar.classList.toggle('is-open');
      filtersToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      filtersToggle.textContent = open ? 'Hide filters' : 'Filters';
    });
  }
  function markActiveFilters() {
    if (!filtersToggle) return;
    var active = !!state.query.trim() || state.town !== 'all' || state.sort !== 'popular' || state.showClosed || state.hideChains;
    filtersToggle.classList.toggle('has-active', active);
  }

  var updated = $('#data-updated');
  if (updated) updated.textContent = meta.updated || 'recently';

  buildDayPicker();
  render();

  // Keep "open now" badges fresh if the tab stays open; roll the day over at midnight Pacific.
  setInterval(function () {
    var fresh = pacificNow();
    var dayChanged = fresh.dayKey !== now.dayKey;
    var wasOnToday = state.day === now.dayKey;
    now = fresh;
    if (dayChanged && wasOnToday) { state.day = now.dayKey; buildDayPicker(); }
    render();
  }, 60 * 1000);
})();
