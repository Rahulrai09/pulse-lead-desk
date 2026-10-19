// Pulse Lead Desk – Shopify custom pixel (Settings → Customer events → Add custom pixel)
const ENDPOINT = "https://kpvtevdlmkjngqxdgmlw.supabase.co/functions/v1/store-track";
const cust = () => (init && init.data && init.data.customer && init.data.customer.id) || "";
const dev = (e) => (/Mobi|Android|iPhone/i.test((e.context && e.context.navigator && e.context.navigator.userAgent) || "") ? "mobile" : "desktop");
const send = (body) => { try { fetch(ENDPOINT, { method: "POST", body: JSON.stringify(body), keepalive: true, headers: { "Content-Type": "text/plain" } }); } catch (e) {} };

analytics.subscribe("product_added_to_cart", (e) => {
  const l = (e.data && e.data.cartLine) || {}, m = l.merchandise || {};
  send({ k: "cart", c: cust(), v: e.clientId, p: e.context.document.location.pathname, d: dev(e),
    m: { t: m.product && m.product.title, vt: m.title, q: l.quantity, a: m.price && m.price.amount, cur: m.price && m.price.currencyCode } });
});

analytics.subscribe("checkout_started", (e) => {
  const k = (e.data && e.data.checkout) || {}, items = k.lineItems || [], a = k.shippingAddress || k.billingAddress || {};
  send({ k: "checkout", c: cust(), v: e.clientId, p: e.context.document.location.pathname, d: dev(e),
    m: { t: items.map((i) => i.title).join(", "), n: items.reduce((s, i) => s + (i.quantity || 0), 0),
      tot: k.totalPrice && k.totalPrice.amount, cur: k.currencyCode, em: k.email, ph: k.phone || a.phone,
      nm: [a.firstName, a.lastName].filter(Boolean).join(" ") } });
});
