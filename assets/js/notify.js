/* ===== Yetkaz — panel bildirishnomasi (restoran / kuryer) =====
   Yangi buyurtma, "tayyor", "mijoz qabul qildi" kabi hodisalarда ovozli
   bildirishnoma beradi. Ovoz — restoran peshtaxtasidagi QO'NG'IROQCHA (ding-ding).
   Sozlamalarда yoqib/o'chirib qo'yish mumkin. Backendni kuzatadi (STORE.onChange). */
(function () {
  var PANELS = {
    "restoran.html": { role: "restoran", label: "Restoran" },
    "kuryer.html":   { role: "kuryer",   label: "Kuryer" },
  };
  var path = (location.pathname.split("/").pop() || "").toLowerCase();
  var P = PANELS[path];
  if (!P) return;
  if (typeof STORE === "undefined") return;

  var LS = "yz_notify_" + P.role;
  function enabled() { try { return localStorage.getItem(LS) !== "off"; } catch (e) { return true; } } // default: yoqilgan
  function setEnabled(on) { try { localStorage.setItem(LS, on ? "on" : "off"); } catch (e) {} }

  /* ---- QO'NG'IROQCHA ovozi (Web Audio, fayl kerak emas) ---- */
  var actx = null, primed = false;
  function prime() {
    if (primed) return; primed = true;
    try { var AC = window.AudioContext || window.webkitAudioContext; if (AC) { actx = new AC(); } } catch (e) {}
  }
  document.addEventListener("click", function () { prime(); if (actx && actx.state === "suspended") actx.resume(); }, { once: false });

  function bell() {
    try {
      if (!actx) prime();
      if (!actx) return;
      if (actx.state === "suspended") actx.resume();
      var t = actx.currentTime;
      function ding(freq, at, vol) {
        var o = actx.createOscillator(), g = actx.createGain();
        o.type = "sine"; o.frequency.value = freq;
        o.connect(g); g.connect(actx.destination);
        g.gain.setValueAtTime(0.0001, t + at);
        g.gain.exponentialRampToValueAtTime(vol, t + at + 0.008);
        g.gain.exponentialRampToValueAtTime(0.0001, t + at + 0.6);
        o.start(t + at); o.stop(t + at + 0.65);
      }
      /* Ikki tomchi "ding-ding" + yuqori harmonik (jarangli qo'ng'iroqcha) */
      ding(1046.5, 0.00, 0.38); ding(1568.0, 0.00, 0.16);
      ding(1046.5, 0.26, 0.34); ding(1568.0, 0.26, 0.14);
    } catch (e) {}
  }

  /* ---- Bildirishnoma ko'rsatish (brauzer notification + sahifa toast + ovoz) ---- */
  function toast(msg) {
    var el = document.getElementById("toast2");
    if (el) { el.textContent = msg; el.classList.add("show"); clearTimeout(toast._t); toast._t = setTimeout(function () { el.classList.remove("show"); }, 3200); }
  }
  function fire(title, body) {
    if (!enabled()) return;
    bell();
    toast(title + (body ? " — " + body : ""));
    try {
      if ("Notification" in window && Notification.permission === "granted") {
        var n = new Notification("🔔 " + title, { body: body || "", tag: "yz-" + Date.now(), icon: "/assets/favicon-64.png" });
        setTimeout(function () { try { n.close(); } catch (e) {} }, 6000);
      }
    } catch (e) {}
  }

  /* ---- Joriy rolga tegishli buyurtmalar ---- */
  function myName() { try { var s = STORE.session(); return (s && s.name) || ""; } catch (e) { return ""; } }
  function relevant() {
    var nm = myName();
    try {
      if (P.role === "restoran") return (STORE.ordersFor ? STORE.ordersFor(nm) : []) || [];
      return (STORE.ordersForCourier ? STORE.ordersForCourier(nm) : []) || [];
    } catch (e) { return []; }
  }

  /* ---- O'zgarishlarni aniqlab, kerakli hodisada bildiramiz ---- */
  var seen = null; // {id: status}  (birinchi yuklashда faqat asos o'rnatiladi)
  function shortItem(o) { return (o.item || "buyurtma"); }
  function check() {
    var list = relevant();
    var cur = {};
    list.forEach(function (o) { cur[o.id] = o.status; });
    if (seen === null) { seen = cur; return; } // baseline — eski buyurtmalarга bildirmaydi

    list.forEach(function (o) {
      var prev = seen[o.id];
      var st = o.status;
      if (prev === undefined) {
        /* Panelга YANGI tushgan buyurtma */
        if (P.role === "restoran" && st === "new") fire("Yangi buyurtma!", shortItem(o) + " · " + (o.user || ""));
        else if (P.role === "kuryer" && st !== "done" && st !== "cancelled") fire("Yangi yetkazish!", shortItem(o) + " · " + (o.addr || ""));
      } else if (prev !== st) {
        /* Holat o'zgardi */
        if (P.role === "kuryer" && st === "ready") fire("Buyurtma tayyor — oling!", shortItem(o));
        if (st === "done") fire("Mijoz qabul qildi ✅", shortItem(o) + (P.role === "kuryer" ? " · haq yozildi" : " · to'lov yozildi"));
        if (st === "cancelled") fire("Buyurtma bekor qilindi", shortItem(o));
      }
    });
    seen = cur;
  }

  /* ---- Sozlamalar kartasi (#view-settings ichiga) ---- */
  function mountSettings() {
    var host = document.getElementById("view-settings");
    if (!host || document.getElementById("notifySettings")) return;
    var card = document.createElement("div");
    card.className = "panel"; card.id = "notifySettings"; card.style.marginBottom = "16px";
    render(card);
    host.insertBefore(card, host.firstChild);
  }
  function render(card) {
    var on = enabled();
    var perm = ("Notification" in window) ? Notification.permission : "unsupported";
    card.innerHTML =
      '<div class="panel-head"><h3>🔔 Bildirishnoma</h3></div>' +
      '<div class="panel-body">' +
        '<p style="color:var(--grey);font-size:13px;margin-bottom:12px">Yangi buyurtma, "tayyor" va "mijoz qabul qildi" hodisalarида <b>qo\'ng\'iroqcha ovozi</b> bilan ogohlantiradi.' +
          (perm === "denied" ? ' <span style="color:#C8102E">(Brauzerда bildirishnomaга ruxsat berilmagan — faqat ovoz+ekran ishlaydi)</span>' : '') + '</p>' +
        '<div style="display:flex;gap:10px;flex-wrap:wrap">' +
          '<button class="set-save" id="ntfToggle" style="background:' + (on ? '#C8102E' : '#16a34a') + '">' + (on ? '🔕 O\'chirish' : '🔔 Yoqish') + '</button>' +
          '<button class="set-save" id="ntfTest" style="background:#6b7280">🔔 Sinab ko\'rish</button>' +
        '</div>' +
        '<div style="margin-top:10px;font-size:13px;color:var(--grey)">Holat: <b style="color:' + (on ? '#16a34a' : '#9ca3af') + '">' + (on ? 'Yoqilgan' : 'O\'chirilgan') + '</b></div>' +
      '</div>';
    var tg = card.querySelector("#ntfToggle");
    if (tg) tg.addEventListener("click", function () {
      var next = !enabled(); setEnabled(next);
      if (next && "Notification" in window && Notification.permission === "default") { Notification.requestPermission().then(function () { render(card); }); }
      if (next) bell();
      render(card);
    });
    var ts = card.querySelector("#ntfTest");
    if (ts) ts.addEventListener("click", function () { prime(); if (actx && actx.state === "suspended") actx.resume(); bell(); toast("Sinov bildirishnomasi 🔔"); });
  }

  /* ---- Ishga tushirish ---- */
  function boot() {
    if (enabled() && "Notification" in window && Notification.permission === "default") {
      /* Ruxsatни birinchi klikда so'raymiz (avtomat so'rash bloklanмаsligi uchun) */
      document.addEventListener("click", function once() { try { Notification.requestPermission(); } catch (e) {} document.removeEventListener("click", once); }, { once: true });
    }
    check();
    if (STORE.onChange) STORE.onChange(check);
    setInterval(check, 4000);
    /* Sozlamалар bo'limi ochilганда kartani joylashtiramiz */
    setInterval(mountSettings, 1200);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { setTimeout(boot, 800); });
  else setTimeout(boot, 800);
})();
