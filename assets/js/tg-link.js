/* ===== Panelni Telegram botga ulash — UMUMIY WIDGET =====
   Restoran, kuryer va admin panellari AYNAN shu kodni ishlatadi (uch joyда
   takrorlanmasin). Ish tartibi:
     1) panel serverdan BIR MARTALIK kod oladi (POST /api/tg/link)
     2) foydalanuvchi "Telegramда ochish" tugmasini bosadi (deep-link) yoki
        kodni botga qo'lда yuboradi
     3) bot chat_id ni yozib qo'yadi — buyurtmalar shu chatga kela boshlaydi

   Foydalanish:  YZ_TG.render("hostElementId", STORE, toastFn) */
(function (w) {
  var esc = (w.YZ_SAFE && w.YZ_SAFE.esc) || function (s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };

  function box(html) { return '<div id="yzTgBox">' + html + "</div>"; }

  function note(text, color) {
    return '<div style="background:' + (color === "ok" ? "#ecfdf3" : color === "warn" ? "#fffbeb" : "#f8f7f8") +
      ';border:1px solid ' + (color === "ok" ? "#bbf7d0" : color === "warn" ? "#fde68a" : "#eee") +
      ';border-radius:12px;padding:12px;font-size:14px;color:' +
      (color === "ok" ? "#15803d" : color === "warn" ? "#b45309" : "#555") + '">' + text + "</div>";
  }

  var Y = {
    /* hostId — ichiga chizadigan element id'si; store — STORE; toast — xabar funksiyasi */
    render: function (hostId, store, toast) {
      var host = document.getElementById(hostId);
      if (!host || !store || !store.tgStatus) return;
      var say = toast || function (m) { try { alert(m); } catch (e) {} };

      host.innerHTML = '<p style="color:#888;font-size:13px">Yuklanmoqda...</p>';

      store.tgStatus().then(function (st) {
        if (!st) { host.innerHTML = note("Serverga ulanib bo'lmadi.", "warn"); return; }

        if (!st.botEnabled) {
          host.innerHTML = note("Telegram bot hali sozlanmagan (<b>TG_TOKEN</b> berilmagan). " +
            "Administrator botni ulagach shu yerда kod chiqadi.", "warn");
          return;
        }

        if (st.linked) {
          host.innerHTML = box(
            note("✅ <b>Telegram ulangan.</b> Yangi buyurtmalar va ogohlantirishlar botга kelmoqda.", "ok") +
            '<button class="set-save" id="yzTgUnlink" style="margin-top:12px;background:#9ca3af">Ulanishni uzish</button>'
          );
          var ub = document.getElementById("yzTgUnlink");
          if (ub) ub.addEventListener("click", function () {
            ub.disabled = true;
            store.tgUnlink().then(function (r) {
              if (r && !r.error) { say("Telegram uzildi"); Y.render(hostId, store, toast); }
              else { ub.disabled = false; say((r && r.error) || "Uzib bo'lmadi"); }
            });
          });
          return;
        }

        host.innerHTML = box('<button class="set-save" id="yzTgGet">✈️ Telegramga ulash</button>');
        var gb = document.getElementById("yzTgGet");
        if (gb) gb.addEventListener("click", function () {
          gb.disabled = true; gb.textContent = "Kod olinmoqda...";
          store.tgLink().then(function (r) {
            if (!r || r.error || !r.code) {
              gb.disabled = false; gb.textContent = "✈️ Telegramga ulash";
              say((r && r.error) || "Kod olinmadi");
              return;
            }
            host.innerHTML = box(
              note("Quyidagi tugmani bosing — bot ochiladi va <b>Start</b> bosishingiz kifoya. " +
                "Tugma ishlamasa, kodni botga xabar qilib yuboring.") +
              '<div style="margin:14px 0;text-align:center">' +
                '<div style="font-size:13px;color:#888;margin-bottom:6px">Ulash kodi</div>' +
                '<div style="font-size:30px;font-weight:900;letter-spacing:4px;color:#C8102E">' + esc(r.code) + "</div>" +
              "</div>" +
              (r.url
                ? '<a class="set-save" href="' + esc(r.url) + '" target="_blank" rel="noopener" ' +
                  'style="display:block;text-align:center;text-decoration:none;margin-bottom:10px">✈️ Telegramда ochish</a>'
                : "") +
              '<button class="set-save" id="yzTgDone" style="background:#16a34a">Ulandim — tekshirish</button>'
            );
            var db2 = document.getElementById("yzTgDone");
            if (db2) db2.addEventListener("click", function () { Y.render(hostId, store, toast); });
          });
        });
      });
    },
  };

  w.YZ_TG = Y;
})(window);
