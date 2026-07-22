/* ===== Yetkaz.uz — Foydalanuvchi paneli + AI izoh moderatsiyasi ===== */
(function(){
  const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
  const money=n=>Math.round(n).toLocaleString("ru-RU");
  /* XSS himoyasi — ta'rif assets/js/safe.js da (YAGONA manba, `'` ni ham escape
     qiladi). Bu yerда faqat qisqartma. Yangi kod uchun: html`...` teg shabloni. */
  const esc=YZ_SAFE.esc, html=YZ_SAFE.html, raw=YZ_SAFE.raw;
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
    /* created_at serverda UTC yoziladi — Toshkent sanasiga o'giramiz. Ilgari satr
       shundayligicha kesilardi va kechqurun berilgan buyurtma ertangi (yoki
       kechagi) sana bilan ko'rinardi. */
    const date = (o.created_at && YZ_TIME.fmtDate(o.created_at)) || YZ_TIME.fmtDate(new Date().toISOString()) || "";
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
      STORE.onChange(function(){
        hydrateOrders();
        try{ renderProfil(); }catch(e){}
        try{ askPendingConfirmKab(); }catch(e){}
        /* Restoran ish vaqtini o'zgartirsa — kabinet darrov yangilansin */
        try{ refreshOpenState(true); }catch(e){}
      }); }
    /* Kirganда tasdiqlanmagan buyurtma bo'lsa — darrov so'raymiz */
    if(typeof STORE!=="undefined" && STORE.ready) STORE.ready().then(function(){ try{ askPendingConfirmKab(); }catch(e){} }).catch(function(){});
    startKabOpenWatch();
  }

  /* Ish vaqti chegarasidan o'tganda kabinetni O'ZI yangilaydi (sahifani qayta
     yuklash shart emas): "+" tugmalari ⏱ ga aylanadi, nishonlar qizaradi. */
  let kOpenKey="";
  function openStateKeyK(){
    try{ return restListK().map(r=> r.name+":"+(kIsOpen(r.name)?1:0)).join("|"); }catch(e){ return ""; }
  }
  function refreshOpenState(force){
    const now=openStateKeyK();
    if(!force && now===kOpenKey) return;
    kOpenKey=now;
    try{ if(activeRest) filterByRest(activeRest); else renderMenu(); }catch(e){}
    try{ renderKabRests(); }catch(e){}
    try{ renderCart(); }catch(e){}
  }
  function startKabOpenWatch(){
    if(window.__kabOpenWatch) return; window.__kabOpenWatch=true;
    kOpenKey=openStateKeyK();
    setInterval(function(){ refreshOpenState(false); }, 30000);
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
    const t={taomlar:"Taomlar",profil:"Mening kabinetim",rests:"Restoranlar",review:"Izoh qoldirish",help:"Qanday buyurtma berish",settings:"Sozlamalar"};
    $("#tbTitle").textContent=t[view]||""; $("#sidebar").classList.remove("open"); window.scrollTo({top:0});
    if(view==="review") renderReviewForm();
    if(view==="settings") renderSettings();
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
    document.getElementById("kcYes").addEventListener("click",async ()=>{
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
      /* Server rad etsa (kuryer yo'lda va h.k.) — mahalliy holatni O'ZGARTIRMAYMIZ */
      let res=null;
      if(beId && STORE.cancelOrder){
        try{ res = await STORE.cancelOrder(beId); }
        catch(e){ toast((e && e.data && e.data.error) || "Buyurtmani bekor qilib bo'lmadi","error"); return; }
      }
      if(o) o.status="cancelled";
      close(); renderProfil();
      /* Server bekor qilishlar sonini hisoblaydi: 2-marta ogohlantirish +
         5 daqiqalik cheklov, 3-marta raqam bloklanadi (server/src/blocks.js) */
      if(res && res.warn && res.warnLevel>=2) showKabWarn(res);
      else toast((res && res.warn) || "Buyurtma bekor qilindi","success");
    });
  }

  function renderSettings(){
    var ses=(typeof STORE!=="undefined")?STORE.session():null;
    var set=function(id,v){ var el=document.getElementById(id); if(el) el.value=v||""; };
    set("stName", USER.name||(ses&&ses.name));
    set("stPhone", USER.phone||(ses&&ses.phone));
    set("stEmail", (ses&&ses.email)||"");
    set("stLogin", USER.login||(ses&&ses.login));
    try{ set("stAddr", localStorage.getItem("yz_user_addr")||""); }catch(e){}
    var snd=document.getElementById("stSound");
    try{ if(snd) snd.checked = localStorage.getItem("yz_sound")!=="0"; }catch(e){}
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
  /* Taom kategoriyasini nomi/emojisidan taxmin qilamiz (data.js da cat yo'q — bosh saytдагидек) */
  const K_CAT_RULES=[
    {cat:"Ichimlik",emo:"🥤🧃☕🍵🧋🍹🥛🍶🫖🧉🍺🍸🧊",kw:["ichimlik","sharbat","juice","cola","kola","pepsi","fanta","sprite","choy","tea","kofe","coffee","cappuccino","latte","suv ","water","limonad","kompot","milkshake","shake","smuzi","ayron","lassi","kvas","energetik","napitok","koktey"]},
    {cat:"Shirinlik",emo:"🍰🎂🧁🍮🍩🍪🍨🍦🍧🥧🍫🍬🍭🍯🥮🍡",kw:["tort","cake","shirin","desert","dessert","muzqaymoq","morojen","ice cream","pirog","donut","ponchik","keks","pechen","cookie","shokolad","choco","halva","holva","chak","medovik","napoleon","tiramisu","cheesecake","pudding","jele","pirojn","vafli","waffle","kruassan","croissant","baklava","pahlava"]},
    {cat:"Milliy",emo:"🍚🍛🥘🫕🍲🥟",kw:["osh","palov","plov","manti","mant","lag'mon","lagmon","lagman","somsa","samsa","shashlik","shashlyk","kabob","kabab","kebab","norin","shurva","sho'rva","shorva","dimlama","chuchvara","chuchvora","beshbarmoq","dolma","mastava","mosh","milliy","tandir","hasip","xasip","qozon","xonim","gumma","jarkop","qovurma","kuurdak","qazi","damlama"]},
    {cat:"Fastfood",emo:"🍔🍟🌭🍕🌮🌯🥪🧀🍗🥙🥗",kw:["burger","gamburger","chizburger","cheeseburger","lavash","lavaş","hotdog","hot dog","xotdog","pizza","pitsa","sendvich","sandwich","fri ","fries","nagets","nuggets","shaurma","shawarma","shaverma","doner","dyuner","club","strips","wings","qanot","gyros","salat","salad","sezar","caesar"]}
  ];
  function kDishCat(d){
    if(d.cat && d.cat!=="Fastfood") return d.cat;
    const hay=((d.name||"")+" "+(d.nameCyr||"")+" ").toLowerCase(), emo=d.emoji||"";
    for(const r of K_CAT_RULES){ if(emo&&r.emo.includes(emo)) return r.cat; if(r.kw.some(k=>hay.includes(k))) return r.cat; }
    return d.cat||"Fastfood";
  }
  /* ===== ISH VAQTI =====
     Manba — assets/js/hours.js (Asia/Tashkent). Bosh sayt (app.js), Telegram
     mini ilova va server AYNAN shu qoidaga tayanadi. Yopiq restorandan taom
     buyurtma qilib bo'lmaydi: tugma ⏱ ga aylanadi, savatga qo'shilmaydi va
     server ham rad etadi (server/src/pricing.js). */
  function kIsOpen(rest){ try{ return YZ_TIME.isRestOpenByName(rest); }catch(e){ return true; } }
  function kHours(rest){ try{ return YZ_TIME.restHoursByName(rest); }catch(e){ return "09:00–23:00"; } }
  function kClosedMsg(rest){ return "🔴 "+rest+" hozir yopiq · ish vaqti "+kHours(rest); }

  /* Taom kartasidagi tugma — saytdagi bilan bir xil ustuvorlik:
       1) restoran yopiq → ⏱   2) savatda bor → −/+   3) aks holda → + */
  function kActionHTML(d, qty){
    if(qty>0){
      const shut=!kIsOpen(d.rest);
      return `<div class="kcard-qty"><button class="kqty-btn" data-id="${d.id}" data-m="-1">−</button>`+
             `<span class="kqty-num">${qty}</span>`+
             `<button class="kqty-btn${shut?" kshut":""}" data-id="${d.id}" data-m="1">+</button></div>`;
    }
    if(!kIsOpen(d.rest)){
      return `<button class="kshut-add" data-shut="${esc(d.rest)}" title="${esc(kClosedMsg(d.rest))}">⏱</button>`;
    }
    return `<button class="kadd" data-id="${d.id}">+</button>`;
  }
  /* Yopiq restoran tugmalarini bog'lash (faqat xabar chiqadi) */
  function bindShutButtons(root){
    (root||document).querySelectorAll(".kshut-add").forEach(b=>{
      if(b._shutBound) return; b._shutBound=true;
      b.addEventListener("click",(e)=>{ e.stopPropagation(); toast(kClosedMsg(b.dataset.shut||"Restoran")); });
    });
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
        <img src="${d.photo}" alt="${d.name}" data-onerr="remove"
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
      if(q===0 && !kIsOpen(d.rest)){
        foot.innerHTML=`<div class="yz-closed-bar" style="margin:0"><span style="font-size:20px">⏱</span>`+
          `<span><b>${esc(d.rest)}</b> hozir yopiq.<br>Ish vaqti: <b>${esc(kHours(d.rest))}</b> — shu vaqtda buyurtma bering.</span></div>`;
        return;
      }
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
    /* Katalogni BIR MARTA olamiz — kcatalog() har chaqiruvda menyuni qaytadan
       birlashtiradi, uni sikl ichida chaqirish kartalar soniga karrali sekinlik. */
    const cat=kcatalog();
    $$("#kMenu .kcard").forEach(card=>{
      const id=+card.dataset.id; if(!id) return;
      const d=cat.find(x=>x.id===id); if(!d) return;
      const qty=(cart.find(i=>i.id===id)||{}).qty||0;
      const foot=card.querySelector(".kfoot");
      if(!foot) return;
      const priceEl=card.querySelector(".kprice");
      const priceHTML=priceEl?priceEl.outerHTML:`<span class="kprice"></span>`;
      /* Restoran ish vaqti o'zgargan bo'lishi mumkin — kartani ham yangilaymiz */
      card.classList.toggle("kcard-shut", !kIsOpen(d.rest));
      foot.innerHTML=priceHTML+kActionHTML(d,qty);
      const add=foot.querySelector(".kadd");
      if(add) add.addEventListener("click",(e)=>{ e.stopPropagation(); addToCart(id); });
      foot.querySelectorAll(".kqty-btn").forEach(b=>b.addEventListener("click",(e)=>{ e.stopPropagation(); changeQty(+b.dataset.id,+b.dataset.m); updateKMenuQty(); syncKabBar(); }));
      bindShutButtons(foot);
    });
    syncKabBar();
  }

  /* Taom kartasi — renderMenu va renderMenuFiltered UCHUN BITTA manba.
     (Ilgari ikkala joyda nusxa markup bor edi va biri yangilanganda ikkinchisi
     eskirib qolardi — masalan "yopiq" holati.) */
  function kCardHTML(d, badgeText){
    const qty=(cart.find(i=>i.id===d.id)||{}).qty||0;
    const price=d.discount?`<span style="text-decoration:line-through;color:#b9a;font-size:11px">${money(d.price)}</span> ${money(d.eff)}`:money(d.price);
    const disc=d.discount>0;
    const shut=!kIsOpen(d.rest);
    return `<div class="kcard${disc?' kcard-disc':''}${shut?' kcard-shut':''}" data-id="${d.id}" data-discounted="${disc}">
        <div class="kimg" data-id="${d.id}"><span class="kemoji">${d.emoji}</span>
          ${d.photo?`<img class="kimg-bg" src="${d.photo}" alt="" aria-hidden="true" loading="lazy" data-onerr="remove">`:''}
          <img class="kimg-fg" src="${d.photo}" alt="${d.name}" loading="lazy" data-onerr="remove">
          ${disc?`<span class="kcard-disc-badge">${badgeText||'🏷'}</span>`:''}
        </div>
        <div class="kbody">
          <h4 data-id="${d.id}">${d.name}</h4>
          <div class="krest">${d.rest}</div>
          <div class="kfoot"><span class="kprice">${price} so'm</span>${kActionHTML(d,qty)}</div>
        </div></div>`;
  }
  function renderMenu(){
    if(activeRest){ filterByRest(activeRest); return; }
    const g=$("#kMenu"); if(!g) return;
    g.innerHTML=kcatalog().filter(d=>activeCat==="Hammasi"||kDishCat(d)===activeCat)
      .map(d=>kCardHTML(d,'🏷')).join("");
    bindMenuEvents();
  }
  function cartTotal(){ return cart.reduce((s,i)=>s+i.price*i.qty,0); }
  function addToCart(id){
    const d=kcatalog().find(x=>x.id===id); if(!d) return;
    const ex=cart.find(i=>i.id===id);
    /* Yopiq restorandan taom qo'shib bo'lmaydi (server ham rad etadi) */
    if(!kIsOpen(d.rest)){ toast(kClosedMsg(d.rest)); return; }
    /* Bitta buyurtma = bitta restoran — boshqa restoran taomi qo'shilsa so'raymiz */
    if(!ex && cart.length && cart[0].rest && d.rest && cart[0].rest!==d.rest){
      const c=$("#koContent");
      if(c){
        c.innerHTML=`<div style="text-align:center;padding:10px 4px">
          <div style="font-size:42px">🏪</div>
          <h2 style="margin:8px 0;font-size:19px">${esc(d.rest)} ga o'tamizmi?</h2>
          <p style="color:var(--grey);font-size:14px;line-height:1.5;margin-bottom:16px">Bitta buyurtmada faqat bitta restoran bo'ladi. Savatingizda <b>${esc(cart[0].rest)}</b> taomlari bor. <b>${esc(d.rest)}</b> ga o'tsangiz — savat yangilanadi va shu restoran taomlari ko'rinadi.</p>
          <div style="display:flex;gap:10px">
            <button class="set-save" id="kSwitchNo" style="flex:1;background:#eee;color:#333">Yo'q, qolaman</button>
            <button class="set-save" id="kSwitchYes" style="flex:1">Ha, kirish</button>
          </div></div>`;
        $("#koModal").classList.add("open"); $("#koBackdrop").classList.add("open");
        const no=$("#kSwitchNo"); if(no) no.addEventListener("click",()=>{ $("#koModal").classList.remove("open"); $("#koBackdrop").classList.remove("open"); });
        const yes=$("#kSwitchYes"); if(yes) yes.addEventListener("click",()=>{
          cart=[{id:d.id,name:d.name,emoji:d.emoji,price:(d.eff||d.price),rest:d.rest,qty:1}];
          renderCart(); $("#koModal").classList.remove("open"); $("#koBackdrop").classList.remove("open");
          filterByRest(d.rest); try{window.scrollTo({top:0});}catch(e){}
          toast(d.emoji+" "+(typeof KT==="function"?KT('savatga_qoshildi'):"Savatga qo'shildi"));
        });
      }
      return;
    }
    if(ex) ex.qty++; else cart.push({id:d.id,name:d.name,emoji:d.emoji,price:(d.eff||d.price),rest:d.rest,qty:1});
    renderCart(); updateKMenuQty(); toast(d.emoji+" "+(typeof KT==="function"?KT('savatga_qoshildi'):"Savatga qo'shildi"));
  }
  function changeQty(id,m){
    const i=cart.find(x=>x.id===id); if(!i) return;
    /* Ko'paytirish faqat restoran ochiq bo'lganda; kamaytirish har doim mumkin */
    if(m>0 && !kIsOpen(i.rest)){ toast(kClosedMsg(i.rest)); return; }
    i.qty+=m; if(i.qty<=0) cart=cart.filter(x=>x.id!==id); renderCart(); updateKMenuQty();
  }
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
      /* Savatdagi restoran hozir yopiq bo'lsa — buyurtma tugmasi ishlamaydi */
      const cRest=cart[0].rest, cOpen=kIsOpen(cRest);
      const blocked = total<20000 || !cOpen;
      foot.innerHTML=`
        <div class="kab-dr-total">
          <span>${kt2('jami')||'Jami'}</span><b style="color:var(--red)">${money(total)} so'm</b>
        </div>
        ${cOpen?``:`<div class="yz-closed-bar" style="margin:0 0 8px"><span style="font-size:18px">🔴</span><span><b>${esc(cRest)}</b> hozir yopiq. Ish vaqti: <b>${esc(kHours(cRest))}</b></span></div>`}
        <div class="kab-dr-note ${total<20000?'warn':'ok'}">
          ${total<20000
            ? (kt2('minimal_warn',{n:money(20000-total)})||`⚠️ Minimal 20 000 so'm (yana ${money(20000-total)} so'm)`)
            : (kt2('minimal_ok')||"✅ Yetkazish bepul 🛵")}
        </div>
        <button class="kab-order-main" id="kabOrderBtn" ${blocked?"disabled":""}>
          ${cOpen ? (kt2('buyurtma_berish')||'Buyurtma berish') : '⏱ Restoran yopiq'}
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
    /* Savat to'lgandan keyin restoran yopilishi mumkin — oxirgi tekshiruv */
    const rest=cart[0] && cart[0].rest;
    if(rest && !kIsOpen(rest)){ toast(kClosedMsg(rest)); renderCart(); return; }
    closeKabCartDrawer();
    openCheckout(total);
  }
  /* Yetkazish BEPUL — sayt shunday reklama qiladi (mos kelishi uchun har doim 0) */
  function koDeliveryFee(){ return 0; }
  function openCheckout(total){
    koPay="card";
    const fee=koDeliveryFee();
    const kt3=typeof KT==="function"?KT:function(k){return k;};
    /* Manzil va telefon HAR BUYURTMADA so'raladi (sayt va Telegram mini ilovasi
       ham AYNAN shunday) — maydonlar oxirgi qiymat bilan to'ldirilgan bo'ladi. */
    var savedAddr=USER.address||"", savedPhone=USER.phone||"";
    try{
      savedAddr = savedAddr || localStorage.getItem("yz_user_addr") || "";
      savedPhone = savedPhone || localStorage.getItem("yz_user_phone") || "";
    }catch(e){}
    /* Oldingi buyurtmaning GPS nuqtasi yangi manzilga yopishib qolmasin */
    USER.geo=null;
    $("#koContent").innerHTML=`
      <div class="ko-wave-head">
        <h2>${kt3('buyurtma_title')||'📋 Buyurtma'}</h2>
        <p class="ko-sub">${kt3('buyurtma_sub')||"Ma'lumotlarni to'ldiring"}</p>
        <svg class="ko-wave" viewBox="0 0 1440 40" preserveAspectRatio="none" aria-hidden="true"><path d="M0,14 C240,42 480,2 720,18 C960,34 1200,44 1440,20 L1440,40 L0,40 Z" fill="#fff"/></svg>
      </div>
      <div class="set-field" style="margin-bottom:10px">
        <label>${kt3('ism')||'Ismingiz'}</label>
        <input id="koName" placeholder="Ism Familiya" value="${USER.name||''}" autocomplete="name" />
        <div class="ko-err" id="koNameErr" style="display:none;color:var(--red);font-size:12px;margin-top:3px">Ism kamida 4 harf bo'lsin</div>
      </div>
      <div class="set-field" style="margin-bottom:10px">
        <label>${kt3('tel')||'Telefon raqam'}</label>
        <input id="koPhone" placeholder="+998 90 000 00 00" value="${savedPhone}" type="tel" autocomplete="tel" />
        <div class="ko-err" id="koPhoneErr" style="display:none;color:var(--red);font-size:12px;margin-top:3px">To'g'ri raqam kiriting: +998 XX XXX XX XX</div>
      </div>
      <div class="set-field" style="margin-bottom:10px">
        <label>${kt3('manzil')||'Yetkazish manzili'}</label>
        <input id="koAddr" placeholder="Ko'cha, uy, kvartira..." value="${savedAddr}" autocomplete="street-address" />
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
    const nameVal=$("#koName") ? $("#koName").value.trim() : (USER.name||"");
    const phoneVal=$("#koPhone") ? $("#koPhone").value.trim() : USER.phone;
    const addr=$("#koAddr").value.trim();
    // Ism kamida 4 harf bo'lishi shart — aks holda buyurtma qabul qilinmaydi
    if(nameVal.length<4){ if($("#koNameErr")) $("#koNameErr").style.display="block"; return; }
    if($("#koNameErr")) $("#koNameErr").style.display="none";
    const phoneOk = window.YZ_PHONE ? YZ_PHONE.valid(phoneVal) : (phoneVal||"").replace(/\D/g,"").length>=9;
    if(!phoneOk){ if($("#koPhoneErr")) $("#koPhoneErr").style.display="block"; return; }
    if($("#koPhoneErr")) $("#koPhoneErr").style.display="none";
    if(addr.length<4){ if($("#koAddrErr")) $("#koAddrErr").style.display="block"; return; }
    if(!cart.length){ toast("🛒 Savat bo'sh"); return; }
    /* Forma to'ldirilayotganda ish vaqti tugagan bo'lishi mumkin */
    if(!kIsOpen(cart[0].rest)){
      toast(kClosedMsg(cart[0].rest));
      $("#koModal").classList.remove("open"); $("#koBackdrop").classList.remove("open");
      renderCart(); updateKMenuQty();
      return;
    }
    if(nameVal)  USER.name=nameVal;
    if(phoneVal) USER.phone=(window.YZ_PHONE?YZ_PHONE.pretty(phoneVal):phoneVal);
    USER.address=addr;
    /* Keyingi safar (saytда ham, kabinetда ham) shu qiymatlar tayyor chiqadi —
       kalitlar app.js bilan BIR XIL. */
    try{
      localStorage.setItem("yz_user_addr", addr);
      localStorage.setItem("yz_user_phone", USER.phone||"");
      localStorage.setItem("yz_user_name", USER.name||"");
    }catch(e){}
    const total=cartTotal(), first=cart[0], more=cart.length>1?` +${cart.length-1} ta`:"", eta=(Math.random()<0.5?10:20);
    const orderLocalId=Date.now();
    const savedCart=cart.map(i=>({...i}));   // server rad etsa — savatni qaytaramiz
    USER.orders.unshift({id:orderLocalId, dish:first.name+more, emoji:first.emoji, rest:first.rest,
      date:new Date().toLocaleDateString("ru-RU"), amount:total, addr:addr, pay:koPay, deliveredIn:eta, promised:eta+3, reviewed:false, status:"new"});
    const addrFull = addr + (USER.geo ? " · 📍GPS: " + USER.geo.lat.toFixed(5) + "," + USER.geo.lng.toFixed(5) : "");
    let created=null;
    /* Summani SERVER hisoblaydi — biz faqat nima/nechta olayotganimizni aytamiz.
       Quyidagi rest/item/amount local ko'rinish uchun; server ularni e'tiborsiz
       qoldiradi. Rad etsa (min. summa / sotuvda yo'q taom) — orqaga qaytaramiz. */
    try{ created = STORE.addOrder({ user:USER.name, phone:USER.phone||"", rest:first.rest, item:first.name+more, emoji:first.emoji,
      items:cart.map(i=>({id:i.id, qty:i.qty})),
      amount:total, delivery:(typeof koDeliveryFee==="function"?koDeliveryFee():0), addr:addrFull, pay:koPay, courier:STORE.courierForRest(first.rest), status:"new", eta:eta,
      time:new Date().toLocaleTimeString("ru-RU",{hour:"2-digit",minute:"2-digit"}) },{
      onFail: err => koOrderRejected(orderLocalId, savedCart, err)
    }); }catch(e){}
    cart=[]; renderCart(); updateKMenuQty(); renderProfil();
    startTrack(addr,created,first.emoji,first.name+more);
  }

  /* Server buyurtmani RAD ETDI — local yozuvni o'chirib, savatni qaytaramiz va
     sababni aytamiz. Aks holda mijoz mavjud bo'lmagan buyurtmani kuzatardi. */
  function koOrderRejected(localId, restoreCart, err){
    USER.orders = USER.orders.filter(o=>o.id!==localId);
    if(restoreCart && restoreCart.length){ cart = restoreCart.map(i=>({...i})); }
    renderCart(); updateKMenuQty(); renderProfil();
    try{ koTimers.forEach(t=>clearInterval(t)); koTimers=[]; }catch(e){}
    const m=$("#koModal"), b=$("#koBackdrop");
    if(m) m.classList.remove("open"); if(b) b.classList.remove("open");
    /* Bloklangan (403) yoki vaqtincha cheklangan (429) raqam — to'liq oynada */
    const st=err&&err.status;
    if(st===403||st===429){ showKabWarn({ warn:err.message, blocked:st===403 }); return; }
    toast((err && err.message) || "Buyurtma qabul qilinmadi","error");
  }
  /* REAL kuzatuv: backenddagi haqiqiy status bo'yicha (STORE har 5s yangilaydi).
     Bekor qilinса — bekor ko'rsatadi; "arrived" bo'lса mijoz "Qabul qildim" bosadi -> backendga done. */
  function startTrack(addr,created,emoji,label){
    emoji=emoji||"🛵"; label=label||"Buyurtma";
    const kt4=typeof KT==="function"?KT:function(k){return k;};
    const steps=[kt4('st_accepted')||"Qabul qilindi",kt4('st_cooking')||"Tayyorlanmoqda",kt4('st_ready')||"Tayyor",kt4('st_ontheway')||"Yo'lda",kt4('st_arrived')||"Yetib keldi"], ic=["📥","👨‍🍳","✅","🛵","🎉"];
    $("#koContent").innerHTML=`
      <div class="ko-track" style="text-align:center">
        <div style="font-size:48px;margin-bottom:6px">${emoji}</div>
        <h2 style="font-size:19px;margin-bottom:4px">${kt4('qabul')||'Buyurtma qabul qilindi!'}</h2>
        <p class="ko-sub">📍 ${addr} · ${koPay==="card"?"💳 Karta":"💵 Naqd"}</p>
        <p style="font-size:13px;color:var(--grey);background:#f0f9f4;border-radius:10px;padding:10px;margin:10px 0">
          🛵 Buyurtmangiz real vaqtда kuzatilmoqda. Ushbu oynani yopsangiz ham davom etadi.
        </p>
        <div class="ko-status" id="koStatus" style="font-weight:800;margin:6px 0">${steps[0]}</div>
        <div class="ko-steps">${steps.map((s,i)=>`<div class="ko-step"><div class="dot">${ic[i]}</div><span>${s}</span></div>`).join("")}</div>
        <div id="koTrackAction"></div>
        <button class="set-save" id="koDone" style="width:100%;margin-top:12px;background:#eee;color:#333">${kt4('ok_btn')||'Tushunarli, yopish'}</button>
      </div>`;
    $("#koDone").addEventListener("click", closeCheckoutKeepOrder);
    const els=$$("#koContent .ko-step");
    const stepColors=["#f97316","#eab308","#22c55e","#3b82f6","#16a34a"];
    const STMAP={ new:0, accepted:1, ready:2, ontheway:3, arrived:4, done:4 };
    function orderNow(){ try{ return (STORE.orders()||[]).find(o=> created && o.id===created.id) || created; }catch(e){ return created; } }
    function paint(idx){
      els.forEach((el,i)=>{ el.classList.remove("active","done-step"); if(i<idx) el.classList.add("done-step"); else if(i===idx) el.classList.add("active"); });
      const st=$("#koStatus"); if(st){ st.textContent=steps[idx]||steps[0]; st.style.color=stepColors[idx]||""; }
    }
    let finished=false;
    function tick(){
      const o=orderNow(); const s=(o&&o.status)||"new";
      if(s==="cancelled"){ clearInterval(poll); paint(0); showKabCancelled(o&&o.reason,emoji); return; }
      paint(STMAP[s]!=null?STMAP[s]:0);
      const act=$("#koTrackAction");
      if(s==="arrived" && act && !act.dataset.on){
        act.dataset.on="1";
        act.innerHTML='<button class="set-save" id="koGotIt" style="width:100%;background:#16a34a">✅ '+((kt4('yetib_keldi')||'Qabul qildim').replace(' 🎉',''))+'</button>';
        const gi=$("#koGotIt");
        if(gi) gi.addEventListener("click",async ()=>{
          if(!(o&&o.id&&STORE.confirmReceived)) return;
          gi.disabled=true; gi.textContent="Tasdiqlanmoqda…";
          try{ await STORE.confirmReceived(o.id); }
          catch(e){
            /* Tasdiq o'tmadi — tugmani qaytaramiz, mijoz qayta urinib ko'radi */
            act.dataset.on=""; gi.disabled=false;
            toast("Tasdiqlab bo'lmadi. Qayta urinib ko'ring.","error");
          }
        });
      }
      if(s==="done" && !finished){ finished=true; clearInterval(poll); setTimeout(()=>showKabArrived(emoji,label),300); }
    }
    const poll=setInterval(tick, 2500); tick();
    koTimers=[poll];
  }
  /* Bekor qilingan buyurtma oynasi */
  function showKabCancelled(reason,emoji){
    let ov=document.getElementById("kabArrivedOverlay"); if(ov) ov.remove();
    ov=document.createElement("div"); ov.id="kabArrivedOverlay"; ov.className="arrived-overlay";
    ov.innerHTML='<div class="arrived-card"><div class="arrived-emoji">❌</div><div class="arrived-title">Buyurtma bekor qilindi</div>'+(reason?'<div class="arrived-msg">Sabab: '+esc(reason)+'</div>':'<div class="arrived-msg">Buyurtmangiz bekor qilindi.</div>')+'<button class="btn btn-primary" id="kabCancOk">Tushunarli</button></div>';
    document.body.appendChild(ov);
    const close=()=>{ ov.remove(); };
    ov.querySelector("#kabCancOk").addEventListener("click",close);
    ov.addEventListener("click",(e)=>{ if(e.target===ov) close(); });
  }

  /* Bekor qilish ogohlantirishi / blok xabari (server/src/blocks.js qoidalari) */
  function showKabWarn(res){
    const blocked=!!res.blocked;
    let ov=document.getElementById("kabArrivedOverlay"); if(ov) ov.remove();
    ov=document.createElement("div"); ov.id="kabArrivedOverlay"; ov.className="arrived-overlay";
    ov.innerHTML='<div class="arrived-card"><div class="arrived-emoji">'+(blocked?"⛔":"⚠️")+'</div>'+
      '<div class="arrived-title" style="color:#C8102E">'+(blocked?"Raqamingiz bloklandi":"Ogohlantirish!")+'</div>'+
      '<div class="arrived-msg">'+esc(res.warn||"")+'</div>'+
      '<button class="btn btn-primary" id="kabWarnOk">Tushundim</button></div>';
    document.body.appendChild(ov);
    const close=()=>{ ov.remove(); };
    ov.querySelector("#kabWarnOk").addEventListener("click",close);
    ov.addEventListener("click",(e)=>{ if(e.target===ov) close(); });
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

  /* ============================================================
     TASDIQLANMAGAN BUYURTMA — kabinetga har kirganda so'raymiz
     Kuryer "Yetkazdim" bosgan (arrived), lekin mijoz tasdiqlamagan bo'lsa —
     shu oyna chiqadi. 30 daqiqadan keyin server o'zi 'done' qiladi.
     ============================================================ */
  function askPendingConfirmKab(){
    if(typeof STORE==="undefined" || !STORE.orders) return;
    if(document.getElementById("kabConfirmOverlay")) return;      // allaqachon ochiq
    let list=[]; try{ list=STORE.orders()||[]; }catch(e){ return; }
    const be=list.find(o=>o && o.status==="arrived" && o.user===USER.name);
    if(!be) return;
    const ov=document.createElement("div");
    ov.id="kabConfirmOverlay"; ov.className="arrived-overlay";
    ov.innerHTML='<div class="arrived-card">'+
      '<div class="arrived-emoji">'+(be.emoji||"🛵")+'</div>'+
      '<div class="arrived-title">Yetib keldi! 🎉</div>'+
      '<div class="arrived-name">'+esc(be.item||"Buyurtma")+'</div>'+
      '<div class="arrived-msg">Buyurtmangizni qabul qildingizmi?<br>Tasdiqlansangiz kuryer ishini yakunlaydi.</div>'+
      '<button class="btn btn-primary" id="kabPcYes">✅ Ha, qabul qildim</button>'+
      '<button class="btn btn-outline" id="kabPcLater" style="margin-top:8px">Keyinroq</button>'+
      '</div>';
    document.body.appendChild(ov);
    const close=()=>{ ov.classList.add("arrived-hide"); setTimeout(()=>ov.remove(),400); };
    ov.querySelector("#kabPcLater").addEventListener("click",close);
    ov.querySelector("#kabPcYes").addEventListener("click",async ()=>{
      const b=ov.querySelector("#kabPcYes"); b.disabled=true; b.textContent="Tasdiqlanmoqda…";
      try{ await STORE.confirmReceived(be.id); close(); toast("Rahmat! Buyurtma tasdiqlandi","success"); }
      catch(e){ b.disabled=false; b.textContent="✅ Ha, qabul qildim"; toast("Tasdiqlab bo'lmadi. Qayta urinib ko'ring.","error"); }
    });
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
      const p=(be&&be.photo)||""; return /^\/(?:uploads|img)\/|^data:/.test(p)?p:""; }catch(e){ return ""; }
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
      /* Ish vaqti — restoran o'zi (yoki admin) belgilaydi; mijoz shu yerda ko'radi */
      const open=kIsOpen(r.name), hrs=kHours(r.name);
      return `<div class="krest-card${hasPromo?' krest-promo':''}${open?'':' krest-shut'}" data-rest="${r.name}">
        <div class="krest-img tone-${r.kw||'burger'}">
          <span class="kemoji" style="font-size:44px;position:relative;z-index:1">${r.emoji||"🏪"}</span>
          ${(function(){const p=restPhotoK(r.name);return p?`<img src="${p}" alt="${esc(r.name)}" loading="lazy" data-onerr="remove" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:2;border-radius:0">`:"";})()}
          <span class="yz-openbadge ${open?'is-open':'is-closed'}">${open?'🟢 Ochiq':'🔴 Yopiq'}</span>
          ${hasPromo?'<span class="krest-promo-badge">🏷 AKSIYA</span>':''}
        </div>
        <div class="krest-body">
          <h3>${r.name}</h3>
          <div class="krest-meta">
            <span class="star">★ ${r.rating}</span>
            <span>⏱ ${r.eta} ${typeof KT==="function"?KT('daq'):'daq'}</span>
            <span>📍 ${r.dist}</span>
          </div>
          <div class="krest-meta" style="margin-top:2px"><span>🕒 ${esc(hrs)}</span></div>
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
      /* Restoran yopiq bo'lsa — menyu tepasida ochiq-oydin ogohlantirish */
      const open=kIsOpen(rname);
      const closedBar = open ? `` :
        `<div class="yz-closed-bar" style="flex-basis:100%;width:100%;margin-top:8px;margin-bottom:0">`+
        `<span style="font-size:19px">🔴</span><span><b>${esc(rname)}</b> hozir yopiq — buyurtma qabul qilinmaydi.<br>`+
        `Ish vaqti: <b>${esc(kHours(rname))}</b>. Shu vaqtda qayta kiring.</span></div>`;
      box.innerHTML=`<button class="kchip on" id="kRestFilterChip">🏪 ${esc(rname)} <span style="margin-left:4px;opacity:.7">✕</span></button>`+
        closedBar+
        (isPref?`<div style="flex-basis:100%;width:100%;margin-top:8px;font-size:13px;color:#16a34a;background:#eafaf0;border:1px solid #bdebd0;border-radius:10px;padding:8px 12px">⭐ Siz shu restorandan buyurtma bergansiz — taomlar shu yerdan tavsiya qilinmoqda. Boshqa restoran uchun ✕ bosing.</div>`:``);
      const chip=box.querySelector("#kRestFilterChip");
      if(chip) chip.addEventListener("click",()=>{ activeRest=null; renderFilters(); renderMenu(); });
    }
    renderMenuFiltered(list);
  }
  function renderMenuFiltered(list){
    const g=document.getElementById("kMenu"); if(!g) return;
    g.innerHTML=list.map(d=>kCardHTML(d,'🏷 CHEGIRMA')).join("");
    bindMenuEvents();
  }
  function bindMenuEvents(){
    document.querySelectorAll("#kMenu .kimg, #kMenu h4").forEach(el=>el.addEventListener("click",()=>{
      const id=+el.dataset.id; const d=kcatalog().find(x=>x.id===id); if(!d) return;
      /* Restoran ichida bo'lsak — taom tafsiloti; aks holda taomga bosilsa o'sha restoranga kiramiz */
      if(activeRest){ openKDishModal(d); }
      else { filterByRest(d.rest); try{window.scrollTo({top:0});}catch(e){} }
    }));
    document.querySelectorAll("#kMenu .kadd").forEach(b=>b.addEventListener("click",(e)=>{ e.stopPropagation(); addToCart(+b.dataset.id); }));
    document.querySelectorAll("#kMenu .kqty-btn").forEach(b=>b.addEventListener("click",(e)=>{ e.stopPropagation(); changeQty(+b.dataset.id,+b.dataset.m); updateKMenuQty(); }));
    bindShutButtons(document.getElementById("kMenu"));
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
    /* ===== Sessiya SERVERда tekshiriladi =====
       localStorage'dagi yz_session ga ishonmaymiz — rol /api/auth/me dan keladi. */
    $("#loginWrap").style.display="flex"; $("#app").classList.remove("show");
    if(typeof STORE!=="undefined" && STORE.sessionExpired && STORE.sessionExpired()){
      var le=$("#loginErr"); if(le) le.textContent="Sessiyangiz tugadi — qaytadan kiring.";
    }
    if(typeof STORE!=="undefined" && STORE.verifySession){
      STORE.verifySession().then(v=>{
        var a = (v.ok && v.account.role==="user") ? v.account
              : (!v.ok && v.reason==="offline" && v.session && v.session.role==="user") ? v.session
              : null;
        if(a) enterUser({login:a.login, name:a.name, phone:a.phone});
      }).catch(()=>{});
    }
    $("#loginBtn").addEventListener("click",login);
    $("#ulPass").addEventListener("keydown",e=>{ if(e.key==="Enter") login(); });
    $$(".sb-link").forEach(l=>l.addEventListener("click",()=>nav(l.dataset.view)));
    $("#logoutBtn").addEventListener("click",()=>{ if(typeof STORE!=="undefined") STORE.clearSession(); $("#app").classList.remove("show"); $("#loginWrap").style.display="flex"; $("#ulPass").value=""; try{location.href="index.html";}catch(e){} });
    // menuToggle — HTML script boshqaradi
    $("#revSubmit").addEventListener("click",submitReview);
    /* ===== Sozlamalar ===== */
    (function(){
      var v=function(id){ var el=document.getElementById(id); return el?el.value.trim():""; };
      var sp=document.getElementById("stSaveProfile");
      if(sp) sp.addEventListener("click", async function(){
        var msg=document.getElementById("stMsg");
        var name=v("stName"), phone=v("stPhone"), email=v("stEmail"), addr=v("stAddr");
        if(name.length<2){ if(msg){msg.style.color="#C8102E";msg.textContent="Ismni to'g'ri kiriting";} return; }
        if(email && window.YZ_EMAIL && !YZ_EMAIL.valid(email)){ if(msg){msg.style.color="#C8102E";msg.textContent="Email noto'g'ri formatda";} return; }
        try{ localStorage.setItem("yz_user_addr", addr); }catch(e){}
        var r=(typeof STORE!=="undefined"&&STORE.updateProfile)? await STORE.updateProfile({name:name,phone:phone,email:email}) : {error:"Serverga ulanmadi"};
        if(r && !r.error){ USER.name=name; USER.phone=phone; var sn=document.getElementById("sbName"); if(sn) sn.textContent=name;
          if(msg){msg.style.color="#16a34a";msg.textContent="✓ Saqlandi";} toast("Profil saqlandi ✓","success"); }
        else if(msg){ msg.style.color="#C8102E"; msg.textContent=(r&&r.error)||"Xatolik"; }
      });
      var sl=document.getElementById("stSaveLogin");
      if(sl) sl.addEventListener("click", async function(){
        var msg=document.getElementById("stMsg2");
        var login=v("stLogin"), pass=v("stPass"); var body={};
        if(login && login.length<3){ if(msg){msg.style.color="#C8102E";msg.textContent="Login kamida 3 belgi";} return; }
        if(login) body.login=login; if(pass){ if(pass.length<4){ if(msg){msg.style.color="#C8102E";msg.textContent="Parol kamida 4 belgi";} return; } body.pass=pass; }
        if(!Object.keys(body).length){ if(msg){msg.style.color="#777";msg.textContent="O'zgarish yo'q";} return; }
        var r=(typeof STORE!=="undefined"&&STORE.updateProfile)? await STORE.updateProfile(body) : {error:"Serverga ulanmadi"};
        if(r && !r.error){ if(login) USER.login=login; var p=document.getElementById("stPass"); if(p) p.value="";
          if(msg){msg.style.color="#16a34a";msg.textContent="✓ Saqlandi";} toast("Login/parol saqlandi ✓","success"); }
        else if(msg){ msg.style.color="#C8102E"; msg.textContent=(r&&r.error)||"Xatolik"; }
      });
      /* Sozlamalar > Til. Ilgari bu tugmalar burger varaqdagi tugmani
         "click" qilardi va I18N.setLang yo'qligi sabab til almashmasdi.
         Endi to'g'ridan-to'g'ri umumiy applyKabLang chaqiriladi. */
      var stL=document.getElementById("stLatin"), stC=document.getElementById("stCyr");
      function setLangFromSettings(lang){
        if(typeof window._yzApplyKabLang==="function"){ window._yzApplyKabLang(lang); }
        else{
          try{ localStorage.setItem("yz_lang", lang); }catch(e){}
          if(typeof I18N!=="undefined" && I18N.setLang){ I18N.setLang(lang); I18N.apply(); }
          if(typeof KT_APPLY==="function") KT_APPLY();
        }
      }
      if(stL) stL.addEventListener("click",function(){ setLangFromSettings("lat"); toast("Til: Lotin","success"); });
      if(stC) stC.addEventListener("click",function(){ setLangFromSettings("cyr"); toast("Тил: Кирилл","success"); });
      var snd=document.getElementById("stSound");
      if(snd) snd.addEventListener("change",function(){ try{ localStorage.setItem("yz_sound", snd.checked?"1":"0"); }catch(e){} toast(snd.checked?"Ovoz yoqildi":"Ovoz o'chirildi","success"); });
    })();
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
    /* Sozlamalardagi til tugmalari */
    const stLatBtn=document.getElementById("stLatin");
    const stCyrBtn=document.getElementById("stCyr");
    function markLangBtn(btn,on){
      if(!btn) return;
      btn.classList.toggle("is-active", on);
      btn.style.background = on ? "var(--red,#C8102E)" : "#f1eef0";
      btn.style.color      = on ? "#fff" : "#555";
    }
    function applyKabLang(lang){
      localStorage.setItem("yz_lang", lang);
      /* MUHIM: I18N ichidagi joriy tilni ham o'zgartiramiz, aks holda
         I18N.t()/I18N.apply() eski tilda qolib ketadi va til almashmaydi */
      if(typeof I18N!=="undefined" && I18N.setLang) I18N.setLang(lang);
      if(knsLat) knsLat.classList.toggle("active", lang==="lat");
      if(knsCyr) knsCyr.classList.toggle("active", lang==="cyr");
      markLangBtn(stLatBtn, lang==="lat");
      markLangBtn(stCyrBtn, lang==="cyr");
      /* Sahifani qayta render qilamiz — tarjima bilan */
      renderFilters();
      renderMenu();
      renderKabRests();
      /* DOM elementlarini yangilash */
      if(typeof KT_APPLY==="function") KT_APPLY();
      /* index.html i18n ham */
      if(typeof I18N!=="undefined") I18N.apply();
    }
    window._yzApplyKabLang = applyKabLang;
    const savedLang=localStorage.getItem("yz_lang")||"cyr";
    applyKabLang(savedLang);
    knsLat && knsLat.addEventListener("click",()=>applyKabLang("lat"));
    knsCyr && knsCyr.addEventListener("click",()=>applyKabLang("cyr"));
    document.addEventListener("change",e=>{ if(e.target && e.target.id==="revReason"){
      $("#revPhotoWrap").style.display = e.target.value==="quality" ? "block":"none"; } });
  });

  /* Savat tugmasi (yuqori panel) */
  document.addEventListener("DOMContentLoaded",function(){ var cb=document.getElementById("kabTopCart"); if(cb) cb.addEventListener("click",function(){ if(window._kabOpenCart) window._kabOpenCart(); }); });

})();
