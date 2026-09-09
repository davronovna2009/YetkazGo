/* ===== Yetkaz.uz — Kuryer paneli ===== */
(function(){
  const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
  const money=n=>Math.round(n).toLocaleString("ru-RU");
  /* XSS himoyasi — ta'rif assets/js/safe.js da (YAGONA manba, `'` ni ham escape
     qiladi). Bu yerда faqat qisqartma. Yangi kod uchun: html`...` teg shabloni. */
  const esc=YZ_SAFE.esc, html=YZ_SAFE.html, raw=YZ_SAFE.raw;
  /* «Daromad» bo'limi (nav: data-view="income") MAVJUD va ishlaydi — renderIncome().
     Kuryer daromadi = HAR yetkazilgan buyurtmaga muhrlangan haq (o.courierFee)
     yig'indisi; admin panelidagi "kuryer xarajati" bilan 1 so'mgacha mos. */

  /* Parollar bu yerda saqlanmaydi — kirish backend orqali (xeshlangan) tekshiriladi */
  const COURIERS=[];

  let CUR=null, ORDERS=[], todayDone=0;

  function loadOrders(){ ORDERS = (typeof STORE!=="undefined")?STORE.ordersForCourier(CUR.name):[]; }

  async function login(){
    const u=$("#klUser").value.trim(), p=$("#klPass").value.trim();
    $("#loginErr").textContent="";
    const acc=(typeof STORE!=="undefined")? await STORE.login(u,p):null;
    if(acc && acc.offline){ $("#loginErr").textContent="Serverga ulanib bo'lmadi. Saytni server orqali oching (masalan http://localhost:5050) va internetni tekshiring."; return; }
    if(acc && acc.role==="kuryer"){
      const c=COURIERS.find(x=>x.login===acc.login) || COURIERS.find(x=>x.name===acc.name);
      if(c){ enter(c); return; }
      enter({ id:Date.now(), name:acc.name||acc.login, login:acc.login, emoji:"🛵", rest:"", deliveries:0, rating:0, fee:(acc.fee||0), phone:acc.phone||"" }); return;
    }
    if(acc && acc.target){ try{ location.href=acc.target; }catch(e){} return; }
    $("#loginErr").textContent="Login yoki parol xato.";
  }
  function enter(c){ CUR=c; loadOrders(); todayDone=0; $("#loginWrap").style.display="none"; $("#app").classList.add("show");
    $("#sbName").textContent=c.name; renderAll();
    loadCourierState().then(updateStatusBadge);
    /* Realtime: boshqa rol buyurtma/status o'zgartirsa darhol yangilanadi */
    if(typeof STORE!=="undefined" && STORE.onChange && !window.__kurSub){ window.__kurSub=true;
      STORE.onChange(()=>{ if(CUR){ loadOrders(); renderAll(); } }); }
  }

  function nav(view){
    $$(".sb-link").forEach(l=>l.classList.toggle("active",l.dataset.view===view));
    $$(".view").forEach(v=>v.classList.toggle("show",v.id==="view-"+view));
    const t={dash:"Buyurtmalar",orders:"Faol buyurtmalar",income:"Daromad",help:"Shikoyat / yordam",settings:"Sozlamalar"};
    if(view==="settings") fillCourierSettings();
    if(view==="income") renderIncome();
    if(view==="help"){ try{ YZ_COMPLAINT.mount(document.getElementById("kurComplaintBox")); }catch(e){} }
    $("#tbTitle").textContent=t[view]||""; $("#sidebar").classList.remove("open"); window.scrollTo({top:0});
  }

  const STT={new:{t:"Yangi — olib keting",p:"blue",next:"ontheway",btn:"Yo'lga chiqdim"},
             accepted:{t:"Olib keting",p:"blue",next:"ontheway",btn:"Yo'lga chiqdim"},
             ready:{t:"Tayyor — olib keting",p:"blue",next:"ontheway",btn:"Yo'lga chiqdim"},
             ontheway:{t:"Yo'lda",p:"red",next:"arrived",btn:"Yetkazdim ✓"},
             arrived:{t:"Yetkazildi (mijoz tasdig'i kutilmoqda)",p:"blue",next:null,btn:null},
             done:{t:"Yetkazildi",p:"ok",next:null,btn:null},
             cancelled:{t:"Bekor qilingan",p:"red",next:null,btn:null}};

  /* Buyurtma QAYERDAN kelgan — Telegram mini ilovasidanmi yoki saytdanmi
     (server `source` maydonini yozadi: server/src/orders-core.js) */
  function srcBadge(o){
    var tg=(o&&o.source)==="telegram";
    return '<span class="pill '+(tg?"blue":"ok")+'" title="'+(tg?"Telegram bot orqali":"Sayt orqali")+'">'
      +(tg?"🤖 Telegram":"🌐 Sayt")+'</span>';
  }

  /* ===== KATTA BUYURTMA — AVVAL MIJOZGA QO'NG'IROQ =====
     Buyurtma 10 donadan ko'p yoki 300 000 so'mdan qimmat bo'lsa (server
     order-rules.js da belgilaydi va `callRequired` bilan yuboradi), kuryer
     «Yo'lga chiqdim» tugmasini BOSA OLMAYDI. Avval mijozga qo'ng'iroq qilib
     "rostdan shu buyurtmani berdingizmi?" deb so'raydi. Mijoz "ha, olib keling"
     desa — kuryer tasdiqlaydi va tugmalar ochiladi.
     Soxta katta buyurtma shu bosqichда aniqlanadi. */
  function needsCall(o){ return !!(o && o.callRequired && !o.callDone); }
  /* Jami dona soni (YZ_ITEMS — barcha panellar uchun yagona manba) */
  function orderQty(o){ try{ return YZ_ITEMS.qty(o); }catch(e){ return 0; } }

  function callBadge(o){
    if(!o || !o.callRequired) return "";
    if(o.callDone){
      return '<div style="margin-top:6px;display:inline-block;background:#f0fdf4;color:#16a34a;border-radius:8px;padding:4px 10px;font-size:12px;font-weight:800">'+
        '✅ Mijoz telefonda tasdiqladi'+(o.callBy?' ('+esc(o.callBy)+')':'')+'</div>';
    }
    return '<div style="margin-top:6px;display:inline-block;background:#fff7ed;color:#c2410c;border-radius:8px;padding:4px 10px;font-size:12px;font-weight:800">'+
      '📞 Katta buyurtma — avval mijozga qo\'ng\'iroq qiling</div>';
  }

  /* Qo'ng'iroq modali: raqamni bosib qo'ng'iroq qilinadi, keyin natija belgilanadi */
  function openCallModal(o){
    if(!o) return;
    var el=document.getElementById("kCallModal"); if(el) el.remove();
    el=document.createElement("div"); el.id="kCallModal";
    el.style.cssText="position:fixed;inset:0;z-index:10002;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:18px";
    var qty=orderQty(o);
    el.innerHTML='<div style="background:#fff;border-radius:20px;max-width:420px;width:100%;padding:22px;max-height:90vh;overflow:auto">'+
      '<div style="text-align:center;font-size:42px">📞</div>'+
      '<h3 style="margin:6px 0 6px;text-align:center">Avval mijozga qo\'ng\'iroq qiling</h3>'+
      '<p style="color:var(--grey);font-size:13px;margin:0 0 14px;text-align:center">'+
        'Bu <b>katta buyurtma</b>'+(qty?' — <b>'+qty+' dona</b>':'')+', <b>'+money(o.amount)+' so\'m</b>. '+
        'Mijozdan buyurtmani <b>rostdan bergani</b>ni so\'rang. Tasdiqlagach yo\'lga chiqasiz.</p>'+
      (o.phone
        ? '<a href="tel:'+encodeURIComponent(o.phone)+'" class="set-save" style="display:block;text-align:center;text-decoration:none;padding:14px;font-size:16px;margin-bottom:14px">📞 '+esc(o.phone)+'</a>'
        : '<div style="background:#fef2f2;color:#b91c1c;border-radius:12px;padding:12px;font-size:13px;margin-bottom:14px">Mijoz telefon raqami ko\'rsatilmagan — restoran bilan bog\'laning.</div>')+
      '<div style="display:flex;flex-direction:column;gap:9px">'+
        '<button id="kCallOk" style="padding:13px;border-radius:12px;border:none;background:#16a34a;color:#fff;font-weight:800;cursor:pointer;font-size:15px">✅ Mijoz tasdiqladi — olib ketaman</button>'+
        '<button id="kCallNo" style="padding:12px;border-radius:12px;border:1px solid var(--line);background:#fff;color:#C8102E;font-weight:700;cursor:pointer">❌ Mijoz rad etdi / javob bermadi</button>'+
        '<button id="kCallClose" style="padding:11px;border-radius:12px;border:1px solid var(--line);background:#fff;cursor:pointer">Keyinroq</button>'+
      '</div></div>';
    document.body.appendChild(el);
    var close=function(){ el.remove(); };
    el.addEventListener("click",function(e){ if(e.target===el) close(); });
    el.querySelector("#kCallClose").addEventListener("click",close);
    el.querySelector("#kCallNo").addEventListener("click",function(){
      close();
      toast("Mijoz tasdiqlamadi — buyurtmani restoran yoki admin bekor qiladi. Ular bilan bog'laning.");
    });
    el.querySelector("#kCallOk").addEventListener("click",async function(){
      var btn=this; btn.disabled=true; btn.textContent="Saqlanmoqda...";
      var r=(typeof STORE!=="undefined"&&STORE.confirmOrderCall)? await STORE.confirmOrderCall(o.id) : null;
      close();
      if(r && !r.error){
        toast("Tasdiqlandi ✓ Endi «Yo'lga chiqdim» tugmasi ishlaydi");
        loadOrders(); renderAll();
      } else toast((r&&r.error)||"Serverga ulanib bo'lmadi");
    });
  }

  /* ===== YETKAZISH MUDDATI =====
     Buyurtmaга `eta` (daqiqa) beriladi. Muddat tugay deb qolganda kuryer
     UCH marta ogohlantiriladi, muddat o'tsa — to'rtinchi (kechikish) xabari.
     Chegaralar SERVER bilan bir xil (server/src/alerts.js: alertLevel) —
     shu sababli Telegramдаги va paneldagi ogohlantirish mos tushadi. */
  const KACTIVE=["new","accepted","ready","ontheway"];
  function kDeadline(o){
    var t=YZ_TIME.stamp((o&&o.created_at)||""); if(!t) return 0;
    var eta=Math.max(5,Math.min(120,Number(o&&o.eta)||15));
    return t+eta*60000;
  }
  function kMinutesLeft(o){
    var d=kDeadline(o); if(!d) return null;
    /* ceil — server (alerts.js) bilan bir xil: 40 soniya qolganда "vaqt tugadi" demaydi */
    return Math.ceil((d-Date.now())/60000);
  }
  function kLevel(o){
    var m=kMinutesLeft(o); if(m===null) return 0;
    var eta=Math.max(5,Math.min(120,Number(o&&o.eta)||15));
    if(m<=0) return 4;
    if(m<=2) return 3;
    if(m<=5) return 2;
    if(m<=Math.max(6,Math.round(eta/2))) return 1;
    return 0;
  }
  /* Har bir daraja bitta buyurtma uchun BIR MARTA ko'rsatiladi (qayta yuklashда ham) */
  const KSEEN_KEY="yz_kur_alerts";
  function kSeen(){ try{ return JSON.parse(localStorage.getItem(KSEEN_KEY)||"{}"); }catch(e){ return {}; } }
  function kMarkSeen(id,level){
    try{ var s=kSeen(); s[id]=Math.max(level,s[id]||0); localStorage.setItem(KSEEN_KEY,JSON.stringify(s)); }catch(e){}
  }
  /* Muddat qatori — buyurtma kartochkasida ko'rinadi */
  function kTimeBadge(o){
    if(KACTIVE.indexOf(o.status)<0) return "";
    var m=kMinutesLeft(o); if(m===null) return "";
    var lv=kLevel(o);
    var col=lv>=4?"#b91c1c":lv>=3?"#dc2626":lv>=2?"#d97706":lv>=1?"#ca8a04":"#16a34a";
    var bg =lv>=4?"#fef2f2":lv>=3?"#fef2f2":lv>=2?"#fffbeb":lv>=1?"#fefce8":"#f0fdf4";
    var txt=m<=0?("⛔ Vaqt tugadi ("+Math.abs(m)+" daq. kechikish)"):("⏱ "+m+" daqiqa qoldi");
    return '<div style="margin-top:6px;display:inline-block;background:'+bg+';color:'+col+';border-radius:8px;padding:4px 10px;font-size:12px;font-weight:800">'+txt+'</div>';
  }
  /* Ogohlantirishlarni tekshirish — toast + tepadagi banner */
  function checkDeadlines(){
    var seen=kSeen(), boxItems=[];
    ORDERS.forEach(function(o){
      if(KACTIVE.indexOf(o.status)<0) return;
      var lv=kLevel(o); if(!lv) return;
      var m=kMinutesLeft(o);
      if(lv>=2) boxItems.push({o:o,lv:lv,m:m});
      if((seen[o.id]||0)>=lv) return;
      kMarkSeen(o.id,lv);
      if(lv>=4) toast("⛔ Buyurtma #"+o.id+" — VAQT TUGADI! Mijozga tezda yetkazing.");
      else toast("⏰ "+lv+"-ogohlantirish: buyurtma #"+o.id+" — "+Math.max(0,m)+" daqiqa qoldi!");
      try{ if(navigator.vibrate) navigator.vibrate(lv>=4?[200,80,200]:[120]); }catch(e){}
    });
    renderDeadlineBanner(boxItems);
  }
  function renderDeadlineBanner(items){
    var el=document.getElementById("kDeadlineAlerts"); if(!el) return;
    if(!items.length){ el.innerHTML=""; return; }
    items.sort(function(a,b){ return b.lv-a.lv; });
    el.innerHTML=items.map(function(it){
      var late=it.lv>=4;
      return '<div class="panel" style="margin-bottom:12px;border:2px solid '+(late?"#dc2626":"#f59e0b")+'">'+
        '<div class="panel-body" style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">'+
        '<span style="font-size:28px">'+(late?"⛔":"⏰")+'</span>'+
        '<div style="flex:1;min-width:180px">'+
          '<b style="color:'+(late?"#b91c1c":"#b45309")+'">'+(late?"Vaqt tugadi — buyurtma #"+it.o.id:"Vaqt kam qoldi — buyurtma #"+it.o.id)+'</b>'+
          '<div style="color:var(--grey);font-size:13px;margin-top:2px">'+
            (late?("Muddat "+Math.abs(it.m)+" daqiqa oldin tugadi. Mijoz kutmoqda — darhol yetkazing."):("Yetkazishga <b>"+Math.max(0,it.m)+" daqiqa</b> qoldi."))+
            ' 📍 '+esc(it.o.addr||"—")+'</div>'+
        '</div>'+
        (it.o.phone?'<a href="tel:'+encodeURIComponent(it.o.phone)+'" class="set-save" style="text-decoration:none;padding:9px 14px">📞 Qo\'ng\'iroq</a>':"")+
        '</div></div>';
    }).join("");
  }

  function renderDash(){
    const c=CUR;
    /* Real: faqat yetkazilgan (done) buyurtmalar hisoblanadi, 0 dan boshlanadi */
    const doneAll=ORDERS.filter(o=>o.status==="done");
    const doneCount=doneAll.length;
    const active=ORDERS.filter(o=>o.status!=="done"&&o.status!=="cancelled").length;
    const late=ORDERS.filter(o=>KACTIVE.indexOf(o.status)>=0 && kLevel(o)>=4).length;
    /* Real reyting — mijozlar bergan kuryer baholari o'rtachasi */
    var _rv=(typeof STORE!=="undefined"?STORE.reviews():[]).filter(function(r){ var d=String(r.dish||""); return /^🛵\s*Kuryer:/.test(d) && d.replace(/^🛵\s*Kuryer:\s*/,"")===c.name; });
    const rating=_rv.length?(_rv.reduce(function(s,r){return s+(r.rating||0);},0)/_rv.length).toFixed(1):(c.rating||0);
    /* Dashboard kartalarida PUL yo'q — daromad alohida «Daromad» bo'limida (renderIncome) */
    $("#statCards").innerHTML=`
      <div class="scard c3"><div class="si">🚀</div><b>${active}</b><span>Faol buyurtma</span></div>
      <div class="scard c2"><div class="si">📦</div><b>${money(doneCount)}</b><span>Yetkazilgan (jami)</span></div>
      <div class="scard c1"><div class="si">⏰</div><b>${late}</b><span>Kechikkan</span></div>
      <div class="scard c4"><div class="si">⭐</div><b>${rating||"—"}</b><span>Reyting</span></div>`;
    /* Mijoz izohlari (barcha panelda ko'rinadi) */
    var host=$("#statCards");
    if(host && host.parentNode){
      var revBox=document.getElementById("kurReviews");
      if(!revBox){ revBox=document.createElement("div"); revBox.id="kurReviews"; revBox.className="panel"; revBox.style.marginTop="16px"; host.parentNode.appendChild(revBox); }
      var all=(typeof STORE!=="undefined"?STORE.reviews():[]);
      /* Faqat SHU kuryerga berilgan reytinglar (dish = "🛵 Kuryer: <ism>") */
      var mine=all.filter(function(r){ var d=String(r.dish||""); return /^🛵\s*Kuryer:/.test(d) && d.replace(/^🛵\s*Kuryer:\s*/,"")===c.name; });
      var avg=mine.length?(mine.reduce(function(s,r){return s+(r.rating||0);},0)/mine.length):0;
      revBox.innerHTML='<div class="panel-head"><h3>⭐ Mening reytingim</h3>'+(mine.length?'<span style="color:var(--grey);font-size:13px">O\'rtacha <b>'+avg.toFixed(1)+'</b> · '+mine.length+' baho</span>':'')+'</div><div class="panel-body">'+
        (mine.length?mine.slice(0,20).map(function(r){ var rr=Math.max(0,Math.min(5,r.rating|0)); return '<div style="padding:10px 0;border-bottom:1px solid var(--line)"><div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><b>'+(r.ava||"👤")+' '+esc(r.name)+'</b><span class="star">'+"★".repeat(rr)+"☆".repeat(5-rr)+'</span></div>'+(r.text?'<div style="font-size:14px;margin-top:4px">'+esc(r.text)+'</div>':'')+'</div>'; }).join(""):'<p style="color:var(--grey)">Sizga hali reyting berilmagan. Tez va xushmuomala yetkazsangiz — mijozlar baholaydi!</p>')+
        '</div>';
    }
  }

  /* Buyurtmalar ro'yxatini KO'RSATILGAN konteynerga chizadi (bir nechta joy uchun:
     "Faol buyurtmalar" bo'limi + dashboard). Logika bitta — takrorlanmaydi. */
  function renderOrdersInto(hostId){
    const list=ORDERS;
    const host=document.getElementById(hostId); if(!host) return;
    host.innerHTML=list.length? list.map(o=>{
      const s=STT[o.status]||{t:o.status,p:"warn"};
      /* Katta buyurtma va hali tasdiqlovchi qo'ng'iroq qilinmagan bo'lsa —
         «Yo'lga chiqdim» o'rniga «Mijozga qo'ng'iroq» tugmasi chiqadi. */
      const gate = s.next==="ontheway" && needsCall(o);
      const right = gate
        ? `<button class="set-save" data-call="${o.id}" style="padding:11px 18px;background:#ea580c">📞 Mijozga qo'ng'iroq</button>`
        : (s.btn
            ? `<button class="set-save" data-adv="${o.id}" style="padding:11px 18px">${s.btn}</button>`
            : `<span class="pill ${s.p}">${s.t}</span>`);
      /* Ko'p mahsulotli buyurtma: barcha taomlar rasm lentasi (yon tomonga suriladi) */
      const n=(o.items&&o.items.length)||0;
      const strip = n>1 ? `<div style="color:var(--red);font-size:11px;font-weight:800;margin-top:4px">${n} xil · ${orderQty(o)} dona</div>${(function(){try{return YZ_ITEMS.strip(o);}catch(e){return "";}})()}` : "";
      /* MIJOZ IZOHI ("sous bilan", "achchiq solmang") — ro'yxatning O'ZIDA
         to'liq ko'rinadi. Kuryer modalni ochmasdan ham nima olib chiqishini
         biladi: izohni o'tkazib yuborsa buyurtma noto'g'ri yetkaziladi. */
      const noteBox=(function(){ try{ return YZ_ITEMS.notesHtml(o,{title:"Mijoz izohi — shuni bajaring"}); }catch(e){ return ""; } })();
      return `<div class="panel" style="margin-bottom:14px;cursor:pointer" data-oid="${o.id}"><div class="panel-body" style="display:flex;align-items:center;gap:16px;flex-wrap:wrap">
        <span class="av" style="width:48px;height:48px;font-size:24px">${o.emoji}</span>
        <div style="flex:1;min-width:160px">
          <div style="font-weight:700">${esc(o.item)} <span class="pill ${s.p}" style="margin-left:6px">${s.t}</span></div>
          <div style="color:var(--grey);font-size:14px">${esc(o.user)}${o.phone?` · 📞 ${esc(o.phone)}`:""}</div>
          <div style="color:var(--grey);font-size:13px">📍 ${esc(o.addr)} · ${money(o.amount)} so'm</div>
          ${strip}
          <div style="margin-top:5px">${srcBadge(o)}</div>
          ${callBadge(o)}
          ${kTimeBadge(o)}
        </div>
        ${right}
        ${noteBox}
      </div></div>`;
    }).join("") : '<div style="color:var(--grey);padding:20px">Hozircha buyurtma yo\'q.</div>';
    $$("#"+hostId+" button[data-adv]").forEach(b=>b.addEventListener("click",(e)=>{ e.stopPropagation(); advance(+b.dataset.adv); }));
    $$("#"+hostId+" button[data-call]").forEach(b=>b.addEventListener("click",(e)=>{ e.stopPropagation(); openCallModal(ORDERS.find(x=>x.id==b.dataset.call)); }));
    $$("#"+hostId+" [data-oid]").forEach(row=>row.addEventListener("click",()=>{ const o=ORDERS.find(x=>x.id==row.dataset.oid); openOrderModal(o); }));
  }
  /* Ikkala joy ham bir vaqtda yangilanadi — panellar bir-biriga mos turadi */
  function renderOrders(){ renderOrdersInto("ordersBody"); renderOrdersInto("dashOrdersBody"); }

  function advance(id){
    const o=ORDERS.find(x=>x.id==id); if(!o) return;
    const s=STT[o.status]; if(!s || !s.next) return;
    /* Katta buyurtmada yo'lga chiqishdan oldin tasdiqlovchi qo'ng'iroq shart.
       Bu yerда to'sib qo'yamiz, lekin YAKUNIY tekshiruv serverда
       (server/src/routes/orders.js PATCH). */
    if(s.next==="ontheway" && needsCall(o)){ openCallModal(o); return; }
    if(typeof STORE!=="undefined") STORE.updateOrder(id,{status:s.next},{
      /* Server rad etsa (masalan qo'ng'iroq tasdiqlanmagan) — sababini ko'rsatamiz */
      onFail:function(err){ toast((err&&err.message)||"Holatni yangilab bo'lmadi"); loadOrders(); renderOrders(); }
    });
    loadOrders(); renderOrders(); renderDash(); checkDeadlines();
  }

  /* Buyurtma to'liq ma'lumot modali (mobil + desktop).
     created_at bazaga UTC yoziladi — Toshkent vaqtiga o'giramiz (hours.js). */
  function fmtDateTime(o){
    return YZ_TIME.fmtDateTime((o&&o.created_at)||"") || (o&&o.time) || "—";
  }
  function openOrderModal(o){
    if(!o) return;
    const s=STT[o.status]||{t:o.status,p:"warn"};
    let el=document.getElementById("ordModal"); if(el) el.remove();
    el=document.createElement("div"); el.id="ordModal";
    el.style.cssText="position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;padding:18px;backdrop-filter:blur(2px)";
    /* Buyurtma tarkibi — har bir taom rasmi, dona soni va summasi bilan.
       20–30 mahsulotli buyurtmada ro'yxat ichida scroll bo'ladi (order-items.js). */
    let itemsHtml=""; try{ itemsHtml=YZ_ITEMS.listHtml(o,{maxHeight:250}); }catch(e){}
    /* Mijoz izohi holat yorlig'idan ham TEPADA — kuryer birinchi shuni ko'radi */
    let notesTop=""; try{ notesTop=YZ_ITEMS.notesHtml(o,{title:"Mijoz izohi — shuni bajaring"}); }catch(e){}
    const gate = s.next==="ontheway" && needsCall(o);
    el.innerHTML=`<div style="background:#fff;border-radius:20px;max-width:460px;width:100%;padding:22px;position:relative;max-height:90vh;overflow:auto">
      <button id="ordModalClose" style="position:absolute;top:14px;right:14px;border:none;background:#f1f1f4;width:34px;height:34px;border-radius:50%;font-size:16px;cursor:pointer">✕</button>
      <div style="text-align:center;font-size:46px">${o.emoji||"🍽️"}</div>
      <h3 style="text-align:center;margin:6px 0 2px">${esc(o.item)}</h3>
      <div style="text-align:center;margin-bottom:8px"><span class="pill ${s.p}">${s.t}</span></div>
      <div style="text-align:center">${callBadge(o)}</div>
      ${notesTop}
      ${itemsHtml}
      <div style="display:flex;flex-direction:column;gap:10px;font-size:14px">
        <div style="display:flex;justify-content:space-between;gap:10px"><span style="color:var(--grey)">Mijoz</span><b>${esc(o.user)||"-"}</b></div>
        <div style="display:flex;justify-content:space-between;gap:10px"><span style="color:var(--grey)">Telefon</span><b>${o.phone?`<a href="tel:${encodeURIComponent(o.phone)}" style="color:var(--red);text-decoration:none">${esc(o.phone)}</a>`:"-"}</b></div>
        <div style="display:flex;justify-content:space-between;gap:10px"><span style="color:var(--grey)">Manzil</span><b style="text-align:right">${esc(o.addr)||"-"}</b></div>
        ${orderQty(o)?`<div style="display:flex;justify-content:space-between;gap:10px"><span style="color:var(--grey)">Jami mahsulot</span><b>${orderQty(o)} dona</b></div>`:""}
        <div style="display:flex;justify-content:space-between;gap:10px"><span style="color:var(--grey)">Summa</span><b>${money(o.amount)} so'm</b></div>
        <div style="display:flex;justify-content:space-between;gap:10px"><span style="color:var(--grey)">To'lov</span><b>${(typeof STORE!=="undefined"&&STORE.payLabel)?STORE.payLabel(o.pay):(o.pay==="cash"?"💵 Naqd":"💳 Karta")}</b></div>
        <div style="display:flex;justify-content:space-between;gap:10px"><span style="color:var(--grey)">Sana / vaqt</span><b>${fmtDateTime(o)}</b></div>
        <div style="display:flex;justify-content:space-between;gap:10px"><span style="color:var(--grey)">Restoran</span><b>${esc(o.rest)||"-"}</b></div>
        <div style="display:flex;justify-content:space-between;gap:10px"><span style="color:var(--grey)">Qayerdan</span><b>${srcBadge(o)}</b></div>
        ${o.reason?`<div style="display:flex;justify-content:space-between;gap:10px"><span style="color:var(--grey)">Bekor sababi</span><b style="color:#C8102E;text-align:right">${esc(o.reason)}</b></div>`:""}
      </div>
      ${gate
        ? `<button class="set-save" id="ordModalCall" style="width:100%;margin-top:16px;padding:13px;background:#ea580c">📞 Mijozga qo'ng'iroq qiling</button>
           <p style="color:var(--grey);font-size:12px;margin-top:8px;text-align:center">Katta buyurtma. Mijoz telefonda tasdiqlagach «Yo'lga chiqdim» ochiladi.</p>`
        : (s.btn?`<button class="set-save" id="ordModalAdv" style="width:100%;margin-top:16px;padding:13px">${s.btn}</button>`:"")}
    </div>`;
    document.body.appendChild(el);
    try{ history.pushState({ordModal:1}, ""); }catch(e){}
    let popped=false;
    const close=()=>{ el.remove(); if(!popped){ popped=true; try{ history.back(); }catch(e){} } };
    el._closeOnBack=()=>{ popped=true; el.remove(); };
    el.addEventListener("click",e=>{ if(e.target===el) close(); });
    document.getElementById("ordModalClose").addEventListener("click",close);
    const adv=document.getElementById("ordModalAdv");
    if(adv) adv.addEventListener("click",()=>{ advance(o.id); close(); });
    const callBtn=document.getElementById("ordModalCall");
    if(callBtn) callBtn.addEventListener("click",()=>{ close(); openCallModal(o); });
  }
  /* App ortga: modal ochiq bo'lsa back uni yopadi (sahifadan chiqmaydi) */
  window.addEventListener("popstate",function(){ const m=document.getElementById("ordModal"); if(m){ if(m._closeOnBack) m._closeOnBack(); else m.remove(); } });

  /* To'lov QR-kodi paneli olib tashlangan. «Daromad» bo'limi MAVJUD (renderIncome,
     pastda) — nav orqali ochiladi. */

  function renderAll(){ renderDash(); renderOrders(); updateStatusBadge(); checkDeadlines(); if(document.querySelector("#view-income.show")) renderIncome(); }

  /* ===== KURYER DAROMADI =====
     Kuryer har yetkazilgan buyurtma uchun HAQ (fee) oladi — bu uning O'Z
     daromadi. Saytga qoladigan qism kuryerga UMUMAN ko'rsatilmaydi.
     Davr tanlovi + karta/naqd bo'linishi (necha mijoz karta, nechasi naqd). */
  let kIncomePeriod="oylik";
  function kInPeriod(o,p){
    var t=YZ_TIME.stamp((o&&o.created_at)||""); if(!t) return p==="oylik";
    if(p==="kunlik") return YZ_TIME.isToday((o&&o.created_at)||"");
    var d=(Date.now()-t)/86400000;
    if(p==="haftalik") return d<7; if(p==="yillik") return d<366; return d<31;
  }
  function renderIncome(){
    const host=$("#kIncomeBody"); if(!host) return;
    const fee=Math.max(0, Number(CUR&&CUR.fee)||0);
    const done=ORDERS.filter(o=>o.status==="done");
    const inP=done.filter(o=>kInPeriod(o,kIncomePeriod));
    /* Haq HAR BUYURTMAGA yetkazilgan paytda muhrlanadi (server: courier_fee).
       Admin haqni keyin oshirsa/kamaytirsa, O'TGAN buyurtmalar daromadi
       qayta yozilmaydi — kuryer ko'rgan raqam haqiqiy to'lovga mos turadi. */
    const feeOf=o=>(o&&o.courierFee!=null)?(Number(o.courierFee)||0):fee;
    const earn=inP.reduce((s,o)=>s+feeOf(o),0);
    const card=inP.filter(o=>o.pay!=="cash"), cash=inP.filter(o=>o.pay==="cash");
    const pLabel={kunlik:"bugun",haftalik:"so'nggi hafta",oylik:"so'nggi oy",yillik:"so'nggi yil"}[kIncomePeriod];
    const seg=(k,t)=>`<button class="kinc-seg" data-kp="${k}" style="border:none;border-radius:8px;padding:5px 12px;font-size:12px;font-weight:700;cursor:pointer;margin:0 4px 4px 0;background:${kIncomePeriod===k?'var(--red,#C8102E)':'#f1eef0'};color:${kIncomePeriod===k?'#fff':'#777'}">${t}</button>`;
    /* Oylik grafik — so'nggi 6 oy, yetkazilgan buyurtmalar bo'yicha */
    const MON=["Yan","Fev","Mar","Apr","May","Iyun","Iyul","Avg","Sen","Okt","Noy","Dek"];
    const now=new Date(); const slots=[];
    for(let i=5;i>=0;i--){ const dt=new Date(now.getFullYear(),now.getMonth()-i,1); slots.push({y:dt.getFullYear(),m:dt.getMonth(),label:MON[dt.getMonth()],n:0,sum:0}); }
    done.forEach(function(o){ const mm=String(o.created_at||"").match(/^(\d{4})-(\d{2})/); if(!mm) return; const sl=slots.find(x=>x.y===+mm[1]&&x.m===(+mm[2]-1)); if(sl){ sl.n++; sl.sum+=feeOf(o); } });
    const max=Math.max.apply(null,slots.map(x=>x.sum).concat([1]));
    const chart=slots.map(function(x){ const v=x.sum; return '<div style="flex:1;min-width:34px;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:6px;height:100%"><div style="font-size:10px;font-weight:700;color:#8a7f76">'+(v?Math.round(v/1000)+"k":"0")+'</div><div style="width:100%;max-width:30px;border-radius:8px 8px 0 0;background:linear-gradient(180deg,#16a34a,#4ade80);height:'+Math.max(4,Math.round(v/max*120))+'px"></div><small style="font-size:10px;color:#8a7f76">'+x.label+'</small></div>'; }).join("");
    host.innerHTML=`
      <div class="panel"><div class="panel-body" style="padding:12px 14px">
        <div style="font-size:12px;font-weight:700;color:var(--grey);margin-bottom:7px">DAVR</div>
        <div style="display:flex;flex-wrap:wrap">${seg("kunlik","Kunlik")}${seg("haftalik","Haftalik")}${seg("oylik","Oylik")}${seg("yillik","Yillik")}</div>
      </div></div>
      <div class="row2" style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
        <div class="panel"><div class="panel-head"><h3>Daromad xulosasi (${pLabel})</h3></div><div class="panel-body">
          <div class="fin-row" style="display:flex;justify-content:space-between;padding:8px 0"><span>Yetkazilgan</span><b>${money(inP.length)} ta</b></div>
          <div class="fin-row" style="display:flex;justify-content:space-between;padding:8px 0"><span>1 yetkazish haqi (hozirgi)</span><b>${money(fee)} so'm</b></div>
          <div class="fin-row" style="display:flex;justify-content:space-between;padding:8px 0"><span>O'rtacha haq (shu davrda)</span><b>${money(inP.length?Math.round(earn/inP.length):fee)} so'm</b></div>
          <div class="fin-row tot" style="display:flex;justify-content:space-between;padding:10px 0;border-top:2px solid var(--line);margin-top:6px"><span>Sizning daromadingiz</span><b style="color:var(--green);font-size:17px">${money(earn)} so'm</b></div>
        </div></div>
        <div class="panel"><div class="panel-head"><h3>💳 To'lov turi</h3></div><div class="panel-body">
          <div style="display:flex;justify-content:space-between;padding:8px 0"><span>💳 Karta</span><b>${card.length} ta</b></div>
          <div style="display:flex;justify-content:space-between;padding:8px 0"><span>💵 Naqd</span><b>${cash.length} ta</b></div>
          <div style="height:14px;background:#f1eef0;border-radius:8px;overflow:hidden;margin-top:8px;display:flex">
            ${inP.length?`<div style="width:${Math.round(card.length/inP.length*100)}%;background:#2563eb"></div><div style="width:${Math.round(cash.length/inP.length*100)}%;background:#16a34a"></div>`:''}
          </div>
          <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--grey);margin-top:5px"><span>💳 ${inP.length?Math.round(card.length/inP.length*100):0}%</span><span>💵 ${inP.length?Math.round(cash.length/inP.length*100):0}%</span></div>
        </div></div>
      </div>
      <div class="panel"><div class="panel-head"><h3>Oylik daromad (so'nggi 6 oy)</h3></div>
        <div class="panel-body"><div style="display:flex;align-items:flex-end;gap:8px;height:170px;overflow-x:auto;padding:10px 4px">${chart}</div></div></div>
      <p style="color:var(--grey);font-size:13px;padding:4px">Daromadingiz har yetkazilgan buyurtma uchun belgilangan haq bo'yicha hisoblanadi. Haqni admin belgilaydi.</p>`;
    host.querySelectorAll(".kinc-seg").forEach(function(b){ b.addEventListener("click",function(){ kIncomePeriod=b.dataset.kp; renderIncome(); }); });
  }

  /* ===== SOZLAMALAR: ish vaqti, ishdan javob (leave), login/parol ===== */
  let kState = { onLeave:false, leaveReason:"", leaveStatus:"none", openH:8, closeH:22 };

  /* Kuryerning O'Z holatini backenddan oladi (name bo'yicha) */
  async function loadCourierState(){
    try{
      const list = (typeof STORE!=="undefined" && STORE.fetchCourierStatus) ? await STORE.fetchCourierStatus() : [];
      const me = (list||[]).find(c=>c.name===CUR.name) || (list||[]).find(c=>CUR.login && c.login===CUR.login);
      if(me){ kState = { onLeave:!!me.onLeave, leaveReason:me.leaveReason||"", leaveStatus:me.leaveStatus||"none", openH:me.openH!=null?me.openH:8, closeH:me.closeH!=null?me.closeH:22 }; }
    }catch(e){}
    return kState;
  }

  /* Kuryer hozir O'Z ish vaqti ichidami — Toshkent vaqti bo'yicha (hours.js).
     Server buyurtma biriktirishda AYNAN shu qoidani qo'llaydi
     (server/src/orders-core.js: assignCourier). */
  function courierWorkingNow(){ try{ return YZ_TIME.courOpen(kState); }catch(e){ return true; } }
  function courierHoursText(){ try{ return YZ_TIME.courHours(kState); }catch(e){ return "08:00–22:00"; } }
  function updateStatusBadge(){
    const b=document.querySelector(".tb-badge"); if(!b) return;
    if(kState.onLeave){ b.textContent="🚪 Ishdan javobda"; b.style.background="#d97706"; b.style.color="#fff"; return; }
    if(!courierWorkingNow()){ b.textContent="🔴 Ishda emassiz"; b.style.background="#9ca3af"; b.style.color="#fff"; return; }
    b.textContent="🟢 Online"; b.style.background="#16a34a"; b.style.color="#fff";
  }

  async function fillCourierSettings(){
    await loadCourierState();
    const hv=$("#kHoursView"), lg=$("#kSetLogin");
    if(hv) hv.textContent=courierHoursText();
    if(lg && !lg.value) lg.value=(CUR&&CUR.login)||"";
    try{ if(typeof YZ_SUPPORT!=="undefined"){ var sb=document.getElementById("kurLoginSupport"); if(sb) YZ_SUPPORT.mount(sb,{compact:true,intro:""}); } }catch(e){}
    renderStatusPanel(); renderLeaveArea(); updateStatusBadge();
    /* Profil ma'lumotlarini o'z yozuvidan to'ldiramiz */
    try{
      var me=(typeof STORE!=="undefined"&&STORE.fetchCourierMe)? await STORE.fetchCourierMe():null;
      if(me){ var set=function(id,v){ var el=$(id); if(el && !el.value) el.value=v||""; };
        set("#kProfTransport",me.transport); set("#kProfAddress",me.address);
        set("#kProfEmail",me.email); set("#kProfBirth",me.birthdate); }
    }catch(e){}
  }
  async function saveCourierProfile(){
    var v=function(id){ var el=$(id); return el?el.value.trim():""; };
    var em=v("#kProfEmail"); if(em && window.YZ_EMAIL && !YZ_EMAIL.valid(em)){ toast("Email noto'g'ri formatда"); return; }
    var data={ transport:v("#kProfTransport"), address:v("#kProfAddress"), email:em, birthdate:v("#kProfBirth") };
    var r=(typeof STORE!=="undefined"&&STORE.updateCourierInfo)? await STORE.updateCourierInfo(data):null;
    if(r && !r.error) toast("Profil tahrirlandi — adminда ham ko'rinadi ✓");
    else toast((r&&r.error)||"Serverga ulanib bo'lmadi");
  }

  function renderStatusPanel(){
    const el=$("#kurStatusPanel"); if(!el) return;
    if(kState.onLeave){
      el.innerHTML='<div class="panel-body" style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">'+
        '<span style="font-size:30px">🚪</span>'+
        '<div style="flex:1;min-width:180px"><b style="color:#d97706">Siz ishdan javobdasiz</b>'+
        '<div style="color:var(--grey);font-size:13px;margin-top:2px">Yangi buyurtmalar boshqa kuryerlarga yo\'naltirilmoqda.'+(kState.leaveReason?' Sabab: <b>'+esc(kState.leaveReason)+'</b>':'')+'</div></div></div>';
    } else if(!courierWorkingNow()){
      el.innerHTML='<div class="panel-body" style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">'+
        '<span style="font-size:30px">🌙</span>'+
        '<div style="flex:1;min-width:180px"><b style="color:#9ca3af">Hozir ishda emassiz</b>'+
        '<div style="color:var(--grey);font-size:13px;margin-top:2px">Ish vaqtingiz tashqarisidasiz — buyurtmalar sizga tushmaydi. Admin belgilagan ish vaqti: <b>'+esc(courierHoursText())+'</b> (Toshkent vaqti).</div></div></div>';
    } else {
      el.innerHTML='<div class="panel-body" style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">'+
        '<span style="font-size:30px">🟢</span>'+
        '<div style="flex:1;min-width:180px"><b style="color:#16a34a">Siz ishdasiz</b>'+
        '<div style="color:var(--grey);font-size:13px;margin-top:2px">Buyurtmalar sizga tushmoqda. Ish vaqti: <b>'+esc(courierHoursText())+'</b> (Toshkent vaqti)</div></div></div>';
    }
  }

  function renderLeaveArea(){
    const el=$("#kLeaveArea"); if(!el) return;
    const st=kState.leaveStatus||"none";
    if(kState.onLeave){
      /* Admin tasdiqlagan — javobda; ishga qaytish mumkin */
      el.innerHTML='<div style="background:#ecfdf3;border:1px solid #bbf7d0;border-radius:12px;padding:12px;margin-bottom:10px;color:#15803d;font-size:14px">✅ <b>Ishdan javob olindi</b> — admin so\'rovingizni tasdiqladi.'+(kState.leaveReason?' Sabab: <b>'+esc(kState.leaveReason)+'</b>':'')+'</div>'+
        '<button class="set-save" id="kReturnBtn" style="background:#16a34a">✅ Ishga qaytish</button>';
      const rb=$("#kReturnBtn"); if(rb) rb.addEventListener("click",returnToWork);
    } else if(st==="pending"){
      el.innerHTML='<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:12px;padding:12px;margin-bottom:10px;color:#b45309;font-size:14px">⏳ <b>So\'rov yuborildi</b> — admin javobini kutяпсиз.'+(kState.leaveReason?' Sabab: <b>'+esc(kState.leaveReason)+'</b>':'')+'</div>'+
        '<button class="set-save" id="kLvCancelBtn" style="background:#9ca3af">So\'rovni bekor qilish</button>';
      const cb=$("#kLvCancelBtn"); if(cb) cb.addEventListener("click",cancelLeaveReq);
    } else if(st==="denied"){
      el.innerHTML='<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:12px;padding:12px;margin-bottom:10px;color:#b91c1c;font-size:14px">❌ <b>Ishdan javob olinmadi</b> — admin so\'rovingizni rad etdi. Siz ishда davom etasiz.</div>'+
        '<button class="set-save" id="kLvAckBtn" style="background:#d97706">Tushundim</button>';
      const ab=$("#kLvAckBtn"); if(ab) ab.addEventListener("click",cancelLeaveReq);
    } else {
      el.innerHTML='<button class="set-save" id="kLeaveBtn" style="background:#d97706">🚪 Ishdan javob so\'rash</button>';
      const lb=$("#kLeaveBtn"); if(lb) lb.addEventListener("click",openLeaveModal);
    }
  }

  /* So'rovni bekor qilish / rad javobini tan olish (leave_status -> none) */
  async function cancelLeaveReq(){
    var r=(typeof STORE!=="undefined"&&STORE.courierLeaveCancel)? await STORE.courierLeaveCancel() : null;
    if(r && !r.error){ kState.leaveStatus="none"; kState.leaveReason=""; renderStatusPanel(); renderLeaveArea(); updateStatusBadge(); toast("Bajarildi ✓"); }
    else toast((r&&r.error)||"Serverga ulanib bo'lmadi");
  }

  function openLeaveModal(){
    var el=document.getElementById("kLeaveModal"); if(el) el.remove();
    el=document.createElement("div"); el.id="kLeaveModal";
    el.style.cssText="position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;padding:18px";
    var quick=["Kasal bo'lib qoldim","Shaxsiy sabab","Dam olish","Transport nosozligi"];
    el.innerHTML='<div style="background:#fff;border-radius:20px;max-width:420px;width:100%;padding:22px">'+
      '<h3 style="margin:0 0 6px">Ishdan javob so\'rash</h3>'+
      '<p style="color:var(--grey);font-size:13px;margin:0 0 12px">Sababini yozing — <b>admin tasdig\'iga</b> yuboriladi. Admin tasdiqlasa javobга chiqasiz va buyurtmalaringiz boshqa kuryerга o\'tadi.</p>'+
      '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px">'+quick.map(function(q){return '<button type="button" class="klq" style="border:1px solid var(--line);background:#faf7f8;border-radius:999px;padding:6px 11px;font-size:12px;cursor:pointer">'+q+'</button>';}).join("")+'</div>'+
      '<textarea id="kReason" rows="3" placeholder="Sabab..." style="width:100%;box-sizing:border-box;border:1px solid var(--line);border-radius:12px;padding:10px;font-size:14px;resize:vertical"></textarea>'+
      '<div style="display:flex;gap:10px;margin-top:12px">'+
        '<button id="kLvCancel" style="flex:1;padding:11px;border-radius:12px;border:1px solid var(--line);background:#fff;cursor:pointer">Yopish</button>'+
        '<button id="kLvOk" style="flex:1;padding:11px;border-radius:12px;border:none;background:#d97706;color:#fff;font-weight:700;cursor:pointer">So\'rov yuborish</button>'+
      '</div></div>';
    document.body.appendChild(el);
    var ta=el.querySelector("#kReason");
    el.querySelectorAll(".klq").forEach(function(b){ b.addEventListener("click",function(){ ta.value=b.textContent; }); });
    el.querySelector("#kLvCancel").addEventListener("click",function(){ el.remove(); });
    el.addEventListener("click",function(e){ if(e.target===el) el.remove(); });
    el.querySelector("#kLvOk").addEventListener("click",async function(){
      var reason=ta.value.trim();
      var okBtn=el.querySelector("#kLvOk"); okBtn.disabled=true; okBtn.textContent="Yuborilmoqda...";
      var r=(typeof STORE!=="undefined"&&STORE.courierLeave)? await STORE.courierLeave(reason) : null;
      el.remove();
      if(r && !r.error){ kState.leaveStatus="pending"; kState.leaveReason=reason; renderStatusPanel(); renderLeaveArea(); updateStatusBadge();
        toast("So'rov adminга yuborildi — javobни kuting"); }
      else toast((r&&r.error)||"Serverga ulanib bo'lmadi");
    });
  }

  async function returnToWork(){
    var r=(typeof STORE!=="undefined"&&STORE.courierReturn)? await STORE.courierReturn() : null;
    if(r && !r.error){ kState.onLeave=false; kState.leaveReason=""; renderStatusPanel(); renderLeaveArea(); updateStatusBadge();
      var b=document.querySelector(".tb-badge"); if(b){ b.textContent="● Online"; b.style.color="#16a34a"; }
      toast("Ishga qaytdingiz ✓ — buyurtmalar yana sizga tushadi"); loadOrders(); renderAll(); }
    else toast((r&&r.error)||"Serverga ulanib bo'lmadi");
  }

  /* Ish vaqti, LOGIN va PAROL — FAQAT admin belgilaydi. Kuryer paneldan
     login/parolni o'zgartira OLMAYDI (admin panel «Loginlar» bo'limi). */
  let kToastT; function toast(m){ var e=$("#toast2"); if(!e){ return; } e.textContent=m; e.classList.add("show"); clearTimeout(kToastT); kToastT=setTimeout(function(){ e.classList.remove("show"); },2600); }

  /* Sessiyadan panelni ochish (rol allaqachon tasdiqlangan bo'lishi kerak) */
  function enterFromSession(ses){
    var cc=COURIERS.find(x=>x.login===ses.login);
    /* Admin qo'shgan (lokal massivда yo'q) kuryer uchun minimal panel */
    if(!cc){ cc={ id:Date.now(), name:ses.name||ses.login, login:ses.login, emoji:"🛵", rest:"", deliveries:0, rating:0, fee:(ses.fee||0), phone:ses.phone||"" }; }
    cc.fee=(ses.fee!=null?ses.fee:(cc.fee||0));
    enter(cc);
  }

  document.addEventListener("DOMContentLoaded",()=>{
    /* ===== Sessiya SERVERда tekshiriladi =====
       localStorage'dagi yz_session ga ishonmaymiz — rol /api/auth/me dan keladi.
       Bonus: fee ham serverdan keladi, ya'ni admin uni o'zgartirса qayta
       login qilmasdan yangilanadi. */
    $("#loginWrap").style.display="flex"; $("#app").classList.remove("show");
    if(typeof STORE!=="undefined" && STORE.sessionExpired && STORE.sessionExpired()){
      var le=$("#loginErr"); if(le) le.textContent="Sessiyangiz tugadi — qaytadan kiring.";
    }
    if(typeof STORE!=="undefined" && STORE.verifySession){
      STORE.verifySession().then(v=>{
        if(v.ok && v.account.role==="kuryer"){ enterFromSession(v.account); }
        else if(!v.ok && v.reason==="offline" && v.session && v.session.role==="kuryer"){
          enterFromSession(v.session);   // tarmoq yo'q — keshdagi holat bilan
        }
      }).catch(()=>{});
    }
    $("#loginBtn").addEventListener("click",login);
    $("#klPass").addEventListener("keydown",e=>{ if(e.key==="Enter") login(); });
    $$(".sb-link").forEach(l=>l.addEventListener("click",()=>nav(l.dataset.view)));
    $("#logoutBtn").addEventListener("click",()=>{ if(typeof STORE!=="undefined") STORE.clearSession(); $("#app").classList.remove("show"); $("#loginWrap").style.display="flex"; $("#klPass").value=""; CUR=null; try{location.href="index.html";}catch(e){} });
    /* Sozlamalar tugmalari (ish vaqti tugmasi yo'q — uni admin belgilaydi) */
    var spr=$("#kSaveProfile"); if(spr) spr.addEventListener("click",saveCourierProfile);
    // menuToggle — HTML dagi script boshqaradi (ikki listener bo'lmasin)
  });

  /* ===== Online holati (tepadagi belgi bosilsa modal) ===== */
  /* Ish vaqti kuryerning O'ZINIKI (kState) — sozlamalarda o'zgartiriladi */
  function yzIsWork(){ return courierWorkingNow(); }
  /* Ish vaqti chegarasidan o'tganda panel O'ZI yangilanadi (qayta yuklash shart emas) */
  function yzUpdateOnline(){ updateStatusBadge(); try{ renderStatusPanel(); }catch(e){} }
  function yzOnlineModal(){
    var onLeave=(typeof kState!=="undefined"&&kState&&kState.onLeave), work=!onLeave&&yzIsWork();
    var statusTxt=onLeave?"🚪 Ishdan javobda":(work?"● Online":"● Ishda emassiz");
    var statusColor=onLeave?"#d97706":(work?"#16a34a":"#9ca3af");
    var el=document.getElementById("yzOnlineModal"); if(el) el.remove();
    el=document.createElement("div"); el.id="yzOnlineModal";
    el.style.cssText="position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;padding:18px";
    var row=function(k,v){ return '<div style="display:flex;justify-content:space-between;gap:10px"><span style="color:var(--grey)">'+k+'</span><b>'+v+'</b></div>'; };
    el.innerHTML='<div style="background:#fff;border-radius:20px;max-width:400px;width:100%;padding:22px;position:relative">'+
      '<button id="yzOnClose" style="position:absolute;top:14px;right:14px;border:none;background:#f1f1f4;width:34px;height:34px;border-radius:50%;font-size:16px;cursor:pointer">✕</button>'+
      '<h3 style="margin:0 0 14px">🟢 Holat va ish vaqti</h3>'+
      '<div style="display:flex;flex-direction:column;gap:10px;font-size:14px">'+
      row("Hozirgi holat",'<span style="color:'+statusColor+'">'+statusTxt+'</span>')+
      row("Ish vaqti",esc(courierHoursText()))+
      row("Hozir soat (Toshkent)",YZ_TIME.nowClock())+
      '</div><p style="color:var(--grey);font-size:13px;margin-top:14px">Ish vaqtingizdan tashqarida siz <b>ishda emassiz</b> — yangi buyurtmalar boshqa kuryerga tushadi. Ish vaqtini <b>admin</b> belgilaydi. Vaqt <b>Toshkent (UTC+5)</b> bo\'yicha.</p></div>';
    document.body.appendChild(el);
    el.querySelector("#yzOnClose").addEventListener("click",function(){ el.remove(); });
    el.addEventListener("click",function(e){ if(e.target===el) el.remove(); });
  }
  document.addEventListener("DOMContentLoaded",function(){
    var b=document.querySelector(".tb-badge"); if(b){ b.style.cursor="pointer"; b.addEventListener("click",yzOnlineModal); }
    yzUpdateOnline(); setInterval(yzUpdateOnline,30000);
    /* Muddat sanog'i — har 30 soniyada yangilanadi (server ham parallel tekshiradi) */
    setInterval(function(){ if(!CUR) return; try{ checkDeadlines(); renderOrders(); renderDash(); }catch(e){} },30000);
  });

})();
