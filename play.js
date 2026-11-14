/* Dish Match
   Two people swipe the same stack of dishes from restaurants open on a chosen day. When both like a dish
   from the same restaurant (not necessarily the same dish), that restaurant is a match.

   Modes:
   - One phone: everything stays on this device and the players take turns.
   - Two phones (live): the game is a small record in Firebase Realtime Database (games/<random id>, see
     database.rules.json). Both phones swipe at the same time. Each phone writes only its own player record
     (name, progress, liked dish ids) and listens to the whole game over a server-sent event stream, so a
     match pops up on both phones as soon as both have liked the same restaurant. The random id in the link
     is what lets someone open the game; games can't be listed.
   - Two phones (link): the fallback when the database can't be reached. The first player's likes travel in
     the link after the # (never sent to the web server) and the second player swipes afterwards.
   Both players get the same stack because it is built from the same day, filters, and random seed. */
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

  var DB = String(window.MATCH_DB_URL || '').replace(/\/+$/, '');
  var SLOTS = ['a', 'b'];            // database player keys for players[0] and players[1]
  var GID_RE = /^[A-Za-z0-9_-]{20,40}$/;
  var BEAT_MS = 25000;               // how often an open game says "still here"
  var ONLINE_MS = 75000;             // a partner heard from within this long counts as online

  var ICON_HEART = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.5s-7.5-4.6-9.2-9.3C1.6 7.7 3.7 4.5 7 4.5c2 0 3.6 1.1 5 3 1.4-1.9 3-3 5-3 3.3 0 5.4 3.2 4.2 6.7-1.7 4.7-9.2 9.3-9.2 9.3z" fill="currentColor"/></svg>';
  var ICON_X = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="3" stroke-linecap="round" fill="none"/></svg>';

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
  function randomBytes(n) {
    var bytes = new Uint8Array(n);
    try { crypto.getRandomValues(bytes); } catch (e) { for (var i = 0; i < n; i++) bytes[i] = Math.floor(Math.random() * 256); }
    return bytes;
  }
  function newSeed() { var b = randomBytes(4); return ((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0; }

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
    }).slice(0, 200);
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

  // A live game link: #live=<game id>, optionally &to=<suggested name for the partner>.
  function readLiveLink() {
    var m = /[#&]live=([A-Za-z0-9_-]+)(?:&to=([^&]*))?/.exec(location.hash || '');
    if (!m) return null;
    if (!GID_RE.test(m[1])) return { error: true };
    var to = '';
    try { to = cleanName(decodeURIComponent(m[2] || '')); } catch (e) { /* a mangled name is just dropped */ }
    return { gid: m[1], to: to };
  }

  // ---------- game state ----------
  var game = null;

  function newGame(o) {
    return {
      v: 1, date: o.date, town: o.town, size: o.size, noChains: !!o.noChains, seed: o.seed != null ? o.seed >>> 0 : newSeed(),
      mode: o.mode, role: o.mode === 'same' ? 'local' : 'host',
      players: [{ name: o.p1 || 'Player 1', likes: [], done: false }, { name: o.p2 || '', likes: [], done: false }],
      turn: 0, pos: 0, stage: 'swipe', announced: [], updated: Date.now()
    };
  }
  function sameGame(a, b) { return a && b && a.seed === b.seed && a.date === b.date && a.players[0].name === b.players[0].name; }
  function save() { if (game && game.stage !== 'invite') { game.updated = Date.now(); storeSet(GAME_KEY, game); } }
  function partnerName(g) { return g.players[1].name || 'your partner'; }
  function secondName(g) { return g.players[1].name || 'Player 2'; }
  function other() { return game.players[1 - game.turn]; }
  function otherName() { return other().name || 'your partner'; }
  function isLive() { return !!(game && game.mode === 'live' && game.gid && DB); }

  // ---------- screens ----------
  var SCREENS = ['setup', 'invite', 'swipe', 'handoff', 'send', 'results'];
  function show(name) {
    SCREENS.forEach(function (s) { $('screen-' + s).hidden = s !== name; });
    document.body.setAttribute('data-screen', name);
    document.body.classList.toggle('is-live', isLive());
    window.scrollTo(0, 0);
    var h = document.querySelector('#screen-' + name + ' h1');
    if (h && name !== 'setup') { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
  }
  function currentScreen() { return document.body.getAttribute('data-screen'); }

  // ---------- setup ----------
  var prefs = storeGet(PREFS_KEY) || {};
  var setupState = { town: prefs.town || 'all', size: SIZES.indexOf(prefs.size) >= 0 ? prefs.size : 20 };
  var pendingNext = '';              // a finished live game to point at the next round once it exists

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
    if (stored && stored.v === 1 && stored.stage && stored.stage !== 'invite' && stored.players) {
      var me = stored.players[stored.turn] || stored.players[0], them = stored.players[1 - stored.turn] || stored.players[1];
      var who = stored.players[0].name + (stored.players[1].name ? ' and ' + stored.players[1].name : '');
      var liveGame = stored.mode === 'live';
      var what = {
        swipe: liveGame ? (me.name + ', ' + stored.pos + ' dishes in') : (me.name || 'Player ' + (stored.turn + 1)) + '’s turn, ' + stored.pos + ' dishes in',
        handoff: 'waiting for ' + (stored.players[1].name || 'the second player') + ' to swipe',
        send: liveGame ? 'waiting for ' + (them.name || 'your partner') + ' to open the link' : 'waiting for ' + (stored.players[1].name || 'your partner') + ' to play from your link',
        results: liveGame && !them.done ? 'you’re done, ' + (them.name || 'your partner') + ' is still swiping' : 'finished'
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

  // ---------- invite (second player opening a link) ----------
  function inviteNotes(host) {
    var past = daysBetween(pacificNow().iso, game.date) < 0;
    $('invite-note').textContent = past ? 'That date has passed, so these are places open on ' + DAY_NAMES[dayKeyOf(game.date)] + 's.' : '';
    if (!deckFor(game).length) $('invite-note').textContent = 'None of these restaurants is on the list anymore. Ask ' + host + ' to start a new game.';
  }

  function showInvite() {
    var host = game.players[0].name, where = game.town === 'all' ? 'North Bend or Snoqualmie' : game.town;
    var deck = deckFor(game);
    $('invite-form').hidden = false; $('invite-who').hidden = true; $('invite-alt').hidden = true;
    $('invite-title').textContent = host + ' wants to pick a place to eat';
    $('invite-text').textContent = 'You’ll swipe the same ' + deck.length + ' dishes ' + host + ' saw, from places in ' + where +
      ' open ' + longDate(game.date) + '. Like something from the same restaurant as ' + host + ' and it’s a match.';
    $('invite-name').value = game.players[1].name || prefs.p1 || '';
    inviteNotes(host);
    show('invite');
  }

  // ---------- swiping ----------
  var busy = false;
  var deckEl = $('deck'), fxEl = $('deck-fx'), btnLike = $('btn-like'), btnPass = $('btn-pass'), hintEl = $('swipe-hint');
  var HINT = hintEl.textContent;

  function currentDeck() { return deckFor(game); }

  function startTurn() {
    game.stage = 'swipe'; save();
    var me = game.players[game.turn];
    $('turn-title').textContent = game.mode === 'live' ? me.name + '’s picks' : me.name + '’s turn';
    renderDeck();
    show('swipe');
    renderLive();
  }

  function cardHTML(card) {
    var p = card.place, hours = hoursFor(p, dayKeyOf(game.date));
    var rating = p.googleRating || p.yelpRating;
    var bits = [p.cuisine, p.town, p.price].filter(Boolean).map(esc).join(' · ');
    return '<div class="swipe-photo">' +
        (card.image ? '<img src="' + esc(card.image) + '" alt="" draggable="false">' : '') +
        '<span class="tint tint-like" aria-hidden="true"></span><span class="tint tint-pass" aria-hidden="true"></span>' +
        '<span class="stamp stamp-like" aria-hidden="true">' + ICON_HEART + 'Like</span>' +
        '<span class="stamp stamp-pass" aria-hidden="true">' + ICON_X + 'Pass</span>' +
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
    resetCues();
    var done = Math.min(pos, deck.length);
    $('turn-sub').textContent = longDate(game.date) + ' · dish ' + Math.min(pos + 1, deck.length) + ' of ' + deck.length;
    var bar = $('progress');
    bar.setAttribute('aria-valuemax', String(deck.length)); bar.setAttribute('aria-valuenow', String(done));
    $('progress-bar').style.width = (deck.length ? (done / deck.length) * 100 : 0) + '%';
    $('btn-undo').disabled = pos === 0;
  }

  // While a card is dragged: tint it, grow its Like or Pass stamp, and lean the matching button toward the
  // thumb. Past the point where letting go counts, the stamp turns solid and the hint says so.
  function feedback(el, dx) {
    var limit = Math.max(60, deckEl.offsetWidth * 0.28), p = Math.max(-1, Math.min(1, dx / limit));
    var like = Math.max(0, p), pass = Math.max(0, -p), armed = Math.abs(p) >= 1;
    el.style.setProperty('--like', like.toFixed(3));
    el.style.setProperty('--pass', pass.toFixed(3));
    el.classList.toggle('armed-like', p >= 1);
    el.classList.toggle('armed-pass', p <= -1);
    btnLike.style.setProperty('--pull', like.toFixed(3));
    btnPass.style.setProperty('--pull', pass.toFixed(3));
    btnLike.classList.toggle('is-armed', p >= 1);
    btnPass.classList.toggle('is-armed', p <= -1);
    if (Math.abs(p) < 0.12) { hintEl.textContent = HINT; hintEl.className = 'hint'; return; }
    hintEl.className = 'hint is-cue ' + (p > 0 ? 'cue-like' : 'cue-pass') + (armed ? ' is-armed' : '');
    hintEl.textContent = armed ? (p > 0 ? 'Let go to like it' : 'Let go to pass') : (p > 0 ? 'Keep going to like it →' : '← Keep going to pass');
  }
  function resetCues() {
    btnLike.style.setProperty('--pull', '0'); btnPass.style.setProperty('--pull', '0');
    btnLike.classList.remove('is-armed'); btnPass.classList.remove('is-armed');
    hintEl.textContent = HINT; hintEl.className = 'hint';
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
      feedback(el, cur.x);
    });
    function end(e) {
      if (!start || e.pointerId !== start.id) return;
      var dt = Math.max(1, performance.now() - start.t);
      start = null;
      el.classList.remove('is-dragging');
      var far = Math.abs(cur.x) > deckEl.offsetWidth * 0.28;
      var flick = Math.abs(cur.x) > 40 && Math.abs(cur.x) / dt > 0.5;
      el._drag = cur;
      if ((far || flick) && decide(cur.x > 0)) return;
      el._drag = null;
      el.style.transform = ''; feedback(el, 0);
    }
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }

  function fly(el, like, done) {
    var dir = like ? 1 : -1, from = el._drag || { x: 0, y: 0 };
    feedback(el, dir * 10000);
    hintEl.textContent = like ? 'Liked' : 'Passed';
    if (reduceMotion()) { done(); return; }
    var finished = false;
    function finish() { if (!finished) { finished = true; done(); } }
    el.classList.remove('is-dragging');
    el.style.transition = 'transform .34s cubic-bezier(.45,.05,.8,.6), opacity .34s ease-in';
    // Force a style flush so the button-triggered path animates from rest, not jump.
    void el.offsetWidth;
    el.style.transform = 'translate(' + dir * (window.innerWidth + el.offsetWidth) + 'px,' + (from.y + 40) + 'px) rotate(' + dir * 26 + 'deg)';
    el.style.opacity = '0';
    el.addEventListener('transitionend', finish, { once: true });
    setTimeout(finish, 440);
  }

  // After a swipe: a heart or an X pops over the stack and drifts the way the card went, the side it went to
  // glows, a like throws off a few small hearts, and the button for that choice pulses.
  function celebrate(like) {
    var fx = document.createElement('div');
    fx.className = 'verdict ' + (like ? 'is-like' : 'is-pass');
    var sparks = '';
    if (like && !reduceMotion()) {
      for (var i = 0; i < 6; i++) sparks += '<i style="--i:' + i + '">' + ICON_HEART + '</i>';
      sparks = '<span class="sparks">' + sparks + '</span>';
    }
    fx.innerHTML = '<span class="verdict-edge"></span><span class="verdict-ring"></span>' + sparks +
      '<span class="verdict-badge">' + (like ? ICON_HEART : ICON_X) + '</span>';
    fxEl.appendChild(fx);
    setTimeout(function () { if (fx.parentNode) fx.parentNode.removeChild(fx); }, 950);
    var btn = like ? btnLike : btnPass;
    btn.classList.remove('is-pulse'); void btn.offsetWidth; btn.classList.add('is-pulse');
    setTimeout(function () { btn.classList.remove('is-pulse'); }, 560);
  }

  // Returns true when the swipe counts (false while busy or a pop-up is open).
  function decide(like) {
    if (busy || !game || game.stage !== 'swipe' || !$('match-overlay').hidden) return false;
    var deck = currentDeck(), card = deck[game.pos], el = deckEl.lastElementChild;
    if (!card || !el) return false;
    busy = true;
    celebrate(like);
    fly(el, like, function () {
      var me = game.players[game.turn];
      if (like && me.likes.indexOf(card.id) < 0) me.likes.push(card.id);
      game.pos++;
      var match = like ? checkMatch(card) : null;
      var last = game.pos >= deck.length;
      if (last) me.done = true;
      save();
      pushMe();
      $('swipe-status').textContent = (like ? 'Liked ' : 'Passed on ') + card.dish + '.';
      busy = false;
      if (!last) renderDeck();
      if (match) queueMatch(match, last ? finishTurn : null);
      else if (last) finishTurn();
    });
    return true;
  }

  function undo() {
    if (busy || !game || game.stage !== 'swipe' || game.pos === 0) return;
    game.pos--;
    var card = currentDeck()[game.pos], me = game.players[game.turn];
    var i = me.likes.indexOf(card.id);
    if (i >= 0) me.likes.splice(i, 1);
    // If that like made a match and nothing else from the restaurant is liked now, the match goes too.
    var key = placeKey(card.place), a = game.announced.indexOf(key);
    if (a >= 0 && !likedAt(me.likes, key).length) game.announced.splice(a, 1);
    save();
    pushMe();
    renderDeck();
    $('swipe-status').textContent = 'Undid ' + card.dish + '.';
  }

  function likedAt(likes, key) {
    return likes.filter(function (id) { var d = DISH_INDEX[id]; return d && placeKey(d.place) === key; })
      .map(function (id) { return DISH_INDEX[id]; });
  }

  // Both players have liked something from this restaurant: { place, mine, theirs }, else null.
  function matchAt(key) {
    var mine = likedAt(game.players[game.turn].likes, key), theirs = likedAt(other().likes, key);
    return mine.length && theirs.length ? { place: mine[0].place, mine: mine, theirs: theirs } : null;
  }

  // After a like on this phone. In one-phone and link games the partner's likes are only known on the
  // second turn, so matches can only happen then; in live games they can happen any time.
  function checkMatch(card) {
    var key = placeKey(card.place);
    if (game.announced.indexOf(key) >= 0) return null;
    var m = matchAt(key);
    if (m) game.announced.push(key);
    return m;
  }

  // ---------- match pop-up ----------
  var afterMatch = null, lastFocus = null, matchQueue = [];
  function queueMatch(m, then) {
    matchQueue.push({ m: m, then: then });
    if ($('match-overlay').hidden) nextMatch();
  }
  function nextMatch() {
    var x = matchQueue.shift();
    if (x) showMatch(x.m, x.then);
  }
  function firstImage(list) { return (list.filter(function (d) { return d.image; })[0] || {}).image || ''; }

  function showMatch(m, then) {
    var me = game.players[game.turn].name || 'You', them = otherName();
    var mineImg = firstImage(m.mine), theirImg = firstImage(m.theirs) || mineImg;
    mineImg = mineImg || theirImg;
    $('match-name').textContent = m.place.name;
    $('match-meta').textContent = [m.place.cuisine, m.place.town].filter(Boolean).join(' · ');
    var pair = document.querySelector('.match-pair');
    if (pair) pair.remove();
    if (mineImg) {
      document.querySelector('.match-kicker').insertAdjacentHTML('beforebegin',
        '<div class="match-pair" aria-hidden="true"><img src="' + esc(theirImg) + '" alt=""><span class="match-heart">' + ICON_HEART +
        '</span><img src="' + esc(mineImg) + '" alt=""></div>');
    }
    function names(list) { return list.map(function (d) { return d.dish; }).join(', '); }
    $('match-dishes').innerHTML =
      '<li><span class="who">' + esc(them.charAt(0).toUpperCase() + them.slice(1)) + '</span>' + esc(names(m.theirs)) + '</li>' +
      '<li><span class="who">' + esc(me) + '</span>' + esc(names(m.mine)) + '</li>';
    $('match-close').textContent = then ? 'See your matches' : game.stage === 'results' ? 'Nice' : 'Keep swiping';
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
    if (matchQueue.length) setTimeout(function () { if ($('match-overlay').hidden) nextMatch(); }, 200);
  }

  // ---------- end of a turn ----------
  function finishTurn() {
    var me = game.players[game.turn];
    me.done = true;
    if (game.mode === 'live') {
      game.stage = 'results'; save(); pushMe(); showResults();
    } else if (game.turn === 0 && game.mode === 'same') {
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
    if (game.mode === 'live') { showLiveSend(); return; }
    var url = linkFor(game, false), partner = partnerName(game);
    $('send-title').textContent = 'Your picks are in, ' + game.players[0].name + '.';
    $('send-text').textContent = 'Send this link to ' + partner + '. They’ll swipe the same ' + currentDeck().length + ' dishes on their phone and see your matches as they go.';
    $('send-url').value = url;
    $('send-share').textContent = navigator.share ? 'Send the link' : 'Copy the link';
    $('send-status').textContent = '';
    $('send-start').hidden = true;
    $('send-partner').hidden = true;
    $('send-fine').textContent = (game.fellBack ? 'Live syncing couldn’t connect, so this game uses a link instead. ' : '') +
      'When ' + (game.players[1].name || 'they') + ' finish' + (game.players[1].name ? 'es' : '') + ', they can send the results back to you.';
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

  // ---------- live games ----------
  var live = { es: null, gid: '', remote: null, pushing: false, dirty: false, retry: 0, timer: 0, reconnect: 0, offset: 0, offline: false, next: '' };

  function dbUrl(gid, sub) { return DB + '/games/' + gid + (sub || '') + '.json'; }
  function api(method, url, body) {
    var opts = { method: method, cache: 'no-store' };
    if (body !== undefined) { opts.body = JSON.stringify(body); opts.headers = { 'Content-Type': 'application/json' }; }
    return fetch(url, opts).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }
  function newGameId() {
    var b = randomBytes(15), bin = '';
    for (var i = 0; i < b.length; i++) bin += String.fromCharCode(b[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_');   // 20 characters
  }
  function liveLink() {
    var to = cleanName(other().name);
    return location.origin + location.pathname + '#live=' + game.gid + (to && !other().joined ? '&to=' + encodeURIComponent(to) : '');
  }

  function createLive(g) {
    return api('PUT', dbUrl(g.gid), {
      v: 1, d: g.date, t: TOWN_CODES[g.town], n: g.size, s: g.seed, c: g.noChains ? 1 : 0, at: { '.sv': 'timestamp' },
      p: { a: { name: g.players[0].name || 'Player 1', pos: 0, done: false, seen: { '.sv': 'timestamp' } } }
    });
  }

  // This phone's player record. Each push sends the whole record (it is small), one request at a time,
  // so a slow request can never land after a newer one.
  function playerDoc() {
    var me = game.players[game.turn];
    return { name: me.name || 'Player ' + (game.turn + 1), pos: Math.min(game.pos, 200), done: !!me.done,
      likes: me.likes.join('.') || null, seen: { '.sv': 'timestamp' } };
  }
  function pushMe() {
    if (!isLive() || game.stage === 'invite') return;
    live.dirty = true;
    if (live.pushing) return;
    live.pushing = true; live.dirty = false;
    clearTimeout(live.timer);
    var sent = Date.now();
    api('PATCH', dbUrl(game.gid, '/p/' + SLOTS[game.turn]), playerDoc()).then(function (res) {
      live.pushing = false; live.retry = 0;
      // The server fills in "seen" with its own clock; use that to judge how recently the partner was around.
      if (res && typeof res.seen === 'number') live.offset = res.seen - (sent + Date.now()) / 2;
      setOffline(false);
      if (live.dirty) pushMe();
    }, function () {
      live.pushing = false; live.dirty = true;
      setOffline(true);
      live.timer = setTimeout(pushMe, Math.min(20000, 1500 * Math.pow(2, live.retry++)));
    });
  }

  function connect() {
    if (!isLive() || typeof EventSource === 'undefined') return;
    if (live.es && live.gid === game.gid && live.es.readyState !== 2) return;
    disconnect();
    if (live.gid !== game.gid) { live.remote = null; live.next = ''; }
    live.gid = game.gid;
    var es = new EventSource(dbUrl(game.gid));
    live.es = es;
    es.addEventListener('put', function (e) { onStream(es, e, false); });
    es.addEventListener('patch', function (e) { onStream(es, e, true); });
    es.addEventListener('cancel', function () { if (live.es === es) { disconnect(); setOffline(true); } });
    es.onopen = function () { if (live.es === es) setOffline(false); };
    es.onerror = function () {
      if (live.es !== es) return;
      setOffline(true);
      // The browser retries on its own unless the stream was refused outright; then try again in a bit.
      if (es.readyState === 2) { live.es = null; clearTimeout(live.reconnect); live.reconnect = setTimeout(connect, 5000); }
    };
  }
  function disconnect() {
    clearTimeout(live.reconnect);
    if (live.es) { live.es.close(); live.es = null; }
  }

  function setAt(node, keys, val) {
    if (!keys.length) return val == null ? null : val;
    var o = node && typeof node === 'object' ? Object.assign({}, node) : {};
    var child = setAt(o[keys[0]], keys.slice(1), val);
    if (child == null) delete o[keys[0]]; else o[keys[0]] = child;
    return Object.keys(o).length ? o : null;
  }
  function onStream(es, e, merge) {
    if (live.es !== es) return;
    var msg;
    try { msg = JSON.parse(e.data); } catch (err) { return; }
    if (!msg || typeof msg.path !== 'string') return;
    var keys = msg.path.split('/').filter(Boolean);
    if (merge && msg.data && typeof msg.data === 'object') {
      Object.keys(msg.data).forEach(function (k) { live.remote = setAt(live.remote, keys.concat(k.split('/').filter(Boolean)), msg.data[k]); });
    } else live.remote = setAt(live.remote, keys, msg.data);
    setOffline(false);
    syncRemote();
  }

  // Copy the partner's record from the stream into the game, then refresh whatever is on screen.
  function syncRemote() {
    if (!isLive() || live.gid !== game.gid || game.stage === 'invite') return;
    var r = live.remote || {}, p = r.p || {}, idx = 1 - game.turn, them = p[SLOTS[idx]], P = game.players[idx];
    if (them && typeof them === 'object') {
      P.name = cleanName(them.name) || P.name || 'Player ' + (idx + 1);
      P.likes = cleanLikes(them.likes);
      P.pos = Math.max(0, Math.min(200, parseInt(them.pos, 10) || 0));
      P.done = them.done === true;
      P.seen = typeof them.seen === 'number' ? them.seen : 0;
      P.joined = true;
    } else P.joined = false;
    live.next = typeof r.next === 'string' && GID_RE.test(r.next) ? r.next : '';
    save();
    renderLive();
    checkLiveMatches();
  }

  // A match can also start on the partner's phone: they like a place this phone already liked.
  function checkLiveMatches() {
    if (!isLive() || (game.stage !== 'swipe' && game.stage !== 'results')) return;
    var found = [];
    grouped(game.players[game.turn].likes).order.forEach(function (key) {
      if (game.announced.indexOf(key) >= 0) return;
      var m = matchAt(key);
      if (m) { game.announced.push(key); found.push(m); }
    });
    if (!found.length) return;
    save();
    found.forEach(function (m) { queueMatch(m, null); });
  }

  function setOffline(off) {
    if (live.offline === off) return;
    live.offline = off;
    renderLive();
  }

  function partnerOnline(P) { return !!P.seen && (Date.now() + live.offset - P.seen) < ONLINE_MS; }
  function partnerState() {
    var P = other(), name = otherName(), total = currentDeck().length;
    if (live.offline) return { cls: 'is-off', text: 'Reconnecting…' };
    if (!P.joined) return { cls: 'is-wait', text: 'Waiting for ' + name + ' to open the link', resend: true };
    if (P.done) return { cls: 'is-done', text: name + ' is done swiping' };
    var on = partnerOnline(P);
    return { cls: on ? 'is-on' : 'is-away',
      text: (P.pos ? name + ' is on dish ' + Math.min(P.pos + 1, total) + ' of ' + total : name + ' joined') + (on ? '' : ' · away') };
  }
  function statusHTML(s, withResend) {
    return '<span class="dot" aria-hidden="true"></span><span>' + esc(s.text) + '</span>' +
      (s.resend && withResend ? '<button type="button" class="link-btn" data-resend>Send the link</button>' : '');
  }

  function renderLive() {
    var on = isLive() && game.stage !== 'invite';
    ['partner-status', 'send-partner'].forEach(function (id) { $(id).hidden = !on; });
    if (!on) return;
    var s = partnerState();
    $('partner-status').className = 'partner-status ' + s.cls;
    $('partner-status').innerHTML = statusHTML(s, true);
    $('send-partner').className = 'partner-status ' + s.cls;
    $('send-partner').innerHTML = statusHTML(s, false);
    if (currentScreen() === 'results') showResults(true);
  }

  function resend(btn) {
    var text = game.players[game.turn].name + ' wants to pick a place to eat ' + relativeDay(game.date) + '. Swipe some dishes together and see where you match.';
    if (navigator.share) { navigator.share({ title: 'Dish Match', text: text, url: liveLink() }).catch(function () {}); return; }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(liveLink()).then(function () { btn.textContent = 'Link copied'; }, function () { btn.textContent = 'Couldn’t copy'; });
    }
  }

  function showLiveSend() {
    var n = currentDeck().length, partner = other().name;
    $('send-title').textContent = 'Send ' + (partner || 'your partner') + ' the link';
    $('send-text').textContent = 'You’ll both swipe the same ' + n + ' dishes at the same time, each on your own phone. When you both like something from the same restaurant, it pops up on both phones.';
    $('send-url').value = liveLink();
    $('send-share').textContent = navigator.share ? 'Send the link' : 'Copy the link';
    $('send-status').textContent = '';
    $('send-start').hidden = false;
    $('send-fine').textContent = 'You don’t have to wait. Start swiping whenever you’re ready.';
    show('send');
    renderLive();
  }

  // Opening a #live= link on this phone.
  var inviteRecord = null;
  function openLive(link) {
    var stored = storeGet(GAME_KEY);
    if (stored && stored.mode === 'live' && stored.gid === link.gid) { game = stored; connect(); route(); return; }
    if (!DB) { showSetup('Two-phone games aren’t set up on this copy of the site.'); return; }
    $('invite-title').textContent = 'Opening the game…';
    $('invite-text').textContent = ''; $('invite-note').textContent = '';
    $('invite-form').hidden = true; $('invite-who').hidden = true;
    show('invite');
    api('GET', dbUrl(link.gid)).then(function (r) {
      if (!r || !r.p || !r.p.a || !TOWN_FROM_CODE[r.t] || !/^\d{4}-\d{2}-\d{2}$/.test(r.d)) {
        showSetup('That game isn’t available anymore. Start a new one here.'); return;
      }
      var g = newGame({ date: r.d, town: TOWN_FROM_CODE[r.t], size: Math.max(5, Math.min(200, parseInt(r.n, 10) || 20)), noChains: r.c === 1,
        mode: 'live', seed: Number(r.s) >>> 0, p1: cleanName(r.p.a.name) || 'Player 1', p2: r.p.b ? cleanName(r.p.b.name) || 'Player 2' : link.to });
      g.gid = link.gid; g.stage = 'invite'; g.role = 'guest'; g.turn = 1;
      game = g; inviteRecord = r;
      showLiveInvite();
    }, function () {
      showSetup('Couldn’t reach that game. Check your connection, then open the link again.');
    });
  }

  function showLiveInvite() {
    var r = inviteRecord, a = game.players[0].name, hasB = !!(r.p && r.p.b);
    var where = game.town === 'all' ? 'North Bend or Snoqualmie' : game.town;
    $('invite-form').hidden = hasB;
    $('invite-who').hidden = !hasB;
    if (hasB) {
      var b = game.players[1].name;
      $('invite-title').textContent = 'Who’s on this phone?';
      $('invite-text').textContent = a + ' and ' + b + ' are already playing this game. Pick your name to keep going here.';
      $('invite-who').innerHTML = '<button type="button" class="btn btn-big" data-slot="0">I’m ' + esc(a) + '</button>' +
        '<button type="button" class="btn btn-big" data-slot="1">I’m ' + esc(b) + '</button>';
    } else {
      $('invite-title').textContent = a + ' wants to pick a place to eat';
      $('invite-text').textContent = 'You’ll both swipe the same ' + deckFor(game).length + ' dishes from places in ' + where + ' open ' +
        longDate(game.date) + ', each on your own phone. When you both like something from the same restaurant, it pops up on both phones.';
      $('invite-name').value = game.players[1].name || prefs.p1 || '';
      $('invite-alt').textContent = 'I’m ' + a + ', keep playing on this phone';
      $('invite-alt').hidden = false;
    }
    inviteNotes(a);
    show('invite');
  }

  // Take a seat in a live game: slot 1 to join as the partner, or either slot to carry on from another phone.
  function joinLive(idx, name) {
    var r = inviteRecord || {}, p = r.p || {};
    game.turn = idx; game.role = idx === 0 ? 'host' : 'guest';
    [0, 1].forEach(function (i) {
      var rec = p[SLOTS[i]], P = game.players[i];
      if (!rec) return;
      P.name = cleanName(rec.name) || P.name; P.likes = cleanLikes(rec.likes); P.done = rec.done === true; P.pos = parseInt(rec.pos, 10) || 0; P.joined = true;
    });
    var me = game.players[idx];
    if (name) me.name = name;
    game.pos = Math.max(0, Math.min(currentDeck().length, me.pos || 0));
    // Matches already shown on the other phone shouldn't pop up again here.
    game.announced = grouped(me.likes).order.filter(function (key) { return likedAt(game.players[1 - idx].likes, key).length > 0; });
    game.stage = me.done ? 'results' : 'swipe';
    inviteRecord = null;
    history.replaceState(null, '', location.pathname + location.search + '#live=' + game.gid);
    save(); pushMe(); connect(); route();
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

  var resultsSig = '';
  // quiet: refresh in place (live updates) without moving focus or scrolling.
  function showResults(quiet) {
    var r = computeResults(game), a = game.players[0].name, b = secondName(game), n = r.matches.length;
    var liveGame = isLive(), waiting = liveGame && !other().done;
    var banner = '';
    if (liveGame) {
      var s = partnerState();
      if (waiting) banner = '<p class="partner-status ' + s.cls + '">' + statusHTML(s, true) + '</p>';
      if (live.next) banner += '<div class="next-round"><p><strong>' + esc(otherName()) + ' started another round.</strong></p>' +
        '<button type="button" class="btn btn-primary" id="join-next">Join the new round</button></div>';
    }
    var sig = JSON.stringify([game.players[0].likes, game.players[1].likes, banner, a, b]);
    if (quiet && sig === resultsSig) return;
    resultsSig = sig;

    $('results-eyebrow').textContent = longDate(game.date);
    if (waiting) {
      $('results-title').textContent = n ? n + (n === 1 ? ' match so far' : ' matches so far') : 'No matches yet';
      $('results-text').textContent = other().joined
        ? 'You’re done. ' + otherName() + ' is still swiping, and new matches pop up here as they go.'
        : 'You’re done. Matches show up here as soon as ' + otherName() + ' opens the link and starts swiping.';
    } else {
      $('results-title').textContent = n ? 'You matched on ' + n + (n === 1 ? ' place' : ' places') : 'No matches this time';
      $('results-text').textContent = n
        ? a + ' and ' + b + ' both liked something from ' + (n === 1 ? 'this restaurant' : 'these restaurants') + '. The strongest match is first.'
        : 'Nothing overlapped. Here’s what each of you liked. A bigger stack or a different day gives you more to agree on.';
    }
    $('results-live').hidden = !banner;
    $('results-live').innerHTML = banner;

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
    var open = {};
    Array.prototype.forEach.call($('also').querySelectorAll('details'), function (d, i) { open[i] = d.open; });
    $('also').innerHTML = alsoBlock(a, r.onlyA) + alsoBlock(b, r.onlyB);
    if (quiet) Array.prototype.forEach.call($('also').querySelectorAll('details'), function (d, i) { if (i in open) d.open = open[i]; });

    var share = $('results-share');
    if (game.mode === 'link' && game.role === 'guest') {
      share.hidden = false;
      $('results-send').textContent = navigator.share ? 'Send the results to ' + a : 'Copy the results link for ' + a;
      $('results-status').textContent = '';
    } else share.hidden = true;
    if (!quiet) show('results');
  }

  // ---------- wiring ----------
  function startFromSetup(e) {
    e.preventDefault();
    var o = setupOptions();
    if (!eligiblePlaces(o).length) return;
    savePrefs();
    disconnect();
    game = newGame(o);
    if (o.mode === 'same' && !game.players[1].name) game.players[1].name = 'Player 2';
    history.replaceState(null, '', location.pathname + location.search);
    if (o.mode !== 'link' || !DB) { pendingNext = ''; startTurn(); return; }

    // Two phones: set up the live game, falling back to a link game if the database can't be reached.
    var start = $('start'), g = game;
    g.mode = 'live'; g.gid = newGameId(); g.stage = 'send';
    start.disabled = true;
    $('setup-note').textContent = 'Setting up your game…';
    createLive(g).then(function () {
      if (game !== g) return;
      if (pendingNext) { api('PUT', dbUrl(pendingNext, '/next'), g.gid).catch(function () {}); pendingNext = ''; }
      history.replaceState(null, '', location.pathname + location.search + '#live=' + g.gid);
      save(); connect(); showLiveSend();
    }, function () {
      if (game !== g) return;
      g.mode = 'link'; g.gid = ''; g.fellBack = true; pendingNext = '';
      startTurn();
    }).then(function () { start.disabled = false; updateSetupNote(); });
  }

  function playAgain() {
    var g = game;
    if (g) {
      // Whoever presses Play again goes first next time.
      var mine = g.mode === 'live' ? g.turn : g.role === 'guest' ? 1 : 0;
      var first = g.players[mine].name, second = g.players[1 - mine].name;
      prefs = { p1: first, p2: second, town: g.town, size: SIZES.indexOf(g.size) >= 0 ? g.size : 20, noChains: g.noChains, mode: g.mode === 'same' ? 'same' : 'link' };
      setupState.town = prefs.town; setupState.size = prefs.size;
      storeSet(PREFS_KEY, prefs);
      wireMarks();
      pendingNext = isLive() ? g.gid : '';
    }
    disconnect();
    game = null;
    matchQueue = [];
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
    if (isLive()) history.replaceState(null, '', location.pathname + location.search + '#live=' + game.gid);
    connect();
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
      var name = cleanName($('invite-name').value) || 'Player 2';
      prefs.p1 = prefs.p1 || name; storeSet(PREFS_KEY, prefs);
      if (game.mode === 'live') { joinLive(1, name); return; }
      game.players[1].name = name;
      startTurn();
    });
    $('invite-alt').addEventListener('click', function () { if (game && game.mode === 'live') joinLive(0); });
    $('invite-who').addEventListener('click', function (e) {
      var b = e.target.closest('[data-slot]');
      if (b && game && game.mode === 'live') joinLive(parseInt(b.getAttribute('data-slot'), 10));
    });

    // Swiping
    btnLike.addEventListener('click', function () { decide(true); });
    btnPass.addEventListener('click', function () { decide(false); });
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

    // Live game buttons that are drawn on the fly
    document.addEventListener('click', function (e) {
      var t = e.target;
      if (t.closest('[data-resend]')) { resend(t.closest('[data-resend]')); return; }
      if (t.closest('#join-next') && live.next) {
        location.hash = '#live=' + live.next + '&to=' + encodeURIComponent(game.players[game.turn].name || '');
      }
    });

    // Hand-off and sending
    $('handoff-go').addEventListener('click', startTurn);
    $('send-share').addEventListener('click', function () {
      var who = game.players[0].name;
      var text = game.mode === 'live'
        ? who + ' wants to pick a place to eat ' + relativeDay(game.date) + '. Swipe some dishes together and see where you match.'
        : who + ' wants to pick a place to eat ' + relativeDay(game.date) + '. Swipe some dishes and see where you match.';
      shareOrCopy($('send-url').value, 'Dish Match', text, 'send-status');
    });
    $('send-copy').addEventListener('click', function () { copy($('send-url').value, 'send-status'); });
    $('send-start').addEventListener('click', startTurn);
    $('send-restart').addEventListener('click', playAgain);

    // Results
    $('results-send').addEventListener('click', function () {
      shareOrCopy(linkFor(game, true), 'Dish Match results', 'Here’s where we matched for ' + longDate(game.date) + '.', 'results-status');
    });
    $('results-copy').addEventListener('click', function () { copy(linkFor(game, true), 'results-status'); });
    $('again').addEventListener('click', playAgain);

    window.addEventListener('hashchange', function () {
      var liveLinkNow = readLiveLink();
      if (liveLinkNow && !liveLinkNow.error && game && game.gid === liveLinkNow.gid) return;   // our own address update
      if (/[#&](g|live)=/.test(location.hash)) location.reload();
    });

    // Keep a live game fresh: reconnect when the phone wakes up, and say "still here" every so often.
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible' && isLive() && game.stage !== 'invite') { connect(); pushMe(); }
    });
    setInterval(function () {
      if (document.visibilityState !== 'visible' || !isLive() || game.stage === 'invite') return;
      if (!(game.players[0].done && game.players[1].done)) pushMe();
      renderLive();
    }, BEAT_MS);

    // Where to start
    var liveLinkAtStart = readLiveLink();
    if (liveLinkAtStart && liveLinkAtStart.error) {
      showSetup('That game link didn’t work. It may have been cut off when it was copied; ask for it again or start a new game.');
      return;
    }
    if (liveLinkAtStart) { openLive(liveLinkAtStart); return; }

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
