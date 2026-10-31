/* Pulse cart helper: fast AJAX add-to-cart for Pulse cards and the product page.
   Instant button feedback, no artificial delays, and Horizon's own cart event so the
   cart count updates and the cart drawer opens. */
import { CartLinesUpdateEvent } from '@shopify/events';

(function addStyles() {
  if (document.getElementById('pulse-atc-style')) return;
  const s = document.createElement('style');
  s.id = 'pulse-atc-style';
  s.textContent = '@keyframes pulseSpin{to{transform:rotate(360deg)}}'
    + '.pulse-atc-spin{display:inline-block;width:16px;height:16px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:pulseSpin .6s linear infinite;vertical-align:-3px;flex-shrink:0}'
    + '[data-pulse-busy]{pointer-events:none;opacity:.85}'
    + '[data-pulse-done]{transition:none}'
    + '.pulse-fly__card{width:100%;height:100%;background:#fff;border-radius:22px;overflow:hidden;box-shadow:0 22px 44px -16px rgba(15,30,54,.55),0 0 0 1px rgba(27,53,94,.08);display:grid;place-items:center}'
    + '.pulse-fly__card img{width:88%;height:88%;object-fit:contain}'
    + '.pulse-fly__card:empty{background:linear-gradient(150deg,#2C5391,#1B355E)}'
    + '@keyframes pulseLand{0%{transform:scale(1)}30%{transform:scale(1.28)}55%{transform:scale(.9)}75%{transform:scale(1.08)}100%{transform:scale(1)}}'
    + '@keyframes pulseRing{0%{opacity:.75;transform:translate(-50%,-50%) scale(.4)}100%{opacity:0;transform:translate(-50%,-50%) scale(1.9)}}'
    + '.pulse-cart-land{position:relative}'
    + '.pulse-cart-land .svg-wrapper,.pulse-cart-land>svg{animation:pulseLand .7s cubic-bezier(.3,1.4,.5,1)}'
    + '.pulse-cart-land:after{content:"";position:absolute;left:50%;top:50%;width:40px;height:40px;border-radius:50%;border:2px solid #EE8B1B;pointer-events:none;animation:pulseRing .7s ease-out forwards}'
    + '.pulse-atc-ripple{position:relative;overflow:hidden}'
    + '.pulse-atc-ripple:after{content:"";position:absolute;inset:0;margin:auto;width:24px;height:24px;border-radius:50%;background:rgba(238,139,27,.35);pointer-events:none;animation:pulseRipple .65s ease-out forwards}'
    + '@keyframes pulseRipple{to{transform:scale(18);opacity:0}}';
  document.head.appendChild(s);
})();

function toast(msg, isError) {
  let el = document.getElementById('pulse-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'pulse-toast';
    el.setAttribute('role', 'status');
    el.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translate(-50%,16px);z-index:2147483000;display:flex;align-items:center;gap:14px;padding:14px 18px;border-radius:14px;font:600 14px/1.3 system-ui,sans-serif;box-shadow:0 18px 40px -18px rgba(15,30,54,.6);opacity:0;transition:opacity .18s,transform .18s;max-width:calc(100vw - 32px)';
    document.body.appendChild(el);
  }
  el.style.background = isError ? '#B42318' : '#0F1E36';
  el.style.color = '#fff';
  el.innerHTML = '';
  const t = document.createElement('span');
  t.textContent = msg;
  el.appendChild(t);
  if (!isError) {
    const a = document.createElement('a');
    a.href = '/cart';
    a.textContent = 'View cart';
    a.style.cssText = 'color:#EE8B1B;text-decoration:none;white-space:nowrap';
    el.appendChild(a);
  }
  requestAnimationFrame(() => { el.style.opacity = '1'; el.style.transform = 'translate(-50%,0)'; });
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translate(-50%,16px)'; }, 3500);
}

function isIconButton(btn) {
  return btn && btn.textContent.trim().length === 0;
}

function setBusy(btn) {
  if (!btn) return '';
  const label = btn.innerHTML;
  btn._pulseLabel = label;
  btn._pulseBusyAt = Date.now();
  btn.setAttribute('data-pulse-busy', '');
  btn.setAttribute('aria-busy', 'true');
  btn.innerHTML = isIconButton(btn)
    ? '<span class="pulse-atc-spin" aria-hidden="true"></span>'
    : '<span class="pulse-atc-spin" aria-hidden="true"></span><span>Adding…</span>';
  return label;
}

function setDone(btn, label, ok) {
  if (!btn) return;
  btn.removeAttribute('data-pulse-busy');
  btn.removeAttribute('aria-busy');
  if (!ok) { btn.innerHTML = label; return; }
  const tick = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  btn.innerHTML = isIconButton({ textContent: label.replace(/<[^>]*>/g, '') }) ? tick : tick + '<span>Added</span>';
  clearTimeout(btn._pulseT);
  btn._pulseT = setTimeout(() => { btn.innerHTML = label; }, 1400);
}

/* Put any button still showing "Adding…" back to normal. Needed when a shopper leaves for checkout
   and then comes back with the browser's Back button / app switcher: the browser restores the page
   exactly as it was left, spinner included. */
function resetBusy(olderThanMs) {
  document.querySelectorAll('[data-pulse-busy]').forEach((btn) => {
    if (olderThanMs && Date.now() - (btn._pulseBusyAt || 0) < olderThanMs) return;
    btn.removeAttribute('data-pulse-busy');
    btn.removeAttribute('aria-busy');
    if (btn._pulseLabel != null) btn.innerHTML = btn._pulseLabel;
  });
}
window.addEventListener('pageshow', (e) => { if (e.persisted) resetBusy(0); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) resetBusy(4000); });

function reduceMotion() {
  return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function visible(el) {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
}

function findCartIcon() {
  const list = document.querySelectorAll('header-actions cart-icon, header-actions .action__cart, [aria-controls="cart-drawer"]');
  for (const el of list) if (visible(el)) return el;
  return null;
}

function findProductImage(from) {
  let node = from;
  for (let i = 0; node && i < 9; i++, node = node.parentElement) {
    const imgs = node.querySelectorAll ? node.querySelectorAll('img') : [];
    for (const img of imgs) {
      const r = img.getBoundingClientRect();
      if (r.width >= 80 && r.height >= 60 && visible(img) && (img.currentSrc || img.src)) return img;
    }
  }
  return null;
}

/* The product photo lifts off, arcs up into the cart icon and the icon bounces when it lands. */
function flyToCart(btn) {
  if (reduceMotion() || !btn) return Promise.resolve(false);
  const target = findCartIcon();
  if (!target) return Promise.resolve(false);
  const img = findProductImage(btn);
  const src = img ? img.getBoundingClientRect() : btn.getBoundingClientRect();
  const dst = target.getBoundingClientRect();
  const size = Math.round(Math.min(Math.max(Math.min(src.width, src.height) * 0.55, 72), 132));
  const sx = src.left + src.width / 2 - size / 2;
  const sy = src.top + src.height / 2 - size / 2;
  const dx = dst.left + dst.width / 2 - size / 2 - sx;
  const dy = dst.top + dst.height / 2 - size / 2 - sy;

  const outer = document.createElement('div');
  outer.className = 'pulse-fly';
  outer.style.cssText = 'position:fixed;left:' + sx + 'px;top:' + sy + 'px;width:' + size + 'px;height:' + size + 'px;z-index:2147483001;pointer-events:none;will-change:transform';
  const inner = document.createElement('div');
  inner.className = 'pulse-fly__card';
  if (img) {
    const im = document.createElement('img');
    im.src = img.currentSrc || img.src;
    im.alt = '';
    inner.appendChild(im);
  }
  outer.appendChild(inner);
  document.body.appendChild(outer);

  const d = 780;
  const xAnim = outer.animate(
    [{ transform: 'translateX(0)' }, { transform: 'translateX(' + dx + 'px)' }],
    { duration: d, easing: 'cubic-bezier(.55,.05,.9,.45)', fill: 'forwards' }
  );
  inner.animate(
    [
      { transform: 'translateY(0) scale(.7) rotate(0)', opacity: 0, borderRadius: '22px' },
      { transform: 'translateY(-14px) scale(1.04) rotate(-4deg)', opacity: 1, offset: 0.14 },
      { transform: 'translateY(' + dy * 0.75 + 'px) scale(.55) rotate(6deg)', opacity: 1, offset: 0.7, borderRadius: '22px' },
      { transform: 'translateY(' + dy + 'px) scale(.16) rotate(0)', opacity: 0.25, borderRadius: '50%' },
    ],
    { duration: d, easing: 'cubic-bezier(.2,.6,.35,1)', fill: 'forwards' }
  );

  return xAnim.finished.then(() => {
    outer.remove();
    landOn(target);
    return true;
  }, () => { outer.remove(); return false; });
}

function landOn(target) {
  target.classList.remove('pulse-cart-land');
  void target.offsetWidth;
  target.classList.add('pulse-cart-land');
  setTimeout(() => target.classList.remove('pulse-cart-land'), 900);
}

function ripple(btn) {
  if (!btn || reduceMotion()) return;
  btn.classList.remove('pulse-atc-ripple');
  void btn.offsetWidth;
  btn.classList.add('pulse-atc-ripple');
  setTimeout(() => btn.classList.remove('pulse-atc-ripple'), 700);
}

/* Glow the line that was just added once the drawer has re-rendered. */
function highlightLine(variantId) {
  if (!variantId) return;
  let tries = 0;
  const look = () => {
    const row = document.querySelector('#cart-drawer [data-key^="' + variantId + ':"]');
    if (row) {
      row.classList.remove('pulse-just-added');
      void row.offsetWidth;
      row.classList.add('pulse-just-added');
      setTimeout(() => row.classList.remove('pulse-just-added'), 2400);
      return;
    }
    if (++tries < 20) setTimeout(look, 60);
  };
  setTimeout(look, 80);
}

/* Buy Now: open Razorpay Magic Checkout for ONLY this product, like Shopify's "Buy it now".
   The shopper's existing cart is put aside, the cart holds just this item while checkout is open,
   and the original cart is put back as soon as the checkout closes (or on the next page load).
   The cart drawer is never opened. */
const PULSE_STASH = 'pulseBuyNowStash';
const jsonHeaders = { 'Content-Type': 'application/json', Accept: 'application/json' };

function readStash() {
  try {
    const s = JSON.parse(localStorage.getItem(PULSE_STASH) || 'null');
    if (s && Date.now() - s.t < 6 * 3600 * 1000) return s;
    localStorage.removeItem(PULSE_STASH);
  } catch (e) { /* storage blocked */ }
  return null;
}
function writeStash(s) {
  try { if (s) localStorage.setItem(PULSE_STASH, JSON.stringify(s)); else localStorage.removeItem(PULSE_STASH); } catch (e) { /* storage blocked */ }
}
async function getCart() {
  return (await fetch('/cart.js', { credentials: 'same-origin', headers: { Accept: 'application/json' } })).json();
}
function cartSectionIds() {
  return Array.from(document.querySelectorAll('cart-items-component')).map((el) => el.dataset.sectionId).filter(Boolean);
}
/* Re-render the cart drawer and count WITHOUT opening the drawer ('update', not 'add'). */
function syncCartUI(target, cart, sections, lines) {
  try {
    const deferred = CartLinesUpdateEvent.createPromise();
    (target || document).dispatchEvent(new CartLinesUpdateEvent({ action: 'update', context: 'product', lines: lines || [], promise: deferred.promise }));
    deferred.resolve({ cart: CartLinesUpdateEvent.createCartFromAjaxResponse(cart), detail: { items: cart.items, source: 'pulse-buynow', itemCount: cart.item_count, sections, didError: false } });
  } catch (e) { /* UI refresh is best effort */ }
}
function razorpayVisible() {
  const nodes = document.querySelectorAll('iframe, div, section, dialog');
  for (let i = 0; i < nodes.length; i++) {
    const el = nodes[i];
    const cls = typeof el.className === 'string' ? el.className : '';
    if (!/razorpay|rzp|magic-?checkout|magicx/i.test((el.src || '') + ' ' + el.id + ' ' + cls)) continue;
    const r = el.getBoundingClientRect();
    if (r.width > 200 && r.height > 200) {
      const cs = getComputedStyle(el);
      if (cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0') return true;
    }
  }
  return false;
}

let restoring = false;
let buyNowActive = false;
async function restoreCart() {
  const s = readStash();
  if (!s || restoring) return;
  restoring = true;
  buyNowActive = false;
  writeStash(null);
  try {
    const ids = cartSectionIds();
    let sections;
    await fetch('/cart/clear.js', { method: 'POST', credentials: 'same-origin', headers: jsonHeaders, body: '{}' });
    if (s.items.length) {
      const body = { items: s.items };
      if (ids.length) body.sections = ids.join(',');
      const data = await (await fetch('/cart/add.js', { method: 'POST', credentials: 'same-origin', headers: jsonHeaders, body: JSON.stringify(body) })).json();
      sections = data.sections;
    } else if (ids.length) {
      sections = await (await fetch('/?sections=' + ids.join(','), { credentials: 'same-origin' })).json();
    }
    const cart = await getCart();
    syncCartUI(document, cart, sections, s.items.map((i) => ({ merchandiseId: String(i.id), quantity: i.quantity })));
  } catch (e) { /* leave the cart as it is */ }
  restoring = false;
}

/* Press the cart's own Check out button (which Razorpay Magic Checkout listens to),
   keep the drawer closed, then watch for the checkout to close and put the old cart back. */
function pressCheckout(button, label) {
  let tries = 0;
  const reset = () => {
    if (!button) return;
    button.innerHTML = label;
    button.removeAttribute('data-pulse-busy');
    button.removeAttribute('aria-busy');
  };
  const press = () => {
    const btn = document.querySelector('#cart-drawer .cart__checkout-button, #cart-drawer [name="checkout"]');
    if (btn && !btn.disabled) {
      btn.click();
      watchCheckout(reset);
      return;
    }
    if (++tries < 40) { setTimeout(press, 75); return; }
    window.location.href = '/checkout';
  };
  setTimeout(press, 60);
}

function watchCheckout(reset) {
  let seen = false, gone = 0, waited = 0;
  const tick = () => {
    if (razorpayVisible()) {
      if (!seen) { seen = true; reset(); }
      gone = 0;
    } else if (seen) {
      if (++gone >= 3) { restoreCart(); return; }
    } else {
      waited += 300;
      if (waited > 12000) { reset(); return; } /* page is leaving for checkout; restore on next load */
    }
    setTimeout(tick, 300);
  };
  setTimeout(tick, 300);
}

async function buyNow(form, button) {
  buyNowActive = true;
  const fd = new FormData(form);
  const id = Number(fd.get('id'));
  const qty = Number(fd.get('quantity')) || 1;
  const label = setBusy(button);
  if (button) {
    button.innerHTML = isIconButton({ textContent: label.replace(/<[^>]*>/g, '') })
      ? '<span class="pulse-atc-spin" aria-hidden="true"></span>'
      : '<span class="pulse-atc-spin" aria-hidden="true"></span><span>Opening secure checkout…</span>';
  }
  ripple(button);
  try {
    const before = await getCart();
    if (!readStash()) {
      writeStash({
        t: Date.now(),
        items: before.items.map((i) => {
          const line = { id: i.variant_id, quantity: i.quantity };
          if (i.properties && Object.keys(i.properties).length) line.properties = i.properties;
          if (i.selling_plan_allocation) line.selling_plan = i.selling_plan_allocation.selling_plan.id;
          return line;
        }),
      });
    }
    await fetch('/cart/clear.js', { method: 'POST', credentials: 'same-origin', headers: jsonHeaders, body: '{}' });
    const ids = cartSectionIds();
    const body = { items: [{ id, quantity: qty }] };
    if (ids.length) body.sections = ids.join(',');
    const res = await fetch('/cart/add.js', { method: 'POST', credentials: 'same-origin', headers: jsonHeaders, body: JSON.stringify(body) });
    const data = await res.json();
    if (!res.ok || data.status) {
      await restoreCart();
      setDone(button, label, false);
      toast(data.description || data.message || 'Could not start checkout. Please try again.', true);
      return;
    }
    const cart = await getCart();
    syncCartUI(form, cart, data.sections, [{ merchandiseId: String(id), quantity: qty }]);
    pressCheckout(button, label);
  } catch (err) {
    await restoreCart();
    setDone(button, label, false);
    toast('Network problem. Please try again.', true);
  }
}

/* If a Buy Now checkout was left open (page refresh, came back from the thank-you page,
   new tab), put the shopper's original cart back. */
(function restoreOnLoad() {
  if (!readStash()) return;
  setTimeout(() => { if (!buyNowActive && !razorpayVisible()) restoreCart(); }, 2500);
})();

function openDrawer() {
  const drawer = document.querySelector('cart-drawer-component');
  const themeDrawer = drawer && drawer.closest('theme-drawer');
  if (themeDrawer && typeof themeDrawer.open === 'function') {
    if (!themeDrawer.isOpen) themeDrawer.open();
    return true;
  }
  return false;
}

async function addToCart(form, button) {
  const fd = new FormData(form);
  const qty = Number(fd.get('quantity')) || 1;
  fd.set('quantity', String(qty));
  const sectionIds = Array.from(document.querySelectorAll('cart-items-component'))
    .map((el) => el.dataset.sectionId).filter(Boolean);
  if (sectionIds.length) fd.set('sections', sectionIds.join(','));

  const label = setBusy(button);
  ripple(button);
  const flight = flyToCart(button);

  const deferred = CartLinesUpdateEvent.createPromise();
  form.dispatchEvent(new CartLinesUpdateEvent({
    action: 'add',
    context: 'product',
    lines: [{ merchandiseId: String(fd.get('id')), quantity: qty }],
    promise: deferred.promise,
  }));

  try {
    const res = await fetch('/cart/add.js', {
      method: 'POST', body: fd, credentials: 'same-origin',
      headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
    });
    const data = await res.json();
    const failed = !res.ok || data.status;
    if (failed) {
      const c = await (await fetch('/cart.js', { headers: { Accept: 'application/json' }, credentials: 'same-origin' })).json();
      deferred.resolve({ cart: CartLinesUpdateEvent.createCartFromAjaxResponse(c), detail: { items: c.items, source: 'pulse-cart', itemCount: qty, didError: true } });
      setDone(button, label, false);
      toast(data.description || data.message || 'Could not add to cart. Please try again.', true);
      return;
    }
    const cartRes = await fetch('/cart.js', { headers: { Accept: 'application/json' }, credentials: 'same-origin' });
    const cart = await cartRes.json();
    await flight;
    deferred.resolve({
      cart: CartLinesUpdateEvent.createCartFromAjaxResponse(cart),
      detail: { items: cart.items, source: 'pulse-cart', itemCount: qty, sections: data.sections, didError: false },
    });
    setDone(button, label, true);
    if (openDrawer()) highlightLine(String(fd.get('id')));
    else toast('Added to cart');
  } catch (err) {
    deferred.reject(err);
    setDone(button, label, false);
    toast('Network problem. Please try again.', true);
  }
}

document.addEventListener('submit', (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement) || !form.hasAttribute('data-pulse-atc')) return;
  event.preventDefault();
  const btn = event.submitter || form.querySelector('[type="submit"]');
  if (btn && btn.hasAttribute('data-pulse-busy')) return;
  /* Open to everyone (31 Oct 2026): no sign-in needed to add to cart. */
  addToCart(form, btn);
}, true);

/* ------------------------------------------------------------------
   Checkout flow (updated 31 Oct 2026)
   1. Anyone can add to cart, Buy Now and check out; signing in is optional
      (the Diwali scratch card and the once-a-day pop-up invite it).
   2. Buy Now goes straight to Shopify's checkout page for that one chair,
      which shows the chair, price and delivery address, then Razorpay payment.
      (Razorpay Magic Checkout is switched off in this theme.)
   ------------------------------------------------------------------ */
const PULSE_INTENT = 'pulseCheckoutIntent';

function isSignedIn() {
  return !!document.querySelector('.pulse-account-avatar');
}
function saveIntent(intent) {
  try { sessionStorage.setItem(PULSE_INTENT, JSON.stringify(Object.assign({ t: Date.now() }, intent))); } catch (e) { /* storage blocked */ }
}
function takeIntent() {
  try {
    const raw = sessionStorage.getItem(PULSE_INTENT);
    if (!raw) return null;
    const it = JSON.parse(raw);
    if (Date.now() - it.t > 30 * 60 * 1000) { sessionStorage.removeItem(PULSE_INTENT); return null; }
    return it;
  } catch (e) { return null; }
}
function clearIntent() { try { sessionStorage.removeItem(PULSE_INTENT); } catch (e) { /* storage blocked */ } }

function notice(msg) {
  toast(msg, false);
  const el = document.getElementById('pulse-toast');
  if (el) { const a = el.querySelector('a'); if (a) a.remove(); }
}

/* The cart drawer is a modal: while it is open the rest of the page (including the
   sign-in pop-up) cannot be tapped or typed into. Close it before showing sign-in. */
function closeOverlays() {
  let closed = false;
  const drawer = document.querySelector('cart-drawer-component');
  const themeDrawer = drawer && drawer.closest('theme-drawer');
  if (themeDrawer && typeof themeDrawer.close === 'function' && themeDrawer.isOpen !== false) {
    try { themeDrawer.close(); closed = true; } catch (e) { /* ignore */ }
  }
  document.querySelectorAll('dialog[open]').forEach((d) => {
    if (d.closest('[class*="otp"], [id*="otp"]')) return;
    try { d.close(); closed = true; } catch (e) { /* ignore */ }
  });
  document.documentElement.style.removeProperty('overflow');
  document.body.style.removeProperty('overflow');
  return closed;
}

function openLogin(msg) {
  const acc = document.querySelector('[data-pulse-account]');
  const closed = closeOverlays();
  setTimeout(() => {
    notice(msg || 'Please sign in to continue to checkout');
    if (acc) { acc.click(); return; }
    window.location.href = '/account/login';
  }, closed ? 380 : 0);
}

/* Buy Now: sign in first, then straight to the checkout page for this chair. */
document.addEventListener('click', (event) => {
  const link = event.target instanceof Element && event.target.closest('a[href*="/cart/"][href*=":"]');
  if (!link) return;
  const form = link.closest('form[data-pulse-atc]');
  if (!form) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  if (link.hasAttribute('data-pulse-busy')) return;
  const fd = new FormData(form);
  goBuy(Number(fd.get('id')), Number(fd.get('quantity')) || 1, link);
}, true);

function goBuy(id, qty, btn) {
  if (btn) setBusy(btn);
  window.location.href = '/cart/' + id + ':' + qty;
  /* Safety net: if the page is still here after a while (navigation cancelled, slow network), unlock the button. */
  if (btn) setTimeout(() => { if (btn.hasAttribute('data-pulse-busy')) resetBusy(7000); }, 8000);
}

/* Check out buttons work for everyone (31 Oct 2026): Shopify checkout asks for the phone/email itself. */

/* Back from sign-in: carry on where the shopper left off and show the order to review. */
function resumeAfterLogin() {
  const it = takeIntent();
  if (!it || !isSignedIn()) return;
  clearIntent();
  const showOrder = () => {
    let tries = 0;
    const tryOpen = () => {
      if (openDrawer()) { if (it.id) highlightLine(String(it.id)); notice('Signed in. Tap Check out to continue'); return; }
      if (++tries < 30) { setTimeout(tryOpen, 100); return; }
      window.location.href = '/cart';
    };
    tryOpen();
  };
  if (it.type === 'buy' && it.id) { goBuy(it.id, it.quantity || 1, null); return; }
  if (it.type === 'add' && it.id) {
    fetch('/cart/add.js', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ items: [{ id: it.id, quantity: it.quantity || 1 }] }),
    }).then(() => { saveIntent({ type: 'show', id: it.id }); window.location.reload(); }).catch(() => showOrder());
    return;
  }
  showOrder();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(resumeAfterLogin, 400));
else setTimeout(resumeAfterLogin, 400);

/* Warm up the cart endpoint when a shopper reaches for an add-to-cart button,
   so the first add does not pay the connection set-up cost. */
let warmed = false;
function warm(e) {
  if (warmed) return;
  const t = e.target;
  if (!(t instanceof Element) || !t.closest('form[data-pulse-atc]')) return;
  warmed = true;
  fetch('/cart.js', { credentials: 'same-origin', headers: { Accept: 'application/json' } }).catch(() => {});
}
document.addEventListener('pointerover', warm, { passive: true });
document.addEventListener('touchstart', warm, { passive: true });
/* ------------------------------------------------------------------
   Diwali coupon in the cart (until 15 Nov 2026)
   Signed-in shoppers who scratched the Diwali card (pulseDiwali3000 on this device) see a
   "DIWALI3000 · Tap to apply" chip under the cart's Discount box. The code is applied in the cart
   automatically once; if they remove it, it isn't forced back, but the chip lets them re-add it in one tap.
   Uses the theme's own discount form (cart-discount-component), so the cart re-renders normally.
   ------------------------------------------------------------------ */
(() => {
  const CODE = 'DIWALI3000';
  const SCRATCH_KEY = 'pulseDiwali3000';
  const REMOVED_KEY = 'pulseDiwaliRemoved';
  const ENDS = Date.parse('2026-11-15T18:29:59Z');
  const ls = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const ss = (k, v) => { try { if (v === undefined) return sessionStorage.getItem(k); if (v === null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, v); } catch (e) { return null; } };
  const eligible = () => Date.now() < ENDS && ls(SCRATCH_KEY) === '1' && isSignedIn();

  const css = document.createElement('style');
  css.textContent = '.pdw-chip{all:unset;box-sizing:border-box;display:flex;align-items:center;gap:10px;width:100%;margin:10px 0 2px;padding:10px 12px;border-radius:12px;cursor:pointer;'
    + 'background:linear-gradient(110deg,#FFF4E5,#FFE7C7);border:1px dashed #E0A040;color:#5A0F1E;font-size:13px;font-weight:600;line-height:1.3;-webkit-tap-highlight-color:transparent}'
    + '.pdw-chip:hover{border-style:solid}.pdw-chip b{font-weight:800;letter-spacing:.04em}'
    + '.pdw-chip__ic{flex:0 0 auto;width:28px;height:28px;border-radius:8px;display:grid;place-items:center;background:#B3261E;color:#FFD978;font-size:15px}'
    + '.pdw-chip__tx{flex:1 1 auto;min-width:0}.pdw-chip__tx small{display:block;font-size:11.5px;font-weight:500;color:#7A4A2A}'
    + '.pdw-chip__go{flex:0 0 auto;padding:6px 12px;border-radius:999px;background:#1B355E;color:#fff;font-size:12px;font-weight:700}'
    + '.pdw-chip[aria-busy="true"]{opacity:.6;pointer-events:none}';
  document.head.appendChild(css);

  const codesIn = (comp) => Array.from(comp.querySelectorAll('.cart-discount__pill')).map((p) => (p.dataset.discountCode || '').toUpperCase());

  const ready = () => (window.customElements && customElements.whenDefined
    ? Promise.race([customElements.whenDefined('cart-discount-component'), new Promise((r) => setTimeout(r, 4000))])
    : Promise.resolve());

  /* Submit the code through the theme's own discount form (waits until that form is wired up). */
  async function apply(chip) {
    await ready();
    const comp = document.querySelector('cart-discount-component');
    const form = comp && comp.querySelector('form');
    const input = comp && comp.querySelector('input[name="discount"]');
    if (!form || !input) return false;
    if (codesIn(comp).includes(CODE)) return true;
    if (chip) chip.setAttribute('aria-busy', 'true');
    ss(REMOVED_KEY, null);
    input.value = CODE;
    if (typeof form.requestSubmit === 'function') form.requestSubmit(); else form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    setTimeout(() => { if (chip) chip.removeAttribute('aria-busy'); }, 4000);
    return true;
  }

  /* Does the cart hold a wheelchair (the coupon doesn't apply to accessories)? Cached for a few seconds. */
  let cartInfo = { t: 0, chair: false, count: 0 }, cartFetching = false;
  function refreshCart() {
    if (cartFetching || Date.now() - cartInfo.t < 3000) return;
    cartFetching = true;
    fetch('/cart.js', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then((r) => r.json())
      .then((c) => {
        const chair = !!(c && c.items || []).some((i) => !/accessor|spare/i.test(i.product_type || ''));
        const changed = chair !== cartInfo.chair;
        cartInfo = { t: Date.now(), chair, count: (c && c.item_count) || 0 };
        if (changed) sync();
      })
      .catch(() => {})
      .finally(() => { cartFetching = false; });
  }
  document.addEventListener('cart:update', () => { cartInfo.t = 0; refreshCart(); });

  let autoTries = 0, autoBusy = false;
  function sync() {
    refreshCart();
    const ok = eligible() && cartInfo.chair;
    const comp = document.querySelector('cart-discount-component');
    if (!comp) return;
    /* The chip sits under the whole Discount box (outside its collapsible area, so it is always visible). */
    const host = comp.closest('.cart-actions') || comp.closest('.cart-discount') || comp.parentNode;
    const has = codesIn(comp).includes(CODE);
    let chip = host.querySelector('.pdw-chip');
    if (!ok || has) { if (chip) chip.remove(); return; }
    if (!chip) {
      chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'pdw-chip';
      chip.innerHTML = '<span class="pdw-chip__ic" aria-hidden="true">✦</span><span class="pdw-chip__tx">Your Diwali coupon <b>' + CODE + '</b><small>₹3,000 off each wheelchair · valid till 15 Nov</small></span><span class="pdw-chip__go">Apply</span>';
      chip.addEventListener('click', (e) => { e.preventDefault(); apply(chip); });
      host.appendChild(chip);
    }
    /* Apply it for a scratched shopper automatically (unless they removed it); retry a couple of times if the cart wasn't ready. */
    if (!ss(REMOVED_KEY) && !autoBusy && autoTries < 3) {
      autoBusy = true; autoTries++;
      apply(null).catch(() => {}).finally(() => { setTimeout(() => { autoBusy = false; }, 3500); });
    }
  }

  /* Remember when the shopper removes the Diwali pill themselves, so it isn't re-added automatically. */
  document.addEventListener('click', (e) => {
    const pill = e.target instanceof Element && e.target.closest('.cart-discount__pill');
    if (pill && (pill.dataset.discountCode || '').toUpperCase() === CODE && e.target.closest('button, [role="button"], svg, .cart-discount__pill-remove')) ss(REMOVED_KEY, '1');
  }, true);

  let t = 0;
  new MutationObserver(() => { clearTimeout(t); t = setTimeout(sync, 120); }).observe(document.documentElement, { childList: true, subtree: true });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', sync); else sync();
})();
