/* Dish Match
   Two people swipe the same stack of dishes from restaurants open on a chosen day. When both like a dish
   from the same restaurant (not necessarily the same dish), that restaurant is a match.

   There is no server. "One phone" keeps everything on this device. "Two phones" puts the game in a link:
   the first player's likes travel after the # (never sent to the web server), the second player swipes the
   same stack, sees matches as they happen, and can send a results link back. Both players get the same
   stack because it is built from the same day, filters, and random seed. */
(function () {
  'use strict';

  var TZ = 'America/Los_Angeles';
  var DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  var DAY_NAMES = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };
  var TOWN_CODES = { 'all': 'a', 'North Bend': 'n', 'Snoqualmie': 's' };
  var TOWN_FROM_CODE = { a: 'all', n: 'North Bend', s: 'Snoqualmie' };
  var SIZES = [20, 40, 80];
  var DISHES_PER_PLACE = 2;          // first pass through the restaurants; later passes add more if the stack needs it
  var GAME_KEY = 'valley-eats-match-game-v1';
  var PREFS_KEY = 'valley-eats-match-prefs-v1';

  var DATA = Array.isArray(window.RESTAURANTS) ? window.RESTAURANTS : [];
  var DISH_INDEX = {};               // dish id -> { place, dish, image }

  // ---------- small helpers ----------
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function dishName(d) { return typeof d === 'string' ? d : (d && d.name) || ''; }
  function dishImage(d) { return typeof d === 'string' ? '' : (d && d.image) || ''; }
  function placeKey(p) { return p.name + '|' + p.town; }
  function popularity(p) { return typeof p.popularity === 'number' ? p.popularity : (p.googleReviews || 0) + (p.yelpReviews || 0); }
  function reduceMotion() { return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
  function storeGet(k) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
  function storeSet(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode: play still works, it just isn't saved */ } }

  // FNV-1a hash, so a liked dish can be named in a link with a few characters and still be found if data.js changes order.
  function dishId(place, name) {
    var s = place.name + '|' + place.town + '|' + name, h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(36);
  }

  // Seeded random numbers (mulberry32) so both players build the same stack.
  function seededRandom(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function shuffle(arr, rand) {
    for (var i = arr.length - 1; i > 0; i--) { var j = Math.floor(rand() * (i + 1)); var t = arr[i]; arr[i] = arr[j]; arr[j] = t; }
    return arr;
  }
  function newSeed() {
    try { return crypto.getRandomValues(new Uint32Array(1))[0]; } catch (e) { return Math.floor(Math.random() * 4294967296); }
  }

  // ---------- dates and hours (Pacific time) ----------
  function pacificNow() {
    var parts = {};
    new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: 'numeric', minute: 'numeric', hour12: false })
      .formatToParts(new Date()).forEach(function (p) { parts[p.type] = p.value; });
    var hour = parseInt(parts.hour, 10) % 24;
    return { iso: parts.year + '-' + parts.month + '-' + parts.day, minutes: hour * 60 + parseInt(parts.minute, 10) };
  }
  function isoDate(iso) { return new Date(iso + 'T12:00:00Z'); }
  function dayKeyOf(iso) { return DAY_KEYS[(isoDate(iso).getUTCDay() + 6) % 7]; }
  function addDays(iso, n) { var d = isoDate(iso); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function daysBetween(a, b) { return Math.round((isoDate(b) - isoDate(a)) / 864e5); }
  function longDate(iso) { return isoDate(iso).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric' }); }
  function shortDate(iso) { return isoDate(iso).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' }); }
  function relativeDay(iso) {
    var diff = daysBetween(pacificNow().iso, iso);
    if (diff === 0) return 'today';
    if (diff === 1) return 'tomorrow';
    return 'on ' + DAY_NAMES[dayKeyOf(iso)];
  }

  function toMinutes(hhmm) { var m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || ''); return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : null; }
  function fmtTime(hhmm) {
    var mins = toMinutes(hhmm); if (mins === null) return hhmm;
    var h = Math.floor(mins / 60) % 24, mm = mins % 60, h12 = h % 12 || 12;
    return h12 + (mm ? ':' + (mm < 10 ? '0' + mm : mm) : '') + (h >= 12 ? ' PM' : ' AM');
  }
  function hoursFor(place, dayKey) { var r = (place.hours || {})[dayKey]; return Array.isArray(r) && r.length ? r : null; }
  function fmtRanges(ranges) { return ranges.map(function (r) { return fmtTime(r[0]) + ' – ' + fmtTime(r[1]); }).join(', '); }
  function openNow(place) {
    var now = pacificNow(), t = now.minutes, key = dayKeyOf(now.iso), prev = DAY_KEYS[(DAY_KEYS.indexOf(key) + 6) % 7];
    function inRange(r, offset) {
      var o = toMinutes(r[0]), c = toMinutes(r[1]); if (o === null || c === null) return false;
      if (c <= o) c += 1440;
      return t + offset >= o && t + offset < c;
    }
    return (hoursFor(place, key) || []).some(function (r) { return inRange(r, 0); }) ||
      (hoursFor(place, prev) || []).some(function (r) { return inRange(r, 1440); });
  }

  // ---------- the stack of dishes ----------
  function buildIndex() {
    DATA.forEach(function (p) {
      (p.dishes || []).forEach(function (d) {
        var name = dishName(d); if (!name) return;
        DISH_INDEX[dishId(p, name)] = { place: p, dish: name, image: dishImage(d) };
      });
    });
  }

  function eligiblePlaces(opts) {
    var dayKey = dayKeyOf(opts.date);
    return DATA.filter(function (p) {
      if (opts.town !== 'all' && p.town !== opts.town) return false;
      if (opts.noChains && p.chain) return false;
      return !!hoursFor(p, dayKey) && (p.dishes || []).length > 0;
    });
  }

  function countDishes(places) { return places.reduce(function (n, p) { return n + (p.dishes || []).length; }, 0); }

  var deckCache = { key: '', cards: [] };
  function deckFor(g) {
    var key = [g.date, g.town, g.size, g.seed, g.noChains ? 1 : 0].join('|');
    if (deckCache.key === key) return deckCache.cards;
    var rand = seededRandom(g.seed);
    // Weighted random order (Efraimidis–Spirakis): well-reviewed places tend to come up first, but any place can.
    var order = eligiblePlaces(g).map(function (p) {
      return { place: p, k: Math.pow(rand(), 1 / Math.log(popularity(p) + 20)), dishes: shuffle((p.dishes || []).slice(), rand) };
    }).sort(function (a, b) { return b.k - a.k; });

    var cards = [], pass = 0;
    while (cards.length < g.size) {
      var added = false;
      for (var i = 0; i < order.length && cards.length < g.size; i++) {
        order[i].dishes.splice(0, pass === 0 ? DISHES_PER_PLACE : 1).forEach(function (d) {
          var name = dishName(d);
          cards.push({ id: dishId(order[i].place, name), place: order[i].place, dish: name, image: dishImage(d) });
          added = true;
        });
      }
      if (!added) break;
      pass++;
    }
    shuffle(cards, rand);
    // Keep two dishes from the same restaurant from landing back to back.
    for (var j = 1; j < cards.length; j++) {
      if (cards[j].place !== cards[j - 1].place) continue;
      for (var k = j + 1; k < cards.length; k++) {
        if (cards[k].place !== cards[j - 1].place) { var t = cards[j]; cards[j] = cards[k]; cards[k] = t; break; }
      }
    }
    deckCache = { key: key, cards: cards };
    return cards;
  }

  // ---------- links ----------
  function toB64(str) {
    var bytes = new TextEncoder().encode(str), bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function fromB64(s) {
    s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '=';
    var bin = atob(s), bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }
  function cleanName(x) { return String(x == null ? '' : x).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 24); }
  function cleanLikes(x) {
    var seen = {};
    return String(x == null ? '' : x).split('.').filter(function (t) {
      if (!/^[0-9a-z]{1,8}$/.test(t) || seen[t]) return false; seen[t] = 1; return true;
    }).slice(0, 400);
  }

  function linkFor(g, withResults) {
    var p = { v: 1, d: g.date, t: TOWN_CODES[g.town], n: g.size, s: g.seed, c: g.noChains ? 1 : 0,
      a: g.players[0].name, al: g.players[0].likes.join('.') };
    if (withResults) { p.b = g.players[1].name; p.bl = g.players[1].likes.join('.'); }
    else if (g.players[1].name) p.bn = g.players[1].name;   // a suggested name for the partner's invite screen
    return location.origin + location.pathname + '#g=' + toB64(JSON.stringify(p));
  }

  // Returns null when there is no game in the address, { error: true } when it can't be read, else the game.
  function readLink() {
    var m = /[#&]g=([A-Za-z0-9_-]+)/.exec(location.hash || '');
    if (!m) return null;
    var p;
    try { p = JSON.parse(fromB64(m[1])); } catch (e) { return { error: true }; }
    if (!p || p.v !== 1 || !/^\d{4}-\d{2}-\d{2}$/.test(p.d) || isNaN(isoDate(p.d)) || !TOWN_FROM_CODE[p.t]) return { error: true };
    var size = Math.max(5, Math.min(200, parseInt(p.n, 10) || 20));
    var g = newGame({ date: p.d, town: TOWN_FROM_CODE[p.t], size: size, noChains: p.c === 1, mode: 'link',
      p1: cleanName(p.a) || 'Player 1', p2: cleanName(p.b != null ? p.b : p.bn), seed: (Number(p.s) >>> 0) });
    g.players[0].likes = cleanLikes(p.al);
    g.players[0].done = true;
    g.turn = 1;
    if (p.bl != null) {
      g.players[1].name = cleanName(p.b) || 'Player 2';
      g.players[1].likes = cleanLikes(p.bl);
      g.players[1].done = true;
      g.stage = 'results';
      g.role = 'viewer';
    } else {
      g.stage = 'invite';
      g.role = 'guest';
    }
    return g;
  }

  // ---------- game state ----------
  var game = null;

  function newGame(o) {
    return {
      v: 1, date: o.date, town: o.town, size: o.size, noChains: !!o.noChains, seed: o.seed != null ? o.seed >>> 0 : newSeed(),
      mode: o.mode, role: o.mode === 'link' ? 'host' : 'local',
      players: [{ name: o.p1 || 'Player 1', likes: [], done: false }, { name: o.p2 || '', likes: [], done: false }],
      turn: 0, pos: 0, stage: 'swipe', announced: [], updated: Date.now()
    };
  }
  function sameGame(a, b) { return a && b && a.seed === b.seed && a.date === b.date && a.players[0].name === b.players[0].name; }
  function save() { if (game) { game.updated = Date.now(); storeSet(GAME_KEY, game); } }
  function partnerName(g) { return g.players[1].name || 'your partner'; }
  function secondName(g) { return g.players[1].name || 'Player 2'; }

  // ---------- screens ----------
  var SCREENS = ['setup', 'invite', 'swipe', 'handoff', 'send', 'results'];
  function show(name) {
    SCREENS.forEach(function (s) { $('screen-' + s).hidden = s !== name; });
    document.body.setAttribute('data-screen', name);
    window.scrollTo(0, 0);
    var h = document.querySelector('#screen-' + name + ' h1');
    if (h && name !== 'setup') { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
  }

  // ---------- setup ----------
  var prefs = storeGet(PREFS_KEY) || {};
  var setupState = { town: prefs.town || 'all', size: SIZES.indexOf(prefs.size) >= 0 ? prefs.size : 20 };

  function wireSegmented(id, key, after) {
    var btns = document.querySelectorAll('#' + id + ' button');
    function mark() {
      Array.prototype.forEach.call(btns, function (b) {
        var on = String(setupState[key]) === b.getAttribute('data-value');
        b.classList.toggle('is-active', on); b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
    }
    Array.prototype.forEach.call(btns, function (b) {
      b.addEventListener('click', function () {
        var v = b.getAttribute('data-value');
        setupState[key] = key === 'size' ? parseInt(v, 10) : v;
        mark(); if (after) after();
      });
    });
    mark();
    return mark;
  }

  function setupOptions() {
    return { date: $('when').value, town: setupState.town, size: setupState.size, noChains: $('no-chains').checked,
      mode: $('mode-link').checked ? 'link' : 'same', p1: cleanName($('p1-name').value), p2: cleanName($('p2-name').value) };
  }

  function fillWhen() {
    var today = pacificNow().iso, sel = $('when'), keep = sel.value, opts = setupOptions();
    sel.innerHTML = '';
    for (var i = 0; i < 7; i++) {
      var iso = addDays(today, i);
      var n = eligiblePlaces({ date: iso, town: opts.town, noChains: opts.noChains }).length;
      var lead = i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : DAY_NAMES[dayKeyOf(iso)];
      var o = document.createElement('option');
      o.value = iso;
      o.textContent = lead + ', ' + (i < 2 ? DAY_NAMES[dayKeyOf(iso)] + ' ' : '') + shortDate(iso) + ' · ' + n + ' places open';
      sel.appendChild(o);
    }
    if (keep && sel.querySelector('option[value="' + keep + '"]')) sel.value = keep;
    updateSetupNote();
  }

  function updateSetupNote() {
    var o = setupOptions(), places = eligiblePlaces(o), dishes = countDishes(places);
    var note = $('setup-note'), start = $('start');
    if (!places.length) {
      note.textContent = 'Nothing on the list is open there that day. Pick another day or town.';
      start.disabled = true; return;
    }
    start.disabled = false;
    note.textContent = dishes < o.size
      ? 'Only ' + dishes + ' dishes fit those choices, so the stack will have ' + dishes + '.'
      : 'You’ll each see the same ' + o.size + ' dishes from ' + Math.min(places.length, Math.ceil(o.size / DISHES_PER_PLACE)) + ' of the ' + places.length + ' places open.';
  }

  function savePrefs() {
    var o = setupOptions();
    prefs = { p1: o.p1, p2: o.p2, town: o.town, size: o.size, noChains: o.noChains, mode: o.mode };
    storeSet(PREFS_KEY, prefs);
  }

  function showSetup(message) {
    $('p1-name').value = prefs.p1 || '';
    $('p2-name').value = prefs.p2 || '';
    $('no-chains').checked = !!prefs.noChains;
    $(prefs.mode === 'link' ? 'mode-link' : 'mode-same').checked = true;
    fillWhen();
    var stored = storeGet(GAME_KEY);
    var resume = $('resume');
    if (stored && stored.v === 1 && stored.stage && stored.stage !== 'invite') {
      var who = stored.players[0].name + (stored.players[1].name ? ' and ' + stored.players[1].name : '');
      var what = {
        swipe: (stored.players[stored.turn].name || 'Player ' + (stored.turn + 1)) + '’s turn, ' + stored.pos + ' dishes in',
        handoff: 'waiting for ' + (stored.players[1].name || 'the second player') + ' to swipe',
        send: 'waiting for ' + (stored.players[1].name || 'your partner') + ' to play from your link',
        results: 'finished'
      }[stored.stage] || '';
      $('resume-text').textContent = 'Game in progress: ' + who + ', ' + longDate(stored.date) + '. ' + what.charAt(0).toUpperCase() + what.slice(1) + '.';
      $('resume-go').textContent = stored.stage === 'results' ? 'See the matches' : stored.stage === 'send' ? 'Show the link again' : 'Resume';
      resume.hidden = false;
    } else {
      resume.hidden = true;
    }
    if (message) $('setup-note').textContent = message;
    show('setup');
  }

  // ---------- invite (second player, two phones) ----------
  function showInvite() {
    var host = game.players[0].name, where = game.town === 'all' ? 'North Bend or Snoqualmie' : game.town;
    var deck = deckFor(game);
    $('invite-title').textContent = host + ' wants to pick a place to eat';
    $('invite-text').textContent = 'You’ll swipe the same ' + deck.length + ' dishes ' + host + ' saw, from places in ' + where +
      ' open ' + longDate(game.date) + '. Like something from the same restaurant as ' + host + ' and it’s a match.';
    var past = daysBetween(pacificNow().iso, game.date) < 0;
    $('invite-note').textContent = past ? 'That date has passed, so these are places open on ' + DAY_NAMES[dayKeyOf(game.date)] + 's.' : '';
    $('invite-name').value = game.players[1].name || prefs.p1 || '';
    if (!deck.length) $('invite-note').textContent = 'None of these restaurants is on the list anymore. Ask ' + host + ' to start a new game.';
    show('invite');
  }

  // ---------- swiping ----------
  var busy = false;
  var deckEl = $('deck');

  function currentDeck() { return deckFor(game); }

  function startTurn() {
    game.stage = 'swipe'; save();
    var me = game.players[game.turn];
    $('turn-title').textContent = me.name + '’s turn';
    renderDeck();
    show('swipe');
  }

  function cardHTML(card) {
    var p = card.place, hours = hoursFor(p, dayKeyOf(game.date));
    var rating = p.googleRating || p.yelpRating;
    var bits = [p.cuisine, p.town, p.price].filter(Boolean).map(esc).join(' · ');
    return '<div class="swipe-photo">' +
        (card.image ? '<img src="' + esc(card.image) + '" alt="" draggable="false">' : '') +
        '<span class="stamp stamp-like" aria-hidden="true">Yum</span><span class="stamp stamp-pass" aria-hidden="true">Pass</span>' +
        (card.image ? '<span class="photo-note">Typical photo</span>' : '') +
      '</div>' +
      '<div class="swipe-body">' +
        '<p class="swipe-place">' + esc(p.name) + '</p>' +
        '<h2 class="swipe-dish">' + esc(card.dish) + '</h2>' +
        '<p class="swipe-meta">' + bits + '</p>' +
        '<p class="swipe-hours">' + (hours ? 'Open ' + esc(fmtRanges(hours)) : '') + (rating ? ' · <span class="star">★</span> ' + esc(rating.toFixed(1)) : '') + '</p>' +
      '</div>';
  }

  function renderDeck() {
    var deck = currentDeck(), pos = game.pos;
    deckEl.innerHTML = '';
    var upcoming = deck.slice(pos, pos + 3);
    for (var i = upcoming.length - 1; i >= 0; i--) {
      var el = document.createElement('article');
      el.className = 'swipe-card';
      el.setAttribute('data-depth', String(i));
      if (i) el.setAttribute('aria-hidden', 'true');
      else el.setAttribute('aria-label', upcoming[i].dish + ' from ' + upcoming[i].place.name);
      el.innerHTML = cardHTML(upcoming[i]);
      deckEl.appendChild(el);
    }
    var top = deckEl.lastElementChild;
    if (top) bindDrag(top);
    var done = Math.min(pos, deck.length);
    $('turn-sub').textContent = longDate(game.date) + ' · dish ' + Math.min(pos + 1, deck.length) + ' of ' + deck.length;
    var bar = $('progress');
    bar.setAttribute('aria-valuemax', String(deck.length)); bar.setAttribute('aria-valuenow', String(done));
    $('progress-bar').style.width = (deck.length ? (done / deck.length) * 100 : 0) + '%';
    $('btn-undo').disabled = pos === 0;
  }

  function setStamp(el, dx) {
    var like = el.querySelector('.stamp-like'), pass = el.querySelector('.stamp-pass');
    if (like) like.style.opacity = String(Math.max(0, Math.min(1, dx / 90)));
    if (pass) pass.style.opacity = String(Math.max(0, Math.min(1, -dx / 90)));
  }

  function bindDrag(el) {
    var start = null, cur = { x: 0, y: 0 };
    el.addEventListener('pointerdown', function (e) {
      if (busy || (e.pointerType === 'mouse' && e.button !== 0)) return;
      start = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId };
      cur = { x: 0, y: 0 };
      try { el.setPointerCapture(e.pointerId); } catch (err) { /* older browsers */ }
      el.classList.add('is-dragging');
    });
    el.addEventListener('pointermove', function (e) {
      if (!start || e.pointerId !== start.id) return;
      cur = { x: e.clientX - start.x, y: (e.clientY - start.y) * 0.35 };
      el.style.transform = 'translate(' + cur.x + 'px,' + cur.y + 'px) rotate(' + (cur.x / 16) + 'deg)';
      setStamp(el, cur.x);
    });
    function end(e) {
      if (!start || e.pointerId !== start.id) return;
      var dt = Math.max(1, performance.now() - start.t);
      start = null;
      el.classList.remove('is-dragging');
      var far = Math.abs(cur.x) > deckEl.offsetWidth * 0.28;
      var flick = Math.abs(cur.x) > 40 && Math.abs(cur.x) / dt > 0.5;
      if (far || flick) { el._drag = cur; decide(cur.x > 0); }
      else { el.style.transform = ''; setStamp(el, 0); }
    }
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }

  function fly(el, like, done) {
    var dir = like ? 1 : -1, from = el._drag || { x: 0, y: 0 };
    setStamp(el, dir * 200);
    if (reduceMotion()) { done(); return; }
    var finished = false;
    function finish() { if (!finished) { finished = true; done(); } }
    el.classList.remove('is-dragging');
    el.style.transition = 'transform .32s cubic-bezier(.45,.05,.8,.6), opacity .32s ease-in';
    // Force a style flush so the button-triggered path animates from rest, not jump.
    void el.offsetWidth;
    el.style.transform = 'translate(' + dir * (window.innerWidth + el.offsetWidth) + 'px,' + (from.y + 40) + 'px) rotate(' + dir * 26 + 'deg)';
    el.style.opacity = '0';
    el.addEventListener('transitionend', finish, { once: true });
    setTimeout(finish, 420);
  }

  function decide(like) {
    if (busy || !game || game.stage !== 'swipe' || !$('match-overlay').hidden) return;
    var deck = currentDeck(), card = deck[game.pos], el = deckEl.lastElementChild;
    if (!card || !el) return;
    busy = true;
    fly(el, like, function () {
      var me = game.players[game.turn];
      if (like && me.likes.indexOf(card.id) < 0) me.likes.push(card.id);
      game.pos++;
      var match = like ? checkMatch(card) : null;
      save();
      $('swipe-status').textContent = (like ? 'Liked ' : 'Passed on ') + card.dish + '.';
      busy = false;
      var last = game.pos >= deck.length;
      if (!last) renderDeck();
      if (match) showMatch(match, last ? finishTurn : null);
      else if (last) finishTurn();
    });
  }

  function undo() {
    if (busy || !game || game.stage !== 'swipe' || game.pos === 0) return;
    game.pos--;
    var card = currentDeck()[game.pos], me = game.players[game.turn];
    var i = me.likes.indexOf(card.id);
    if (i >= 0) me.likes.splice(i, 1);
    // If that like made a match and nothing else from the restaurant is liked now, the match goes too.
    var key = placeKey(card.place), a = game.announced.indexOf(key);
    if (a >= 0 && !likedAt(me.likes, key)) game.announced.splice(a, 1);
    save();
    renderDeck();
    $('swipe-status').textContent = 'Undid ' + card.dish + '.';
  }

  function likedAt(likes, key) {
    return likes.filter(function (id) { var d = DISH_INDEX[id]; return d && placeKey(d.place) === key; })
      .map(function (id) { return DISH_INDEX[id]; });
  }

  // A match only happens on the second player's turn: the first player's likes are already known.
  function checkMatch(card) {
    if (game.turn !== 1) return null;
    var key = placeKey(card.place);
    if (game.announced.indexOf(key) >= 0) return null;
    var theirs = likedAt(game.players[0].likes, key);
    if (!theirs.length) return null;
    game.announced.push(key);
    return { place: card.place, mine: { dish: card.dish, image: card.image }, theirs: theirs };
  }

  // ---------- match pop-up ----------
  var afterMatch = null, lastFocus = null;
  function showMatch(m, then) {
    var me = game.players[1].name, them = game.players[0].name;
    var mineImg = m.mine.image, theirImg = (m.theirs.filter(function (d) { return d.image; })[0] || {}).image || mineImg;
    $('match-name').textContent = m.place.name;
    $('match-meta').textContent = [m.place.cuisine, m.place.town].filter(Boolean).join(' · ');
    var pair = document.querySelector('.match-pair');
    if (pair) pair.remove();
    if (mineImg) {
      document.querySelector('.match-kicker').insertAdjacentHTML('beforebegin',
        '<div class="match-pair" aria-hidden="true"><img src="' + esc(theirImg) + '" alt=""><span class="match-heart">' +
        '<svg viewBox="0 0 24 24"><path d="M12 20.5s-7.5-4.6-9.2-9.3C1.6 7.7 3.7 4.5 7 4.5c2 0 3.6 1.1 5 3 1.4-1.9 3-3 5-3 3.3 0 5.4 3.2 4.2 6.7-1.7 4.7-9.2 9.3-9.2 9.3z" fill="currentColor"/></svg>' +
        '</span><img src="' + esc(mineImg) + '" alt=""></div>');
    }
    $('match-dishes').innerHTML =
      '<li><span class="who">' + esc(them) + '</span>' + esc(m.theirs.map(function (d) { return d.dish; }).join(', ')) + '</li>' +
      '<li><span class="who">' + esc(me) + '</span>' + esc(m.mine.dish) + '</li>';
    $('match-close').textContent = then ? 'See your matches' : 'Keep swiping';
    afterMatch = then;
    lastFocus = document.activeElement;
    $('match-overlay').hidden = false;
    document.body.classList.add('has-overlay');
    $('match-close').focus();
  }
  function closeMatch() {
    if ($('match-overlay').hidden) return;
    $('match-overlay').hidden = true;
    document.body.classList.remove('has-overlay');
    var then = afterMatch; afterMatch = null;
    if (then) then();
    else if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
  }

  // ---------- end of a turn ----------
  function finishTurn() {
    var me = game.players[game.turn];
    me.done = true;
    if (game.turn === 0 && game.mode === 'same') {
      game.turn = 1; game.pos = 0; game.stage = 'handoff'; save(); showHandoff();
    } else if (game.turn === 0) {
      game.stage = 'send'; save(); showSend();
    } else {
      game.stage = 'results'; save(); showResults();
    }
  }

  function showHandoff() {
    var a = game.players[0].name, b = secondName(game);
    $('handoff-title').textContent = 'Nice, ' + a + '. Pass the phone to ' + b + '.';
    $('handoff-text').textContent = 'Your picks stay hidden. ' + b + ' swipes the same ' + currentDeck().length + ' dishes, and matches pop up along the way.';
    $('handoff-go').textContent = 'I’m ' + b + ', let’s go';
    show('handoff');
  }

  function showSend() {
    var url = linkFor(game, false), partner = partnerName(game);
    $('send-title').textContent = 'Your picks are in, ' + game.players[0].name + '.';
    $('send-text').textContent = 'Send this link to ' + partner + '. They’ll swipe the same ' + currentDeck().length + ' dishes on their phone and see your matches as they go.';
    $('send-url').value = url;
    $('send-share').textContent = navigator.share ? 'Send the link' : 'Copy the link';
    $('send-status').textContent = '';
    $('send-fine').textContent = 'When ' + (game.players[1].name || 'they') + ' finish' + (game.players[1].name ? 'es' : '') + ', they can send the results back to you.';
    show('send');
  }

  function shareOrCopy(url, title, text, statusId) {
    var status = $(statusId);
    if (navigator.share) {
      navigator.share({ title: title, text: text, url: url }).then(function () { status.textContent = 'Sent.'; }, function () { /* they closed the share sheet */ });
      return;
    }
    copy(url, statusId);
  }
  function copy(url, statusId) {
    var status = $(statusId);
    function fallback() {
      var input = statusId === 'send-status' ? $('send-url') : null;
      if (input) { input.focus(); input.select(); }
      status.textContent = input ? 'Press Ctrl+C or Cmd+C to copy the selected link.' : 'Copy this link: ' + url;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(function () { status.textContent = 'Link copied.'; }, fallback);
    } else fallback();
  }

  // ---------- results ----------
  function grouped(likes) {
    var out = {}, order = [];
    likes.forEach(function (id) {
      var d = DISH_INDEX[id]; if (!d) return;
      var k = placeKey(d.place);
      if (!out[k]) { out[k] = { place: d.place, dishes: [] }; order.push(k); }
      out[k].dishes.push(d);
    });
    return { map: out, order: order };
  }

  function computeResults(g) {
    var a = grouped(g.players[0].likes), b = grouped(g.players[1].likes);
    var matches = [], onlyA = [], onlyB = [];
    a.order.forEach(function (k) { if (b.map[k]) matches.push({ place: a.map[k].place, a: a.map[k].dishes, b: b.map[k].dishes }); else onlyA.push(a.map[k]); });
    b.order.forEach(function (k) { if (!a.map[k]) onlyB.push(b.map[k]); });
    matches.sort(function (x, y) { return (y.a.length + y.b.length) - (x.a.length + x.b.length) || popularity(y.place) - popularity(x.place); });
    return { matches: matches, onlyA: onlyA, onlyB: onlyB };
  }

  function chips(dishes) {
    return '<ul class="dish-chips">' + dishes.map(function (d) {
      return '<li>' + (d.image ? '<img src="' + esc(d.image) + '" alt="" width="40" height="40" loading="lazy">' : '') + '<span>' + esc(d.dish) + '</span></li>';
    }).join('') + '</ul>';
  }

  function hoursLine(place) {
    var hours = hoursFor(place, dayKeyOf(game.date));
    if (!hours) return '';
    var isToday = game.date === pacificNow().iso;
    var label = isToday ? 'Today' : DAY_NAMES[dayKeyOf(game.date)];
    var pill = isToday ? (openNow(place) ? ' <span class="pill open">Open now</span>' : ' <span class="pill closed">Closed right now</span>') : '';
    return '<p class="hours"><span class="label">' + label + ':</span> <strong>' + esc(fmtRanges(hours)) + '</strong>' + pill + '</p>';
  }

  function linksHTML(p) {
    var links = [];
    if (p.address) links.push('<a href="https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(p.name + ', ' + p.address) + '" target="_blank" rel="noopener">' + esc(p.address.replace(/,\s*(North Bend|Snoqualmie),\s*WA.*$/i, '')) + '</a>');
    if (p.phone) links.push('<a href="tel:' + esc(p.phone.replace(/[^\d+]/g, '')) + '">' + esc(p.phone) + '</a>');
    if (p.website) links.push('<a href="' + esc(p.website) + '" target="_blank" rel="noopener">Website</a>');
    return links.length ? '<div class="links">' + links.join('') + '</div>' : '';
  }

  function showResults() {
    var r = computeResults(game), a = game.players[0].name, b = secondName(game), n = r.matches.length;
    $('results-eyebrow').textContent = longDate(game.date);
    $('results-title').textContent = n ? 'You matched on ' + n + (n === 1 ? ' place' : ' places') : 'No matches this time';
    $('results-text').textContent = n
      ? a + ' and ' + b + ' both liked something from ' + (n === 1 ? 'this restaurant' : 'these restaurants') + '. The strongest match is first.'
      : 'Nothing overlapped. Here’s what each of you liked. A bigger stack or a different day gives you more to agree on.';

    $('match-list').innerHTML = r.matches.map(function (m, i) {
      var p = m.place, rating = p.googleRating || p.yelpRating;
      var sub = [p.cuisine, p.town, p.price].filter(Boolean).map(esc).join(' · ') + (rating ? ' · <span class="star">★</span> ' + esc(rating.toFixed(1)) : '');
      return '<li class="match' + (i === 0 ? ' is-top' : '') + '">' +
        '<div class="match-head"><span class="match-rank">' + (i + 1) + '</span><div><h2>' + esc(p.name) +
          (i === 0 && n > 1 ? ' <span class="best">Best bet</span>' : '') + '</h2><p class="match-sub">' + sub + '</p></div></div>' +
        hoursLine(p) +
        '<div class="picks"><div class="pick"><span class="label">' + esc(a) + ' liked</span>' + chips(m.a) + '</div>' +
          '<div class="pick"><span class="label">' + esc(b) + ' liked</span>' + chips(m.b) + '</div></div>' +
        linksHTML(p) + '</li>';
    }).join('');

    function alsoBlock(who, list) {
      if (!list.length) return '';
      return '<details' + (n ? '' : ' open') + '><summary>Only ' + esc(who) + ' liked (' + list.length + ')</summary><ul class="also-list">' +
        list.map(function (x) { return '<li><strong>' + esc(x.place.name) + '</strong> · ' + esc(x.dishes.map(function (d) { return d.dish; }).join(', ')) + '</li>'; }).join('') +
        '</ul></details>';
    }
    $('also').innerHTML = alsoBlock(a, r.onlyA) + alsoBlock(b, r.onlyB);

    var share = $('results-share');
    if (game.role === 'guest') {
      share.hidden = false;
      $('results-send').textContent = navigator.share ? 'Send the results to ' + a : 'Copy the results link for ' + a;
      $('results-status').textContent = '';
    } else share.hidden = true;
    show('results');
  }

  // ---------- wiring ----------
  function startFromSetup(e) {
    e.preventDefault();
    var o = setupOptions();
    if (!eligiblePlaces(o).length) return;
    savePrefs();
    game = newGame(o);
    if (o.mode === 'same' && !game.players[1].name) game.players[1].name = 'Player 2';
    history.replaceState(null, '', location.pathname + location.search);
    startTurn();
  }

  function playAgain() {
    var g = game;
    if (g) {
      // Whoever presses Play again goes first next time.
      var first = g.role === 'guest' ? g.players[1].name : g.players[0].name;
      var second = g.role === 'guest' ? g.players[0].name : g.players[1].name;
      prefs = { p1: first, p2: second, town: g.town, size: SIZES.indexOf(g.size) >= 0 ? g.size : 20, noChains: g.noChains, mode: g.mode };
      setupState.town = prefs.town; setupState.size = prefs.size;
      storeSet(PREFS_KEY, prefs);
      wireMarks();
    }
    game = null;
    storeSet(GAME_KEY, null);
    history.replaceState(null, '', location.pathname + location.search);
    showSetup();
  }

  var markTown = null, markSize = null;
  function wireMarks() { if (markTown) markTown(); if (markSize) markSize(); }

  function resumeStored() {
    var stored = storeGet(GAME_KEY);
    if (!stored) { showSetup(); return; }
    game = stored;
    route();
  }

  function route() {
    switch (game.stage) {
      case 'invite': showInvite(); break;
      case 'swipe': startTurn(); break;
      case 'handoff': showHandoff(); break;
      case 'send': showSend(); break;
      default: showResults();
    }
  }

  function boot() {
    buildIndex();

    // Setup controls
    markTown = wireSegmented('town-choice', 'town', fillWhen);
    markSize = wireSegmented('size-choice', 'size', updateSetupNote);
    $('no-chains').addEventListener('change', fillWhen);
    $('when').addEventListener('change', updateSetupNote);
    $('setup-form').addEventListener('submit', startFromSetup);
    $('resume-go').addEventListener('click', resumeStored);
    $('resume-drop').addEventListener('click', function () { storeSet(GAME_KEY, null); $('resume').hidden = true; });

    // Invite
    $('invite-form').addEventListener('submit', function (e) {
      e.preventDefault();
      if (!currentDeck().length) return;
      game.players[1].name = cleanName($('invite-name').value) || 'Player 2';
      prefs.p1 = prefs.p1 || game.players[1].name; storeSet(PREFS_KEY, prefs);
      startTurn();
    });

    // Swiping
    $('btn-like').addEventListener('click', function () { decide(true); });
    $('btn-pass').addEventListener('click', function () { decide(false); });
    $('btn-undo').addEventListener('click', undo);
    document.addEventListener('keydown', function (e) {
      if (!$('match-overlay').hidden) {
        if (e.key === 'Escape') { e.preventDefault(); closeMatch(); }
        else if (e.key === 'Tab') { e.preventDefault(); $('match-close').focus(); }
        return;
      }
      if (!game || game.stage !== 'swipe' || $('screen-swipe').hidden) return;
      var tag = (e.target && e.target.tagName) || '';
      if (/INPUT|TEXTAREA|SELECT/.test(tag) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); decide(true); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); decide(false); }
      else if (e.key === 'Backspace' || e.key === 'z' || e.key === 'u') { e.preventDefault(); undo(); }
    });
    $('match-close').addEventListener('click', closeMatch);
    $('match-overlay').addEventListener('click', function (e) { if (e.target === $('match-overlay')) closeMatch(); });

    // Hand-off and sending
    $('handoff-go').addEventListener('click', startTurn);
    $('send-share').addEventListener('click', function () {
      shareOrCopy($('send-url').value, 'Dish Match', game.players[0].name + ' wants to pick a place to eat ' + relativeDay(game.date) + '. Swipe some dishes and see where you match.', 'send-status');
    });
    $('send-copy').addEventListener('click', function () { copy($('send-url').value, 'send-status'); });
    $('send-restart').addEventListener('click', playAgain);

    // Results
    $('results-send').addEventListener('click', function () {
      shareOrCopy(linkFor(game, true), 'Dish Match results', 'Here’s where we matched for ' + longDate(game.date) + '.', 'results-status');
    });
    $('results-copy').addEventListener('click', function () { copy(linkFor(game, true), 'results-status'); });
    $('again').addEventListener('click', playAgain);

    window.addEventListener('hashchange', function () { if (/[#&]g=/.test(location.hash)) location.reload(); });

    // Where to start
    var fromLink = readLink();
    if (fromLink && fromLink.error) {
      showSetup('That game link didn’t work. It may have been cut off when it was copied; ask for it again or start a new game.');
      return;
    }
    if (fromLink) {
      var stored = storeGet(GAME_KEY);
      if (fromLink.role === 'viewer') {
        // The partner sent the results back. If this device started that game, finish it here too.
        if (stored && sameGame(stored, fromLink) && stored.role === 'host') {
          stored.players[1] = fromLink.players[1]; stored.stage = 'results'; stored.role = 'host';
          game = stored; save();
        } else game = fromLink;
        showResults();
        return;
      }
      // An invite: pick up where this device left off with it, if it already started.
      if (stored && sameGame(stored, fromLink) && stored.role === 'guest') { game = stored; route(); return; }
      if (stored && sameGame(stored, fromLink) && stored.role === 'host') { game = stored; route(); return; }  // the host opened their own link
      game = fromLink;
      showInvite();
      return;
    }
    showSetup();
  }

  boot();
})();
