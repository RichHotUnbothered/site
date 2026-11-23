/* Live Energy Clearing — shared script for /clearing, /clearing/thanks, /clearing/live.
 *
 * EDIT HERE ↓  (times are Central: -06:00 in November)
 */
var EVENT = {
  id: 'live-energy-clearing',
  name: 'Live Energy Clearing',
  start: '2026-11-25T11:00:00-06:00',
  durationMin: 120,       // how long the live page shows "LIVE" before switching to "replay"
  openEarlyMin: 15,       // player appears this many minutes before start
  replayHours: 48,        // replay available this long after start
  // Paste Vimeo's embed code or its src link, e.g. https://vimeo.com/event/1234567/embed/abc123/interaction
  // (keep the code after /embed/ for private events). A plain https://vimeo.com/event/1234567 also works.
  vimeo: '',
  vimeoChat: false,       // true = show Vimeo's live chat next to the video
  livePath: '/clearing/live',
};
/* ↑ EDIT HERE */

// A page can override settings before loading this script, e.g. the team test page:
//   window.EVENT_OVERRIDE = { id: 'live-energy-clearing-test', vimeo: '...', forceState: 'live', testMode: true };
//   testMode: the email gate works but nothing is sent to ActiveCampaign.
if (window.EVENT_OVERRIDE) Object.assign(EVENT, window.EVENT_OVERRIDE);

(function () {
  'use strict';

  var KEY = 'rhu_contact';
  var start = new Date(EVENT.start).getTime();
  var replayEnd = start + EVENT.replayHours * 3600e3;
  var site = location.origin;

  // ---------- contact memory ----------
  function getContact() {
    try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { return {}; }
  }
  function saveContact(c) {
    var cur = getContact();
    var events = (cur.events || []).slice();
    if (events.indexOf(EVENT.id) === -1) events.push(EVENT.id);
    var next = { email: c.email || cur.email, firstName: c.firstName || cur.firstName, events: events };
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch (e) {}
    try { document.cookie = 'rhu_' + EVENT.id + '=1; max-age=' + 60 * 60 * 24 * 30 + '; path=/; samesite=lax'; } catch (e) {}
    return next;
  }
  function isRegistered() {
    var c = getContact();
    return (c.events || []).indexOf(EVENT.id) !== -1 || document.cookie.indexOf('rhu_' + EVENT.id + '=1') !== -1;
  }

  function register(email, firstName, source) {
    if (EVENT.testMode) return Promise.resolve({ ok: true, test: true });
    return fetch('/api/event-register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: EVENT.id, email: email, firstName: firstName, source: source }),
    }).then(function (r) {
      var ct = r.headers.get('content-type') || '';
      if (ct.indexOf('json') === -1) throw { error: 'Sign-up isn’t connected on this preview.' };
      return r.json().then(function (d) { if (!r.ok || !d.ok) throw d; return d; });
    });
  }

  // Links from ActiveCampaign emails can carry ?email=%EMAIL%&first_name=%FIRSTNAME%
  (function fromLink() {
    var q = new URLSearchParams(location.search);
    var email = (q.get('email') || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return;
    var first = (q.get('first_name') || q.get('firstname') || '').trim();
    var already = isRegistered();
    saveContact({ email: email, firstName: first });
    if (!already) register(email, first, 'email-link').catch(function () {});
  })();

  // ---------- formatting ----------
  var CT = 'America/Chicago';
  function fmt(ts, opts, tz) {
    return new Intl.DateTimeFormat('en-US', Object.assign({ timeZone: tz }, opts)).format(new Date(ts));
  }
  function eventWhen() {
    return fmt(start, { weekday: 'long', month: 'long', day: 'numeric' }, CT) + ' at ' +
      fmt(start, { hour: 'numeric', minute: '2-digit' }, CT).replace(':00', '') + ' Central';
  }
  function localNote(ts) {
    var mine = Intl.DateTimeFormat().resolvedOptions().timeZone;
    var a = fmt(ts, { hour: 'numeric', minute: '2-digit', weekday: 'short' }, CT);
    var b = fmt(ts, { hour: 'numeric', minute: '2-digit', weekday: 'short' }, mine);
    return a === b ? '' : 'That’s ' + b.replace(':00', '') + ' your time.';
  }

  // ---------- countdowns ----------
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function tickCountdowns() {
    document.querySelectorAll('[data-countdown]').forEach(function (el) {
      var target = el.getAttribute('data-countdown') === 'replay-end' ? replayEnd : start;
      var ms = Math.max(0, target - Date.now());
      var d = Math.floor(ms / 864e5), h = Math.floor(ms / 36e5) % 24, m = Math.floor(ms / 6e4) % 60, s = Math.floor(ms / 1e3) % 60;
      var set = function (k, v) { var x = el.querySelector('[data-' + k + ']'); if (x) x.textContent = v; };
      set('d', d); set('h', pad(h)); set('m', pad(m)); set('s', pad(s));
      el.classList.toggle('is-done', ms === 0);
    });
  }

  // ---------- calendar ----------
  function icsDate(ts) { return new Date(ts).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''); }
  function calendarLinks() {
    var end = start + 90 * 6e4;
    var url = site + EVENT.livePath;
    var details = 'Join here: ' + url + '\nReplay available for ' + EVENT.replayHours + ' hours.';
    var g = 'https://calendar.google.com/calendar/render?action=TEMPLATE' +
      '&text=' + encodeURIComponent(EVENT.name) +
      '&dates=' + icsDate(start) + '/' + icsDate(end) +
      '&details=' + encodeURIComponent(details) + '&location=' + encodeURIComponent(url);
    var ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Rich Hot & Unbothered//EN', 'BEGIN:VEVENT',
      'UID:' + EVENT.id + '@richhotunbothered.com', 'DTSTAMP:' + icsDate(Date.now()),
      'DTSTART:' + icsDate(start), 'DTEND:' + icsDate(end), 'SUMMARY:' + EVENT.name,
      'DESCRIPTION:' + details.replace(/\n/g, '\\n'), 'LOCATION:' + url, 'URL:' + url,
      'BEGIN:VALARM', 'TRIGGER:-PT15M', 'ACTION:DISPLAY', 'DESCRIPTION:' + EVENT.name + ' starts in 15 minutes', 'END:VALARM',
      'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
    document.querySelectorAll('[data-cal="google"]').forEach(function (a) { a.href = g; });
    document.querySelectorAll('[data-cal="ics"]').forEach(function (a) {
      a.href = 'data:text/calendar;charset=utf-8,' + encodeURIComponent(ics);
      a.setAttribute('download', 'live-energy-clearing.ics');
    });
  }

  // ---------- forms ----------
  function bindForms() {
    document.querySelectorAll('form[data-register]').forEach(function (form) {
      var c = getContact();
      if (form.email && c.email && !form.email.value) form.email.value = c.email;
      if (form.firstName && c.firstName && !form.firstName.value) form.firstName.value = c.firstName;
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var msg = form.querySelector('.form-msg');
        var btn = form.querySelector('button[type="submit"]');
        var email = form.email.value.trim();
        var first = form.firstName ? form.firstName.value.trim() : '';
        if (msg) msg.textContent = '';
        if (form.firstName && !first) { if (msg) msg.textContent = 'Please add your first name.'; form.firstName.focus(); return; }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { if (msg) msg.textContent = 'Please enter a valid email address.'; form.email.focus(); return; }
        var label = btn.innerHTML;
        btn.disabled = true; btn.textContent = 'One moment…';
        register(email, first, form.getAttribute('data-register') || 'optin').then(function () {
          saveContact({ email: email, firstName: first });
          try { if (window.fbq) fbq('track', 'Lead', { content_name: EVENT.name }); } catch (e2) {}
          var go = form.getAttribute('data-redirect');
          if (go) { location.href = go; return; }
          document.dispatchEvent(new CustomEvent('clearing:registered'));
        }).catch(function (err) {
          if (msg) msg.textContent = (err && err.error) || 'Something went wrong. Please try again.';
          btn.disabled = false; btn.innerHTML = label;
        });
      });
    });
  }

  // ---------- live page ----------
  function vimeoId() {
    var m = String(EVENT.vimeo || '').match(/(\d{5,})/);
    return m ? m[1] : '';
  }
  // Player URL: use Vimeo's own embed src when given (keeps the private hash and /interaction),
  // otherwise build it from the event number.
  function vimeoSrc() {
    var v = String(EVENT.vimeo || '').trim();
    var fromTag = v.match(/src=["']([^"']+)["']/);
    if (fromTag) v = fromTag[1];
    v = v.replace(/&amp;/g, '&');
    if (/^https:\/\/(player\.)?vimeo\.com\/.+\/embed/.test(v) || /^https:\/\/player\.vimeo\.com\//.test(v)) return v;
    var id = vimeoId();
    return id ? 'https://vimeo.com/event/' + id + '/embed' : '';
  }
  function liveState() {
    var forced = new URLSearchParams(location.search).get('preview_state') || EVENT.forceState;
    if (forced) return forced;
    var now = Date.now();
    if (now < start - EVENT.openEarlyMin * 6e4) return 'before';
    if (now < start + EVENT.durationMin * 6e4) return 'live';
    if (now < replayEnd) return 'replay';
    return 'ended';
  }
  var playerLoaded = false;
  function renderLive() {
    var page = document.querySelector('[data-live-page]');
    if (!page) return;
    var state = liveState();
    var reg = isRegistered();
    page.setAttribute('data-state', state);
    page.setAttribute('data-registered', reg ? 'yes' : 'no');
    var watching = (state === 'live' || state === 'replay') && reg;
    if (watching && !playerLoaded) {
      var id = vimeoId();
      var src = vimeoSrc();
      var box = document.querySelector('[data-player]');
      if (src && box) {
        var frame = document.createElement('iframe');
        frame.src = src;
        frame.title = EVENT.name;
        frame.setAttribute('allow', 'autoplay; fullscreen; picture-in-picture; encrypted-media; web-share');
        frame.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
        frame.setAttribute('allowfullscreen', '');
        box.innerHTML = '<div class="player-frame' + (/\/interaction/.test(src) ? ' interactive' : '') + '"></div>' +
          (EVENT.vimeoChat ? '<div class="chat-frame"><iframe src="https://vimeo.com/event/' + id + '/chat/" title="Live chat"></iframe></div>' : '');
        box.querySelector('.player-frame').appendChild(frame);
        box.classList.toggle('with-chat', !!EVENT.vimeoChat);
        playerLoaded = true;
      }
    }
  }

  // ---------- boot ----------
  function boot() {
    document.querySelectorAll('[data-when]').forEach(function (el) { el.textContent = eventWhen(); });
    document.querySelectorAll('[data-local]').forEach(function (el) { el.textContent = localNote(start); });
    document.querySelectorAll('[data-replay-until]').forEach(function (el) {
      el.textContent = fmt(replayEnd, { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' }, CT).replace(':00', '') + ' Central';
    });
    var c = getContact();
    document.querySelectorAll('[data-first-name]').forEach(function (el) {
      if (c.firstName) el.textContent = ', ' + c.firstName;
    });
    calendarLinks();
    bindForms();
    tickCountdowns();
    renderLive();
    setInterval(tickCountdowns, 1000);
    setInterval(renderLive, 20000);
    document.addEventListener('clearing:registered', renderLive);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
