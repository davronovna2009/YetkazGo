/* ===== Yetkaz.uz — XSS himoyasi: YAGONA manba =====
   Avval har faylда o'z `esc()` nusxasi bor edi (app.js, admin.js, restoran.js,
   kuryer.js, kabinet.js) — hammasi bir-biridan chetlab, hammasi `'` ni
   qoldirib ketardi. Endi ta'rif FAQAT shu yerда.

   ISHLATISH (yangi kod uchun DOIM shu):

     el.innerHTML = html`<h3>${dish.name}</h3>`;        // ${} avtomat escape
     el.innerHTML = html`<ul>${items.map(i => html`<li>${i.name}</li>`)}</ul>`;
     el.innerHTML = html`<div>${raw(tayyorHtml)}</div>`; // ataylab escape'siz

   `html` massivlarni o'zi qo'shadi — `.join("")` YOZMANG (u qatorga aylantirib,
   escape'ga tushib qoladi va teglar matn bo'lib ko'rinadi).

   ⚠️ MUHIM CHEKLOV — inline hodisa atributlari:
   Bu yerдаgi escape HTML matn va tirnoqli atributlar uchun. `onerror="...'X'..."`
   kabi joyда ISHLAMAYDI: brauzer avval HTML'ni dekod qiladi (&#39; -> '), keyin
   JS'ni o'qiydi — ya'ni escape "yechilib" ketadi. Shuning uchun ma'lumotni
   inline hodisa ichiga UMUMAN qo'ymaymiz: `data-*` atributi + pastdagi global
   ishlovchi ishlatiladi (CSP ham inline hodisalarni bloklaydi). */
(function (root) {
  'use strict';

  /* HTML matn + tirnoqli atributlar uchun. `'` ham escape qilinadi —
     class='${x}' kabi bitta tirnoqli atributlar uchun zarur. */
  var MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"'`]/g, function (c) { return MAP[c]; });
  }

  /* Ishonchli (allaqachon HTML) qiymat belgisi */
  function Raw(v) { this.v = v; }
  Raw.prototype.toString = function () { return this.v; };
  function raw(s) { return new Raw(String(s == null ? '' : s)); }
  function isRaw(v) { return v instanceof Raw; }

  /* Bitta qiymatni HTML'ga aylantirish */
  function part(v) {
    if (v == null || v === false) return '';        // false/null -> hech narsa
    if (isRaw(v)) return v.v;                        // ishonchli — tegmaymiz
    if (Array.isArray(v)) return v.map(part).join('');  // ichma-ich shablonlar
    return esc(v);
  }

  /* Teg shabloni — har `${}` avtomat escape. Natija Raw, ya'ni ichma-ich
     `html` chaqiruvlari qayta escape bo'lmaydi. */
  function html(strings) {
    var out = strings[0];
    for (var i = 1; i < arguments.length; i++) out += part(arguments[i]) + strings[i];
    return new Raw(out);
  }

  /* ===== Rasm yuklanmaganда — CSP xavfsiz ishlovchi =====
     `onerror="..."` CSP tomonidan bloklanadi (va JS-satr konteksti XSS beradi).
     Buning o'rniga deklarativ `data-onerr` ishlatamiz:

       data-onerr="remove"                       -> rasmni o'chiradi
       data-onerr="icon" data-icon="food-generic" -> assets/icons.svg ikoni bilan almashtiradi
         qo'shimcha: data-icon-tag="div"         -> qanday element (default span)
                     data-icon-class="ph big"    -> unga qo'shimcha class

     Bitta global tinglovchi (capture — 'error' ko'pikka chiqmaydi). */
  var TAG_OK = /^[a-z]+$/;
  var SVG_NS = 'http://www.w3.org/2000/svg';
  var XLINK_NS = 'http://www.w3.org/1999/xlink';
  function onImgError(e) {
    var t = e.target;
    if (!t || t.tagName !== 'IMG') return;
    var mode = t.getAttribute && t.getAttribute('data-onerr');
    if (!mode) return;
    if (mode === 'remove') { t.remove(); return; }
    if (mode === 'icon' || mode === 'emoji') {
      var tag = t.getAttribute('data-icon-tag') || t.getAttribute('data-emoji-tag') || 'span';
      if (!TAG_OK.test(tag)) tag = 'span';       // faqat oddiy teg nomi
      var el = document.createElement(tag);
      var name = t.getAttribute('data-icon') || 'food-generic';
      var svg = document.createElementNS(SVG_NS, 'svg');
      svg.setAttribute('class', 'yz-i');
      var use = document.createElementNS(SVG_NS, 'use');
      use.setAttributeNS(XLINK_NS, 'href', 'assets/icons.svg#' + name);
      use.setAttribute('href', 'assets/icons.svg#' + name);
      svg.appendChild(use);
      el.appendChild(svg);
      var cls = t.getAttribute('data-icon-class') || t.getAttribute('data-emoji-class');
      if (cls) el.className = cls;
      t.replaceWith(el);
    }
  }
  if (root.document && root.document.addEventListener) {
    root.document.addEventListener('error', onImgError, true);
  }

  root.YZ_SAFE = { esc: esc, html: html, raw: raw, attr: esc };
  /* Qulaylik uchun global qisqartmalar (barcha panellar shuni ishlatadi) */
  root.esc = esc;
  root.html = html;
  root.raw = raw;
})(typeof window !== 'undefined' ? window : this);
