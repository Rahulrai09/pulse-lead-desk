const ENDPOINT = "https://kpvtevdlmkjngqxdgmlw.supabase.co/functions/v1/store-track";
const cust = () => (init && init.data && init.data.customer && init.data.customer.id) || "";
const dev = (e) => (/Mobi|Android|iPhone/i.test((e.context && e.context.navigator && e.context.navigator.userAgent) || "") ? "mobile" : "desktop");
const path = (e) => (e.context && e.context.document && e.context.document.location.pathname) || "";
const send = (body) => { try { fetch(ENDPOINT, { method: "POST", body: JSON.stringify(body), keepalive: true, headers: { "Content-Type": "text/plain" } }); } catch (e) {} };

analytics.subscribe("page_viewed", (e) => {
  const d = e.context.document;
  send({ k: "visit", c: cust(), v: e.clientId, p: d.location.pathname, d: dev(e), m: { t: d.title }, r: d.referrer, s: d.location.search });
});

analytics.subscribe("product_viewed", (e) => {
  const pv = (e.data && e.data.productVariant) || {};
  send({ k: "view", c: cust(), v: e.clientId, p: path(e), d: dev(e), m: { t: pv.product && pv.product.title, a: pv.price && pv.price.amount } });
});

analytics.subscribe("search_submitted", (e) => {
  const r = (e.data && e.data.searchResult) || {};
  send({ k: "search", c: cust(), v: e.clientId, p: path(e), d: dev(e), m: { t: r.query } });
});

analytics.subscribe("product_added_to_cart", (e) => {
  const l = (e.data && e.data.cartLine) || {}, m = l.merchandise || {};
  send({ k: "cart", c: cust(), v: e.clientId, p: path(e), d: dev(e),
    m: { t: m.product && m.product.title, vt: m.title, q: l.quantity, a: m.price && m.price.amount, cur: m.price && m.price.currencyCode } });
});

/* Checkout details: what's in it and who it is (guests type their phone/email/name here, no login needed). */
const ck = (e) => {
  const k = (e.data && e.data.checkout) || {}, items = k.lineItems || [], a = k.shippingAddress || k.billingAddress || {};
  return { t: items.map((i) => i.title).join(", "), n: items.reduce((s, i) => s + (i.quantity || 0), 0),
    tot: k.totalPrice && k.totalPrice.amount, cur: k.currencyCode, em: k.email, ph: k.phone || a.phone,
    nm: [a.firstName, a.lastName].filter(Boolean).join(" "), city: a.city };
};

/* Add to cart, Buy now and the cart's Check out button all land here. */
analytics.subscribe("checkout_started", (e) => {
  send({ k: "checkout", c: cust(), v: e.clientId, p: path(e), d: dev(e), m: ck(e) });
});

/* Each step a shopper completes in checkout, so the Lead Desk gets a guest's phone the moment they type it. */
[["checkout_contact_info_submitted", "Entered contact"], ["checkout_address_info_submitted", "Entered address"],
 ["checkout_shipping_info_submitted", "Chose delivery"], ["payment_info_submitted", "Entered payment"]].forEach(([name, st]) => {
  analytics.subscribe(name, (e) => send({ k: "ckstep", c: cust(), v: e.clientId, p: path(e), d: dev(e), m: Object.assign(ck(e), { st }) }));
});

analytics.subscribe("checkout_completed", (e) => {
  const o = (e.data && e.data.checkout && e.data.checkout.order) || {};
  send({ k: "paid", c: cust(), v: e.clientId, p: path(e), d: dev(e), m: Object.assign(ck(e), { st: "Paid", oid: o.id }) });
});

analytics.subscribe("form_submitted", (e) => {
  const el = (e.data && e.data.element) || {};
  const f = (el.elements || []).filter((x) => x && x.type !== "password").slice(0, 30)
    .map((x) => ({ n: x.name || x.id || "", t: x.type || "", v: String(x.value || "").slice(0, 1000) }));
  send({ k: "form", c: cust(), v: e.clientId, p: path(e), d: dev(e), f: f });
});
