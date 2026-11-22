/* RHU cart
 * - Any element with data-checkout="<slug>" becomes an Add to Cart button.
 * - Cart lives in localStorage, so it follows the shopper across pages.
 * - Checkout: Stripe Checkout (/api/stripe-checkout) or PayPal Buttons
 *   (/api/paypal-order + /api/paypal-capture). Prices are set on the server.
 * - Coupons: "Have a code?" box, or a link like /shop.html?code=BLACKFRIDAY.
 */
(function () {
  'use strict';

  var KEY = 'rhu_cart_v1';
  var catalog = null;
  var state = { items: [], code: '' };   // code = applied (validated) code
  var coupon = null;                      // last server answer for state.code
  var config = null;
  var paypalLoaded = false;
  var els = {};

  // ---------- storage ----------
  function load() {
    try {
      var s = JSON.parse(localStorage.getItem(KEY) || '{}');
      if (Array.isArray(s.items)) state.items = s.items.map(String);
      if (typeof s.code === 'string') state.code = s.code;
      if (s.coupon && typeof s.coupon === 'object') coupon = s.coupon;
    } catch (e) {}
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify({ items: state.items, code: state.code, coupon: coupon })); } catch (e) {}
  }

  // ---------- helpers ----------
  function $(sel, root) { return (root || document).querySelector(sel); }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(cents) {
    var d = cents / 100;
    return '$' + (cents % 100 ? d.toFixed(2) : d.toLocaleString('en-US'));
  }
  function product(slug) { return catalog && catalog.products[slug]; }
  function validItems() { return state.items.filter(product); }
  function subtotal() { return validItems().reduce(function (n, s) { return n + product(s).price; }, 0); }
  function post(url, body) {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(function (r) {
      var ct = r.headers.get('content-type') || '';
      if (ct.indexOf('json') === -1) throw { offline: true };
      return r.json().then(function (d) { d._status = r.status; return d; });
    });
  }
  function notConnected(e) { return e && (e.offline || e._status === 503); }

  // ---------- markup ----------
  var BAG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 8h14l-1.2 11.2a2 2 0 0 1-2 1.8H8.2a2 2 0 0 1-2-1.8L5 8z"/><path d="M9 10V6.5a3 3 0 0 1 6 0V10"/></svg>';

  function build() {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'rhu-cart-btn';
    btn.setAttribute('aria-label', 'Open cart');
    btn.innerHTML = BAG + '<span class="rhu-count" hidden>0</span>';
    var navRight = $('.nav-right');
    if (navRight) navRight.insertBefore(btn, $('.nav-toggle', navRight));
    else { btn.classList.add('floating'); document.body.appendChild(btn); }
    btn.addEventListener('click', open);
    els.btn = btn;
    els.count = $('.rhu-count', btn);

    var d = document.createElement('div');
    d.className = 'rhu-cart';
    d.setAttribute('aria-hidden', 'true');
    d.innerHTML =
      '<div class="rhu-cart-shade" data-close></div>' +
      '<aside class="rhu-cart-panel" role="dialog" aria-modal="true" aria-labelledby="rhu-cart-title">' +
        '<div class="rhu-cart-head"><h2 id="rhu-cart-title">Your Cart<span></span></h2>' +
          '<button type="button" class="rhu-x" data-close aria-label="Close cart">&times;</button></div>' +
        '<div class="rhu-cart-body"></div>' +
        '<div class="rhu-cart-foot">' +
          '<div class="rhu-code"></div>' +
          '<div class="rhu-totals"></div>' +
          '<button type="button" class="rhu-checkout">Checkout &rarr;</button>' +
          '<p class="rhu-pay-note">Secure checkout &middot; Card, Apple Pay &amp; Google Pay &middot; Instant access</p>' +
          '<div class="rhu-paypal-wrap" hidden><div class="rhu-or">or</div><div class="rhu-paypal"></div></div>' +
          '<p class="rhu-err" role="alert"></p>' +
        '</div>' +
      '</aside>';
    document.body.appendChild(d);
    els.drawer = d;
    els.count2 = $('#rhu-cart-title span', d);
    els.body = $('.rhu-cart-body', d);
    els.foot = $('.rhu-cart-foot', d);
    els.code = $('.rhu-code', d);
    els.totals = $('.rhu-totals', d);
    els.checkout = $('.rhu-checkout', d);
    els.paypalWrap = $('.rhu-paypal-wrap', d);
    els.err = $('.rhu-err', d);

    d.addEventListener('click', function (e) {
      if (e.target.closest('[data-close]')) close();
      var rm = e.target.closest('[data-remove]');
      if (rm) remove(rm.getAttribute('data-remove'));
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && d.classList.contains('open')) close();
    });
    els.checkout.addEventListener('click', stripeCheckout);

    var t = document.createElement('div');
    t.className = 'rhu-toast';
    t.setAttribute('role', 'status');
    document.body.appendChild(t);
    els.toast = t;
  }

  var toastTimer;
  function toast(msg) {
    els.toast.textContent = msg;
    els.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { els.toast.classList.remove('show'); }, 3200);
  }

  // ---------- render ----------
  var codeOpen = false;
  function render() {
    var items = validItems();
    var n = items.length;
    els.count.textContent = n;
    els.count.hidden = !n;
    els.btn.setAttribute('aria-label', 'Open cart (' + n + ' item' + (n === 1 ? '' : 's') + ')');
    els.count2.textContent = n ? n + (n === 1 ? ' item' : ' items') : '';

    if (!n) {
      els.body.innerHTML =
        '<div class="rhu-empty"><p>Your cart is empty.</p>' +
        '<small>Find the course that calls to you.</small>' +
        '<a class="rhu-shop-link" href="/shop.html">Browse the Shop</a></div>';
      els.foot.hidden = true;
    } else {
      els.foot.hidden = false;
      els.body.innerHTML = '<ul class="rhu-items">' + items.map(function (slug) {
        var p = product(slug);
        return '<li class="rhu-item">' +
          '<a href="/' + esc(slug) + '.html"><img src="' + esc(p.image) + '" alt="" width="68" height="68"></a>' +
          '<div><p class="rhu-item-type">' + esc(p.type) + '</p>' +
          '<p class="rhu-item-name"><a href="/' + esc(slug) + '.html">' + esc(p.name) + '</a></p>' +
          '<button type="button" class="rhu-remove" data-remove="' + esc(slug) + '">Remove</button></div>' +
          '<div class="rhu-item-price">' + money(p.price) + '</div></li>';
      }).join('') + '</ul>';
    }
    renderCode();
    renderTotals();
    syncButtons();
  }

  function renderCode(msg) {
    if (state.code && coupon && coupon.ok) {
      els.code.innerHTML = '<div class="rhu-code-applied"><span>Code <b>' + esc(coupon.code) + '</b> &middot; ' +
        esc(coupon.label) + '</span><button type="button" data-clear-code>Remove</button></div>';
      $('[data-clear-code]', els.code).addEventListener('click', function () { setCode(''); });
      return;
    }
    els.code.innerHTML =
      '<button type="button" class="rhu-code-toggle" aria-expanded="' + codeOpen + '">Have a code?</button>' +
      '<form class="rhu-code-form"' + (codeOpen ? '' : ' hidden') + '>' +
        '<input type="text" name="code" placeholder="Enter code" autocomplete="off" autocapitalize="characters" spellcheck="false" aria-label="Discount code">' +
        '<button type="submit">Apply</button></form>' +
      '<p class="rhu-code-msg" role="alert">' + (msg ? esc(msg) : '') + '</p>';
    var toggle = $('.rhu-code-toggle', els.code);
    var form = $('form', els.code);
    toggle.addEventListener('click', function () {
      codeOpen = !codeOpen;
      form.hidden = !codeOpen;
      toggle.setAttribute('aria-expanded', codeOpen);
      if (codeOpen) form.code.focus();
    });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      applyCode(form.code.value);
    });
  }

  function renderTotals() {
    var sub = subtotal();
    var disc = (state.code && coupon && coupon.ok) ? Math.min(coupon.discount, sub) : 0;
    els.totals.innerHTML =
      (disc ? '<div><span>Subtotal</span><span>' + money(sub) + '</span></div>' +
              '<div class="disc"><span>Discount (' + esc(coupon.code) + ')</span><span>&minus;' + money(disc) + '</span></div>' : '') +
      '<div class="total"><span>Total</span><span>' + money(sub - disc) + '</span></div>';
  }

  // Product-page buttons: original label until added, then "In Your Cart".
  function syncButtons() {
    document.querySelectorAll('[data-checkout]').forEach(function (b) {
      if (!b.hasAttribute('data-label')) b.setAttribute('data-label', b.innerHTML);
      var inCart = state.items.indexOf(b.getAttribute('data-checkout')) !== -1;
      b.innerHTML = inCart ? '&#10003; In Your Cart &middot; View Cart' : b.getAttribute('data-label');
      b.classList.toggle('in-cart', inCart);
    });
  }

  // ---------- actions ----------
  function add(slug) {
    if (!product(slug)) return;
    if (state.items.indexOf(slug) === -1) {
      state.items.push(slug);
      save();
      revalidate();
      try { if (window.fbq) fbq('track', 'AddToCart', { content_ids: [slug], value: product(slug).price / 100, currency: 'USD' }); } catch (e) {}
    }
    render();
    els.btn.classList.remove('bump'); void els.btn.offsetWidth; els.btn.classList.add('bump');
    open();
  }

  function remove(slug) {
    state.items = state.items.filter(function (s) { return s !== slug; });
    save();
    render();
    revalidate();
  }

  var lastFocus;
  function open() {
    lastFocus = document.activeElement;
    render();
    els.err.textContent = '';
    els.drawer.classList.add('open');
    els.drawer.setAttribute('aria-hidden', 'false');
    document.body.classList.add('rhu-cart-open');
    setTimeout(function () { $('.rhu-x', els.drawer).focus(); }, 50);
    setupPaypal();
  }
  function close() {
    els.drawer.classList.remove('open');
    els.drawer.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('rhu-cart-open');
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  function setCode(code, result) {
    state.code = code;
    coupon = result || null;
    save();
    render();
  }

  function applyCode(raw, quiet) {
    var code = String(raw || '').trim();
    if (!code) return;
    if (!validItems().length) {
      // Remember a link code until something is in the cart.
      state.code = code; coupon = null; save();
      return;
    }
    return post('/api/coupon', { code: code, items: validItems() }).then(function (d) {
      if (d.ok) {
        setCode(code, d);
        if (!quiet) toast('Code ' + d.code + ' applied: ' + d.label);
      } else {
        setCode('');
        if (!quiet) { codeOpen = true; renderCode(d.error || 'That code isn’t valid.'); }
      }
    }).catch(function (e) {
      if (!quiet) {
        codeOpen = true;
        renderCode(notConnected(e) ? 'Codes will work once checkout is connected.' : 'Couldn’t check that code. Try again.');
      }
    });
  }

  // Cart changed: re-check the applied code (minimums, product limits).
  var revalTimer;
  function revalidate() {
    if (!state.code) return;
    clearTimeout(revalTimer);
    revalTimer = setTimeout(function () {
      if (!validItems().length) { coupon = null; save(); render(); return; }
      var code = state.code;
      post('/api/coupon', { code: code, items: validItems() }).then(function (d) {
        if (d.ok) setCode(code, d);
        else { setCode(''); codeOpen = true; renderCode(d.error); }
      }).catch(function () {});
    }, 250);
  }

  function showErr(e, fallback) {
    els.err.textContent = notConnected(e)
      ? 'Checkout isn’t connected yet. Check back soon!'
      : (e && e.error) || fallback;
  }

  function stripeCheckout() {
    els.err.textContent = '';
    els.checkout.disabled = true;
    els.checkout.textContent = 'One moment…';
    try { if (window.fbq) fbq('track', 'InitiateCheckout', { value: subtotal() / 100, currency: 'USD', num_items: validItems().length }); } catch (e) {}
    var email;
    try { email = (JSON.parse(localStorage.getItem('rhu_contact') || '{}').email) || undefined; } catch (e) {}
    post('/api/stripe-checkout', { items: validItems(), code: state.code || undefined, email: email }).then(function (d) {
      if (d.url) { window.location.href = d.url; return; }
      throw d;
    }).catch(function (e) {
      showErr(e, 'Could not start checkout. Please try again.');
      els.checkout.disabled = false;
      els.checkout.innerHTML = 'Checkout &rarr;';
    });
  }

  // ---------- PayPal ----------
  function getConfig() {
    if (config) return Promise.resolve(config);
    return fetch('/api/shop-config').then(function (r) {
      if ((r.headers.get('content-type') || '').indexOf('json') === -1) throw 0;
      return r.json();
    }).then(function (c) { config = c; return c; }).catch(function () { config = {}; return config; });
  }

  function setupPaypal() {
    if (paypalLoaded) return;
    paypalLoaded = true;
    getConfig().then(function (c) {
      if (!c.paypalClientId) return;
      var s = document.createElement('script');
      s.src = 'https://www.paypal.com/sdk/js?client-id=' + encodeURIComponent(c.paypalClientId) +
        '&currency=USD&intent=capture&components=buttons&disable-funding=card';
      s.onload = renderPaypal;
      document.head.appendChild(s);
    });
  }

  function renderPaypal() {
    if (!window.paypal || !paypal.Buttons) return;
    els.paypalWrap.hidden = false;
    paypal.Buttons({
      style: { layout: 'horizontal', color: 'gold', shape: 'pill', label: 'paypal', tagline: false, height: 48 },
      createOrder: function () {
        els.err.textContent = '';
        return post('/api/paypal-order', { items: validItems(), code: state.code || undefined }).then(function (d) {
          if (d.id) return d.id;
          throw d;
        }).catch(function (e) { showErr(e, 'Could not start PayPal checkout.'); throw e; });
      },
      onApprove: function (data, actions) {
        return post('/api/paypal-capture', { orderID: data.orderID }).then(function (d) {
          if (d.status === 'INSTRUMENT_DECLINED') return actions.restart();
          if (!d.ok) throw d;
          clearCart();
          window.location.href = '/order-complete.html?paypal=' + encodeURIComponent(data.orderID);
        }).catch(function (e) { showErr(e, 'Payment could not be completed. Please try again.'); });
      },
      onError: function () { if (!els.err.textContent) els.err.textContent = 'PayPal had a problem. Please try again.'; },
    }).render($('.rhu-paypal', els.drawer));
  }

  function clearCart() {
    state = { items: [], code: '' };
    coupon = null;
    save();
  }

  // ---------- boot ----------
  function boot() {
    load();
    if (document.body.hasAttribute('data-clear-cart')) clearCart();

    document.addEventListener('click', function (e) {
      var b = e.target.closest('[data-checkout]');
      if (!b) return;
      e.preventDefault();
      if (!catalog) return;
      var slug = b.getAttribute('data-checkout');
      if (state.items.indexOf(slug) !== -1) open();
      else add(slug);
    });

    fetch('/assets/catalog.json').then(function (r) { return r.json(); }).then(function (c) {
      catalog = c;
      build();
      render();

      var params = new URLSearchParams(location.search);
      var linkCode = params.get('code');
      if (linkCode) {
        applyCode(linkCode, true);
        if (validItems().length) setTimeout(function () { if (state.code) toast('Code ' + linkCode.toUpperCase() + ' applied'); }, 900);
        else toast('Code ' + linkCode.toUpperCase() + ' will be applied in your cart');
      } else if (state.code && validItems().length && !(coupon && coupon.ok)) {
        applyCode(state.code, true);
      } else if (state.code && validItems().length) {
        revalidate(); // codes can expire between visits
      }
      if (params.get('checkout') === 'cancelled' && validItems().length) {
        toast('Your cart is saved whenever you’re ready.');
      }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
