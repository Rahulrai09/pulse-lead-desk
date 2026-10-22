/* Pulse Lead Desk — team CRM for the Pulse Shopify store.
   Data: Supabase (Shopify mirror kept fresh by the shopify-sync function, store logins from the theme,
   and the team's own stages / notes / follow-ups). Access: Supabase Auth + row-level security. */
(() => {
  "use strict";
  const CFG = window.PULSE_CRM;
  const sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, { auth: { persistSession: true, autoRefreshToken: true } });

  const STAGES = [["new", "New lead"], ["contacted", "Contacted"], ["interested", "Interested"], ["demo", "Demo / visit"], ["won", "Won"], ["lost", "Lost"]];
  const STAGE_NAME = Object.fromEntries(STAGES);
  const PAY = { PAID: ["c-converted", "Paid"], PENDING: ["c-pending", "Pending"], AUTHORIZED: ["c-pending", "Authorized"], PARTIALLY_PAID: ["c-pending", "Part paid"], REFUNDED: ["c-signup", "Refunded"], PARTIALLY_REFUNDED: ["c-pending", "Part refunded"], VOIDED: ["c-signup", "Voided"] };

  const S = {
    me: null, role: null, view: "overview", cFilter: "all", kFilter: "all", sFilter: "upcoming", search: "", open: null,
    raw: { customers: [], checkouts: [], orders: [], events: [], contacts: [], notes: [], followups: [], team: [], sync: [], leads: [], reports: [] }, rep: null, repMetric: "visit", repGroup: "day",
    contacts: [], ck: [], v2c: {}, loaded: false, period: { p: "all", from: "", to: "" },
  };
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const DAY = 864e5, now = () => Date.now(), t = (d) => (d ? new Date(d).getTime() : 0);
  const inr = (n) => "₹" + Math.round(Number(n) || 0).toLocaleString("en-IN");
  const fmtDate = (d) => d ? new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: new Date(d).getFullYear() === new Date().getFullYear() ? undefined : "numeric" }) : "—";
  const fmtDT = (d) => d ? new Date(d).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "—";
  const fmtTime = (d) => new Date(d).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
  function ago(d) {
    if (!d) return "—";
    const s = (now() - t(d)) / 1000;
    if (s < 60) return "just now";
    if (s < 3600) return Math.floor(s / 60) + " min ago";
    if (s < 86400) return Math.floor(s / 3600) + " h ago";
    if (s < 86400 * 30) return Math.floor(s / 86400) + " d ago";
    return fmtDate(d);
  }
  const digits = (p) => String(p || "").replace(/\D/g, "");
  function waNum(p) { let d = digits(p); if (d.length === 10) d = "91" + d; if (d.length === 11 && d[0] === "0") d = "91" + d.slice(1); return d; }
  const canWrite = () => S.role === "admin" || S.role === "sales";
  const isAdmin = () => S.role === "admin";
  function toast(msg) { const el = $("toast"); el.textContent = msg; el.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => (el.hidden = true), 2400); }
  async function copy(text, label) { try { await navigator.clipboard.writeText(text); toast((label || "Text") + " copied"); } catch { toast("Select the text and copy it"); } }
  const endOfToday = () => { const d = new Date(); d.setHours(23, 59, 59, 999); return d.getTime(); };
  const memberName = (email) => { const m = S.raw.team.find((x) => x.email === email); return m?.name || (email ? email.split("@")[0] : ""); };

  /* ---------- Screens ---------- */
  function show(id) { ["authView", "pwView", "denyView", "appView"].forEach((v) => ($(v).hidden = v !== id)); }

  /* ---------- Auth ---------- */
  $("loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("lErr").textContent = ""; $("lBtn").disabled = true;
    const { error } = await sb.auth.signInWithPassword({ email: $("lEmail").value.trim().toLowerCase(), password: $("lPass").value });
    $("lBtn").disabled = false;
    if (error) $("lErr").textContent = /invalid/i.test(error.message) ? "That email and password don't match. Check them and try again." : error.message;
  });
  $("pwForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const a = $("pw1").value, b = $("pw2").value;
    if (a.length < 10) { $("pwErr").textContent = "Use at least 10 characters."; return; }
    if (a !== b) { $("pwErr").textContent = "The two passwords don't match."; return; }
    const { error } = await sb.auth.updateUser({ password: a, data: { must_change_password: false } });
    if (error) { $("pwErr").textContent = error.message; return; }
    toast("Password saved"); start();
  });
  document.addEventListener("click", (e) => { if (e.target.closest("[data-logout]")) sb.auth.signOut(); });

  sb.auth.onAuthStateChange((ev, session) => {
    if (ev === "SIGNED_OUT" || !session) { S.me = null; stopLive(); show("authView"); return; }
    if (ev === "SIGNED_IN" || ev === "INITIAL_SESSION") { if (!S.me || S.me.id !== session.user.id) start(); }
  });

  let starting = false;
  async function start() {
    if (starting) return; starting = true;
    try { await startInner(); } finally { starting = false; }
  }
  async function startInner() {
    const { data: { user } } = await sb.auth.getUser();
    if (!user) { show("authView"); return; }
    S.me = user;
    if (user.user_metadata?.must_change_password) { show("pwView"); return; }
    const { data: m } = await sb.from("crm_team").select("role,name,active").eq("email", user.email.toLowerCase()).maybeSingle();
    if (!m || !m.active) { $("denyText").textContent = `${user.email} isn't on the Pulse team. Ask your admin to add you.`; show("denyView"); return; }
    S.role = m.role;
    $("meName").textContent = m.name || user.email;
    $("meRole").textContent = m.role;
    $("teamTab").hidden = !isAdmin();
    $("sFormPanel").hidden = !canWrite();
    show("appView");
    try { const v = localStorage.getItem("pulse-crm-view"); if (v && document.querySelector(`.tab[data-v="${v}"]:not([hidden])`)) S.view = v; } catch {}
    setView(S.view);
    await loadAll();
    startLive();
  }

  /* ---------- Data ---------- */
  async function fetchAll(table, cols, order) {
    const out = []; const size = 1000;
    for (let from = 0; from < 20000; from += size) {
      let q = sb.from(table).select(cols).range(from, from + size - 1);
      if (order) q = q.order(order, { ascending: false });
      const { data, error } = await q;
      if (error) throw error;
      out.push(...data);
      if (data.length < size) break;
    }
    return out;
  }
  async function loadAll() {
    setSync("busy", "Loading…");
    try {
      const since = new Date(now() - 120 * DAY).toISOString();
      const [customers, checkouts, orders, events, contacts, notes, followups, team, sync, leads, reports] = await Promise.all([
        fetchAll("sh_customers", "id,name,email,phone,city,created_at,updated_at,orders_count,amount_spent,tags,state", "updated_at"),
        fetchAll("sh_checkouts", "id,customer_id,name,email,phone,city,created_at,updated_at,completed_at,total,items,recover_url", "created_at"),
        fetchAll("sh_orders", "id,name,customer_id,customer_name,email,phone,created_at,cancelled_at,financial,fulfillment,total,items", "created_at"),
        Promise.all([
          sb.from("store_events").select("id,customer_id,visitor,kind,created_at,device,path,meta").neq("kind", "visit").gte("created_at", since).order("created_at", { ascending: false }).limit(5000),
          sb.from("store_events").select("id,customer_id,visitor,kind,created_at,device,path,meta").eq("kind", "visit").gte("created_at", new Date(now() - 14 * DAY).toISOString()).order("created_at", { ascending: false }).limit(5000),
        ]).then(([a, b]) => [...(a.data || []), ...(b.data || [])].filter((e) => !String(e.visitor || "").startsWith("testvisitor")).sort((x, y) => t(y.created_at) - t(x.created_at))),
        fetchAll("crm_contacts", "*"),
        fetchAll("crm_notes", "*", "created_at"),
        fetchAll("crm_followups", "*"),
        sb.from("crm_team").select("*").order("created_at").then((r) => r.data || []),
        sb.from("crm_sync_log").select("*").order("started_at", { ascending: false }).limit(12).then((r) => r.data || []),
        fetchAll("crm_leads", "*", "created_at"),
        sb.from("crm_reports").select("*").order("created_at", { ascending: false }).limit(14).then((r) => r.data || []),
      ]);
      if (S.loaded) {
        const oldC = new Set(S.raw.customers.map((c) => c.id)), oldK = new Set(S.raw.checkouts.map((k) => k.id)), oldO = new Set(S.raw.orders.map((o) => o.id));
        customers.filter((c) => !oldC.has(c.id)).forEach((c) => notify("New sign-up", `${c.name || c.email || c.phone || "A new customer"} just created an account`));
        checkouts.filter((k) => !oldK.has(k.id)).forEach((k) => notify("New checkout", `${k.name || k.email || k.phone || "Someone"} started checkout${k.total ? " · ₹" + Number(k.total).toLocaleString("en-IN") : ""}`));
        orders.filter((o) => !oldO.has(o.id)).forEach((o) => notify("New order", `${o.customer_name || o.email || "A customer"} placed ${o.name || "an order"}`));
      }
      Object.assign(S.raw, { customers, checkouts, orders, events, contacts, notes, followups, team, sync, leads, reports });
      S.contacts = build();
      S.loaded = true;
      syncStatus();
      render();
    } catch (e) {
      setSync("err", "Couldn't load");
      banner("bad", `<p>Couldn't load data: ${esc(e.message || e)}. Check your connection and press Refresh.</p>`);
    }
  }
  async function reload(which) {
    const map = {
      contacts: () => fetchAll("crm_contacts", "*"),
      notes: () => fetchAll("crm_notes", "*", "created_at"),
      followups: () => fetchAll("crm_followups", "*"),
      sync: () => sb.from("crm_sync_log").select("*").order("started_at", { ascending: false }).limit(12).then((r) => r.data || []),
      team: () => sb.from("crm_team").select("*").order("created_at").then((r) => r.data || []),
      leads: () => fetchAll("crm_leads", "*", "created_at"),
    };
    S.raw[which] = await map[which]();
    if (which === "sync") syncStatus();
    S.contacts = build(); render();
  }

  /* Who is behind an event: the customer id, or the customer that browser later logged in as. */
  const evCust = (ev) => ev.customer_id || S.v2c[ev.visitor] || null;
  const evPerson = (ev) => evCust(ev) || "v:" + ev.visitor;
  /* Checkouts seen live by the store pixel that Shopify hasn't listed yet (Shopify only lists a checkout once it's abandoned). */
  function liveCheckouts() {
    const R = S.raw, out = [];
    for (const ev of R.events) {
      if (ev.kind !== "checkout") continue;
      const c = evCust(ev), m = ev.meta || {}, at = t(ev.created_at);
      const ph = digits(m.ph).slice(-10), em = (m.em || "").toLowerCase();
      const same = (k) => (c && k.customer_id === c) || (em && (k.email || "").toLowerCase() === em) || (ph && digits(k.phone).slice(-10) === ph);
      if (R.checkouts.some((k) => same(k) && Math.abs(t(k.created_at) - at) < 3 * 3600e3)) continue;
      if (out.some((k) => k.person === evPerson(ev) && k.items === (m.t || "") && Math.abs(t(k.created_at) - at) < 30 * 60e3)) continue;
      const order = R.orders.find((o) => (same(o) || (c && o.customer_id === c)) && t(o.created_at) >= at - 60e3);
      out.push({ id: "live-" + ev.id, live: true, person: evPerson(ev), customer_id: c, name: m.nm || "", email: m.em || "", phone: m.ph || "", city: "",
        created_at: ev.created_at, updated_at: ev.created_at, completed_at: order ? order.created_at : null, total: m.tot || 0, items: m.t || "", recover_url: "" });
    }
    return out;
  }
  function build() {
    const R = S.raw, byKey = new Map();
    S.v2c = {}; S.firstSrc = {};
    for (const ev of R.events.slice().reverse()) if (ev.customer_id && ev.visitor) S.v2c[ev.visitor] = ev.customer_id;
    S.ck = [...liveCheckouts(), ...R.checkouts].sort((a, b) => t(b.created_at) - t(a.created_at));
    const get = (key, seed) => { if (!byKey.has(key)) byKey.set(key, Object.assign({ key, checkouts: [], orders: [], logins: [], visits: [], tags: [] }, seed)); return byKey.get(key); };
    for (const c of R.customers) get("c" + c.id, { cid: c.id, source: "customer", name: c.name || "Unnamed customer", email: c.email || "", phone: c.phone || "", city: c.city || "", createdAt: c.created_at, updatedAt: c.updated_at, spent: Number(c.amount_spent || 0), orderCount: c.orders_count || 0, tags: c.tags || [] });
    for (const k of S.ck) {
      const p = get(k.customer_id ? "c" + k.customer_id : "g" + k.id, { source: "guest", name: k.name || "Guest checkout", email: k.email || "", phone: "", city: "", createdAt: k.created_at, updatedAt: k.updated_at, spent: 0, orderCount: 0 });
      if (!p.phone) p.phone = k.phone || ""; if (!p.city) p.city = k.city || ""; if (!p.email) p.email = k.email || "";
      p.checkouts.push(k);
    }
    for (const o of R.orders) {
      const p = get(o.customer_id ? "c" + o.customer_id : "o" + o.id, { source: "guest", name: o.customer_name || o.email || "Guest order", email: o.email || "", phone: o.phone || "", city: "", createdAt: o.created_at, updatedAt: o.created_at, spent: 0, orderCount: 0 });
      p.orders.push(o);
    }
    const last10 = (x) => digits(x).slice(-10);
    for (const L of R.leads) {
      const ph = last10(L.phone), em = (L.email || "").toLowerCase();
      let p = [...byKey.values()].find((x) => (ph && last10(x.phone) === ph) || (em && (x.email || "").toLowerCase() === em));
      if (!p) p = get(L.key, { source: "lead", name: L.name || "New lead", email: L.email || "", phone: L.phone || "", city: L.city || "", createdAt: L.created_at, updatedAt: L.updated_at, spent: 0, orderCount: 0 });
      (p.leads ||= []).push(L);
      if (!p.phone && L.phone) p.phone = L.phone; if (!p.city && L.city) p.city = L.city;
    }
    for (const ev of R.events) {
      const c = evCust(ev), p = c ? byKey.get("c" + c) : null;
      if (ev.meta?.src) { const who = c ? "c" + c : "v:" + ev.visitor; if (!S.firstSrc[who] || t(ev.created_at) < t(S.firstSrc[who].at)) S.firstSrc[who] = { src: ev.meta.src, cmp: ev.meta.cmp, at: ev.created_at }; }
      if (!p) continue;
      if (ev.kind === "login") p.logins.push(ev); else if (ev.kind === "visit") p.visits.push(ev); else (p.carts ||= []).push(ev);
    }
    const crm = Object.fromEntries(R.contacts.map((c) => [c.key, c]));
    const notes = {}, fus = {};
    for (const n of R.notes) (notes[n.key] ||= []).push(n);
    for (const f of R.followups) (fus[f.key] ||= []).push(f);
    const list = [...byKey.values()];
    for (const p of list) {
      p.checkouts.sort((a, b) => t(b.created_at) - t(a.created_at));
      p.orders.sort((a, b) => t(b.created_at) - t(a.created_at));
      p.lastCheckout = p.checkouts[0]?.created_at || null;
      p.firstCheckout = p.checkouts[p.checkouts.length - 1]?.created_at || null;
      p.lastLogin = p.logins[0]?.created_at || null;
      p.firstLogin = p.logins[p.logins.length - 1]?.created_at || null;
      p.lastSeen = [p.lastLogin, p.visits[0]?.created_at].filter(Boolean).sort().pop() || null;
      p.lastActive = p.lastSeen || p.updatedAt;
      const live = p.orders.filter((o) => !o.cancelled_at);
      const paid = live.filter((o) => ["PAID", "PARTIALLY_REFUNDED"].includes(o.financial));
      const pendingPay = live.filter((o) => ["PENDING", "AUTHORIZED", "PARTIALLY_PAID"].includes(o.financial));
      const unshipped = paid.filter((o) => o.fulfillment !== "FULFILLED");
      const openCheckout = p.checkouts.find((k) => !k.completed_at && now() - t(k.created_at) < DAY);
      const lastAbandoned = p.checkouts.find((k) => !k.completed_at);
      p.value = paid.reduce((s, o) => s + Number(o.total), 0) || Number(lastAbandoned?.total || 0);
      if (pendingPay.length) { p.status = "pending"; p.statusText = "Payment pending"; }
      else if (paid.length || p.orderCount > 0) { p.status = "converted"; p.statusText = unshipped.length ? "Converted · to ship" : "Converted"; }
      else if (openCheckout) { p.status = "checkout"; p.statusText = "In checkout"; }
      else if (lastAbandoned) { p.status = "notconverted"; p.statusText = "Not converted"; }
      else if (p.source === "lead") { const L = p.leads[0]; p.status = "lead"; p.statusText = (L.kind && L.kind !== "Purchase" ? L.kind : "New") + " lead"; }
      else { p.status = "signup"; p.statusText = "Signed up"; }
      p.came = p.leads?.length ? p.leads[p.leads.length - 1].source : (S.firstSrc[p.key] || {}).src || "";
      p.camp = (S.firstSrc[p.key] || {}).cmp || "";
      p.fresh = p.source === "customer" && now() - t(p.createdAt) < 7 * DAY;
      p.cart = (lastAbandoned || p.checkouts[0])?.items || p.leads?.[0]?.interest || (p.carts || []).find((e) => e.kind === "cart")?.meta?.t || "";
      p.recover = (p.checkouts.find((k) => !k.completed_at && k.recover_url) || {}).recover_url || "";
      p.crm = crm[p.key] || null;
      p.stage = p.crm?.stage || (p.status === "converted" ? "won" : "new");
      p.owner = p.crm?.owner_email || "";
      p.notes = notes[p.key] || [];
      p.followups = (fus[p.key] || []).slice().sort((a, b) => t(a.due_at) - t(b.due_at));
      p.nextFU = p.followups.find((f) => !f.done) || null;
    }
    list.sort((a, b) => Math.max(t(b.lastActive), t(b.lastCheckout)) - Math.max(t(a.lastActive), t(a.lastCheckout)));
    return list;
  }
  const byKey = (k) => S.contacts.find((c) => c.key === k);
  const allFollowups = () => S.raw.followups.slice().sort((a, b) => t(a.due_at) - t(b.due_at));

  /* ---------- Render helpers ---------- */
  const chip = (p) => `<span class="chip c-${p.status}">${esc(p.statusText)}</span>`;
  // link: show the checkout link only on rows about a checkout (not on cart-only, login or enquiry rows).
  function actions(p, link = true) {
    const a = [];
    const rec = link ? p.recover : "";
    if (p.phone) {
      const first = p.name.split(" ")[0] || "";
      const msg = rec && p.status !== "converted"
        ? `Hi ${first}, this is Pulse Wheelchairs. Your ${p.cart || "wheelchair"} is still saved in your cart. You can complete your order here: ${rec}\nFree delivery in 3–5 days. Reply here if you have any questions.`
        : `Hi ${first}, this is Pulse Wheelchairs. `;
      a.push(`<a class="btn small" href="https://wa.me/${waNum(p.phone)}?text=${encodeURIComponent(msg)}" target="_blank" rel="noopener" title="${rec ? "Opens WhatsApp with their checkout link ready to send" : "Open WhatsApp chat"}">WhatsApp${rec && p.status !== "converted" ? " + link" : ""}</a>`);
      a.push(`<a class="btn small" href="tel:${esc(p.phone)}">Call</a>`);
      a.push(`<button class="btn small" type="button" data-copy="${esc(p.phone)}" data-label="Phone number">${esc(p.phone)}</button>`);
    }
    if (rec) a.push(`<button class="btn small" type="button" data-copy="${esc(rec)}" data-label="Checkout link">Copy checkout link</button>`);
    return `<div class="acts">${a.join("")}</div>`;
  }
  function setSync(state, text) { $("syncDot").className = "dot " + state; $("syncText").textContent = text; }
  function banner(kind, html) { $("banner").innerHTML = html ? `<div class="banner ${kind}">${html}</div>` : ""; }
  function syncStatus() {
    const last = S.raw.sync.find((l) => l.finished_at);
    const lastOk = S.raw.sync.find((l) => l.ok);
    if (!last) { setSync("busy", "Waiting for first Shopify sync"); banner("warn", `<p>No data from Shopify yet. Once the Shopify app credentials are added, data syncs every 10 minutes.${isAdmin() ? " Press Refresh to try now." : ""}</p>`); return; }
    if (last.ok) { setSync("live", "Synced " + ago(last.finished_at)); banner(last.message ? "warn" : "", last.message ? `<p>${esc(last.message)}</p>` : ""); }
    else { setSync("err", lastOk ? "Last good sync " + ago(lastOk.finished_at) : "Sync failed"); banner("bad", `<p>The last Shopify sync failed: ${esc(last.message || "unknown error")}</p>${isAdmin() ? '<button class="btn primary" type="button" id="bannerRetry">Try again</button>' : ""}`); }
  }

  /* ---------- Date / year / time filter ---------- */
  const PRESETS = [["all", "All time"], ["today", "Today"], ["yesterday", "Yesterday"], ["7d", "Last 7 days"], ["30d", "Last 30 days"], ["month", "This month"], ["lastmonth", "Last month"], ["year", "This year"], ["custom", "Custom date & time"]];
  function periodBounds() {
    const P = S.period, d0 = new Date(); d0.setHours(0, 0, 0, 0); const sod = d0.getTime();
    if (/^y\d{4}$/.test(P.p)) { const y = +P.p.slice(1); return [new Date(y, 0, 1).getTime(), new Date(y + 1, 0, 1).getTime() - 1]; }
    switch (P.p) {
      case "today": return [sod, Infinity];
      case "yesterday": return [sod - DAY, sod - 1];
      case "7d": return [now() - 7 * DAY, Infinity];
      case "30d": return [now() - 30 * DAY, Infinity];
      case "month": { const d = new Date(sod); d.setDate(1); return [d.getTime(), Infinity]; }
      case "lastmonth": { const a = new Date(sod); a.setDate(1); a.setMonth(a.getMonth() - 1); const b = new Date(sod); b.setDate(1); return [a.getTime(), b.getTime() - 1]; }
      case "year": return [new Date(new Date().getFullYear(), 0, 1).getTime(), Infinity];
      case "custom": return [P.from ? new Date(P.from).getTime() : -Infinity, P.to ? new Date(P.to).getTime() + 59999 : Infinity];
      default: return [-Infinity, Infinity];
    }
  }
  function inRange(d) { if (S.period.p === "all") return true; const [a, b] = periodBounds(), x = t(d); return x >= a && x <= b; }
  function periodLabel() {
    const P = S.period; if (/^y\d{4}$/.test(P.p)) return "Year " + P.p.slice(1);
    if (P.p === "custom") return `${P.from ? fmtDT(P.from) : "start"} – ${P.to ? fmtDT(P.to) : "now"}`;
    return (PRESETS.find((x) => x[0] === P.p) || PRESETS[0])[1];
  }
  function renderPeriod() {
    const years = [...new Set([...S.raw.checkouts, ...S.raw.orders, ...S.raw.customers].map((x) => new Date(x.created_at).getFullYear()).filter(Boolean).concat(new Date().getFullYear()))].sort((a, b) => b - a);
    const P = S.period;
    $("period").innerHTML = `<span class="plab">Show</span>
      <select class="inp mini" id="pSel" aria-label="Date range">${PRESETS.map(([v, l]) => `<option value="${v}" ${P.p === v ? "selected" : ""}>${l}</option>`).join("")}
        <optgroup label="Year">${years.map((y) => `<option value="y${y}" ${P.p === "y" + y ? "selected" : ""}>${y}</option>`).join("")}</optgroup></select>
      <span class="pcustom" ${P.p === "custom" ? "" : "hidden"}><label>From <input class="inp mini" type="datetime-local" id="pFrom" value="${esc(P.from)}"></label><label>To <input class="inp mini" type="datetime-local" id="pTo" value="${esc(P.to)}"></label></span>
      ${P.p !== "all" ? `<span class="pnow">${esc(periodLabel())}</span><button class="btn small" type="button" id="pClear">Clear</button>` : `<span class="pnow muted">Filters the add-to-cart feed, contacts, checkouts, orders and schedule</span>`}`;
    $("period").hidden = S.view === "team" || S.view === "pipeline";
    $("newLeadBtn").hidden = !canWrite();
  }
  function setPeriod(p) { Object.assign(S.period, p); S.rep = null; try { localStorage.setItem("pulse-crm-period", JSON.stringify(S.period)); } catch {} render(); }
  try { const sp = JSON.parse(localStorage.getItem("pulse-crm-period") || "null"); if (sp && sp.p) S.period = sp; } catch {}
  document.addEventListener("submit", (e) => { if (e.target.id === "leadForm") { e.preventDefault(); saveLead(); } });
  document.addEventListener("input", (e) => { if (["tlUrl", "tlCmp"].includes(e.target.id)) makeLink(); });
  document.addEventListener("change", (e) => {
    if (e.target.id === "repMetric") { S.repMetric = e.target.value; renderReports(); }
    if (e.target.id === "repGroup") { S.repGroup = e.target.value; renderReports(); }
    if (e.target.id === "tlSrc") makeLink();
    if (e.target.id === "pSel") setPeriod({ p: e.target.value });
    if (e.target.id === "pFrom") setPeriod({ from: e.target.value });
    if (e.target.id === "pTo") setPeriod({ to: e.target.value });
  });
  document.addEventListener("click", (e) => { if (e.target.id === "pClear") setPeriod({ p: "all", from: "", to: "" }); });

  /* ---------- Views ---------- */
  function renderKpis() {
    const C = S.contacts, ck = S.ck, od = S.raw.orders;
    const fresh = C.filter((p) => p.fresh).length;
    const logins7 = C.filter((p) => p.lastLogin && now() - t(p.lastLogin) < 7 * DAY).length;
    const fresh48 = ck.filter((k) => now() - t(k.created_at) < 2 * DAY).length;
    const conv = C.filter((p) => p.status === "converted").length;
    const notc = C.filter((p) => p.status === "notconverted");
    const lost = notc.reduce((s, p) => s + p.value, 0);
    const pend = od.filter((o) => !o.cancelled_at && (["PENDING", "AUTHORIZED", "PARTIALLY_PAID"].includes(o.financial) || o.fulfillment !== "FULFILLED")).length;
    const fu = allFollowups().filter((f) => !f.done);
    const dueToday = fu.filter((f) => t(f.due_at) < endOfToday()).length;
    const buyers = new Set(ck.map((k) => k.customer_id || k.id)).size;
    const rate = buyers ? Math.round((conv / buyers) * 100) : 0;
    const k = [
      ["Fresh sign-ups", fresh, "new accounts, last 7 days", "", "contacts:fresh"],
      ["Logged in this week", logins7, "customers seen logging in", "", "contacts:loggedin"],
      ["Fresh checkouts", fresh48, "started in the last 48 h", "", "checkouts"],
      ["Converted", conv, `${rate}% of people who checked out`, "k-good", "contacts:converted"],
      ["Not converted", notc.length, `${inr(lost)} left in checkout`, "k-bad", "contacts:notconverted"],
      ["Pending", pend, "orders to collect or ship", "k-warn", "orders"],
      ["Due today", dueToday, `${fu.length} follow-up${fu.length === 1 ? "" : "s"} open`, dueToday ? "k-warn" : "", "schedule"],
      ["Total contacts", C.length, `${S.raw.customers.length} accounts · ${C.filter((p) => p.leads?.length).length} leads · ${C.filter((p) => p.source === "guest").length} guests`, "", "contacts:all"],
    ];
    $("kpis").innerHTML = k.map(([l, v, s, cls, go]) => `<button type="button" class="kpi ${cls}" data-go="${go}"><span class="l">${l}</span><span class="v num">${v}</span><span class="s">${esc(s)}</span></button>`).join("");
  }

  /* ---------- Tiles: tall cards with stars by freshness, "View more" and CSV ---------- */
  // Stars by calendar day (India time): today 5, yesterday 4, day before 3, 3 days ago 2, older 1.
  const istDay = (d) => Math.floor((t(d) + 19800000) / DAY);
  function starsFor(d) { if (!d) return 1; const age = istDay(new Date()) - istDay(d); return Math.max(1, Math.min(5, 5 - age)); }
  const STAR_TIP = ["", "4+ days old", "3 days old", "2 days old", "Yesterday", "Today"];
  const starHtml = (n) => `<span class="stars s${n}" title="${STAR_TIP[n]}" aria-label="${n} of 5 stars">${"★".repeat(n)}<i>${"★".repeat(5 - n)}</i></span>`;
  const initials = (n) => (String(n || "?").trim().split(/\s+/).map((w) => w[0]).join("").slice(0, 2) || "?").toUpperCase();
  const TILE_STEP = 12;
  S.more = S.more || {}; S.tileData = S.tileData || {};
  // One card per person in a board column. it: { p (contact or null), name, chip, at, line, kv, note, link }
  function tiles(id, items, empty) {
    S.tileData[id] = items;
    const cnt = $(id + "N"); if (cnt) cnt.textContent = items.length;
    if (!items.length) return `<div class="empty">${empty}</div>`;
    const shown = S.more[id] || TILE_STEP;
    const cards = items.slice(0, shown).map((it) => {
      const p = it.p, st = starsFor(it.at), name = p ? p.name : it.name || "Guest";
      const own = p && p.owner ? memberName(p.owner) : "";
      const kv = (p ? [["Phone", p.phone], ["City", p.city], ["From", p.came]] : []).concat(it.kv || []).filter((r) => r[1]);
      return `<article class="tile"${p ? ` data-open="${p.key}"` : ""}>
        <div class="t-top"><span class="av">${esc(initials(name))}</span><div class="t-who"><b class="t-name">${esc(name)}</b>${starHtml(st)}</div></div>
        <div class="t-chips">${it.chip || (p ? chip(p) : "")}</div>
        <p class="t-line">${it.line}</p>
        ${kv.length ? `<dl class="t-kv">${kv.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join("")}</dl>` : ""}
        ${it.note ? `<p class="t-note">${esc(it.note)}</p>` : ""}
        <div class="t-owner${own ? " on" : ""}"><span>Owner</span><b>${own ? esc(own) : "Null"}</b></div>
        <div class="t-when">${fmtDT(it.at)} · ${ago(it.at)}</div>
        ${p ? `<div class="t-acts">${actions(p, !!it.link)}</div>` : ""}
      </article>`;
    }).join("");
    const more = items.length > shown ? `<button class="btn small t-more" type="button" data-more="${id}">View more (${items.length - shown})</button>` : items.length > TILE_STEP ? `<button class="btn small t-more" type="button" data-less="${id}">Show less</button>` : "";
    return cards + more;
  }
  function downloadCsv(id) {
    const items = S.tileData[id] || [];
    if (!items.length) return toast("Nothing to download");
    const rows = items.map((it) => { const p = it.p || {}; const r = { Stars: starsFor(it.at), Name: p.name || it.name || "Guest", Phone: p.phone || "", Email: p.email || "", City: p.city || "", Status: p.statusText || String(it.chip || "").replace(/<[^>]+>/g, ""), "Came from": p.came || "", Date: fmtDT(it.at), Details: String(it.line || "").replace(/<[^>]+>/g, "") };
      (it.kv || []).forEach(([k, v]) => { r[k] = v; }); if (it.note) r.Note = it.note; r.Owner = p.owner ? memberName(p.owner) : "Null"; return r; });
    const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
    const q = (v) => { v = v == null ? "" : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    const csv = "﻿" + [cols.join(","), ...rows.map((r) => cols.map((c) => q(r[c])).join(","))].join("\r\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = `pulse-${id === "box" ? S.tileName || "list" : id}-${new Date().toISOString().slice(0, 10)}.csv`; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000); toast("CSV downloaded");
  }
  function li(p, sub, link = false) { return `<div class="li"><div class="who" data-open="${p.key}" style="cursor:pointer"><b>${esc(p.name)} ${chip(p)}</b><small>${sub}</small></div>${actions(p, link)}</div>`; }
  function boxData() {
    const C = S.contacts, ck = S.ck;
    const L = S.raw.leads.slice().sort((a, b) => t(b.created_at) - t(a.created_at)).filter((x) => S.period.p === "all" ? now() - t(x.created_at) < 14 * DAY : inRange(x.created_at));
    const lastOrder = (p) => p.orders.find((o) => !o.cancelled_at)?.created_at;
    const byAt = (arr) => arr.sort((a, b) => t(b.at) - t(a.at));
    const ckP = new Map(); for (const k of ck) { if (now() - t(k.created_at) >= 2 * DAY) continue; const p = byKey(k.customer_id ? "c" + k.customer_id : "g" + k.id); if (p && !ckP.has(p.key)) ckP.set(p.key, { p, at: k.created_at, link: !k.completed_at, line: `<b>${esc(k.items || "Checkout")}</b> · ${inr(k.total)} · ${k.completed_at ? "Completed" : "Not paid yet"}` }); }
    const hot = C.filter((p) => (p.status === "notconverted" || p.status === "checkout") && now() - t(p.lastCheckout) < 14 * DAY);
    const fu = allFollowups().filter((f) => !f.done && t(f.due_at) < endOfToday());
    return [
      { id: "fresh", label: "Fresh sign-ups", sub: "new accounts, last 7 days", empty: "No new sign-ups this week.", items: byAt(C.filter((p) => p.fresh).map((p) => ({ p, at: p.createdAt, line: `Joined ${fmtDT(p.createdAt)}` }))) },
      { id: "loggedin", label: "Logged in this week", sub: "customers seen logging in", empty: "No logins this week.", items: byAt(C.filter((p) => p.lastLogin && now() - t(p.lastLogin) < 7 * DAY).map((p) => ({ p, at: p.lastLogin, line: `Logged in ${ago(p.lastLogin)} · ${p.logins.length} login${p.logins.length === 1 ? "" : "s"} in 120 days` }))) },
      { id: "freshck", label: "Fresh checkouts", sub: "started in the last 48 h", empty: "No checkouts in the last 48 hours.", items: byAt([...ckP.values()]) },
      { id: "converted", label: "Converted", sub: "people who paid", cls: "k-good", empty: "No paid orders yet.", items: byAt(C.filter((p) => p.status === "converted").map((p) => ({ p, at: lastOrder(p) || p.lastActive, line: `<b>${p.orders.length} order${p.orders.length === 1 ? "" : "s"}</b> · ${inr(p.value)} paid` }))) },
      { id: "notconverted", label: "Not converted", sub: `${inr(C.filter((p) => p.status === "notconverted").reduce((s, p) => s + p.value, 0))} left in checkout`, cls: "k-bad", empty: "Nobody has left a checkout unpaid.", items: byAt(C.filter((p) => p.status === "notconverted").map((p) => ({ p, at: p.lastCheckout, link: true, line: `<b>${esc(p.cart || "Checkout")}</b> · ${inr(p.value)}` }))) },
      { id: "pending", label: "Pending", sub: "payment pending or to ship", cls: "k-warn", empty: "Nothing pending.", items: byAt(C.filter((p) => p.status === "pending" || p.statusText === "Converted · to ship").map((p) => ({ p, at: lastOrder(p) || p.lastActive, line: `<b>${esc(p.statusText)}</b> · ${inr(p.value)}` }))) },
      { id: "due", label: "Due today", sub: "follow-ups due or overdue", cls: fu.length ? "k-warn" : "", empty: "No follow-ups due today.", items: fu.map((f) => { const p = byKey(f.key); return p && { p, at: f.due_at, line: `<b>${esc(f.kind)}</b>${t(f.due_at) < now() ? " · overdue" : ""}`, note: f.note || "", kv: [["Assigned", f.assignee_email ? memberName(f.assignee_email) : ""]] }; }).filter(Boolean) },
      { id: "total", label: "Total contacts", sub: `${S.raw.customers.length} accounts · ${C.filter((p) => p.leads?.length).length} leads`, empty: "No contacts yet.", items: byAt(C.map((p) => ({ p, at: p.lastActive || p.createdAt, line: `<b>${esc(p.statusText)}</b>${p.value ? " · " + inr(p.value) : ""}` }))) },
      { id: "leads", label: "New leads & enquiries", sub: S.period.p === "all" ? "last 14 days" : periodLabel(), empty: "Leads you add and website forms (rent, donate, demo, contact) appear here.", items: L.map((x) => { const p = S.contacts.find((c) => c.leads?.some((y) => y.key === x.key)); return p && { p, at: x.created_at, line: `<b>${esc(x.kind)}</b> · ${esc(x.source || "")}`, kv: [["Wants", x.interest || ""]], note: x.note || "" }; }).filter(Boolean) },
      { id: "browse", label: "Browsing now", sub: "on the store, last 30 min", empty: "Nobody is on the store right now.", items: browseItems() },
      { id: "carts", label: "Live add to cart", sub: S.period.p === "all" ? "last 48 h" : periodLabel(), empty: "Add-to-cart activity appears here the moment someone adds a wheelchair.", items: cartItems() },
      { id: "hot", label: "Hot leads", sub: "unpaid checkouts, 14 days", cls: "k-bad", empty: "No unconverted checkouts in the last 14 days.", items: byAt(hot.map((p) => ({ p, at: p.lastCheckout, link: true, line: `<b>${esc(p.cart || "Checkout")}</b> · ${inr(p.value)}` }))) },
    ];
  }
  // Box filters: owner, date range (with time), weekday, month.
  S.bf = (() => { try { return JSON.parse(localStorage.getItem("pulse-bf") || "{}"); } catch { return {}; } })();
  try { S.box = localStorage.getItem("pulse-box") || "fresh"; } catch { S.box = "fresh"; }
  function boxFilter(items) {
    const f = S.bf, from = f.from ? t(f.from) : 0, to = f.to ? t(f.to) : 0;
    return items.filter((it) => {
      const p = it.p;
      if (f.owner === "_none" && p && p.owner) return false;
      if (f.owner && f.owner !== "_none" && (!p || p.owner !== f.owner)) return false;
      if (!it.at && (from || to || f.day || f.month)) return false;
      const ts = t(it.at), d = new Date(ts + 19800000);
      if (from && ts < from) return false;
      if (to && ts > to) return false;
      if (f.day !== undefined && f.day !== "" && d.getUTCDay() !== +f.day) return false;
      if (f.month !== undefined && f.month !== "" && d.getUTCMonth() !== +f.month) return false;
      return true;
    });
  }
  function renderBoxFilters() {
    const o = $("bfOwner"); if (!o) return;
    const opts = `<option value="">Everyone</option><option value="_none">Null (no owner)</option>` + S.raw.team.filter((m) => m.active).map((m) => `<option value="${esc(m.email)}">${esc(m.name || m.email)}</option>`).join("");
    if (o.dataset.opts !== opts) { o.innerHTML = opts; o.dataset.opts = opts; }
    o.value = S.bf.owner || ""; $("bfFrom").value = S.bf.from || ""; $("bfTo").value = S.bf.to || ""; $("bfDay").value = S.bf.day ?? ""; $("bfMonth").value = S.bf.month ?? "";
    const on = Object.values(S.bf).some((v) => v !== "" && v != null);
    $("bfClear").hidden = !on;
  }
  function renderOverview() {
    const boxes = boxData();
    if (!boxes.some((b) => b.id === S.box)) S.box = boxes[0].id;
    $("kpis").innerHTML = boxes.map((b) => `<button type="button" class="kpi ${b.cls || ""}${b.id === S.box ? " on" : ""}" data-box="${b.id}" aria-pressed="${b.id === S.box}"><span class="l">${esc(b.label)}</span><span class="v num">${b.items.length}</span><span class="s">${esc(b.sub)}</span></button>`).join("");
    const cur = boxes.find((b) => b.id === S.box);
    renderBoxFilters();
    const items = boxFilter(cur.items);
    $("bxTitle").textContent = cur.label;
    $("bxSub").textContent = items.length === cur.items.length ? cur.sub : `${items.length} of ${cur.items.length} match your filters · ${cur.sub}`;
    $("bxList").innerHTML = tiles("box", items, items.length || !cur.items.length ? cur.empty : "Nobody matches these filters.");
    S.tileName = cur.id;
    const C = S.contacts;
    const steps = [["Contacts", C.length], ["Signed up", C.filter((p) => p.source === "customer").length], ["Started checkout", C.filter((p) => p.checkouts.length).length], ["Converted", C.filter((p) => p.status === "converted").length]];
    const max = Math.max(1, steps[0][1]);
    $("funnel").innerHTML = steps.map(([l, n]) => `<div class="frow"><span class="lab">${l}</span><span class="bar"><i style="width:${Math.max(1, (n / max) * 100)}%"></i></span><span class="n num">${n}</span></div>`).join("");
    const due = allFollowups().filter((f) => !f.done && t(f.due_at) < endOfToday() + 2 * DAY).slice(0, 6);
    $("dueList").innerHTML = due.length ? due.map(fuRow).join("") : `<div class="empty">Nothing due in the next 2 days.</div>`;
    const logins = C.filter((p) => p.lastLogin).sort((a, b) => t(b.lastLogin) - t(a.lastLogin));
    $("loginList").innerHTML = logins.length ? logins.slice(0, 8).map((p) => li(p, `Logged in ${ago(p.lastLogin)} · ${p.logins.length} login${p.logins.length === 1 ? "" : "s"} in 120 days`)).join("") : `<div class="empty">Logins appear here once the store's login tracking is live.</div>`;
  }

  function cartWho(ev) {
    const c = evCust(ev), p = c ? byKey("c" + c) : null;
    if (p) return { p, name: p.name, tag: (p.fresh ? "New customer" : "Returning customer") + (!ev.customer_id ? " · before login" : "") };
    const m = ev.meta || {};
    const id = ev.customer_id ? "Customer " + ev.customer_id.slice(-4) : "Guest " + String(ev.visitor || "").slice(-4).toUpperCase();
    return { p: null, name: m.nm || m.em || m.ph || id, tag: ev.customer_id ? "New customer" : "Guest · not logged in" };
  }
  function cartLine(ev) {
    const m = ev.meta || {}, w = cartWho(ev);
    const what = ev.kind === "checkout"
      ? `${ev.added ? "Added to cart → " : ""}Started checkout${m.n ? " · " + m.n + " item" + (m.n === 1 ? "" : "s") : ""}${m.t ? " · " + esc(m.t) : ""}${m.tot ? " · " + inr(m.tot) : ""}`
      : `Added ${esc(m.t || "a product")}${m.vt && m.vt !== "Default Title" ? " (" + esc(m.vt) + ")" : ""}${m.q > 1 ? " ×" + m.q : ""}${m.a ? " · " + inr(m.a * (m.q || 1)) : ""}`;
    const contact = !w.p && (m.ph || m.em) ? ` · ${esc(m.ph || m.em)}` : "";
    const head = `<b>${esc(w.name)} <span class="chip ${w.tag.startsWith("Guest") ? "c-signup" : w.tag.startsWith("New") ? "c-checkout" : "c-converted"}">${esc(w.tag)}</span></b>`;
    const sub = `<small>${what}${contact} · ${ago(ev.created_at)} · ${esc(ev.device || "")}</small>`;
    return w.p ? `<div class="li"><div class="who" data-open="${w.p.key}" style="cursor:pointer">${head}${sub}</div>${actions(w.p, ev.kind === "checkout")}</div>` : `<div class="li"><div class="who">${head}${sub}</div></div>`;
  }
  /* One row per action: an add-to-cart that went straight to checkout (e.g. "Buy it now") is shown once, on the checkout row. */
  function cartFeed() {
    const all = S.raw.events.filter((e) => (e.kind === "cart" || e.kind === "checkout") && (S.period.p === "all" ? now() - t(e.created_at) < 2 * DAY : inRange(e.created_at)));
    const hide = new Set();
    for (const ck of all) {
      if (ck.kind !== "checkout") continue;
      const title = (ck.meta && ck.meta.t) || "";
      for (const c of all) {
        if (c.kind !== "cart" || hide.has(c.id) || evPerson(c) !== evPerson(ck)) continue;
        const dt = t(ck.created_at) - t(c.created_at);
        if (dt >= -5e3 && dt < 30 * 60e3 && (!c.meta?.t || title.includes(c.meta.t))) { hide.add(c.id); ck.added = true; }
      }
    }
    return all.filter((e) => !hide.has(e.id));
  }
  function pageName(path, meta) {
    path = String(path || "/").split("?")[0];
    const pt = meta && meta.t ? String(meta.t).split(/\s[–|-]\s/)[0].trim() : "";
    if (pt && /\/(products|collections|pages)\//.test(path)) return (path.includes("/products/") ? "product · " : path.includes("/collections/") ? "category · " : "page · ") + pt;
    const title = (x) => decodeURIComponent(x).replace(/[-_]+/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
    let m;
    if (path === "/" || path === "") return "Home page";
    if ((m = path.match(/\/products\/([^/]+)/))) return "product · " + title(m[1]);
    if ((m = path.match(/\/collections\/([^/]+)/))) return "category · " + title(m[1]);
    if ((m = path.match(/\/pages\/([^/]+)/))) return "page · " + title(m[1]);
    if (path.startsWith("/cart")) return "Cart";
    if (path.startsWith("/checkouts")) return "Payment page";
    if (path.startsWith("/account")) return "My account";
    if (path.startsWith("/search")) return "Search";
    return title(path.replace(/^\//, ""));
  }
  function browseItems() {
    const since = now() - 30 * 60e3, byP = new Map();
    for (const e of S.raw.events) {
      if (t(e.created_at) < since) continue; const c = evPerson(e);
      const cur = byP.get(c) || { c, last: e, pages: new Set(), n: 0 };
      if (t(e.created_at) > t(cur.last.created_at)) cur.last = e;
      if (e.path) cur.pages.add(e.path); cur.n++; byP.set(c, cur);
    }
    const rows = [...byP.values()].sort((a, b) => (a.c.startsWith("v:") - b.c.startsWith("v:")) || t(b.last.created_at) - t(a.last.created_at));
    const named = rows.filter((r) => !r.c.startsWith("v:")).length;
    return rows.map((r) => {
      const p = r.c.startsWith("v:") ? null : byKey("c" + r.c);
      const what = r.last.kind === "view" ? "Looking at <b>" + esc(r.last.meta?.t || "a product") + "</b>" : r.last.kind === "search" ? `Searched “${esc(r.last.meta?.t || "")}”` : r.last.kind === "cart" ? "Added to cart · <b>" + esc(r.last.meta?.t || "") + "</b>" : r.last.kind === "checkout" ? "<b>On the payment page</b>" : r.last.kind === "login" ? "Just logged in" : "Viewing " + esc(pageName(r.last.path, r.last.meta));
      return { p, name: p ? "" : "Guest " + r.c.slice(-4).toUpperCase(), chip: p ? "" : '<span class="chip c-signup">Guest · not logged in</span>', at: r.last.created_at, line: `<span style="color:var(--good)">● </span>${what}`, kv: [["Pages", String(r.pages.size)], ["Device", r.last.device || ""]] };
    });
  }
  function cartItems() {
    const evs = cartFeed();
    const people = new Set(evs.map(evPerson)).size, nCart = evs.filter((e) => e.kind === "cart" || e.added).length, nCk = evs.filter((e) => e.kind === "checkout").length;
    return evs.slice(0, 300).map((ev) => {
      const m = ev.meta || {}, w = cartWho(ev);
      const what = ev.kind === "checkout" ? `<b>Started checkout</b>${m.t ? " · " + esc(m.t) : ""}${m.tot ? " · " + inr(m.tot) : ""}` : `Added <b>${esc(m.t || "a product")}</b>${m.q > 1 ? " ×" + m.q : ""}${m.a ? " · " + inr(m.a * (m.q || 1)) : ""}`;
      const cls = w.tag.startsWith("Guest") ? "c-signup" : w.tag.startsWith("New") ? "c-checkout" : "c-converted";
      return { p: w.p, name: w.name, chip: `<span class="chip ${cls}">${esc(w.tag)}</span>`, at: ev.created_at, line: what, link: ev.kind === "checkout", kv: w.p ? [] : [["Contact", m.ph || m.em || ""], ["Device", ev.device || ""]] };
    });
  }

  const C_FILTERS = [["all", "All"], ["leads", "Leads"], ["fresh", "Fresh sign-ups"], ["loggedin", "Logged in (7 d)"], ["checkout", "In checkout"], ["notconverted", "Not converted"], ["pending", "Pending"], ["converted", "Converted"], ["signup", "Signed up only"], ["mine", "Mine"], ["followup", "Has follow-up"]];
  function filterContacts(f, q) {
    q = q.trim().toLowerCase();
    return S.contacts.filter((p) => {
      if (S.period.p !== "all" && ![p.createdAt, p.lastCheckout, p.lastLogin, p.carts?.[0]?.created_at, p.orders[0]?.created_at].some((d) => d && inRange(d))) return false;
      if (f === "fresh" && !p.fresh) return false;
      if (f === "leads" && !p.leads?.length) return false;
      if (f === "loggedin" && !(p.lastLogin && now() - t(p.lastLogin) < 7 * DAY)) return false;
      if (f === "followup" && !p.nextFU) return false;
      if (f === "mine" && p.owner !== S.me.email.toLowerCase()) return false;
      if (["checkout", "notconverted", "pending", "converted", "signup"].includes(f) && p.status !== f) return false;
      if (q && ![p.name, p.email, p.phone, p.city, p.cart, p.came].join(" ").toLowerCase().includes(q)) return false;
      return true;
    });
  }
  // Contacts: search + chips + owner/stage filter, sort, table or tiles, View more, CSV.
  S.cv = (() => { try { return JSON.parse(localStorage.getItem("pulse-cv") || "{}"); } catch { return {}; } })();
  const saveCv = () => { try { localStorage.setItem("pulse-cv", JSON.stringify(S.cv)); } catch {} };
  const C_SORTS = [["active", "Last active"], ["stars", "Freshest (stars)"], ["signup", "Newest sign-up"], ["checkout", "Latest checkout"], ["value", "Value: high to low"], ["name", "Name A–Z"], ["fu", "Next follow-up"]];
  function contactRows() {
    const cv = S.cv;
    let rows = filterContacts(S.cFilter, S.search);
    if (cv.owner === "_none") rows = rows.filter((p) => !p.owner); else if (cv.owner) rows = rows.filter((p) => p.owner === cv.owner);
    if (cv.stage) rows = rows.filter((p) => p.stage === cv.stage);
    const k = cv.sort || "active", T = (d) => (d ? t(d) : 0);
    const cmp = { active: (a, b) => T(b.lastActive) - T(a.lastActive), stars: (a, b) => starsFor(b.lastActive || b.createdAt) - starsFor(a.lastActive || a.createdAt) || T(b.lastActive) - T(a.lastActive), signup: (a, b) => T(b.createdAt) - T(a.createdAt), checkout: (a, b) => T(b.lastCheckout) - T(a.lastCheckout), value: (a, b) => (b.value || 0) - (a.value || 0), name: (a, b) => String(a.name).localeCompare(String(b.name)), fu: (a, b) => (a.nextFU ? T(a.nextFU.due_at) : 9e15) - (b.nextFU ? T(b.nextFU.due_at) : 9e15) }[k];
    return rows.slice().sort(cmp);
  }
  function renderContacts() {
    const cv = S.cv;
    $("cFilters").querySelectorAll(".fchip").forEach((b) => b.remove());
    $("cChips").innerHTML = C_FILTERS.map(([v, l]) => `<button class="fchip" type="button" data-cf="${v}" aria-pressed="${S.cFilter === v}">${l} <span class="num">${filterContacts(v, "").length}</span></button>`).join("");
    const o = $("cOwner"), opts = `<option value="">Owner: everyone</option><option value="_none">Owner: Null</option>` + S.raw.team.filter((m) => m.active).map((m) => `<option value="${esc(m.email)}">Owner: ${esc(m.name || m.email)}</option>`).join("");
    if (o.dataset.opts !== opts) { o.innerHTML = opts; o.dataset.opts = opts; }
    o.value = cv.owner || "";
    const st = $("cStage"); if (!st.options.length) st.innerHTML = `<option value="">Stage: all</option>` + STAGES.map(([id, l]) => `<option value="${id}">Stage: ${l}</option>`).join("");
    st.value = cv.stage || "";
    const so = $("cSort"); if (!so.options.length) so.innerHTML = C_SORTS.map(([v, l]) => `<option value="${v}">Sort: ${l}</option>`).join("");
    so.value = cv.sort || "active";
    const tilesView = cv.view === "tiles";
    document.querySelectorAll("[data-cview]").forEach((b) => b.setAttribute("aria-pressed", String((b.dataset.cview === "tiles") === tilesView)));
    const rows = contactRows();
    const total = filterContacts(S.cFilter, S.search).length;
    $("cCount").textContent = rows.length === total ? `${rows.length} contact${rows.length === 1 ? "" : "s"}` : `${rows.length} of ${total} contacts`;
    const items = rows.map((p) => ({ p, at: p.lastActive || p.createdAt, line: `<b>${esc(p.statusText)}</b> · ${esc(STAGE_NAME[p.stage])}${p.value ? " · " + inr(p.value) : ""}`, kv: [["Wants", p.cart || ""], ["Next follow-up", p.nextFU ? `${p.nextFU.kind} · ${fmtDT(p.nextFU.due_at)}` : ""]] }));
    $("cTiles").hidden = !tilesView; $("cTable").hidden = tilesView;
    if (tilesView) { $("cTiles").innerHTML = tiles("contacts", items, "No contacts match."); return; }
    S.tileData.contacts = items;
    const shown = S.more.ctable || 50;
    $("cBody").innerHTML = rows.length ? rows.slice(0, shown).map((p) => { const own = p.owner ? memberName(p.owner) : ""; const fuOver = p.nextFU && t(p.nextFU.due_at) < now();
      return `<tr data-open="${p.key}">
      <td><div class="c-who"><span class="av">${esc(initials(p.name))}</span><div><b>${esc(p.name)}</b> ${starHtml(starsFor(p.lastActive || p.createdAt))}<span class="sub">${esc(p.phone || p.email || "No contact details")}${p.city ? " · " + esc(p.city) : ""}${p.came ? " · from " + esc(p.came) : ""}</span></div></div></td>
      <td>${chip(p)}${p.fresh ? ' <span class="chip c-checkout c-new"></span>' : ""}</td>
      <td><span class="stage st-${p.stage}">${STAGE_NAME[p.stage]}</span></td>
      <td class="d">${p.source === "customer" ? fmtDate(p.createdAt) : p.source === "lead" ? `<span class="sub">Lead · ${fmtDate(p.createdAt)}</span>` : '<span class="sub">Guest</span>'}</td>
      <td class="d">${p.lastLogin ? ago(p.lastLogin) : '<span class="sub">—</span>'}</td>
      <td class="d">${p.lastCheckout ? ago(p.lastCheckout) : '<span class="sub">—</span>'}</td>
      <td class="d num">${p.value ? inr(p.value) : '<span class="sub">—</span>'}</td>
      <td class="d"><span class="own${own ? " on" : ""}">${own ? esc(own) : "Null"}</span></td>
      <td class="d">${p.nextFU ? `<span class="${fuOver ? "chip c-notconverted" : "fu-next"}">${fuOver ? "Overdue · " : ""}${esc(p.nextFU.kind)} · ${fmtDT(p.nextFU.due_at)}</span>` : '<span class="sub">—</span>'}</td></tr>`; }).join("") : `<tr><td colspan="9" class="empty">No contacts match.</td></tr>`;
    $("cMore").innerHTML = rows.length > shown ? `<button class="btn small" type="button" data-cmore>View more (${rows.length - shown})</button>` : "";
  }
  function renderPipeline() {
    $("board").innerHTML = STAGES.map(([id, label]) => {
      const items = S.contacts.filter((p) => p.stage === id);
      return `<div class="col"><h3><span>${label}</span><span class="num">${items.length}</span></h3>${items.slice(0, 100).map((p) => `
        <button class="card" type="button" data-open="${p.key}"><b>${esc(p.name)}</b>${chip(p)}<small>${esc(p.cart || p.phone || p.email || "")}</small>${p.value ? `<small class="num">${inr(p.value)}</small>` : ""}${p.owner ? `<small>Owner: ${esc(memberName(p.owner))}</small>` : ""}</button>`).join("") || '<small class="muted" style="padding:4px">Empty</small>'}</div>`;
    }).join("");
  }
  const K_FILTERS = [["all", "All"], ["fresh", "Last 48 h"], ["open", "Not converted"], ["done", "Completed"]];
  function renderCheckouts() {
    $("kFilters").innerHTML = K_FILTERS.map(([v, l]) => `<button class="fchip" type="button" data-kf="${v}" aria-pressed="${S.kFilter === v}">${l}</button>`).join("");
    const rows = S.ck.filter((k) => inRange(k.created_at)).filter((k) => S.kFilter === "all" || (S.kFilter === "fresh" && now() - t(k.created_at) < 2 * DAY) || (S.kFilter === "open" && !k.completed_at) || (S.kFilter === "done" && k.completed_at));
    $("kBody").innerHTML = rows.length ? rows.slice(0, 500).map((k) => {
      const key = k.customer_id ? "c" + k.customer_id : "g" + k.id, p = byKey(key);
      const res = k.completed_at ? '<span class="chip c-converted">Completed</span>' : k.live ? '<span class="chip c-checkout">On checkout page · live</span>' : (now() - t(k.created_at) < DAY ? '<span class="chip c-checkout">In progress</span>' : '<span class="chip c-notconverted">Abandoned</span>');
      return `<tr data-open="${key}"><td class="d">${fmtDT(k.created_at)}<span class="sub">${ago(k.created_at)}</span></td>
        <td><b>${esc(p?.name || k.name || "Guest")}</b><span class="sub">${esc(p?.phone || k.phone || p?.email || "")}</span></td>
        <td>${esc(k.items)}</td><td class="d num">${inr(k.total)}</td><td>${res}</td>
        <td>${!k.completed_at && k.recover_url ? `<button class="btn small" type="button" data-copy="${esc(k.recover_url)}" data-label="Checkout link">Copy link</button>` : ""}</td></tr>`;
    }).join("") : `<tr><td colspan="6" class="empty">No checkouts here.</td></tr>`;
  }
  function renderOrders() {
    const od = S.raw.orders.filter((o) => inRange(o.created_at));
    $("oBody").innerHTML = od.length ? od.slice(0, 500).map((o) => {
      const key = o.customer_id ? "c" + o.customer_id : "o" + o.id;
      const [pc, pl] = PAY[o.financial] || ["c-signup", o.financial || "—"];
      const del = o.cancelled_at ? '<span class="chip c-notconverted">Cancelled</span>' : (o.fulfillment === "FULFILLED" ? '<span class="chip c-converted">Shipped</span>' : '<span class="chip c-pending">To ship</span>');
      return `<tr data-open="${key}"><td><b>${esc(o.name)}</b></td><td class="d">${fmtDT(o.created_at)}</td><td>${esc(o.customer_name || o.email || "Guest")}</td>
        <td>${esc(o.items)}</td><td class="d num">${inr(o.total)}</td><td><span class="chip ${pc}">${esc(pl)}</span></td><td>${del}</td></tr>`;
    }).join("") : `<tr><td colspan="7" class="empty">No orders yet. They'll appear here as soon as the first customer pays.</td></tr>`;
  }
  function fuRow(f) {
    const over = !f.done && t(f.due_at) < now();
    const p = byKey(f.key);
    return `<div class="fu ${over ? "over" : ""} ${f.done ? "done" : ""}">
      <input type="checkbox" aria-label="Mark done" data-fu-done="${f.id}" ${f.done ? "checked" : ""} ${canWrite() ? "" : "disabled"}>
      <div style="min-width:0" data-open="${f.key}"><b style="cursor:pointer">${esc(f.kind)} · ${esc(p?.name || "Contact")}</b><small class="muted" style="display:block;overflow-wrap:anywhere">${esc(f.note || "")}${f.assignee_email ? " · " + esc(memberName(f.assignee_email)) : ""}</small></div>
      <span class="when">${over ? "Overdue · " : ""}${fmtDT(f.due_at)}</span></div>`;
  }
  const S_FILTERS = [["upcoming", "Open"], ["mine", "Mine"], ["overdue", "Overdue"], ["today", "Today"], ["done", "Done"]];
  function teamOptions(sel) { return `<option value="">Nobody</option>` + S.raw.team.filter((m) => m.active && m.role !== "viewer").map((m) => `<option value="${esc(m.email)}" ${m.email === sel ? "selected" : ""}>${esc(m.name || m.email)}</option>`).join(""); }
  function renderSchedule() {
    $("sFilters").innerHTML = S_FILTERS.map(([v, l]) => `<button class="fchip" type="button" data-sf="${v}" aria-pressed="${S.sFilter === v}">${l}</button>`).join("");
    const sod = new Date(); sod.setHours(0, 0, 0, 0);
    const me = S.me.email.toLowerCase();
    const rows = allFollowups().filter((f) => inRange(f.due_at)).filter((f) => S.sFilter === "done" ? f.done : !f.done && (S.sFilter === "upcoming" || (S.sFilter === "mine" && f.assignee_email === me) || (S.sFilter === "overdue" && t(f.due_at) < now()) || (S.sFilter === "today" && t(f.due_at) >= sod.getTime() && t(f.due_at) <= endOfToday())));
    $("sList").innerHTML = rows.length ? rows.map(fuRow).join("") : `<div class="empty">Nothing here.${canWrite() ? " Plan a follow-up with the form." : ""}</div>`;
    const sel = $("sWho"), cur = sel.value;
    sel.innerHTML = S.contacts.map((p) => `<option value="${p.key}">${esc(p.name)}${p.phone ? " · " + esc(p.phone) : ""}</option>`).join("");
    if (cur) sel.value = cur;
    const as = $("sAssignee"), ca = as.value || me; as.innerHTML = teamOptions(ca);
    if (!$("sDate").value) $("sDate").value = new Date(now() + DAY).toISOString().slice(0, 10);
  }
  function renderTeam() {
    $("tBody").innerHTML = S.raw.team.map((m) => `<tr>
      <td><b>${esc(m.name || m.email.split("@")[0])}</b><span class="sub">${esc(m.email)}</span></td>
      <td><select class="inp mini" data-role="${esc(m.email)}" ${m.email === S.me.email.toLowerCase() ? "disabled" : ""}>${["admin", "sales", "viewer"].map((r) => `<option value="${r}" ${m.role === r ? "selected" : ""}>${r[0].toUpperCase() + r.slice(1)}</option>`).join("")}</select></td>
      <td>${m.active ? '<span class="chip c-converted">Active</span>' : '<span class="chip c-signup">Removed</span>'}</td>
      <td><div class="acts">${m.email === S.me.email.toLowerCase() ? '<span class="muted">You</span>' : `<button class="btn small" type="button" data-reset="${esc(m.email)}">New password</button>${m.active ? `<button class="btn small" type="button" data-remove="${esc(m.email)}">Remove</button>` : `<button class="btn small" type="button" data-restore="${esc(m.email)}">Restore</button>`}`}</div></td></tr>`).join("");
    $("syncList").innerHTML = S.raw.sync.length ? S.raw.sync.slice(0, 8).map((l) => `<div class="li"><div class="who"><b>${l.ok ? "Synced" : l.finished_at ? "Failed" : "Running"} · ${fmtDT(l.started_at)}</b><small>${l.counts ? `${l.counts.customers} customers, ${l.counts.checkouts} checkouts, ${l.counts.orders} orders${l.counts.full ? " (full)" : ""}` : esc(l.message || "")} · ${esc(l.trigger || "")}</small></div></div>`).join("") : `<div class="empty">No syncs yet.</div>`;
  }
  function renderCounts() {
    $("ctContacts").textContent = S.contacts.length;
    $("ctCheckouts").textContent = S.ck.filter((k) => !k.completed_at).length;
    $("ctOrders").textContent = S.raw.orders.length;
    $("ctSchedule").textContent = S.raw.followups.filter((f) => !f.done).length;
  }
  function render() {
    if (!S.loaded) return;
    renderCounts();
    renderPeriod();
    ({ overview: renderOverview, contacts: renderContacts, pipeline: renderPipeline, checkouts: renderCheckouts, orders: renderOrders, schedule: renderSchedule, team: renderTeam, reports: renderReports })[S.view]?.();
    // The open contact panel is not redrawn by background syncs (that would wipe what someone is typing).
    // It redraws only right after the user's own save in it; otherwise the Refresh button lights up.
    if (S.open) {
      if (S.drawerSelf && Date.now() - S.drawerSelf < 8000) { S.drawerSelf = 0; renderDrawer(); }
      else { const b = $("dRefresh"); if (b && !b.classList.contains("stale")) { b.classList.add("stale"); b.textContent = "Refresh · new data"; } }
    }
  }
  function setView(v) {
    if (v === "team" && !isAdmin()) v = "overview";
    S.view = v;
    document.querySelectorAll(".tab").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.v === v)));
    document.querySelectorAll("[data-view]").forEach((s) => (s.hidden = s.dataset.view !== v));
    try { localStorage.setItem("pulse-crm-view", v); } catch {}
    render();
  }

  /* ---------- Contact drawer ---------- */
  function renderDrawer() {
    const p = byKey(S.open);
    if (!p) { closeDrawer(); return; }
    const ev = [];
    if (p.source === "customer") ev.push({ at: p.createdAt, cls: "", title: "Created account", sub: (p.tags || []).filter((x) => /login|shop/i.test(x)).join(", ") });
    for (const l of p.logins.slice(0, 15)) ev.push({ at: l.created_at, cls: "e-login", title: "Logged in on the store", sub: l.device || "" });
    for (const v of p.visits.slice(0, 40)) ev.push({ at: v.created_at, cls: "", title: "Viewed " + pageName(v.path, v.meta), sub: (!v.customer_id ? "before login · " : "") + (v.device || "") });
    for (const L of p.leads || []) ev.push({ at: L.created_at, cls: "e-note", title: `${L.origin === "form" ? "Filled the " + L.kind.toLowerCase() + " form on the website" : "Lead added by " + memberName(L.created_by || "")} · ${L.source}`, text: L.note || "" });
    for (const c of (p.carts || []).filter((x) => ["view", "search", "form"].includes(x.kind)).slice(0, 40)) ev.push({ at: c.created_at, cls: "", title: c.kind === "view" ? "Looked at " + (c.meta?.t || "a product") + (c.meta?.a ? " · " + inr(c.meta.a) : "") : c.kind === "search" ? `Searched “${c.meta?.t || ""}”` : "Submitted a form · " + (c.meta?.t || ""), sub: (!c.customer_id ? "before login · " : "") + (c.device || "") });
    for (const c of (p.carts || []).filter((x) => x.kind === "cart" || x.kind === "checkout").slice(0, 30)) ev.push({ at: c.created_at, cls: "e-ab", title: c.kind === "cart" ? `Added to cart · ${c.meta?.t || "a product"}${c.meta?.a ? " · " + inr(c.meta.a * (c.meta.q || 1)) : ""}` : `Reached payment page · ${c.meta?.t || ""}${c.meta?.tot ? " · " + inr(c.meta.tot) : ""}`, sub: (!c.customer_id ? "before login · " : "") + (c.device || "") });
    for (const k of p.checkouts) ev.push({ at: k.created_at, cls: k.completed_at ? "e-order" : "e-ab", title: (k.completed_at ? "Checkout completed" : "Checkout not completed") + " · " + inr(k.total), sub: k.items });
    for (const o of p.orders) ev.push({ at: o.created_at, cls: "e-order", title: `Order ${o.name} · ${inr(o.total)}`, sub: `${(PAY[o.financial] || [0, o.financial])[1]}${o.cancelled_at ? " · Cancelled" : ""}` });
    for (const n of p.notes) ev.push({ at: n.created_at, cls: "e-note", title: "Note by " + memberName(n.author_email), text: n.body });
    ev.sort((a, b) => t(b.at) - t(a.at));
    const ro = !canWrite();
    const tomorrow = new Date(now() + DAY).toISOString().slice(0, 10);
    const paid = p.orders.filter((o) => !o.cancelled_at && o.financial === "PAID").reduce((s, o) => s + Number(o.total), 0);
    const openFu = p.followups.filter((f) => !f.done), doneFu = p.followups.filter((f) => f.done);
    const tab = S.dTab || "details";
    const dayKey = (d) => new Date(t(d) + 19800000).toISOString().slice(0, 10);
    const dayLbl = (d) => { const k = dayKey(d), td = dayKey(new Date()), yd = dayKey(new Date(now() - DAY)); return k === td ? "Today" : k === yd ? "Yesterday" : new Date(d).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" }); };
    let lastDay = "", tlHtml = "";
    ev.forEach((e, i) => { const dk = dayKey(e.at); if (dk !== lastDay) { tlHtml += `<div class="tl-day${i >= 30 ? " tl-x" : ""}">${dayLbl(e.at)}</div>`; lastDay = dk; }
      tlHtml += `<div class="ev ${e.cls}${i >= 30 ? " tl-x" : ""}"><b>${esc(e.title)}</b><small>${new Date(e.at).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}${e.sub ? " · " + esc(e.sub) : ""}</small>${e.text ? `<p>${esc(e.text)}</p>` : ""}</div>`; });
    const row = (k, v) => `<dt>${k}</dt><dd>${v}</dd>`;
    const own = p.owner ? memberName(p.owner) : "";
    const tabBtn = (id, label, n) => `<button type="button" class="dtab${tab === id ? " on" : ""}" data-dtab="${id}">${label}${n != null ? ` <span>${n}</span>` : ""}</button>`;
    $("drawerRoot").innerHTML = `<div class="scrim" data-close></div>
    <aside class="drawer" role="dialog" aria-modal="true" aria-label="${esc(p.name)}">
      <div class="dh">
        <div class="row">
          <span class="av av-lg">${esc(initials(p.name))}</span>
          <div class="dh-who"><h2>${esc(p.name)}</h2>${starHtml(starsFor(p.lastActive || p.createdAt))}</div>
          <div class="acts"><button class="btn small" type="button" id="dRefresh" data-drefresh title="Load the latest activity for this contact">Refresh</button><button class="btn small" type="button" data-close>Close</button></div>
        </div>
        <div class="dh-chips">${chip(p)}${p.fresh ? '<span class="chip c-checkout">Fresh sign-up</span>' : ""}${p.lastLogin && now() - t(p.lastLogin) < DAY ? '<span class="chip c-checkout">Logged in today</span>' : ""}<span class="t-owner${own ? " on" : ""} dh-own"><span>Owner</span><b>${own ? esc(own) : "Null"}</b></span></div>
        <div class="dstats">
          <div><span>Value</span><b class="num">${inr(paid || p.value)}</b><small>${paid ? "paid" : p.value ? "in checkout" : "—"}</small></div>
          <div><span>Last seen</span><b>${p.lastSeen ? ago(p.lastSeen) : "—"}</b><small>${p.lastLogin ? "login " + ago(p.lastLogin) : "no login yet"}</small></div>
          <div><span>Checkouts</span><b class="num">${p.checkouts.length}</b><small>${p.lastCheckout ? ago(p.lastCheckout) : "none"}</small></div>
          <div><span>Orders</span><b class="num">${p.orders.length}</b><small>${openFu.length} follow-up${openFu.length === 1 ? "" : "s"} open</small></div>
        </div>
        ${actions(p)}
        <div class="dso">
          <label>Stage<select class="inp" id="dStage" ${ro ? "disabled" : ""}>${STAGES.map(([id, l]) => `<option value="${id}" ${p.stage === id ? "selected" : ""}>${l}</option>`).join("")}</select></label>
          <label>Owner<select class="inp" id="dOwner" ${ro ? "disabled" : ""}>${teamOptions(p.owner).replace(">Nobody<", ">Null (no owner)<")}</select></label>
          ${p.leads?.length && canWrite() ? `<div class="acts dso-acts"><button class="btn small" type="button" data-edit-lead="${esc(p.leads[0].key)}">Edit lead</button>${isAdmin() && p.source === "lead" ? `<button class="btn small" type="button" data-del-lead="${esc(p.leads[0].key)}">Delete lead</button>` : ""}</div>` : ""}
        </div>
        <div class="dtabs">${tabBtn("details", "Details")}${tabBtn("fu", "Follow-ups", openFu.length)}${tabBtn("tl", "Timeline", ev.length)}${ro ? "" : tabBtn("note", "Add note")}</div>
      </div>
      <div class="db">
        <div class="dpane" data-pane="details"${tab === "details" ? "" : " hidden"}>
          <div class="dcard"><h4>Contact</h4><dl class="kv">
            ${row("Phone", p.phone ? `<span class="copyable">${esc(p.phone)}</span>` : "—")}
            ${row("Email", p.email ? `<span class="copyable">${esc(p.email)}</span>` : "—")}
            ${row("City", esc(p.city || "—"))}
            ${row("Came from", esc(p.came || "Direct / unknown") + (p.camp ? " · campaign " + esc(p.camp) : ""))}
          </dl></div>
          <div class="dcard"><h4>Interest &amp; purchases</h4><dl class="kv">
            ${row("Interested in", esc(p.cart || "—"))}
            ${p.leads?.length ? row("Lead", p.leads.map((L) => `${esc(L.kind)} · ${esc(L.source)} · ${fmtDT(L.created_at)}${L.interest ? " · " + esc(L.interest) : ""}${L.note ? `<span class="kv-note">${esc(L.note)}</span>` : ""}`).join("<br>")) : ""}
            ${row("First checkout", fmtDT(p.firstCheckout))}
            ${row("Last checkout", fmtDT(p.lastCheckout))}
            ${row("Orders", `<span class="num">${p.orders.length} · ${inr(paid)} paid</span>`)}
          </dl></div>
          <div class="dcard"><h4>Store account</h4><dl class="kv">
            ${row("Signed up", p.source === "customer" ? fmtDT(p.createdAt) : p.source === "lead" ? "No store account yet" : "Guest (no account)")}
            ${row("First login", p.firstLogin ? fmtDT(p.firstLogin) : "—")}
            ${row("Last login", p.lastLogin ? fmtDT(p.lastLogin) + " · " + ago(p.lastLogin) : "—")}
            ${row("Last seen", p.lastSeen ? fmtDT(p.lastSeen) + " · " + ago(p.lastSeen) : "—")}
          </dl></div>
        </div>
        <div class="dpane" data-pane="fu"${tab === "fu" ? "" : " hidden"}>
          ${ro ? "" : `<form class="frm dcard" id="dFu"><h4>Plan a follow-up</h4>
            <div class="row2"><input class="inp" type="date" id="dFuDate" required aria-label="Date" value="${tomorrow}"><input class="inp" type="time" id="dFuTime" value="11:00" aria-label="Time"></div>
            <div class="row2"><select class="inp" id="dFuType" aria-label="Type"><option>Call</option><option>WhatsApp</option><option>Demo</option><option>Home visit</option><option>Email</option></select><select class="inp" id="dFuWho" aria-label="Assign to">${teamOptions(p.owner || S.me.email.toLowerCase())}</select></div>
            <input class="inp" id="dFuNote" placeholder="What to do" aria-label="Note">
            <button class="btn" type="submit">Schedule follow-up</button>
          </form>`}
          <div class="dcard"><h4>Open (${openFu.length})</h4><div class="list">${openFu.length ? openFu.map(fuRow).join("") : '<div class="muted">No open follow-ups.</div>'}</div></div>
          ${doneFu.length ? `<details class="dcard"><summary><h4 style="display:inline">Done (${doneFu.length})</h4></summary><div class="list">${doneFu.map(fuRow).join("")}</div></details>` : ""}
        </div>
        <div class="dpane" data-pane="tl"${tab === "tl" ? "" : " hidden"}>
          <div class="tl">${tlHtml || '<div class="muted">No activity yet.</div>'}</div>
          ${ev.length > 30 ? `<button class="btn small" type="button" data-tl-all style="margin-top:10px">Show all ${ev.length} events</button>` : ""}
        </div>
        ${ro ? "" : `<div class="dpane" data-pane="note"${tab === "note" ? "" : " hidden"}>
          <form class="frm dcard" id="dNote"><h4>Add a note</h4><textarea class="inp" id="dNoteText" placeholder="e.g. Wants to try the chair at home first. Weight 95 kg."></textarea><button class="btn" type="submit">Save note</button></form>
          ${p.notes.length ? `<div class="dcard"><h4>Notes (${p.notes.length})</h4>${p.notes.map((n) => `<div class="dnote"><b>${esc(memberName(n.author_email))}</b><small>${fmtDT(n.created_at)}</small><p>${esc(n.body)}</p></div>`).join("")}</div>` : ""}
        </div>`}
      </div>
    </aside>`;
  }
  const openDrawer = (k) => { if (S.open !== k) S.dTab = "details"; S.open = k; renderDrawer(); };
  const closeDrawer = () => { S.open = null; $("drawerRoot").innerHTML = ""; };

  /* ---------- Writes ---------- */
  async function setContact(key, patch) {
    const row = { key, ...patch, updated_by: S.me.email.toLowerCase(), updated_at: new Date().toISOString() };
    const { error } = await sb.from("crm_contacts").upsert(row, { onConflict: "key" });
    if (error) { toast("Couldn't save: " + error.message); return false; }
    await reload("contacts"); return true;
  }
  async function addFollowup(key, f) {
    const { error } = await sb.from("crm_followups").insert({ key, ...f });
    if (error) { toast("Couldn't save: " + error.message); return false; }
    const p = byKey(key);
    if (p && p.stage === "new") await setContact(key, { stage: f.kind === "Demo" || f.kind === "Home visit" ? "demo" : "contacted", owner_email: p.owner || f.assignee_email || S.me.email.toLowerCase() });
    await reload("followups"); return true;
  }
  async function team(action, body) {
    const { data, error } = await sb.functions.invoke("crm-team", { body: { action, ...body } });
    if (error) { let m = error.message; try { m = (await error.context.json()).error || m; } catch {} toast(m); return null; }
    if (data?.error) { toast(data.error); return null; }
    await reload("team"); return data;
  }
  function showPassword(email, password, verb) {
    $("modalRoot").innerHTML = `<div class="modal"><div class="modal-card" role="dialog" aria-modal="true" aria-label="Temporary password">
      <h2>${verb}</h2>
      <p class="muted">Send these sign-in details to ${esc(email)}. They'll choose their own password the first time they sign in. This password is shown only once.</p>
      <div class="pwbox"><span>${esc(location.origin + location.pathname)}</span></div>
      <div class="pwbox"><span>${esc(email)}</span></div>
      <div class="pwbox"><span id="tmpPw">${esc(password)}</span><button class="btn small" type="button" data-copy="${esc(`Pulse Lead Desk\n${location.origin + location.pathname}\nEmail: ${email}\nTemporary password: ${password}`)}" data-label="Sign-in details">Copy all</button></div>
      <button class="btn primary" type="button" data-modal-close>Done</button></div></div>`;
  }

  /* ---------- New lead (phone, walk-in, WhatsApp, Instagram, forms…) ---------- */
  const LEAD_SOURCES = ["Phone call", "Walk-in", "WhatsApp", "Instagram", "Facebook", "Google", "pulseio.in website", "Website form", "Referral", "Doctor / hospital", "Exhibition / event", "Other"];
  const LEAD_KINDS = ["Purchase", "Rental", "Donation", "Service", "Demo request", "Enquiry"];
  function productNames() {
    const set = new Set();
    for (const e of S.raw.events) if (["view", "cart"].includes(e.kind) && e.meta?.t) set.add(e.meta.t);
    for (const k of S.raw.checkouts) String(k.items || "").split(/,\s*/).forEach((x) => x && set.add(x.replace(/\s*×\s*\d+$/, "")));
    ["Pulse Premium Comfort", "Pulse TravelMate", "Pulse Aerodrive", "Pulse DualDrive", "Pulse MiniLite", "Pulse Power Electric Wheelchair"].forEach((x) => set.add(x));
    return [...set].filter((x) => x.length < 80).sort();
  }
  function leadModal(L) {
    const v = (x) => esc(L?.[x] || "");
    const opt = (arr, cur) => arr.map((x) => `<option ${x === cur ? "selected" : ""}>${esc(x)}</option>`).join("");
    $("modalRoot").innerHTML = `<div class="modal"><form class="modal-card frm" id="leadForm" role="dialog" aria-modal="true" aria-label="${L ? "Edit lead" : "New lead"}" style="width:min(560px,100%)">
      <h2>${L ? "Edit lead" : "New lead"}</h2>
      <p class="muted" style="margin:0">Someone who phoned, walked in, messaged or filled a form. They'll appear in Contacts and Pipeline like any customer.</p>
      <input type="hidden" id="lKey" value="${v("key")}">
      <div class="row2"><div class="field"><label for="lName">Name *</label><input class="inp" id="lName" required value="${v("name")}" autocomplete="off"></div>
        <div class="field"><label for="lPhone">Phone / WhatsApp</label><input class="inp" id="lPhone" inputmode="tel" value="${v("phone")}" autocomplete="off" placeholder="+91"></div></div>
      <div class="row2"><div class="field"><label for="lEmail2">Email</label><input class="inp" id="lEmail2" type="email" value="${v("email")}" autocomplete="off"></div>
        <div class="field"><label for="lCity">City</label><input class="inp" id="lCity" value="${v("city")}" autocomplete="off"></div></div>
      <div class="row2"><div class="field"><label for="lSource">Where did they come from?</label><select class="inp" id="lSource">${opt(LEAD_SOURCES, L?.source || "Phone call")}</select></div>
        <div class="field"><label for="lKind">Looking for</label><select class="inp" id="lKind">${opt(LEAD_KINDS, L?.kind || "Purchase")}</select></div></div>
      <div class="field"><label for="lInterest">Interested in</label><input class="inp" id="lInterest" list="lProducts" value="${v("interest")}" placeholder="e.g. Pulse TravelMate" autocomplete="off"><datalist id="lProducts">${productNames().map((x) => `<option value="${esc(x)}">`).join("")}</datalist></div>
      <div class="field"><label for="lNote">Notes</label><textarea class="inp" id="lNote" placeholder="e.g. Father, 72 yrs, 85 kg. Wants foldable for car. Budget 70k.">${v("note")}</textarea></div>
      ${L ? "" : `<div class="row2"><div class="field"><label for="lFuDate">Follow-up (optional)</label><input class="inp" type="date" id="lFuDate"></div><div class="field"><label for="lFuTime">Time</label><input class="inp" type="time" id="lFuTime" value="11:00"></div></div>`}
      <div class="err" id="leadErr" role="alert"></div>
      <div class="acts"><button class="btn primary" type="submit">${L ? "Save changes" : "Add lead"}</button><button class="btn" type="button" data-modal-close>Cancel</button></div>
    </form></div>`;
    setTimeout(() => $("lName")?.focus(), 30);
  }
  async function saveLead() {
    const key = $("lKey").value;
    const row = { name: $("lName").value.trim(), phone: $("lPhone").value.trim() || null, email: $("lEmail2").value.trim() || null, city: $("lCity").value.trim() || null,
      source: $("lSource").value, kind: $("lKind").value, interest: $("lInterest").value.trim() || null, note: $("lNote").value.trim() || null, updated_at: new Date().toISOString() };
    if (!row.name) { $("leadErr").textContent = "Enter a name."; return; }
    if (!row.phone && !row.email) { $("leadErr").textContent = "Add a phone number or email so the team can reach them."; return; }
    const ph = digits(row.phone).slice(-10);
    if (!key && ph && S.contacts.some((p) => digits(p.phone).slice(-10) === ph) && !$("leadForm").dataset.dupOk) {
      const p = S.contacts.find((x) => digits(x.phone).slice(-10) === ph);
      $("leadErr").textContent = `${p.name} already has this number. Press "Add lead" again to add it to their profile anyway.`; $("leadForm").dataset.dupOk = "1"; return;
    }
    let res;
    if (key) res = await sb.from("crm_leads").update(row).eq("key", key).select().single();
    else res = await sb.from("crm_leads").insert({ ...row, origin: "manual", created_by: S.me.email.toLowerCase() }).select().single();
    if (res.error) { $("leadErr").textContent = "Couldn't save: " + res.error.message; return; }
    const fuDate = !key && $("lFuDate")?.value;
    $("modalRoot").innerHTML = "";
    await reload("leads");
    const contact = S.contacts.find((p) => p.leads?.some((L) => L.key === res.data.key));
    if (fuDate && contact) await addFollowup(contact.key, { due_at: new Date(`${fuDate}T${$("lFuTime")?.value || "11:00"}`).toISOString(), kind: "Call", note: row.interest ? "About " + row.interest : row.kind + " enquiry", assignee_email: S.me.email.toLowerCase(), created_by: S.me.email.toLowerCase() });
    toast(key ? "Lead updated" : "Lead added");
    if (contact) openDrawer(contact.key);
  }

  /* ---------- Excel download ---------- */
  function downloadXlsx(name, rows) {
    if (!rows.length) { toast("Nothing to download for this date range"); return; }
    if (!window.XLSX) { toast("Excel tool is still loading, try again in a moment"); return; }
    const ws = XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = Object.keys(rows[0]).map((k) => ({ wch: Math.min(48, Math.max(10, k.length + 2, ...rows.slice(0, 200).map((r) => String(r[k] ?? "").length + 1))) }));
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
    const stamp = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `Pulse ${name} ${S.period.p === "all" ? "all time" : periodLabel().replace(/[^\w ]+/g, " ").trim()} ${stamp}.xlsx`);
  }
  const xdt = (d) => (d ? new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "");
  function exportView(v) {
    if (v === "contacts") return downloadXlsx("Contacts", contactRows().map((p) => ({ Name: p.name, Phone: p.phone, Email: p.email, City: p.city, Status: p.statusText, Stage: STAGE_NAME[p.stage], "Came from": p.came || "Direct / unknown", Campaign: p.camp, "Signed up": p.source === "customer" ? xdt(p.createdAt) : p.source === "lead" ? "Lead" : "Guest", "Last login": xdt(p.lastLogin), "Last checkout": xdt(p.lastCheckout), "Interested in": p.cart, "Value (₹)": Math.round(p.value || 0), Owner: p.owner ? memberName(p.owner) : "", "Next follow-up": p.nextFU ? `${p.nextFU.kind} ${xdt(p.nextFU.due_at)}` : "", "Checkout link": p.recover })));
    if (v === "checkouts") return downloadXlsx("Checkouts", S.ck.filter((k) => inRange(k.created_at)).map((k) => { const p = byKey(k.customer_id ? "c" + k.customer_id : "g" + k.id); return { Started: xdt(k.created_at), Customer: p?.name || k.name || "Guest", Phone: p?.phone || k.phone || "", Email: p?.email || k.email || "", Wheelchair: k.items, "Value (₹)": Math.round(Number(k.total) || 0), Result: k.completed_at ? "Completed" : k.live ? "On payment page" : "Abandoned", "Checkout link": k.recover_url || "" }; }));
    if (v === "orders") return downloadXlsx("Orders", S.raw.orders.filter((o) => inRange(o.created_at)).map((o) => ({ Order: o.name, Date: xdt(o.created_at), Customer: o.customer_name || "", Phone: o.phone || "", Email: o.email || "", Items: o.items, "Value (₹)": Math.round(Number(o.total) || 0), Payment: (PAY[o.financial] || [0, o.financial])[1], Delivery: o.cancelled_at ? "Cancelled" : o.fulfillment === "FULFILLED" ? "Shipped" : "To ship" })));
    if (v === "schedule") return downloadXlsx("Follow-ups", allFollowups().filter((f) => inRange(f.due_at)).map((f) => { const p = byKey(f.key); return { Due: xdt(f.due_at), Type: f.kind, Contact: p?.name || "", Phone: p?.phone || "", Note: f.note || "", "Assigned to": f.assignee_email ? memberName(f.assignee_email) : "", Done: f.done ? "Yes" : "No" }; }));
  }

  /* ---------- Reports ---------- */
  function repBounds() {
    let [a, b] = periodBounds();
    if (!isFinite(a)) a = Math.min(now() - 30 * DAY, ...S.raw.customers.map((c) => t(c.created_at)).filter(Boolean));
    if (!isFinite(b)) b = now();
    return [a, b];
  }
  async function loadReports() {
    const [a, b] = repBounds(), args = { p_from: new Date(a).toISOString(), p_to: new Date(b).toISOString() };
    const key = args.p_from + args.p_to;
    if (S.rep && S.rep.key === key && now() - S.rep.at < 60e3) return;
    $("repStatus").textContent = "Loading…";
    const [d, pr, so, se] = await Promise.all([sb.rpc("crm_activity_daily", args), sb.rpc("crm_product_stats", args), sb.rpc("crm_source_stats", args), sb.rpc("crm_search_stats", args)]);
    const err = d.error || pr.error || so.error || se.error;
    if (err) { $("repStatus").textContent = "Couldn't load reports: " + err.message; return; }
    S.rep = { key, at: now(), daily: d.data || [], products: pr.data || [], sources: so.data || [], searches: se.data || [] };
    $("repStatus").textContent = "";
    renderReports();
  }
  const bucketKey = (ms, g) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); if (g === "week") d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); if (g === "month") d.setDate(1); return d.getTime(); };
  const bucketLabel = (ms, g) => g === "month" ? new Date(ms).toLocaleDateString("en-IN", { month: "short", year: "2-digit" }) : new Date(ms).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  function series(metric, g) {
    const [a, b] = repBounds(), out = new Map();
    for (let x = bucketKey(a, g); x <= b; ) { out.set(x, 0); const d = new Date(x); if (g === "month") d.setMonth(d.getMonth() + 1); else d.setDate(d.getDate() + (g === "week" ? 7 : 1)); x = d.getTime(); }
    const add = (ms, n) => { if (ms < a || ms > b) return; const k = bucketKey(ms, g); if (out.has(k)) out.set(k, out.get(k) + n); };
    if (["visit", "view", "cart", "checkout", "search"].includes(metric)) for (const r of S.rep.daily) if (r.kind === metric) add(new Date(r.day + "T12:00:00").getTime(), Number(r.people));
    if (metric === "signup") for (const c of S.raw.customers) add(t(c.created_at), 1);
    if (metric === "leads") for (const L of S.raw.leads) add(t(L.created_at), 1);
    if (metric === "orders") for (const o of S.raw.orders) if (!o.cancelled_at) add(t(o.created_at), 1);
    if (metric === "revenue") for (const o of S.raw.orders) if (!o.cancelled_at && ["PAID", "PARTIALLY_REFUNDED"].includes(o.financial)) add(t(o.created_at), Number(o.total) || 0);
    return [...out.entries()];
  }
  function barChart(data, money) {
    const W = 900, H = 240, pl = 44, pb = 28, pt = 12, max = Math.max(1, ...data.map((d) => d[1]));
    const nice = (v) => { const p = Math.pow(10, Math.floor(Math.log10(v))); return Math.ceil(v / p) * p; }, top = nice(max);
    const bw = (W - pl - 8) / Math.max(1, data.length), every = Math.ceil(data.length / 12);
    const fmt = (v) => money ? (v >= 1e5 ? "₹" + (v / 1e5).toFixed(v >= 1e6 ? 0 : 1) + "L" : v >= 1e3 ? "₹" + Math.round(v / 1e3) + "k" : "₹" + v) : String(Math.round(v));
    let g = "";
    for (let i = 0; i <= 4; i++) { const y = pt + (H - pt - pb) * (1 - i / 4); g += `<line x1="${pl}" x2="${W}" y1="${y}" y2="${y}" class="grid"/><text x="${pl - 6}" y="${y + 4}" text-anchor="end" class="ax">${fmt((top * i) / 4)}</text>`; }
    data.forEach(([k, v], i) => {
      const h = ((H - pt - pb) * v) / top, x = pl + i * bw + bw * 0.15, y = H - pb - h;
      g += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${Math.max(2, bw * 0.7).toFixed(1)}" height="${Math.max(v ? 2 : 0, h).toFixed(1)}" rx="3" class="bar"><title>${bucketLabel(k, S.repGroup)}: ${money ? inr(v) : v}</title></rect>`;
      if (i % every === 0) g += `<text x="${(x + bw * 0.35).toFixed(1)}" y="${H - 8}" text-anchor="middle" class="ax">${bucketLabel(k, S.repGroup)}</text>`;
    });
    return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Chart">${g}</svg>`;
  }
  const pct = (a, b) => (b ? Math.round((a / b) * 100) + "%" : "—");
  function renderReports() {
    if (!S.rep) { loadReports(); return; }
    $("repRange").textContent = S.period.p === "all" ? "All time" : periodLabel();
    const sum = (m) => series(m, "day").reduce((s, [, v]) => s + v, 0);
    const [a, b] = repBounds(), inR = (d) => t(d) >= a && t(d) <= b;
    const visitors = new Set(S.raw.events.filter((e) => inR(e.created_at)).map(evPerson)).size;
    const carters = new Set(S.raw.events.filter((e) => e.kind === "cart" && inR(e.created_at)).map(evPerson)).size;
    const ckers = new Set(S.raw.events.filter((e) => e.kind === "checkout" && inR(e.created_at)).map(evPerson)).size;
    const orders = S.raw.orders.filter((o) => !o.cancelled_at && inR(o.created_at));
    const revenue = orders.filter((o) => ["PAID", "PARTIALLY_REFUNDED"].includes(o.financial)).reduce((s, o) => s + Number(o.total || 0), 0);
    const tiles = [["Visitors", visitors, "people on the store"], ["Added to cart", carters, pct(carters, visitors) + " of visitors"], ["Reached payment", ckers, pct(ckers, carters) + " of carts"], ["Orders", orders.length, pct(orders.length, visitors) + " conversion"], ["Revenue", inr(revenue), "paid orders"], ["New leads", S.raw.leads.filter((L) => inR(L.created_at)).length, "phone, walk-in, forms"]];
    $("repKpis").innerHTML = tiles.map(([l, v, sub]) => `<div class="kpi"><span class="l">${l}</span><span class="v num">${v}</span><span class="s">${esc(sub)}</span></div>`).join("");
    const METRICS = [["visit", "Visitors"], ["view", "Product viewers"], ["cart", "Added to cart"], ["checkout", "Reached payment"], ["signup", "Sign-ups"], ["leads", "New leads"], ["orders", "Orders"], ["revenue", "Revenue"]];
    $("repMetric").innerHTML = METRICS.map(([v, l]) => `<option value="${v}" ${S.repMetric === v ? "selected" : ""}>${l}</option>`).join("");
    $("repGroup").innerHTML = [["day", "By day"], ["week", "By week"], ["month", "By month"]].map(([v, l]) => `<option value="${v}" ${S.repGroup === v ? "selected" : ""}>${l}</option>`).join("");
    const data = series(S.repMetric, S.repGroup);
    $("repChart").innerHTML = data.length ? barChart(data, S.repMetric === "revenue") : `<div class="empty">No data in this range.</div>`;
    $("repChartNote").textContent = `${METRICS.find((m) => m[0] === S.repMetric)[1]}: ${S.repMetric === "revenue" ? inr(sum("revenue")) : data.reduce((s, [, v]) => s + v, 0)} in this range${["visit", "view", "cart", "checkout"].includes(S.repMetric) ? " (people counted once per day)" : ""}`;

    // Sources
    const src = S.rep.sources;
    $("repSources").innerHTML = src.length ? src.map((r) => `<tr><td><b>${esc(r.source)}</b></td><td class="num">${r.visitors}</td><td class="num">${r.carts}</td><td class="num">${r.checkouts}</td><td class="num">${r.orders}</td><td class="num">${inr(r.revenue)}</td><td class="num">${pct(Number(r.orders), Number(r.visitors))}</td></tr>`).join("") : `<tr><td colspan="7" class="empty">No visits in this range yet.</td></tr>`;
    // Products
    const sold = {};
    for (const o of orders) String(o.items || "").split(/,\s*/).forEach((x) => { const m = x.match(/^(.*?)(?:\s*×\s*(\d+))?$/); if (m && m[1]) sold[m[1].trim()] = (sold[m[1].trim()] || 0) + Number(m[2] || 1); });
    const prows = S.rep.products.map((r) => ({ ...r, sold: Object.entries(sold).filter(([n]) => n.includes(r.product) || r.product.includes(n)).reduce((s, [, n]) => s + n, 0) }));
    $("repProducts").innerHTML = prows.length ? prows.map((r) => {
      const v = Number(r.viewers), c = Number(r.carts);
      const flag = v >= 5 && c / v < 0.1 ? '<span class="chip c-notconverted">Many views, few carts: check price, photos, reviews</span>' : c >= 3 && Number(r.checkouts) === 0 ? '<span class="chip c-pending">Added but nobody pays: check price or delivery</span>' : "";
      return `<tr><td><b>${esc(r.product)}</b>${flag ? "<br>" + flag : ""}</td><td class="num">${v}</td><td class="num">${c}</td><td class="num">${r.checkouts}</td><td class="num">${r.sold}</td><td class="num">${pct(c, v)}</td><td class="num">${pct(r.sold, c)}</td></tr>`;
    }).join("") : `<tr><td colspan="7" class="empty">Product views appear here once the updated store pixel is saved.</td></tr>`;
    // Searches
    $("repSearches").innerHTML = S.rep.searches.length ? S.rep.searches.map((r) => `<tr><td><b>${esc(r.term)}</b></td><td class="num">${r.searches}</td><td class="num">${r.people}</td></tr>`).join("") : `<tr><td colspan="3" class="empty">Searches typed on the store appear here.</td></tr>`;
    // Morning report
    const rp = S.raw.reports[0];
    $("repDaily").innerHTML = rp ? dailyHtml(rp.body) + `<p class="syncnote">Report for ${fmtDate(rp.day)} · made ${fmtDT(rp.created_at)}${rp.emailed ? " · emailed" : ""}</p>` : `<div class="empty">The first report is made tomorrow at 9:00 am.${isAdmin() ? ' <button class="btn small" type="button" id="repMakeNow">Make one now</button>' : ""}</div>`;
  }
  function dailyHtml(b) {
    const rows = [["New sign-ups", b.signups], ["New leads", b.leads], ["Visitors", b.visitors], ["Added to cart", b.carts], ["Reached payment", b.checkouts], ["Orders", b.orders], ["Revenue", inr(b.revenue)]];
    return `<div class="dkpis">${rows.map(([l, v]) => `<div><span>${l}</span><b class="num">${v ?? 0}</b></div>`).join("")}</div>
      ${b.hot?.length ? `<h4>Call these first (${b.hot.length})</h4><ul>${b.hot.map((h) => `<li><b>${esc(h.name)}</b> · ${esc(h.phone || "")} · ${esc(h.what || "")}</li>`).join("")}</ul>` : ""}
      ${b.due?.length ? `<h4>Follow-ups due today (${b.due.length})</h4><ul>${b.due.map((f) => `<li>${esc(f.time)} · <b>${esc(f.kind)}</b> · ${esc(f.name)}${f.who ? " · " + esc(f.who) : ""}</li>`).join("")}</ul>` : ""}
      ${b.topProducts?.length ? `<h4>Most viewed yesterday</h4><ul>${b.topProducts.map((x) => `<li>${esc(x.product)} · ${x.viewers} viewers · ${x.carts} carts</li>`).join("")}</ul>` : ""}`;
  }
  function tableRows(id) {
    return [...$(id).closest("table").querySelectorAll("tbody tr")].filter((tr) => !tr.querySelector(".empty")).map((tr) => {
      const heads = [...tr.closest("table").querySelectorAll("thead th")].map((th) => th.textContent.trim());
      return Object.fromEntries([...tr.children].map((td, i) => [heads[i] || "Col " + i, td.querySelector("b")?.textContent.trim() ?? td.textContent.trim()]));
    });
  }
  // Tracking-link maker for ads and posts
  function makeLink() {
    const base = $("tlUrl").value.trim() || "https://motion-pulse.myshopify.com/", src = $("tlSrc").value, cmp = $("tlCmp").value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const [us, um] = src.split("|");
    let u; try { u = new URL(/^https?:/.test(base) ? base : "https://" + base); } catch { $("tlOut").value = ""; return; }
    u.searchParams.set("utm_source", us); u.searchParams.set("utm_medium", um); if (cmp) u.searchParams.set("utm_campaign", cmp);
    $("tlOut").value = u.toString();
  }

  /* ---------- Follow-up reminders (pop-up when your follow-up is due) ---------- */
  let remindTimer = null;
  function checkReminders(first) {
    if (!S.loaded || !S.me) return;
    const me = S.me.email.toLowerCase(); let seen = {};
    try { seen = JSON.parse(localStorage.getItem("pulse-fu-seen") || "{}"); } catch {}
    const mine = S.raw.followups.filter((f) => !f.done && (f.assignee_email || f.created_by) === me);
    if (first) {
      const over = mine.filter((f) => t(f.due_at) < now() - 5 * 60e3 && !seen[f.id]);
      if (over.length) { notify("Overdue follow-ups", `You have ${over.length} follow-up${over.length === 1 ? "" : "s"} past their time. Open the Schedule tab.`); over.forEach((f) => (seen[f.id] = 1)); }
    }
    for (const f of mine) {
      if (seen[f.id]) continue;
      const due = t(f.due_at);
      if (due - now() <= 5 * 60e3 && due - now() > -30 * 60e3) {
        const p = byKey(f.key);
        notify(`${f.kind} due ${due > now() ? "at " + fmtTime(f.due_at) : "now"}`, `${p?.name || "Contact"}${p?.phone ? " · " + p.phone : ""}${f.note ? " · " + f.note : ""}`);
        seen[f.id] = 1;
      }
    }
    try { localStorage.setItem("pulse-fu-seen", JSON.stringify(seen)); } catch {}
  }

  /* ---------- Events ---------- */
  document.addEventListener("click", async (e) => {
    const el = e.target.closest("[data-cview],[data-cmore],[data-csort],[data-dtab],[data-tl-all],[data-box],#bfClear,[data-more],[data-less],[data-csv],[data-drefresh],[data-copy],[data-open],[data-close],[data-go],[data-cf],[data-kf],[data-sf],.tab,#refreshBtn,#bannerRetry,[data-reset],[data-remove],[data-restore],[data-modal-close],#newLeadBtn,[data-edit-lead],[data-del-lead],[data-export],[data-export-table],#repMakeNow,#tlCopy");
    if (!el) return;
    if (el.matches("[data-copy]")) { e.stopPropagation(); copy(el.dataset.copy, el.dataset.label); return; }
    if (el.matches("[data-modal-close]")) { $("modalRoot").innerHTML = ""; return; }
    if (el.id === "newLeadBtn") { leadModal(null); return; }
    if (el.matches("[data-edit-lead]")) { leadModal(S.raw.leads.find((L) => L.key === el.dataset.editLead)); return; }
    if (el.matches("[data-del-lead]")) { if (el.dataset.confirm !== "1") { el.dataset.confirm = "1"; el.textContent = "Click again to delete"; return; } const { error } = await sb.from("crm_leads").delete().eq("key", el.dataset.delLead); if (error) toast("Couldn't delete: " + error.message); else { closeDrawer(); await reload("leads"); toast("Lead deleted"); } return; }
    if (el.matches("[data-export]")) { exportView(el.dataset.export); return; }
    if (el.matches("[data-export-table]")) { const [id, name] = el.dataset.exportTable.split("|"); downloadXlsx(name, tableRows(id)); return; }
    if (el.id === "repMakeNow") { el.disabled = true; el.textContent = "Making…"; const { error } = await sb.functions.invoke("daily-report", { body: { now: true } }); if (error) { let m = error.message; try { m = (await error.context.json()).error || m; } catch {} toast("Couldn't make the report: " + m); } else { S.raw.reports = (await sb.from("crm_reports").select("*").order("created_at", { ascending: false }).limit(14)).data || []; renderReports(); toast("Report ready"); } return; }
    if (el.id === "tlCopy") { makeLink(); if ($("tlOut").value) copy($("tlOut").value, "Tracking link"); return; }
    if (el.matches("[data-cview]")) { S.cv.view = el.dataset.cview; saveCv(); renderContacts(); return; }
    if (el.matches("[data-cmore]")) { S.more.ctable = (S.more.ctable || 50) + 50; renderContacts(); return; }
    if (el.matches("[data-csort]")) { S.cv.sort = el.dataset.csort; saveCv(); renderContacts(); return; }
    if (el.matches("[data-dtab]")) { S.dTab = el.dataset.dtab; document.querySelectorAll("#drawerRoot .dtab").forEach((b) => b.classList.toggle("on", b === el)); document.querySelectorAll("#drawerRoot .dpane").forEach((x) => { x.hidden = x.dataset.pane !== S.dTab; }); const db = document.querySelector("#drawerRoot .db"); if (db) db.scrollTop = 0; return; }
    if (el.matches("[data-tl-all]")) { document.querySelectorAll("#drawerRoot .tl-x").forEach((x) => x.classList.remove("tl-x")); el.remove(); return; }
    if (el.matches("[data-box]")) { S.box = el.dataset.box; S.more.box = TILE_STEP; try { localStorage.setItem("pulse-box", S.box); } catch {} render(); $("bxPanel").scrollIntoView({ behavior: "smooth", block: "start" }); return; }
    if (el.id === "bfClear") { S.bf = {}; try { localStorage.removeItem("pulse-bf"); } catch {} render(); return; }
    if (el.matches("[data-more]")) { S.more[el.dataset.more] = (S.more[el.dataset.more] || TILE_STEP) + TILE_STEP; render(); return; }
    if (el.matches("[data-less]")) { S.more[el.dataset.less] = TILE_STEP; render(); return; }
    if (el.matches("[data-csv]")) { downloadCsv(el.dataset.csv); return; }
    if (el.matches("[data-drefresh]")) { const sc = document.querySelector("#drawerRoot .db"); const top = sc ? sc.scrollTop : 0; renderDrawer(); const sc2 = document.querySelector("#drawerRoot .db"); if (sc2) sc2.scrollTop = top; toast("Contact refreshed"); return; }
    if (el.matches("[data-close]")) { closeDrawer(); return; }
    if (el.matches(".tab")) { setView(el.dataset.v); return; }
    if (el.id === "refreshBtn" || el.id === "bannerRetry") { runSync(); return; }
    if (el.matches("[data-go]")) { const [v, f] = el.dataset.go.split(":"); if (f) S.cFilter = f; setView(v); return; }
    if (el.matches("[data-cf]")) { S.cFilter = el.dataset.cf; S.more.ctable = 50; render(); return; }
    if (el.matches("[data-kf]")) { S.kFilter = el.dataset.kf; render(); return; }
    if (el.matches("[data-sf]")) { S.sFilter = el.dataset.sf; render(); return; }
    if (el.matches("[data-reset]")) { const r = await team("reset", { email: el.dataset.reset }); if (r) showPassword(r.email, r.password, "New password ready"); return; }
    if (el.matches("[data-remove]")) { if (el.dataset.confirm !== "1") { el.dataset.confirm = "1"; el.textContent = "Click again to remove"; return; } if (await team("remove", { email: el.dataset.remove })) toast("Removed. They can no longer sign in."); return; }
    if (el.matches("[data-restore]")) { if (await team("restore", { email: el.dataset.restore })) toast("Access restored"); return; }
    if (el.matches("[data-open]")) { if (e.target.closest("a,button:not(.card),input,select")) return; openDrawer(el.dataset.open); }
  });
  const markSelf = (e) => { const t = e.target; if (!t.closest || !t.closest("#drawerRoot") || t.closest("[data-drefresh],[data-close],[data-dtab],[data-tl-all]")) return;
    if (e.type === "submit" || (e.type === "change" && t.matches("select")) || (e.type === "click" && t.closest("button"))) S.drawerSelf = Date.now(); };
  ["submit", "change", "click"].forEach((ev) => document.addEventListener(ev, markSelf, true));
  document.addEventListener("change", (e) => {
    const cm = { cOwner: "owner", cStage: "stage", cSort: "sort" }[e.target.id];
    if (cm) { S.cv[cm] = e.target.value; S.more.ctable = 50; S.more.contacts = 0; saveCv(); renderContacts(); return; }
    const m = { bfOwner: "owner", bfFrom: "from", bfTo: "to", bfDay: "day", bfMonth: "month" }[e.target.id]; if (!m) return;
    S.bf[m] = e.target.value; S.more.box = TILE_STEP; try { localStorage.setItem("pulse-bf", JSON.stringify(S.bf)); } catch {} render();
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") { if ($("modalRoot").innerHTML) $("modalRoot").innerHTML = ""; else if (S.open) closeDrawer(); } });
  document.addEventListener("change", async (e) => {
    const el = e.target;
    if (el.id === "dStage") { if (await setContact(S.open, { stage: el.value, owner_email: byKey(S.open)?.owner || null })) toast("Stage saved"); }
    if (el.id === "dOwner") { if (await setContact(S.open, { stage: byKey(S.open)?.stage || "new", owner_email: el.value || null })) toast("Owner saved"); }
    if (el.dataset.fuDone) {
      const { error } = await sb.from("crm_followups").update({ done: el.checked, done_at: el.checked ? new Date().toISOString() : null }).eq("id", el.dataset.fuDone);
      if (error) toast("Couldn't save: " + error.message); else { toast(el.checked ? "Marked done" : "Reopened"); reload("followups"); }
    }
    if (el.dataset.role) { if (await team("role", { email: el.dataset.role, role: el.value })) toast("Role changed"); }
  });
  document.addEventListener("submit", async (e) => {
    const f = e.target;
    if (!["dNote", "dFu", "sForm", "tForm"].includes(f.id)) return;
    e.preventDefault();
    if (f.id === "dNote") {
      const body = $("dNoteText").value.trim(); if (!body) return;
      const { error } = await sb.from("crm_notes").insert({ key: S.open, body, author_email: S.me.email.toLowerCase() });
      if (error) toast("Couldn't save: " + error.message); else { toast("Note saved"); reload("notes"); }
    }
    if (f.id === "dFu" || f.id === "sForm") {
      const d = f.id === "dFu";
      const key = d ? S.open : $("sWho").value, date = $(d ? "dFuDate" : "sDate").value;
      if (!key || !date) return;
      const ok = await addFollowup(key, { due_at: new Date(date + "T" + ($(d ? "dFuTime" : "sTime").value || "11:00")).toISOString(), kind: $(d ? "dFuType" : "sType").value, note: $(d ? "dFuNote" : "sNote").value.trim() || null, assignee_email: $(d ? "dFuWho" : "sAssignee").value || null, created_by: S.me.email.toLowerCase() });
      if (ok) { toast("Follow-up scheduled"); if (!d) $("sNote").value = ""; }
    }
    if (f.id === "tForm") {
      const r = await team("add", { email: $("tEmail").value, name: $("tName").value, role: $("tRole").value });
      if (r) { f.reset(); showPassword(r.email, r.password, "Added to the team"); }
    }
  });
  $("cSearch").addEventListener("input", (e) => { S.search = e.target.value; renderContacts(); });

  /* ---------- Alerts: on-screen pop-up, sound, and desktop/phone notification ---------- */
  let audio = null;
  function beep() {
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      const o = audio.createOscillator(), g = audio.createGain();
      o.frequency.value = 880; g.gain.setValueAtTime(0.15, audio.currentTime); g.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.5);
      o.connect(g); g.connect(audio.destination); o.start(); o.stop(audio.currentTime + 0.5);
    } catch {}
  }
  function notify(title, body) {
    const el = $("toast"); el.textContent = title + ": " + body; el.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(() => (el.hidden = true), 8000);
    beep();
    try { if ("Notification" in window && Notification.permission === "granted") new Notification("Pulse · " + title, { body, tag: title + body }); } catch {}
  }
  function alertsLabel() {
    const b = $("alertsBtn"); if (!b) return;
    const on = "Notification" in window && Notification.permission === "granted";
    b.textContent = on ? "Alerts on" : "Turn on alerts"; b.classList.toggle("primary", !on);
  }
  $("alertsBtn")?.addEventListener("click", async () => {
    beep();
    if (!("Notification" in window)) { toast("This browser can't show notifications. Pop-ups and sound still work while this tab is open."); return; }
    if (Notification.permission === "denied") { toast("Notifications are blocked. Allow them from the lock icon next to the address bar."); return; }
    await Notification.requestPermission(); alertsLabel();
    if (Notification.permission === "granted") notify("Alerts on", "You'll be notified of new sign-ups, logins, checkouts and orders while Lead Desk is open.");
  });
  alertsLabel();

  /* ---------- Sync + live updates ---------- */
  async function runSync() {
    setSync("busy", "Syncing with Shopify…");
    const { data, error } = await sb.functions.invoke("shopify-sync", { body: {} });
    if (error) { let m = error.message; try { m = (await error.context.json()).error || m; } catch {} toast("Sync failed: " + m); }
    else if (data?.skipped) toast("A sync is already running");
    else toast("Up to date");
    await loadAll();
  }
  let channel = null, poll = null;
  function startLive() {
    stopLive();
    channel = sb.channel("crm-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "crm_contacts" }, () => reload("contacts"))
      .on("postgres_changes", { event: "*", schema: "public", table: "crm_notes" }, () => reload("notes"))
      .on("postgres_changes", { event: "*", schema: "public", table: "crm_followups" }, () => reload("followups"))
      .on("postgres_changes", { event: "*", schema: "public", table: "crm_leads" }, (p) => { reload("leads"); if (p.eventType === "INSERT" && p.new?.origin === "form") notify("New website enquiry", `${p.new.name}${p.new.phone ? " · " + p.new.phone : ""} · ${p.new.kind}`); })
      .on("postgres_changes", { event: "*", schema: "public", table: "crm_sync_log" }, (p) => { if (p.new?.finished_at && p.new?.ok) loadAll(); else reload("sync"); })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "store_events" }, (p) => {
        S.raw.events.unshift(p.new); S.contacts = build(); render();
        if ((p.new?.kind === "cart" && !String(p.new.path || "").startsWith("/checkouts")) || p.new?.kind === "checkout") {
          const w = cartWho(p.new), m = p.new.meta || {};
          notify(p.new.kind === "cart" ? "Added to cart" : "Checkout started", `${w.name} (${w.tag}) ${p.new.kind === "cart" ? "added " + (m.t || "a product") + (m.a ? " · ₹" + Number(m.a * (m.q || 1)).toLocaleString("en-IN") : "") : "started checkout" + (m.tot ? " · ₹" + Number(m.tot).toLocaleString("en-IN") : "")}`);
        }
        if (p.new?.kind === "login") {
          const c = S.raw.customers.find((x) => x.id === p.new.customer_id);
          notify("Customer logged in", `${c ? (c.name || c.email || c.phone) : "A new customer"} just logged in on the store (${p.new.device || "web"})`);
        }
      })
      .subscribe((status) => {
        // The connection drops when the laptop sleeps or Wi-Fi changes: reconnect and reload the data.
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") { clearTimeout(startLive._t); startLive._t = setTimeout(() => { if (S.me) { startLive(); loadAll(); } }, 5000); }
      });
    poll = setInterval(() => { if (!document.hidden) { syncStatus(); render(); } }, 60_000);
    clearInterval(remindTimer); remindTimer = setInterval(() => checkReminders(false), 30_000); setTimeout(() => checkReminders(true), 4000);
  }
  // When the tab comes back after being hidden (laptop asleep, other tab), refresh the data and the live connection.
  let hiddenAt = 0;
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { hiddenAt = now(); return; }
    if (S.me && S.loaded && now() - hiddenAt > 60e3) { startLive(); loadAll(); }
  });
  // If a newer version of Lead Desk has been published, reload to pick it up (never while a form is being typed in).
  const MY_VERSION = (document.querySelector('script[src*="app.js?v="]')?.getAttribute("src") || "").split("v=")[1] || "";
  setInterval(async () => {
    try {
      const html = await (await fetch(location.pathname + "?check=" + now(), { cache: "no-store" })).text();
      const v = (html.match(/app\.js\?v=(\d+)/) || [])[1];
      if (v && MY_VERSION && v !== MY_VERSION && !$("modalRoot").innerHTML && !S.open && !document.querySelector("input:focus,textarea:focus")) location.reload();
    } catch {}
  }, 5 * 60e3);
  function stopLive() { if (channel) sb.removeChannel(channel); channel = null; clearInterval(poll); clearInterval(remindTimer); }
})();
