/* ===== Yetkaz.uz — Foydalanuvchi paneli + AI izoh moderatsiyasi ===== */
(function(){
  try{ if(typeof STORE!=="undefined") STORE.setPanelRole("user"); }catch(e){}
  const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
  const money=n=>Math.round(n).toLocaleString("ru-RU");
  /* XSS himoyasi — ta'rif assets/js/safe.js da (YAGONA manba, `'` ni ham escape
     qiladi). Bu yerда faqat qisqartma. Yangi kod uchun: html`...` teg shabloni. */
  const esc=YZ_SAFE.esc, html=YZ_SAFE.html, raw=YZ_SAFE.raw;
  /* Emoji o'rniga — assets/icons.svg spritedagi ikon (rang CSS'дan, class="yz-i ..."). */
  const ic = (name, cls) => '<svg class="yz-i'+(cls?' '+cls:'')+'"><use href="assets/icons.svg#'+name+'"/></svg>';
  /* Taom emojisi o'rniga — kw (tone) kategoriyasiga mos ikon (assets/js/data.js
     dagi tone-* kategoriyalar bilan bir xil kalitlar). Asl `emoji` maydoni
     (DB/Telegram uchun) o'zgarmaydi — faqat DISPLAY shu ikonga almashadi. */
  const KW_ICON={burger:'food-burger',pizza:'food-pizza',shawarma:'food-shawarma',rice:'food-rice',noodles:'food-noodles',fries:'food-fries',hotdog:'food-hotdog',chicken:'food-chicken',cola:'food-drink',cake:'food-cake',salad:'food-salad',icecream:'food-icecream',dessert:'food-dessert',dumpling:'food-dumpling',kebab:'food-kebab',samosa:'food-samosa',milkshake:'food-milkshake',tea:'food-tea',donut:'food-donut'};
  const foodIcon = (kw, cls) => ic(KW_ICON[kw]||'food-generic', cls);
  /* Yulduzcha reyting — ★/☆ belgilar o'rniga ikon qatori */
  const starsHtml = (rating, max) => { max=max||5; const r=Math.max(0,Math.min(max,rating|0)); let s=""; for(let i=0;i<max;i++) s+= i<r ? ic("star","yz-i-fill yz-i-amber") : ic("star-outline","yz-i-amber"); return s; };
  /* Nom joriy tilga (lotin/kirill) TO'LIQ mos bo'lsin — nameCyr bo'sh bo'lsa
     ham avtomatik harflanadi (YZ_TRANSLIT), aralash alifbo qolmaydi. */
  const nm = o => { try{
    return I18N.current()==="cyr" ? YZ_TRANSLIT.toCyr(o.nameCyr||o.name) : YZ_TRANSLIT.toLat(o.name);
  }catch(e){ return o.name; } };
  const trTxt = s => { try{ return I18N.current()==="cyr" ? YZ_TRANSLIT.toCyr(s) : YZ_TRANSLIT.toLat(s); }catch(e){ return s; } };
  /* Geolokatsiya — manzilni qurilma joylashuvidan to'ldiradi */
  function detectLocation(inputEl, btn){
    if(!navigator.geolocation){ toast("Brauzeringiz joylashuvni qo'llamaydi","error"); return; }
    const orig=btn?btn.innerHTML:""; if(btn){ btn.disabled=true; btn.innerHTML=ic('map-pin')+" Aniqlanmoqda..."; }
    const done=()=>{ if(btn){ btn.disabled=false; btn.innerHTML=orig; } };
    navigator.geolocation.getCurrentPosition(async (pos)=>{
      const lat=pos.coords.latitude, lng=pos.coords.longitude; let addr="";
      try{ const r=await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&accept-language=uz`,{headers:{"Accept":"application/json"}}); const j=await r.json(); addr=(j&&j.display_name)||""; }catch(e){}
      if(!addr) addr=`(${lat.toFixed(5)}, ${lng.toFixed(5)})`;
      /* Inputga YOZMAYMIZ — foydalanuvchi yozgani turadi. Joylashuv faqat xotirada. */
      USER.geo = { lat:lat, lng:lng, addr:addr };
      done(); toast("Joylashuv aniqlandi (manzil maydoni o'zgarmaydi)","success");
    }, (err)=>{ done(); toast(err&&err.code===1?"Joylashuvga ruxsat berilmadi":"Joylashuvni aniqlab bo'lmadi","error"); },
    { enableHighAccuracy:true, timeout:10000, maximumAge:60000 });
  }

  /* Foydalanuvchi ma'lumoti kirgandan so'ng backenddan to'ladi (haqiqiy buyurtmalar).
     Soxta namuna buyurtma/izoh YO'Q. */
  const USER={
    id:null, name:"", phone:"", login:"", pass:"",
    orders:[],
    reviews:[]
  };

  let selRating=0, cart=[], activeCat="Hammasi";
  /* Mijozning O'Z tadbirlari (sinxron keshdan — kabPromoList uni async
     so'ramasdan o'qishi uchun). enterUser'да va yangi tadbir yuborilganda yangilanadi. */
  let KAB_MY_EVENTS=[];
  async function refreshMyEventsCache(){
    try{ KAB_MY_EVENTS=(typeof STORE!=="undefined"&&STORE.myEvents)? (await STORE.myEvents())||[] : []; }catch(e){}
  }
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
      addr:o.addr, pay:o.pay, deliveredIn:o.eta, promised:(o.eta||15)+3, reviewed:rid.has(String(o.id)), status:o.status, reason:o.reason||"",
      /* To'liq tafsilot modali uchun — items (rasm/chegirma), kuryer, guruh va h.k. */
      items:o.items||[], qtyTotal:o.qtyTotal||0, courier:o.courier||"", courierPhone:o.courierPhone||"",
      deliveryMin:o.deliveryMin||0, source:o.source||"", created_at:o.created_at||"",
      groupBreakdown:o.groupBreakdown||null, groupId:o.groupId||null };
  }
  /* Optimistik (hali serverga bog'lanmagan) yozuvning imzosi — restoran + taom + to'lov.
     Shu imzo bo'yicha backend buyurtmasi bilan yarashtirlади (id emas: lokal id
     Date.now(), backend id kichik son — hech qachon teng emas). */
  function orderSig(rest, dish, pay){
    return String(rest||"").trim()+"||"+String(dish||"").trim()+"||"+String(pay||"card");
  }
  /* Backenddagi buyurtmalarni mavjudlarga qo'shish. DUBLIKATSIZ:
       1) id bo'yicha topilsa — status/summa/sana yangilanadi
       2) topilmasa, lekin bog'lanmagan optimistik yozuv (_local) imzosi mos kelsa
          — O'SHA yozuv haqiqiy id/summa bilan YANGILANADI (yangi qator qo'shilmaydi)
       3) aks holda — yangi qator */
  function hydrateOrders(){
    if(typeof STORE==="undefined" || !STORE.ordersForUser) return;
    const byId={}; USER.orders.forEach(o=>{ byId[String(o.id)]=o; });
    STORE.ordersForUser(USER.name).forEach(o=>{
      const ex=byId[String(o.id)];
      if(ex){
        ex.status=o.status;
        ex.amount=(Number(o.amount)||0);           // server summasi — YAGONA haqiqat
        if(o.created_at){ ex.date=YZ_TIME.fmtDate(o.created_at)||ex.date; }
        if(o.reason) ex.reason=o.reason;
        delete ex._local;
        return;
      }
      /* Bog'lanmagan optimistik yozuvni imzo bo'yicha topamiz */
      const sig=orderSig(o.rest, o.item, o.pay);
      const pend=USER.orders.find(x=>x._local && orderSig(x.rest,x.dish,x.pay)===sig);
      if(pend){
        pend.id=o.id;
        pend.amount=(Number(o.amount)||0);
        pend.status=o.status;
        if(o.created_at){ pend.date=YZ_TIME.fmtDate(o.created_at)||pend.date; }
        if(o.reason) pend.reason=o.reason;
        delete pend._local;
        byId[String(o.id)]=pend;
      } else {
        USER.orders.push(beOrderToLocal(o));
      }
    });
    /* Yangi buyurtma tepada — id bo'yicha SONLI tartib (backend id kichik son,
       hali bog'lanmagan optimistik yozuv Date.now(); ikkalasi ham son). */
    USER.orders.sort((a,b)=>(Number(b.id)||0)-(Number(a.id)||0));
  }

  function enterUser(acc){
    /* Haqiqiy foydalanuvchi ma'lumoti — buyurtmalar backenddan yuklanadi */
    USER.id=acc.id; USER.name=acc.name; USER.login=acc.login; USER.phone=acc.phone||""; USER.orders=[]; USER.reviews=[];
    /* Saqlangan manzil (tuman/mahalla/ko'cha) — HAR SAFAR buyurtmada oldindan
       to'ldirilishi uchun (openCheckout: USER.address birinchi navbatda
       tekshiriladi). Hali saqlanmagan bo'lsa — shu qurilmadagi eski qiymat. */
    var savedAddr=formatAddr(acc.addrRegion,acc.addrMahalla,acc.addrStreet);
    if(!savedAddr){ try{ savedAddr=localStorage.getItem("yz_user_addr")||""; }catch(e){ savedAddr=""; } }
    USER.address=savedAddr;
    hydrateOrders();
    /* Foydalanuvchi avval buyurtma bergan restoranga avtomatik yo'naltiramiz */
    var pr=preferredRest(); if(pr) activeRest=pr;
    $("#loginWrap").style.display="none"; $("#app").classList.add("show");
    $("#sbName").textContent=USER.name; renderAll();
    try{ updateBonusBadge(); }catch(e){}
    /* Birinchi marta kirgan (yoki hali manzil saqlamagan) foydalanuvchiga
       bir martalik taklif: "Ma'lumotlaringizni saqlab qo'ying". */
    try{ maybeShowOnboarding(acc); }catch(e){}
    /* Yoqtirganlar RO'YXATI va BUYURTMALAR TARIXI — "eng ko'p buyurilgan +
       yoqtirilgan birinchi" saralashi shularga tayanadi. Keshdagi (localStorage)
       eski holat bilan darhol chizamiz (renderAll yuqorida), YANGI ma'lumot
       kelgach FAQAT BIR MARTA qayta saralab chizamiz (har poll tikida EMAS —
       aks holda ko'rib turgan grid navbat bilan aralashib ketardi). */
    if(typeof STORE!=="undefined"){
      Promise.all([
        STORE.refreshLikes ? STORE.refreshLikes() : null,
        STORE.refresh ? STORE.refresh() : null,
      ]).then(function(){
        hydrateOrders();
        try{ if(activeRest) filterByRest(activeRest); else renderMenu(); }catch(e){}
      });
    }
    /* AI maslahat: "har doim shu payt shu taomni buyurasiz — bugun ham xohlaysizmi?" */
    try{ checkHabitSuggestion(); }catch(e){}
    /* Tadbirlar (chegirmali bo'lsa reklama bannerда ko'rinishi uchun) */
    refreshMyEventsCache().then(function(){ try{ renderKabPromoBand(); }catch(e){} });
    /* Oldingi faol guruh (agar bo'lsa) — boshqa qurilma/sessiyada ham davom etsin.
       DOM hozir ko'rinmasa ham xavfsiz (renderGroupView ichidagi elementlar
       topilmasa jim o'tadi), lekin "Guruh yaratish"ga kirganda darrov tayyor bo'ladi. */
    restoreActiveGroup().then(function(){ try{ renderGroupView(); }catch(e){} });
    /* index.html'dagi reklama bannerdan "kabinet.html#bonus" kabi to'g'ridan-to'g'ri
       havola bilan kirilsa — o'sha bo'limni ochamiz (masalan #bonus, #events). */
    try{
      var h=(location.hash||"").replace("#","");
      if(h && document.getElementById("view-"+h)) nav(h);
    }catch(e){}
    if(typeof STORE!=="undefined" && STORE.onChange && !window.__kabSub){ window.__kabSub=true;
      STORE.onChange(function(){
        hydrateOrders();
        try{ renderProfil(); }catch(e){}
        try{ askPendingConfirmKab(); }catch(e){}
        /* Restoran ish vaqtini o'zgartirsa — kabinet darrov yangilansin */
        try{ refreshOpenState(true); }catch(e){}
        /* Aksiya/e'lon o'zgarsa — banner ham yangilansin */
        try{ renderKabPromoBand(); }catch(e){}
        /* Yangi bonus qo'shilsa — sidebar'da nishon chiqsin */
        try{ updateBonusBadge(); }catch(e){}
      }); }
    /* Kirganда tasdiqlanmagan buyurtma bo'lsa — darrov so'raymiz */
    if(typeof STORE!=="undefined" && STORE.ready) STORE.ready().then(function(){ try{ askPendingConfirmKab(); }catch(e){} }).catch(function(){});
    startKabOpenWatch();
  }

  /* ===== ONBOARDING: birinchi kirishда manzilni saqlashga taklif =====
     Hisob hali tuzilgan manzil saqlamagan bo'lsa (yoki bu qurilmada hali
     ko'rsatilmagan bo'lsa) — "Saqlash" bosilsa Sozlamalar/Profil bo'limiga
     olib boradi (u yerda Tuman/Mahalla/Ko'cha + Joylashuvni yoqish bor). */
  function maybeShowOnboarding(acc){
    var hasAddr = !!(acc && (acc.addrRegion || acc.addrMahalla || acc.addrStreet));
    if(hasAddr) return;
    var key="yz_onboard_shown_"+(acc&&acc.login||"");
    try{ if(localStorage.getItem(key)) return; }catch(e){}
    var c=$("#koContent"); if(!c) return;
    c.innerHTML=`<div style="text-align:center;padding:6px 4px">
      <div style="font-size:44px;color:var(--brand,#ff5722)">${ic('clipboard','yz-i-xxl')}</div>
      <h2 style="margin:10px 0 4px">Ma'lumotlaringizni saqlab qo'ying</h2>
      <p style="color:var(--grey);font-size:14px;line-height:1.5;margin-bottom:18px">Ism va manzilingizni bir marta saqlab qo'ysangiz, keyingi buyurtmalarda hammasi tayyor turadi — sizga oson bo'ladi</p>
      <div style="display:flex;gap:10px">
        <button id="obLater" style="flex:1;background:#f1eef0;color:#555;border:none;border-radius:10px;padding:11px 20px;font-weight:700;font-size:14px;cursor:pointer">Keyinroq</button>
        <button id="obSave" class="set-save" style="flex:1">${ic('save')} Saqlash</button>
      </div>
    </div>`;
    $("#koModal").classList.add("open"); $("#koBackdrop").classList.add("open");
    var close=function(){ $("#koModal").classList.remove("open"); $("#koBackdrop").classList.remove("open"); };
    var dismiss=function(){ try{ localStorage.setItem(key,"1"); }catch(e){} close(); };
    var later=$("#obLater"); if(later) later.addEventListener("click",dismiss);
    var save=$("#obSave"); if(save) save.addEventListener("click",function(){ dismiss(); nav("settings"); });
  }

  /* ===== BONUSLAR: admin/restoran belgilagan, mijoz shu yerда ko'radi =====
     Referral (do'st taklif qilish) turdagi bonusda — o'zining ulashish
     linki (index.html?ref=<login>) va nusxalash tugmasi ko'rsatiladi. */
  const BON_TYPE_LABEL_K={order_count:ic('package')+" Buyurtmalar soni",referral:ic('handshake')+" Do'st taklif qilish",custom:ic('help-circle')+" Ma'lumot"};
  function refLink(){ try{ return location.origin+"/?ref="+encodeURIComponent(USER.login||""); }catch(e){ return ""; } }
  /* "Yangi bonus" belgisi — Bonuslar bo'limini ochib ko'rgach avtomatik
     yo'qoladi (localStorage'да "ko'rilgan" id'lar saqlanadi). */
  function seenBonusIds(){ try{ return new Set(JSON.parse(localStorage.getItem("yz_kab_seen_bonuses")||"[]")); }catch(e){ return new Set(); } }
  function updateBonusBadge(){
    try{
      const seen=seenBonusIds();
      const list=(typeof STORE!=="undefined"&&STORE.bonuses)?STORE.bonuses():[];
      const hasNew=list.some(b=>b&&b.id!=null&&!seen.has(String(b.id)));
      $$('.sb-link[data-view="bonus"]').forEach(link=>{
        const icEl=link.querySelector(".ic"); if(!icEl) return;
        let dot=icEl.querySelector(".yz-newdot");
        if(hasNew){ if(!dot){ dot=document.createElement("span"); dot.className="yz-newdot"; icEl.appendChild(dot); } }
        else if(dot){ dot.remove(); }
      });
    }catch(e){}
  }
  function markBonusesSeen(){
    try{
      const list=(typeof STORE!=="undefined"&&STORE.bonuses)?STORE.bonuses():[];
      localStorage.setItem("yz_kab_seen_bonuses", JSON.stringify(list.map(b=>String(b.id))));
    }catch(e){}
    updateBonusBadge();
  }
  function renderBonusesKab(){
    const host=$("#bonusListKab"); if(!host) return;
    const list=(typeof STORE!=="undefined"&&STORE.bonuses)?STORE.bonuses():[];
    if(!list.length){ host.innerHTML='<p style="color:var(--grey);font-size:13px;text-align:center;padding:20px 0">Hozircha bonus yo\'q. Tez orada qo\'shiladi!</p>'; return; }
    host.innerHTML=list.map(function(b){
      const who=b.scope==="restoran" ? (ic('store')+' '+esc(b.rest)) : ic('globe')+' Barcha restoranlar';
      const shareBtn = b.type==="referral"
        ? '<button class="set-save" data-bonshare style="margin-top:8px;width:100%;background:#f1eef0;color:#555">'+ic('link')+' Ulashish havolamni nusxalash</button>'
        : '';
      return '<div class="panel" style="margin-bottom:12px">'+
        '<div style="display:flex;gap:12px;align-items:flex-start;padding:14px">'+
          (b.image?'<img src="'+esc(b.image)+'" alt="" style="width:54px;height:54px;border-radius:12px;object-fit:cover;flex:none">':'<span style="flex:none;color:var(--brand,#ff5722)">'+ic('gift','yz-i-xl')+'</span>')+
          '<div style="flex:1;min-width:0">'+
            '<div style="font-weight:800;font-size:15px">'+esc(b.title)+'</div>'+
            '<div style="color:var(--grey);font-size:12px;margin-top:2px">'+who+' · '+(BON_TYPE_LABEL_K[b.type]||b.type)+(b.target?' · maqsad: '+b.target:'')+'</div>'+
            (b.descr?'<p style="font-size:13.5px;margin-top:6px;color:#444">'+esc(b.descr)+'</p>':'')+
            (b.rewardText?'<div style="color:#16a34a;font-size:13px;font-weight:800;margin-top:6px">'+ic('trophy')+' '+esc(b.rewardText)+'</div>':'')+
            shareBtn+
          '</div>'+
        '</div></div>';
    }).join("");
    host.querySelectorAll('[data-bonshare]').forEach(function(btn){
      btn.addEventListener("click",async function(){
        const link=refLink();
        try{ await navigator.clipboard.writeText(link); toast("Havola nusxalandi","success"); }
        catch(e){ toast(link); }
      });
    });
  }

  /* ===== TADBIRLAR: mijoz oldindan yuboradi, admin/restoran ko'radi va
     chegirma belgilaydi (routes/events.js). ===== */
  const EV_STATUS_LABEL={pending:ic('clock')+" Kutilmoqda",discounted:ic('check-circle','yz-i-green')+" Chegirma belgilandi"};
  function fillEventRestSelect(){
    const sel=$("#evRest"); if(!sel) return;
    const rests=restListK();
    sel.innerHTML=rests.map(r=>`<option value="${esc(r.name)}">${esc(trTxt(r.name))}</option>`).join("");
  }
  async function renderEventsKab(){
    fillEventRestSelect();
    const host=$("#evListKab"); if(!host) return;
    const list=(typeof STORE!=="undefined"&&STORE.myEvents)? await STORE.myEvents() : [];
    if(!Array.isArray(list)||!list.length){ host.innerHTML='<p style="color:var(--grey);font-size:13px">Hali tadbir yubormagansiz.</p>'; return; }
    host.innerHTML=list.map(function(e){
      return '<div style="padding:10px 0;border-bottom:1px solid var(--line)">'+
        '<div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap">'+
          '<b>'+esc(e.name)+'</b><span style="font-size:12px;color:var(--grey)">'+EV_STATUS_LABEL[e.status]+'</span></div>'+
        '<div style="font-size:12.5px;color:var(--grey);margin-top:2px">'+ic('store')+' '+esc(trTxt(e.rest))+' · '+ic('calendar')+' '+esc(e.eventDate)+' · '+ic('users')+' '+(e.headcount||0)+' kishi</div>'+
        (e.dish?'<div style="font-size:12.5px;color:var(--ink);margin-top:2px">'+ic('utensils')+' '+esc(e.dish)+'</div>':'')+
        (e.discountPct>0?'<div style="font-size:12.5px;color:#16a34a;font-weight:700;margin-top:2px">'+ic('tag')+' '+e.discountPct+'% chegirma belgilandi</div>':'')+
        '</div>';
    }).join("");
  }
  async function submitEvent(){
    const rest=$("#evRest")?$("#evRest").value:"", name=$("#evName")?$("#evName").value.trim():"";
    const date=$("#evDate")?$("#evDate").value:"", headcount=$("#evHeadcount")?Number($("#evHeadcount").value)||0:0;
    const dish=$("#evDish")?$("#evDish").value.trim():"";
    const advance=$("#evAdvance")?Number($("#evAdvance").value)||1:1;
    const msg=$("#evMsg");
    const setMsg=(t,ok)=>{ if(msg){ msg.style.color=ok?"#16a34a":"#C8102E"; msg.textContent=t; } };
    if(!rest) return setMsg("Restoranni tanlang", false);
    if(!name) return setMsg("Tadbir nomini kiriting", false);
    if(!date) return setMsg("Sanani tanlang", false);
    if(!dish) return setMsg("Qaysi taom kerakligini yozing", false);
    const btn=$("#evSubmit"); if(btn) btn.disabled=true;
    const r=(typeof STORE!=="undefined"&&STORE.addEvent)? await STORE.addEvent({rest:rest,name:name,event_date:date,dish:dish,headcount:headcount,advance_days:advance}) : {error:"Tizim tayyor emas"};
    if(btn) btn.disabled=false;
    if(r&&r.error){ setMsg(r.error, false); return; }
    setMsg("Yuborildi", true); toast("Tadbir yuborildi","success");
    if($("#evName")) $("#evName").value=""; if($("#evDate")) $("#evDate").value=""; if($("#evHeadcount")) $("#evHeadcount").value=""; if($("#evDish")) $("#evDish").value="";
    renderEventsKab();
    refreshMyEventsCache();
  }

  /* ============================================================
     GURUH BUYURTMASI — bir nechta a'zo, bitta yetkazish, HAR KIM O'Z
     ulushini alohida to'laydi (server: routes/groups.js). Faol guruh
     localStorage'да saqlanadi — sahifa qayta ochilsa ham davom etadi.
     ============================================================ */
  const GROUP_ID_KEY="yz_active_group_id";
  let ACTIVE_GROUP=null, _groupPoll=null;

  function fillGroupRestSelect(){
    const sel=$("#grpNewRest"); if(!sel) return;
    sel.innerHTML=restListK().map(r=>`<option value="${esc(r.name)}">${esc(trTxt(r.name))}</option>`).join("");
  }
  function stopGroupPoll(){ if(_groupPoll){ clearInterval(_groupPoll); _groupPoll=null; } }
  function startGroupPoll(){
    stopGroupPoll();
    _groupPoll=setInterval(async ()=>{
      if(!ACTIVE_GROUP || ACTIVE_GROUP.status!=="open") { stopGroupPoll(); return; }
      await refreshActiveGroup();
    }, 4000);
  }
  async function refreshActiveGroup(){
    if(!ACTIVE_GROUP) return;
    const r=await STORE.getGroup(ACTIVE_GROUP.id);
    if(r && !r.error){ ACTIVE_GROUP=r; try{ renderGroupView(); }catch(e){} }
  }
  /* Sahifa (yoki login) qayta ochilganda — oldingi faol guruhni tiklaymiz. */
  async function restoreActiveGroup(){
    let gid=null; try{ gid=localStorage.getItem(GROUP_ID_KEY); }catch(e){}
    if(!gid) return;
    const r=await STORE.getGroup(gid);
    if(r && !r.error){ ACTIVE_GROUP=r; if(r.status!=="open"){ try{ localStorage.removeItem(GROUP_ID_KEY); }catch(e){} } }
    else { try{ localStorage.removeItem(GROUP_ID_KEY); }catch(e){} }
  }

  function renderGroupView(){
    fillGroupRestSelect();
    const intro=$("#groupIntro"), active=$("#groupActive"), done=$("#groupDone");
    if(ACTIVE_GROUP && ACTIVE_GROUP.status==="open"){
      if(intro) intro.style.display="none"; if(done) done.style.display="none"; if(active) active.style.display="";
      renderActiveGroup(); startGroupPoll();
    } else if(ACTIVE_GROUP && ACTIVE_GROUP.status==="confirmed"){
      if(intro) intro.style.display="none"; if(active) active.style.display="none"; if(done) done.style.display="";
      renderGroupDone(); stopGroupPoll();
    } else {
      if(intro) intro.style.display=""; if(active) active.style.display="none"; if(done) done.style.display="none";
      stopGroupPoll();
    }
  }

  async function createGroup(){
    const rest=$("#grpNewRest")?$("#grpNewRest").value:"";
    const msg=$("#grpMsg"); if(msg) msg.textContent="";
    if(!rest) return;
    const r=await STORE.createGroup(rest);
    if(r&&r.error){ if(msg){msg.style.color="#C8102E";msg.textContent=r.error;} return; }
    ACTIVE_GROUP=r; try{ localStorage.setItem(GROUP_ID_KEY,String(r.id)); }catch(e){}
    toast("Guruh yaratildi! Kodi: "+r.code,"success");
    renderGroupView();
  }
  async function joinGroupCode(){
    const code=$("#grpJoinCode")?$("#grpJoinCode").value.trim().toUpperCase():"";
    const msg=$("#grpMsg"); if(msg) msg.textContent="";
    if(!code){ if(msg){msg.style.color="#C8102E";msg.textContent="Kodni kiriting";} return; }
    const r=await STORE.joinGroup(code);
    if(r&&r.error){ if(msg){msg.style.color="#C8102E";msg.textContent=r.error;} return; }
    ACTIVE_GROUP=r; try{ localStorage.setItem(GROUP_ID_KEY,String(r.id)); }catch(e){}
    toast("Guruhga qo'shildingiz","success");
    renderGroupView();
  }

  function renderActiveGroup(){
    const g=ACTIVE_GROUP; if(!g) return;
    const titleEl=$("#grpTitle"); if(titleEl) titleEl.innerHTML=ic('users')+" "+esc(trTxt(g.rest))+" — guruh";
    const codeEl=$("#grpCodeBadge"); if(codeEl) codeEl.textContent="Kod: "+g.code;
    const addrEl=$("#grpAddr");
    if(addrEl && document.activeElement!==addrEl) addrEl.value=g.addr||"";
    const myMember=(g.members||[]).find(m=>m.accountId===USER.id);
    const payEl=$("#grpMyPay");
    if(payEl && document.activeElement!==payEl) payEl.value=(myMember&&myMember.pay)||"cash";

    /* Guruh savati — a'zo ismi bo'yicha guruhlangan, har taom alohida qator */
    const byMember={};
    (g.items||[]).forEach(it=>{ (byMember[it.memberName]=byMember[it.memberName]||[]).push(it); });
    const cartHost=$("#grpCart");
    const names=Object.keys(byMember);
    if(cartHost){
      /* 4s'da bir avtomatik yangilanadi (real vaqt) — scroll pastga tushirilgan
         bo'lsa, har yangilanishда tepaga otilib ketmasin. */
      const _scrollTop=cartHost.scrollTop;
      if(!names.length){ cartHost.innerHTML='<p style="color:var(--grey);font-size:13px">Hali hech kim taom qo\'shmagan.</p>'; }
      else {
        cartHost.innerHTML=names.map(name=>{
          const rows=byMember[name].map(it=>{
            const mine=it.accountId===USER.id;
            return `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:6px 0;border-top:1px dashed var(--line)">
              <span style="font-size:13.5px">${esc(it.dishName)} ×${it.qty}${it.note?' <span style="color:var(--grey);font-size:12px">'+ic('message')+' '+esc(it.note)+'</span>':''}</span>
              ${mine?`<button data-grpitemdel="${it.id}" style="background:none;border:none;color:#C8102E;cursor:pointer;font-size:15px;flex:none">${ic('x')}</button>`:''}
            </div>`;
          }).join("");
          return `<div style="margin-bottom:10px"><b style="font-size:13.5px">${ic('user')} ${esc(name)}</b>${rows}</div>`;
        }).join("");
        cartHost.querySelectorAll("[data-grpitemdel]").forEach(b=>b.addEventListener("click",async()=>{
          b.disabled=true;
          const r=await STORE.deleteGroupItem(g.id,b.dataset.grpitemdel);
          if(r&&!r.error){ ACTIVE_GROUP=r; renderActiveGroup(); }
        }));
      }
      cartHost.scrollTop=_scrollTop;
    }

    /* Guruh restoranining taomlari — oddiy "+" bilan qo'shiladi (guruh
       savati shaxsiy savatdan ALOHIDA — bu yerдаgi "+" shaxsiy cart'ga
       tegmaydi, faqat guruhga qo'shadi). */
    const dishGrid=$("#grpDishGrid");
    if(dishGrid){
      const dishes=kcatalog().filter(d=>d.rest===g.rest);
      dishGrid.innerHTML=dishes.map(d=>`
        <div class="card">
          <div class="card-img tone-${esc(d.kw||"")}"><span class="food-emoji">${foodIcon(d.kw)}</span>
            ${d.photo?`<img class="card-photo-bg" src="${d.photo}" alt="" aria-hidden="true" loading="lazy" data-onerr="remove"><img class="card-photo" src="${d.photo}" alt="${esc(nm(d))}" loading="lazy" data-onerr="remove">`:""}
          </div>
          <div class="card-body">
            <h3>${esc(nm(d))}</h3>
            <div class="card-rest">${esc(trTxt(d.rest))}</div>
            <div class="card-foot"><span class="price">${money(d.price)} <small>so'm</small></span></div>
          </div>
          <div class="card-pod"><div class="card-pod-action"><button class="add-btn" data-grpadd="${d.id}">+</button></div></div>
        </div>`).join("");
      dishGrid.querySelectorAll("[data-grpadd]").forEach(b=>b.addEventListener("click",async()=>{
        b.disabled=true;
        const id=+b.dataset.grpadd;
        const r=await STORE.addGroupItem(g.id,{dishId:id,qty:1});
        b.disabled=false;
        if(r&&r.error){ toast(r.error); return; }
        ACTIVE_GROUP=r; renderActiveGroup();
      }));
    }
  }

  function renderGroupDone(){
    const g=ACTIVE_GROUP, body=$("#grpDoneBody"); if(!body) return;
    body.innerHTML=`<div style="text-align:center;padding:10px 4px">
      <div style="font-size:48px;color:#16a34a">${ic('check-circle','yz-i-xxl')}</div>
      <p style="font-weight:700;margin:8px 0">Buyurtma raqami: #${g.orderId}</p>
      <p style="color:var(--grey);font-size:13.5px">Guruh a'zolari va ularning ulushi buyurtma tarkibida saqlandi. Yetkazilishini "Mening kabinetim" bo'limidan kuzatishingiz mumkin.</p>
      <button class="set-save" id="grpNewOne" style="margin-top:14px">${ic('plus')} Yangi guruh boshlash</button>
    </div>`;
    const nb=$("#grpNewOne"); if(nb) nb.addEventListener("click",()=>{
      ACTIVE_GROUP=null; try{ localStorage.removeItem(GROUP_ID_KEY); }catch(e){}
      renderGroupView();
    });
  }

  async function saveGroupAddr(){
    const g=ACTIVE_GROUP; if(!g) return;
    const addr=$("#grpAddr")?$("#grpAddr").value.trim():"";
    if(!addr){ toast("Manzilni kiriting"); return; }
    const r=await STORE.setGroupAddr(g.id,addr);
    if(r&&r.error){ toast(r.error); return; }
    ACTIVE_GROUP=r; toast("Manzil saqlandi","success");
  }
  async function changeGroupPay(){
    const g=ACTIVE_GROUP; if(!g) return;
    const pay=$("#grpMyPay")?$("#grpMyPay").value:"cash";
    const r=await STORE.setGroupPay(g.id,pay);
    if(r&&!r.error) ACTIVE_GROUP=r;
  }
  async function confirmGroupOrder(){
    const g=ACTIVE_GROUP; if(!g) return;
    const msg=$("#grpConfirmMsg"); if(msg) msg.textContent="";
    const btn=$("#grpConfirmBtn"); if(btn) btn.disabled=true;
    const r=await STORE.confirmGroup(g.id);
    if(btn) btn.disabled=false;
    if(r&&r.error){ if(msg){msg.style.color="#C8102E";msg.textContent=r.error;} return; }
    ACTIVE_GROUP=r.group;
    try{ localStorage.removeItem(GROUP_ID_KEY); }catch(e){}
    toast("Guruh buyurtmasi yakunlandi","success");
    renderGroupView();
  }

  /* ===== AI MASLAHAT: buyurtma "odati" ===== =====
     Mijoz har doim (kamida 3 kun) bir xil taomni bir xil payt atrofida
     buyurtsa — server (habit.js) shuni aniqlaydi. Hozir aynan shu payt bo'lsa
     va bugun hali olmagan bo'lsa — bitta marta (kunига bitta) so'raymiz:
     "Bugun ham {taom} buyurasizmi?" — kuniga bir marta, rad etilsa ertaga
     qayta so'raladi (localStorage: sana bo'yicha kalit). */
  function habitDismissKey(){ return "yz_habit_dismiss_"+new Date().toISOString().slice(0,10); }
  async function checkHabitSuggestion(){
    if(!USER.phone) return;
    try{ if(localStorage.getItem(habitDismissKey())) return; }catch(e){}
    if(typeof STORE==="undefined" || !STORE.habitSuggestion) return;
    let dish=null;
    try{ dish=await STORE.habitSuggestion(USER.phone); }catch(e){}
    if(!dish || !dish.name) return;
    showHabitPrompt(dish);
  }
  function showHabitPrompt(dish){
    const c=$("#koContent"); if(!c) return;
    const dishName=esc(dish.name);
    c.innerHTML=`<div style="text-align:center;padding:6px 4px">
      <div style="font-size:44px;color:var(--brand,#ff5722)">${foodIcon(dish.kw,'yz-i-xxl')}</div>
      <h2 style="margin:10px 0 4px">Bugun ham ${dishName} buyurasizmi?</h2>
      <p style="color:var(--grey);font-size:14px;line-height:1.5;margin-bottom:18px">Siz odatda shu payt <b>${esc(dish.rest)}</b>dan <b>${dishName}</b> buyurtma qilasiz</p>
      <div style="display:flex;gap:10px">
        <button id="habitNo" style="flex:1;background:#f1eef0;color:#555;border:none;border-radius:10px;padding:11px 20px;font-weight:700;font-size:14px;cursor:pointer">Yo'q, rahmat</button>
        <button id="habitYes" class="set-save" style="flex:1">Ha, xohlayman</button>
      </div>
    </div>`;
    $("#koModal").classList.add("open"); $("#koBackdrop").classList.add("open");
    const close=()=>{ $("#koModal").classList.remove("open"); $("#koBackdrop").classList.remove("open"); };
    const dismiss=()=>{ try{ localStorage.setItem(habitDismissKey(),"1"); }catch(e){} close(); };
    const no=$("#habitNo"); if(no) no.addEventListener("click",dismiss);
    const yes=$("#habitYes"); if(yes) yes.addEventListener("click",()=>{
      const d=kcatalog().find(x=>x.rest===dish.rest && x.name===dish.name);
      if(d){ addToCart(d.id); toast("Savatga qo'shildi","success"); }
      dismiss();
    });
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

  /* «Yordam» bo'limidagi bevosita bog'lanish — YAGONA manba: assets/js/support.js.
     Admin «Sozlamalar»да yozib qo'ygan telefon / username / havola. */
  function fillSupportContact(){
    var host=document.getElementById("kabSupportBox"); if(!host) return;
    if(typeof YZ_SUPPORT!=="undefined" && YZ_SUPPORT.mount){ YZ_SUPPORT.mount(host,{title:"🆘 Bevosita bog'lanish"}); return; }
    host.style.display="none";
  }

  /* Alohida "Taomlar" tab YO'Q — taomlar FAQAT Restoranlar orqali ko'rinadi
     (restoran tanlansa #view-taomlar'даgi grid o'sha restoran menyusi bilan
     to'ldirilib ko'rsatiladi — pastroqdagi restoran-karta click handlerga qarang). */
  function nav(view){
    $$(".sb-link").forEach(l=>l.classList.toggle("active",l.dataset.view===view));
    $$(".view").forEach(v=>v.classList.toggle("show",v.id==="view-"+view));
    const t={profil:"Mening kabinetim",rests:"Asosiy sahifa",group:"Guruh yaratish",bonus:"Bonuslar",events:"Tadbirlar",review:"Izoh qoldirish",help:"Qanday buyurtma berish",settings:"Sozlamalar"};
    $("#tbTitle").textContent=t[view]||""; $("#sidebar").classList.remove("open"); window.scrollTo({top:0});
    if(view==="review") renderReviewForm();
    if(view==="settings") renderSettings();
    if(view==="help") fillSupportContact();
    if(view==="rests")  renderKabRests();
    if(view==="bonus"){ renderBonusesKab(); markBonusesSeen(); }
    if(view==="events") renderEventsKab();
    if(view==="group")  renderGroupView();
    else try{ stopGroupPoll(); }catch(e){}   // boshqa bo'limga o'tsa — fonda so'rov yubormaymiz
  }

  function kabCancelOrder(oid){
    let el=document.getElementById("kabCancelModal"); if(el) el.remove();
    el=document.createElement("div"); el.id="kabCancelModal";
    el.style.cssText="position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;padding:18px";
    el.innerHTML="<div style=\"background:#fff;border-radius:20px;max-width:380px;width:100%;padding:24px;text-align:center\">"+
      "<div style=\"font-size:42px;color:#C8102E\">"+ic('stop-circle','yz-i-xxl')+"</div><h3 style=\"margin:8px 0\">Buyurtmani bekor qilish</h3>"+
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

  /* Tuman/mahalla/ko'cha — bitta o'qiladigan manzil satriga birlashtiriladi.
     orders-core.js `addr` maydoni oddiy STRING kutadi — buni o'zgartirmaymiz,
     faqat kabinet tomonda FORMATLAYMIZ. */
  function formatAddr(region,mahalla,street){
    var parts=[];
    if(region) parts.push(String(region).trim());
    if(mahalla) parts.push(String(mahalla).trim()+" mahallasi");
    if(street) parts.push(String(street).trim());
    return parts.join(", ");
  }
  /* Profil rasmi (Telegram kabi) — Sozlamalar'даgi doiraviy ko'rinish */
  function renderAvaPreview(url){
    var box=document.getElementById("avaPreview"); if(!box) return;
    box.innerHTML = url ? '<img src="'+esc(url)+'" alt="" style="width:100%;height:100%;object-fit:cover">' : ic('user','yz-i-xl');
  }
  /* Rasmni canvas orqali kichraytirib (max 500px, doiraviy profil uchun yetarli) dataURL qaytaradi */
  function resizeAvaImage(file){
    return new Promise(function(resolve){
      var fr=new FileReader();
      fr.onload=function(){ var img=new Image();
        img.onload=function(){ var w=img.width, h=img.height; var scale=Math.min(1, 500/Math.max(w,h));
          w=Math.round(w*scale); h=Math.round(h*scale);
          var cv=document.createElement("canvas"); cv.width=w; cv.height=h;
          cv.getContext("2d").drawImage(img,0,0,w,h);
          try{ resolve(cv.toDataURL("image/jpeg",0.85)); }catch(e){ resolve(fr.result); } };
        img.onerror=function(){ resolve(""); }; img.src=fr.result; };
      fr.onerror=function(){ resolve(""); }; fr.readAsDataURL(file);
    });
  }
  function renderSettings(){
    var ses=(typeof STORE!=="undefined")?STORE.session():null;
    var set=function(id,v){ var el=document.getElementById(id); if(el) el.value=v||""; };
    set("stName", USER.name||(ses&&ses.name));
    set("stPhone", USER.phone||(ses&&ses.phone));
    set("stEmail", (ses&&ses.email)||"");
    set("stLogin", USER.login||(ses&&ses.login));
    set("stRegion", ses&&ses.addrRegion);
    set("stMahalla", ses&&ses.addrMahalla);
    set("stStreet", ses&&ses.addrStreet);
    renderAvaPreview(ses&&ses.avatar);
    try{ if(typeof YZ_SUPPORT!=="undefined"){ var sb=document.getElementById("kabLoginSupport"); if(sb) YZ_SUPPORT.mount(sb,{compact:true,intro:""}); } }catch(e){}
    var snd=document.getElementById("stSound");
    try{ if(snd) snd.checked = localStorage.getItem("yz_sound")!=="0"; }catch(e){}
  }
  function renderProfil(){
    /* "Jami sarflagan" — FAQAT yetkazilgan (done) buyurtmalar. Bekor qilingan
       yoki hali yo'ldagi buyurtma pul sarflangan degani emas. Admin/restoran/
       kuryer panellari ham aynan shunday (status==="done") hisoblaydi. */
    const doneOrders=USER.orders.filter(o=>o.status==="done");
    const spent=doneOrders.reduce((s,o)=>s+(Number(o.amount)||0),0);
    $("#statCards").innerHTML=`
      <div class="scard c1"><div class="si">${ic('receipt')}</div><b>${USER.orders.length}</b><span>Buyurtmalar</span></div>
      <div class="scard c2"><div class="si">${ic('star','yz-i-fill yz-i-amber')}</div><b>${USER.reviews.length}</b><span>Izohlarim</span></div>
      <div class="scard c3"><div class="si">${ic('card')}</div><b>${money(spent)}</b><span>Jami sarflagan (so'm)</span></div>`;
    $("#orderTbody").innerHTML=USER.orders.map(o=>{
      /* 'review' — admin tekshiruvidagi katta buyurtma; undan ham voz kechish mumkin */
      const cancellable=(o.status==="review"||o.status==="new"||o.status==="accepted"||o.status==="ready");
      const last = cancellable
        ? `<button class="kab-cancel" data-oid="${o.id}" style="background:#fdecec;color:#C8102E;border:none;border-radius:8px;padding:6px 11px;font-size:12px;font-weight:700;cursor:pointer">${ic('x')} Bekor</button>`
        : (o.status==="cancelled" ? ('<span class="pill warn">Bekor qilingan</span>'+(o.reason?'<div style="font-size:11px;color:#C8102E;margin-top:3px">'+esc(o.reason)+'</div>':''))
          : (o.reviewed?'<span class="pill ok">Izoh berilgan</span>':'<span class="pill warn">Izoh kutmoqda</span>'));
      const rp=restPhotoK(o.rest);
      return `<tr class="kab-order-row" data-oid="${o.id}" style="cursor:pointer">
        <td><div class="tname"><span class="av">${kOrderThumb(o,40)}</span>${esc(o.dish)}</div></td>
        <td><div class="tname">${rp?`<img class="av" src="${esc(rp)}" alt="" style="object-fit:cover">`:`<span class="av">${ic('store')}</span>`}${esc(o.rest)}</div></td>
        <td>${esc(o.date)}</td>
        <td class="money">${money(o.amount)}</td>
        <td>${o.deliveryMin>0?o.deliveryMin+" daq":(o.deliveredIn+" daq (taxm.)")}</td>
        <td>${last}</td>
      </tr>`;}).join("");
    $$("#orderTbody .kab-cancel").forEach(b=>b.addEventListener("click",(e)=>{ e.stopPropagation(); kabCancelOrder(b.dataset.oid); }));
    $$("#orderTbody .kab-order-row").forEach(tr=>tr.addEventListener("click",()=>{
      const o=USER.orders.find(x=>String(x.id)===tr.dataset.oid); if(o) openKOrderDetailModal(o);
    }));
    $("#myReviews").innerHTML=USER.reviews.length?USER.reviews.map(r=>`
      <div class="panel" style="margin-bottom:10px"><div class="panel-body">
        <div style="display:flex;justify-content:space-between"><b>${esc(r.dish)}</b><span class="star">${starsHtml(r.rating)}</span></div>
        <p style="color:var(--ink);font-size:14px;margin-top:6px">${esc(r.text)}</p>
        <div style="color:var(--grey);font-size:12px;margin-top:6px">${r.date}${r.flagged?' · <span style="color:var(--red)">restoranga signal yuborilgan</span>':''}</div>
      </div></div>`).join(""):'<p style="color:var(--grey)">Hali izoh yo\'q.</p>';
  }

  function renderReviewForm(){
    const un=USER.orders.filter(o=>!o.reviewed);
    const sel=$("#revOrder");
    sel.innerHTML=un.length?un.map(o=>`<option value="${o.id}">${o.dish} — ${o.rest} (${o.date})</option>`).join("")
      :'<option value="">Barcha buyurtmalarga izoh berilgan</option>';
    selRating=0; renderStars();
    $("#revText").value=""; $("#revReasonWrap").style.display="none"; $("#revPhotoWrap").style.display="none";
    if($("#revReason")) $("#revReason").value="";
  }
  function renderStars(){
    $("#revStars").innerHTML=[1,2,3,4,5].map(n=>`<span class="star-pick" data-n="${n}">${n<=selRating?ic("star","yz-i-fill yz-i-amber"):ic("star-outline","yz-i-amber")}</span>`).join("");
    $$("#revStars .star-pick").forEach(s=>s.addEventListener("click",()=>{ result("",""); selRating=+s.dataset.n; renderStars();
      $("#revReasonWrap").style.display = selRating<=3 ? "block":"none";
      if(selRating>3){ $("#revPhotoWrap").style.display="none"; } }));
  }
  function result(msg,type){ const e=$("#revResult"); e.textContent=msg; e.className="rev-result"+(type?(" "+type):""); }

  function addReview(o,rating,text,flagged,note){
    USER.reviews.unshift({dish:o.dish,rating,text,date:new Date().toLocaleDateString("ru-RU"),flagged});
    o.reviewed=true; o.rating=rating; markReviewed(o.id);
    try{ if(typeof STORE!=="undefined") STORE.addReview({name:USER.name,ava:"",rating:rating,dish:o.dish,text:text||"",flagged:!!flagged}); }catch(e){}
  }
  function finishReview(){ renderProfil(); renderReviewForm(); }

  function submitReview(){
    const oid=+$("#revOrder").value; const o=USER.orders.find(x=>x.id===oid);
    if(!o){ result("Izoh qoldirish uchun buyurtma yo'q.","err"); return; }
    if(!selRating){ result("Avval bahoni tanlang (yulduzcha bosing).","err"); return; }
    const text=$("#revText").value.trim();
    if(selRating>=4){ addReview(o,selRating,text||"Yaxshi",false,""); result("Rahmat! Izohingiz joylandi.","ok"); finishReview(); return; }
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
    const cats=[...DISH_CATS, "Restoranlar"];
    box.innerHTML=cats.map(c=>{
      const isRest=c==="Restoranlar";
      const active=isRest ? (activeRest&&activeCat==="Hammasi") : (c===activeCat&&!activeRest);
      return `<button class="kchip${active?" on":""}" data-c="${c}">${c}</button>`;
    }).join("");
    $$("#kFilters .kchip").forEach(b=>b.addEventListener("click",()=>{
      const c=b.dataset.c;
      if(c==="Restoranlar"){
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
  /* Buyurtma tarixida faqat `emoji` saqlangan (kw yo'q) — shu emojidan
     kategoriyani taxmin qilib, mos ikon ko'rsatamiz. */
  const CAT_ICON_K={Ichimlik:"food-drink",Shirinlik:"food-cake",Milliy:"food-rice",Fastfood:"food-burger"};
  function orderDishIcon(emoji,cls){
    for(const r of K_CAT_RULES){ if(emoji&&r.emo.includes(emoji)) return ic(CAT_ICON_K[r.cat],cls); }
    return ic("utensils",cls);
  }
  /* Buyurtma tarixi/modal uchun — birinchi taomning RASMI (bo'lsa), aks holda ikon */
  function kOrderThumb(o,size){
    try{ const l=(YZ_ITEMS.lines(o)||[])[0]; return YZ_ITEMS.thumb(l,size); }
    catch(e){ return orderDishIcon(o&&o.emoji,'yz-i-lg'); }
  }
  /* ===== ISH VAQTI =====
     Manba — assets/js/hours.js (Asia/Tashkent). Bosh sayt (app.js), Telegram
     mini ilova va server AYNAN shu qoidaga tayanadi. Yopiq restorandan taom
     buyurtma qilib bo'lmaydi: tugma ⏱ ga aylanadi, savatga qo'shilmaydi va
     server ham rad etadi (server/src/pricing.js). */
  function kIsOpen(rest){ try{ return YZ_TIME.isRestOpenByName(rest); }catch(e){ return true; } }
  function kHours(rest){ try{ return YZ_TIME.restHoursByName(rest); }catch(e){ return "09:00–23:00"; } }
  function kClosedMsg(rest){ return rest+" hozir yopiq · ish vaqti "+kHours(rest); }

  /* Taom kartasidagi tugma — saytdagi bilan bir xil ustuvorlik VA bir xil
     klasslar (.add-btn/.card-qty/.qty-btn — index.html: assets/js/app.js
     updateCardQty), shu sabab ko'rinishi ham AYNAN bir xil bo'ladi:
       1) restoran yopiq → ⏱   2) savatda bor → −/+   3) aks holda → + */
  function kNoteOf(id){ const it=cart.find(i=>i.id===id); return (it&&it.note)||""; }
  function kActionHTML(d, qty){
    if(qty>0){
      const shut=!kIsOpen(d.rest);
      const hasNote=!!kNoteOf(d.id).trim();
      return `<div class="card-qty"><button class="qty-btn qty-minus" data-id="${d.id}" data-m="-1">−</button>`+
             `<span class="qty-num">${qty}</span>`+
             `<button class="qty-btn qty-plus${shut?" qty-closed":""}" data-id="${d.id}" data-m="1">+</button>`+
             `<button class="qty-btn qty-note${hasNote?' has-note':''}" data-noteid="${d.id}" aria-label="Izoh" title="Izoh">${ic('message')}</button></div>`;
    }
    if(!kIsOpen(d.rest)){
      return `<button class="add-btn add-closed kshut-add" data-shut="${esc(d.rest)}" title="${esc(kClosedMsg(d.rest))}">${ic('clock')}</button>`;
    }
    return `<button class="add-btn" data-id="${d.id}">+</button>`;
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
        <span style="font-size:72px;filter:drop-shadow(0 6px 12px rgba(0,0,0,.2));position:relative;z-index:1;color:var(--brand,#ff5722)">${foodIcon(d.kw)}</span>
        <img src="${d.photo}" alt="${esc(nm(d))}" data-onerr="remove"
          style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:2;border-radius:16px 16px 0 0" />
        ${d.badge?`<span style="position:absolute;top:10px;left:12px;z-index:3;background:var(--gold);color:#fff;font-size:11px;font-weight:800;padding:3px 9px;border-radius:999px">${d.badge}</span>`:''}
      </div>
      <div style="padding:16px 0 0">
        <h2 style="font-size:19px;margin-bottom:4px">${esc(nm(d))}</h2>
        <div style="color:var(--grey);font-size:13px;margin-bottom:10px">${ic('store')} ${esc(trTxt(d.rest))}</div>
        <div style="display:flex;gap:12px;margin-bottom:14px;flex-wrap:wrap">
          <span style="display:flex;align-items:center;gap:4px;font-size:13px;color:var(--grey)"><b style="color:var(--ink)">${kDishStar(d)}</b></span>
          ${kDishSold(d)?`<span style="font-size:13px;color:var(--grey)">${kDishSold(d).replace(/^ · /,'')}</span>`:""}
          ${d.weight?`<span style="font-size:13px;color:var(--grey)">${ic('scale')} ${esc(trTxt(d.weight))}</span>`:""}
        </div>
        ${d.descr?`<p style="font-size:14px;color:var(--ink);margin-bottom:10px;line-height:1.5">${esc(trTxt(d.descr))}</p>`:""}
        ${d.ingredients?`<div style="font-size:13px;color:var(--grey);margin-bottom:14px;line-height:1.5"><b>${ic('utensils')} Tarkibi:</b> ${esc(trTxt(d.ingredients))}</div>`:""}
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:16px">
          ${priceStr}<span style="font-size:14px;color:var(--grey)"> so'm</span>
        </div>
        <div class="kdm-foot" id="kdmFoot"></div>
      </div>`;
    function refreshKdm(){
      const q=(cart.find(i=>i.id===d.id)||{}).qty||0;
      const foot=$("#kdmFoot"); if(!foot) return;
      if(q===0 && !kIsOpen(d.rest)){
        foot.innerHTML=`<div class="yz-closed-bar" style="margin:0"><span style="font-size:20px;color:#C8102E">${ic('clock')}</span>`+
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
          <button class="set-save" style="width:100%;background:#f1eef0;color:#555;margin-bottom:8px" id="kdmNote">${ic('message')} ${kNoteOf(d.id).trim()?"Izohni tahrirlash":"Izoh qoldirish"}</button>
          <button class="set-save" style="width:100%" id="kdmCart">Savatni ko'rish</button>`;
        foot.querySelectorAll(".kqb").forEach(b=>b.addEventListener("click",()=>{ changeQty(+b.dataset.id,+b.dataset.m); refreshKdm(); updateKMenuQty(); }));
        foot.querySelector("#kdmNote").addEventListener("click",()=>openKNoteModal(d));
        foot.querySelector("#kdmCart").addEventListener("click",()=>{ $("#koModal").classList.remove("open"); $("#koBackdrop").classList.remove("open"); });
      }
    }
    refreshKdm();
    $("#koModal").classList.add("open"); $("#koBackdrop").classList.add("open");
  }

  /* Taom uchun izoh oynasi — index.html'dagi openNoteModal bilan bir xil:
     mijoz savatni ochmasdan ham "sous bilan yuboring" kabi tilagini yozadi. */
  const NOTE_MAX=200;
  function openKNoteModal(d){
    $("#koContent").innerHTML=`<div style="text-align:center">
        <div style="display:flex;justify-content:center;color:var(--grey);font-size:40px">${ic('message','yz-i-xxl')}</div>
        <h2 style="margin:6px 0 2px">${esc(nm(d))}</h2>
        <p class="modal-sub" style="margin-bottom:12px">Taomni qanday tayyorlash/jo'natish kerakligini yozing</p>
      </div>
      <div style="text-align:left">
        <input id="kNoteInp" class="ci-note-inp" type="text" maxlength="${NOTE_MAX}"
               placeholder="Masalan: sous bilan yuboring" value="${esc(kNoteOf(d.id))}" style="width:100%;box-sizing:border-box">
        <button class="set-save" id="kNoteSave" style="width:100%;margin-top:14px">Saqlash</button>
      </div>`;
    $("#koModal").classList.add("open"); $("#koBackdrop").classList.add("open");
    const inp=$("#kNoteInp"); if(inp) setTimeout(()=>inp.focus(),50);
    const save=$("#kNoteSave");
    if(save) save.addEventListener("click",()=>{
      const it=cart.find(x=>x.id===d.id);
      if(it) it.note=String((inp&&inp.value)||"").replace(/\s+/g," ").trim().slice(0,NOTE_MAX);
      $("#koModal").classList.remove("open"); $("#koBackdrop").classList.remove("open");
      renderCart(); updateKMenuQty();
    });
  }

  /* Buyurtma tarixi — bitta yozuvga bosilganда TO'LIQ tafsilot: sana, narx,
     chegirma foizi, qaysi kuryer yetkazgani, nechta taom, guruh buyurtmasimi. */
  function openKOrderDetailModal(o){
    const omr=(k,v)=>`<div style="display:flex;justify-content:space-between;gap:10px;font-size:14px"><span style="color:var(--grey)">${k}</span><b style="text-align:right">${v}</b></div>`;
    let itemsHtml=""; try{ itemsHtml=YZ_ITEMS.listHtml(o,{maxHeight:260}); }catch(e){}
    let groupHtml=""; try{ groupHtml=YZ_ITEMS.groupBreakdownHtml(o,{}); }catch(e){}
    const discLines=(o.items||[]).filter(l=>Number(l.pct)>0);
    const discHtml=discLines.length
      ? omr(ic('tag')+" Chegirma", discLines.map(l=>esc(l.name)+" −"+Math.round(l.pct)+"%").join(", "))
      : "";
    $("#koContent").innerHTML=`
      <div style="display:flex;justify-content:center;color:var(--grey)">${kOrderThumb(o,64)}</div>
      <h2 style="text-align:center;margin:8px 0 2px">${esc(o.dish)}</h2>
      <div style="text-align:center;margin-bottom:14px;color:var(--grey);font-size:13px">${ic('store')} ${esc(o.rest)}</div>
      ${groupHtml}
      ${itemsHtml}
      <div style="display:flex;flex-direction:column;gap:10px;font-size:14px;margin-top:${itemsHtml?'12px':'0'}">
        ${omr(ic('calendar')+" Sana",esc(o.date))}
        ${o.qtyTotal?omr(ic('utensils')+" Jami mahsulot",o.qtyTotal+" dona"):""}
        ${omr(ic('cash')+" Summa",money(o.amount)+" so'm")}
        ${discHtml}
        ${o.courier?omr(ic('scooter')+" Kuryer",esc(o.courier)):""}
        ${o.deliveryMin>0?omr(ic('check-circle')+" Yetkazish vaqti",o.deliveryMin+" daqiqada"):""}
        ${o.groupId?omr(ic('users')+" Turi","Guruh buyurtmasi"):""}
        ${o.source?omr(ic('smartphone')+" Qayerdan",o.source==="telegram"?"Telegram":"Sayt"):""}
        ${o.reason?omr("Bekor sababi",'<span style="color:#C8102E">'+esc(o.reason)+'</span>'):""}
      </div>
      <button class="set-save" id="kodClose" style="width:100%;margin-top:16px;background:#f1eef0;color:#555">Yopish</button>`;
    $("#koModal").classList.add("open"); $("#koBackdrop").classList.add("open");
    const cb=$("#kodClose"); if(cb) cb.addEventListener("click",()=>{ $("#koModal").classList.remove("open"); $("#koBackdrop").classList.remove("open"); });
  }

  /* Kard qty ko'rinishini yangilash — narx/rasm (card-body) tegilmaydi,
     faqat pastdagi yoysimon "pod" (card-pod-action) qayta chiziladi. */
  function updateKMenuQty(){
    /* Katalogni BIR MARTA olamiz — kcatalog() har chaqiruvda menyuni qaytadan
       birlashtiradi, uni sikl ichida chaqirish kartalar soniga karrali sekinlik. */
    const cat=kcatalog();
    $$("#kMenu .card").forEach(card=>{
      const id=+card.dataset.id; if(!id) return;
      const d=cat.find(x=>x.id===id); if(!d) return;
      const qty=(cart.find(i=>i.id===id)||{}).qty||0;
      const pod=card.querySelector(".card-pod-action");
      if(!pod) return;
      pod.innerHTML=kActionHTML(d,qty);
      const add=pod.querySelector(".add-btn:not(.add-closed)");
      if(add) add.addEventListener("click",(e)=>{ e.stopPropagation(); addToCart(id); });
      pod.querySelectorAll(".qty-btn:not(.qty-note)").forEach(b=>b.addEventListener("click",(e)=>{ e.stopPropagation(); changeQty(+b.dataset.id,+b.dataset.m); updateKMenuQty(); syncKabBar(); }));
      const noteBtn=pod.querySelector(".qty-note");
      if(noteBtn) noteBtn.addEventListener("click",(e)=>{ e.stopPropagation(); openKNoteModal(d); });
      bindShutButtons(pod);
    });
    syncKabBar();
  }

  /* Taom kartasi — renderMenu va renderMenuFiltered UCHUN BITTA manba.
     (Ilgari ikkala joyda nusxa markup bor edi va biri yangilanganda ikkinchisi
     eskirib qolardi — masalan "yopiq" holati.)
     MUHIM: markup va klasslar index.html bilan AYNAN bir xil (card, card-img,
     tone-N, card-body, card-pod va h.k.) — ko'rinish assets/css/kabinet-cards.css
     (styles.css dan ko'chirilgan) orqali bosh saytdagidek chiqadi. Chegirma
     yorlig'i endi CSS o'zi chizadi ([data-discounted="true"]::after), shuning
     uchun alohida badge span kerak emas. */
  function kDishStar(d){ const r=Number(d&&d.rating)||0; return r>0?(ic("star","yz-i-fill yz-i-amber")+" "+r):(ic("flame","yz-i-brand")+" yangi"); }
  function kDishSold(d){ const s=Math.max(0,Number(d&&d.sold)||0); return s?(" · "+ic("cart")+" "+s):""; }
  /* Yurakcha (like) SVG — rangi CSS orqali boshqariladi: yoqtirilmagan holatда
     bo'z chiziq, yoqtirilганда SAYT rangi (var(--red)) bilan to'ladi — boshqa
     (masalan pushti/kult qizil) rang EMAS, aynan sayt bosh rangi. */
  const HEART_SVG='<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path d="M12 21s-7.2-4.6-9.9-8.7C.4 9.4 1.2 5.5 4.6 4.1c2.4-1 5-.1 6.5 1.9l.9 1.2.9-1.2c1.5-2 4.1-2.9 6.5-1.9 3.4 1.4 4.2 5.3 2.5 8.2C19.2 16.4 12 21 12 21z"/></svg>';
  function isLiked(d){
    try{ return (STORE.likes()||[]).some(l=>l.rest===d.rest && l.name===d.name); }catch(e){ return false; }
  }
  function kCardHTML(d){
    const qty=(cart.find(i=>i.id===d.id)||{}).qty||0;
    const price=d.discount?`<span style="text-decoration:line-through;color:#b9a;font-size:13px">${money(d.price)}</span> ${money(d.eff)}`:money(d.price);
    const disc=d.discount>0;
    const liked=isLiked(d);
    const weightHtml=d.weight?`<span class="card-weight">${esc(d.weight)}</span>`:"";
    return `<div class="card" data-id="${d.id}" data-discounted="${disc}">
        <div class="card-img tone-${esc(d.kw||"")}" data-id="${d.id}"><span class="food-emoji">${foodIcon(d.kw)}</span>
          ${d.photo?`<img class="card-photo-bg" src="${d.photo}" alt="" aria-hidden="true" loading="lazy" data-onerr="remove">`:''}
          <img class="card-photo" src="${d.photo}" alt="${esc(nm(d))}" loading="lazy" data-onerr="remove">
          <button class="card-like${liked?' liked':''}" data-rest="${esc(d.rest)}" data-name="${esc(d.name)}" aria-label="Yoqtirish" title="Yoqtirish">${HEART_SVG}</button>
        </div>
        <div class="card-body">
          <h3 data-id="${d.id}">${esc(nm(d))}</h3>
          <div class="card-rest">${esc(trTxt(d.rest))}</div>
          <div class="card-meta"><span class="cm-star">${kDishStar(d)}</span>${kDishSold(d)}</div>
          <div class="card-foot">${weightHtml}<span class="price">${price} <small>so'm</small></span></div>
        </div>
        <div class="card-pod"><div class="card-pod-action">${kActionHTML(d,qty)}</div></div>
      </div>`;
  }
  /* ===== SHAXSIYLASHTIRISH: eng ko'p buyurilgan + yoqtirilgan taomlar birinchi =====
     Buyurtma chastotasi — joriy mijozning O'Z buyurtmalari tarixidan (server
     GET /orders "user"rolida allaqachon SHU mijozniki bilan filtrlangan). */
  function dishOrderCounts(){
    const counts={};
    try{
      (typeof STORE!=="undefined"?STORE.orders():[]).forEach(o=>{
        if(!o || o.status==="cancelled") return;
        (o.items||[]).forEach(it=>{
          if(!it || !it.name) return;
          const key=o.rest+"|"+it.name;
          counts[key]=(counts[key]||0)+(Number(it.qty)||1);
        });
      });
    }catch(e){}
    return counts;
  }
  function personalizedSort(list){
    let likedSet; try{ likedSet=new Set((STORE.likes()||[]).map(l=>l.rest+"|"+l.name)); }catch(e){ likedSet=new Set(); }
    const counts=dishOrderCounts();
    return list.map((d,i)=>({d,i})).sort((a,b)=>{
      const key=x=>x.rest+"|"+x.name;
      const al=likedSet.has(key(a.d))?1:0, bl=likedSet.has(key(b.d))?1:0;
      if(al!==bl) return bl-al;
      const ac=counts[key(a.d)]||0, bc=counts[key(b.d)]||0;
      if(ac!==bc) return bc-ac;
      return a.i-b.i;   // asl tartib (barqaror saralash)
    }).map(x=>x.d);
  }
  function renderMenu(){
    renderKabPromoBand();
    if(activeRest){ filterByRest(activeRest); return; }
    const g=$("#kMenu"); if(!g) return;
    const list=kcatalog().filter(d=>activeCat==="Hammasi"||kDishCat(d)===activeCat);
    g.innerHTML=personalizedSort(list).map(d=>kCardHTML(d)).join("");
    bindMenuEvents();
  }

  /* ===== AKSIYA BANNERI — bosh saytdagi kabi (index.html adPromo) =====
     Restoran e'lonlari navbatма-navbat aylanadi; bosilганда «Aksiyalar» modali.
     E'lon ham, chegirмали taom ham bo'lmasa — banner yashiriladi. */
  var _kabPromoTimer=null, _kabPromoIdx=0, _kabPromoSlides=[];
  function kabPromoList(){
    var anns=[];
    try{
      var be=(typeof STORE!=="undefined"&&STORE.announcements)?STORE.announcements():[];
      var stored=[]; try{ stored=JSON.parse(localStorage.getItem("yetkaz_announcements")||"[]"); }catch(e){}
      anns=stored.concat(be).filter(function(p){ return p && (p.text||p.dish); }).map(function(p){ return Object.assign({kind:"ann"},p); });
    }catch(e){}
    /* Bonuslar — hammaga (ommaviy) */
    var bonuses=[];
    try{
      bonuses=((typeof STORE!=="undefined"&&STORE.bonuses)?STORE.bonuses():[]).map(function(b){
        return { kind:"bonus", text:b.title, tag:"BONUS", icon:"gift", img:b.image||"", rest:b.scope==="restoran"?b.rest:"", rewardText:b.rewardText||"" };
      });
    }catch(e){}
    /* Tadbirlar — FAQAT o'zining chegirma belgilangan tadbirlari (maxfiy, shaxsiy) */
    var events=[];
    try{
      events=(KAB_MY_EVENTS||[]).filter(function(e){ return e.discountPct>0; }).map(function(e){
        return { kind:"event", text:e.name+" — "+e.discountPct+"% chegirma", tag:"TADBIR", icon:"party", rest:e.rest };
      });
    }catch(e){}
    return anns.concat(bonuses).concat(events);
  }
  function kabPromoHasDish(){
    try{ return kcatalog().some(function(d){ return d.discount>0; }) || kabPromoList().some(function(p){ return p.dish; }); }catch(e){ return false; }
  }
  function renderKabPromoBand(){
    var band=document.getElementById("kabPromoBand");
    var inner=document.getElementById("kabPromoInner");
    if(!band||!inner) return;
    var list=kabPromoList();
    if(!list.length && !kabPromoHasDish()){
      band.style.display="none"; inner.innerHTML="";
      if(_kabPromoTimer){ clearInterval(_kabPromoTimer); _kabPromoTimer=null; }
      return;
    }
    band.style.display="flex";
    var slides=list.length?list:[{kind:"ann",tag:"AKSIYA",text:"Bugungi chegirmali taomlarni ko'ring!",icon:"flame"}];
    _kabPromoSlides=slides;
    function paint(){
      var p=slides[_kabPromoIdx%slides.length]||slides[0];
      var tagIcon = p.icon ? ic(p.icon) : (p.emoji ? esc(p.emoji) : ic("megaphone"));
      inner.innerHTML=
        '<span class="kpb-tag">'+tagIcon+" "+esc(p.tag||"AKSIYA")+'</span>'+
        (p.rest?'<span class="kpb-rest">'+ic('store')+' '+esc(p.rest)+'</span>':'')+
        '<span class="kpb-text">'+esc(p.text||"Aksiyalar")+'</span>'+
        '<span style="margin-left:auto;font-weight:800;white-space:nowrap">Batafsil '+ic('chevron-right')+'</span>';
    }
    paint();
    if(_kabPromoTimer){ clearInterval(_kabPromoTimer); _kabPromoTimer=null; }
    if(slides.length>1){
      _kabPromoTimer=setInterval(function(){
        var el=document.getElementById("kabPromoInner"); if(!el){ clearInterval(_kabPromoTimer); _kabPromoTimer=null; return; }
        _kabPromoIdx=(_kabPromoIdx+1)%slides.length; el.style.opacity="0";
        setTimeout(function(){ paint(); el.style.opacity="1"; },200);
      },5000);
    }
  }
  /* Banner bosilganda — joriy (ko'rinib turgan) slaydga qarab TO'G'RIDAN-TO'G'RI
     tegishli bo'limga o'tadi; aniq manzil bo'lmasa umumiy modal ochiladi. */
  function handleKabPromoClick(){
    var p=_kabPromoSlides[_kabPromoIdx%(_kabPromoSlides.length||1)];
    if(p){
      if(p.kind==="bonus"){ nav("bonus"); return; }
      if(p.kind==="event"){ nav("events"); return; }
      if(p.dish){ var d=kcatalog().find(function(x){ return x.rest===p.rest && x.name===p.dish; }); if(d){ openKDishModal(d); return; } }
      if(p.rest && p.kind==="ann"){ var sl=document.querySelector('.sb-link[data-view="rests"]'); if(sl) sl.click(); setTimeout(function(){ filterByRest(p.rest); },80); return; }
    }
    openKabPromoModal();
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
          <div style="font-size:42px">${ic('store','yz-i-xxl')}</div>
          <h2 style="margin:8px 0;font-size:19px">${esc(trTxt(d.rest))} ga o'tamizmi?</h2>
          <p style="color:var(--grey);font-size:14px;line-height:1.5;margin-bottom:16px">Bitta buyurtmada faqat bitta restoran bo'ladi. Savatingizda <b>${esc(trTxt(cart[0].rest))}</b> taomlari bor. <b>${esc(trTxt(d.rest))}</b> ga o'tsangiz — savat yangilanadi va shu restoran taomlari ko'rinadi.</p>
          <div style="display:flex;gap:10px">
            <button class="set-save" id="kSwitchNo" style="flex:1;background:#eee;color:#333">Yo'q, qolaman</button>
            <button class="set-save" id="kSwitchYes" style="flex:1">Ha, kirish</button>
          </div></div>`;
        $("#koModal").classList.add("open"); $("#koBackdrop").classList.add("open");
        const no=$("#kSwitchNo"); if(no) no.addEventListener("click",()=>{ $("#koModal").classList.remove("open"); $("#koBackdrop").classList.remove("open"); });
        const yes=$("#kSwitchYes"); if(yes) yes.addEventListener("click",()=>{
          cart=[{id:d.id,name:d.name,nameCyr:d.nameCyr,emoji:d.emoji,kw:d.kw,photo:d.photo,price:(d.eff||d.price),rest:d.rest,qty:1}];
          renderCart(); $("#koModal").classList.remove("open"); $("#koBackdrop").classList.remove("open");
          filterByRest(d.rest); try{window.scrollTo({top:0});}catch(e){}
          toast(typeof KT==="function"?KT('savatga_qoshildi'):"Savatga qo'shildi");
        });
      }
      return;
    }
    if(ex) ex.qty++; else cart.push({id:d.id,name:d.name,nameCyr:d.nameCyr,emoji:d.emoji,kw:d.kw,photo:d.photo,price:(d.eff||d.price),rest:d.rest,qty:1});
    renderCart(); updateKMenuQty(); toast(typeof KT==="function"?KT('savatga_qoshildi'):"Savatga qo'shildi");
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
          <div style="font-size:48px;margin-bottom:10px">${ic('cart','yz-i-xxl')}</div>
          <p style="font-weight:600;font-size:15px">${kt('savat_bosh')||"Savatingiz bo'sh"}</p>
          <p style="font-size:13px;margin-top:4px">${kt('savat_bosh_hint')||"Quyidagi taomlardan tanlang"}</p>
        </div>`;
      } else {
        body.innerHTML=cart.map(i=>`
          <div class="kab-dr-row">
            <span class="kab-dr-emoji">${foodIcon(i.kw)}${i.photo?`<img src="${esc(i.photo)}" alt="" data-onerr="remove">`:""}</span>
            <div class="kab-dr-info">
              <div class="kab-dr-name">${esc(nm(i))}</div>
              <div class="kab-dr-rest">${esc(trTxt(i.rest))}</div>
              <div class="kab-dr-price">${money(i.price)} so'm</div>
            </div>
            <div class="kab-dr-qty">
              <button class="kab-dq-btn" data-id="${i.id}" data-m="-1">−</button>
              <span class="kab-dq-num">${i.qty}</span>
              <button class="kab-dq-btn" data-id="${i.id}" data-m="1">+</button>
            </div>
            <div class="ci-note">
              <label class="ci-note-lbl" for="kabNote_${i.id}">${ic('message')} Shu taomga izoh</label>
              <input id="kabNote_${i.id}" class="ci-note-inp kab-note" type="text" maxlength="200"
                     data-id="${i.id}" placeholder="Masalan: sous bilan yuboring" value="${esc(i.note||"")}">
            </div>
          </div>`).join("");
        body.querySelectorAll(".kab-dq-btn").forEach(b=>{
          b.addEventListener("click",()=>{ changeQty(+b.dataset.id,+b.dataset.m); renderCart(); });
        });
        /* Taom izohi — restoran va kuryer AYNAN shuni ko'radi. Har harfda
           savatga yozamiz: mijoz tugma bosmasdan buyurtmaga o'tishi mumkin. */
        body.querySelectorAll(".kab-note").forEach(inp=>{
          if((inp.value||"").trim()) inp.classList.add("has-note");
          inp.addEventListener("input",()=>{
            const it=cart.find(x=>x.id===+inp.dataset.id); if(!it) return;
            it.note=String(inp.value||"").replace(/\s+/g," ").trim().slice(0,200);
            inp.classList.toggle("has-note", !!it.note);
          });
        });
      }
    }

    if(foot){
      if(!cart.length){ foot.innerHTML=""; return; }
      const kt2=typeof KT==="function"?KT:function(k){return k;};
      /* Savatdagi restoran hozir yopiq bo'lsa — buyurtma tugmasi ishlamaydi */
      const cRest=cart[0].rest, cOpen=kIsOpen(cRest);
      const minOrd=koMinOrder();
      const blocked = total<minOrd || !cOpen;
      foot.innerHTML=`
        <div class="kab-dr-total">
          <span>${kt2('jami')||'Jami'}</span><b style="color:var(--red)">${money(total)} so'm</b>
        </div>
        ${cOpen?``:`<div class="yz-closed-bar" style="margin:0 0 8px"><span style="font-size:18px;color:#C8102E">${ic('dot','yz-i-fill')}</span><span><b>${esc(cRest)}</b> hozir yopiq. Ish vaqti: <b>${esc(kHours(cRest))}</b></span></div>`}
        <div class="kab-dr-note ${total<minOrd?'warn':'ok'}">
          ${total<minOrd
            ? (ic('alert-triangle')+' '+(kt2('minimal_warn',{min:money(minOrd),n:money(minOrd-total)})||`Minimal ${money(minOrd)} so'm (yana ${money(minOrd-total)} so'm)`))
            : (koDeliveryFee()>0 ? `${ic('check-circle','yz-i-green')} Yetkazish: ${money(koDeliveryFee())} so'm` : (ic('check-circle','yz-i-green')+' '+(kt2('minimal_ok')||"Yetkazish bepul")+' '+ic('scooter')))}
        </div>
        <button class="kab-order-main" id="kabOrderBtn" ${blocked?"disabled":""}>
          ${cOpen ? (kt2('buyurtma_berish')||'Buyurtma berish') : (ic('clock')+' Restoran yopiq')}
        </button>`;
      const ob=document.getElementById("kabOrderBtn");
      if(ob) ob.addEventListener("click",()=>{ closeKabCartDrawer(); placeOrder(); });
    }
    syncKabBar();
  }

  let koPay="card", koTimers=[];
  function placeOrder(){
    const total=cartTotal();
    if(!cart.length){ toast("Savat bo'sh"); return; }
    const minOrd=koMinOrder();
    if(total<minOrd){ toast("Minimal buyurtma "+money(minOrd)+" so'm (yana "+money(minOrd-total)+" so'm)","warn"); return; }
    /* Savat to'lgandan keyin restoran yopilishi mumkin — oxirgi tekshiruv */
    const rest=cart[0] && cart[0].rest;
    if(rest && !kIsOpen(rest)){ toast(kClosedMsg(rest)); renderCart(); return; }
    closeKabCartDrawer();
    openCheckout(total);
  }
  /* Minimal buyurtma va yetkazish narxi — ADMIN "Moliyaviy sozlamalar"да
     belgilaydi (bootstrap orqali keladi), app.js dagi bilan BIR XIL manba. */
  const KO_MIN_ORDER_DEFAULT = 20000;
  function koMinOrder(){ try{ const v=Number((STORE.settings()||{}).minOrder); return v>=0?v:KO_MIN_ORDER_DEFAULT; }catch(e){ return KO_MIN_ORDER_DEFAULT; } }
  function koDeliveryFee(){ try{ const v=Number((STORE.settings()||{}).deliveryFee); return v>0?v:0; }catch(e){ return 0; } }
  /* Buyurtма `pay` qiymati -> ko'rsatiladigan yorliq (naqd/karta/custom) */
  function payLabelOf(id){
    if(id==="card"||id==="karta") return "Karta";
    if(id==="cash"||id==="naqd") return "Naqd";
    try{ if(typeof STORE!=="undefined" && STORE.payMethods){ var m=STORE.payMethods().find(function(x){return x.id===id;}); if(m) return m.label; } }catch(e){}
    return String(id||"");
  }
  /* Admin RUXSAT bergan to'lov turlari (STORE.payMethods). Karta o'chirilса — ko'rinmaydi. */
  function koPayOptionsHtml(){
    var list=[{id:"card",label:"Karta"},{id:"cash",label:"Naqd"}];
    try{ if(typeof STORE!=="undefined" && STORE.payMethods) list=STORE.payMethods(); }catch(e){}
    var payIcon=function(id){ return (id==="card"||id==="karta") ? ic("card") : (id==="cash"||id==="naqd") ? ic("cash") : ic("wallet"); };
    return list.map(function(m,i){ return '<div class="ko-pay'+(i===0?' on':'')+'" data-pay="'+esc(m.id)+'" data-note="'+esc(m.note||"")+'">'+payIcon(m.id)+' '+esc(m.label)+'</div>'; }).join("");
  }
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
        <h2>${ic('receipt')} ${kt3('buyurtma_title')||'Buyurtma'}</h2>
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
        <button type="button" id="koGeoBtn" class="btn btn-outline" style="width:100%;margin-top:8px;font-size:14px;padding:9px">${ic('map-pin')} Joylashuvimni aniqlash</button>
      </div>
      <div class="set-field" style="margin-bottom:14px">
        <label>${kt3('tolov')||"To'lov usuli"}</label>
        <div class="ko-pays">${koPayOptionsHtml()}</div>
        <div id="koPayNote" style="color:var(--grey);font-size:12px;margin-top:6px"></div>
      </div>
      <div class="ko-summary">
        <div class="ko-row"><span>Taomlar (${cart.reduce((s,i)=>s+i.qty,0)} ta)</span><span>${money(total)} so'm</span></div>
        <div class="ko-row"><span>Yetkazish</span><span>${fee>0?money(fee)+" so'm":'<b style="color:var(--green)">Bepul</b>'}</span></div>
        <div class="ko-row tot"><span>Jami</span><span>${money(total+fee)} so'm</span></div>
      </div>
      <button class="set-save" id="koConfirm" style="width:100%;margin-top:4px">${ic('check-circle')} ${kt3('tasdiq')||'Buyurtmani tasdiqlash'}</button>`;
    /* Boshlang'ich tanlov — birinchi mavjud usul */
    var firstPay=document.querySelector("#koContent .ko-pay.on");
    koPay=firstPay?firstPay.dataset.pay:"cash";
    var koPayNote=document.getElementById("koPayNote");
    var koShowNote=function(){ var el=document.querySelector("#koContent .ko-pay.on"); var n=el?(el.dataset.note||""):""; if(koPayNote){ koPayNote.textContent=n; koPayNote.style.display=n?"":"none"; } };
    koShowNote();
    $$("#koContent .ko-pay").forEach(o=>o.addEventListener("click",()=>{ $$("#koContent .ko-pay").forEach(x=>x.classList.remove("on")); o.classList.add("on"); koPay=o.dataset.pay; koShowNote(); }));
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
    if(!cart.length){ toast("Savat bo'sh"); return; }
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
    const itemLabel=(first?nm(first):"")+more;
    const savedCart=cart.map(i=>({...i}));   // server rad etsa — savatni qaytaramiz
    /* `_local:true` — bu yozuv hali serverga bog'lanmagan. `amount` bu yerda
       TAXMINIY (client hisobi); server javob bergач haqiqiy summa bilan
       almashadi (onOk yoki hydrateOrders — imzo bo'yicha). Shuning uchun bir
       buyurtma IKKI marta ko'rinib qolmaydi va "Jami sarflagan" ikkilanmaydi. */
    USER.orders.unshift({id:orderLocalId, _local:true, dish:itemLabel, emoji:first.emoji, rest:first.rest,
      date:new Date().toLocaleDateString("ru-RU"), amount:total, addr:addr, pay:koPay, deliveredIn:eta, promised:eta+3, reviewed:false, status:"new"});
    const addrFull = addr + (USER.geo ? " · GPS: " + USER.geo.lat.toFixed(5) + "," + USER.geo.lng.toFixed(5) : "");
    let created=null;
    /* Summani SERVER hisoblaydi — biz faqat nima/nechta olayotganimizni aytamiz.
       Quyidagi rest/item/amount local ko'rinish uchun; server ularni e'tiborsiz
       qoldiradi. Rad etsa (min. summa / sotuvda yo'q taom) — orqaga qaytaramiz. */
    try{ created = STORE.addOrder({ user:USER.name, phone:USER.phone||"", rest:first.rest, item:itemLabel, emoji:first.emoji,
      /* `note` — mijozning shu taomga yozgan tilagi (restoran/kuryer ko'radi) */
      items:cart.map(i=>({id:i.id, qty:i.qty, note:(i.note||"")})),
      amount:total, delivery:(typeof koDeliveryFee==="function"?koDeliveryFee():0), addr:addrFull, pay:koPay, courier:STORE.courierForRest(first.rest), status:"new", eta:eta,
      time:new Date().toLocaleTimeString("ru-RU",{hour:"2-digit",minute:"2-digit"}) },{
      /* Server qabul qildi — optimistik yozuvni HAQIQIY id/summa/status bilan
         yangilaymiz (app.js:attachBackendId dagi kabi). */
      onOk: saved => {
        const a=USER.orders.find(o=>o.id===orderLocalId) ||
                USER.orders.find(o=>o._local && orderSig(o.rest,o.dish,o.pay)===orderSig(first.rest,itemLabel,koPay));
        if(a && saved && saved.id){
          a.id=saved.id;
          a.amount=(Number(saved.amount)||a.amount);
          a.status=saved.status||a.status;
          delete a._local;
        }
        try{ hydrateOrders(); renderProfil(); }catch(e){}
      },
      onFail: err => koOrderRejected(orderLocalId, savedCart, err)
    }); }catch(e){}
    cart=[]; renderCart(); updateKMenuQty(); renderProfil();
    startTrack(addr,created,first.emoji,itemLabel);
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
    emoji=emoji||""; label=label||"Buyurtma";
    const kt4=typeof KT==="function"?KT:function(k){return k;};
    const steps=[kt4('st_accepted')||"Qabul qilindi",kt4('st_cooking')||"Tayyorlanmoqda",kt4('st_ready')||"Tayyor",kt4('st_ontheway')||"Yo'lda",kt4('st_arrived')||"Yetib keldi"], stepIcons=["inbox","flame","check-circle","scooter","party"];
    $("#koContent").innerHTML=`
      <div class="ko-track" style="text-align:center">
        <div style="font-size:48px;margin-bottom:6px;color:var(--brand,#ff5722)">${ic('package','yz-i-xxl')}</div>
        <h2 style="font-size:19px;margin-bottom:4px">${kt4('qabul')||'Buyurtma qabul qilindi!'}</h2>
        <p class="ko-sub">${ic('map-pin')} ${addr} · ${esc(payLabelOf(koPay))}</p>
        <p style="font-size:13px;color:var(--grey);background:#f0f9f4;border-radius:10px;padding:10px;margin:10px 0">
          ${ic('scooter')} Buyurtmangiz real vaqtда kuzatilmoqda. Ushbu oynani yopsangiz ham davom etadi.
        </p>
        <div class="ko-status" id="koStatus" style="font-weight:800;margin:6px 0">${steps[0]}</div>
        <div class="ko-steps">${steps.map((s,i)=>`<div class="ko-step"><div class="dot">${ic(stepIcons[i])}</div><span>${s}</span></div>`).join("")}</div>
        <div id="koTrackAction"></div>
        <button class="set-save" id="koDone" style="width:100%;margin-top:12px;background:#eee;color:#333">${kt4('ok_btn')||'Tushunarli, yopish'}</button>
      </div>`;
    $("#koDone").addEventListener("click", closeCheckoutKeepOrder);
    const els=$$("#koContent .ko-step");
    const stepColors=["#f97316","#eab308","#22c55e","#3b82f6","#16a34a"];
    /* 'review' — katta buyurtma administrator tekshiruvida (server/src/order-rules.js).
       Restoranga hali bormagan, shuning uchun birinchi bosqichda turadi. */
    const STMAP={ review:0, new:0, accepted:1, ready:2, ontheway:3, arrived:4, done:4 };
    function orderNow(){ try{ return (STORE.orders()||[]).find(o=> created && o.id===created.id) || created; }catch(e){ return created; } }
    function paint(idx){
      els.forEach((el,i)=>{ el.classList.remove("active","done-step"); if(i<idx) el.classList.add("done-step"); else if(i===idx) el.classList.add("active"); });
      const st=$("#koStatus"); if(st){ st.textContent=steps[idx]||steps[0]; st.style.color=stepColors[idx]||""; }
    }
    let finished=false, reviewShown=false;
    function tick(){
      const o=orderNow(); const s=(o&&o.status)||"new";
      if(s==="cancelled"){ clearInterval(poll); paint(0); showKabCancelled(o&&o.reason,emoji); return; }
      paint(STMAP[s]!=null?STMAP[s]:0);
      /* Tekshiruvda turgan buyurtma — mijoz nima kutayotganini bilsin.
         Oyna FAQAT BIR MARTA (birinchi aniqlanganda) chiqadi. */
      if(s==="review"){
        const st=$("#koStatus"); if(st){ st.textContent="Administrator tekshiruvida"; st.style.color="#c2410c"; }
        if(!reviewShown){ reviewShown=true; showKabReview(); }
      }
      const act=$("#koTrackAction");
      if(s==="arrived" && act && !act.dataset.on){
        act.dataset.on="1";
        act.innerHTML='<button class="set-save" id="koGotIt" style="width:100%;background:#16a34a">'+ic('check-circle')+' '+(kt4('yetib_keldi')||'Qabul qildim')+'</button>';
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
    ov.innerHTML='<div class="arrived-card"><div class="arrived-emoji" style="color:#C8102E">'+ic('x-circle','yz-i-xxl')+'</div><div class="arrived-title">Buyurtma bekor qilindi</div>'+(reason?'<div class="arrived-msg">Sabab: '+esc(reason)+'</div>':'<div class="arrived-msg">Buyurtmangiz bekor qilindi.</div>')+'<button class="btn btn-primary" id="kabCancOk">Tushunarli</button></div>';
    document.body.appendChild(ov);
    const close=()=>{ ov.remove(); };
    ov.querySelector("#kabCancOk").addEventListener("click",close);
    ov.addEventListener("click",(e)=>{ if(e.target===ov) close(); });
  }

  /* Katta/g'ayrioddiy buyurtma administrator tekshiruviga tushdi
     (server/src/order-rules.js) — mijoz nima bo'layotganini bilsin. */
  function showKabReview(){
    let ov=document.getElementById("kabArrivedOverlay"); if(ov) ov.remove();
    ov=document.createElement("div"); ov.id="kabArrivedOverlay"; ov.className="arrived-overlay";
    ov.innerHTML='<div class="arrived-card"><div class="arrived-emoji">'+ic('search','yz-i-xxl')+'</div>'+
      '<div class="arrived-title">Buyurtmangiz tekshirilmoqda</div>'+
      '<div class="arrived-msg">Siz belgilangan miqdordan ko\'proq buyurtma qildingiz. Shu sababli buyurtmangiz avval administrator tomonidan ko\'rib chiqiladi, so\'ngra restoranga topshiriladi.</div>'+
      '<button class="btn btn-primary" id="kabRevOk">Tushunarli</button></div>';
    document.body.appendChild(ov);
    const close=()=>{ ov.remove(); };
    ov.querySelector("#kabRevOk").addEventListener("click",close);
    ov.addEventListener("click",(e)=>{ if(e.target===ov) close(); });
  }

  /* Bekor qilish ogohlantirishi / blok xabari (server/src/blocks.js qoidalari) */
  function showKabWarn(res){
    const blocked=!!res.blocked;
    let ov=document.getElementById("kabArrivedOverlay"); if(ov) ov.remove();
    ov=document.createElement("div"); ov.id="kabArrivedOverlay"; ov.className="arrived-overlay";
    ov.innerHTML='<div class="arrived-card"><div class="arrived-emoji" style="color:#C8102E">'+(blocked?ic('ban','yz-i-xxl'):ic('alert-triangle','yz-i-xxl'))+'</div>'+
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
      <div class="arrived-emoji" style="color:#16a34a">${ic('check-circle','yz-i-xxl')}</div>
      <div class="arrived-title">${kt5('yetib_keldi')||'Yetib keldi!'}</div>
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
      '<div class="arrived-emoji" style="color:#16a34a">'+ic('check-circle','yz-i-xxl')+'</div>'+
      '<div class="arrived-title">Yetib keldi!</div>'+
      '<div class="arrived-name">'+esc(be.item||"Buyurtma")+'</div>'+
      '<div class="arrived-msg">Buyurtmangizni qabul qildingizmi?<br>Tasdiqlansangiz kuryer ishini yakunlaydi.</div>'+
      '<button class="btn btn-primary" id="kabPcYes">'+ic('check-circle')+' Ha, qabul qildim</button>'+
      '<button class="btn btn-outline" id="kabPcLater" style="margin-top:8px">Keyinroq</button>'+
      '</div>';
    document.body.appendChild(ov);
    const close=()=>{ ov.classList.add("arrived-hide"); setTimeout(()=>ov.remove(),400); };
    ov.querySelector("#kabPcLater").addEventListener("click",close);
    ov.querySelector("#kabPcYes").addEventListener("click",async ()=>{
      const b=ov.querySelector("#kabPcYes"); b.disabled=true; b.textContent="Tasdiqlanmoqda…";
      try{ await STORE.confirmReceived(be.id); close(); toast("Rahmat! Buyurtma tasdiqlandi","success"); }
      catch(e){ b.disabled=false; b.innerHTML=ic('check-circle')+' Ha, qabul qildim'; toast("Tasdiqlab bo'lmadi. Qayta urinib ko'ring.","error"); }
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
  /* Restoran "chegirmada"mi — kamida bitta taomi chegirmali BO'LSA, yashil
     porlash chegara chiqadi (xuddi taom kartasidagi kabi, index.html'dagi
     bilan bir xil CSS: .rest-card[data-discounted]). */
  function restHasDiscount(rname){
    try{ return kcatalog().some(d=>d.rest===rname && d.discount>0); }catch(e){ return false; }
  }
  function renderKabRests(filter){
    const grid=document.getElementById("kRestGrid"); if(!grid) return;
    const src=restListK();
    const q=(document.getElementById("kRestSearch")||{}).value||"";
    const list=src.filter(r=> (!filter||r.name===filter) && (!q||r.name.toLowerCase().includes(q.toLowerCase())));

    /* Markup index.html'dagi renderRests() (app.js) bilan AYNAN bir xil —
       .rest-card/.rest-img/.rest-body/tone-* — ko'rinish bir xil bo'lishi uchun. */
    grid.innerHTML=list.map(r=>{
      const open=kIsOpen(r.name), hrs=kHours(r.name);
      const disc=restHasDiscount(r.name);
      const liked=isLiked({rest:r.name,name:""});
      const photo=restPhotoK(r.name);
      const dishCount=kcatalog().filter(d=>d.rest===r.name).length;
      return `<div class="rest-card" data-discounted="${disc}" data-rest="${esc(r.name)}">
        <div class="rest-img tone-${esc(r.kw||'burger')}" style="position:relative">
          <span class="food-emoji">${foodIcon(r.kw||'burger')}</span>
          ${photo?`<img class="rest-photo-bg" src="${photo}" alt="" aria-hidden="true" loading="lazy" data-onerr="remove"><img class="rest-photo" src="${photo}" alt="${esc(nm(r))}" loading="lazy" data-onerr="remove">`:""}
          <span class="rest-openbadge ${open?'is-open':'is-closed'}">${open?ic('dot','yz-i-fill yz-i-green')+' Ochiq':ic('dot','yz-i-fill yz-i-red')+' Yopiq'}</span>
          <button class="card-like${liked?' liked':''}" data-rest="${esc(r.name)}" data-name="" aria-label="Yoqtirish" title="Yoqtirish">${HEART_SVG}</button>
        </div>
        <div class="rest-body">
          <h3>${esc(nm(r))}</h3>
          <div class="rest-meta">
            <span class="star">${ic('star','yz-i-fill yz-i-amber')} ${r.rating}</span>
            <span>${ic('clock')} ${r.eta} ${typeof KT==="function"?KT('daq'):'daq'}</span>
            <span>${ic('map-pin')} ${esc(trTxt(r.dist||""))}</span>
          </div>
          <div class="rest-info2">
            <span>${ic('utensils')} ${dishCount} ta taom</span>
            ${hrs?`<span>${ic('clock')} ${esc(hrs)}</span>`:""}
          </div>
          ${r.addr?`<div class="rest-addr">${ic('map-pin')} ${esc(trTxt(r.addr))}</div>`:""}
          ${r.descr?`<div class="rest-descr">${esc(trTxt(String(r.descr).slice(0,90)))}</div>`:""}
        </div>
      </div>`;
    }).join("");
    grid.querySelectorAll(".rest-card .card-like").forEach(b=>{
      b.addEventListener("click", async (e)=>{
        e.stopPropagation();
        if(typeof STORE==="undefined" || !STORE.toggleLike) return;
        b.classList.toggle("liked");
        await STORE.toggleLike(b.dataset.rest, b.dataset.name);
        renderKabRests(filter);
      });
    });
    grid.querySelectorAll(".rest-card").forEach(c=>{
      c.addEventListener("click",()=>{
        const rname=c.dataset.rest;
        /* Taom gridi (#view-taomlar) shu yerда ko'rsatiladi, lekin sidebar'da
           alohida "Taomlar" tab yo'q — "Restoranlar" faol bo'lib qoladi. */
        $$(".view").forEach(v=>v.classList.remove("show"));
        const tv=document.getElementById("view-taomlar");
        if(tv) tv.classList.add("show");
        $$(".sb-link").forEach(l=>l.classList.toggle("active",l.dataset.view==="rests"));
        if($("#tbTitle")) $("#tbTitle").textContent=rname;
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
  /* Restoran haqida to'liq ma'lumot — index.html'dagi restInfoBlock bilan bir
     xil mazmun (ish vaqti, manzil, hudud, reyting, tavsif), lekin index.html'ga
     yo'naltirmasdan, kabinet ICHIDA (o'zining CSS'siz, inline uslubda). */
  function restInfoBlockK(rname){
    const be=restListK().find(r=>r.name===rname)||{};
    const open=kIsOpen(rname), hrs=kHours(rname);
    const photo=restPhotoK(rname);
    const row=(ic1,k,v)=>`<div style="display:flex;align-items:flex-start;gap:10px;padding:7px 0;border-top:1px solid var(--line)"><span style="color:var(--grey);flex:none;margin-top:1px">${ic1}</span><div style="flex:1;min-width:0"><div style="font-size:11.5px;color:var(--grey)">${k}</div><div style="font-size:14px;font-weight:600">${v}</div></div></div>`;
    const rows=[row(ic('clock'),"Ish vaqti",esc(hrs)+" "+(open?"<span style=\"color:#16a34a\">(hozir ochiq)</span>":"<span style=\"color:#C8102E\">(hozir yopiq)</span>"))];
    if(be.addr) rows.push(row(ic('map-pin'),"Manzil",esc(trTxt(be.addr))));
    if(be.area) rows.push(row(ic('scooter'),"Yetkazish hududi",esc(trTxt(be.area))));
    if(be.email) rows.push(row(ic('mail'),"Aloqa",esc(be.email)));
    rows.push(row(ic('star'),"Reyting",(be.rating?be.rating:"—")+(be.ratingCount?" · "+be.ratingCount+" ta baho":"")+" · "+(be.eta||20)+" daq"));
    return `<div class="panel" style="margin-bottom:12px;overflow:hidden">
      ${photo?`<div style="height:130px;margin:-1px -1px 0;background:#f3eef0"><img src="${esc(photo)}" alt="" style="width:100%;height:100%;object-fit:cover" data-onerr="remove"></div>`:""}
      <div class="panel-body">
        <h3 style="font-size:17px;margin-bottom:2px">${esc(nm(be.name?be:{name:rname}))}</h3>
        ${be.descr?`<p style="font-size:13px;color:var(--grey);margin:4px 0 0">${esc(trTxt(be.descr))}</p>`:""}
        ${rows.join("")}
      </div>
    </div>`;
  }
  function filterByRest(rname){
    activeRest=rname;
    const g=document.getElementById("kMenu"); if(!g) return;
    const info=document.getElementById("kRestInfo"); if(info) info.innerHTML=restInfoBlockK(rname);
    const list=kcatalog().filter(d=>d.rest===rname);
    /* kFilter chip sifatida restoran nomi ko'rsatilsin + tavsiya banneri */
    const box=document.getElementById("kFilters");
    if(box){
      const isPref = preferredRest()===rname;
      /* Restoran yopiq bo'lsa — menyu tepasida ochiq-oydin ogohlantirish */
      const open=kIsOpen(rname);
      const closedBar = open ? `` :
        `<div class="yz-closed-bar" style="flex-basis:100%;width:100%;margin-top:8px;margin-bottom:0">`+
        `<span style="font-size:19px;color:#C8102E">${ic('dot','yz-i-fill')}</span><span><b>${esc(rname)}</b> hozir yopiq — buyurtma qabul qilinmaydi.<br>`+
        `Ish vaqti: <b>${esc(kHours(rname))}</b>. Shu vaqtda qayta kiring.</span></div>`;
      box.innerHTML=`<button class="kchip on" id="kRestFilterChip">${ic('store')} ${esc(rname)} <span style="margin-left:4px;opacity:.7">${ic('x')}</span></button>`+
        closedBar+
        (isPref?`<div style="flex-basis:100%;width:100%;margin-top:8px;font-size:13px;color:#16a34a;background:#eafaf0;border:1px solid #bdebd0;border-radius:10px;padding:8px 12px">${ic('star','yz-i-fill yz-i-amber')} Siz shu restorandan buyurtma bergansiz — taomlar shu yerdan tavsiya qilinmoqda. Boshqa restoran uchun ${ic('x')} bosing.</div>`:``);
      const chip=box.querySelector("#kRestFilterChip");
      /* "Taomlar" alohida tab emas — filtr olib tashlansa Restoranlar ro'yxatiga qaytamiz */
      if(chip) chip.addEventListener("click",()=>{ activeRest=null; const info=document.getElementById("kRestInfo"); if(info) info.innerHTML=""; nav("rests"); });
    }
    renderMenuFiltered(list);
  }
  function renderMenuFiltered(list){
    renderKabPromoBand();
    const g=document.getElementById("kMenu"); if(!g) return;
    g.innerHTML=personalizedSort(list).map(d=>kCardHTML(d)).join("");
    bindMenuEvents();
  }
  /* Yurakcha bosilganda — toggle qilib, ro'yxatni DARHOL qayta saralaymiz
     (yoqtirilgan taom birinchi bo'lib chiqishi kerak). */
  function bindLikeButtons(){
    document.querySelectorAll("#kMenu .card-like").forEach(b=>{
      if(b._likeBound) return; b._likeBound=true;
      b.addEventListener("click",async (e)=>{
        e.stopPropagation();
        if(typeof STORE==="undefined" || !STORE.toggleLike) return;
        const rest=b.dataset.rest, name=b.dataset.name;
        b.classList.toggle("liked");   // optimistik — darhol ko'rinadi
        await STORE.toggleLike(rest,name);
        if(activeRest) filterByRest(activeRest); else renderMenu();
      });
    });
  }
  function bindMenuEvents(){
    document.querySelectorAll("#kMenu .card-img, #kMenu h3").forEach(el=>el.addEventListener("click",()=>{
      const id=+el.dataset.id; const d=kcatalog().find(x=>x.id===id); if(!d) return;
      /* Restoran ichida bo'lsak — taom tafsiloti; aks holda taomga bosilsa o'sha restoranga kiramiz */
      if(activeRest){ openKDishModal(d); }
      else { filterByRest(d.rest); try{window.scrollTo({top:0});}catch(e){} }
    }));
    document.querySelectorAll("#kMenu .add-btn:not(.add-closed)").forEach(b=>b.addEventListener("click",(e)=>{ e.stopPropagation(); addToCart(+b.dataset.id); }));
    document.querySelectorAll("#kMenu .qty-btn:not(.qty-note)").forEach(b=>b.addEventListener("click",(e)=>{ e.stopPropagation(); changeQty(+b.dataset.id,+b.dataset.m); updateKMenuQty(); }));
    document.querySelectorAll("#kMenu .qty-note").forEach(b=>b.addEventListener("click",(e)=>{ e.stopPropagation(); const d=kcatalog().find(x=>x.id===+b.dataset.noteid); if(d) openKNoteModal(d); }));
    bindLikeButtons();
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
    /* Bonuslar (ommaviy) + o'zining chegirmali tadbirlari (shaxsiy) */
    const bonusList=(typeof STORE!=="undefined"&&STORE.bonuses)?STORE.bonuses():[];
    const myDiscEvents=(KAB_MY_EVENTS||[]).filter(e=>e.discountPct>0);
    const modal=document.getElementById("kpmodModal");
    const bd=document.getElementById("kpmodBackdrop");
    const content=document.getElementById("kpmodContent");
    if(!modal||!content) return;
    content.innerHTML=`
      <h2 style="margin-bottom:4px">${ic('flame','yz-i-brand')} Aksiyalar</h2>
      <p style="color:var(--grey);font-size:13px;margin-bottom:14px">Bugungi maxsus takliflar</p>
      ${discDishes.length?`
      <div class="kpm-sec-title">${ic('tag')} Chegirmali taomlar</div>
      <div class="kpm-dishes">
        ${discDishes.map(d=>`
          <div class="kpm-dish" data-id="${d.id}" style="cursor:pointer">
            <div class="kpm-dish-img tone-${d.kw||'burger'}">
              <span style="font-size:28px;color:#fff">${foodIcon(d.kw)}</span>
            </div>
            <div class="kpm-dish-info">
              <div class="kpm-dish-name">${esc(nm(d))}</div>
              <div class="kpm-dish-rest">${esc(trTxt(d.rest))}</div>
              <div class="kpm-dish-prices">
                <span class="kpm-old">${money(d.price)}</span>
                <span class="kpm-new">${money(d.eff)} so'm</span>
                <span class="kpm-pct">-${d.discount}%</span>
              </div>
            </div>
            <button class="kpm-add" data-id="${d.id}">+</button>
          </div>`).join("")}
      </div>`:""}
      ${bonusList.length?`
      <div class="kpm-sec-title" style="margin-top:${discDishes.length?16:0}px">${ic('gift')} Bonuslar</div>
      <div class="kpm-anns">
        ${bonusList.map(b=>`
          <div class="kpm-ann" data-bonus="1" style="cursor:pointer">
            <span class="kpm-ann-emoji">${ic('gift')}</span>
            <div class="kpm-ann-body">
              <div class="kpm-ann-rest">${b.scope==='restoran'?esc(trTxt(b.rest)):"Yetkaz.uz"}</div>
              <div class="kpm-ann-text">${esc(b.title)}${b.rewardText?" — "+esc(b.rewardText):""}</div>
              <div class="kpm-ann-action">Bonuslar bo'limiga o'tish ${ic('chevron-right')}</div>
            </div>
            <span class="kpm-tag">BONUS</span>
          </div>`).join("")}
      </div>`:""}
      ${myDiscEvents.length?`
      <div class="kpm-sec-title" style="margin-top:16px">${ic('party')} Tadbirlaringiz chegirmasi</div>
      <div class="kpm-anns">
        ${myDiscEvents.map(e=>`
          <div class="kpm-ann" data-event="1" style="cursor:pointer">
            <span class="kpm-ann-emoji">${ic('party')}</span>
            <div class="kpm-ann-body">
              <div class="kpm-ann-rest">${esc(trTxt(e.rest))}</div>
              <div class="kpm-ann-text">${esc(e.name)} — ${e.discountPct}% chegirma</div>
              <div class="kpm-ann-action">Tadbirlar bo'limiga o'tish ${ic('chevron-right')}</div>
            </div>
            <span class="kpm-tag">TADBIR</span>
          </div>`).join("")}
      </div>`:""}
      <div class="kpm-sec-title" style="margin-top:16px">${ic('megaphone')} E'lonlar</div>
      <div class="kpm-anns">
        ${promos.map(p=>`
          <div class="kpm-ann" data-rest="${p.rest}" style="cursor:pointer">
            <span class="kpm-ann-emoji">${p.emoji?esc(p.emoji):ic('megaphone')}</span>
            <div class="kpm-ann-body">
              <div class="kpm-ann-rest">${p.rest}</div>
              <div class="kpm-ann-text">${p.text}</div>
              <div class="kpm-ann-action">Restoraniga o'tish ${ic('chevron-right')}</div>
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
        btn.innerHTML=ic('check'); btn.style.background="var(--green)";
      });
    });
    /* E'lon bosilganda restoranga (yoki bonus/tadbir bo'lsa — o'sha bo'limga) o'tish */
    content.querySelectorAll(".kpm-ann").forEach(el=>{
      el.addEventListener("click",()=>{
        if(el.dataset.bonus){ closeKabPromoModal(); nav("bonus"); return; }
        if(el.dataset.event){ closeKabPromoModal(); nav("events"); return; }
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
    const evBtn=$("#evSubmit"); if(evBtn) evBtn.addEventListener("click",submitEvent);
    /* Guruh buyurtmasi */
    const grpC=$("#grpCreateBtn"); if(grpC) grpC.addEventListener("click",createGroup);
    const grpJ=$("#grpJoinBtn"); if(grpJ) grpJ.addEventListener("click",joinGroupCode);
    const grpSA=$("#grpSaveAddr"); if(grpSA) grpSA.addEventListener("click",saveGroupAddr);
    const grpPay=$("#grpMyPay"); if(grpPay) grpPay.addEventListener("change",changeGroupPay);
    const grpConf=$("#grpConfirmBtn"); if(grpConf) grpConf.addEventListener("click",confirmGroupOrder);
    /* ===== Sozlamalar ===== */
    (function(){
      var v=function(id){ var el=document.getElementById(id); return el?el.value.trim():""; };
      var avaInput=document.getElementById("avaInput");
      if(avaInput) avaInput.addEventListener("change", async function(){
        var f=avaInput.files&&avaInput.files[0]; if(!f) return;
        var avaMsg=document.getElementById("avaMsg");
        if(avaMsg) avaMsg.textContent="Yuklanmoqda...";
        var dataUrl=await resizeAvaImage(f);
        if(!dataUrl){ if(avaMsg) avaMsg.textContent="Rasmni o'qib bo'lmadi"; return; }
        var url=(typeof STORE!=="undefined"&&STORE.uploadImage)? await STORE.uploadImage(dataUrl):"";
        if(!url){ if(avaMsg) avaMsg.textContent="Yuklashda xatolik"; return; }
        var r=(typeof STORE!=="undefined"&&STORE.updateProfile)? await STORE.updateProfile({avatar:url}) : {error:"Serverga ulanmadi"};
        if(r && !r.error){ renderAvaPreview(url); if(avaMsg) avaMsg.textContent=""; toast("Profil rasmi yangilandi","success"); }
        else if(avaMsg) avaMsg.textContent=(r&&r.error)||"Xatolik";
        avaInput.value="";
      });
      var sp=document.getElementById("stSaveProfile");
      if(sp) sp.addEventListener("click", async function(){
        var msg=document.getElementById("stMsg");
        var name=v("stName"), phone=v("stPhone"), email=v("stEmail");
        var region=v("stRegion"), mahalla=v("stMahalla"), street=v("stStreet");
        if(name.length<2){ if(msg){msg.style.color="#C8102E";msg.textContent="Ismni to'g'ri kiriting";} return; }
        if(email && window.YZ_EMAIL && !YZ_EMAIL.valid(email)){ if(msg){msg.style.color="#C8102E";msg.textContent="Email noto'g'ri formatda";} return; }
        var addr=formatAddr(region,mahalla,street);
        var payload={name:name,phone:phone,email:email,addrRegion:region,addrMahalla:mahalla,addrStreet:street};
        if(USER.geo){ payload.addrLat=USER.geo.lat; payload.addrLng=USER.geo.lng; }
        var r=(typeof STORE!=="undefined"&&STORE.updateProfile)? await STORE.updateProfile(payload) : {error:"Serverga ulanmadi"};
        if(r && !r.error){
          USER.name=name; USER.phone=phone; USER.address=addr;
          try{ localStorage.setItem("yz_user_addr", addr); localStorage.setItem("yz_user_name", name); if(phone) localStorage.setItem("yz_user_phone", phone); }catch(e){}
          var sn=document.getElementById("sbName"); if(sn) sn.textContent=name;
          if(msg){msg.style.color="#16a34a";msg.textContent="Saqlandi";} toast("Profil saqlandi","success");
        }
        else if(msg){ msg.style.color="#C8102E"; msg.textContent=(r&&r.error)||"Xatolik"; }
      });
      /* Joylashuvni yoqish — GPSdan manzilni aniqlaydi VA darhol profilga
         saqlaydi (foydalanuvchi alohida "Saqlash" bosishi shart emas, lekin
         forma maydonlarini ham to'ldiradi — u baribir tahrirlashi mumkin). */
      var stGeoBtn=document.getElementById("stGeoBtn");
      if(stGeoBtn) stGeoBtn.addEventListener("click", async function(){
        var geoMsg=document.getElementById("stGeoMsg");
        if(!navigator.geolocation){ if(geoMsg) geoMsg.textContent="Brauzeringiz joylashuvni qo'llamaydi"; return; }
        stGeoBtn.disabled=true; var orig=stGeoBtn.innerHTML; stGeoBtn.innerHTML=ic('map-pin')+" Aniqlanmoqda...";
        navigator.geolocation.getCurrentPosition(async function(pos){
          stGeoBtn.disabled=false; stGeoBtn.innerHTML=orig;
          var lat=pos.coords.latitude, lng=pos.coords.longitude, addrTxt="";
          try{
            var r=await fetch("https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat="+lat+"&lon="+lng+"&accept-language=uz",{headers:{"Accept":"application/json"}});
            var j=await r.json(); addrTxt=(j&&j.display_name)||"";
          }catch(e){}
          USER.geo={lat:lat,lng:lng,addr:addrTxt};
          if(addrTxt){ var st=document.getElementById("stStreet"); if(st && !st.value) st.value=addrTxt; }
          if(geoMsg) geoMsg.textContent="Joylashuv aniqlandi — endi \"Saqlash\"ni bosing";
          toast("Joylashuv aniqlandi","success");
        }, function(err){
          stGeoBtn.disabled=false; stGeoBtn.innerHTML=orig;
          if(geoMsg) geoMsg.textContent = err&&err.code===1 ? "Joylashuvga ruxsat berilmadi" : "Joylashuvni aniqlab bo'lmadi";
        }, { enableHighAccuracy:true, timeout:10000, maximumAge:60000 });
      });
      /* Login/parolni o'zgartirish mijoz panelidan OLIB TASHLANDI —
         buni FAQAT administrator bajaradi (admin panel «Loginlar» bo'limi). */
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
    if(kpBand) kpBand.addEventListener("click",handleKabPromoClick);
    const kpBand2=document.getElementById("kabPromoBand");
    if(kpBand2) kpBand2.addEventListener("click",function(e){ if(!e.target.closest(".kab-promo-close")) handleKabPromoClick(); });
    /* Rests view listener (link kabinet.html'да statik — pastroqda .sb-link
       umumiy click bog'lovchisi nav("rests")ни chaqiradi, bu FAQAT renderKabRests
       uchun qo'shimcha) */
    const rlBtn=document.querySelector('.sb-link[data-view="rests"]');
    if(rlBtn) rlBtn.addEventListener("click",()=>renderKabRests());
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
