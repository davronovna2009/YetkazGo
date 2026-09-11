/* ===== Yetkaz.uz — VAQT bo'yicha YAGONA manba (frontend) =====

   Muammo: sayt, kabinet, admin, restoran va kuryer panellari vaqtni har xil
   hisoblardi (`new Date().getHours()` — foydalanuvchi telefonining mintaqasi,
   `created_at` esa serverда UTC yozilardi). Natijada restoran yopiq bo'lsa ham
   "ochiq" ko'rinardi va buyurtma vaqtlari 5 soat orqada chiqardi.

   Yechim: BUTUN sayt — sayt, panellar, bot va server — vaqtni
   **Asia/Tashkent (UTC+5)** bo'yicha hisoblaydi. Server tomonда aynan shu
   mantiq `server/src/hours.js` da takrorlangan (u yerда buyurtma RAD etiladi).

   Ish vaqti qoidasi (openH/closeH — butun soatlar):
     • closeH > openH   → oddiy kun:      09–23  →  h>=9 && h<23
     • closeH <= openH  → tungi smena:    20–02  →  h>=20 || h<2
     • closeH === openH → 24 soat ochiq
   Kiritilmagan bo'lsa — restoran uchun 09–23, kuryer uchun 08–22. */
(function (global) {
  'use strict';

  var TZ = 'Asia/Tashkent';
  var FMT = null;
  try {
    FMT = new Intl.DateTimeFormat('en-GB', {
      timeZone: TZ, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    });
  } catch (e) { FMT = null; }

  function pad(n) { return String(n).padStart(2, '0'); }
  function int(v, def) {
    var n = parseInt(v, 10);
    return Number.isFinite(n) ? n : def;
  }

  /* Berilgan (yoki hozirgi) paytni Toshkent vaqtiga ajratadi */
  function parts(date) {
    var d = date instanceof Date ? date : new Date();
    if (isNaN(d.getTime())) d = new Date();
    if (FMT) {
      try {
        var o = {};
        FMT.formatToParts(d).forEach(function (p) { if (p.type !== 'literal') o[p.type] = p.value; });
        return { y: +o.year, mo: +o.month, d: +o.day, h: (+o.hour) % 24, mi: +o.minute };
      } catch (e) { /* Intl ishlamadi — pastdagi zaxira */ }
    }
    /* Zaxira: O'zbekistonда yozgi vaqt yo'q, doim UTC+5 */
    var t = new Date(d.getTime() + 5 * 3600000);
    return { y: t.getUTCFullYear(), mo: t.getUTCMonth() + 1, d: t.getUTCDate(), h: t.getUTCHours(), mi: t.getUTCMinutes() };
  }

  /* Hozir Toshkentда soat nechada (0–23) */
  function hour() { return parts().h; }

  /* Hozir Toshkentда "HH:MM" */
  function nowClock() { var p = parts(); return pad(p.h) + ':' + pad(p.mi); }

  /* openH/closeH ni xavfsiz oraliqqa keltiradi */
  function norm(openH, closeH, defOpen, defClose) {
    var o = int(openH, int(defOpen, 9));
    var c = int(closeH, int(defClose, 23));
    o = Math.max(0, Math.min(23, o));
    c = Math.max(0, Math.min(24, c));
    if (c === 0) c = 24;              // "00:00 да yopiladi" = 24:00
    return { o: o, c: c };
  }

  /* Shu ish vaqti hozir ochiqmi */
  function isOpen(openH, closeH, defOpen, defClose) {
    var n = norm(openH, closeH, defOpen, defClose);
    if (n.o === n.c) return true;                 // 24 soat
    var h = hour();
    if (n.c > n.o) return h >= n.o && h < n.c;    // oddiy kun
    return h >= n.o || h < n.c;                   // tungi smena (20–02)
  }

  /* "09:00–23:00" / "24 soat" */
  function text(openH, closeH, defOpen, defClose) {
    var n = norm(openH, closeH, defOpen, defClose);
    if (n.o === n.c) return '24 soat';
    return pad(n.o) + ':00–' + pad(n.c) + ':00';
  }

  /* Keyingi ochilish/yopilish haqida qisqa izoh ("09:00 da ochiladi") */
  function nextChangeText(openH, closeH, defOpen, defClose) {
    var n = norm(openH, closeH, defOpen, defClose);
    if (n.o === n.c) return '';
    return isOpen(openH, closeH, defOpen, defClose)
      ? (pad(n.c % 24) + ':00 da yopiladi')
      : (pad(n.o) + ':00 da ochiladi');
  }

  /* ---- RESTORAN / KURYER yozuvlari uchun qulay qobiqlar ---- */
  var REST_DEF = { o: 9, c: 23 };
  var COUR_DEF = { o: 8, c: 22 };

  function restOpen(r) { return r ? isOpen(r.openH, r.closeH, REST_DEF.o, REST_DEF.c) : true; }
  function restHours(r) { return text(r && r.openH, r && r.closeH, REST_DEF.o, REST_DEF.c); }
  function restNext(r) { return nextChangeText(r && r.openH, r && r.closeH, REST_DEF.o, REST_DEF.c); }
  function courOpen(c) { return c ? isOpen(c.openH, c.closeH, COUR_DEF.o, COUR_DEF.c) : true; }
  function courHours(c) { return text(c && c.openH, c && c.closeH, COUR_DEF.o, COUR_DEF.c); }

  /* Restoranni nomi bo'yicha STORE dan topib, holatini aytadi.
     Yozuv topilmasa — ochiq deb hisoblaymiz (eski ma'lumotga toqat). */
  function findRest(name) {
    try {
      if (typeof global.STORE === 'undefined' || !global.STORE.restaurants) return null;
      return (global.STORE.restaurants() || []).find(function (x) { return x && x.name === name; }) || null;
    } catch (e) { return null; }
  }
  function isRestOpenByName(name) { var r = findRest(name); return r ? restOpen(r) : true; }
  function restHoursByName(name) { return restHours(findRest(name)); }

  /* ---- SERVER VAQTI (SQLite `datetime('now')` — UTC) → Toshkent ---- */
  /* "2026-07-21 09:35:12" yoki ISO satrni UTC deb o'qiydi */
  function parseUTC(raw) {
    var m = String(raw == null ? '' : raw).match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):?(\d{2})?/);
    if (!m) return null;
    return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)));
  }
  /* Absolyut vaqt (ms) — davr/yosh hisoblash uchun. Topilmasa 0. */
  function stamp(raw) { var d = parseUTC(raw); return d ? d.getTime() : 0; }

  /* Toshkent kalendar kuni: "2026-07-21". "Bugungi daromad" kabi hisoblar uchun
     — oxirgi 24 soat EMAS, aynan bugungi kun. */
  function dayKey(date) {
    var p = parts(date instanceof Date ? date : new Date());
    return p.y + '-' + pad(p.mo) + '-' + pad(p.d);
  }
  /* SQLite UTC satri bugungi (Toshkent) kunga tegishlimi */
  function isToday(raw) {
    var d = parseUTC(raw); if (!d) return false;
    return dayKey(d) === dayKey();
  }

  /* ===== DAROMAD GRAFIGI — panellar uchun YAGONA davr/ustun mantiqi =====
     Admin, restoran va kuryer panellari AYNAN shu bo'linishni ishlatadi.
     Kafolat: grafikning OXIRGI (joriy) ustuni «shu davr» kartasidagi songa
     TENG bo'ladi — chunki karta ham, ustun ham bir xil `bucketOf` bilan
     tekshiriladi. Barcha sanalar Toshkent kalendari bo'yicha (oy/hafta
     chegarasida ham 1 so'm adashmaydi).
       kunlik   -> so'nggi 7 kun (kunma-kun);   joriy ustun = bugun
       haftalik -> so'nggi 8 hafta (Dush-Yak);  joriy ustun = shu hafta
       oylik    -> so'nggi 6 oy;                joriy ustun = shu oy
       yillik   -> so'nggi 5 yil;               joriy ustun = shu yil */
  /* `offset` — nechta TO'LIQ oyna orqaga surilsin (0 = eng oxirgi/joriy oyna,
     1 = undan oldingi oyna, va h.k.) — "orqaga qaytib xohlagan vaqtdagi
     hisobotni ko'rish" tugmalari uchun (Oldingi/Keyingi). */
  function incomeChart(period, offset) {
    var MON = ['Yan', 'Fev', 'Mar', 'Apr', 'May', 'Iyun', 'Iyul', 'Avg', 'Sen', 'Okt', 'Noy', 'Dek'];
    var off = Math.max(0, parseInt(offset, 10) || 0);
    var P0 = parts();              // hozir — Toshkent
    var P = P0;
    if (off > 0) {
      if (period === 'kunlik') P = parts(new Date(Date.UTC(P0.y, P0.mo - 1, P0.d - off * 7)));
      else if (period === 'haftalik') P = parts(new Date(Date.UTC(P0.y, P0.mo - 1, P0.d - off * 8 * 7)));
      else if (period === 'yillik') P = { y: P0.y - off * 5, mo: P0.mo, d: P0.d };
      else { var mm0 = P0.mo - 1 - off * 6, yy0 = P0.y; while (mm0 < 0) { mm0 += 12; yy0--; } P = { y: yy0, mo: mm0 + 1, d: P0.d }; }
    }
    var b = [], i;
    if (period === 'kunlik') {
      for (i = 6; i >= 0; i--) {
        var dd = new Date(Date.UTC(P.y, P.mo - 1, P.d - i));
        b.push({ unit: 'day', y: dd.getUTCFullYear(), mo: dd.getUTCMonth() + 1, d: dd.getUTCDate(),
          label: pad(dd.getUTCDate()) + '.' + pad(dd.getUTCMonth() + 1) });
      }
    } else if (period === 'haftalik') {
      var dow = (new Date(Date.UTC(P.y, P.mo - 1, P.d)).getUTCDay() + 6) % 7;  // 0 = Dushanba
      for (i = 7; i >= 0; i--) {
        var w = new Date(Date.UTC(P.y, P.mo - 1, P.d - dow - i * 7));
        b.push({ unit: 'week', ws: w.getTime(),
          label: pad(w.getUTCDate()) + '.' + pad(w.getUTCMonth() + 1) });
      }
    } else if (period === 'yillik') {
      for (i = 4; i >= 0; i--) b.push({ unit: 'year', y: P.y - i, label: String(P.y - i) });
    } else {  // oylik
      for (i = 5; i >= 0; i--) {
        var mm = P.mo - 1 - i, yy = P.y;
        while (mm < 0) { mm += 12; yy--; }
        b.push({ unit: 'month', y: yy, mo: mm + 1, label: MON[mm] });
      }
    }
    function bucketOf(raw) {
      var dt = parseUTC(raw); if (!dt) return -1;
      var q = parts(dt);
      var od = Date.UTC(q.y, q.mo - 1, q.d);
      for (var k = 0; k < b.length; k++) {
        var x = b[k];
        if (x.unit === 'year' && q.y === x.y) return k;
        if (x.unit === 'month' && q.y === x.y && q.mo === x.mo) return k;
        if (x.unit === 'day' && q.y === x.y && q.mo === x.mo && q.d === x.d) return k;
        if (x.unit === 'week' && od >= x.ws && od < x.ws + 7 * 86400000) return k;
      }
      return -1;
    }
    var lastIdx = b.length - 1;
    /* offset=0 bo'lsa oxirgi ustun HAQIQATAN "joriy davr" (bugun/shu hafta...).
       offset>0 bo'lsa — bu tarixiy oyna, "joriy" emas, shuning uchun boshqacha
       yorliq ko'rsatamiz ("N oyna oldin"), lekin oxirgi ustunni baribir
       vizual belgilaymiz (chaqiruvchi shu indeksni "diqqat markazi" deb oladi). */
    var periodLabel = off === 0
      ? ({ kunlik: 'bugun', haftalik: 'shu hafta', oylik: 'shu oy', yillik: 'shu yil' }[period] || 'shu oy')
      : (b[lastIdx] ? b[lastIdx].label : '');
    var spanLabel = { kunlik: "7 kun", haftalik: "8 hafta", oylik: "6 oy", yillik: "5 yil" }[period] || "6 oy";
    spanLabel = off === 0 ? ("so'nggi " + spanLabel) : (spanLabel + " (" + off + "-oyna oldin)");
    return {
      buckets: b,
      curIndex: lastIdx,
      offset: off,
      periodLabel: periodLabel,
      spanLabel: spanLabel,
      bucketOf: bucketOf,
      /* buyurtma «shu davr» (joriy = oxirgi ustun) ichidami — karta shuni sanaydi */
      isCurrent: function (raw) { return bucketOf(raw) === lastIdx; },
      /* har ustunga qiymat yig'ish: orders + har buyurtmadan pul oluvchi fn */
      series: function (orders, amountOf) {
        var sums = b.map(function () { return 0; });
        (orders || []).forEach(function (o) {
          var k = bucketOf(o && o.created_at);
          if (k >= 0) sums[k] += Number(amountOf ? amountOf(o) : 0) || 0;
        });
        return sums;
      },
    };
  }

  function fmtDate(raw) {
    var d = parseUTC(raw); if (!d) return '';
    var p = parts(d); return pad(p.d) + '.' + pad(p.mo) + '.' + p.y;
  }
  function fmtTime(raw) {
    var d = parseUTC(raw); if (!d) return '';
    var p = parts(d); return pad(p.h) + ':' + pad(p.mi);
  }
  function fmtDateTime(raw) {
    var d = parseUTC(raw); if (!d) return '';
    var p = parts(d);
    return pad(p.d) + '.' + pad(p.mo) + '.' + p.y + ' · ' + pad(p.h) + ':' + pad(p.mi);
  }
  /* Buyurtma + eta (daqiqa) = taxminiy yetib borish vaqti (Toshkent) */
  function fmtPlus(raw, minutes) {
    var d = parseUTC(raw); if (!d) return '';
    var p = parts(new Date(d.getTime() + (Number(minutes) || 0) * 60000));
    return pad(p.d) + '.' + pad(p.mo) + '.' + p.y + ' · ' + pad(p.h) + ':' + pad(p.mi);
  }

  global.YZ_TIME = {
    TZ: TZ,
    parts: parts, hour: hour, nowClock: nowClock, pad: pad,
    norm: norm, isOpen: isOpen, text: text, nextChangeText: nextChangeText,
    restOpen: restOpen, restHours: restHours, restNext: restNext,
    courOpen: courOpen, courHours: courHours,
    isRestOpenByName: isRestOpenByName, restHoursByName: restHoursByName, findRest: findRest,
    parseUTC: parseUTC, stamp: stamp, dayKey: dayKey, isToday: isToday,
    incomeChart: incomeChart,
    fmtDate: fmtDate, fmtTime: fmtTime, fmtDateTime: fmtDateTime, fmtPlus: fmtPlus,
  };
})(typeof window !== 'undefined' ? window : this);
