/* ===== Yetkaz.uz — Kuryer paneli ===== */
(function(){
  const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
  const money=n=>Math.round(n).toLocaleString("ru-RU");
  const esc=s=>String(s==null?"":s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c])); // XSS himoyasi
  let PER=0; // bitta yetkazish haqi — admin shartnomada belgilaydi (kuryer fee)
  const MONTHS=["Yan","Fev","Mar","Apr","May","Iyun"];

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
  function enter(c){ CUR=c; PER=(c.fee)||0; loadOrders(); todayDone=0; $("#loginWrap").style.display="none"; $("#app").classList.add("show");
    $("#sbName").textContent=c.name; renderAll();
    loadCourierState().then(updateStatusBadge);
    /* Realtime: boshqa rol buyurtma/status o'zgartirsa darhol yangilanadi */
    if(typeof STORE!=="undefined" && STORE.onChange && !window.__kurSub){ window.__kurSub=true;
      STORE.onChange(()=>{ if(CUR){ loadOrders(); renderAll(); } }); }
  }

  function nav(view){
    $$(".sb-link").forEach(l=>l.classList.toggle("active",l.dataset.view===view));
    $$(".view").forEach(v=>v.classList.toggle("show",v.id==="view-"+view));
    const t={dash:"Mening panelim",orders:"Faol buyurtmalar",income:"Daromad",settings:"Sozlamalar"};
    if(view==="settings") fillCourierSettings();
    $("#tbTitle").textContent=t[view]||""; $("#sidebar").classList.remove("open"); window.scrollTo({top:0});
  }

  const STT={new:{t:"Yangi — olib keting",p:"blue",next:"ontheway",btn:"Yo'lga chiqdim"},
             accepted:{t:"Olib keting",p:"blue",next:"ontheway",btn:"Yo'lga chiqdim"},
             ready:{t:"Tayyor — olib keting",p:"blue",next:"ontheway",btn:"Yo'lga chiqdim"},
             ontheway:{t:"Yo'lda",p:"red",next:"arrived",btn:"Yetkazdim ✓"},
             arrived:{t:"Mijoz tasdig'i kutilmoqda",p:"blue",next:null,btn:null},
             done:{t:"Yetkazildi",p:"ok",next:null,btn:null},
             cancelled:{t:"Bekor qilingan",p:"red",next:null,btn:null}};

  /* Daromad davri: kunlik/haftalik/oylik/yillik */
  let kIncomePeriod="oylik";
  function kOrderTime(o){ var raw=String((o&&o.created_at)||""); var m=raw.match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):?(\d{2})?/); return m?Date.UTC(+m[1],+m[2]-1,+m[3],+m[4],+m[5],+(m[6]||0)):0; }
  function kInPeriod(o,p){ var t=kOrderTime(o); if(!t) return p==="oylik"; var d=(Date.now()-t)/86400000; if(p==="kunlik")return d<1; if(p==="haftalik")return d<7; if(p==="yillik")return d<366; return d<31; }
  function renderDash(){
    const c=CUR;
    /* Real: faqat yetkazilgan (done) buyurtmalar hisoblanadi, 0 dan boshlanadi */
    const doneAll=ORDERS.filter(o=>o.status==="done");
    const doneCount=doneAll.length;
    const active=ORDERS.filter(o=>o.status!=="done"&&o.status!=="cancelled").length;
    const periodDone=doneAll.filter(o=>kInPeriod(o,kIncomePeriod));
    const earn=periodDone.length*PER;
    const kpLabel={kunlik:"bugun",haftalik:"haftalik",oylik:"oylik",yillik:"yillik"}[kIncomePeriod];
    const kseg=(k,t)=>`<button class="k-inc-seg" data-kp="${k}" style="border:none;border-radius:8px;padding:4px 10px;font-size:11px;font-weight:700;cursor:pointer;margin:2px 4px 0 0;background:${kIncomePeriod===k?'var(--red,#C8102E)':'#f1eef0'};color:${kIncomePeriod===k?'#fff':'#777'}">${t}</button>`;
    /* Real reyting — mijozlar bergan kuryer baholari o'rtachasi */
    var _rv=(typeof STORE!=="undefined"?STORE.reviews():[]).filter(function(r){ var d=String(r.dish||""); return /^🛵\s*Kuryer:/.test(d) && d.replace(/^🛵\s*Kuryer:\s*/,"")===c.name; });
    const rating=_rv.length?(_rv.reduce(function(s,r){return s+(r.rating||0);},0)/_rv.length).toFixed(1):(c.rating||0);
    $("#statCards").innerHTML=`
      <div class="scard c1"><div class="si">💵</div><b>${money(earn)}</b><span>Daromad (${kpLabel}, so'm)</span>
        <div style="margin-top:8px;display:flex;flex-wrap:wrap">${kseg("kunlik","Kunlik")}${kseg("haftalik","Haftalik")}${kseg("oylik","Oylik")}${kseg("yillik","Yillik")}</div></div>
      <div class="scard c2"><div class="si">📦</div><b>${money(doneCount)}</b><span>Yetkazilgan (jami)</span></div>
      <div class="scard c3"><div class="si">🚀</div><b>${active}</b><span>Faol buyurtma</span></div>
      <div class="scard c4"><div class="si">⭐</div><b>${rating||"—"}</b><span>Reyting</span></div>`;
    $$("#statCards .k-inc-seg").forEach(function(b){ b.addEventListener("click",function(e){ e.stopPropagation(); kIncomePeriod=b.dataset.kp; renderDash(); }); });
    $("#revChart").innerHTML='<p style="color:var(--grey);font-size:13px;padding:16px">Daromad grafigi real yetkazilgan buyurtmalar asosida to\'ladi.</p>';
    $("#restNote").innerHTML=`Bitta yetkazish haqi: <b>${PER?money(PER)+" so'm":"belgilanmagan"}</b> · Yetkazilgan: <b>${doneCount}</b> · Daromad: <b>${money(earn)} so'm</b>`;
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

  function renderOrders(){
    const list=ORDERS;
    $("#ordersBody").innerHTML=list.length? list.map(o=>{
      const s=STT[o.status]||{t:o.status,p:"warn"};
      const right = s.btn
        ? `<button class="set-save" data-adv="${o.id}" style="padding:11px 18px">${s.btn}</button>`
        : `<span class="pill ${s.p}">${s.t}</span>`;
      return `<div class="panel" style="margin-bottom:14px;cursor:pointer" data-oid="${o.id}"><div class="panel-body" style="display:flex;align-items:center;gap:16px;flex-wrap:wrap">
        <span class="av" style="width:48px;height:48px;font-size:24px">${o.emoji}</span>
        <div style="flex:1;min-width:160px">
          <div style="font-weight:700">${esc(o.item)} <span class="pill ${s.p}" style="margin-left:6px">${s.t}</span></div>
          <div style="color:var(--grey);font-size:14px">${esc(o.user)}${o.phone?` · 📞 ${esc(o.phone)}`:""}</div>
          <div style="color:var(--grey);font-size:13px">📍 ${esc(o.addr)} · ${money(o.amount)} so'm</div>
        </div>
        ${right}
      </div></div>`;
    }).join("") : '<div style="color:var(--grey);padding:20px">Hozircha buyurtma yo\'q.</div>';
    $$("#ordersBody button[data-adv]").forEach(b=>b.addEventListener("click",(e)=>{ e.stopPropagation(); advance(+b.dataset.adv); }));
    $$("#ordersBody [data-oid]").forEach(row=>row.addEventListener("click",()=>{ const o=ORDERS.find(x=>x.id==row.dataset.oid); openOrderModal(o); }));
  }

  function advance(id){
    const o=ORDERS.find(x=>x.id==id); if(!o) return;
    const s=STT[o.status]; if(!s || !s.next) return;
    if(typeof STORE!=="undefined") STORE.updateOrder(id,{status:s.next});
    loadOrders(); renderOrders(); renderDash(); renderIncome();
  }

  /* Buyurtma to'liq ma'lumot modali (mobil + desktop) */
  function fmtDateTime(o){
    var raw=(o&&o.created_at)||"";
    var m=raw.match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
    if(m) return m[3]+"."+m[2]+"."+m[1]+" · "+m[4]+":"+m[5];
    if(raw) return raw.slice(0,10).split("-").reverse().join(".");
    return (o&&o.time)||"—";
  }
  function openOrderModal(o){
    if(!o) return;
    const s=STT[o.status]||{t:o.status,p:"warn"};
    let el=document.getElementById("ordModal"); if(el) el.remove();
    el=document.createElement("div"); el.id="ordModal";
    el.style.cssText="position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;padding:18px;backdrop-filter:blur(2px)";
    el.innerHTML=`<div style="background:#fff;border-radius:20px;max-width:420px;width:100%;padding:22px;position:relative;max-height:90vh;overflow:auto">
      <button id="ordModalClose" style="position:absolute;top:14px;right:14px;border:none;background:#f1f1f4;width:34px;height:34px;border-radius:50%;font-size:16px;cursor:pointer">✕</button>
      <div style="text-align:center;font-size:46px">${o.emoji||"🍽️"}</div>
      <h3 style="text-align:center;margin:6px 0 2px">${esc(o.item)}</h3>
      <div style="text-align:center;margin-bottom:14px"><span class="pill ${s.p}">${s.t}</span></div>
      <div style="display:flex;flex-direction:column;gap:10px;font-size:14px">
        <div style="display:flex;justify-content:space-between;gap:10px"><span style="color:var(--grey)">Mijoz</span><b>${esc(o.user)||"-"}</b></div>
        <div style="display:flex;justify-content:space-between;gap:10px"><span style="color:var(--grey)">Telefon</span><b>${o.phone?`<a href="tel:${encodeURIComponent(o.phone)}" style="color:var(--red);text-decoration:none">${esc(o.phone)}</a>`:"-"}</b></div>
        <div style="display:flex;justify-content:space-between;gap:10px"><span style="color:var(--grey)">Manzil</span><b style="text-align:right">${esc(o.addr)||"-"}</b></div>
        <div style="display:flex;justify-content:space-between;gap:10px"><span style="color:var(--grey)">Summa</span><b>${money(o.amount)} so'm</b></div>
        <div style="display:flex;justify-content:space-between;gap:10px"><span style="color:var(--grey)">To'lov</span><b>${o.pay==="cash"?"💵 Naqd":"💳 Karta"}</b></div>
        <div style="display:flex;justify-content:space-between;gap:10px"><span style="color:var(--grey)">Sana / vaqt</span><b>${fmtDateTime(o)}</b></div>
        <div style="display:flex;justify-content:space-between;gap:10px"><span style="color:var(--grey)">Restoran</span><b>${esc(o.rest)||"-"}</b></div>
        ${o.reason?`<div style="display:flex;justify-content:space-between;gap:10px"><span style="color:var(--grey)">Bekor sababi</span><b style="color:#C8102E;text-align:right">${esc(o.reason)}</b></div>`:""}
      </div>
      ${s.btn?`<button class="set-save" id="ordModalAdv" style="width:100%;margin-top:16px;padding:13px">${s.btn}</button>`:""}
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
  }
  /* App ortga: modal ochiq bo'lsa back uni yopadi (sahifadan chiqmaydi) */
  window.addEventListener("popstate",function(){ const m=document.getElementById("ordModal"); if(m){ if(m._closeOnBack) m._closeOnBack(); else m.remove(); } });

  function renderIncome(){
    /* REAL: yetkazilgan (done) buyurtmalar soniga qarab (dashboard bilan bir xil manba) */
    const doneAll=ORDERS.filter(o=>o.status==="done");
    const doneCount=doneAll.length;
    const monthCnt=doneAll.filter(o=>kInPeriod(o,"oylik")).length;
    const weekCnt=doneAll.filter(o=>kInPeriod(o,"haftalik")).length;
    const dayCnt=doneAll.filter(o=>kInPeriod(o,"kunlik")).length;
    const month=monthCnt*PER, week=weekCnt*PER, day=dayCnt*PER;
    $("#incomeBody").innerHTML=`
      <div class="stat-grid">
        <div class="scard c3"><div class="si">📅</div><b>${money(day)}</b><span>Bugun</span></div>
        <div class="scard c2"><div class="si">🗓️</div><b>${money(week)}</b><span>Haftalik</span></div>
        <div class="scard c1"><div class="si">💵</div><b>${money(month)}</b><span>Oylik</span></div>
      </div>
      <div class="panel"><div class="panel-head"><h3>Daromad qanday hisoblanadi</h3></div><div class="panel-body">
        <div class="fin-row"><span>Bitta yetkazish haqi (sayt to'laydi)</span><b>${PER?money(PER)+" so'm":"belgilanmagan"}</b></div>
        <div class="fin-row"><span>Bu oyda yetkazilgan</span><b>${money(monthCnt)} ta</b></div>
        <div class="fin-row"><span>Jami yetkazilgan</span><b>${money(doneCount)} ta</b></div>
        <div class="fin-row tot"><span>Jami oylik daromad</span><b>${money(month)} so'm</b></div>
        <p style="color:var(--grey);font-size:13px;margin-top:10px">Daromad masofaga emas, yetkazilgan buyurtmalar soniga qarab hisoblanadi. To'lovni yetkaz.uz amalga oshiradi.</p>
      </div></div>`;
  }

  /* Kuryerning DOIMIY to'lov QR-kodi (mijoz eshikда skanerlaydi -> to'lovni tasdiqlaydi) */
  let __payQR=null;
  async function renderPayQR(){
    var host=document.getElementById("view-dash"); if(!host) return;
    var box=document.getElementById("kPayQR");
    if(!box){ box=document.createElement("div"); box.id="kPayQR"; box.className="panel"; box.style.marginTop="16px"; host.insertBefore(box, host.firstChild); }
    /* Bir marta yuklaymiz — keyingi render'larда qayta so'ralmaydi */
    if(__payQR){ paintPayQR(box,__payQR); return; }
    box.innerHTML='<div class="panel-head"><h3>💳 To\'lov QR-kodim</h3></div><div class="panel-body" style="text-align:center"><p style="color:var(--grey);font-size:13px">QR yuklanmoqda...</p></div>';
    var r=(typeof STORE!=="undefined"&&STORE.fetchMyPayQR)? await STORE.fetchMyPayQR():null;
    if(r && (r.qr||r.url)){ __payQR=r; paintPayQR(box,r); }
    else box.innerHTML='<div class="panel-head"><h3>💳 To\'lov QR-kodim</h3></div><div class="panel-body"><p style="color:var(--grey);font-size:13px">QR yuklab bo\'lmadi — internetни tekshiring.</p></div>';
  }
  function paintPayQR(box,r){
    box.innerHTML='<div class="panel-head"><h3>💳 To\'lov QR-kodim</h3></div><div class="panel-body" style="text-align:center">'+
      '<p style="color:var(--grey);font-size:13px;margin-bottom:12px">Mijoz eshigingizда to\'lovni shu QR orqali tasdiqlaydi.</p>'+
      (r.qr?'<img src="'+r.qr+'" alt="To\'lov QR" style="width:220px;height:220px;max-width:80%;border-radius:12px;border:1px solid var(--line)">':'')+
      '<p style="font-size:12px;color:var(--grey);margin-top:10px;word-break:break-all">'+esc(r.url||"")+'</p>'+
      '</div>';
  }

  function renderAll(){ renderDash(); renderOrders(); renderIncome(); updateStatusBadge(); renderPayQR(); }

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

  /* Kuryer hozir O'Z ish vaqti ichidami */
  function courierWorkingNow(){ const h=new Date().getHours(); const o=kState.openH!=null?kState.openH:8, c=kState.closeH!=null?kState.closeH:22; return h>=o && h<c; }
  function updateStatusBadge(){
    const b=document.querySelector(".tb-badge"); if(!b) return;
    if(kState.onLeave){ b.textContent="🚪 Ishdan javobda"; b.style.background="#d97706"; b.style.color="#fff"; return; }
    if(!courierWorkingNow()){ b.textContent="🔴 Ishda emassiz"; b.style.background="#9ca3af"; b.style.color="#fff"; return; }
    b.textContent="🟢 Online"; b.style.background="#16a34a"; b.style.color="#fff";
  }

  async function fillCourierSettings(){
    await loadCourierState();
    const hv=$("#kHoursView"), lg=$("#kSetLogin");
    const pad=n=>String(n).padStart(2,"0");
    if(hv) hv.textContent=pad(kState.openH)+":00 – "+pad(kState.closeH)+":00";
    if(lg && !lg.value) lg.value=(CUR&&CUR.login)||"";
    renderStatusPanel(); renderLeaveArea(); updateStatusBadge();
    /* Profil ma'lumotlarini o'z yozuvidan to'ldiramiz */
    try{
      var me=(typeof STORE!=="undefined"&&STORE.fetchCourierMe)? await STORE.fetchCourierMe():null;
      if(me){ var set=function(id,v){ var el=$(id); if(el && !el.value) el.value=v||""; };
        set("#kProfTransport",me.transport); set("#kProfPlate",me.plate); set("#kProfAddress",me.address);
        set("#kProfEmail",me.email); set("#kProfBirth",me.birthdate); }
    }catch(e){}
  }
  async function saveCourierProfile(){
    var v=function(id){ var el=$(id); return el?el.value.trim():""; };
    var em=v("#kProfEmail"); if(em && window.YZ_EMAIL && !YZ_EMAIL.valid(em)){ toast("Email noto'g'ri formatда"); return; }
    var data={ transport:v("#kProfTransport"), plate:v("#kProfPlate"), address:v("#kProfAddress"), email:em, birthdate:v("#kProfBirth") };
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
        '<div style="color:var(--grey);font-size:13px;margin-top:2px">Ish vaqtingiz tashqarisidasiz — buyurtmalar sizga tushmaydi. Admin belgilagan ish vaqti: <b>'+String(kState.openH).padStart(2,"0")+':00–'+String(kState.closeH).padStart(2,"0")+':00</b>.</div></div></div>';
    } else {
      el.innerHTML='<div class="panel-body" style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">'+
        '<span style="font-size:30px">🟢</span>'+
        '<div style="flex:1;min-width:180px"><b style="color:#16a34a">Siz ishdasiz</b>'+
        '<div style="color:var(--grey);font-size:13px;margin-top:2px">Buyurtmalar sizga tushmoqda. Ish vaqti: <b>'+String(kState.openH).padStart(2,"0")+':00–'+String(kState.closeH).padStart(2,"0")+':00</b></div></div></div>';
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

  /* Ish vaqti FAQAT admin tomonidan belgilanadi — kuryer o'zgartira olmaydi. */
  async function saveCourierLogin(){
    var v=(($("#kSetLogin")||{}).value||"").trim();
    if(v.length<3){ toast("Login kamida 3 belgi bo'lsin"); return; }
    var acc=(typeof STORE!=="undefined"&&STORE.updateProfile)? await STORE.updateProfile({login:v}) : null;
    if(acc && !acc.error && acc.login){ if(CUR) CUR.login=acc.login; toast("Login yangilandi ✓"); }
    else toast((acc&&acc.error)||"Bu login band yoki serverga ulanib bo'lmadi");
  }
  async function saveCourierPass(){
    var a=(($("#kSetPass")||{}).value||""), b=(($("#kSetPass2")||{}).value||"");
    if(a.length<4){ toast("Parol kamida 4 belgi bo'lsin"); return; }
    if(a!==b){ toast("Parollar mos kelmadi"); return; }
    var acc=(typeof STORE!=="undefined"&&STORE.updateProfile)? await STORE.updateProfile({pass:a}) : null;
    if(acc && !acc.error){ var p1=$("#kSetPass"),p2=$("#kSetPass2"); if(p1)p1.value=""; if(p2)p2.value=""; toast("Parol yangilandi ✓"); }
    else toast((acc&&acc.error)||"Serverga ulanib bo'lmadi");
  }
  let kToastT; function toast(m){ var e=$("#toast2"); if(!e){ return; } e.textContent=m; e.classList.add("show"); clearTimeout(kToastT); kToastT=setTimeout(function(){ e.classList.remove("show"); },2600); }

  document.addEventListener("DOMContentLoaded",()=>{
    var ses=(typeof STORE!=="undefined")?STORE.session():null;
    if(ses && ses.role==="kuryer"){
      var cc=COURIERS.find(x=>x.login===ses.login);
      /* Admin qo'shgan (lokal massivда yo'q) kuryer uchun minimal panel */
      if(!cc){ cc={ id:Date.now(), name:ses.name||ses.login, login:ses.login, emoji:"🛵", rest:"", deliveries:0, rating:0, fee:(ses.fee||0), phone:ses.phone||"" }; }
      cc.fee=(ses.fee!=null?ses.fee:(cc.fee||0));
      enter(cc);
    } else {
      /* Sessiya yo'q — saytga sakramasdan panelning O'Z login ekranini ko'rsatamiz
         (app sifatida ochilganda to'g'ridan-to'g'ri login/parol so'raydi) */
      $("#loginWrap").style.display="flex"; $("#app").classList.remove("show");
    }
    $("#loginBtn").addEventListener("click",login);
    $("#klPass").addEventListener("keydown",e=>{ if(e.key==="Enter") login(); });
    $$(".sb-link").forEach(l=>l.addEventListener("click",()=>nav(l.dataset.view)));
    $("#logoutBtn").addEventListener("click",()=>{ if(typeof STORE!=="undefined") STORE.clearSession(); $("#app").classList.remove("show"); $("#loginWrap").style.display="flex"; $("#klPass").value=""; CUR=null; try{location.href="index.html";}catch(e){} });
    /* Sozlamalar tugmalari (ish vaqti tugmasi yo'q — uni admin belgilaydi) */
    var spr=$("#kSaveProfile"); if(spr) spr.addEventListener("click",saveCourierProfile);
    var sl=$("#kSaveLogin"); if(sl) sl.addEventListener("click",saveCourierLogin);
    var sp=$("#kSavePass"); if(sp) sp.addEventListener("click",saveCourierPass);
    // menuToggle — HTML dagi script boshqaradi (ikki listener bo'lmasin)
  });

  /* ===== Online holati (tepadagi belgi bosilsa modal) ===== */
  /* Ish vaqti kuryerning O'ZINIKI (kState) — sozlamalarda o'zgartiriladi */
  function kOpenH(){ return (typeof kState!=="undefined"&&kState&&kState.openH!=null)?kState.openH:8; }
  function kCloseH(){ return (typeof kState!=="undefined"&&kState&&kState.closeH!=null)?kState.closeH:22; }
  function yzIsWork(){ var h=new Date().getHours(); return h>=kOpenH() && h<kCloseH(); }
  function yzUpdateOnline(){ updateStatusBadge(); }
  function yzOnlineModal(){
    var onLeave=(typeof kState!=="undefined"&&kState&&kState.onLeave), work=!onLeave&&yzIsWork();
    var pad=function(n){return String(n).padStart(2,"0");};
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
      row("Ish vaqti",pad(kOpenH())+":00 – "+pad(kCloseH())+":00")+
      row("Hozir soat",new Date().toLocaleTimeString("ru-RU",{hour:"2-digit",minute:"2-digit"}))+
      '</div><p style="color:var(--grey);font-size:13px;margin-top:14px">Ish vaqtingizdan tashqarida (soat '+pad(kCloseH())+':00 dan keyin) siz <b>ishda emassiz</b> — buyurtmalar boshqa kuryerga tushadi. Ish vaqtini <b>admin</b> belgilaydi.</p></div>';
    document.body.appendChild(el);
    el.querySelector("#yzOnClose").addEventListener("click",function(){ el.remove(); });
    el.addEventListener("click",function(e){ if(e.target===el) el.remove(); });
  }
  document.addEventListener("DOMContentLoaded",function(){ var b=document.querySelector(".tb-badge"); if(b){ b.style.cursor="pointer"; b.addEventListener("click",yzOnlineModal); } yzUpdateOnline(); setInterval(yzUpdateOnline,60000); });

})();
