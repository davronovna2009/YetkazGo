/* ===== Yetkaz — kirish maydonlari yaxshilanishi (barcha sahifalarda) =====
   1) Har parol maydoniga "👁 ko'z" — parolni ko'rish/yashirish.
   2) Raqamli maydonlar (type=number / inputmode=numeric / data-digits) faqat
      raqam qabul qiladi — harf/belgi aralashmaydi.
   3) Sana (type=date) va soat (type=time yoki min/max li number) o'z formatida.
   Dinamik ochilgan modallar uchun ham ishlaydi (MutationObserver). */
(function () {
  /* ---- 1) Parol "ko'z" ---- */
  function addEye(inp) {
    if (!inp || inp.__yzEye || inp.type !== "password" || !inp.parentNode) return;
    inp.__yzEye = true;
    var wrap = document.createElement("span");
    wrap.className = "yz-pw-wrap";
    wrap.style.cssText = "position:relative;display:block;width:100%";
    inp.parentNode.insertBefore(wrap, inp);
    wrap.appendChild(inp);
    inp.style.paddingRight = "44px";
    var btn = document.createElement("button");
    btn.type = "button"; btn.setAttribute("aria-label", "Parolni ko'rsatish/yashirish"); btn.tabIndex = -1;
    btn.textContent = "👁";
    btn.style.cssText = "position:absolute;right:8px;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;font-size:17px;opacity:.6;padding:4px;line-height:1;z-index:2";
    btn.addEventListener("click", function () {
      var show = inp.type === "password";
      inp.type = show ? "text" : "password";
      btn.textContent = show ? "🙈" : "👁";
      btn.style.opacity = show ? "1" : ".6";
    });
    wrap.appendChild(btn);
  }

  /* ---- 2) Raqamli maydonlar — faqat raqam ---- */
  function guardNumeric(inp) {
    if (!inp || inp.__yzNum) return;
    var numericType = inp.type === "number";
    var wantDigits = numericType || inp.getAttribute("inputmode") === "numeric" || inp.hasAttribute("data-digits");
    if (!wantDigits) return;
    /* Telefon maydonlari alohida (YZ_PHONE) formatlaydi — ularga tegmaymiz */
    if (inp.__yzPhone) return;
    inp.__yzNum = true;
    if (numericType) {
      inp.addEventListener("keydown", function (e) {
        // e, E, +, - butun sonlarда keraksiz
        if (["e", "E", "+", "-"].includes(e.key)) e.preventDefault();
      });
    } else {
      inp.setAttribute("inputmode", "numeric");
      inp.addEventListener("input", function () {
        var v = inp.value.replace(/\D+/g, "");
        if (v !== inp.value) inp.value = v;
      });
    }
  }

  function scan(root) {
    var r = root || document;
    if (r.querySelectorAll) {
      r.querySelectorAll('input[type="password"]').forEach(addEye);
      r.querySelectorAll('input[type="number"], input[inputmode="numeric"], input[data-digits]').forEach(guardNumeric);
    }
  }

  function init() {
    scan(document);
    try {
      new MutationObserver(function (muts) {
        muts.forEach(function (m) {
          if (!m.addedNodes) return;
          m.addedNodes.forEach(function (n) {
            if (n.nodeType !== 1) return;
            if (n.matches) {
              if (n.matches('input[type="password"]')) addEye(n);
              if (n.matches('input[type="number"],input[inputmode="numeric"],input[data-digits]')) guardNumeric(n);
            }
            scan(n);
          });
        });
      }).observe(document.body, { childList: true, subtree: true });
    } catch (e) {}
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
