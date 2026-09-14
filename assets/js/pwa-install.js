/* ===== Yetkaz — panelni ILOVA sifatida o'rnatish (PWA) =====
   Har bir panelда (admin / restoran / kuryer / kabinet):
     1) Tepа o'ng burchakда DOIMIY "📲 App qilish" tugmasi — istagan vaqtда bosib
        ilovani o'rnatish mumkin (o'rnatilmaган va standalone bo'lmasa har doim turadi).
     2) Login'дан keyin bir martalik chiroyli taklif banneri (nudge).
   O'rnatilса — panel alohida ilova bo'lib, login oynasisiz ochiladi (sessiya saqlanadi).
   iOS/deferred bo'lmasa — qo'lда o'rnatish yo'riqnomasi ko'rsatiladi. */
(function () {
  var PANELS = {
    "index.html":    { key: "site",     label: "YetkazGo", emoji: "🛵", isSite: true },
    "restoran.html": { key: "restoran", label: "Restoran", emoji: "🏪" },
    "kuryer.html":   { key: "kuryer",   label: "Kuryer",   emoji: "🛵" },
    "admin.html":    { key: "admin",    label: "Admin",    emoji: "🛡️" },
    "kabinet.html":  { key: "kabinet",  label: "Kabinet",  emoji: "👤" },
  };
  var path = (location.pathname.split("/").pop() || "").toLowerCase();
  if (!path) path = "index.html"; // "/" -> bosh sahifa
  var panel = PANELS[path];
  if (!panel) return; // faqat panellar + bosh sahifada ishlaydi

  var LS = "yz_pwa_" + panel.key;
  var deferred = null;
  var shown = false;         // banner ko'rsatildimi
  var bannerTried = false;   // login'дан keyingi bir martalik banner urinib ko'rilдими
  var iOS = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;

  function isStandalone() {
    return (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || window.navigator.standalone === true;
  }
  function installed() { try { return localStorage.getItem(LS) === "installed"; } catch (e) { return false; } }
  function suppressed() {
    try {
      var v = localStorage.getItem(LS);
      if (!v) return false;
      if (v === "installed") return true;
      if (v.indexOf("later:") === 0) return (Date.now() - (parseInt(v.slice(6), 10) || 0)) < 7 * 864e5; // 7 kun
      return false;
    } catch (e) { return false; }
  }
  function setLS(v) { try { localStorage.setItem(LS, v); } catch (e) {} }
  /* Bosh sahifada (panel emas) login tushunchasi yo'q — har doim "tayyor"
     hisoblanadi, shuning uchun taklif LOGIN kutmasdan ko'rinishi mumkin. */
  function loggedIn() { if (panel.isSite) return true; var a = document.getElementById("app"); return !!(a && a.classList.contains("show")); }

  window.addEventListener("beforeinstallprompt", function (e) { e.preventDefault(); deferred = e; ensureTopBtn(); maybeShow(); });
  window.addEventListener("appinstalled", function () { setLS("installed"); hide(); removeTopBtn(); });

  /* ===== Umumiy CSS ===== */
  function injectCss() {
    if (document.getElementById("pwaCss")) return;
    var st = document.createElement("style"); st.id = "pwaCss";
    st.textContent =
      /* doimiy tepа tugma */
      ".pwa-topbtn{display:inline-flex;align-items:center;gap:6px;border:none;cursor:pointer;" +
        "background:linear-gradient(135deg,#C8102E,#E8A33D);color:#fff;font-family:'Manrope',system-ui,sans-serif;" +
        "font-weight:800;font-size:13px;line-height:1;padding:9px 14px;border-radius:999px;" +
        "box-shadow:0 4px 12px rgba(200,16,46,.32);white-space:nowrap;margin-right:8px;flex:none}" +
      ".pwa-topbtn:active{transform:translateY(1px)}" +
      "@media(max-width:560px){.pwa-topbtn span{display:none}.pwa-topbtn{padding:9px 11px;font-size:15px}}" +
      /* banner */
      "#pwaBanner{position:fixed;left:50%;bottom:18px;transform:translateX(-50%) translateY(140%);" +
        "width:min(440px,92vw);z-index:100000;background:#fff;border-radius:20px;overflow:hidden;" +
        "box-shadow:0 18px 50px rgba(0,0,0,.28);transition:transform .45s cubic-bezier(.34,1.4,.64,1);font-family:'Manrope',system-ui,sans-serif}" +
      "#pwaBanner.on{transform:translateX(-50%) translateY(0)}" +
      ".pwa-head{position:relative;background:linear-gradient(135deg,#C8102E,#E8A33D);padding:18px 18px 30px;color:#fff;text-align:center}" +
      ".pwa-emoji{font-size:38px;line-height:1;filter:drop-shadow(0 4px 8px rgba(0,0,0,.25))}" +
      ".pwa-head h3{margin:6px 0 2px;font-size:18px;font-weight:800}" +
      ".pwa-head p{margin:0;font-size:13px;color:rgba(255,255,255,.92)}" +
      ".pwa-wave{position:absolute;left:0;right:0;bottom:-1px;width:100%;height:26px;display:block}" +
      ".pwa-body{padding:16px 18px 18px}" +
      ".pwa-body ul{margin:0 0 14px;padding-left:18px;color:#555;font-size:13px;line-height:1.7}" +
      ".pwa-actions{display:flex;gap:10px}" +
      ".pwa-btn{flex:1;border:none;border-radius:12px;padding:12px;font-family:inherit;font-weight:800;font-size:14px;cursor:pointer}" +
      ".pwa-yes{background:linear-gradient(135deg,#C8102E,#E8A33D);color:#fff}" +
      ".pwa-no{background:#f1eef0;color:#333}" +
      ".pwa-x{position:absolute;top:10px;right:12px;background:rgba(255,255,255,.25);border:none;color:#fff;width:28px;height:28px;border-radius:50%;font-size:15px;cursor:pointer;z-index:2}" +
      ".pwa-ios{background:#faf7f8;border-radius:12px;padding:12px;font-size:13px;color:#444;line-height:1.6;margin-bottom:12px}";
    (document.head || document.documentElement).appendChild(st);
  }

  /* ===== Doimiy tepа tugma ===== */
  function ensureTopBtn() {
    if (isStandalone() || installed()) { removeTopBtn(); return; }
    if (!loggedIn()) return;
    if (document.getElementById("pwaTopBtn")) return;
    var bar = document.querySelector(".topbar .tb-right") || document.querySelector(".topbar");
    if (!bar) return;
    injectCss();
    var b = document.createElement("button");
    b.id = "pwaTopBtn"; b.className = "pwa-topbtn"; b.type = "button";
    b.setAttribute("aria-label", "Ilovani o'rnatish");
    b.innerHTML = "📲 <span>App qilish</span>";
    b.addEventListener("click", installNow);
    bar.insertBefore(b, bar.firstChild);
  }
  function removeTopBtn() { var b = document.getElementById("pwaTopBtn"); if (b) b.remove(); }

  /* Tugma bosilганда — deferred bo'lsa darhol prompt, aks holda yo'riqnoma */
  function installNow() {
    if (deferred) {
      deferred.prompt();
      deferred.userChoice.then(function (c) {
        if (c && c.outcome === "accepted") { setLS("installed"); removeTopBtn(); }
        deferred = null;
      });
      return;
    }
    // deferred yo'q (iOS yoki hali tayyor emas) — yo'riqnoma bannerini ko'rsatamiz
    var b = document.getElementById("pwaBanner");
    if (b) return;      // allaqachon ochiq
    shown = true; build(true);
  }

  /* ===== Bir martalik banner (login'дан keyin) ===== */
  function maybeShow() {
    if (shown || isStandalone() || installed() || suppressed() || !loggedIn()) return;
    if (!deferred && !iOS) return; // banner uchun: o'rnatib bo'lmasa (va iOS emas) — jim; tepа tugma baribir turadi
    shown = true;
    build(false);
  }

  function hide() {
    var b = document.getElementById("pwaBanner");
    if (b) { b.classList.remove("on"); setTimeout(function () { b.remove(); }, 450); }
  }

  function bodyHtml() {
    if (deferred) {
      return '<ul><li>Bosh ekrandan bitta bosishда ochiladi</li><li>Alohida ilova — brauzersiz, to\'liq ekran</li><li>Login saqlanadi, qayta terish shart emas</li></ul>' +
        '<div class="pwa-actions"><button class="pwa-btn pwa-no" id="pwaLater">Keyinroq</button><button class="pwa-btn pwa-yes" id="pwaYes">📲 O\'rnatish</button></div>';
    }
    if (iOS) {
      return '<div class="pwa-ios">📲 <b>Bosh ekranga qo\'shish:</b><br>Pastdagi <b>Ulashish</b> (⬆️) tugmasini bosing → <b>"Bosh ekranga qo\'shish"</b>ni tanlang.</div>' +
        '<div class="pwa-actions"><button class="pwa-btn pwa-no" id="pwaLater">Tushunarli</button></div>';
    }
    // Android/desktop, prompt hali tayyor emas — qo'lда o'rnatish yo'riqnomasi
    return '<div class="pwa-ios">📲 <b>Ilovani o\'rnatish:</b><br>Brauzer menyusini (<b>⋮</b> yoki <b>⋯</b>) oching → <b>"Ilovani o\'rnatish"</b> yoki <b>"Bosh ekranga qo\'shish"</b>ni tanlang.</div>' +
      '<div class="pwa-actions"><button class="pwa-btn pwa-no" id="pwaLater">Tushunarli</button></div>';
  }

  function build(manual) {
    injectCss();
    var el = document.createElement("div");
    el.id = "pwaBanner";
    el.innerHTML =
      '<div class="pwa-head">' +
        '<button class="pwa-x" id="pwaX" aria-label="Yopish">✕</button>' +
        '<div class="pwa-emoji">' + panel.emoji + '</div>' +
        '<h3>' + panel.label + ' ilovasini o\'rnatasizmi?</h3>' +
        '<p>' + (panel.isSite
          ? "Tezroq buyurtma bering — ilovani telefoningizga o'rnating"
          : "Yetkaz " + panel.label + " panelini telefoningizga ilova qilib qo'ying") + '</p>' +
        '<svg class="pwa-wave" viewBox="0 0 400 26" preserveAspectRatio="none" aria-hidden="true"><path d="M0,12 C80,30 150,2 220,14 C290,25 340,24 400,14 L400,26 L0,26 Z" fill="#fff"/></svg>' +
      '</div>' +
      '<div class="pwa-body">' + bodyHtml() + '</div>';
    document.body.appendChild(el);
    requestAnimationFrame(function () { el.classList.add("on"); });

    var x = el.querySelector("#pwaX"), later = el.querySelector("#pwaLater"), yes = el.querySelector("#pwaYes");
    function dismiss() { if (!manual) setLS("later:" + Date.now()); hide(); }
    if (x) x.addEventListener("click", dismiss);
    if (later) later.addEventListener("click", dismiss);
    if (yes) yes.addEventListener("click", function () {
      if (!deferred) { dismiss(); return; }
      deferred.prompt();
      deferred.userChoice.then(function (c) {
        if (c && c.outcome === "accepted") { setLS("installed"); removeTopBtn(); } else setLS("later:" + Date.now());
        deferred = null; hide();
      });
    });
  }

  /* Login qilinguncha kutamiz; kirgach — tepа tugma + bir martalik banner */
  var tries = 0;
  var iv = setInterval(function () {
    tries++;
    if (loggedIn()) {
      ensureTopBtn();
      if (!bannerTried) { bannerTried = true; setTimeout(maybeShow, 1600); }
    }
    if (tries > 120) clearInterval(iv); // ~60s (tugma bir marta qo'yilса qoladi)
  }, 500);
})();
