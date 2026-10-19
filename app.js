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
    raw: { customers: [], checkouts: [], orders: [], events: [], contacts: [], notes: [], followups: [], team: [], sync: [] },
    contacts: [], loaded: false,
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
      const [customers, checkouts, orders, events, contacts, notes, followups, team, sync] = await Promise.all([
        fetchAll("sh_customers", "id,name,email,phone,city,created_at,updated_at,orders_count,amount_spent,tags,state", "updated_at"),
        fetchAll("sh_checkouts", "id,customer_id,name,email,phone,city,created_at,updated_at,completed_at,total,items,recover_url", "created_at"),
        fetchAll("sh_orders", "id,name,customer_id,customer_name,email,phone,created_at,cancelled_at,financial,fulfillment,total,items", "created_at"),
        sb.from("store_events").select("customer_id,visitor,kind,created_at,device,path,meta").gte("created_at", since).order("created_at", { ascending: false }).limit(5000).then((r) => r.data || []),
        fetchAll("crm_contacts", "*"),
        fetchAll("crm_notes", "*", "created_at"),
        fetchAll("crm_followups", "*"),
        sb.from("crm_team").select("*").order("created_at").then((r) => r.data || []),
        sb.from("crm_sync_log").select("*").order("started_at", { ascending: false }).limit(12).then((r) => r.data || []),
      ]);
      if (S.loaded) {
        const oldC = new Set(S.raw.customers.map((c) => c.id)), oldK = new Set(S.raw.checkouts.map((k) => k.id)), oldO = new Set(S.raw.orders.map((o) => o.id));
        customers.filter((c) => !oldC.has(c.id)).forEach((c) => notify("New sign-up", `${c.name || c.email || c.phone || "A new customer"} just created an account`));
        checkouts.filter((k) => !oldK.has(k.id)).forEach((k) => notify("New checkout", `${k.name || k.email || k.phone || "Someone"} started checkout${k.total ? " · ₹" + Number(k.total).toLocaleString("en-IN") : ""}`));
        orders.filter((o) => !oldO.has(o.id)).forEach((o) => notify("New order", `${o.customer_name || o.email || "A customer"} placed ${o.name || "an order"}`));
      }
      Object.assign(S.raw, { customers, checkouts, orders, events, contacts, notes, followups, team, sync });
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
    };
    S.raw[which] = await map[which]();
    if (which === "sync") syncStatus();
    S.contacts = build(); render();
  }

  function build() {
    const R = S.raw, byKey = new Map();
    const get = (key, seed) => { if (!byKey.has(key)) byKey.set(key, Object.assign({ key, checkouts: [], orders: [], logins: [], visits: [], tags: [] }, seed)); return byKey.get(key); };
    for (const c of R.customers) get("c" + c.id, { cid: c.id, source: "customer", name: c.name || "Unnamed customer", email: c.email || "", phone: c.phone || "", city: c.city || "", createdAt: c.created_at, updatedAt: c.updated_at, spent: Number(c.amount_spent || 0), orderCount: c.orders_count || 0, tags: c.tags || [] });
    for (const k of R.checkouts) {
      const p = get(k.customer_id ? "c" + k.customer_id : "g" + k.id, { source: "guest", name: k.name || "Guest checkout", email: k.email || "", phone: "", city: "", createdAt: k.created_at, updatedAt: k.updated_at, spent: 0, orderCount: 0 });
      if (!p.phone) p.phone = k.phone || ""; if (!p.city) p.city = k.city || ""; if (!p.email) p.email = k.email || "";
      p.checkouts.push(k);
    }
    for (const o of R.orders) {
      const p = get(o.customer_id ? "c" + o.customer_id : "o" + o.id, { source: "guest", name: o.customer_name || o.email || "Guest order", email: o.email || "", phone: o.phone || "", city: "", createdAt: o.created_at, updatedAt: o.created_at, spent: 0, orderCount: 0 });
      p.orders.push(o);
    }
    for (const ev of R.events) {
      const p = ev.customer_id ? byKey.get("c" + ev.customer_id) : null; if (!p) continue;
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
      else { p.status = "signup"; p.statusText = "Signed up"; }
      p.fresh = p.source === "customer" && now() - t(p.createdAt) < 7 * DAY;
      p.cart = (lastAbandoned || p.checkouts[0])?.items || "";
      p.recover = lastAbandoned?.recover_url || "";
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
  function actions(p) {
    const a = [];
    if (p.phone) {
      a.push(`<a class="btn small" href="https://wa.me/${waNum(p.phone)}?text=${encodeURIComponent("Hi " + (p.name.split(" ")[0] || "") + ", this is Pulse Wheelchairs. ")}" target="_blank" rel="noopener">WhatsApp</a>`);
      a.push(`<a class="btn small" href="tel:${esc(p.phone)}">Call</a>`);
      a.push(`<button class="btn small" type="button" data-copy="${esc(p.phone)}" data-label="Phone number">${esc(p.phone)}</button>`);
    }
    if (p.recover) a.push(`<button class="btn small" type="button" data-copy="${esc(p.recover)}" data-label="Checkout link">Copy checkout link</button>`);
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

  /* ---------- Views ---------- */
  function renderKpis() {
    const C = S.contacts, ck = S.raw.checkouts, od = S.raw.orders;
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
      ["Total contacts", C.length, `${S.raw.customers.length} accounts · ${C.length - S.raw.customers.length} guests`, "", "contacts:all"],
    ];
    $("kpis").innerHTML = k.map(([l, v, s, cls, go]) => `<button type="button" class="kpi ${cls}" data-go="${go}"><span class="l">${l}</span><span class="v num">${v}</span><span class="s">${esc(s)}</span></button>`).join("");
  }
  function li(p, sub) { return `<div class="li"><div class="who" data-open="${p.key}" style="cursor:pointer"><b>${esc(p.name)} ${chip(p)}</b><small>${sub}</small></div>${actions(p)}</div>`; }
  function renderOverview() {
    renderKpis();
    renderCarts();
    const hot = S.contacts.filter((p) => (p.status === "notconverted" || p.status === "checkout") && now() - t(p.lastCheckout) < 14 * DAY);
    $("hotList").innerHTML = hot.length ? hot.slice(0, 10).map((p) => li(p, `${esc(p.cart || "Checkout")} · ${inr(p.value)} · ${ago(p.lastCheckout)}${p.owner ? " · " + esc(memberName(p.owner)) : ""}`)).join("") : `<div class="empty">No unconverted checkouts in the last 14 days.</div>`;
    const C = S.contacts;
    const steps = [["Contacts", C.length], ["Signed up", C.filter((p) => p.source === "customer").length], ["Started checkout", C.filter((p) => p.checkouts.length).length], ["Converted", C.filter((p) => p.status === "converted").length]];
    const max = Math.max(1, steps[0][1]);
    $("funnel").innerHTML = steps.map(([l, n]) => `<div class="frow"><span class="lab">${l}</span><span class="bar"><i style="width:${Math.max(1, (n / max) * 100)}%"></i></span><span class="n num">${n}</span></div>`).join("");
    const due = allFollowups().filter((f) => !f.done && t(f.due_at) < endOfToday() + 2 * DAY).slice(0, 6);
    $("dueList").innerHTML = due.length ? due.map(fuRow).join("") : `<div class="empty">Nothing due in the next 2 days.</div>`;
    const fresh = C.filter((p) => p.fresh).sort((a, b) => t(b.createdAt) - t(a.createdAt));
    $("freshList").innerHTML = fresh.length ? fresh.map((p) => li(p, `Joined ${fmtDT(p.createdAt)}${p.city ? " · " + esc(p.city) : ""}`)).join("") : `<div class="empty">No new sign-ups this week.</div>`;
    const logins = C.filter((p) => p.lastLogin).sort((a, b) => t(b.lastLogin) - t(a.lastLogin)).slice(0, 8);
    $("loginList").innerHTML = logins.length ? logins.map((p) => li(p, `Logged in ${ago(p.lastLogin)} · ${p.logins.length} login${p.logins.length === 1 ? "" : "s"} in 120 days`)).join("") : `<div class="empty">Logins appear here once the store's login tracking is live.</div>`;
  }

  function cartWho(ev) {
    const p = ev.customer_id ? byKey("c" + ev.customer_id) : null;
    if (p) return { p, name: p.name, tag: p.fresh ? "New customer" : "Returning customer" };
    const m = ev.meta || {};
    const id = ev.customer_id ? "Customer " + ev.customer_id.slice(-4) : "Guest " + String(ev.visitor || "").slice(-4).toUpperCase();
    return { p: null, name: m.nm || m.em || m.ph || id, tag: ev.customer_id ? "New customer" : "Guest · not logged in" };
  }
  function cartLine(ev) {
    const m = ev.meta || {}, w = cartWho(ev);
    const what = ev.kind === "checkout"
      ? `Started checkout${m.n ? " · " + m.n + " item" + (m.n === 1 ? "" : "s") : ""}${m.t ? " · " + esc(m.t) : ""}${m.tot ? " · " + inr(m.tot) : ""}`
      : `Added ${esc(m.t || "a product")}${m.vt && m.vt !== "Default Title" ? " (" + esc(m.vt) + ")" : ""}${m.q > 1 ? " ×" + m.q : ""}${m.a ? " · " + inr(m.a * (m.q || 1)) : ""}`;
    const contact = !w.p && (m.ph || m.em) ? ` · ${esc(m.ph || m.em)}` : "";
    const head = `<b>${esc(w.name)} <span class="chip ${w.tag.startsWith("Guest") ? "c-signup" : w.tag.startsWith("New") ? "c-checkout" : "c-converted"}">${esc(w.tag)}</span></b>`;
    const sub = `<small>${what}${contact} · ${ago(ev.created_at)} · ${esc(ev.device || "")}</small>`;
    return w.p ? `<div class="li"><div class="who" data-open="${w.p.key}" style="cursor:pointer">${head}${sub}</div>${actions(w.p)}</div>` : `<div class="li"><div class="who">${head}${sub}</div></div>`;
  }
  function renderCarts() {
    const evs = S.raw.events.filter((e) => (e.kind === "cart" || e.kind === "checkout") && now() - t(e.created_at) < 2 * DAY);
    const people = new Set(evs.map((e) => e.customer_id || e.visitor)).size;
    $("cartCount").textContent = evs.length ? `${evs.filter((e) => e.kind === "cart").length} add-to-cart · ${people} people · last 48 h` : "Last 48 h";
    $("cartList").innerHTML = evs.length ? evs.slice(0, 25).map(cartLine).join("") : `<div class="empty">Add-to-cart activity appears here the moment someone adds a wheelchair to their cart.</div>`;
  }

  const C_FILTERS = [["all", "All"], ["fresh", "Fresh sign-ups"], ["loggedin", "Logged in (7 d)"], ["checkout", "In checkout"], ["notconverted", "Not converted"], ["pending", "Pending"], ["converted", "Converted"], ["signup", "Signed up only"], ["mine", "Mine"], ["followup", "Has follow-up"]];
  function filterContacts(f, q) {
    q = q.trim().toLowerCase();
    return S.contacts.filter((p) => {
      if (f === "fresh" && !p.fresh) return false;
      if (f === "loggedin" && !(p.lastLogin && now() - t(p.lastLogin) < 7 * DAY)) return false;
      if (f === "followup" && !p.nextFU) return false;
      if (f === "mine" && p.owner !== S.me.email.toLowerCase()) return false;
      if (["checkout", "notconverted", "pending", "converted", "signup"].includes(f) && p.status !== f) return false;
      if (q && ![p.name, p.email, p.phone, p.city, p.cart].join(" ").toLowerCase().includes(q)) return false;
      return true;
    });
  }
  function renderContacts() {
    $("cFilters").querySelectorAll(".fchip").forEach((b) => b.remove());
    $("cFilters").insertAdjacentHTML("beforeend", C_FILTERS.map(([v, l]) => `<button class="fchip" type="button" data-cf="${v}" aria-pressed="${S.cFilter === v}">${l} <span class="num">${filterContacts(v, "").length}</span></button>`).join(""));
    const rows = filterContacts(S.cFilter, S.search);
    $("cBody").innerHTML = rows.length ? rows.slice(0, 500).map((p) => `<tr data-open="${p.key}">
      <td><b>${esc(p.name)}</b><span class="sub">${esc(p.phone || p.email || "No contact details")}${p.city ? " · " + esc(p.city) : ""}</span></td>
      <td>${chip(p)}${p.fresh ? ' <span class="chip c-checkout c-new"></span>' : ""}</td>
      <td><span class="stage">${STAGE_NAME[p.stage]}</span></td>
      <td class="d">${p.source === "customer" ? fmtDate(p.createdAt) : '<span class="sub">Guest</span>'}</td>
      <td class="d">${p.lastLogin ? ago(p.lastLogin) : '<span class="sub">—</span>'}</td>
      <td class="d">${p.lastCheckout ? ago(p.lastCheckout) : "—"}</td>
      <td class="d num">${p.value ? inr(p.value) : "—"}</td>
      <td class="d">${p.owner ? esc(memberName(p.owner)) : '<span class="sub">—</span>'}</td>
      <td class="d">${p.nextFU ? `<span class="${t(p.nextFU.due_at) < now() ? "chip c-notconverted" : ""}">${esc(p.nextFU.kind)} · ${fmtDT(p.nextFU.due_at)}</span>` : "—"}</td></tr>`).join("") : `<tr><td colspan="9" class="empty">No contacts match.</td></tr>`;
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
    const rows = S.raw.checkouts.filter((k) => S.kFilter === "all" || (S.kFilter === "fresh" && now() - t(k.created_at) < 2 * DAY) || (S.kFilter === "open" && !k.completed_at) || (S.kFilter === "done" && k.completed_at));
    $("kBody").innerHTML = rows.length ? rows.slice(0, 500).map((k) => {
      const key = k.customer_id ? "c" + k.customer_id : "g" + k.id, p = byKey(key);
      const res = k.completed_at ? '<span class="chip c-converted">Completed</span>' : (now() - t(k.created_at) < DAY ? '<span class="chip c-checkout">In progress</span>' : '<span class="chip c-notconverted">Abandoned</span>');
      return `<tr data-open="${key}"><td class="d">${fmtDT(k.created_at)}<span class="sub">${ago(k.created_at)}</span></td>
        <td><b>${esc(p?.name || k.name || "Guest")}</b><span class="sub">${esc(p?.phone || k.phone || p?.email || "")}</span></td>
        <td>${esc(k.items)}</td><td class="d num">${inr(k.total)}</td><td>${res}</td>
        <td>${!k.completed_at && k.recover_url ? `<button class="btn small" type="button" data-copy="${esc(k.recover_url)}" data-label="Checkout link">Copy link</button>` : ""}</td></tr>`;
    }).join("") : `<tr><td colspan="6" class="empty">No checkouts here.</td></tr>`;
  }
  function renderOrders() {
    const od = S.raw.orders;
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
    const rows = allFollowups().filter((f) => S.sFilter === "done" ? f.done : !f.done && (S.sFilter === "upcoming" || (S.sFilter === "mine" && f.assignee_email === me) || (S.sFilter === "overdue" && t(f.due_at) < now()) || (S.sFilter === "today" && t(f.due_at) >= sod.getTime() && t(f.due_at) <= endOfToday())));
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
    $("ctCheckouts").textContent = S.raw.checkouts.filter((k) => !k.completed_at).length;
    $("ctOrders").textContent = S.raw.orders.length;
    $("ctSchedule").textContent = S.raw.followups.filter((f) => !f.done).length;
  }
  function render() {
    if (!S.loaded) return;
    renderCounts();
    ({ overview: renderOverview, contacts: renderContacts, pipeline: renderPipeline, checkouts: renderCheckouts, orders: renderOrders, schedule: renderSchedule, team: renderTeam })[S.view]?.();
    if (S.open) renderDrawer();
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
    for (const k of p.checkouts) ev.push({ at: k.created_at, cls: k.completed_at ? "e-order" : "e-ab", title: (k.completed_at ? "Checkout completed" : "Checkout not completed") + " · " + inr(k.total), sub: k.items });
    for (const o of p.orders) ev.push({ at: o.created_at, cls: "e-order", title: `Order ${o.name} · ${inr(o.total)}`, sub: `${(PAY[o.financial] || [0, o.financial])[1]}${o.cancelled_at ? " · Cancelled" : ""}` });
    for (const n of p.notes) ev.push({ at: n.created_at, cls: "e-note", title: "Note by " + memberName(n.author_email), text: n.body });
    ev.sort((a, b) => t(b.at) - t(a.at));
    const ro = !canWrite();
    const tomorrow = new Date(now() + DAY).toISOString().slice(0, 10);
    $("drawerRoot").innerHTML = `<div class="scrim" data-close></div>
    <aside class="drawer" role="dialog" aria-modal="true" aria-label="${esc(p.name)}">
      <div class="dh">
        <div class="row"><h2>${esc(p.name)}</h2><button class="btn small" type="button" data-close>Close</button></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">${chip(p)}${p.fresh ? '<span class="chip c-checkout">Fresh sign-up</span>' : ""}${p.lastLogin && now() - t(p.lastLogin) < DAY ? '<span class="chip c-checkout">Logged in today</span>' : ""}</div>
        ${actions(p)}
      </div>
      <div class="db">
        <dl class="kv">
          <dt>Phone</dt><dd>${p.phone ? `<span class="copyable">${esc(p.phone)}</span>` : "—"}</dd>
          <dt>Email</dt><dd>${p.email ? `<span class="copyable">${esc(p.email)}</span>` : "—"}</dd>
          <dt>City</dt><dd>${esc(p.city || "—")}</dd>
          <dt>Signed up</dt><dd>${p.source === "customer" ? fmtDT(p.createdAt) : "Guest (no account)"}</dd>
          <dt>First login</dt><dd>${p.firstLogin ? fmtDT(p.firstLogin) : "—"}</dd>
          <dt>Last login</dt><dd>${p.lastLogin ? fmtDT(p.lastLogin) + " · " + ago(p.lastLogin) : "—"}</dd>
          <dt>Last seen</dt><dd>${p.lastSeen ? ago(p.lastSeen) : "—"}</dd>
          <dt>First checkout</dt><dd>${fmtDT(p.firstCheckout)}</dd>
          <dt>Last checkout</dt><dd>${fmtDT(p.lastCheckout)}</dd>
          <dt>Interested in</dt><dd>${esc(p.cart || "—")}</dd>
          <dt>Orders</dt><dd class="num">${p.orders.length} · ${inr(p.orders.filter((o) => !o.cancelled_at && o.financial === "PAID").reduce((s, o) => s + Number(o.total), 0))} paid</dd>
        </dl>
        <div class="sec"><h4>Stage and owner</h4>
          <div class="row2" style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
            <select class="inp" id="dStage" aria-label="Stage" ${ro ? "disabled" : ""}>${STAGES.map(([id, l]) => `<option value="${id}" ${p.stage === id ? "selected" : ""}>${l}</option>`).join("")}</select>
            <select class="inp" id="dOwner" aria-label="Owner" ${ro ? "disabled" : ""}>${teamOptions(p.owner)}</select>
          </div>
        </div>
        <div class="sec"><h4>Follow-ups</h4>
          <div class="list">${p.followups.length ? p.followups.map(fuRow).join("") : '<div class="muted">No follow-ups planned.</div>'}</div>
          ${ro ? "" : `<form class="frm" id="dFu" style="margin-top:10px">
            <div class="row2"><input class="inp" type="date" id="dFuDate" required aria-label="Date" value="${tomorrow}"><input class="inp" type="time" id="dFuTime" value="11:00" aria-label="Time"></div>
            <div class="row2"><select class="inp" id="dFuType" aria-label="Type"><option>Call</option><option>WhatsApp</option><option>Demo</option><option>Home visit</option><option>Email</option></select><select class="inp" id="dFuWho" aria-label="Assign to">${teamOptions(p.owner || S.me.email.toLowerCase())}</select></div>
            <input class="inp" id="dFuNote" placeholder="What to do" aria-label="Note">
            <button class="btn" type="submit">Schedule follow-up</button>
          </form>`}
        </div>
        ${ro ? "" : `<div class="sec"><h4>Add a note</h4>
          <form class="frm" id="dNote"><textarea class="inp" id="dNoteText" placeholder="e.g. Wants to try the chair at home first. Weight 95 kg."></textarea><button class="btn" type="submit">Save note</button></form>
        </div>`}
        <div class="sec"><h4>Timeline</h4><div class="tl">${ev.map((e) => `<div class="ev ${e.cls}"><b>${esc(e.title)}</b><small>${fmtDT(e.at)}${e.sub ? " · " + esc(e.sub) : ""}</small>${e.text ? `<p>${esc(e.text)}</p>` : ""}</div>`).join("")}</div></div>
      </div>
    </aside>`;
  }
  const openDrawer = (k) => { S.open = k; renderDrawer(); };
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

  /* ---------- Events ---------- */
  document.addEventListener("click", async (e) => {
    const el = e.target.closest("[data-copy],[data-open],[data-close],[data-go],[data-cf],[data-kf],[data-sf],.tab,#refreshBtn,#bannerRetry,[data-reset],[data-remove],[data-restore],[data-modal-close]");
    if (!el) return;
    if (el.matches("[data-copy]")) { e.stopPropagation(); copy(el.dataset.copy, el.dataset.label); return; }
    if (el.matches("[data-modal-close]")) { $("modalRoot").innerHTML = ""; return; }
    if (el.matches("[data-close]")) { closeDrawer(); return; }
    if (el.matches(".tab")) { setView(el.dataset.v); return; }
    if (el.id === "refreshBtn" || el.id === "bannerRetry") { runSync(); return; }
    if (el.matches("[data-go]")) { const [v, f] = el.dataset.go.split(":"); if (f) S.cFilter = f; setView(v); return; }
    if (el.matches("[data-cf]")) { S.cFilter = el.dataset.cf; render(); return; }
    if (el.matches("[data-kf]")) { S.kFilter = el.dataset.kf; render(); return; }
    if (el.matches("[data-sf]")) { S.sFilter = el.dataset.sf; render(); return; }
    if (el.matches("[data-reset]")) { const r = await team("reset", { email: el.dataset.reset }); if (r) showPassword(r.email, r.password, "New password ready"); return; }
    if (el.matches("[data-remove]")) { if (el.dataset.confirm !== "1") { el.dataset.confirm = "1"; el.textContent = "Click again to remove"; return; } if (await team("remove", { email: el.dataset.remove })) toast("Removed. They can no longer sign in."); return; }
    if (el.matches("[data-restore]")) { if (await team("restore", { email: el.dataset.restore })) toast("Access restored"); return; }
    if (el.matches("[data-open]")) { if (e.target.closest("a,button:not(.card),input,select")) return; openDrawer(el.dataset.open); }
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
      .on("postgres_changes", { event: "*", schema: "public", table: "crm_sync_log" }, (p) => { if (p.new?.finished_at && p.new?.ok) loadAll(); else reload("sync"); })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "store_events" }, (p) => {
        S.raw.events.unshift(p.new); S.contacts = build(); render();
        if (p.new?.kind === "cart" || p.new?.kind === "checkout") {
          const w = cartWho(p.new), m = p.new.meta || {};
          notify(p.new.kind === "cart" ? "Added to cart" : "Checkout started", `${w.name} (${w.tag}) ${p.new.kind === "cart" ? "added " + (m.t || "a product") + (m.a ? " · ₹" + Number(m.a * (m.q || 1)).toLocaleString("en-IN") : "") : "started checkout" + (m.tot ? " · ₹" + Number(m.tot).toLocaleString("en-IN") : "")}`);
        }
        if (p.new?.kind === "login") {
          const c = S.raw.customers.find((x) => x.id === p.new.customer_id);
          notify("Customer logged in", `${c ? (c.name || c.email || c.phone) : "A new customer"} just logged in on the store (${p.new.device || "web"})`);
        }
      })
      .subscribe();
    poll = setInterval(() => { if (!document.hidden) { syncStatus(); render(); } }, 60_000);
  }
  function stopLive() { if (channel) sb.removeChannel(channel); channel = null; clearInterval(poll); }
})();
