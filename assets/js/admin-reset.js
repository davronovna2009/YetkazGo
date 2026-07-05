/* ===== Admin: "Saytni tozalash" (mustaqil, admin.js'ni buzmaydi) =====
   Bosilganda "rostdan ham mi?" so'raydi. Tasdiqlansa, 3 soatdan keyin backend
   barcha restoran/kuryer/buyurtma/daromadni tozalaydi (faqat ishlash qoladi).
   Ko'rsatkichli countdown + bekor qilish. */
(function () {
  if (!/admin\.html$/i.test(location.pathname)) return;

  function token() { try { return JSON.parse(localStorage.getItem("yz_token") || "null"); } catch (e) { return null; } }
  function hdr() { var t = token(); var h = { "Content-Type": "application/json" }; if (t) h["Authorization"] = "Bearer " + t; return h; }
  async function getPlan() { try { var r = await fetch("/api/admin/reset", { headers: hdr() }); return r.ok ? await r.json() : null; } catch (e) { return null; } }
  async function schedule() { try { var r = await fetch("/api/admin/reset", { method: "POST", headers: hdr() }); return await r.json(); } catch (e) { return null; } }
  async function cancelPlan() { try { await fetch("/api/admin/reset", { method: "DELETE", headers: hdr() }); } catch (e) {} }

  var resetAt = null, timer = null;
  function pad(n) { return String(n).padStart(2, "0"); }
  function fmtLeft(ms) { var s = Math.max(0, Math.floor(ms / 1000)); return pad(Math.floor(s / 3600)) + ":" + pad(Math.floor((s % 3600) / 60)) + ":" + pad(s % 60); }

  function card() {
    var c = document.getElementById("siteResetCard");
    if (c) return c;
    var host = document.querySelector(".content") || document.body;
    c = document.createElement("div"); c.id = "siteResetCard"; c.className = "panel";
    c.style.cssText = "margin:18px 0;border:2px solid #fecaca;background:#fff";
    host.appendChild(c);
    return c;
  }

  function render() {
    var c = card();
    if (resetAt) {
      c.innerHTML = '<div class="panel-body"><div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">' +
        '<span style="font-size:30px">🧹</span>' +
        '<div style="flex:1;min-width:200px"><b style="color:#b91c1c">Saytni tozalash rejalashtirildi</b>' +
        '<div style="color:var(--grey);font-size:13px;margin-top:2px">Qolgan vaqt: <b id="srLeft">' + fmtLeft(resetAt - Date.now()) + '</b> — keyin barcha restoran, kuryer, buyurtma va daromad o\'chadi (faqat ishlash qoladi).</div></div>' +
        '<button id="srCancel" class="set-save" style="background:#374151">Bekor qilish</button>' +
        '</div></div>';
      var b = c.querySelector("#srCancel"); if (b) b.addEventListener("click", async function () { await cancelPlan(); resetAt = null; if (timer) clearInterval(timer); render(); });
    } else {
      c.innerHTML = '<div class="panel-head"><h3>🧹 Saytni tozalash</h3></div><div class="panel-body">' +
        '<p style="color:var(--grey);font-size:13px;margin-bottom:12px">Saytni real restoranga topshirishдан oldin barcha sinov ma\'lumotini tozalang. Bosganingizdан <b>3 soat</b> keyin: restoranlar, kuryerlar, buyurtmalar, daromad, izohlar va e\'lonlar o\'chadi. Kod va admin akkaunti qoladi.</p>' +
        '<button id="srStart" class="set-save" style="background:#C8102E">🧹 Saytni tozalash</button></div>';
      var s = c.querySelector("#srStart"); if (s) s.addEventListener("click", onStart);
    }
  }

  function onStart() {
    var el = document.getElementById("srModal"); if (el) el.remove();
    el = document.createElement("div"); el.id = "srModal";
    el.style.cssText = "position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:18px";
    el.innerHTML = '<div style="background:#fff;border-radius:20px;max-width:430px;width:100%;padding:24px;text-align:center">' +
      '<div style="font-size:44px">⚠️</div><h3 style="margin:8px 0">Rostdan ham saytni tozalaysizmi?</h3>' +
      '<p style="color:var(--grey);font-size:14px;margin-bottom:16px">3 soatдан keyin <b>barcha</b> restoran, kuryer, buyurtma va daromad butunlay o\'chadi (faqat ishlash qoladi). 3 soat ichida bekor qilishingiz mumkin.</p>' +
      '<div style="display:flex;gap:10px"><button id="srNo" class="set-save" style="background:#6b7280;flex:1">Yo\'q</button>' +
      '<button id="srYes" class="set-save" style="background:#C8102E;flex:1">Ha, tozalash</button></div></div>';
    document.body.appendChild(el);
    el.querySelector("#srNo").addEventListener("click", function () { el.remove(); });
    el.addEventListener("click", function (e) { if (e.target === el) el.remove(); });
    el.querySelector("#srYes").addEventListener("click", async function () {
      var r = await schedule(); el.remove();
      if (r && r.resetAt) { resetAt = r.resetAt; startTimer(); render(); }
    });
  }

  function startTimer() {
    if (timer) clearInterval(timer);
    timer = setInterval(function () {
      if (!resetAt) { clearInterval(timer); return; }
      var left = resetAt - Date.now();
      var el = document.getElementById("srLeft"); if (el) el.textContent = fmtLeft(left);
      if (left <= 0) { clearInterval(timer); resetAt = null; render(); try { location.reload(); } catch (e) {} }
    }, 1000);
  }

  async function boot() {
    var p = await getPlan();
    if (p && p.resetAt) { resetAt = p.resetAt; startTimer(); }
    render();
  }
  document.addEventListener("DOMContentLoaded", function () { setTimeout(boot, 1200); });
})();
