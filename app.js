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
    // Still open from a range that started yesterday and ran past midnight.
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

  // ---- State ----
  var now = pacificNow();
  var params = new URLSearchParams(location.search);
  var state = {
    day: DAY_KEYS.indexOf(params.get('day')) >= 0 ? params.get('day') : now.dayKey,
    town: 'all',
    query: '',
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

  function matchesQuery(place, q) {
    if (!q) return true;
    var hay = [place.name, place.cuisine, place.town, place.description].concat(place.dishes || []).join(' ').toLowerCase();
    return q.split(/\s+/).every(function (word) { return hay.indexOf(word) >= 0; });
  }

  function cardHTML(place, dayKey, isToday) {
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
      ? '<p class="dishes-label">Popular dishes</p><ol class="dishes">' + dishes.map(function (d) { return '<li>' + esc(d) + '</li>'; }).join('') + '</ol>'
      : '';

    var links = [];
    if (place.address) links.push('<a href="https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(place.name + ', ' + place.address) + '" target="_blank" rel="noopener">' + esc(place.address.replace(/,\s*(North Bend|Snoqualmie),\s*WA.*$/i, '')) + '</a>');
    if (place.phone) links.push('<a href="tel:' + esc(place.phone.replace(/[^\d+]/g, '')) + '">' + esc(place.phone) + '</a>');
    if (place.website) links.push('<a href="' + esc(place.website) + '" target="_blank" rel="noopener">Website</a>');

    return '<article class="card' + (openThatDay ? '' : ' is-closed') + '">' +
      '<div><h3>' + esc(place.name) + '</h3>' +
      '<div class="meta"><span class="badge ' + townClass + '">' + esc(place.town) + '</span>' +
      (place.cuisine ? '<span>' + esc(place.cuisine) + '</span>' : '') +
      (place.price ? '<span>' + esc(place.price) + '</span>' : '') +
      (place.chain ? '<span class="badge chain">Chain</span>' : '') +
      '</div></div>' +
      '<p class="hours">' + hoursLine + '</p>' +
      dishesHTML +
      (place.description ? '<p class="desc">' + esc(place.description) + '</p>' : '') +
      (links.length ? '<div class="links">' + links.join('') + '</div>' : '') +
      '</article>';
  }

  function render() {
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
      (q ? ' matching “' + state.query.trim() + '”' : '') + '.';

    if (!visible.length) {
      results.innerHTML = '<div class="empty">Nothing matches. Try another day, clear the search, or tick “Show places closed that day”.</div>';
      return;
    }

    var html = '';
    TOWN_ORDER.concat(Object.keys(visible.reduce(function (acc, p) { acc[p.town] = 1; return acc; }, {})).filter(function (t) { return TOWN_ORDER.indexOf(t) < 0; }))
      .forEach(function (town) {
        var inTown = visible.filter(function (p) { return p.town === town; });
        if (!inTown.length) return;
        inTown.sort(function (a, b) {
          var ao = !!hoursFor(a, dayKey), bo = !!hoursFor(b, dayKey);
          if (ao !== bo) return ao ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
        var openInTown = inTown.filter(function (p) { return !!hoursFor(p, dayKey); }).length;
        html += '<section class="town-section"><h2>' + esc(town) + ' <span class="count">' + openInTown + ' open</span></h2><div class="grid">' +
          inTown.map(function (p) { return cardHTML(p, dayKey, isToday); }).join('') + '</div></section>';
      });
    results.innerHTML = html;
  }

  // ---- Wire up controls ----
  $('#search').addEventListener('input', function (e) { state.query = e.target.value; render(); });
  $('#show-closed').addEventListener('change', function (e) { state.showClosed = e.target.checked; render(); });
  $('#hide-chains').addEventListener('change', function (e) { state.hideChains = e.target.checked; render(); });
  Array.prototype.forEach.call(document.querySelectorAll('#town-filter button'), function (b) {
    b.addEventListener('click', function () {
      state.town = b.dataset.town;
      Array.prototype.forEach.call(document.querySelectorAll('#town-filter button'), function (x) {
        var on = x === b; x.classList.toggle('is-active', on); x.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      render();
    });
  });

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
