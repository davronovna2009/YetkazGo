/* ===== Yetkaz.uz — BUYURTMA TARKIBI (rasm bilan) — YAGONA manba =====

   Muammo: buyurtma jadvalida faqat "Lag'mon +19 ta" degan yorliq turardi.
   Mijoz 20–30 ta mahsulot buyurtma qilsa, restoran NIMA tayyorlashini
   ko'rmasdi. Endi har bir taom RASMI, dona soni va summasi bilan chiqadi.

   Ro'yxat uzun bo'lsa panel cho'zilib ketmasin — ichida SCROLL (overflow)
   bo'ladi: jadval qatorida gorizontal (rasm lentasi), modalда vertikal.

   Ma'lumot manbayi: buyurtmaning `items` maydoni — server narxlaган qatorlar
   (server/src/pricing.js): [{id, name, emoji, photo, qty, price, pct, eff, sum}].
   Eski buyurtmalarда `photo` bo'lmasligi mumkin — u holda taom id/nom bo'yicha
   katalogdan (STORE.overrides().added) topiladi.

   Ishlatish (restoran/kuryer/admin panellari):
     YZ_ITEMS.lines(order)        -> tarkib massivi (bo'sh bo'lsa [])
     YZ_ITEMS.qty(order)          -> jami dona soni
     YZ_ITEMS.strip(order)        -> jadval qatori uchun gorizontal rasm lentasi
     YZ_ITEMS.listHtml(order)     -> modal uchun to'liq, scroll'li ro'yxat
*/
(function (root) {
  'use strict';

  var esc = (root.YZ_SAFE && root.YZ_SAFE.esc) || function (s) { return String(s == null ? '' : s); };
  var money = function (n) { return Math.round(Number(n) || 0).toLocaleString('ru-RU'); };

  /* Haqiqiy rasmmi (emoji/bo'sh matn emas)? */
  function isPhoto(p) { return !!p && /^\/(?:uploads|img)\/|^data:|^https?:/.test(String(p)); }

  /* Katalogdan (backend override'lari) taom rasmini topish — eski buyurtmalar uchun */
  function fromCatalog(line) {
    try {
      if (typeof STORE === 'undefined' || !STORE.overrides) return '';
      var added = STORE.overrides().added || [];
      var d = null;
      if (line && line.id != null) d = added.find(function (x) { return String(x.id) === String(line.id); });
      if (!d && line && line.name) d = added.find(function (x) { return x.name === line.name; });
      return (d && isPhoto(d.photo)) ? d.photo : '';
    } catch (e) { return ''; }
  }

  function photoOf(line) {
    if (line && isPhoto(line.photo)) return line.photo;
    return fromCatalog(line);
  }

  /* Buyurtma tarkibi. Eski (items_json'siz) buyurtmada bo'sh massiv qaytadi —
     chaqiruvchi shunda odatdagi `item` yorlig'ini ko'rsatadi. */
  function lines(order) {
    var v = order && order.items;
    return Array.isArray(v) ? v : [];
  }

  function qty(order) {
    if (order && order.qtyTotal) return order.qtyTotal;
    return lines(order).reduce(function (s, l) { return s + (Number(l && l.qty) || 0); }, 0);
  }

  /* Bitta taom belgisi (rasm bo'lsa rasm, bo'lmasa emoji) */
  function thumb(line, size) {
    var px = size || 34;
    var p = photoOf(line);
    var box = 'width:' + px + 'px;height:' + px + 'px;border-radius:9px;flex:none;object-fit:cover;background:#f3eef0';
    if (p) {
      return '<img src="' + esc(p) + '" alt="" style="' + box + '"'
           + ' data-onerr="emoji" data-emoji="' + esc((line && line.emoji) || '🍽️') + '"'
           + ' data-emoji-class="yz-it-emoji">';
    }
    return '<span style="' + box + ';display:inline-flex;align-items:center;justify-content:center;font-size:' + Math.round(px * 0.6) + 'px">'
         + esc((line && line.emoji) || '🍽️') + '</span>';
  }

  /* ---- Jadval qatori uchun: gorizontal rasm lentasi (overflow-x) ----
     Ko'p taom bo'lsa qator cho'zilmaydi — yon tomonga suriladi. */
  function strip(order) {
    var ls = lines(order);
    if (!ls.length) return '';
    var cells = ls.map(function (l) {
      return '<span class="yz-it-chip" title="' + esc(l.name) + ' × ' + (l.qty || 1) + '">'
        + thumb(l, 30)
        + '<b class="yz-it-qty">×' + (Number(l.qty) || 1) + '</b>'
        + '</span>';
    }).join('');
    return '<div class="yz-it-strip">' + cells + '</div>';
  }

  /* ---- Modal uchun: to'liq ro'yxat, ichida vertikal scroll ----
     opts.maxHeight — scroll boshlanadigan balandlik (default 260px) */
  function listHtml(order, opts) {
    var o = opts || {};
    var ls = lines(order);
    var total = qty(order);
    if (!ls.length) {
      /* Eski buyurtma — tarkib saqlanmagan, faqat yorliq bor */
      return '<div class="yz-it-box"><div class="yz-it-head"><b>🍽️ Buyurtma tarkibi</b></div>'
        + '<div style="padding:10px 12px;color:#9a8d83;font-size:13px">'
        + esc((order && order.item) || '—') + ' <span style="opacity:.7">(bu eski buyurtma — batafsil tarkib saqlanmagan)</span>'
        + '</div></div>';
    }
    var rows = ls.map(function (l) {
      var sum = Number(l.sum) || ((Number(l.eff) || Number(l.price) || 0) * (Number(l.qty) || 1));
      var disc = Number(l.pct) > 0
        ? '<span class="yz-it-old">' + money(l.price) + '</span> <b class="yz-it-new">' + money(l.eff) + '</b>'
          + ' <span class="yz-it-pct">-' + Math.round(l.pct) + '%</span>'
        : money(l.eff != null ? l.eff : l.price) + " so'm";
      return '<div class="yz-it-row">'
        + thumb(l, 42)
        + '<div class="yz-it-info"><div class="yz-it-name">' + esc(l.name) + '</div>'
        + '<div class="yz-it-price">' + disc + '</div></div>'
        + '<div class="yz-it-right"><b class="yz-it-x">× ' + (Number(l.qty) || 1) + '</b>'
        + '<span class="yz-it-sum">' + money(sum) + " so'm</span></div>"
        + '</div>';
    }).join('');
    return '<div class="yz-it-box">'
      + '<div class="yz-it-head"><b>🍽️ Buyurtma tarkibi</b>'
      + '<span class="yz-it-count">' + ls.length + ' xil · jami ' + total + ' dona</span></div>'
      + '<div class="yz-it-scroll" style="max-height:' + (o.maxHeight || 260) + 'px">' + rows + '</div>'
      + '</div>';
  }

  /* ---- Kerakli CSS ni bir marta sahifaga qo'shamiz (har panelда takrorlamaslik uchun) ---- */
  function injectCss() {
    if (!root.document || root.document.getElementById('yzItemsCss')) return;
    var st = root.document.createElement('style');
    st.id = 'yzItemsCss';
    st.textContent =
      '.yz-it-strip{display:flex;gap:6px;overflow-x:auto;overflow-y:hidden;max-width:230px;padding:4px 0 2px;scrollbar-width:thin}' +
      '.yz-it-strip::-webkit-scrollbar{height:5px}' +
      '.yz-it-strip::-webkit-scrollbar-thumb{background:#d9cfd3;border-radius:4px}' +
      '.yz-it-chip{position:relative;flex:none;display:inline-flex}' +
      '.yz-it-qty{position:absolute;right:-3px;bottom:-3px;background:#C8102E;color:#fff;font-size:9px;font-weight:800;' +
        'border-radius:6px;padding:0 3px;line-height:13px;border:1px solid #fff}' +
      '.yz-it-emoji{display:inline-flex;align-items:center;justify-content:center;font-size:20px}' +
      '.yz-it-box{border:1px solid var(--line,#eee);border-radius:14px;overflow:hidden;margin:12px 0}' +
      '.yz-it-head{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;' +
        'padding:9px 12px;background:#faf7f8;font-size:14px}' +
      '.yz-it-count{color:#9a8d83;font-size:12px;font-weight:700}' +
      '.yz-it-scroll{overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch}' +
      '.yz-it-scroll::-webkit-scrollbar{width:6px}' +
      '.yz-it-scroll::-webkit-scrollbar-thumb{background:#d9cfd3;border-radius:4px}' +
      '.yz-it-row{display:flex;align-items:center;gap:10px;padding:8px 12px;border-top:1px solid var(--line,#f1eef0)}' +
      '.yz-it-row:first-child{border-top:none}' +
      '.yz-it-info{flex:1;min-width:0}' +
      '.yz-it-name{font-weight:700;font-size:14px;word-break:break-word}' +
      '.yz-it-price{color:#9a8d83;font-size:12px}' +
      '.yz-it-old{text-decoration:line-through}' +
      '.yz-it-new{color:#C8102E}' +
      '.yz-it-pct{background:#FBE3E6;color:#C8102E;border-radius:6px;padding:0 4px;font-size:10px;font-weight:800}' +
      '.yz-it-right{text-align:right;flex:none}' +
      '.yz-it-x{display:block;font-size:14px}' +
      '.yz-it-sum{color:#9a8d83;font-size:12px;white-space:nowrap}';
    (root.document.head || root.document.documentElement).appendChild(st);
  }
  if (root.document) {
    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', injectCss);
    else injectCss();
  }

  root.YZ_ITEMS = {
    lines: lines, qty: qty, photoOf: photoOf, isPhoto: isPhoto,
    thumb: thumb, strip: strip, listHtml: listHtml,
  };
})(typeof window !== 'undefined' ? window : this);
