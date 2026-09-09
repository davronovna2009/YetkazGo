/* ===== Yetkaz.uz — YORDAM / MUROJAAT KONTAKTLARI (YAGONA manba) =====
   Admin panelида «Sozlamalar → Yordam / murojaat kontaktlari» да yozib qo'yadi:
   telefon, Telegram username, havola, qisqa izoh — har birini ALOHIDA yoqib/
   o'chiradi. Bu ma'lumot sayt/kabinet/restoran/kuryer panellarida "sayt
   ma'muriyatiga murojaat qiling" degan matn O'RNIGA ko'rsatiladi.

   Manba: STORE.settings() (publicSettings) — supportPhone/Username/Link/Note
   va supportPhoneOn/UsernameOn/LinkOn (admin o'chirgan bo'lsa false).

   Ishlatish:
     YZ_SUPPORT.get()             -> {phone, username, link, note, tgUrl, hasAny}
     YZ_SUPPORT.blockHtml(opts)   -> to'liq panel HTML ("" agar hech narsa yo'q)
     YZ_SUPPORT.inlineHtml()      -> qisqa "📞 … · ✈️ @…" (matn ichига)
     YZ_SUPPORT.mount(hostEl,opt) -> panelни chizadi + STORE.onChange ga ulanadi
*/
(function (root) {
  'use strict';
  var esc = (root.YZ_SAFE && root.YZ_SAFE.esc) || function (s) { return String(s == null ? '' : s); };

  function digits(s) { return String(s == null ? '' : s).replace(/[^\d+]/g, ''); }
  function tgUrlOf(u) {
    if (!u) return '';
    return /^https?:\/\//.test(u) ? u : ('https://t.me/' + String(u).replace(/^@+/, ''));
  }

  /* Joriy kontaktlar — admin O'CHIRGANLARI chiqarib tashlanadi */
  function get() {
    var s = {};
    try { s = (root.STORE && STORE.settings && STORE.settings()) || {}; } catch (e) {}
    /* *_On maydonlari bo'lmasa (eski server) — YOZILGAN bo'lsa ko'rsatamiz */
    var phoneOn = s.supportPhoneOn != null ? !!s.supportPhoneOn : !!s.supportPhone;
    var userOn = s.supportUsernameOn != null ? !!s.supportUsernameOn : !!s.supportUsername;
    var linkOn = s.supportLinkOn != null ? !!s.supportLinkOn : !!s.supportLink;
    var phone = phoneOn ? (s.supportPhone || '') : '';
    /* Telefon yo'q bo'lsa — sayt egasi raqamiga tushamiz (eski xatti-harakat) */
    if (!phone && !s.supportPhone && s.ownerPhone) phone = s.ownerPhone;
    var username = userOn ? (s.supportUsername || '') : '';
    var link = linkOn ? (s.supportLink || '') : '';
    var note = s.supportNote || '';
    var out = {
      phone: phone, username: username, link: link, note: note,
      tgUrl: tgUrlOf(username),
    };
    out.hasAny = !!(phone || username || link);
    return out;
  }

  function rowLink(href, icon, text, color) {
    return '<a href="' + esc(href) + '"' + (/^tel:/.test(href) ? '' : ' target="_blank" rel="noopener"') +
      ' style="display:flex;align-items:center;gap:10px;padding:10px 0;color:' + (color || 'inherit') +
      ';text-decoration:none;font-weight:700;word-break:break-all;border-bottom:1px solid var(--line,#eee)">' +
      '<span style="font-size:17px;flex:none">' + icon + '</span><span>' + esc(text) + '</span></a>';
  }

  /* To'liq panel. opts.title — sarlavha; opts.intro — kirish matni; opts.compact — ramkasiz */
  function blockHtml(opts) {
    var c = get();
    if (!c.hasAny) return '';
    var o = opts || {};
    var rows = '';
    if (c.phone) rows += rowLink('tel:' + digits(c.phone), '📞', c.phone);
    if (c.username) rows += rowLink(c.tgUrl, '✈️', c.username);
    if (c.link && c.link !== c.username) rows += rowLink(c.link, '🔗', c.link, '#2563eb');
    var inner =
      (o.intro !== '' ? '<p style="color:var(--grey);font-size:13px;margin:0 0 4px">' +
        esc(o.intro || 'Savol yoki muammo bo\'lsa — sayt ma\'muriyatiga murojaat qiling:') + '</p>' : '') +
      rows +
      (c.note ? '<p style="color:var(--grey);font-size:12px;margin:8px 0 0">' + esc(c.note) + '</p>' : '');
    if (o.compact) return inner;
    return '<div class="panel" style="margin-bottom:14px"><div class="panel-head"><h3>' +
      esc(o.title || '🆘 Bevosita bog\'lanish') + '</h3></div><div class="panel-body">' + inner + '</div></div>';
  }

  /* Qisqa bir qatorli ko'rinish — mavjud matn ichига qo'shish uchun */
  function inlineHtml() {
    var c = get();
    if (!c.hasAny) return '';
    var parts = [];
    if (c.phone) parts.push('<a href="tel:' + esc(digits(c.phone)) + '" style="color:var(--red,#C8102E);text-decoration:none;font-weight:700;white-space:nowrap">📞 ' + esc(c.phone) + '</a>');
    if (c.username) parts.push('<a href="' + esc(c.tgUrl) + '" target="_blank" rel="noopener" style="color:var(--red,#C8102E);text-decoration:none;font-weight:700;white-space:nowrap">✈️ ' + esc(c.username) + '</a>');
    if (c.link && c.link !== c.username && !c.username && !c.phone) parts.push('<a href="' + esc(c.link) + '" target="_blank" rel="noopener" style="color:#2563eb;text-decoration:none;font-weight:700;word-break:break-all">🔗 ' + esc(c.link) + '</a>');
    return parts.join(' <span style="opacity:.5">·</span> ');
  }

  var subscribed = false;
  var mounts = [];
  function paint() {
    mounts = mounts.filter(function (m) { return m.host && m.host.isConnected !== false; });
    mounts.forEach(function (m) {
      var html = blockHtml(m.opts);
      m.host.innerHTML = html;
      m.host.style.display = html ? '' : 'none';
    });
  }
  function mount(host, opts) {
    if (!host) return;
    mounts.push({ host: host, opts: opts || {} });
    paint();
    if (!subscribed && root.STORE && STORE.onChange) {
      subscribed = true;
      try { STORE.onChange(function () { try { paint(); } catch (e) {} }); } catch (e) {}
    }
  }

  root.YZ_SUPPORT = { get: get, blockHtml: blockHtml, inlineHtml: inlineHtml, mount: mount, repaint: paint };
})(typeof window !== 'undefined' ? window : this);
