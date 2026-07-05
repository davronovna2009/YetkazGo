/* ===== Yetkaz — panelni ILOVA sifatida o'rnatish taklifi (PWA) =====
   Restoran / kuryer / admin paneliga kirgach (login qilingach), "ilovani
   o'rnatasizmi?" deb chiroyli taklif chiqadi. O'rnatilsa — panel alohida ilova
   bo'lib, to'g'ridan-to'g'ri ochiladi (login oynasisiz, chunki sessiya saqlanadi).
   Bir marta so'raydi: "keyinroq" bosilsa 7 kun, o'rnatilsa umuman qayta so'ramaydi.
   Paneldan chiqilса (logout) sayt ochiladi — foydalanuvchi bemalol saytdan foydalanadi. */
(function () {
  var PANELS = {
    "restoran.html": { key: "restoran", label: "Restoran", emoji: "🏪" },
    "kuryer.html":   { key: "kuryer",   label: "Kuryer",   emoji: "🛵" },
    "admin.html":    { key: "admin",    label: "Admin",    emoji: "🛡️" },
  };
  var path = (location.pathname.split("/").pop() || "").toLowerCase();
  var panel = PANELS[path];
  if (!panel) return; // faqat panellarda ishlaydi

  var LS = "yz_pwa_" + panel.key;
  var deferred = null;
  var shown = false;
  var iOS = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;

  function isStandalone() {
    return (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || window.navigator.standalone === true;
  }
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
  function loggedIn() { var a = document.getElementById("app"); return !!(a && a.classList.contains("show")); }

  window.addEventListener("beforeinstallprompt", function (e) { e.preventDefault(); deferred = e; maybeShow(); });
  window.addEventListener("appinstalled", function () { setLS("installed"); hide(); });

  function maybeShow() {
    if (shown || isStandalone() || suppressed() || !loggedIn()) return;
    if (!deferred && !iOS) return; // o'rnatib bo'lmasa (va iOS emas) — jim turadi
    shown = true;
    build();
  }

  function injectCss() {
    if (document.getElementById("pwaCss")) return;
    var st = document.createElement("style"); st.id = "pwaCss";
    st.textContent =
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

  function hide() {
    var b = document.getElementById("pwaBanner");
    if (b) { b.classList.remove("on"); setTimeout(function () { b.remove(); }, 450); }
  }

  function build() {
    injectCss();
    var el = document.createElement("div");
    el.id = "pwaBanner";
    var body = iOS
      ? '<div class="pwa-ios">📲 <b>Bosh ekranga qo\'shish:</b><br>Pastdagi <b>Ulashish</b> (⬆️) tugmasini bosing → <b>"Bosh ekranga qo\'shish"</b>ni tanlang.</div>' +
        '<div class="pwa-actions"><button class="pwa-btn pwa-no" id="pwaLater">Tushunarli</button></div>'
      : '<ul><li>Bosh ekrandan bitta bosishда ochiladi</li><li>Alohida ilova — brauzersiz, to\'liq ekran</li><li>Login saqlanadi, qayta terish shart emas</li></ul>' +
        '<div class="pwa-actions"><button class="pwa-btn pwa-no" id="pwaLater">Keyinroq</button><button class="pwa-btn pwa-yes" id="pwaYes">📲 O\'rnatish</button></div>';
    el.innerHTML =
      '<div class="pwa-head">' +
        '<button class="pwa-x" id="pwaX" aria-label="Yopish">✕</button>' +
        '<div class="pwa-emoji">' + panel.emoji + '</div>' +
        '<h3>' + panel.label + ' ilovasini o\'rnatasizmi?</h3>' +
        '<p>Yetkaz ' + panel.label + ' panelini telefoningizga ilova qilib qo\'ying</p>' +
        '<svg class="pwa-wave" viewBox="0 0 400 26" preserveAspectRatio="none" aria-hidden="true"><path d="M0,12 C80,30 150,2 220,14 C290,25 340,24 400,14 L400,26 L0,26 Z" fill="#fff"/></svg>' +
      '</div>' +
      '<div class="pwa-body">' + body + '</div>';
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

  /* Login qilinguncha (app "show" bo'lguncha) kutamiz */
  var tries = 0;
  var iv = setInterval(function () {
    tries++;
    if (loggedIn()) { clearInterval(iv); setTimeout(maybeShow, 1600); }
    if (tries > 40) clearInterval(iv); // ~20s
  }, 500);
})();
