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

  /* ---- MIJOZ IZOHLARI (taom tilaklari) ----
     "Somsani sous bilan yuboring", "achchiq solmang", "alohida o'rang".
     Izohli qatorlar: [{name, note, qty}]. Bo'sh bo'lsa — [] . */
  function notes(order) {
    return lines(order)
      .filter(function (l) { return l && String(l.note || '').trim(); })
      .map(function (l) {
        return { name: String(l.name || ''), note: String(l.note).trim(), qty: Number(l.qty) || 1 };
      });
  }
  function hasNotes(order) { return notes(order).length > 0; }

  /* Jadval qatori uchun kichkina belgi — "bu buyurtmada mijoz tilagi bor".
     Kuryer ro'yxatni ko'zdan kechirganda darrov sezadi. */
  function noteFlag(order) {
    var n = notes(order);
    if (!n.length) return '';
    return '<span class="yz-note-flag" title="' + esc(n.map(function (x) { return x.name + ': ' + x.note; }).join(' · ')) + '">'
      + '💬 ' + n.length + ' ta izoh</span>';
  }

  /* Buyurtma modali uchun KATTA, o'tkazib yuborib bo'lmaydigan blok.
     Kuryer/restoran uchun eng muhim ma'lumot — shuning uchun alohida quti. */
  function notesHtml(order, opts) {
    var n = notes(order);
    if (!n.length) return '';
    var o = opts || {};
    var rows = n.map(function (x) {
      return '<div class="yz-note-line">'
        + '<span class="yz-note-dish">' + esc(x.name) + (x.qty > 1 ? ' ×' + x.qty : '') + '</span>'
        + '<span class="yz-note-txt">' + esc(x.note) + '</span>'
        + '</div>';
    }).join('');
    return '<div class="yz-note-box">'
      + '<h4>💬 ' + esc(o.title || 'Mijoz izohi — shuni bajaring') + '</h4>'
      + rows + '</div>';
  }

  /* ---- GURUH BUYURTMASI: har a'zoning ulushi/to'lovi ----
     order.groupBreakdown = [{name,amount,pay,paid}] (server: orders-core.js).
     Kuryer naqd puldan "olindi" deb belgilashi mumkin (opts.onPaidClick). */
  function groupBreakdownHtml(order, opts) {
    var bd = order && order.groupBreakdown;
    if (!Array.isArray(bd) || !bd.length) return '';
    var o = opts || {};
    var rows = bd.map(function (m, i) {
      var payLabel = m.pay === 'card' ? '💳 Karta' : '💵 Naqd';
      var paidBadge = m.paid
        ? '<span class="yz-gb-paid">✓ Olindi</span>'
        : (o.onPaidClick ? '<button class="yz-gb-btn" data-gbidx="' + i + '">Olindi deb belgilash</button>' : '<span class="yz-gb-pending">Kutilmoqda</span>');
      return '<div class="yz-gb-row">'
        + '<span class="yz-gb-name">👤 ' + esc(m.name) + '</span>'
        + '<span class="yz-gb-amount">' + money(m.amount) + " so'm · " + payLabel + '</span>'
        + paidBadge + '</div>';
    }).join('');
    return '<div class="yz-gb-box"><h4>👥 Guruh — har kimning ulushi</h4>' + rows + '</div>';
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
      /* Mijoz tilagi AYNAN shu taom ostida — tayyorlovchi/kuryer adashmasin */
      var note = String(l.note || '').trim()
        ? '<div class="yz-it-note">💬 <span>' + esc(l.note) + '</span></div>' : '';
      return '<div class="yz-it-row">'
        + thumb(l, 42)
        + '<div class="yz-it-info"><div class="yz-it-name">' + esc(l.name) + '</div>'
        + '<div class="yz-it-price">' + disc + '</div>' + note + '</div>'
        + '<div class="yz-it-right"><b class="yz-it-x">× ' + (Number(l.qty) || 1) + '</b>'
        + '<span class="yz-it-sum">' + money(sum) + " so'm</span></div>"
        + '</div>';
    }).join('');
    var n = notes(order).length;
    return '<div class="yz-it-box">'
      + '<div class="yz-it-head"><b>🍽️ Buyurtma tarkibi</b>'
      + '<span class="yz-it-count">' + ls.length + ' xil · jami ' + total + ' dona'
      + (n ? ' · 💬 ' + n + ' ta izoh' : '') + '</span></div>'
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
      '.yz-it-sum{color:#9a8d83;font-size:12px;white-space:nowrap}' +
      /* ---- MIJOZ IZOHI: bu ma'lumot ko'rinmasa buyurtma noto'g'ri yetkaziladi,
             shuning uchun qizil ramka va qalin shrift bilan ajratiladi ---- */
      '.yz-it-note{margin-top:4px;background:#FFF3F0;border-left:3px solid #C8102E;' +
        'border-radius:0 8px 8px 0;padding:5px 8px;font-size:12.5px;font-weight:700;' +
        'color:#8f1224;line-height:1.4;word-break:break-word}' +
      /* flex-basis:100% — buyurtma qatori flex konteyner, izoh butun kenglikni olsin */
      '.yz-note-box{border:2px solid #C8102E;background:#FFF3F0;border-radius:14px;' +
        'padding:10px 12px;margin:12px 0;flex:0 0 100%;width:100%;box-sizing:border-box}' +
      '.yz-note-box h4{font-size:13px;color:#C8102E;margin:0 0 7px;display:flex;align-items:center;' +
        'gap:6px;text-transform:uppercase;letter-spacing:.3px}' +
      '.yz-note-line{display:flex;gap:8px;align-items:flex-start;padding:5px 0;' +
        'border-top:1px dashed rgba(200,16,46,.25);font-size:13.5px;line-height:1.45}' +
      '.yz-note-line:first-of-type{border-top:none}' +
      '.yz-note-dish{font-weight:800;color:#5c0f1c;flex:none;max-width:45%;word-break:break-word}' +
      '.yz-note-txt{font-weight:700;color:#8f1224;flex:1;word-break:break-word}' +
      '.yz-note-flag{display:inline-flex;align-items:center;gap:3px;background:#C8102E;color:#fff;' +
        'border-radius:6px;padding:1px 6px;font-size:10.5px;font-weight:800;white-space:nowrap}' +
      /* ---- Guruh buyurtmasi: har a'zoning ulushi ---- */
      '.yz-gb-box{border:2px solid #2563eb;background:#eff6ff;border-radius:14px;padding:10px 12px;margin:12px 0}' +
      '.yz-gb-box h4{font-size:13px;color:#2563eb;margin:0 0 7px;display:flex;align-items:center;gap:6px;text-transform:uppercase;letter-spacing:.3px}' +
      '.yz-gb-row{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;' +
        'padding:6px 0;border-top:1px dashed rgba(37,99,235,.25);font-size:13px}' +
      '.yz-gb-row:first-of-type{border-top:none}' +
      '.yz-gb-name{font-weight:800;color:#1e3a8a;flex:none}' +
      '.yz-gb-amount{color:#334155;flex:1;min-width:140px}' +
      '.yz-gb-paid{color:#16a34a;font-weight:800;font-size:12px;white-space:nowrap}' +
      '.yz-gb-pending{color:#9a8d83;font-size:12px;white-space:nowrap}' +
      '.yz-gb-btn{background:#16a34a;color:#fff;border:none;border-radius:8px;padding:5px 10px;font-size:11.5px;font-weight:700;cursor:pointer;white-space:nowrap}';
    (root.document.head || root.document.documentElement).appendChild(st);
  }
  if (root.document) {
    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', injectCss);
    else injectCss();
  }

  root.YZ_ITEMS = {
    lines: lines, qty: qty, photoOf: photoOf, isPhoto: isPhoto,
    thumb: thumb, strip: strip, listHtml: listHtml,
    /* Mijoz izohlari — kuryer/restoran/admin panellari shulardan foydalanadi */
    notes: notes, hasNotes: hasNotes, noteFlag: noteFlag, notesHtml: notesHtml,
    /* Guruh buyurtmasi — har a'zoning ulushi (kuryer/restoran/admin) */
    groupBreakdownHtml: groupBreakdownHtml,
  };
})(typeof window !== 'undefined' ? window : this);
