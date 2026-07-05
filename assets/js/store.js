/* ===== Yetkaz.uz — UMUMIY MA'LUMOT BAZASI (Backend API + offline kesh) =====
   Tashqi interfeys eski versiya bilan BIR XIL: o'qish metodlari sinxron
   (keshdan o'qiydi), yozish metodlari optimistik (keshni darhol yangilaydi)
   va orqa fonda backend API ga yuboradi.
   Backend ishlamasa — localStorage keshida eski holatda ishlayveradi. */
const STORE = (function () {
  /* ---- localStorage kalitlari (offline kesh / fallback) ---- */
  const K = {
    orders: "yz_orders",
    reviews: "yz_reviews",
    ovr: "yz_dish_ovr",
    ann: "yetkaz_announcements",
    rests: "yz_restaurants",
    sess: "yz_session",
    token: "yz_token",
    otok: "yz_order_tokens",   // buyurtma "track token"lari (id -> token), mehmon tasdig'i uchun
  };

  /* ---- API manzili: backend bilan bir xil origin bo'lsa nisbiy '/api' ---- */
  const OFFLINE = (typeof location !== "undefined" && location.protocol === "file:");
  const API = "/api";

  function lsRead(k, def) { try { const v = localStorage.getItem(k); return v == null ? def : JSON.parse(v); } catch (e) { return def; } }
  function lsWrite(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }

  /* Buyurtma "track token"lari — polling keshni almashtirsa ham yo'qolmaydi.
     Mehmon (tokensiz) mijoz shu token bilan buyurtmasini tasdiqlaydi/bekor qiladi. */
  function saveOrderToken(id, tok) { if (!id || !tok) return; try { const m = lsRead("yz_order_tokens", {}) || {}; m[String(id)] = tok; lsWrite("yz_order_tokens", m); } catch (e) {} }
  function readOrderToken(id) { try { const m = lsRead("yz_order_tokens", {}) || {}; return m[String(id)] || ""; } catch (e) { return ""; } }

  /* ---- Xotira keshi (sinxron o'qish shu yerdan) ---- */
  const cache = {
    orders: lsRead(K.orders, []),
    reviews: lsRead(K.reviews, []),
    overrides: lsRead(K.ovr, { added: [], removed: [], discounts: {} }),
    announcements: lsRead(K.ann, []),
    restaurants: lsRead(K.rests, []),
    couriers: [],
  };
  if (!cache.overrides || typeof cache.overrides !== "object") cache.overrides = { added: [], removed: [], discounts: {}, soldout: [] };
  cache.overrides.added = cache.overrides.added || [];
  cache.overrides.removed = cache.overrides.removed || [];
  cache.overrides.discounts = cache.overrides.discounts || {};
  cache.overrides.soldout = cache.overrides.soldout || [];

  /* ---- onChange tinglovchilari (panellar qayta render qilishi uchun) ---- */
  const listeners = [];
  let firing = false;
  function fire() {
    if (firing) return;
    firing = true;
    try { listeners.forEach(cb => { try { cb(); } catch (e) {} }); } finally { firing = false; }
  }

  /* ---- Token / sessiya ---- */
  function getToken() { return lsRead(K.token, null); }
  function setToken(t) { if (t) lsWrite(K.token, t); else try { localStorage.removeItem(K.token); } catch (e) {} }

  /* ---- API yordamchisi ---- */
  let inflight = 0;
  async function api(path, { method = "GET", body, auth = false } = {}) {
    if (OFFLINE) throw new Error("offline");
    const headers = {};
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (auth) { const t = getToken(); if (t) headers["Authorization"] = "Bearer " + t; }
    const res = await fetch(API + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
    let data = null; try { data = await res.json(); } catch (e) {}
    if (!res.ok) { const err = new Error((data && data.error) || ("HTTP " + res.status)); err.status = res.status; err.data = data; throw err; }
    return data;
  }
  /* Yozish so'rovlari — xatoni yutadi (optimistik kesh allaqachon yangilangan) */
  function send(path, opts) {
    inflight++;
    return api(path, Object.assign({ auth: true }, opts))
      .catch(e => { console.warn("[STORE] sync xato:", path, e.message); return null; })
      .finally(() => { inflight = Math.max(0, inflight - 1); });
  }

  /* ---- Backenddan yangilash (kesh o'zgargandagina fire) ---- */
  function applyIfChanged(keyName, lsKey, value) {
    if (JSON.stringify(cache[keyName]) === JSON.stringify(value)) return false;
    cache[keyName] = value; lsWrite(lsKey, value); return true;
  }

  async function refreshPublic() {
    if (inflight > 0) return;
    try {
      const b = await api("/bootstrap");
      let changed = false;
      changed = applyIfChanged("reviews", K.reviews, b.reviews || []) || changed;
      changed = applyIfChanged("announcements", K.ann, b.announcements || []) || changed;
      changed = applyIfChanged("restaurants", K.rests, b.restaurants || []) || changed;
      const ovr = b.overrides || { added: [], removed: [], discounts: {} };
      changed = applyIfChanged("overrides", K.ovr, ovr) || changed;
      if (changed) fire();
      try { window.YZ_LOADER && window.YZ_LOADER.online(); } catch (e) {}   // ulanish bor — loaderni yashir
    } catch (e) {
      try { window.YZ_LOADER && window.YZ_LOADER.offline(); } catch (e2) {} // ulanish yo'q — pitsa loader
    }
  }

  async function refreshOrders() {
    if (inflight > 0 || !getToken()) return;
    try {
      const list = await api("/orders", { auth: true });
      if (applyIfChanged("orders", K.orders, list || [])) fire();
    } catch (e) { /* offline yoki ruxsat yo'q */ }
  }

  /* Mehmon (tokensiz) o'z buyurtmalari holatini id bo'yicha kuzatadi */
  async function refreshGuestOrders() {
    if (inflight > 0 || getToken()) return;
    const ids = cache.orders.map(o => o.id).filter(id => /^\d+$/.test(String(id)));
    if (!ids.length) return;
    let changed = false;
    for (const id of ids) {
      try {
        const r = await api("/orders/" + id);
        const o = cache.orders.find(x => String(x.id) === String(id));
        if (o && r && o.status !== r.status) { o.status = r.status; changed = true; }
        if (o && r && r.reason && o.reason !== r.reason) { o.reason = r.reason; changed = true; }
      } catch (e) {}
    }
    if (changed) { lsWrite(K.orders, cache.orders); fire(); }
  }

  async function refreshAll() { await refreshPublic(); if (getToken()) await refreshOrders(); else await refreshGuestOrders(); }

  /* ---- Boshlang'ich hydration + realtime polling ---- */
  const ready = OFFLINE ? Promise.resolve() : refreshAll();
  if (!OFFLINE) {
    setInterval(refreshAll, 5000);
    try { window.addEventListener("focus", refreshAll); } catch (e) {}
  }

  /* ---- restoran -> kuryer biriktirilishi ----
     Kuryer BACKEND tomonidan avtomatik biriktiriladi (eng bo'sh faol kuryer).
     Bu yerda soxta ism qaytarmaymiz — faol kuryer bo'lmasa bo'sh qoladi. */
  function courierForRest(_r) { return ""; }

  const key = (rest, name) => rest + "|" + name;

  return {
    /* boshlang'ich yuklash tugashini kutish uchun (ixtiyoriy) */
    ready: () => ready,
    refresh: refreshAll,
    isOffline: () => OFFLINE,

    /* ---- ORDERS ---- */
    orders: () => cache.orders,
    ordersFor: (rest) => cache.orders.filter(o => o.rest === rest),
    ordersForCourier: (name) => cache.orders.filter(o => o.courier === name),
    ordersForUser: (name) => cache.orders.filter(o => o.user === name),
    addOrder(o) {
      const tempId = o.id || ("tmp_" + Date.now());
      const order = Object.assign({}, o, { id: tempId, status: o.status || "new" });
      cache.orders.unshift(order); lsWrite(K.orders, cache.orders); fire();
      send("/orders", { method: "POST", body: o }).then(saved => {
        if (saved && saved.id) {
          Object.assign(order, saved); lsWrite(K.orders, cache.orders);
          saveOrderToken(saved.id, saved.token);   // token'ni alohida saqlaymiz (polling keshni almashtiradi)
          fire();
        }
      });
      return order;
    },
    updateOrder(id, patch) {
      const o = cache.orders.find(x => x.id == id);
      if (o) { Object.assign(o, patch); lsWrite(K.orders, cache.orders); fire(); }
      send("/orders/" + id, { method: "PATCH", body: patch });
      return o;
    },
    courierForRest,

    /* ---- REVIEWS ---- */
    reviews: () => cache.reviews,
    addReview(r, orderToken) {
      const rev = Object.assign({ ava: "👤", flagged: false }, r, { date: r.date || new Date().toLocaleDateString("ru-RU") });
      cache.reviews.unshift(rev); lsWrite(K.reviews, cache.reviews); fire();
      /* Mehmon (tokensiz) mijoz uchun — order token bilan yuboriladi (kesh toza qoladi) */
      const body = orderToken ? Object.assign({}, rev, { orderToken }) : rev;
      send("/reviews", { method: "POST", body });
    },

    /* ---- DISH OVERRIDES ---- */
    overrides: () => cache.overrides,
    addDish(d) {
      cache.overrides.added.push(d); lsWrite(K.ovr, cache.overrides); fire();
      send("/dishes", { method: "POST", body: d });
    },
    removeDish(rest, name) {
      cache.overrides.removed.push(key(rest, name));
      cache.overrides.added = (cache.overrides.added || []).filter(d => !(d.rest === rest && d.name === name));
      lsWrite(K.ovr, cache.overrides); fire();
      send("/dishes", { method: "DELETE", body: { rest, name } });
    },
    setDiscount(rest, name, pct) {
      if (pct > 0) cache.overrides.discounts[key(rest, name)] = pct;
      else delete cache.overrides.discounts[key(rest, name)];
      lsWrite(K.ovr, cache.overrides); fire();
      send("/discounts", { method: "POST", body: { rest, name, pct } });
    },
    mergeDishes(base) {
      const o = cache.overrides; const removed = new Set(o.removed || []); const soldout = new Set(o.soldout || []);
      let list = base.filter(d => !removed.has(key(d.rest, d.name))).concat(o.added || []);
      return list.map(d => { const k = key(d.rest, d.name); const pct = (o.discounts || {})[k] || 0;
        return Object.assign({}, d, { discount: pct, eff: pct ? Math.round(d.price * (1 - pct / 100)) : d.price, soldout: soldout.has(k) }); });
    },
    setSoldout(rest, name, val) {
      cache.overrides.soldout = cache.overrides.soldout || [];
      const k = key(rest, name);
      if (val) { if (!cache.overrides.soldout.includes(k)) cache.overrides.soldout.push(k); }
      else cache.overrides.soldout = cache.overrides.soldout.filter(x => x !== k);
      lsWrite(K.ovr, cache.overrides); fire();
      send("/soldout", { method: "POST", body: { rest, name, soldout: !!val } });
    },

    /* ---- RESTAURANTS / COURIERS (admin CRUD) ---- */
    restaurants: () => cache.restaurants,
    couriers: () => cache.couriers,
    fetchCouriers() { return api("/couriers", { auth: true }).then(list => { cache.couriers = list || []; fire(); return cache.couriers; }).catch(() => cache.couriers); },
    addRestaurant(data) { return send("/restaurants", { method: "POST", body: data }).then(r => { refreshPublic(); return r; }); },
    deleteRestaurant(login) { return send("/restaurants", { method: "DELETE", body: { login } }).then(r => { refreshPublic(); return r; }); },
    addCourier(data) { return send("/couriers", { method: "POST", body: data }); },
    deleteCourier(login) { return send("/couriers", { method: "DELETE", body: { login } }); },
    editRestaurant(data) { return send("/restaurants", { method: "PATCH", body: data }).then(r => { refreshPublic(); return r; }); },
    /* Restoran egasi o'z rasmini saqlaydi */
    setRestaurantPhoto(photo) { return send("/restaurants/photo", { method: "POST", body: { photo } }).then(r => { refreshPublic(); return r; }); },
    /* Restoran egasi o'z ommaviy ma'lumotini saqlaydi (tavsif/manzil/ish vaqti/hudud) */
    updateRestaurantInfo(data) { return api("/restaurants/me", { method: "PATCH", body: data, auth: true }).then(r => { refreshPublic(); return r; }).catch(e => ({ error: (e.data && e.data.error) || e.message || "Xatolik" })); },
    editCourier(data) { return send("/couriers", { method: "PATCH", body: data }); },
    /* ---- KURYER O'ZI: ish vaqti, ishdan javob (leave), ishga qaytish ---- */
    updateCourierInfo(data) { return api("/couriers/me", { method: "PATCH", body: data, auth: true }).then(r => { refreshAll(); return r; }).catch(e => ({ error: (e.data && e.data.error) || e.message || "Xatolik" })); },
    fetchCourierMe() { return api("/couriers/me", { auth: true }).catch(() => null); },
    courierLeave(reason) { return api("/couriers/leave", { method: "POST", body: { reason }, auth: true }).then(r => { refreshAll(); return r; }).catch(e => ({ error: (e.data && e.data.error) || e.message || "Xatolik" })); },
    courierReturn() { return api("/couriers/return", { method: "POST", auth: true }).then(r => { refreshAll(); return r; }).catch(e => ({ error: (e.data && e.data.error) || e.message || "Xatolik" })); },
    /* Restoran/admin/kuryer uchun minimal kuryer holati ro'yxati */
    fetchCourierStatus() { return api("/couriers/status", { auth: true }).catch(() => []); },
    fetchUsers() { return api("/users", { auth: true }).catch(() => []); },

    /* Mijoz "qabul qildim" — arrived -> done (ochiq). Token keshda bo'lmasa saqlanganidan olamiz. */
    confirmReceived(id) {
      const o = cache.orders.find(x => String(x.id) === String(id));
      if (o) { o.status = "done"; lsWrite(K.orders, cache.orders); fire(); }
      const tok = (o && o.token) || readOrderToken(id);
      return api("/orders/" + id + "/received", { method: "POST", body: { token: tok } }).catch(() => null);
    },
    /* Mijoz buyurtmani bekor qiladi — new/ontheway -> cancelled (ochiq) */
    cancelOrder(id) {
      const o = cache.orders.find(x => String(x.id) === String(id));
      if (o) { o.status = "cancelled"; lsWrite(K.orders, cache.orders); fire(); }
      const tok = (o && o.token) || readOrderToken(id);
      return api("/orders/" + id + "/cancel", { method: "POST", body: { token: tok } }).catch(() => null);
    },

    /* ---- RASM YUKLASH (base64 -> server, qisqa URL qaytaradi) ---- */
    async uploadImage(dataUrl) {
      try { const r = await api("/upload", { method: "POST", body: { dataUrl }, auth: true }); return (r && r.url) || ""; }
      catch (e) { return ""; }
    },

    /* ---- ANNOUNCEMENTS ---- */
    announcements: () => cache.announcements,
    addAnnouncement(a) {
      cache.announcements.unshift(a); cache.announcements = cache.announcements.slice(0, 20);
      lsWrite(K.ann, cache.announcements); fire();
      send("/announcements", { method: "POST", body: a });
    },
    deleteAnnouncement(filter) {
      cache.announcements = cache.announcements.filter(a => !(a.text === filter.text && (!filter.rest || a.rest === filter.rest)));
      lsWrite(K.ann, cache.announcements); fire();
      send("/announcements", { method: "DELETE", body: filter });
    },

    /* ---- AUTH (async — backend tekshiradi) ---- */
    async login(login, pass) {
      try {
        const r = await api("/auth/login", { method: "POST", body: { login, pass } });
        if (r && r.token) { setToken(r.token); this.setSession(r.account); refreshOrders(); return r.account; }
        return null;                       // server javob berdi, lekin token yo'q
      } catch (e) {
        if (e && e.status) return null;     // HTTP xato (401) -> login/parol noto'g'ri
        try { window.YZ_LOADER && window.YZ_LOADER.offline(); } catch (_) {}
        return { offline: true };           // serverga/internetga ulanib bo'lmadi
      }
    },
    async updateProfile(data) {
      try {
        const r = await api("/auth/me", { method: "PATCH", body: data, auth: true });
        if (r && r.token) { setToken(r.token); this.setSession(r.account); return r.account; }
        return r || { error: "Xatolik" };
      } catch (e) { return { error: (e.data && e.data.error) || e.message || "Xatolik" }; }
    },
    async register(u) {
      try {
        const r = await api("/auth/register", { method: "POST", body: u });
        if (r && r.token) { setToken(r.token); this.setSession(r.account); refreshOrders(); return r.account; }
        return { error: (r && r.error) || "Xatolik" };
      } catch (e) { return { error: e.message || "Xatolik" }; }
    },
    /* Eski sinxron API — endi backend orqali tekshiriladi, shuning uchun null */
    findAccount() { return null; },
    userExists() { return false; },

    session() { return lsRead(K.sess, null); },
    setSession(s) { lsWrite(K.sess, s); },
    clearSession() { try { localStorage.removeItem(K.sess); } catch (e) {} setToken(null); },

    onChange(cb) {
      if (typeof cb === "function") listeners.push(cb);
      try { window.addEventListener("storage", cb); } catch (e) {}
    },
    _reset() { [K.orders, K.reviews, K.ovr, K.ann, K.rests].forEach(k => { try { localStorage.removeItem(k); } catch (e) {} }); refreshAll(); },
  };
})();

try { if (typeof window !== "undefined") window.STORE = STORE; } catch (e) {}
try { if (typeof globalThis !== "undefined") globalThis.STORE = STORE; } catch (e) {}

/* ===== Telefon raqami yordamchilari (barcha sahifalarda global) =====
   Faqat rasmiy O'zbekiston mobil raqamlari: +998 va operator kodi. */
(function () {
  var OPS = ['20', '33', '50', '55', '77', '88', '90', '91', '93', '94', '95', '97', '98', '99'];
  function digits(p) { return String(p == null ? "" : p).replace(/\D/g, ""); }
  function normUz(p) {
    var d = digits(p);
    if (d.indexOf("998") === 0) d = d.slice(3); // +998... dan operator+raqam
    if (d.length > 9) d = d.slice(-9);
    return d;                                    // 9 ta raqam
  }
  function valid(p) {
    var d = normUz(p);
    return /^\d{9}$/.test(d) && OPS.indexOf(d.slice(0, 2)) >= 0;
  }
  function pretty(p) {
    var d = normUz(p);
    if (!/^\d{9}$/.test(d)) return String(p || "");
    return "+998 " + d.slice(0, 2) + " " + d.slice(2, 5) + " " + d.slice(5, 7) + " " + d.slice(7, 9);
  }
  /* Inputga ulanadi: harf yoza olmaydi, avtomatik +998 XX XXX XX XX formatlaydi */
  function attach(el) {
    if (!el || el.__yzPhone) return; el.__yzPhone = true;
    if (!el.value || digits(el.value).length === 0) el.value = "+998 ";
    el.addEventListener("input", function () {
      var d = normUz(el.value);
      var parts = ["+998"];
      if (d.length > 0) parts.push(d.slice(0, 2));
      if (d.length > 2) parts.push(d.slice(2, 5));
      if (d.length > 5) parts.push(d.slice(5, 7));
      if (d.length > 7) parts.push(d.slice(7, 9));
      el.value = parts.join(" ");
    });
    el.addEventListener("focus", function () { if (digits(el.value).length === 0) el.value = "+998 "; });
  }
  try { window.YZ_PHONE = { valid: valid, pretty: pretty, norm: normUz, attach: attach, OPS: OPS }; } catch (e) {}
  try { window.YZ_EMAIL = { valid: function (e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e == null ? "" : e).trim()); } }; } catch (e) {}
})();

/* ===== YETKAZ LOADING OVERLAY (Lottie kuryer + pitsa zaxira) =====
   Server/internet ishlamasa yoki yuklanayotganda — kuryer animatsiyasi ko'rsatiladi.
   Lottie (assets/js/lottie.min.js + courier-anim.js) bo'lmasa, pitsa loader ishlaydi. */
(function () {
  var OFF = (typeof location !== "undefined" && location.protocol === "file:");
  var el = null, failCount = 0, initialDone = false, bootTimer = null, anim = null;

  function injectCss() {
    if (document.getElementById("yzLoaderCss")) return;
    var st = document.createElement("style"); st.id = "yzLoaderCss";
    st.textContent =
      ".yz-loader{position:fixed;inset:0;z-index:99999;display:none;align-items:center;justify-content:center;" +
        "background:rgba(255,251,245,.96);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px)}" +
      ".yz-loader.on{display:flex}" +
      ".yz-loader-box{text-align:center;padding:20px}" +
      ".yz-anim{width:230px;height:184px;margin:0 auto}" +
      ".yz-pizza{width:150px;height:150px;filter:drop-shadow(0 8px 16px rgba(0,0,0,.16))}" +
      ".yz-crust1{fill:#E6A23C}.yz-crust2{fill:#E7AA5C}.yz-base{fill:#E4B43C}" +
      ".yz-wedge{fill:#F7CD5E;stroke:#D89A36;stroke-width:.5}" +
      ".yz-pep{fill:#B5311B;stroke:#7E1F0E;stroke-width:.4}.yz-cheese{fill:#FFE7A0}.yz-herb{fill:#2E8E45}" +
      ".yz-w{transform-box:view-box;transform-origin:50px 50px;animation:yzLift 2.8s ease-in-out infinite}" +
      ".yz-loader-text{margin-top:14px;font-weight:800;color:#C8102E;font-size:18px}" +
      ".yz-loader-sub{margin-top:6px;color:#9a8d83;font-size:13px;max-width:280px;line-height:1.4}" +
      "@keyframes yzLift{0%{transform:translate(0,0) scale(1)}7%{transform:translate(calc(var(--dx)*1px),calc(var(--dy)*1px)) scale(1.05)}16%{transform:translate(0,0) scale(1)}100%{transform:translate(0,0) scale(1)}}";
    (document.head || document.documentElement).appendChild(st);
  }

  /* Zaxira pitsa SVG (lottie bo'lmasa) */
  function pizzaSVG() {
    var fix = function (n) { return n.toFixed(2); }, sectors = "";
    for (var i = 0; i < 8; i++) {
      var a0 = i * 45 * Math.PI / 180, a1 = (i + 1) * 45 * Math.PI / 180, am = (a0 + a1) / 2;
      var x0 = fix(50 + 40 * Math.cos(a0)), y0 = fix(50 + 40 * Math.sin(a0));
      var x1 = fix(50 + 40 * Math.cos(a1)), y1 = fix(50 + 40 * Math.sin(a1));
      var dx = fix(5 * Math.cos(am)), dy = fix(5 * Math.sin(am)), dly = (i * 0.35).toFixed(2) + "s";
      var pt = function (off, r) { var a = am + off * Math.PI / 180; return [fix(50 + r * Math.cos(a)), fix(50 + r * Math.sin(a))]; };
      var p1 = pt(-9, 28), p2 = pt(11, 18), ch = pt(7, 33), h1 = pt(-12, 21), h2 = pt(13, 30);
      sectors +=
        '<g class="yz-w" style="--dx:' + dx + ';--dy:' + dy + ';animation-delay:' + dly + '">' +
          '<path class="yz-wedge" d="M50,50 L' + x0 + ',' + y0 + ' A40,40 0 0,1 ' + x1 + ',' + y1 + ' Z"/>' +
          '<circle class="yz-pep" cx="' + p1[0] + '" cy="' + p1[1] + '" r="3.4"/>' +
          '<circle class="yz-pep" cx="' + p2[0] + '" cy="' + p2[1] + '" r="2.6"/>' +
          '<circle class="yz-cheese" cx="' + ch[0] + '" cy="' + ch[1] + '" r="2"/>' +
          '<ellipse class="yz-herb" cx="' + h1[0] + '" cy="' + h1[1] + '" rx="1.5" ry="2.4"/>' +
          '<ellipse class="yz-herb" cx="' + h2[0] + '" cy="' + h2[1] + '" rx="1.3" ry="2"/>' +
        '</g>';
    }
    return '<svg viewBox="0 0 100 100" class="yz-pizza" xmlns="http://www.w3.org/2000/svg">' +
      '<circle cx="50" cy="50" r="47" class="yz-crust1"/><circle cx="50" cy="50" r="44" class="yz-crust2"/>' +
      '<circle cx="50" cy="50" r="40" class="yz-base"/>' + sectors + '</svg>';
  }

  function mountAnim() {
    var box = document.getElementById("yzAnim"); if (!box) return;
    if (anim) { try { anim.play(); } catch (e) {} return; }
    if (window.lottie && window.YZ_COURIER) {
      try {
        anim = window.lottie.loadAnimation({ container: box, renderer: "svg", loop: true, autoplay: true, animationData: window.YZ_COURIER });
        return;
      } catch (e) { anim = null; }
    }
    box.innerHTML = pizzaSVG();   // zaxira
  }
  function pauseAnim() { if (anim) { try { anim.pause(); } catch (e) {} } }

  function build() {
    if (el) return el;
    injectCss();
    el = document.createElement("div"); el.id = "yzLoader"; el.className = "yz-loader";
    el.innerHTML =
      '<div class="yz-loader-box">' +
        '<div id="yzAnim" class="yz-anim"></div>' +
        '<div class="yz-loader-text">Yuklanmoqda…</div>' +
        '<div class="yz-loader-sub" id="yzLoaderSub"></div>' +
        '<div id="yzLoaderBtns" style="display:none;margin-top:16px">' +
          '<button id="yzRetry" style="background:#C8102E;color:#fff;border:none;border-radius:10px;padding:10px 18px;font-weight:700;cursor:pointer">Qayta urinish</button>' +
          '<button id="yzDismiss" style="background:#eee;color:#333;border:none;border-radius:10px;padding:10px 18px;font-weight:600;cursor:pointer;margin-left:8px">Yopish</button>' +
        '</div>' +
      '</div>';
    (document.body || document.documentElement).appendChild(el);
    var rb = el.querySelector("#yzRetry");
    if (rb) rb.onclick = function () { var s = document.getElementById("yzLoaderSub"); if (s) s.textContent = "Qayta urinilmoqda…"; try { window.STORE && STORE.refresh && STORE.refresh(); } catch (e) {} };
    var db = el.querySelector("#yzDismiss");
    if (db) db.onclick = function () { hide(); };
    return el;
  }

  function setBtns(on) { var b = el && el.querySelector("#yzLoaderBtns"); if (b) b.style.display = on ? "block" : "none"; }
  function show(sub, withBtns) { build(); el.classList.add("on"); mountAnim(); var s = document.getElementById("yzLoaderSub"); if (s) s.textContent = sub || ""; setBtns(!!withBtns); }
  function hide() { if (el) el.classList.remove("on"); pauseAnim(); if (bootTimer) { clearTimeout(bootTimer); bootTimer = null; } }

  window.YZ_LOADER = {
    show: show, hide: hide,
    online: function () { failCount = 0; initialDone = true; hide(); },
    offline: function () {
      failCount++;
      if (failCount >= 2 || !initialDone) {
        initialDone = true;
        show("Serverga ulanib bo'lmadi. http://localhost:5050 dan oching va serverni ishga tushiring.", true);
      }
    },
    boot: function () {
      if (OFF) return;
      show("Ma'lumotlar yuklanmoqda…", false);
      bootTimer = setTimeout(function () {
        if (el && el.classList.contains("on")) show("Server javob bermayapti. Serverni tekshiring yoki qayta urinib ko'ring.", true);
      }, 9000);
    }
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { window.YZ_LOADER.boot(); });
  else window.YZ_LOADER.boot();
})();
