/* ===== Yetkaz — ILOVA sifatida o'rnatish (PWA) =====
   MUHIM: BITTA umumiy ilova (bitta manifest.webmanifest, bitta "id") —
   avval har panel (admin/restoran/kuryer/kabinet) O'ZINING alohida ilovasi
   sifatida o'rnatilardi (5 xil ilova telefonda!). Shu sabab bu skript FAQAT
   index.html'da ishlaydi — panelga kirish shunchaki O'SHA BIR ilova ichida
   sahifa almashishi (login orqali), alohida "App qilish" tugmasi kerak emas.
   Bosh sahifaga kirganда bir martalik chiroyli taklif banneri chiqadi.
   O'rnatilса — bitta ilova, login/panel almashish ichida (sessiya saqlanadi).
   iOS/deferred bo'lmasa — qo'lда o'rnatish yo'riqnomasi ko'rsatiladi. */
(function () {
  var path = (location.pathname.split("/").pop() || "").toLowerCase();
  if (!path) path = "index.html"; // "/" -> bosh sahifa
  if (path !== "index.html") return; // boshqa panellarda o'rnatish taklifi ko'rsatilmaydi

  var LS = "yz_pwa_site";
  var deferred = null;
  var shown = false;
  var iOS = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
  var ICON_APP = '<svg class="yz-i"><use href="assets/icons.svg#smartphone"/></svg>';

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

  window.addEventListener("beforeinstallprompt", function (e) { e.preventDefault(); deferred = e; maybeShow(); });
  window.addEventListener("appinstalled", function () { setLS("installed"); hide(); });

  /* ===== Umumiy CSS ===== */
  function injectCss() {
    if (document.getElementById("pwaCss")) return;
    var st = document.createElement("style"); st.id = "pwaCss";
    st.textContent =
      "#pwaBanner{position:fixed;left:50%;bottom:18px;transform:translateX(-50%) translateY(140%);" +
        "width:min(440px,92vw);z-index:100000;background:#fff;border-radius:20px;overflow:hidden;" +
        "box-shadow:0 18px 50px rgba(0,0,0,.28);transition:transform .45s cubic-bezier(.34,1.4,.64,1);font-family:'Manrope',system-ui,sans-serif}" +
      "#pwaBanner.on{transform:translateX(-50%) translateY(0)}" +
      ".pwa-head{position:relative;background:linear-gradient(135deg,#C8102E,#E8A33D);padding:18px 18px 30px;color:#fff;text-align:center}" +
      ".pwa-emoji{font-size:34px;line-height:1}" +
      ".pwa-head h3{margin:6px 0 2px;font-size:18px;font-weight:800}" +
      ".pwa-head p{margin:0;font-size:13px;color:rgba(255,255,255,.92)}" +
      ".pwa-wave{position:absolute;left:0;right:0;bottom:-1px;width:100%;height:26px;display:block}" +
      ".pwa-body{padding:16px 18px 18px}" +
      ".pwa-body ul{margin:0 0 14px;padding-left:18px;color:#555;font-size:13px;line-height:1.7}" +
      ".pwa-actions{display:flex;gap:10px}" +
      ".pwa-btn{flex:1;border:none;border-radius:12px;padding:12px;font-family:inherit;font-weight:800;font-size:14px;cursor:pointer}" +
      ".pwa-yes{background:linear-gradient(135deg,#C8102E,#E8A33D);color:#fff}" +
      ".pwa-no{background:#f1eef0;color:#333}" +
      ".pwa-x{position:absolute;top:10px;right:12px;background:rgba(255,255,255,.25);border:none;color:#fff;width:28px;height:28px;border-radius:50%;cursor:pointer;z-index:2;display:flex;align-items:center;justify-content:center}" +
      ".pwa-ios{background:#faf7f8;border-radius:12px;padding:12px;font-size:13px;color:#444;line-height:1.6;margin-bottom:12px}";
    (document.head || document.documentElement).appendChild(st);
  }

  function maybeShow() {
    if (shown || isStandalone() || installed() || suppressed()) return;
    if (!deferred && !iOS) return; // o'rnatib bo'lmasa (va iOS emas) — jim
    shown = true;
    build();
  }

  function hide() {
    var b = document.getElementById("pwaBanner");
    if (b) { b.classList.remove("on"); setTimeout(function () { b.remove(); }, 450); }
  }

  function bodyHtml() {
    if (deferred) {
      return '<ul><li>Bosh ekrandan bitta bosishда ochiladi</li><li>Alohida ilova — brauzersiz, to\'liq ekran</li><li>Login saqlanadi, qayta terish shart emas</li></ul>' +
        '<div class="pwa-actions"><button class="pwa-btn pwa-no" id="pwaLater">Keyinroq</button><button class="pwa-btn pwa-yes" id="pwaYes">O\'rnatish</button></div>';
    }
    if (iOS) {
      return '<div class="pwa-ios"><b>Bosh ekranga qo\'shish:</b><br>Pastdagi <b>Ulashish</b> tugmasini bosing → <b>"Bosh ekranga qo\'shish"</b>ni tanlang.</div>' +
        '<div class="pwa-actions"><button class="pwa-btn pwa-no" id="pwaLater">Tushunarli</button></div>';
    }
    // Android/desktop, prompt hali tayyor emas — qo'lда o'rnatish yo'riqnomasi
    return '<div class="pwa-ios"><b>Ilovani o\'rnatish:</b><br>Brauzer menyusini oching → <b>"Ilovani o\'rnatish"</b> yoki <b>"Bosh ekranga qo\'shish"</b>ni tanlang.</div>' +
      '<div class="pwa-actions"><button class="pwa-btn pwa-no" id="pwaLater">Tushunarli</button></div>';
  }

  function build() {
    injectCss();
    var el = document.createElement("div");
    el.id = "pwaBanner";
    el.innerHTML =
      '<div class="pwa-head">' +
        '<button class="pwa-x" id="pwaX" aria-label="Yopish"><svg class="yz-i"><use href="assets/icons.svg#x"/></svg></button>' +
        '<div class="pwa-emoji">' + ICON_APP + '</div>' +
        '<h3>YetkazGo ilovasini o\'rnatasizmi?</h3>' +
        '<p>Tezroq buyurtma bering — ilovani telefoningizga o\'rnating</p>' +
        '<svg class="pwa-wave" viewBox="0 0 400 26" preserveAspectRatio="none" aria-hidden="true"><path d="M0,12 C80,30 150,2 220,14 C290,25 340,24 400,14 L400,26 L0,26 Z" fill="#fff"/></svg>' +
      '</div>' +
      '<div class="pwa-body">' + bodyHtml() + '</div>';
    document.body.appendChild(el);
    requestAnimationFrame(function () { el.classList.add("on"); });

    var x = el.querySelector("#pwaX"), later = el.querySelector("#pwaLater"), yes = el.querySelector("#pwaYes");
    function dismiss() { setLS("later:" + Date.now()); hide(); }
    if (x) x.addEventListener("click", dismiss);
    if (later) later.addEventListener("click", dismiss);
    if (yes) yes.addEventListener("click", function () {
      if (!deferred) { dismiss(); return; }
      deferred.prompt();
      deferred.userChoice.then(function (c) {
        if (c && c.outcome === "accepted") setLS("installed"); else setLS("later:" + Date.now());
        deferred = null; hide();
      });
    });
  }

  setTimeout(maybeShow, 1600);
})();
