/* ===== Yetkaz.uz — SHIKOYAT oynasi (restoran + kuryer uchun yagona) =====
   Restoran va kuryer o'z panelidan adminga shikoyat yuboradi va o'z
   shikoyatlari holatini (admin javobi bilan) ko'radi.

   Ishlatish:
     YZ_COMPLAINT.mount(hostElement)   — formani va ro'yxatni chizadi
   STORE metodlari orqali ishlaydi (store.js): sendComplaint, fetchComplaints. */
(function (root) {
  'use strict';
  var esc = (root.YZ_SAFE && root.YZ_SAFE.esc) || function (s) { return String(s == null ? '' : s); };

  var TOPICS = [
    { k: 'mijoz', t: '👤 Mijoz' }, { k: 'kuryer', t: '🛵 Kuryer' },
    { k: 'restoran', t: '🏪 Restoran' }, { k: 'tolov', t: '💳 To\'lov' },
    { k: 'texnik', t: '🔧 Texnik muammo' }, { k: 'boshqa', t: '📌 Boshqa' },
  ];
  var TOPIC_MAP = {}; TOPICS.forEach(function (x) { TOPIC_MAP[x.k] = x.t; });

  function toast(m) {
    var e = document.getElementById('toast2');
    if (e) { e.textContent = m; e.classList.add('show'); setTimeout(function () { e.classList.remove('show'); }, 2600); }
  }

  function fmt(c) {
    try { return (root.YZ_TIME && YZ_TIME.fmtDateTime(c.created_at)) || c.created_at || ''; }
    catch (e) { return c.created_at || ''; }
  }

  function statusPill(c) {
    if (c.status === 'closed') return '<span class="pill ok">✅ Yopilgan</span>';
    if (c.reply) return '<span class="pill blue">↩ Admin javob berdi</span>';
    if (c.status === 'seen') return '<span class="pill warn">👁 Ko\'rildi</span>';
    return '<span class="pill warn">⏳ Ko\'rib chiqilmoqda</span>';
  }

  /* «Bevosita bog'lanish» bloki — YAGONA manba: assets/js/support.js (YZ_SUPPORT).
     Admin «Sozlamalar»да yozib qo'ygan telefon/username/havola. */
  function contactBlock() {
    if (root.YZ_SUPPORT && YZ_SUPPORT.blockHtml) {
      return YZ_SUPPORT.blockHtml({
        title: '🆘 Bevosita bog\'lanish',
        intro: 'Tezkor yordam kerak bo\'lsa — sayt ma\'muriyatiga to\'g\'ridan-to\'g\'ri murojaat qiling:',
      });
    }
    return '';
  }

  function render(host) {
    if (!host) return;
    host.innerHTML =
      contactBlock() +
      '<div class="panel" style="margin-bottom:14px"><div class="panel-head"><h3>📣 Adminga shikoyat / murojaat</h3></div>' +
      '<div class="panel-body">' +
        '<p style="color:var(--grey);font-size:13px;margin:0 0 12px">Muammo yoki taklifingizni yozing — sayt ma\'muriyati ko\'rib javob beradi.</p>' +
        '<div class="add-field"><label>Mavzu</label><select id="cmpTopic" style="width:100%;padding:11px 12px;border:1px solid var(--line);border-radius:12px;font-size:14px;font-family:inherit">' +
          TOPICS.map(function (x) { return '<option value="' + x.k + '">' + x.t + '</option>'; }).join('') +
        '</select></div>' +
        '<div class="add-field"><label>Buyurtma raqami (ixtiyoriy)</label><input id="cmpOrder" inputmode="numeric" placeholder="Masalan: 128"></div>' +
        '<div class="add-field"><label>Shikoyat matni</label><textarea id="cmpText" rows="4" placeholder="Muammoni batafsil yozing..." style="width:100%;box-sizing:border-box;border:1px solid var(--line);border-radius:12px;padding:10px;font-size:14px;resize:vertical;font-family:inherit"></textarea></div>' +
        '<button class="set-save" id="cmpSend">📤 Yuborish</button>' +
      '</div></div>' +
      '<div class="panel"><div class="panel-head"><h3>Mening shikoyatlarim</h3><span id="cmpCount" style="color:var(--grey);font-size:13px"></span></div>' +
      '<div class="panel-body" id="cmpList"><p style="color:var(--grey)">Yuklanmoqda...</p></div></div>';

    var sendBtn = host.querySelector('#cmpSend');
    if (sendBtn) sendBtn.addEventListener('click', function () { submit(host); });
    load(host);
  }

  function submit(host) {
    var topic = (host.querySelector('#cmpTopic') || {}).value || 'boshqa';
    var text = ((host.querySelector('#cmpText') || {}).value || '').trim();
    var orderId = parseInt(((host.querySelector('#cmpOrder') || {}).value || '').replace(/\D/g, ''), 10) || 0;
    if (text.length < 5) { toast('Shikoyat matnini to\'liqroq yozing'); return; }
    var btn = host.querySelector('#cmpSend'); if (btn) btn.disabled = true;
    (root.STORE && STORE.sendComplaint ? STORE.sendComplaint({ topic: topic, text: text, orderId: orderId }) : Promise.resolve({ error: 'Tizim tayyor emas' }))
      .then(function (r) {
        if (btn) btn.disabled = false;
        if (r && !r.error) {
          toast('Shikoyat yuborildi ✓ — admin ko\'rib chiqadi');
          var t = host.querySelector('#cmpText'); if (t) t.value = '';
          var o = host.querySelector('#cmpOrder'); if (o) o.value = '';
          load(host);
        } else toast((r && r.error) || 'Yuborib bo\'lmadi');
      });
  }

  function load(host) {
    if (!(root.STORE && STORE.fetchComplaints)) return;
    STORE.fetchComplaints().then(function (list) {
      list = Array.isArray(list) ? list : [];
      var box = host.querySelector('#cmpList'); if (!box) return;
      var cnt = host.querySelector('#cmpCount'); if (cnt) cnt.textContent = list.length + ' ta';
      if (!list.length) { box.innerHTML = '<p style="color:var(--grey)">Hali shikoyat yubormagansiz.</p>'; return; }
      box.innerHTML = list.map(function (c) {
        return '<div style="border:1px solid var(--line);border-radius:12px;padding:12px;margin-bottom:10px">' +
          '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px"><b>' + esc(TOPIC_MAP[c.topic] || c.topic) + '</b>' + statusPill(c) +
          (c.orderId ? '<span style="color:var(--grey);font-size:12px">buyurtma #' + c.orderId + '</span>' : '') + '</div>' +
          '<div style="font-size:14px;white-space:pre-wrap">' + esc(c.text) + '</div>' +
          '<div style="color:var(--grey);font-size:12px;margin-top:4px">' + esc(fmt(c)) + '</div>' +
          (c.reply ? '<div style="background:#eff6ff;border-left:3px solid #2563eb;border-radius:8px;padding:8px 11px;margin-top:8px;font-size:13px"><b style="color:#1d4ed8">↩ Admin javobi:</b> ' + esc(c.reply) + '</div>' : '') +
          '</div>';
      }).join('');
    });
  }

  root.YZ_COMPLAINT = { mount: render, reload: load };
})(typeof window !== 'undefined' ? window : this);
