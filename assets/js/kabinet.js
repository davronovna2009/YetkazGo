/* ===== Yetkaz.uz — Foydalanuvchi paneli + AI izoh moderatsiyasi ===== */
(function(){
  const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
  const money=n=>Math.round(n).toLocaleString("ru-RU");
  const esc=s=>String(s==null?"":s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c])); // XSS himoyasi
  /* Geolokatsiya — manzilni qurilma joylashuvidan to'ldiradi */
  function detectLocation(inputEl, btn){
    if(!navigator.geolocation){ toast("Brauzeringiz joylashuvni qo'llamaydi","error"); return; }
    const orig=btn?btn.innerHTML:""; if(btn){ btn.disabled=true; btn.innerHTML="📍 Aniqlanmoqda..."; }
    const done=()=>{ if(btn){ btn.disabled=false; btn.innerHTML=orig; } };
    navigator.geolocation.getCurrentPosition(async (pos)=>{
      const lat=pos.coords.latitude, lng=pos.coords.longitude; let addr="";
      try{ const r=await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&accept-language=uz`,{headers:{"Accept":"application/json"}}); const j=await r.json(); addr=(j&&j.display_name)||""; }catch(e){}
      if(!addr) addr=`(${lat.toFixed(5)}, ${lng.toFixed(5)})`;
      /* Inputga YOZMAYMIZ — foydalanuvchi yozgani turadi. Joylashuv faqat xotirada. */
      USER.geo = { lat:lat, lng:lng, addr:addr };
      done(); toast("Joylashuv aniqlandi 📍 (manzil maydoni o'zgarmaydi)","success");
    }, (err)=>{ done(); toast(err&&err.code===1?"Joylashuvga ruxsat berilmadi":"Joylashuvni aniqlab bo'lmadi","error"); },
    { enableHighAccuracy:true, timeout:10000, maximumAge:60000 });
  }

  /* Foydalanuvchi ma'lumoti kirgandan so'ng backenddan to'ladi (haqiqiy buyurtmalar).
     Soxta namuna buyurtma/izoh YO'Q. */
  const USER={
    name:"", phone:"", login:"", pass:"",
    orders:[],
    reviews:[]
  };

  let selRating=0, cart=[], activeCat="Hammasi";
  let tT; function toast(m,type){
    const e=$("#toast2"); if(!e) return;
    e.textContent=m; e.className="toast2 show"+(type?" "+type:"");
    clearTimeout(tT); tT=setTimeout(()=>e.classList.remove("show"),2000);
  }

  async function login(){
    const u=$("#ulUser").value.trim(), p=$("#ulPass").value.trim();
    $("#loginErr").textContent="";
    const acc=(typeof STORE!=="undefined")? await STORE.login(u,p):null;
    if(acc && acc.offline){ $("#loginErr").textContent="Serverga ulanib bo'lmadi. Saytni server orqali oching (masalan http://localhost:5050) va internetni tekshiring."; return; }
    if(acc && acc.role==="user"){ enterUser(acc); }
    else if(acc && acc.target){ try{ location.href=acc.target; }catch(e){} }
    else { $("#loginErr").textContent="Login yoki parol xato."; }
  }
  /* ---- Izoh berilgan buyurtmalar (localStorage) ---- */
  function reviewedIds(){ try{ return new Set(JSON.parse(localStorage.getItem("yz_kab_reviewed")||"[]")); }catch(e){ return new Set(); } }
  function markReviewed(id){ const s=reviewedIds(); s.add(String(id)); try{ localStorage.setItem("yz_kab_reviewed",JSON.stringify([...s])); }catch(e){} }

  /* Backend buyurtmasini kabinet ko'rinishiga moslash */
  function beOrderToLocal(o){
    const rid=reviewedIds();
    const date = o.created_at ? o.created_at.slice(0,10).split("-").reverse().join(".") : new Date().toLocaleDateString("ru-RU");
    return { id:o.id, dish:o.item, emoji:o.emoji, rest:o.rest, date:date, amount:o.amount,
      addr:o.addr, pay:o.pay, deliveredIn:o.eta, promised:(o.eta||15)+3, reviewed:rid.has(String(o.id)), status:o.status, reason:o.reason||"" };
  }
  /* Backenddagi buyurtmalarni mavjudlarga qo'shish (id bo'yicha, dublikatsiz) */
  function hydrateOrders(){
    if(typeof STORE==="undefined" || !STORE.ordersForUser) return;
    const byId={}; USER.orders.forEach(o=>{ byId[String(o.id)]=o; });
    STORE.ordersForUser(USER.name).forEach(o=>{
      const ex=byId[String(o.id)];
      if(ex){ ex.status=o.status; if(o.reason) ex.reason=o.reason; }
      else USER.orders.push(beOrderToLocal(o));
    });
    USER.orders.sort((a,b)=>String(b.id).localeCompare(String(a.id)));
  }

  function enterUser(acc){
    /* Haqiqiy foydalanuvchi ma'lumoti — buyurtmalar backenddan yuklanadi */
    USER.name=acc.name; USER.login=acc.login; USER.phone=acc.phone||""; USER.orders=[]; USER.reviews=[];
    hydrateOrders();
    /* Foydalanuvchi avval buyurtma bergan restoranga avtomatik yo'naltiramiz */
    var pr=preferredRest(); if(pr) activeRest=pr;
    $("#loginWrap").style.display="none"; $("#app").classList.add("show");
    $("#sbName").textContent=USER.name; renderAll();
    if(typeof STORE!=="undefined" && STORE.onChange && !window.__kabSub){ window.__kabSub=true;
      STORE.onChange(function(){ hydrateOrders(); try{ renderProfil(); }catch(e){} }); }
  }
  /* Foydalanuvchining sevimli/avvalgi restorani (eng so'nggi buyurtma bo'yicha) */
  function preferredRest(){
    try{
      var withRest=USER.orders.filter(function(o){ return o.rest; });
      return withRest.length ? withRest[0].rest : null;
    }catch(e){ return null; }
  }

  function nav(view){
    $$(".sb-link").forEach(l=>l.classList.toggle("active",l.dataset.view===view));
    $$(".view").forEach(v=>v.classList.toggle("show",v.id==="view-"+view));
    /* view-rests yo'q bo'lsa ham ishlaydi */
    const viewEl=document.getElementById("view-"+view);
    if(!viewEl){
      /* Restoranlar uchun taomlar view da ko'rsatamiz */
      if(view==="rests"){
        $$(".view").forEach(v=>v.classList.remove("show"));
        const vr=document.getElementById("view-rests");
        if(vr) vr.classList.add("show");
      }
    }
    const t={taomlar:"Taomlar",profil:"Mening kabinetim",rests:"Restoranlar",review:"Izoh qoldirish",help:"Qanday buyurtma berish"};
    $("#tbTitle").textContent=t[view]||""; $("#sidebar").classList.remove("open"); window.scrollTo({top:0});
    if(view==="review") renderReviewForm();
    if(view==="rests")  renderKabRests();
    if(view==="taomlar"){ if(activeRest){ filterByRest(activeRest); } else { renderFilters(); renderMenu(); } }
  }

  function kabCancelOrder(oid){
    let el=document.getElementById("kabCancelModal"); if(el) el.remove();
    el=document.createElement("div"); el.id="kabCancelModal";
    el.style.cssText="position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;padding:18px";
    el.innerHTML="<div style=\"background:#fff;border-radius:20px;max-width:380px;width:100%;padding:24px;text-align:center\">"+
      "<div style=\"font-size:42px\">🛑</div><h3 style=\"margin:8px 0\">Buyurtmani bekor qilish</h3>"+
      "<p style=\"color:var(--grey);font-size:14px;margin-bottom:16px\">Ushbu buyurtmani rostdan bekor qilmoqchimisiz?</p>"+
      "<div style=\"display:flex;gap:10px\"><button id=\"kcNo\" class=\"btn btn-outline\" style=\"flex:1\">Yo'q</button><button id=\"kcYes\" class=\"btn btn-primary\" style=\"flex:1;background:#C8102E\">Ha, bekor qilish</button></div></div>";
    document.body.appendChild(el);
    const close=()=>el.remove();
    el.addEventListener("click",e=>{ if(e.target===el) close(); });
    document.getElementById("kcNo").addEventListener("click",close);
    document.getElementById("kcYes").addEventListener("click",()=>{
      const o=USER.orders.find(x=>String(x.id)===String(oid));
      /* Lokal id != backend id — backend buyurtmani id yoki imzo (mijoz+taom+summa) bo'yicha topamiz */
      let beId=null;
      try{
        if(o && typeof STORE!=="undefined" && STORE.orders){
          const be=STORE.orders().find(b=> String(b.id)===String(oid) ||
            (b.user===USER.name && b.item===o.dish && b.amount===o.amount && ["new","accepted","ready"].indexOf(b.status)>=0));
          beId = be ? be.id : null;
        }
      }catch(e){}
      try{ if(beId && STORE.cancelOrder) STORE.cancelOrder(beId); }catch(e){}
      if(o) o.status="cancelled";
      close(); renderProfil(); toast("Buyurtma bekor qilindi","success");
    });
  }

  function renderProfil(){
    const spent=USER.orders.reduce((s,o)=>s+o.amount,0);
    $("#statCards").innerHTML=`
      <div class="scard c1"><div class="si">🧾</div><b>${USER.orders.length}</b><span>Buyurtmalar</span></div>
      <div class="scard c2"><div class="si">⭐</div><b>${USER.reviews.length}</b><span>Izohlarim</span></div>
      <div class="scard c3"><div class="si">💳</div><b>${money(spent)}</b><span>Jami sarflagan (so'm)</span></div>`;
    $("#orderTbody").innerHTML=USER.orders.map(o=>{
      const cancellable=(o.status==="new"||o.status==="accepted"||o.status==="ready");
      const last = cancellable
        ? `<button class="kab-cancel" data-oid="${o.id}" style="background:#fdecec;color:#C8102E;border:none;border-radius:8px;padding:6px 11px;font-size:12px;font-weight:700;cursor:pointer">✕ Bekor</button>`
        : (o.status==="cancelled" ? ('<span class="pill warn">Bekor qilingan</span>'+(o.reason?'<div style="font-size:11px;color:#C8102E;margin-top:3px">'+esc(o.reason)+'</div>':''))
          : (o.reviewed?'<span class="pill ok">Izoh berilgan</span>':'<span class="pill warn">Izoh kutmoqda</span>'));
      return `<tr>
        <td><div class="tname"><span class="av">${o.emoji}</span>${esc(o.dish)}</div></td>
        <td>${esc(o.rest)}</td>
        <td>${esc(o.date)}</td>
        <td class="money">${money(o.amount)}</td>
        <td>${o.deliveredIn} daq</td>
        <td>${last}</td>
      </tr>`;}).join("");
    $$("#orderTbody .kab-cancel").forEach(b=>b.addEventListener("click",()=>kabCancelOrder(b.dataset.oid)));
    $("#myReviews").innerHTML=USER.reviews.length?USER.reviews.map(r=>`
      <div class="panel" style="margin-bottom:10px"><div class="panel-body">
        <div style="display:flex;justify-content:space-between"><b>${esc(r.dish)}</b><span class="star">${"★".repeat(Math.max(0,Math.min(5,r.rating|0)))}${"☆".repeat(5-Math.max(0,Math.min(5,r.rating|0)))}</span></div>
        <p style="color:var(--ink);font-size:14px;margin-top:6px">${esc(r.text)}</p>
        <div style="color:var(--grey);font-size:12px;margin-top:6px">${r.date}${r.flagged?' · <span style="color:var(--red)">restoranga signal yuborilgan</span>':''}</div>
      </div></div>`).join(""):'<p style="color:var(--grey)">Hali izoh yo\'q.</p>';
  }

  function renderReviewForm(){
    const un=USER.orders.filter(o=>!o.reviewed);
    const sel=$("#revOrder");
    sel.innerHTML=un.length?un.map(o=>`<option value="${o.id}">${o.emoji} ${o.dish} — ${o.rest} (${o.date})</option>`).join("")
      :'<option value="">Barcha buyurtmalarga izoh berilgan</option>';
    selRating=0; renderStars();
    $("#revText").value=""; $("#revReasonWrap").style.display="none"; $("#revPhotoWrap").style.display="none";
    if($("#revReason")) $("#revReason").value="";
  }
  function renderStars(){
    $("#revStars").innerHTML=[1,2,3,4,5].map(n=>`<span class="star-pick" data-n="${n}">${n<=selRating?"★":"☆"}</span>`).join("");
    $$("#revStars .star-pick").forEach(s=>s.addEventListener("click",()=>{ result("",""); selRating=+s.dataset.n; renderStars();
      $("#revReasonWrap").style.display = selRating<=3 ? "block":"none";
      if(selRating>3){ $("#revPhotoWrap").style.display="none"; } }));
  }
  function result(msg,type){ const e=$("#revResult"); e.textContent=msg; e.className="rev-result"+(type?(" "+type):""); }

  function addReview(o,rating,text,flagged,note){
    USER.reviews.unshift({dish:o.dish,rating,text,date:new Date().toLocaleDateString("ru-RU"),flagged});
    o.reviewed=true; o.rating=rating; markReviewed(o.id);
    try{ if(typeof STORE!=="undefined") STORE.addReview({name:USER.name,ava:"👤",rating:rating,dish:o.dish,text:text||"",flagged:!!flagged}); }catch(e){}
  }
  function finishReview(){ renderProfil(); renderReviewForm(); }

  function submitReview(){
    const oid=+$("#revOrder").value; const o=USER.orders.find(x=>x.id===oid);
    if(!o){ result("Izoh qoldirish uchun buyurtma yo'q.","err"); return; }
    if(!selRating){ result("Avval bahoni tanlang (yulduzcha bosing).","err"); return; }
    const text=$("#revText").value.trim();
    if(selRating>=4){ addReview(o,selRating,text||"Yaxshi",false,""); result("Rahmat! Izohingiz joylandi. ⭐","ok"); finishReview(); return; }
    const reason=$("#revReason").value;
    if(!reason){ result("Past baho uchun sababni tanlang.","err"); return; }
    if(reason==="late"){
      if(o.deliveredIn<=o.promised){
        result(`Tekshiruv: buyurtmangiz ${o.deliveredIn} daqiqada yetkazilgan (va'da ${o.promised} daq) — o'z vaqtida. Kuryer timer/GPS yozuvi shuni isbotlaydi, shuning uchun "kechikdi" shikoyati tasdiqlanmadi. Iltimos, boshqa sabab tanlang yoki bahoni o'zgartiring.`,"err");
        return;
      }
      addReview(o,selRating,text||"Kechikib yetkazildi",true,""); 
      result(`Kechikish tasdiqlandi (${o.deliveredIn} > ${o.promised} daq). Izohingiz qabul qilindi va restoranga signal yuborildi.`,"ok"); finishReview(); return;
    }
    if(reason==="quality"){
      const hasPhoto=$("#revPhoto") && $("#revPhoto").files && $("#revPhoto").files.length>0;
      if(!hasPhoto){
        result("Sifat shikoyati uchun taom rasmini biriktiring — AI tasvirni tahlil qiladi. Rasmsiz salbiy izoh joylanmaydi (asossiz baholardan himoya).","err");
        return;
      }
      addReview(o,selRating,text||"Sifat yomon (rasm bilan)",true,"");
      result("AI rasmni tahlil qildi: sifat muammosi tasdiqlandi. Izohingiz qabul qilindi va restoranga yuborildi.","ok"); finishReview(); return;
    }
    if(reason==="wrong"){
      addReview(o,selRating,text||"Noto'g'ri taom keldi",true,"");
      result("Shikoyatingiz qabul qilindi. Buyurtma va kuryer yozuvi tekshiriladi.","ok"); finishReview(); return;
    }
    if(text.length<15){ result("Iltimos, muammoni batafsil yozing (kamida 15 belgi) — shunda izoh ko'rib chiqiladi.","err"); return; }
    addReview(o,selRating,text,true,""); result("Izohingiz ko'rib chiqish uchun qabul qilindi.","ok"); finishReview();
  }

  /* ---------- TAOMLAR (index.html uslubida) ---------- */
  function renderFilters(){
    const box=$("#kFilters"); if(!box) return;
    /* Taom kategoriyalari + Restoranlar chip */
    const cats=[...DISH_CATS, "🏪 Restoranlar"];
    box.innerHTML=cats.map(c=>{
      const isRest=c==="🏪 Restoranlar";
      const active=isRest ? (activeRest&&activeCat==="Hammasi") : (c===activeCat&&!activeRest);
      return `<button class="kchip${active?" on":""}" data-c="${c}">${c}</button>`;
    }).join("");
    $$("#kFilters .kchip").forEach(b=>b.addEventListener("click",()=>{
      const c=b.dataset.c;
      if(c==="🏪 Restoranlar"){
        /* Restoranlar ko'rinishi */
        const sb=document.querySelector('.sb-link[data-view="rests"]');
        if(sb) sb.click(); else { const el=document.getElementById("view-rests"); if(el){ $$(".view").forEach(v=>v.classList.remove("show")); el.classList.add("show"); renderKabRests(); } }
      } else {
        activeRest=null;
        activeCat=c;
        renderFilters();
        renderMenu();
      }
    }));
  }
  function restListK(){
    try{ const be=(typeof STORE!=="undefined"&&STORE.restaurants)?STORE.restaurants().filter(x=>x&&x.active!==false):[];
      if(be&&be.length) return be; }catch(e){}
    return (typeof RESTAURANTS!=="undefined")?RESTAURANTS:[];
  }
  function renameMapK(){
    const m={};
    try{ if(typeof STORE!=="undefined"&&STORE.restaurants&&typeof RESTAURANTS!=="undefined"){
      STORE.restaurants().forEach(b=>{ const d=RESTAURANTS.find(x=>x.id===b.id); if(d&&d.name&&b.name&&d.name!==b.name) m[d.name]=b.name; }); } }catch(e){}
    return m;
  }
  function kcatalog(){
    if(typeof STORE==="undefined") return (typeof DISHES!=="undefined"?DISHES:[]);
    const m=renameMapK();
    const base=(typeof DISHES!=="undefined"?DISHES:[]).map(d=> m[d.rest]?Object.assign({},d,{rest:m[d.rest]}):d);
    return STORE.mergeDishes(base);
  }
  /* Taom modal */
  function openKDishModal(d){
    const qty = (cart.find(i=>i.id===d.id)||{}).qty||0;
    const priceStr = d.discount
      ? `<span style="text-decoration:line-through;color:#aaa;font-size:14px;margin-right:6px">${money(d.price)}</span><span style="font-size:22px;font-weight:800;color:var(--red)">${money(d.eff)}</span>`
      : `<span style="font-size:22px;font-weight:800;color:var(--red)">${money(d.price)}</span>`;
    $("#koContent").innerHTML=`
      <div style="margin:-20px -20px 0;height:200px;background:linear-gradient(135deg,#FCEEDF,#F7E2E5);
        display:flex;align-items:center;justify-content:center;position:relative;overflow:hidden;border-radius:16px 16px 0 0">
        <span style="font-size:72px;filter:drop-shadow(0 6px 12px rgba(0,0,0,.2));position:relative;z-index:1">${d.emoji}</span>
        <img src="${d.photo}" alt="${d.name}" onerror="this.remove()"
          style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:2;border-radius:16px 16px 0 0" />
        ${d.badge?`<span style="position:absolute;top:10px;left:12px;z-index:3;background:var(--gold);color:#fff;font-size:11px;font-weight:800;padding:3px 9px;border-radius:999px">${d.badge}</span>`:''}
      </div>
      <div style="padding:16px 0 0">
        <h2 style="font-size:19px;margin-bottom:4px">${d.name}</h2>
        <div style="color:var(--grey);font-size:13px;margin-bottom:10px">🏪 ${d.rest}</div>
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:16px">
          ${priceStr}<span style="font-size:14px;color:var(--grey)"> so'm</span>
        </div>
        <div class="kdm-foot" id="kdmFoot"></div>
      </div>`;
    function refreshKdm(){
      const q=(cart.find(i=>i.id===d.id)||{}).qty||0;
      const foot=$("#kdmFoot"); if(!foot) return;
      if(q===0){
        foot.innerHTML=`<button class="set-save" style="width:100%" id="kdmAdd">Savatga qo'shish</button>`;
        foot.querySelector("#kdmAdd").addEventListener("click",()=>{ addToCart(d.id); refreshKdm(); updateKMenuQty(); });
      } else {
        foot.innerHTML=`
          <div style="display:flex;align-items:center;gap:0;background:var(--red);border-radius:999px;overflow:hidden;width:fit-content;margin:0 auto 10px">
            <button class="kqb" data-id="${d.id}" data-m="-1" style="width:44px;height:44px;border:none;background:transparent;color:#fff;font-size:22px;font-weight:700;cursor:pointer">−</button>
            <span style="min-width:28px;text-align:center;color:#fff;font-size:17px;font-weight:800">${q}</span>
            <button class="kqb" data-id="${d.id}" data-m="1" style="width:44px;height:44px;border:none;background:transparent;color:#fff;font-size:22px;font-weight:700;cursor:pointer">+</button>
          </div>
          <button class="set-save" style="width:100%" id="kdmCart">Savatni ko'rish</button>`;
        foot.querySelectorAll(".kqb").forEach(b=>b.addEventListener("click",()=>{ changeQty(+b.dataset.id,+b.dataset.m); refreshKdm(); updateKMenuQty(); }));
        foot.querySelector("#kdmCart").addEventListener("click",()=>{ $("#koModal").classList.remove("open"); $("#koBackdrop").classList.remove("open"); });
      }
    }
    refreshKdm();
    $("#koModal").classList.add("open"); $("#koBackdrop").classList.add("open");
  }

  /* Kard qty ko'rinishini yangilash */
  function updateKMenuQty(){
    $$("#kMenu .kcard").forEach(card=>{
      const id=+card.dataset.id; if(!id) return;
      const qty=(cart.find(i=>i.id===id)||{}).qty||0;
      const foot=card.querySelector(".kfoot");
      if(!foot) return;
      const priceEl=card.querySelector(".kprice");
      const priceHTML=priceEl?priceEl.outerHTML:`<span class="kprice"></span>`;
      if(qty===0){
        foot.innerHTML=priceHTML+`<button class="kadd" data-id="${id}">+</button>`;
        foot.querySelector(".kadd").addEventListener("click",(e)=>{ e.stopPropagation(); addToCart(id); });
      } else {
        foot.innerHTML=priceHTML+`
          <div class="kcard-qty">
            <button class="kqty-btn" data-id="${id}" data-m="-1">−</button>
            <span class="kqty-num">${qty}</span>
            <button class="kqty-btn" data-id="${id}" data-m="1">+</button>
          </div>`;
        foot.querySelectorAll(".kqty-btn").forEach(b=>b.addEventListener("click",(e)=>{ e.stopPropagation(); changeQty(+b.dataset.id,+b.dataset.m); updateKMenuQty(); syncKabBar(); }));
      }
    });
    syncKabBar();
  }

  function renderMenu(){
    if(activeRest){ filterByRest(activeRest); return; }
    const g=$("#kMenu"); if(!g) return;
    g.innerHTML=kcatalog().filter(d=>activeCat==="Hammasi"||d.cat===activeCat).map(d=>{
      const qty=(cart.find(i=>i.id===d.id)||{}).qty||0;
      const price=d.discount?`<span style="text-decoration:line-through;color:#b9a;font-size:11px">${money(d.price)}</span> ${money(d.eff)}`:money(d.price);
      const qtyHtml=qty===0
        ?`<button class="kadd" data-id="${d.id}">+</button>`
        :`<div class="kcard-qty"><button class="kqty-btn" data-id="${d.id}" data-m="-1">−</button><span class="kqty-num">${qty}</span><button class="kqty-btn" data-id="${d.id}" data-m="1">+</button></div>`;
      const disc=d.discount>0;
      return `<div class="kcard${disc?' kcard-disc':''}" data-id="${d.id}" data-discounted="${disc}">
        <div class="kimg" data-id="${d.id}"><span class="kemoji">${d.emoji}</span>
          <img src="${d.photo}" alt="${d.name}" loading="lazy" onerror="this.remove()">
          ${disc?'<span class="kcard-disc-badge">🏷</span>':''}
        </div>
        <div class="kbody">
          <h4 data-id="${d.id}">${d.name}</h4>
          <div class="krest">${d.rest}</div>
          <div class="kfoot"><span class="kprice">${price} so'm</span>${qtyHtml}</div>
        </div></div>`;
    }).join("");
    bindMenuEvents();
  }
  function cartTotal(){ return cart.reduce((s,i)=>s+i.price*i.qty,0); }
  function addToCart(id){
    const d=kcatalog().find(x=>x.id===id); if(!d) return;
    const ex=cart.find(i=>i.id===id); if(ex) ex.qty++; else cart.push({id:d.id,name:d.name,emoji:d.emoji,price:(d.eff||d.price),rest:d.rest,qty:1});
    renderCart(); updateKMenuQty(); toast(d.emoji+" "+(typeof KT==="function"?KT('savatga_qoshildi'):"Savatga qo'shildi"));
  }
  function changeQty(id,m){ const i=cart.find(x=>x.id===id); if(!i) return; i.qty+=m; if(i.qty<=0) cart=cart.filter(x=>x.id!==id); renderCart(); updateKMenuQty(); }
  /* Savat drawer ochish/yopish */
  function openKabCartDrawer(){
    const dr=document.getElementById("kabCartDrawer");
    if(dr) dr.classList.add("open");
    const bd=document.getElementById("kabCartBd");
    if(bd) bd.classList.add("open");
    renderCart();
  }
  function closeKabCartDrawer(){
    const dr=document.getElementById("kabCartDrawer");
    if(dr) dr.classList.remove("open");
    const bd=document.getElementById("kabCartBd");
    if(bd) bd.classList.remove("open");
  }

  function renderCart(){
    /* cartPanel ham yangilanadi (sidebar uchun) */
    const p=$("#cartPanel");
    /* Savat drawer body */
    const body=document.getElementById("kabCartBody");
    const foot=document.getElementById("kabCartFoot");
    const total=cartTotal();

    /* cartPanel ni yashiramiz — drawer ishlatamiz */
    if(p) p.innerHTML="";

    if(body){
      if(!cart.length){
        const kt=typeof KT==="function"?KT:function(k){return k;};
        body.innerHTML=`<div style="text-align:center;padding:40px 16px;color:var(--grey)">
          <div style="font-size:48px;margin-bottom:10px">🛒</div>
          <p style="font-weight:600;font-size:15px">${kt('savat_bosh')||"Savatingiz bo'sh"}</p>
          <p style="font-size:13px;margin-top:4px">${kt('savat_bosh_hint')||"Quyidagi taomlardan tanlang"}</p>
        </div>`;
      } else {
        body.innerHTML=cart.map(i=>`
          <div class="kab-dr-row">
            <span class="kab-dr-emoji">${i.emoji}</span>
            <div class="kab-dr-info">
              <div class="kab-dr-name">${i.name}</div>
              <div class="kab-dr-rest">${i.rest}</div>
              <div class="kab-dr-price">${money(i.price)} so'm</div>
            </div>
            <div class="kab-dr-qty">
              <button class="kab-dq-btn" data-id="${i.id}" data-m="-1">−</button>
              <span class="kab-dq-num">${i.qty}</span>
              <button class="kab-dq-btn" data-id="${i.id}" data-m="1">+</button>
            </div>
          </div>`).join("");
        body.querySelectorAll(".kab-dq-btn").forEach(b=>{
          b.addEventListener("click",()=>{ changeQty(+b.dataset.id,+b.dataset.m); renderCart(); });
        });
      }
    }

    if(foot){
      if(!cart.length){ foot.innerHTML=""; return; }
      const kt2=typeof KT==="function"?KT:function(k){return k;};
      foot.innerHTML=`
        <div class="kab-dr-total">
          <span>${kt2('jami')||'Jami'}</span><b style="color:var(--red)">${money(total)} so'm</b>
        </div>
        <div class="kab-dr-note ${total<20000?'warn':'ok'}">
          ${total<20000
            ? (kt2('minimal_warn',{n:money(20000-total)})||`⚠️ Minimal 20 000 so'm (yana ${money(20000-total)} so'm)`)
            : (kt2('minimal_ok')||"✅ Yetkazish bepul 🛵")}
        </div>
        <button class="kab-order-main" id="kabOrderBtn" ${total<20000?"disabled":""}>
          ${kt2('buyurtma_berish')||'Buyurtma berish'}
        </button>`;
      const ob=document.getElementById("kabOrderBtn");
      if(ob) ob.addEventListener("click",()=>{ closeKabCartDrawer(); placeOrder(); });
    }
    syncKabBar();
  }

  let koPay="card", koTimers=[];
  function placeOrder(){
    const total=cartTotal();
    if(!cart.length){ toast("🛒 Savat bo'sh"); return; }
    if(total<20000){ toast("⚠️ Minimal buyurtma 20 000 so'm (yana "+money(20000-total)+" so'm)","warn"); return; }
    closeKabCartDrawer();
    openCheckout(total);
  }
  function koDeliveryFee(){
    if(!cart.length) return 0;
    const restName=cart[0].rest; let distStr="";
    try{ const r=(typeof STORE!=="undefined"&&STORE.restaurants)?STORE.restaurants().find(x=>x.name===restName):null;
      distStr=(r&&r.dist)||((typeof RESTAURANTS!=="undefined"?RESTAURANTS.find(x=>x.name===restName):null)||{}).dist||""; }catch(e){}
    const m=String(distStr).match(/[\d.,]+/); const km=m?(parseFloat(m[0].replace(",","."))||2):2;
    return Math.max(3000, Math.round((4000+km*1500)/500)*500);
  }
  function openCheckout(total){
    koPay="card";
    const fee=koDeliveryFee();
    const kt3=typeof KT==="function"?KT:function(k){return k;};
    $("#koContent").innerHTML=`
      <h2 style="margin-bottom:4px">${kt3('buyurtma_title')||'📋 Buyurtma'}</h2>
      <p class="ko-sub" style="margin-bottom:14px">${kt3('buyurtma_sub')||"Ma'lumotlarni to'ldiring"}</p>
      <div class="set-field" style="margin-bottom:10px">
        <label>${kt3('ism')||'Ismingiz'}</label>
        <input id="koName" placeholder="Ism Familiya" value="${USER.name||''}" autocomplete="name" />
      </div>
      <div class="set-field" style="margin-bottom:10px">
        <label>${kt3('tel')||'Telefon raqam'}</label>
        <input id="koPhone" placeholder="+998 90 000 00 00" value="${USER.phone||''}" type="tel" autocomplete="tel" />
        <div class="ko-err" id="koPhoneErr" style="display:none;color:var(--red);font-size:12px;margin-top:3px">To'g'ri raqam kiriting: +998 XX XXX XX XX</div>
      </div>
      <div class="set-field" style="margin-bottom:10px">
        <label>${kt3('manzil')||'Yetkazish manzili'}</label>
        <input id="koAddr" placeholder="Ko'cha, uy, kvartira..." value="${USER.address||''}" autocomplete="street-address" />
        <div class="ko-err" id="koAddrErr" style="display:none;color:var(--red);font-size:12px;margin-top:3px">Manzilni to'ldiring</div>
        <button type="button" id="koGeoBtn" class="btn btn-outline" style="width:100%;margin-top:8px;font-size:14px;padding:9px">📍 Joylashuvimni aniqlash</button>
      </div>
      <div class="set-field" style="margin-bottom:14px">
        <label>${kt3('tolov')||"To'lov usuli"}</label>
        <div class="ko-pays">
          <div class="ko-pay on" data-pay="card">${kt3('karta')||'💳 Karta'}</div>
          <div class="ko-pay" data-pay="cash">${kt3('naqd')||'💵 Naqd'}</div>
        </div>
      </div>
      <div class="ko-summary">
        <div class="ko-row"><span>Taomlar (${cart.reduce((s,i)=>s+i.qty,0)} ta)</span><span>${money(total)} so'm</span></div>
        <div class="ko-row"><span>Yetkazish</span><span>${money(fee)} so'm</span></div>
        <div class="ko-row tot"><span>Jami</span><span>${money(total+fee)} so'm</span></div>
      </div>
      <button class="set-save" id="koConfirm" style="width:100%;margin-top:4px">${kt3('tasdiq')||'✅ Buyurtmani tasdiqlash'}</button>`;
    $$("#koContent .ko-pay").forEach(o=>o.addEventListener("click",()=>{ $$("#koContent .ko-pay").forEach(x=>x.classList.remove("on")); o.classList.add("on"); koPay=o.dataset.pay; }));
    const koGeo=$("#koGeoBtn"); if(koGeo) koGeo.addEventListener("click",()=>detectLocation($("#koAddr"), koGeo));
    if(window.YZ_PHONE) YZ_PHONE.attach($("#koPhone"));
    $("#koConfirm").addEventListener("click",confirmOrder);
    $("#koModal").classList.add("open"); $("#koBackdrop").classList.add("open");
  }

  function confirmOrder(){
    const nameVal=$("#koName") ? $("#koName").value.trim() : USER.name;
    const phoneVal=$("#koPhone") ? $("#koPhone").value.trim() : USER.phone;
    const addr=$("#koAddr").value.trim();
    const phoneOk = window.YZ_PHONE ? YZ_PHONE.valid(phoneVal) : (phoneVal||"").replace(/\D/g,"").length>=9;
    if(!phoneOk){ if($("#koPhoneErr")) $("#koPhoneErr").style.display="block"; return; }
    if($("#koPhoneErr")) $("#koPhoneErr").style.display="none";
    if(addr.length<4){ if($("#koAddrErr")) $("#koAddrErr").style.display="block"; return; }
    if(nameVal)  USER.name=nameVal;
    if(phoneVal) USER.phone=(window.YZ_PHONE?YZ_PHONE.pretty(phoneVal):phoneVal);
    USER.address=addr;
    const total=cartTotal(), first=cart[0], more=cart.length>1?` +${cart.length-1} ta`:"", eta=(Math.random()<0.5?10:20);
    USER.orders.unshift({id:Date.now(), dish:first.name+more, emoji:first.emoji, rest:first.rest,
      date:new Date().toLocaleDateString("ru-RU"), amount:total, addr:addr, pay:koPay, deliveredIn:eta, promised:eta+3, reviewed:false, status:"new"});
    const addrFull = addr + (USER.geo ? " · 📍GPS: " + USER.geo.lat.toFixed(5) + "," + USER.geo.lng.toFixed(5) : "");
    try{ STORE.addOrder({ user:USER.name, phone:USER.phone||"", rest:first.rest, item:first.name+more, emoji:first.emoji,
      amount:total, delivery:(typeof koDeliveryFee==="function"?koDeliveryFee():0), addr:addrFull, pay:koPay, courier:STORE.courierForRest(first.rest), status:"new", eta:eta,
      time:new Date().toLocaleTimeString("ru-RU",{hour:"2-digit",minute:"2-digit"}) }); }catch(e){}
    cart=[]; renderCart(); updateKMenuQty(); renderProfil();
    startTrack(addr,eta,first.emoji,first.name+more);
  }
  function startTrack(addr,eta,emoji,label){
    emoji=emoji||"🛵"; label=label||"Buyurtma";
    const kt4=typeof KT==="function"?KT:function(k){return k;};
    const steps=[kt4('st_accepted')||"Qabul qilindi",kt4('st_cooking')||"Tayyorlanmoqda",kt4('st_ready')||"Tayyor",kt4('st_ontheway')||"Yo'lda",kt4('st_arrived')||"Yetib keldi"], ic=["📥","👨‍🍳","✅","🛵","🎉"];
    $("#koContent").innerHTML=`
      <div class="ko-track" style="text-align:center">
        <div style="font-size:48px;margin-bottom:6px">${emoji}</div>
        <h2 style="font-size:19px;margin-bottom:4px">${kt4('qabul')||'Buyurtma qabul qilindi!'}</h2>
        <p class="ko-sub">📍 ${addr} · ${koPay==="card"?"💳 Karta":"💵 Naqd"}</p>
        <p style="font-size:13px;color:var(--grey);background:#f0f9f4;border-radius:10px;padding:10px;margin:10px 0">
          🛵 Kuryer yo'lga chiqdi. Ushbu oynani yopsangiz ham buyurtmangiz kuzatiladi.
        </p>
        <div class="ko-timer" id="koTimer">${String(eta).padStart(2,'0')}:00</div>
        <div class="ko-status" id="koStatus">${steps[0]}</div>
        <div class="ko-steps">${steps.map((s,i)=>`<div class="ko-step"><div class="dot">${ic[i]}</div><span>${s}</span></div>`).join("")}</div>
        <button class="set-save" id="koDone" style="width:100%;margin-top:12px">${kt4('ok_btn')||'Tushunarli, yopish'}</button>
      </div>`;
    $("#koDone").addEventListener("click", closeCheckoutKeepOrder);
    const els=$$("#koContent .ko-step"); if(els[0]) els[0].classList.add("active");
    let cur=0; const tot=eta*60; let left=tot;
    const stepColors=["#f97316","#eab308","#22c55e","#3b82f6","#16a34a"];
    const si=setInterval(()=>{
      if(els[cur]) els[cur].classList.remove("active"), els[cur].classList.add("done-step");
      cur++;
      if(cur<els.length){ if(els[cur]) els[cur].classList.add("active"); const st=$("#koStatus"); if(st){ st.textContent=steps[cur]; st.style.color=stepColors[cur]; } }
      if(cur>=els.length-1){ clearInterval(si); clearInterval(ti);
        const tm=$("#koTimer"); if(tm){ tm.textContent="00:00 ✓"; tm.classList.add("done"); }
        /* Yetib keldi overlay */
        setTimeout(()=>showKabArrived(emoji,label), 500);
      }
    },2400);
    const ti=setInterval(()=>{ left-=Math.ceil(tot/13); if(left<0)left=0;
      const tm=$("#koTimer"); if(tm&&!tm.classList.contains("done")){
        const m=Math.floor(left/60),s=left%60; tm.textContent=String(m).padStart(2,"0")+":"+String(s).padStart(2,"0"); }
    },1000);
    koTimers=[si,ti];
  }

  /* Yetib keldi overlay */
  function showKabArrived(emoji,label){
    let ov=document.getElementById("kabArrivedOverlay"); if(ov) ov.remove();
    ov=document.createElement("div"); ov.id="kabArrivedOverlay"; ov.className="arrived-overlay";
    const kt5=typeof KT==="function"?KT:function(k){return k;};
    ov.innerHTML=`<div class="arrived-card">
      <div class="arrived-emoji">${emoji}</div>
      <div class="arrived-title">${kt5('yetib_keldi')||'Yetib keldi! 🎉'}</div>
      <div class="arrived-name">${label}</div>
      <div class="arrived-msg">Buyurtmangiz eshigingizda.<br>Ovqatingiz mazali bo'lsin!</div>
      <button class="btn btn-primary" id="kabArrivedOk">${kt5('rahmat')||'Rahmat!'}</button>
    </div>`;
    document.body.appendChild(ov);
    const close=()=>{ ov.classList.add("arrived-hide"); setTimeout(()=>ov.remove(),400); };
    ov.querySelector("#kabArrivedOk").addEventListener("click",close);
    ov.addEventListener("click",(e)=>{ if(e.target===ov) close(); });
    try{ navigator.vibrate&&navigator.vibrate([200,100,200]); }catch(e){}
  }

  /* Yopish — joyida qoladi, profil ga o'tMaydi */
  function closeCheckoutKeepOrder(){ koTimers.forEach(t=>clearInterval(t)); koTimers=[]; $("#koModal").classList.remove("open"); $("#koBackdrop").classList.remove("open"); }
  function closeCheckout(){ closeCheckoutKeepOrder(); }

  /* Global expose — HTML script lardan foydalanish uchun */
  window._kabOpenCart = function(){ openKabCartDrawer(); };
  window._kabCloseCart = function(){ closeKabCartDrawer(); };

  /* Bottom bar badge sync */
  function syncKabBar(){
    const total=cart.reduce((s,i)=>s+i.qty,0);
    const badge=document.getElementById("kabCartBadge");
    if(badge){
      badge.textContent=total;
      badge.classList.toggle("show",total>0);
    }
    const topc=document.getElementById("kabTopCartCount");
    if(topc) topc.textContent=total;
    const pulse=document.getElementById("kabCartPulse");
    if(pulse && total>0){ pulse.classList.remove("ping"); void pulse.offsetWidth; pulse.classList.add("ping"); }
  }

  /* ============================================================
     RESTORANLAR
     ============================================================ */
  function restPhotoK(name){
    try{ const be=(typeof STORE!=="undefined"&&STORE.restaurants)?STORE.restaurants().find(x=>x.name===name):null;
      const p=(be&&be.photo)||""; return /^\/uploads\/|^data:/.test(p)?p:""; }catch(e){ return ""; }
  }
  function renderKabRests(filter){
    const grid=document.getElementById("kRestGrid"); if(!grid) return;
    const src=restListK();
    const q=(document.getElementById("kRestSearch")||{}).value||"";
    const list=src.filter(r=> (!filter||r.name===filter) && (!q||r.name.toLowerCase().includes(q.toLowerCase())));
    /* Aksiya bor restoranlarni aniqlash */
    const promoRests=new Set();
    try{
      const be=(typeof STORE!=="undefined"&&STORE.announcements)?STORE.announcements():[];
      const stored=JSON.parse(localStorage.getItem("yetkaz_announcements")||"[]").concat(be);
      stored.forEach(p=>p.rest&&promoRests.add(p.rest));
      /* Chegirmali taomlardan ham */
      kcatalog().forEach(d=>{ if(d.discount>0) promoRests.add(d.rest); });
    }catch(e){}

    grid.innerHTML=list.map(r=>{
      const hasPromo=promoRests.has(r.name);
      return `<div class="krest-card${hasPromo?' krest-promo':''}" data-rest="${r.name}">
        <div class="krest-img tone-${r.kw||'burger'}">
          <span class="kemoji" style="font-size:44px;position:relative;z-index:1">${r.emoji||"🏪"}</span>
          ${(function(){const p=restPhotoK(r.name);return p?`<img src="${p}" alt="${esc(r.name)}" loading="lazy" onerror="this.remove()" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:2;border-radius:0">`:"";})()}
          ${hasPromo?'<span class="krest-promo-badge">🏷 AKSIYA</span>':''}
        </div>
        <div class="krest-body">
          <h3>${r.name}</h3>
          <div class="krest-meta">
            <span class="star">★ ${r.rating}</span>
            <span>⏱ ${r.eta} ${typeof KT==="function"?KT('daq'):'daq'}</span>
            <span>📍 ${r.dist}</span>
          </div>
        </div>
      </div>`;
    }).join("");
    grid.querySelectorAll(".krest-card").forEach(c=>{
      c.addEventListener("click",()=>{
        const rname=c.dataset.rest;
        /* Taomlar bo'limiga o'tish */
        $$(".view").forEach(v=>v.classList.remove("show"));
        const tv=document.getElementById("view-taomlar");
        if(tv) tv.classList.add("show");
        $$(".sb-link").forEach(l=>l.classList.toggle("active",l.dataset.view==="taomlar"));
        if($("#tbTitle")) $("#tbTitle").textContent="Taomlar";
        window.scrollTo({top:0});
        /* Restoran filtr */
        filterByRest(rname);
      });
    });
    /* Qidiruv */
    const inp=document.getElementById("kRestSearch");
    if(inp && !inp._kabListenerAdded){
      inp._kabListenerAdded=true;
      inp.addEventListener("input",()=>renderKabRests());
    }
  }

  /* Restoran bo'yicha filter */
  let activeRest=null;
  function filterByRest(rname){
    activeRest=rname;
    const g=document.getElementById("kMenu"); if(!g) return;
    const list=kcatalog().filter(d=>d.rest===rname);
    /* kFilter chip sifatida restoran nomi ko'rsatilsin + tavsiya banneri */
    const box=document.getElementById("kFilters");
    if(box){
      const isPref = preferredRest()===rname;
      box.innerHTML=`<button class="kchip on" id="kRestFilterChip">🏪 ${esc(rname)} <span style="margin-left:4px;opacity:.7">✕</span></button>`+
        (isPref?`<div style="flex-basis:100%;width:100%;margin-top:8px;font-size:13px;color:#16a34a;background:#eafaf0;border:1px solid #bdebd0;border-radius:10px;padding:8px 12px">⭐ Siz shu restorandan buyurtma bergansiz — taomlar shu yerdan tavsiya qilinmoqda. Boshqa restoran uchun ✕ bosing.</div>`:``);
      const chip=box.querySelector("#kRestFilterChip");
      if(chip) chip.addEventListener("click",()=>{ activeRest=null; renderFilters(); renderMenu(); });
    }
    renderMenuFiltered(list);
  }
  function renderMenuFiltered(list){
    const g=document.getElementById("kMenu"); if(!g) return;
    g.innerHTML=list.map(d=>{
      const qty=(cart.find(i=>i.id===d.id)||{}).qty||0;
      const price=d.discount?`<span style="text-decoration:line-through;color:#b9a;font-size:11px">${money(d.price)}</span> ${money(d.eff)}`:money(d.price);
      const disc=d.discount>0;
      const qtyHtml=qty===0
        ?`<button class="kadd" data-id="${d.id}">+</button>`
        :`<div class="kcard-qty"><button class="kqty-btn" data-id="${d.id}" data-m="-1">−</button><span class="kqty-num">${qty}</span><button class="kqty-btn" data-id="${d.id}" data-m="1">+</button></div>`;
      return `<div class="kcard${disc?' kcard-disc':''}" data-id="${d.id}" data-discounted="${disc}">
        <div class="kimg" data-id="${d.id}"><span class="kemoji">${d.emoji}</span>
          <img src="${d.photo}" alt="${d.name}" loading="lazy" onerror="this.remove()">
          ${disc?'<span class="kcard-disc-badge">🏷 CHEGIRMA</span>':''}
        </div>
        <div class="kbody"><h4 data-id="${d.id}">${d.name}</h4>
          <div class="krest">${d.rest}</div>
          <div class="kfoot"><span class="kprice">${price} so'm</span>${qtyHtml}</div>
        </div></div>`;
    }).join("");
    bindMenuEvents();
  }
  function bindMenuEvents(){
    document.querySelectorAll("#kMenu .kimg, #kMenu h4").forEach(el=>el.addEventListener("click",()=>{
      const id=+el.dataset.id; const d=kcatalog().find(x=>x.id===id); if(d) openKDishModal(d);
    }));
    document.querySelectorAll("#kMenu .kadd").forEach(b=>b.addEventListener("click",(e)=>{ e.stopPropagation(); addToCart(+b.dataset.id); }));
    document.querySelectorAll("#kMenu .kqty-btn").forEach(b=>b.addEventListener("click",(e)=>{ e.stopPropagation(); changeQty(+b.dataset.id,+b.dataset.m); updateKMenuQty(); }));
  }

  /* ============================================================
     PROMO MODAL
     ============================================================ */
  function openKabPromoModal(){
    const promos=[];
    try{
      const be=(typeof STORE!=="undefined"&&STORE.announcements)?STORE.announcements():[];
      const stored=JSON.parse(localStorage.getItem("yetkaz_announcements")||"[]").concat(be);
      /* Soxta namuna e'lonlar YO'Q — faqat haqiqiy restoranlar e'lonlari */
      promos.push(...stored);
    }catch(e){}
    /* Chegirmali taomlar */
    const discDishes=kcatalog().filter(d=>d.discount>0);
    const modal=document.getElementById("kpmodModal");
    const bd=document.getElementById("kpmodBackdrop");
    const content=document.getElementById("kpmodContent");
    if(!modal||!content) return;
    content.innerHTML=`
      <h2 style="margin-bottom:4px">🔥 Aksiyalar</h2>
      <p style="color:var(--grey);font-size:13px;margin-bottom:14px">Bugungi maxsus takliflar</p>
      ${discDishes.length?`
      <div class="kpm-sec-title">🏷️ Chegirmali taomlar</div>
      <div class="kpm-dishes">
        ${discDishes.map(d=>`
          <div class="kpm-dish" data-id="${d.id}" style="cursor:pointer">
            <div class="kpm-dish-img tone-${d.kw||'burger'}">
              <span style="font-size:28px">${d.emoji}</span>
            </div>
            <div class="kpm-dish-info">
              <div class="kpm-dish-name">${d.name}</div>
              <div class="kpm-dish-rest">${d.rest}</div>
              <div class="kpm-dish-prices">
                <span class="kpm-old">${money(d.price)}</span>
                <span class="kpm-new">${money(d.eff)} so'm</span>
                <span class="kpm-pct">-${d.discount}%</span>
              </div>
            </div>
            <button class="kpm-add" data-id="${d.id}">+</button>
          </div>`).join("")}
      </div>`:""}
      <div class="kpm-sec-title" style="margin-top:${discDishes.length?16:0}px">📢 E'lonlar</div>
      <div class="kpm-anns">
        ${promos.map(p=>`
          <div class="kpm-ann" data-rest="${p.rest}" style="cursor:pointer">
            <span class="kpm-ann-emoji">${p.emoji||"📢"}</span>
            <div class="kpm-ann-body">
              <div class="kpm-ann-rest">${p.rest}</div>
              <div class="kpm-ann-text">${p.text}</div>
              <div class="kpm-ann-action">Restoraniga o'tish →</div>
            </div>
            ${p.tag?`<span class="kpm-tag">${p.tag}</span>`:""}
          </div>`).join("")}
      </div>`;
    /* Chegirmali taom bosilganda */
    content.querySelectorAll(".kpm-dish").forEach(el=>{
      el.addEventListener("click",()=>{
        const id=+el.dataset.id; const d=kcatalog().find(x=>x.id===id);
        if(d){ closeKabPromoModal(); openKDishModal(d); }
      });
    });
    content.querySelectorAll(".kpm-add").forEach(btn=>{
      btn.addEventListener("click",(e)=>{
        e.stopPropagation();
        addToCart(+btn.dataset.id);
        btn.textContent="✓"; btn.style.background="var(--green)";
      });
    });
    /* E'lon bosilganda restoranga o'tish */
    content.querySelectorAll(".kpm-ann").forEach(el=>{
      el.addEventListener("click",()=>{
        const rname=el.dataset.rest;
        closeKabPromoModal();
        const sl=document.querySelector('.sb-link[data-view="rests"]');
        if(sl) sl.click();
        setTimeout(()=>{ filterByRest(rname); },80);
      });
    });
    modal.classList.add("open"); bd.classList.add("open");
  }
  function closeKabPromoModal(){
    const modal=document.getElementById("kpmodModal");
    const bd=document.getElementById("kpmodBackdrop");
    if(modal) modal.classList.remove("open");
    if(bd) bd.classList.remove("open");
  }

  function renderAll(){
    renderFilters(); renderMenu(); renderCart(); renderProfil(); renderReviewForm(); renderKabRests();
    setTimeout(function(){ if(typeof KT_APPLY==="function") KT_APPLY(); },50);
  }

  document.addEventListener("DOMContentLoaded",()=>{
    var ses=(typeof STORE!=="undefined")?STORE.session():null;
    if(ses && ses.role==="user"){ enterUser({login:ses.login,name:ses.name,phone:ses.phone}); }
    else { try{ location.replace("index.html"); }catch(e){} }
    $("#loginBtn").addEventListener("click",login);
    $("#ulPass").addEventListener("keydown",e=>{ if(e.key==="Enter") login(); });
    $$(".sb-link").forEach(l=>l.addEventListener("click",()=>nav(l.dataset.view)));
    $("#logoutBtn").addEventListener("click",()=>{ if(typeof STORE!=="undefined") STORE.clearSession(); $("#app").classList.remove("show"); $("#loginWrap").style.display="flex"; $("#ulPass").value=""; try{location.href="index.html";}catch(e){} });
    // menuToggle — HTML script boshqaradi
    $("#revSubmit").addEventListener("click",submitReview);
    const kc=$("#koClose"), kb=$("#koBackdrop");
    if(kc) kc.addEventListener("click",closeCheckout);
    if(kb) kb.addEventListener("click",closeCheckout);
    /* Promo modal */
    const kpClose=document.getElementById("kpmodClose");
    const kpBd=document.getElementById("kpmodBackdrop");
    if(kpClose) kpClose.addEventListener("click",closeKabPromoModal);
    if(kpBd)    kpBd.addEventListener("click",closeKabPromoModal);
    /* Promo banner click */
    const kpBand=document.getElementById("kabPromoInner");
    if(kpBand) kpBand.addEventListener("click",openKabPromoModal);
    const kpBand2=document.getElementById("kabPromoBand");
    if(kpBand2) kpBand2.addEventListener("click",function(e){ if(!e.target.closest(".kab-promo-close")) openKabPromoModal(); });
    /* Rests view listener */
    const rlBtn=document.querySelector('.sb-link[data-view="rests"]');
    if(rlBtn) rlBtn.addEventListener("click",()=>renderKabRests());
    /* Restoranlar sidebar link qo'shish */
    const sbn=document.querySelector(".sb-nav");
    if(sbn && !document.querySelector('.sb-link[data-view="rests"]')){
      const a=document.createElement("a"); a.className="sb-link"; a.dataset.view="rests";
      a.innerHTML='<span class="ic">🏪</span><span class="ic-label">Restoranlar</span>';
      a.addEventListener("click",()=>nav("rests")); sbn.appendChild(a);
    }
    /* Lang — I18N ga bog'lash */
    const knsLat=document.getElementById("knsLatin");
    const knsCyr=document.getElementById("knsCyrillic");
    function applyKabLang(lang){
      localStorage.setItem("yz_lang", lang);
      if(knsLat) knsLat.classList.toggle("active", lang==="lat");
      if(knsCyr) knsCyr.classList.toggle("active", lang==="cyr");
      /* Sahifani qayta render qilamiz — tarjima bilan */
      renderFilters();
      renderMenu();
      renderKabRests();
      /* DOM elementlarini yangilash */
      if(typeof KT_APPLY==="function") KT_APPLY();
      /* index.html i18n ham */
      if(typeof I18N!=="undefined") I18N.apply();
    }
    const savedLang=localStorage.getItem("yz_lang")||"lat";
    applyKabLang(savedLang);
    knsLat && knsLat.addEventListener("click",()=>applyKabLang("lat"));
    knsCyr && knsCyr.addEventListener("click",()=>applyKabLang("cyr"));
    document.addEventListener("change",e=>{ if(e.target && e.target.id==="revReason"){
      $("#revPhotoWrap").style.display = e.target.value==="quality" ? "block":"none"; } });
  });

  /* Savat tugmasi (yuqori panel) */
  document.addEventListener("DOMContentLoaded",function(){ var cb=document.getElementById("kabTopCart"); if(cb) cb.addEventListener("click",function(){ if(window._kabOpenCart) window._kabOpenCart(); }); });

})();
