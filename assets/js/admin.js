/* ===== Yetkaz.uz — Admin panel (to'liq) ===== */
(function(){
  const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
  const money=n=>Math.round(n).toLocaleString("ru-RU");
  /* Summa formati — KICHIK summa ham ko'rinsin (avval hammasi "0,0 mln" edi):
       >= 1 mln -> "2,5 mln" | >= 1000 -> "8 ming" | aks holda -> "500 so'm" */
  const mln=n=>{ n=Math.round(Number(n)||0);
    if(n>=1e6) return (n/1e6).toFixed(1).replace(".",",")+" mln";
    if(n>=1e3) return Math.round(n/1e3)+" ming";
    return n+" so'm"; };
  /* XSS himoyasi — ta'rif assets/js/safe.js da (YAGONA manba, `'` ni ham escape
     qiladi). Bu yerда faqat qisqartma. Yangi kod uchun: html`...` teg shabloni. */
  const esc=YZ_SAFE.esc, html=YZ_SAFE.html, raw=YZ_SAFE.raw;
  /* ---- Kirish tekshiruvlari — soxta/chala ma'lumotni rad etadi ---- */
  const vName=s=>{ s=String(s||"").trim(); return s.length>=2 && /[A-Za-zА-Яа-яЎўҚқҒғҲҳ]/.test(s); };
  const vLogin=s=>/^[A-Za-z0-9_]{3,}$/.test(String(s||"").trim());
  const vPass=s=>String(s||"").length>=4;
  /* Pasport/ID: AB1234567 (2 harf + 7 raqam) yoki 14 xonali PINFL */
  const vPassport=s=>{ s=String(s||"").trim().toUpperCase(); return /^[A-Z]{2}\d{7}$/.test(s) || /^\d{14}$/.test(s); };

  /* =========================================================
     STORAGE — barcha ma'lumotlar localStorage da
     ========================================================= */
  const SK = {
    rests:    "yz_admin_rests_v2",
    couriers: "yz_admin_couriers_v2",
    pending:  "yz_admin_pending",   // o'chirish kutayotganlar
  };
  function load(k,def){ try{ const v=localStorage.getItem(k); return v?JSON.parse(v):def; }catch(e){ return def; } }
  function save(k,v){ try{ localStorage.setItem(k,JSON.stringify(v)); }catch(e){} }

  /* Standart ma'lumotlar (birinchi yuklashda) */
  /* Parollar bu yerda saqlanmaydi — backendda xeshlangan holda turadi */

  /* Ma'lumotlarni yuklash */
  /* ===== Restoran/kuryer ro'yxati — HAR DOIM backenddan =====
     Ilgari bu ro'yxatlar localStorage keshidan (yz_admin_rests_v2) yuklanardi.
     Backend'да o'chirilgan yoki nomi o'zgargan restoran kesh eskirganда
     "Restoranlar" bo'limида ARVOH bo'lib turaverardi — masalan "Loginlar"да
     yo'q, "Restoranlar"да bor holati. Endi bo'sh boshlaymiz: ro'yxat FAQAT
     syncEntitiesFromBackend() orqali backenddan quriladi (bir zumdан keyin).
     Eski keshni ham tozalaymiz. */
  let RESTS    = [];
  let COURIERS = [];
  try { localStorage.removeItem(SK.rests); } catch(e) {}
  try { localStorage.removeItem(SK.couriers); } catch(e) {}

  /* Pending o'chirishlar — ESKI mexanizm (endi ishlatilmaydi).
     O'chirish DARHOL bajariladi (cancelRest/dismissCourier). Eski, hali
     bajarilmagan pending yozuvlari qolgan bo'lsa — tozalaymiz, aks holda
     restoran/kuryer yonида abadiy "⏳ o'chiriladi" yozuvi osilib qolardi. */
  let PENDING = [];
  try { localStorage.removeItem(SK.pending); } catch(e) {}

  /* Pending ni tekshirish va o'chirish */
  function checkPending(){
    const now = Date.now();
    let changed = false;
    PENDING = PENDING.filter(p=>{
      if(now >= p.deleteAt){
        if(p.type==="rest"){
          const r=RESTS.find(x=>x.id===p.id);
          if(r && typeof STORE!=="undefined" && STORE.deleteRestaurant) STORE.deleteRestaurant(r.login);
          RESTS = RESTS.filter(r=>r.id!==p.id);
          save(SK.rests, RESTS);
        } else if(p.type==="courier"){
          const c=COURIERS.find(x=>x.id===p.id);
          if(c && typeof STORE!=="undefined" && STORE.deleteCourier) STORE.deleteCourier(c.login);
          COURIERS = COURIERS.filter(c=>c.id!==p.id);
          save(SK.couriers, COURIERS);
        }
        changed = true;
        return false; // listdan chiqar
      }
      return true;
    });
    if(changed){ save(SK.pending,PENDING); renderAll(); }
  }

  const USERS=[];

  /* ===== YAGONA MOLIYA HISOBI (restoran / kuryer kartasi) =====
     Komissiya HAR BUYURTMAGA muhrlanadi (server: o.commission), kuryer haqi ham
     (o.courierFee). Shuning uchun BARCHA joyда (recompute ham, sync ham) AYNAN
     shu yig'indi ishlatiladi — admin edit qilgandan keyin ham karta noto'g'ri
     foiz ko'rsatmaydi (ilgari `rev * yangi_foiz` butun tarixga qo'llanardi). */
  function restFinance(b, orders){
    const done=(orders||[]).filter(o=>o.rest===b.name && o.status==="done");
    const rev=done.reduce((s,o)=>s+(Number(o.amount)||0),0);
    const fb=(b.commission!=null?b.commission:18);
    const siteCut=done.reduce((s,o)=>s+(o.commission!=null?(Number(o.commission)||0):Math.round((Number(o.amount)||0)*fb/100)),0);
    return { rev:rev, orders:done.length, siteCut:siteCut, restGets:rev-siteCut };
  }
  function courierFinance(b, orders){
    const done=(orders||[]).filter(o=>o.courier===b.name && o.status==="done");
    const earn=done.reduce((s,o)=>s+(o.courierFee!=null?(Number(o.courierFee)||0):(Number(b.fee)||0)),0);
    return { deliveries:done.length, earn:earn };
  }

  /* Kesh ustidan qayta hisob (admin edit qilgandan keyin darrov, backend
     javobини kutmasdan). Aniq qiymatlar — HAQIQIY buyurtmalardan, sync bilan
     bir xil usulда. */
  function recompute(){
    const orders=(typeof STORE!=="undefined" && STORE.orders && STORE.orders())||[];
    RESTS.forEach(r=>{
      const f=restFinance(r, orders);
      r.rev=f.rev; r.orders=f.orders; r.siteCut=f.siteCut; r.restGets=f.restGets;
    });
    COURIERS.forEach(c=>{
      /* earned backenddan kelgan bo'lsa — o'shani saqlaymiz (server = manba) */
      if(c.earned!=null){ c.earn=c.earned; return; }
      const f=courierFinance(c, orders);
      c.deliveries=(c.deliveries!=null?c.deliveries:f.deliveries);
      c.earn=f.earn;
    });
  }

  /* =========================================================
     BACKEND SYNC — BACKEND = YAGONA MANBA.
     MUHIM: ilgari bu funksiya localStorage keshini backend bilan BIRLASHTIRARDI
     (login bo'yicha map). Natijada eski sessiyada qolib ketgan yoki o'chirilgan
     restoran/kuryerlar "arvoh" bo'lib ro'yxatda turaverardi — backendда yo'q,
     login qila olmaydi, lekin ko'rinardi. Yangi kuryer qo'shsangiz o'sha
     arvohlar yonida chiqib, "qo'shilmadi/dublikat" degan tasavvur berardi.

     Endi ro'yxat FAQAT backenddan quriladi: backendда bo'lmagan yozuv
     KO'RSATILMAYDI. localStorage faqat offline ko'rsatish uchun (backend
     javob bermasa oxirgi holat qoladi). */
  function syncEntitiesFromBackend(){
    try{
      if(typeof STORE==="undefined") return;
      const orders=(STORE.orders&&STORE.orders())||[];
      const flags=(STORE.loaded&&STORE.loaded())||{};

      /* ---- RESTORANLAR: manba = ADMIN endpoint (komissiya bilan) ----
         Sayt komissiyasi ommaviy bootstrap'дан olib tashlangan (mijozga
         ko'rinmasin). Admin panel komissiyani /admin/restaurants dan oladi.
         Admin ro'yxati hali yuklanmagan bo'lsa — vaqtincha bootstrap'дан
         (komissiyasiz) quramiz, komissiya yuklangач to'g'rilanadi. */
      const adminR=(STORE.adminRestaurants&&STORE.adminRestaurants())||[];
      const beR=(adminR.length||flags.adminRests)?adminR:((STORE.restaurants&&STORE.restaurants())||[]);
      /* Ro'yxat backenddан kelgan bo'lsagina qayta quramiz. Umuman yuklanmagan
         (STORE hali tayyor emas) va bizda eski kesh bor bo'lsa — wipe qilmaymiz. */
      if(beR.length || flags.adminRests || flags.bootstrap){
        RESTS=beR.map(b=>{
          /* Aylanma/komissiya FAQAT yetkazilgan buyurtmalardan, har buyurtmaning
             O'Z muhrlangan foizidan (restFinance — recompute bilan bir xil). */
          const comm=b.commission!=null?b.commission:18;
          const f=restFinance(b, orders);
          return Object.assign({}, b, { rev:f.rev, orders:f.orders, commission:comm, siteCut:f.siteCut, restGets:f.restGets, status:(b.active===false?"warn":"ok") });
        });
        save(SK.rests,RESTS);
      }

      /* ---- KURYERLAR: fetchCouriers (STORE.couriers) = manba ---- */
      const beC=(STORE.couriers&&STORE.couriers())||[];
      /* fetchCouriers hech bo'lmasa BIR MARTA yuklangan bo'lsa — backend manba.
         Yuklanmaган bo'lsa eski keshni saqlab turamiz (bo'sh ko'rsatib
         yubormaslik uchun). Flag'ni fetchCouriers o'rnatadi. */
      if(beC.length || flags.couriers){
        COURIERS=beC.map(b=>{
          /* Yetkazishlar soni va to'langan haq — HAQIQIY buyurtmalardan
             (server: routes/misc.js:courierDone). Backend `earned`/`deliveries`
             bergan bo'lsa — O'SHA manba; aks holda buyurtma keshidan (courierFinance). */
          const f=courierFinance(b, orders);
          const deliveries=(b.deliveries!=null?b.deliveries:f.deliveries);
          const earn=(b.earned!=null)?b.earned:f.earn;
          return Object.assign({}, b, { deliveries:deliveries, earn:earn, status:"ok" });
        });
        save(SK.couriers,COURIERS);
      }
    }catch(e){}
  }

  /* =========================================================
     CONFIRM MODAL (universal)
     ========================================================= */
  function confirmModal(opts){
    // opts: { icon, title, desc, confirmLabel, confirmClass, onConfirm }
    let el = document.getElementById("confirmOverlay");
    if(el) el.remove();
    el = document.createElement("div");
    el.id = "confirmOverlay";
    el.className = "confirm-overlay";
    el.innerHTML = `
      <div class="confirm-card">
        <div class="confirm-icon">${opts.icon||"⚠️"}</div>
        <h3 class="confirm-title">${opts.title}</h3>
        <p class="confirm-desc">${opts.desc}</p>
        <div class="confirm-actions">
          <button class="confirm-cancel" id="confirmCancel">Bekor qilish</button>
          <button class="confirm-ok ${opts.confirmClass||"confirm-danger"}" id="confirmOk">${opts.confirmLabel||"Ha, bajarish"}</button>
        </div>
      </div>`;
    document.body.appendChild(el);
    setTimeout(()=>el.classList.add("open"),10);
    const close=()=>{ el.classList.remove("open"); setTimeout(()=>el.remove(),300); };
    el.querySelector("#confirmCancel").addEventListener("click",close);
    el.addEventListener("click",(e)=>{ if(e.target===el) close(); });
    el.querySelector("#confirmOk").addEventListener("click",()=>{ close(); opts.onConfirm && opts.onConfirm(); });
  }

  /* =========================================================
     PENDING BADGE — necha soat qolganini ko'rsatish
     ========================================================= */
  function formatCountdown(ms){
    if(ms<=0) return "O'chirilmoqda...";
    const h=Math.floor(ms/3600000), m=Math.floor((ms%3600000)/60000);
    if(h>0) return h+"s "+m+"d qoldi";
    return m+"d qoldi";
  }
  function getPending(id,type){ return PENDING.find(p=>p.id===id&&p.type===type)||null; }

  /* =========================================================
     LOGIN / NAV
     ========================================================= */
  /* Panelni ochish / login ekraniga qaytish — bitta joyda */
  function enterAdmin(){
    $("#loginWrap").style.display="none"; $("#app").classList.add("show"); renderAll();
    /* Kirgan zahoti restoranlar (komissiya bilan) va kuryerlarни backenddan
       olamiz — panel darrov to'liq va to'g'ri raqamlar bilan chiqsin. */
    try{ if(STORE.fetchAdminRestaurants) STORE.fetchAdminRestaurants().then(function(){ try{ syncEntitiesFromBackend(); renderRests(); renderDash(); renderIncome(); }catch(e){} }); }catch(e){}
    try{ if(STORE.fetchCouriers) STORE.fetchCouriers().then(function(){ try{ syncEntitiesFromBackend(); renderCouriers(); }catch(e){} }); }catch(e){}
  }
  function showLogin(){ $("#loginWrap").style.display="flex"; $("#app").classList.remove("show"); }

  async function login(){
    const u=$("#alUser").value.trim(), p=$("#alPass").value.trim();
    $("#loginErr").textContent="";
    const acc=(typeof STORE!=="undefined")? await STORE.login(u,p):null;
    if(acc && acc.offline){ $("#loginErr").textContent="Serverga ulanib bo'lmadi. Saytni server orqali oching (masalan http://localhost:5050) va internetni tekshiring."; return; }
    if(acc && acc.role==="admin"){ enterAdmin(); }
    else if(acc && acc.target){ try{ location.href=acc.target; }catch(e){} }
    else { $("#loginErr").textContent="Login yoki parol xato."; }
  }

  function nav(view){
    $$(".sb-link").forEach(l=>l.classList.toggle("active",l.dataset.view===view));
    $$(".view").forEach(v=>v.classList.toggle("show",v.id==="view-"+view));
    const titles={dash:"Dashboard",rest:"Restoranlar",courier:"Kuryerlar",income:"Daromad",user:"Foydalanuvchilar",
                  logins:"Loginlar",suspicious:"Shubhali buyurtmalar",comments:"Izohlar",complaints:"Shikoyatlar",
                  blocked:"Bloklangan raqamlar",settings:"Sozlamalar"};
    $("#tbTitle").textContent=titles[view]||"";
    $("#sidebar").classList.remove("open");
    window.scrollTo({top:0});
    if(view==="income") renderIncome();
    if(view==="blocked") loadBlocked();
    if(view==="suspicious") renderSuspicious();
    if(view==="comments") renderComments();
    if(view==="complaints") loadComplaints();
    if(view==="logins"){
      /* Qidiruvni tozalab kiramiz — aks holda oldingi filtr "hech narsa yo'q"
         ko'rsatib turishi mumkin edi (foydalanuvchi buni "yuklanmadi" deb tushunardi). */
      loginQuery=""; var lsEl=document.getElementById("loginSearch"); if(lsEl) lsEl.value="";
      loadAccounts();
    }
    if(view==="settings"){ fillOwnerSettings(); renderAnnList(); }
    // Mobile cards render
    setTimeout(()=>{ renderMobileCards(); },50);
  }

  /* =========================================================
     LOGINLAR — barcha akkaunt: har biri ALOHIDA KARTA.
     Har kartadan LOGIN va PAROLNI o'zgartirish mumkin — FAQAT ADMIN.
     Restoran/kuryer/mijoz panellaridan bu imkoniyat OLIB TASHLANDI
     (server /api/auth/me endi login/parolni qabul qilmaydi).
     ========================================================= */
  let ACCOUNTS=[], loginQuery="", accountsLoaded=false, accountsLoading=false;
  const ROLE_INFO={
    admin:{t:"🛡 Adminlar",label:"Admin",c:"#7c3aed"},
    restoran:{t:"🏪 Restoranlar",label:"Restoran",c:"#C8102E"},
    kuryer:{t:"🛵 Kuryerlar",label:"Kuryer",c:"#2563eb"},
    user:{t:"👥 Foydalanuvchilar",label:"Mijoz",c:"#16a34a"}
  };
  /* Ishonchli yuklash: qayta-qayta kirilса ham ishlaydi. Xato bo'lsa OXIRGI
     ma'lumot saqlanadi (ro'yxat bo'shab qolmaydi). */
  async function loadAccounts(){
    if(typeof STORE==="undefined" || !STORE.fetchAccounts){ renderLogins(); return; }
    accountsLoading=true;
    renderLogins();                                   // joriy holat (yoki "Yuklanmoqda")
    let list=null;
    try{ list=await STORE.fetchAccounts(); }catch(e){ /* eski ACCOUNTS qoladi */ }
    accountsLoading=false;
    if(Array.isArray(list) && (list.length || !accountsLoaded)){
      ACCOUNTS=list; accountsLoaded=true;
    }
    /* Bo'sh javob + allaqachon yuklangan — eski ro'yxat saqlanadi (tarmoq uzilса ekran bo'shab qolmasin) */
    renderLogins();
  }
  function acctCard(a){
    const info=ROLE_INFO[a.role]||{label:a.role,c:"#777"};
    return '<div class="lg-card" data-login="'+esc(a.login)+'" style="border:1px solid var(--line);border-radius:14px;padding:14px;margin-bottom:12px;background:#fff">'+
      '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px">'+
        '<span style="background:'+info.c+';color:#fff;font-size:11px;font-weight:800;border-radius:8px;padding:3px 9px">'+esc(info.label)+'</span>'+
        '<b style="font-size:15px">'+esc(a.name||"—")+'</b>'+
        (a.phone?'<span style="color:var(--grey);font-size:13px">📞 '+esc(a.phone)+'</span>':'')+
      '</div>'+
      '<div class="lg-row" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px">'+
        '<span style="color:var(--grey);font-size:13px;min-width:60px">Login</span>'+
        '<b class="mono" style="font-size:14px">'+esc(a.login)+'</b>'+
        '<button class="lg-edit-login add-action-btn" style="background:#0ea5e9;flex:none;font-size:12px;padding:6px 10px">✏️ Login</button>'+
      '</div>'+
      '<div class="lg-row" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">'+
        '<span style="color:var(--grey);font-size:13px;min-width:60px">Parol</span>'+
        '<span class="mono" style="font-size:14px;letter-spacing:2px">••••••</span>'+
        '<button class="lg-edit-pass add-action-btn" style="background:#2563eb;flex:none;font-size:12px;padding:6px 10px">🔑 Parol</button>'+
      '</div>'+
    '</div>';
  }
  function renderLogins(){
    const host=$("#loginsList"); if(!host) return;
    if(!accountsLoaded && accountsLoading && !ACCOUNTS.length){
      host.innerHTML='<p style="color:#9a8d83;padding:16px">Yuklanmoqda...</p>'; return;
    }
    const q=loginQuery.trim().toLowerCase();
    let list=ACCOUNTS.slice();
    if(q) list=list.filter(a=>[a.login,a.name,a.phone].some(v=>String(v||"").toLowerCase().indexOf(q)>=0));
    if(!list.length){
      host.innerHTML='<p style="color:#9a8d83;text-align:center;padding:24px;font-size:14px">'+
        (q?"Mos akkaunt topilmadi.":(accountsLoaded?"Akkaunt yo'q.":"Yuklanmoqda..."))+'</p>';
      return;
    }
    const order=["admin","restoran","kuryer","user"];
    let html="";
    order.forEach(function(role){
      const rows=list.filter(a=>a.role===role);
      if(!rows.length) return;
      const info=ROLE_INFO[role]||{t:role,c:"#777"};
      html+='<div style="margin:14px 0 8px;font-weight:800;color:'+info.c+';font-size:14px">'+info.t+
            ' <span style="color:var(--grey);font-weight:600">('+rows.length+')</span></div>';
      html+=rows.map(acctCard).join("");
    });
    host.innerHTML=html;
    host.querySelectorAll(".lg-card").forEach(function(card){
      const login=card.dataset.login;
      const acc=ACCOUNTS.find(a=>a.login===login);
      const be=card.querySelector(".lg-edit-login"), bp=card.querySelector(".lg-edit-pass");
      if(be) be.addEventListener("click",function(){ openAccountEdit(acc, "login"); });
      if(bp) bp.addEventListener("click",function(){ openAccountEdit(acc, "pass"); });
    });
  }
  /* Login YOKI parolni o'zgartirish oynasi (bitta modal, ikki maydon).
     `focus` — qaysi maydonga birinchi e'tibor beriladi ("login" | "pass"). */
  function openAccountEdit(acc, focus){
    if(!acc) return;
    const info=ROLE_INFO[acc.role]||{label:acc.role};
    var el=document.getElementById("acctEditModal"); if(el) el.remove();
    el=document.createElement("div"); el.id="acctEditModal";
    el.style.cssText="position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;padding:18px";
    el.innerHTML='<div style="background:#fff;border-radius:20px;max-width:440px;width:100%;padding:22px;max-height:92vh;overflow:auto">'+
      '<h3 style="margin:0 0 6px">🔐 Kirish ma\'lumotlari</h3>'+
      '<p style="color:var(--grey);font-size:13px;margin:0 0 14px"><b>'+esc(acc.name||acc.login)+'</b> · '+esc(info.label||acc.role)+
        ' · joriy login: <b class="mono">'+esc(acc.login)+'</b></p>'+
      '<div class="add-field"><label>Yangi login (bo\'sh — o\'zgarmaydi)</label>'+
        '<input id="aeLogin" type="text" value="'+esc(acc.login)+'" autocomplete="off" spellcheck="false"></div>'+
      '<div class="add-field"><label>Yangi parol (bo\'sh — o\'zgarmaydi; kamida 4 belgi)</label>'+
        '<input id="aePass" type="text" placeholder="Masalan: Osh#2026" autocomplete="new-password"></div>'+
      '<div id="aeErr" style="color:#C8102E;font-size:13px;min-height:16px;margin:2px 0 8px"></div>'+
      '<div style="display:flex;gap:10px">'+
        '<button id="aeCancel" style="flex:1;padding:11px;border-radius:12px;border:1px solid var(--line);background:#fff;cursor:pointer">Yopish</button>'+
        '<button id="aeOk" style="flex:1;padding:11px;border-radius:12px;border:none;background:#2563eb;color:#fff;font-weight:700;cursor:pointer">Saqlash</button>'+
      '</div></div>';
    document.body.appendChild(el);
    const li=el.querySelector("#aeLogin"), pi=el.querySelector("#aePass"), err=el.querySelector("#aeErr");
    (focus==="pass"?pi:li).focus();
    const close=()=>el.remove();
    el.querySelector("#aeCancel").addEventListener("click",close);
    el.addEventListener("click",function(e){ if(e.target===el) close(); });
    el.querySelector("#aeOk").addEventListener("click",async function(){
      err.textContent="";
      const newLogin=li.value.trim(), pass=pi.value.trim();
      const loginChanged = newLogin && newLogin!==acc.login;
      if(!loginChanged && !pass){ err.textContent="Hech narsa o'zgartirilmadi."; return; }
      if(loginChanged && newLogin.length<3){ err.textContent="Login kamida 3 belgi bo'lsin."; return; }
      if(pass && pass.length<4){ err.textContent="Parol kamida 4 belgi bo'lsin."; return; }
      this.disabled=true; this.textContent="Saqlanmoqda...";
      const r=(typeof STORE!=="undefined"&&STORE.updateAccount)
        ? await STORE.updateAccount(acc.login, { newLogin: loginChanged?newLogin:undefined, pass: pass||undefined })
        : { error:"Serverga ulanib bo'lmadi" };
      if(r && r.error){ this.disabled=false; this.textContent="Saqlash"; err.textContent=r.error; return; }
      close();
      /* Ro'yxatni yangilaymiz (yangi login ko'rinsin) */
      await loadAccounts();
      if(r && r.pass){ toast("✅ Saqlandi"); showNewPassOnce(acc.name||newLogin||acc.login, r.pass); }
      else toast("✅ "+(loginChanged?"Login yangilandi":"Saqlandi"));
    });
  }

  /* =========================================================
     SHUBHALI BUYURTMALAR (status = 'review')
     Server (server/src/order-rules.js) juda katta yoki g'ayrioddiy buyurtmani
     restoranga YUBORMAYDI — u shu yerga tushadi. Admin tasdiqlasa restoranga,
     so'ng kuryerga boradi; rad etsa — bekor qilinadi va mijoz sababini ko'radi.
     ========================================================= */
  function suspiciousList(){
    try{ return (typeof STORE!=="undefined" && STORE.suspiciousOrders) ? STORE.suspiciousOrders() : []; }
    catch(e){ return []; }
  }
  /* Yon menyudagi qizil hisoblagich — admin yangi tekshiruvni o'tkazib yubormasin */
  function updateSuspBadge(){
    const b=document.getElementById("suspBadge"); if(!b) return;
    const n=suspiciousList().length;
    b.textContent=n; b.hidden = n===0;
  }
  function renderSuspicious(){
    const rules=$("#suspRules");
    if(rules){
      rules.innerHTML=
        '<div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:12px;padding:10px 12px;margin-bottom:12px;color:#c2410c;font-size:13px;font-weight:700">'+
          '🤖 Buni <b>sayt o\'zi</b> aniqlaydi. Bunday buyurtma restoranga ham, kuryerga ham <b>ko\'rinmaydi</b> — '+
          'siz tasdiqlaganingizdan keyingina ishga tushadi.'+
        '</div>'+
        '<div style="display:flex;flex-direction:column;gap:6px">'+
        '<div style="padding-left:4px">📦 <b>20 donadan ko\'p</b> mahsulot buyurtma qilingan bo\'lsa</div>'+
        '<div style="padding-left:4px">💰 Summa <b>3 000 000 so\'mdan</b> oshsa</div>'+
        '<div style="padding-left:4px">🍽️ <b>30 xildan ko\'p</b> turli taom tanlangan bo\'lsa</div>'+
        '<div style="color:#16a34a;margin-top:6px">✅ Tasdiqlasangiz — buyurtma restoranga tushadi va kuryer biriktiriladi.</div>'+
        '<div style="color:var(--grey);margin-top:8px;font-size:13px">Eslatma: <b>faqat hajmi katta</b> buyurtma shu yerga tushadi. '+
          'Oddiy (kichik) buyurtma to\'g\'ridan restoranga boradi — adminga <b>tushmaydi</b>. Ketma-ket spam esa '+
          'avtomatik bloklanadi («Bloklangan raqamlar» bo\'limi).</div>'+
        '</div>';
    }
    const host=$("#suspList"); if(!host) return;
    const list=suspiciousList();
    const cnt=$("#suspCount"); if(cnt) cnt.textContent=list.length+" ta";
    updateSuspBadge();
    if(!list.length){
      host.innerHTML='<p style="color:#9a8d83;text-align:center;padding:24px;font-size:14px">Tekshirishni kutayotgan buyurtma yo\'q. 👍</p>';
      return;
    }
    host.innerHTML=list.map(function(o){
      var items=""; try{ items=YZ_ITEMS.notesHtml(o,{title:"Mijoz izohi"})+YZ_ITEMS.listHtml(o,{maxHeight:220}); }catch(e){}
      var qty=0; try{ qty=YZ_ITEMS.qty(o); }catch(e){}
      return '<div style="border:2px solid #fed7aa;border-radius:16px;padding:14px;margin-bottom:14px;background:#fffdfa">'+
        '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px">'+
          '<b style="font-size:16px">#'+o.id+' · '+esc(o.item)+'</b>'+
          '<span class="pill warn">🔎 Tekshiruvda</span>'+srcBadge(o)+
        '</div>'+
        (o.suspiciousReason
          ? '<div style="background:#fef2f2;color:#b91c1c;border-radius:10px;padding:8px 11px;font-size:13px;font-weight:700;margin-bottom:10px">⚠️ Sabab: '+esc(o.suspiciousReason)+'</div>'
          : "")+
        '<div style="display:flex;flex-wrap:wrap;gap:14px;font-size:13px;color:var(--grey);margin-bottom:6px">'+
          '<span>👤 <b style="color:var(--ink,#222)">'+esc(o.user||"—")+'</b></span>'+
          (o.phone?'<span>📞 <a href="tel:'+encodeURIComponent(o.phone)+'" style="color:var(--red);font-weight:700;text-decoration:none">'+esc(o.phone)+'</a></span>':"")+
          '<span>🏪 <b style="color:var(--ink,#222)">'+esc(o.rest||"—")+'</b></span>'+
          '<span>📦 <b style="color:var(--ink,#222)">'+qty+' dona</b></span>'+
          '<span>💰 <b style="color:var(--red)">'+money(o.amount)+' so\'m</b></span>'+
        '</div>'+
        '<div style="font-size:13px;color:var(--grey);margin-bottom:4px">📍 '+esc(o.addr||"—")+'</div>'+
        '<div style="font-size:12px;color:var(--grey)">🕐 '+esc(fmtDateTime(o))+'</div>'+
        items+
        '<div style="display:flex;gap:9px;flex-wrap:wrap;margin-top:12px">'+
          '<button class="add-action-btn" data-appr="'+o.id+'" style="background:#16a34a">✅ Tasdiqlash — restoranga yuborish</button>'+
          '<button class="add-action-btn" data-rej="'+o.id+'" style="background:#C8102E">❌ Rad etish</button>'+
          (o.phone?'<a href="tel:'+encodeURIComponent(o.phone)+'" class="add-action-btn" style="background:#2563eb;text-decoration:none;display:inline-block">📞 Mijozga qo\'ng\'iroq</a>':"")+
        '</div></div>';
    }).join("");

    $$("#suspList [data-appr]").forEach(function(btn){
      btn.addEventListener("click",async function(){
        btn.disabled=true; btn.textContent="Tasdiqlanmoqda...";
        const r=await STORE.approveOrder(btn.dataset.appr);
        if(r && !r.error){ toast("✅ Buyurtma tasdiqlandi — restoranga yuborildi"); }
        else { toast((r&&r.error)||"Xatolik"); }
        renderSuspicious(); renderLiveOrders();
      });
    });
    $$("#suspList [data-rej]").forEach(function(btn){
      btn.addEventListener("click",function(){ askRejectReason(btn.dataset.rej); });
    });
  }

  /* Rad etish — sabab so'raladi va mijozga yuboriladi */
  function askRejectReason(id){
    var el=document.getElementById("suspRejModal"); if(el) el.remove();
    el=document.createElement("div"); el.id="suspRejModal";
    el.style.cssText="position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;padding:18px";
    var quick=["Soxta buyurtma","Mijoz telefonda tasdiqlamadi","Restoran bunchalik tayyorlay olmaydi","Manzil noaniq"];
    el.innerHTML='<div style="background:#fff;border-radius:20px;max-width:420px;width:100%;padding:22px">'+
      '<h3 style="margin:0 0 6px">Buyurtmani rad etish</h3>'+
      '<p style="color:var(--grey);font-size:13px;margin:0 0 12px">Sababini yozing — u mijozga ko\'rsatiladi.</p>'+
      '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px">'+quick.map(function(q){return '<button type="button" class="srq" style="border:1px solid var(--line);background:#faf7f8;border-radius:999px;padding:6px 11px;font-size:12px;cursor:pointer">'+q+'</button>';}).join("")+'</div>'+
      '<textarea id="srReason" rows="3" placeholder="Rad etish sababi..." style="width:100%;box-sizing:border-box;border:1px solid var(--line);border-radius:12px;padding:10px;font-size:14px;resize:vertical;font-family:inherit"></textarea>'+
      '<div style="display:flex;gap:10px;margin-top:12px">'+
        '<button id="srCancel" style="flex:1;padding:11px;border-radius:12px;border:1px solid var(--line);background:#fff;cursor:pointer">Yopish</button>'+
        '<button id="srOk" style="flex:1;padding:11px;border-radius:12px;border:none;background:#C8102E;color:#fff;font-weight:700;cursor:pointer">Rad etish</button>'+
      '</div></div>';
    document.body.appendChild(el);
    var ta=el.querySelector("#srReason");
    el.querySelectorAll(".srq").forEach(function(b){ b.addEventListener("click",function(){ ta.value=b.textContent; ta.style.borderColor="var(--line)"; }); });
    el.querySelector("#srCancel").addEventListener("click",function(){ el.remove(); });
    el.addEventListener("click",function(e){ if(e.target===el) el.remove(); });
    el.querySelector("#srOk").addEventListener("click",async function(){
      var reason=ta.value.trim(); if(!reason){ ta.style.borderColor="#C8102E"; return; }
      this.disabled=true;
      const r=await STORE.rejectOrder(id, reason);
      el.remove();
      if(r && !r.error) toast("Buyurtma rad etildi — sabab mijozga yuborildi");
      else toast((r&&r.error)||"Xatolik");
      renderSuspicious(); renderLiveOrders();
    });
  }

  /* =========================================================
     IZOHLAR — admin nazorati (o'chirish + egasiga javob yozish)
     ========================================================= */
  let cmtFilter="all", cmtQuery="";   // 'all' | 'positive' | 'negative'
  function allComments(){ try{ return (typeof STORE!=="undefined")?STORE.reviews().slice():[]; }catch(e){ return []; } }
  /* Ijobiy = 4–5 yulduz, Salbiy = 1–3 yulduz */
  function isPositive(r){ return (r.rating||0)>=4; }
  function commentsList(){
    let rv=allComments();
    if(cmtFilter==="positive") rv=rv.filter(isPositive);
    else if(cmtFilter==="negative") rv=rv.filter(r=>!isPositive(r));
    const q=cmtQuery.trim().toLowerCase();
    if(q) rv=rv.filter(r=>[r.name,r.dish,r.text,r.reply].some(v=>String(v||"").toLowerCase().indexOf(q)>=0));
    return rv;
  }
  function renderCmtTabs(){
    var host=document.getElementById("cmtTabs"); if(!host) return;
    var all=allComments();
    var pos=all.filter(isPositive).length, neg=all.length-pos;
    var seg=function(k,label,n,col){ return '<button class="ctab" data-ctab="'+k+'" style="border:none;border-radius:10px;padding:8px 14px;font-size:13px;font-weight:700;cursor:pointer;background:'+(cmtFilter===k?(col||'var(--red,#C8102E)'):'#f1eef0')+';color:'+(cmtFilter===k?'#fff':'#777')+'">'+label+' <span style="opacity:.85">'+n+'</span></button>'; };
    host.innerHTML=seg("all","Hammasi",all.length)+seg("positive","😊 Ijobiy",pos,"#16a34a")+seg("negative","😞 Salbiy",neg,"#C8102E");
    host.querySelectorAll(".ctab").forEach(function(b){ b.addEventListener("click",function(){ cmtFilter=b.dataset.ctab; renderComments(); }); });
  }
  function renderComments(){
    const host=$("#cmtList"); if(!host) return;
    renderCmtTabs();
    const rv=commentsList();
    const cnt=$("#cmtCount"); if(cnt) cnt.textContent=rv.length+" ta";
    if(!rv.length){
      host.innerHTML='<p style="color:#9a8d83;text-align:center;padding:24px;font-size:14px">'+
        (cmtQuery||cmtOnlyBad?"Bu shartga mos izoh topilmadi.":"Hali izoh yozilmagan.")+'</p>';
      return;
    }
    host.innerHTML=rv.map(function(r){
      const rr=Math.max(0,Math.min(5,r.rating|0));
      /* Kuryer reytinglari saytda ko'rinmaydi — bu yerда ajratib ko'rsatamiz */
      const isCour=/^🛵\s*Kuryer:/.test(String(r.dish||""));
      return '<div style="padding:14px 0;border-bottom:1px solid var(--line)" data-cmt="'+esc(String(r.id||""))+'">'+
        '<div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;align-items:center">'+
          '<b>'+(r.ava||"👤")+' '+esc(r.name)+'</b>'+
          '<span class="star">'+"★".repeat(rr)+"☆".repeat(5-rr)+'</span>'+
        '</div>'+
        '<div style="color:var(--grey);font-size:12px;margin-top:2px">'+
          (isCour?'🛵 ':'🍽️ ')+esc(r.dish||"—")+(r.rest?' · 🏪 '+esc(r.rest):"")+(r.date?' · '+esc(r.date):"")+
          (r.flagged?' <span class="pill red">signal</span>':"")+
        '</div>'+
        '<div style="font-size:14px;margin-top:6px">'+esc(r.text||"—")+'</div>'+
        (r.reply
          ? '<div style="background:#ecfdf3;border-left:3px solid #16a34a;border-radius:8px;padding:8px 11px;margin-top:8px;font-size:13px">'+
              '<b style="color:#15803d">↩ Yetkaz javobi:</b> '+esc(r.reply)+'</div>'
          : "")+
        '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:9px">'+
          '<button class="add-action-btn" data-reply="'+esc(String(r.id||""))+'" style="background:#2563eb">'+(r.reply?"✏️ Javobni tahrirlash":"↩ Javob yozish")+'</button>'+
          (r.reply?'<button class="add-action-btn" data-unreply="'+esc(String(r.id||""))+'" style="background:#9ca3af">Javobni olib tashlash</button>':"")+
          '<button class="add-action-btn" data-delcmt="'+esc(String(r.id||""))+'" style="background:#C8102E">🗑 O\'chirish</button>'+
        '</div></div>';
    }).join("");

    $$("#cmtList [data-reply]").forEach(function(b){
      b.addEventListener("click",function(){
        const r=rv.find(x=>String(x.id)===b.dataset.reply);
        openReplyModal(r);
      });
    });
    $$("#cmtList [data-unreply]").forEach(function(b){
      b.addEventListener("click",async function(){
        b.disabled=true;
        const res=await STORE.replyReview(b.dataset.unreply,"");
        if(res && res.error) toast(res.error); else toast("Javob olib tashlandi");
        renderComments();
      });
    });
    $$("#cmtList [data-delcmt]").forEach(function(b){
      b.addEventListener("click",function(){
        confirmModal({
          icon:"🗑", title:"Izohni o'chirish",
          desc:"Bu izoh saytdan butunlay o'chiriladi. Buni ortga qaytarib bo'lmaydi.",
          confirmLabel:"Ha, o'chirish",
          onConfirm:async function(){
            const res=await STORE.deleteReview(b.dataset.delcmt);
            if(res && res.error) toast(res.error); else toast("Izoh o'chirildi ✓");
            renderComments(); renderAdminReviews();
          }
        });
      });
    });
  }
  function openReplyModal(r){
    if(!r) return;
    var el=document.getElementById("cmtReplyModal"); if(el) el.remove();
    el=document.createElement("div"); el.id="cmtReplyModal";
    el.style.cssText="position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;padding:18px";
    el.innerHTML='<div style="background:#fff;border-radius:20px;max-width:440px;width:100%;padding:22px;max-height:90vh;overflow:auto">'+
      '<h3 style="margin:0 0 6px">↩ Izohga javob</h3>'+
      '<p style="color:var(--grey);font-size:13px;margin:0 0 10px">Javobingiz saytda izoh ostida <b>«Yetkaz javobi»</b> bo\'lib ko\'rinadi.</p>'+
      '<div style="background:#faf7f8;border-radius:12px;padding:10px 12px;font-size:13px;margin-bottom:12px">'+
        '<b>'+(r.ava||"👤")+' '+esc(r.name)+'</b><div style="margin-top:4px">'+esc(r.text||"—")+'</div></div>'+
      '<textarea id="cmtReplyText" rows="4" placeholder="Hurmatli mijoz, ..." style="width:100%;box-sizing:border-box;border:1px solid var(--line);border-radius:12px;padding:10px;font-size:14px;resize:vertical;font-family:inherit"></textarea>'+
      '<div style="display:flex;gap:10px;margin-top:12px">'+
        '<button id="cmtRepCancel" style="flex:1;padding:11px;border-radius:12px;border:1px solid var(--line);background:#fff;cursor:pointer">Yopish</button>'+
        '<button id="cmtRepOk" style="flex:1;padding:11px;border-radius:12px;border:none;background:#16a34a;color:#fff;font-weight:700;cursor:pointer">Javobni joylash</button>'+
      '</div></div>';
    document.body.appendChild(el);
    var ta=el.querySelector("#cmtReplyText"); ta.value=r.reply||""; ta.focus();
    el.querySelector("#cmtRepCancel").addEventListener("click",function(){ el.remove(); });
    el.addEventListener("click",function(e){ if(e.target===el) el.remove(); });
    el.querySelector("#cmtRepOk").addEventListener("click",async function(){
      var v=ta.value.trim(); if(!v){ ta.style.borderColor="#C8102E"; return; }
      this.disabled=true;
      const res=await STORE.replyReview(r.id, v);
      el.remove();
      if(res && res.error) toast(res.error); else toast("Javob joylandi ✓ — saytda ko'rinadi");
      renderComments();
    });
  }

  /* =========================================================
     BLOKLANGAN RAQAMLAR
     Mijoz buyurtmani ketma-ket bekor qilsa, sayt uni avval ogohlantiradi
     (5 daqiqaga cheklaydi), uchinchisida esa raqamni BLOKLAYDI. Bloklangan
     raqam faqat SHU yerдан ochiladi.
     ========================================================= */
  let BLOCKED=[], BLOCK_RULES={pauseMin:5,warnAt:2,blockAt:3,spamMax:6,spamWindowMin:10};

  async function loadBlocked(){
    if(typeof STORE==="undefined" || !STORE.fetchBlocked) return;
    const host=$("#blockedList"); if(host && !BLOCKED.length) host.innerHTML='<p style="color:#9a8d83;padding:16px">Yuklanmoqda...</p>';
    const r=await STORE.fetchBlocked();
    BLOCKED=(r&&r.list)||[]; BLOCK_RULES=(r&&r.rules)||BLOCK_RULES;
    renderBlocked();
  }

  function renderBlocked(){
    const R=BLOCK_RULES||{};
    const rules=$("#blockRules");
    if(rules){
      rules.innerHTML=
        '<div style="background:#ecfdf3;border:1px solid #bbf7d0;border-radius:12px;padding:10px 12px;margin-bottom:12px;color:#15803d;font-size:13px;font-weight:700">'+
          '🤖 Bu qoidalarni <b>sayt o\'zi avtomatik</b> qo\'llaydi — sizdan hech qanday amal talab qilinmaydi. '+
          'Siz faqat natijani ko\'rasiz va kerak bo\'lsa blokni ochasiz.'+
        '</div>'+
        '<div style="display:flex;flex-direction:column;gap:6px">'+
        '<div style="font-weight:800;color:var(--ink,#222)">1-qoida — buyurtmani bekor qilish</div>'+
        '<div style="padding-left:12px">1️⃣ <b>Birinchi</b> — faqat qayd etiladi.</div>'+
        '<div style="padding-left:12px">2️⃣ <b>Ikkinchi</b> — mijoz ogohlantiriladi va <b>'+(R.pauseMin||5)+' daqiqaga</b> buyurtma berish cheklanadi.</div>'+
        '<div style="padding-left:12px">3️⃣ <b>Uchinchi</b> — raqam <b>avtomatik bloklanadi</b> va shu ro\'yxatga tushadi.</div>'+
        '<div style="font-weight:800;margin-top:8px;color:var(--ink,#222)">2-qoida — spam buyurtma</div>'+
        '<div style="padding-left:12px">🚨 <b>'+(R.spamWindowMin||10)+' daqiqada '+(R.spamMax||6)+' ta</b> buyurtma yuborilsa — raqam <b>darhol avtomatik bloklanadi</b>.</div>'+
        '<div style="color:#16a34a;margin-top:8px">✅ Buyurtma muvaffaqiyatli yakunlansa — bekor qilish hisobi nolga qaytadi.</div>'+
        '</div>';
    }
    const host=$("#blockedList"); if(!host) return;
    if(!BLOCKED.length){
      host.innerHTML='<p style="color:#9a8d83;text-align:center;padding:24px;font-size:14px">Bloklangan yoki ogohlantirilgan raqam yo\'q. 👍</p>';
      return;
    }
    host.innerHTML=BLOCKED.map(function(b){
      const pill=b.blocked
        ? '<span class="pill red">⛔ Bloklangan</span>'
        : (b.pausedSeconds>0
            ? '<span class="pill warn">⏳ '+Math.ceil(b.pausedSeconds/60)+' daq. cheklangan</span>'
            : '<span class="pill blue">'+b.cancels+' marta bekor qilgan</span>');
      /* Blokni kim qo'ygan: sayt o'zi (avtomatik) yoki admin qo'lда */
      const src=b.blocked
        ? (b.source==="admin"
            ? '<span style="font-size:11px;font-weight:800;color:#6b7280;background:#f3f4f6;border-radius:8px;padding:3px 8px">👤 Admin bloklagan</span>'
            : '<span style="font-size:11px;font-weight:800;color:#15803d;background:#ecfdf3;border-radius:8px;padding:3px 8px">🤖 Sayt avtomatik bloklagan</span>')
        : "";
      return '<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:12px 0;border-bottom:1px solid var(--line)">'+
        '<div style="flex:1;min-width:180px">'+
          '<div style="font-weight:800;font-size:15px">📞 '+esc(b.pretty||b.phone)+'</div>'+
          '<div style="color:var(--grey);font-size:13px">'+(b.name?esc(b.name)+' · ':'')+
            'Bekor qilishlar: <b>'+b.cancels+'</b>'+(b.lastCancel?' · oxirgisi: '+esc(String(b.lastCancel).slice(0,16)):'')+'</div>'+
          (b.reason?'<div style="color:#C8102E;font-size:12px;margin-top:2px">'+esc(b.reason)+'</div>':'')+
          (src?'<div style="margin-top:5px">'+src+'</div>':'')+
        '</div>'+
        pill+
        (b.blocked
          ? '<button class="add-action-btn" data-unblock="'+esc(b.phone)+'" style="background:#16a34a">✅ Blokni ochish</button>'
          : '<button class="add-action-btn" data-block="'+esc(b.phone)+'" style="background:#C8102E">⛔ Bloklash</button>')+
        '<button class="add-action-btn" data-forget="'+esc(b.phone)+'" style="background:#9ca3af">🗑 O\'chirish</button>'+
        '</div>';
    }).join("");

    $$("#blockedList [data-unblock]").forEach(function(btn){
      btn.addEventListener("click",async function(){
        btn.disabled=true;
        const r=await STORE.unblockPhone(btn.dataset.unblock);
        if(r && !r.error){ BLOCKED=r.list||[]; renderBlocked(); toast("Blok ochildi ✓"); }
        else { btn.disabled=false; toast((r&&r.error)||"Xatolik"); }
      });
    });
    $$("#blockedList [data-block]").forEach(function(btn){
      btn.addEventListener("click",async function(){
        btn.disabled=true;
        const r=await STORE.blockPhone(btn.dataset.block,"Admin tomonidan bloklandi");
        if(r && !r.error){ BLOCKED=r.list||[]; renderBlocked(); toast("Raqam bloklandi"); }
        else { btn.disabled=false; toast((r&&r.error)||"Xatolik"); }
      });
    });
    $$("#blockedList [data-forget]").forEach(function(btn){
      btn.addEventListener("click",async function(){
        btn.disabled=true;
        const r=await STORE.forgetPhone(btn.dataset.forget);
        if(r && !r.error){ BLOCKED=r.list||[]; renderBlocked(); toast("Ro'yxatdan o'chirildi"); }
        else { btn.disabled=false; toast((r&&r.error)||"Xatolik"); }
      });
    });
  }


  /* =========================================================
     SHIKOYATLAR — restoran/kuryerdan adminga
     ========================================================= */
  let COMPLAINTS=[], compFilter="new";   // 'new' | 'all' | 'closed'
  const COMP_TOPIC={mijoz:"👤 Mijoz",kuryer:"🛵 Kuryer",restoran:"🏪 Restoran",tolov:"💳 To'lov",texnik:"🔧 Texnik",boshqa:"📌 Boshqa"};
  async function loadComplaints(){
    if(typeof STORE==="undefined" || !STORE.fetchComplaints) return;
    const list=await STORE.fetchComplaints();
    COMPLAINTS=Array.isArray(list)?list:[];
    updateCompBadge(); renderComplaints();
  }
  function updateCompBadge(){
    const b=document.getElementById("compBadge"); if(!b) return;
    const n=COMPLAINTS.filter(c=>c.status==="new").length;
    b.textContent=n; b.hidden=n===0;
  }
  function renderCompFilters(){
    const host=$("#compFilters"); if(!host) return;
    const nNew=COMPLAINTS.filter(c=>c.status==="new").length;
    const nClosed=COMPLAINTS.filter(c=>c.status==="closed").length;
    const seg=(k,label,n)=>'<button class="compf" data-cf="'+k+'" style="border:none;border-radius:10px;padding:8px 14px;font-size:13px;font-weight:700;cursor:pointer;margin-right:6px;background:'+(compFilter===k?'var(--red,#C8102E)':'#f1eef0')+';color:'+(compFilter===k?'#fff':'#777')+'">'+label+' <span style="opacity:.85">'+n+'</span></button>';
    host.innerHTML=seg("new","🔴 Yangi",nNew)+seg("all","Hammasi",COMPLAINTS.length)+seg("closed","✅ Yopilgan",nClosed);
    host.querySelectorAll(".compf").forEach(b=>b.addEventListener("click",()=>{ compFilter=b.dataset.cf; renderComplaints(); }));
  }
  function renderComplaints(){
    renderCompFilters();
    const host=$("#compList"); if(!host) return;
    let list=COMPLAINTS.slice();
    if(compFilter==="new") list=list.filter(c=>c.status!=="closed");
    else if(compFilter==="closed") list=list.filter(c=>c.status==="closed");
    const cnt=$("#compCount"); if(cnt) cnt.textContent=list.length+" ta";
    if(!list.length){ host.innerHTML='<p style="color:#9a8d83;text-align:center;padding:24px;font-size:14px">Shikoyat yo\'q. 👍</p>'; return; }
    host.innerHTML=list.map(function(c){
      const roleBadge=c.role==="kuryer"?'<span class="pill blue">🛵 Kuryer</span>':'<span class="pill ok">🏪 Restoran</span>';
      const stPill=c.status==="closed"?'<span class="pill ok">✅ Yopilgan</span>':(c.status==="seen"?'<span class="pill warn">👁 Ko\'rilgan</span>':'<span class="pill red">🔴 Yangi</span>');
      return '<div style="border:1px solid var(--line);border-radius:14px;padding:14px;margin-bottom:12px"'+(c.status==="new"?' style="border-color:#fecaca"':'')+'>'+
        '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px">'+
          '<b>'+esc(c.name||c.login)+'</b>'+roleBadge+'<span class="pill warn">'+(COMP_TOPIC[c.topic]||c.topic)+'</span>'+stPill+
          (c.orderId?'<span style="color:var(--grey);font-size:12px">buyurtma #'+c.orderId+'</span>':'')+
        '</div>'+
        '<div style="font-size:14px;margin:6px 0;white-space:pre-wrap">'+esc(c.text)+'</div>'+
        '<div style="color:var(--grey);font-size:12px">'+esc(fmtDateTime(c))+'</div>'+
        (c.reply?'<div style="background:#eff6ff;border-left:3px solid #2563eb;border-radius:8px;padding:8px 11px;margin-top:8px;font-size:13px"><b style="color:#1d4ed8">↩ Sizning javobingiz:</b> '+esc(c.reply)+'</div>':'')+
        '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">'+
          '<button class="add-action-btn" data-creply="'+c.id+'" style="background:#2563eb">'+(c.reply?"✏️ Javobni tahrirlash":"↩ Javob yozish")+'</button>'+
          (c.status!=="closed"?'<button class="add-action-btn" data-cclose="'+c.id+'" style="background:#16a34a">✅ Yopish</button>':'<button class="add-action-btn" data-copen="'+c.id+'" style="background:#d97706">↺ Qayta ochish</button>')+
          '<button class="add-action-btn" data-cdel="'+c.id+'" style="background:#9ca3af">🗑 O\'chirish</button>'+
        '</div></div>';
    }).join("");
    $$("#compList [data-creply]").forEach(b=>b.addEventListener("click",()=>openCompReply(COMPLAINTS.find(x=>x.id==b.dataset.creply))));
    $$("#compList [data-cclose]").forEach(b=>b.addEventListener("click",async()=>{ await STORE.setComplaintStatus(b.dataset.cclose,"closed"); loadComplaints(); toast("Shikoyat yopildi ✓"); }));
    $$("#compList [data-copen]").forEach(b=>b.addEventListener("click",async()=>{ await STORE.setComplaintStatus(b.dataset.copen,"seen"); loadComplaints(); }));
    $$("#compList [data-cdel]").forEach(b=>b.addEventListener("click",()=>{
      confirmModal({icon:"🗑",title:"Shikoyatni o'chirish",desc:"Bu shikoyat butunlay o'chiriladi.",confirmLabel:"Ha, o'chirish",onConfirm:async()=>{ await STORE.deleteComplaint(b.dataset.cdel); loadComplaints(); toast("O'chirildi"); }});
    }));
  }
  function openCompReply(c){
    if(!c) return;
    var el=document.getElementById("compReplyModal"); if(el) el.remove();
    el=document.createElement("div"); el.id="compReplyModal";
    el.style.cssText="position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;padding:18px";
    el.innerHTML='<div style="background:#fff;border-radius:20px;max-width:440px;width:100%;padding:22px;max-height:90vh;overflow:auto">'+
      '<h3 style="margin:0 0 6px">↩ Shikoyatga javob</h3>'+
      '<div style="background:#faf7f8;border-radius:12px;padding:10px 12px;font-size:13px;margin-bottom:12px"><b>'+esc(c.name||c.login)+' ('+(c.role==="kuryer"?"kuryer":"restoran")+')</b><div style="margin-top:4px;white-space:pre-wrap">'+esc(c.text)+'</div></div>'+
      '<textarea id="compReplyText" rows="4" placeholder="Javobingiz..." style="width:100%;box-sizing:border-box;border:1px solid var(--line);border-radius:12px;padding:10px;font-size:14px;resize:vertical;font-family:inherit"></textarea>'+
      '<div style="display:flex;gap:10px;margin-top:12px">'+
        '<button id="compRepCancel" style="flex:1;padding:11px;border-radius:12px;border:1px solid var(--line);background:#fff;cursor:pointer">Yopish</button>'+
        '<button id="compRepOk" style="flex:1;padding:11px;border-radius:12px;border:none;background:#2563eb;color:#fff;font-weight:700;cursor:pointer">Javobni yuborish</button>'+
      '</div></div>';
    document.body.appendChild(el);
    var ta=el.querySelector("#compReplyText"); ta.value=c.reply||""; ta.focus();
    el.querySelector("#compRepCancel").addEventListener("click",()=>el.remove());
    el.addEventListener("click",e=>{ if(e.target===el) el.remove(); });
    el.querySelector("#compRepOk").addEventListener("click",async function(){
      var v=ta.value.trim(); if(!v){ ta.style.borderColor="#C8102E"; return; }
      this.disabled=true;
      const r=await STORE.replyComplaint(c.id, v);
      el.remove();
      if(r && !r.error) toast("Javob yuborildi ✓"); else toast((r&&r.error)||"Xatolik");
      loadComplaints();
    });
  }

  /* =========================================================
     DASHBOARD
     ========================================================= */
  /* Buyurtma QAYERDAN kelgan — Telegram mini ilovasidanmi yoki saytdanmi.
     Server `source` maydonini yozadi (server/src/orders-core.js). */
  function srcBadge(x){
    var tg=(x&&x.source)==="telegram";
    return '<span class="pill '+(tg?"blue":"ok")+'" title="'+(tg?"Telegram bot orqali":"Sayt orqali")+'">'
      +(tg?"🤖 Telegram":"🌐 Sayt")+'</span>';
  }

  const OSM={review:["🔎 Tekshiruvda (siz tasdiqlashingiz kerak)","warn"],new:["Yangi","warn"],accepted:["Tayyorlanmoqda","warn"],ready:["Tayyor","blue"],ontheway:["Yo'lda","blue"],arrived:["Yetkazildi (tasdiq)","blue"],done:["Yetkazildi","ok"],cancelled:["Bekor qilingan","red"]};
  /* "Bu buyurtmada mijoz izohi bor" belgisi — ro'yxatdan ham ko'rinsin */
  function noteFlag(x){ try{ return YZ_ITEMS.noteFlag(x); }catch(e){ return ""; } }
  function renderLiveOrders(){
    const o=(typeof STORE!=="undefined")?STORE.orders():[];
    // Desktop jadval
    const tb=$("#liveOrders"); if(tb){
      tb.innerHTML=o.length?o.slice(0,50).map(function(x){
        const s=OSM[x.status]||["?","warn"];
        return `<tr style="cursor:pointer" data-oid="${x.id}"><td>${esc(x.user)}</td><td>${esc(x.rest)}</td><td>${x.emoji} ${esc(x.item)} ${noteFlag(x)}</td><td class="money">${money(x.amount)}</td><td>${esc(x.courier)}</td><td>${srcBadge(x)}</td><td><span class="pill ${s[1]}">${s[0]}</span></td></tr>`;
      }).join("") : `<tr><td colspan="7" style="color:var(--grey);padding:18px">Buyurtma yo'q.</td></tr>`;
      $$("#liveOrders [data-oid]").forEach(function(row){ row.addEventListener("click",function(){ openOrderModal(o.find(function(t){return t.id==row.dataset.oid;})); }); });
    }
    // Mobile kartalar
    const mc=$("#liveOrderCards"); if(mc){
      if(!o.length){ mc.innerHTML=`<div class="lo-empty">Hozircha buyurtma yo'q</div>`; return; }
      mc.innerHTML=o.slice(0,50).map(function(x){
        const s=OSM[x.status]||["?","warn"];
        return `<div class="lo-card" style="cursor:pointer" data-oid="${x.id}">
          <div class="lo-top"><div class="lo-left"><div class="lo-emoji">${x.emoji}</div><div><div class="lo-item">${esc(x.item)} ${noteFlag(x)}</div><div class="lo-rest">${esc(x.rest)}</div></div></div><span class="pill ${s[1]}">${s[0]}</span></div>
          <div class="lo-row"><span class="lo-key">Mijoz</span><span class="lo-val">${esc(x.user)}</span></div>
          <div class="lo-row"><span class="lo-key">Kuryer</span><span class="lo-val">${esc(x.courier)}</span></div>
          <div class="lo-row"><span class="lo-key">Qayerdan</span><span class="lo-val">${srcBadge(x)}</span></div>
          <div class="lo-row lo-price"><span class="lo-key">Summa</span><span class="lo-val money">${money(x.amount)} so'm</span></div>
        </div>`;
      }).join("");
      $$("#liveOrderCards [data-oid]").forEach(function(row){ row.addEventListener("click",function(){ openOrderModal(o.find(function(t){return t.id==row.dataset.oid;})); }); });
    }
  }
  /* admin.html ичидаги davriy yangilagich shu to'liq versiyani chaqiradi (dublikat/klobber bo'lmasin) */
  window._adminRenderLiveOrders = renderLiveOrders;
  function omr(k,v){ return "<div style=\"display:flex;justify-content:space-between;gap:10px\"><span style=\"color:var(--grey)\">"+k+"</span><b style=\"text-align:right\">"+v+"</b></div>"; }
  function openOrderModal(o){
    if(!o) return;
    const s=OSM[o.status]||[o.status,"warn"];
    let el=document.getElementById("ordModal"); if(el) el.remove();
    el=document.createElement("div"); el.id="ordModal";
    el.style.cssText="position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;padding:18px;backdrop-filter:blur(2px)";
    /* Buyurtma tarkibi — har bir taom rasmi bilan, uzun ro'yxatда scroll (order-items.js) */
    var itemsHtml=""; try{ itemsHtml=YZ_ITEMS.listHtml(o,{maxHeight:240}); }catch(e){}
    var qty=0; try{ qty=YZ_ITEMS.qty(o); }catch(e){}
    /* Mijoz izohlari — nizo chiqsa admin nimani so'raganini aniq ko'radi */
    var notesHtml=""; try{ notesHtml=YZ_ITEMS.notesHtml(o,{title:"Mijoz izohi"}); }catch(e){}
    el.innerHTML="<div style=\"background:#fff;border-radius:20px;max-width:460px;width:100%;padding:22px;position:relative;max-height:90vh;overflow:auto\">"+
      "<button id=\"ordModalClose\" style=\"position:absolute;top:14px;right:14px;border:none;background:#f1f1f4;width:34px;height:34px;border-radius:50%;font-size:16px;cursor:pointer\">✕</button>"+
      "<div style=\"text-align:center;font-size:46px\">"+(o.emoji||"🍽️")+"</div>"+
      "<h3 style=\"text-align:center;margin:6px 0 2px\">"+esc(o.item)+"</h3>"+
      "<div style=\"text-align:center;margin-bottom:14px\"><span class=\"pill "+s[1]+"\">"+s[0]+"</span></div>"+
      (o.suspiciousReason?"<div style=\"background:#fff7ed;color:#c2410c;border-radius:10px;padding:8px 11px;font-size:13px;font-weight:700;margin-bottom:10px\">⚠️ Shubha sababi: "+esc(o.suspiciousReason)+"</div>":"")+
      notesHtml+
      itemsHtml+
      "<div style=\"display:flex;flex-direction:column;gap:10px;font-size:14px\">"+
        omr("Mijoz",esc(o.user)||"-")+omr("Telefon",o.phone?("<a href=\"tel:"+encodeURIComponent(o.phone)+"\" style=\"color:var(--red);text-decoration:none\">"+esc(o.phone)+"</a>"):"-")+
        omr("Manzil",esc(o.addr)||"-")+omr("Restoran",esc(o.rest)||"-")+omr("Kuryer (yetkazmoqda)",esc(o.courier)||"-")+
        (qty?omr("Jami mahsulot",qty+" dona"):"")+
        (o.callRequired?omr("Tasdiqlovchi qo'ng'iroq", o.callDone
          ? "<span style=\"color:#16a34a\">✅ Qilingan"+(o.callBy?" ("+esc(o.callBy)+")":"")+"</span>"
          : "<span style=\"color:#c2410c\">📞 Kutilmoqda</span>"):"")+
        omr("Qayerdan kelgan",srcBadge(o))+
        omr("Buyurtma summasi",money(o.amount)+" so'm")+((o.delivery||0)>0?omr("Yetkazish narxi",money(o.delivery)+" so'm")+omr("Yakuniy summa","<b>"+money((o.amount||0)+(o.delivery||0))+" so'm</b>"):"")+omr("To'lov",o.pay==="cash"?"💵 Naqd":"💳 Karta")+omr("Sana / vaqt",fmtDateTime(o))+
        (o.reason?omr("Bekor sababi","<span style=\"color:#C8102E\">"+esc(o.reason)+"</span>"):"")+
      "</div></div>";
    document.body.appendChild(el);
    try{ history.pushState({ordModal:1}, ""); }catch(e){}
    let popped=false;
    const close=function(){ el.remove(); if(!popped){ popped=true; try{ history.back(); }catch(e){} } };
    el._closeOnBack=function(){ popped=true; el.remove(); };
    el.addEventListener("click",function(e){ if(e.target===el) close(); });
    document.getElementById("ordModalClose").addEventListener("click",close);
  }
  /* App ortga: ochiq modal (ordModal/infoModal) back bilan yopiladi */
  window.addEventListener("popstate",function(){
    const m=document.getElementById("ordModal")||document.getElementById("infoModal");
    if(m){ if(m._closeOnBack) m._closeOnBack(); else m.remove(); }
  });

  /* Admin daromad davri: kunlik/haftalik/oylik/yillik */
  let aIncomePeriod="oylik";
  function aOrderTime(o){ return YZ_TIME.stamp((o&&o.created_at)||""); }
  function aInPeriod(o,p){
    var t=aOrderTime(o); if(!t) return p==="oylik";
    /* "Kunlik" yorlig'i «bugun» deb ko'rsatiladi — demak AYNAN bugungi kun
       (Toshkent), oxirgi 24 soat emas. */
    if(p==="kunlik") return YZ_TIME.isToday((o&&o.created_at)||"");
    var d=(Date.now()-t)/86400000;
    if(p==="haftalik")return d<7; if(p==="yillik")return d<366; return d<31;
  }
  /* ===== SAYT MOLIYASI — YAGONA hisoblash joyi =====
     Server har buyurtmaga yaratilgan paytdagi komissiya foizini (commission),
     yetkazilgan paytdagi kuryer haqini (courierFee) va sof foydani (siteProfit)
     yozib beradi. Shuning uchun admin panel bu raqamlarni QAYTA hisoblamaydi —
     restoran va kuryer panellari bilan bir xil qiymat chiqadi.
     Eski (maydonlarsiz) buyurtmalar uchun joriy foizga tushamiz. */
  function commOf(o){
    if(o && o.commission!=null) return Number(o.commission)||0;
    const r=RESTS.find(x=>x.name===(o&&o.rest));
    const c=(r&&r.commission!=null?r.commission:18);
    return Math.round((Number(o&&o.amount)||0)*c/100);
  }
  /* Kuryerga to'langan haq — XARAJAT. Faqat yetkazilgan buyurtmada bo'ladi. */
  function feeOf(o){
    if(!o || o.status!=="done") return 0;
    if(o.courierFee!=null) return Number(o.courierFee)||0;
    const c=COURIERS.find(x=>x.name===o.courier);
    return Math.max(0, Number(c&&c.fee)||0);
  }
  /* Sof foyda = komissiya − kuryer xarajati */
  function profitOf(o){
    if(o && o.siteProfit!=null) return Number(o.siteProfit)||0;
    return commOf(o)-feeOf(o);
  }

  /* ===== DASHBOARD — operativ ko'rsatkichlar (PUL emas) =====
     Daromad/komissiya/xarajat/foyda alohida «Daromad» bo'limiga ko'chirildi
     (renderIncome). Bu yerда faqat kundalik ish uchun sonlar turadi. */
  function renderDash(){
    const live=(typeof STORE!=="undefined")?STORE.orders():[];
    const active=live.filter(o=>o.status!=="cancelled");
    const totalOrders=active.length;
    const todayOrders=active.filter(o=>{ try{ return YZ_TIME.isToday(o.created_at); }catch(e){ return false; } }).length;
    const inProgress=live.filter(o=>!["done","cancelled","review"].includes(o.status)).length;
    $("#statCards").innerHTML=`
      <div class="scard c1"><div class="si">🔔</div><div class="scard-info"><b>${money(todayOrders)}</b><span>Bugungi buyurtmalar</span></div></div>
      <div class="scard c2"><div class="si">🧾</div><div class="scard-info"><b>${money(totalOrders)}</b><span>Jami buyurtmalar</span></div></div>
      <div class="scard c3"><div class="si">🛵</div><div class="scard-info"><b>${money(inProgress)}</b><span>Hozir jarayonda</span></div></div>
      <div class="scard c4"><div class="si">🏪</div><div class="scard-info"><b>${RESTS.length} · ${COURIERS.length}</b><span>Restoran · Kuryer</span></div></div>`;
    renderAdminTopCustomers(live);
    renderSourceStats(live);
  }

  /* ===== DAROMAD BO'LIMI (dashboarddan ko'chirildi) =====
     Pul kartalari (davr tanlovi bilan) + grafik + moliya zanjiri + TOP restoran.
     Barcha raqamlar HAQIQIY, yetkazilgan (done) buyurtmalardan. */
  function renderIncome(){
    const live=(typeof STORE!=="undefined")?STORE.orders():[];
    const done=live.filter(o=>o.status==="done");
    const periodDone=done.filter(o=>aInPeriod(o,aIncomePeriod));
    const periodSite=periodDone.reduce((s,o)=>s+commOf(o),0);
    /* XARAJAT va SOF FOYDA — kuryerlarga to'langan haq komissiyadan chiqadi */
    const periodFee=periodDone.reduce((s,o)=>s+feeOf(o),0);
    const periodProfit=periodSite-periodFee;
    const apLabel={kunlik:"bugun",haftalik:"haftalik",oylik:"oylik",yillik:"yillik"}[aIncomePeriod];
    const aseg=(k,t)=>`<button class="a-inc-seg" data-ap="${k}" style="border:none;border-radius:8px;padding:4px 9px;font-size:11px;font-weight:700;cursor:pointer;margin:2px 4px 0 0;background:${aIncomePeriod===k?'var(--red,#C8102E)':'#f1eef0'};color:${aIncomePeriod===k?'#fff':'#777'}">${t}</button>`;
    const sc=$("#incStatCards");
    if(sc){
      sc.innerHTML=`
        <div class="scard c1"><div class="si">💰</div><div class="scard-info"><b>${money(periodSite)}</b><span>Komissiya daromadi (${apLabel})</span>
          <div style="margin-top:6px;display:flex;flex-wrap:wrap">${aseg("kunlik","Kunlik")}${aseg("haftalik","Haftalik")}${aseg("oylik","Oylik")}${aseg("yillik","Yillik")}</div></div></div>
        <div class="scard c2"><div class="si">🛵</div><div class="scard-info"><b style="color:#c2410c">− ${money(periodFee)}</b><span>Kuryer xarajati (${apLabel})</span></div></div>
        <div class="scard c3"><div class="si">📈</div><div class="scard-info"><b style="color:${periodProfit<0?'#C8102E':'#16a34a'}">${money(periodProfit)}</b><span>Sof foyda (${apLabel})</span></div></div>
        <div class="scard c4"><div class="si">🧾</div><div class="scard-info"><b>${money(periodDone.length)}</b><span>Yetkazilgan (${apLabel})</span></div></div>`;
      sc.querySelectorAll(".a-inc-seg").forEach(function(b){ b.addEventListener("click",function(e){ e.stopPropagation(); aIncomePeriod=b.dataset.ap; renderIncome(); }); });
    }
    /* REAL komissiya grafigi — TANLANGAN DAVRGA qarab ko'tariladi/tushadi.
       Davr tugmasi (kunlik/haftalik/oylik/yillik) komissiya kartasining ichida;
       o'zgartirilsa diagramma ham shu davrga moslashadi:
         kunlik  -> so'nggi 7 kun (kunma-kun)
         haftalik-> so'nggi 8 hafta
         oylik   -> so'nggi 6 oy
         yillik  -> so'nggi 5 yil */
    (function(){
      const MON=["Yan","Fev","Mar","Apr","May","Iyun","Iyul","Avg","Sen","Okt","Noy","Dek"];
      const WD=["Yak","Dush","Sesh","Chor","Pay","Jum","Shan"];
      const now=new Date();
      const slots=[];
      const ms=o=>YZ_TIME.stamp((o&&o.created_at)||"");
      if(aIncomePeriod==="kunlik"){
        for(let i=6;i>=0;i--){ const dt=new Date(now.getFullYear(),now.getMonth(),now.getDate()-i); slots.push({label:WD[dt.getDay()]+" "+dt.getDate(),key:dt.getFullYear()+"-"+dt.getMonth()+"-"+dt.getDate(),sum:0,match:o=>{const d=new Date(ms(o));return d.getFullYear()===dt.getFullYear()&&d.getMonth()===dt.getMonth()&&d.getDate()===dt.getDate();}}); }
      } else if(aIncomePeriod==="haftalik"){
        for(let i=7;i>=0;i--){ const start=new Date(now.getFullYear(),now.getMonth(),now.getDate()-i*7-now.getDay()); const s=start.getTime(), e=s+7*86400000; slots.push({label:(start.getMonth()+1)+"/"+start.getDate(),sum:0,match:o=>{const t=ms(o);return t>=s&&t<e;}}); }
      } else if(aIncomePeriod==="yillik"){
        for(let i=4;i>=0;i--){ const y=now.getFullYear()-i; slots.push({label:String(y),sum:0,match:o=>{const mm=String(o.created_at||"").match(/^(\d{4})/);return mm&&+mm[1]===y;}}); }
      } else {
        for(let i=5;i>=0;i--){ const dt=new Date(now.getFullYear(),now.getMonth()-i,1); slots.push({label:MON[dt.getMonth()],y:dt.getFullYear(),m:dt.getMonth(),sum:0,match:o=>{const mm=String(o.created_at||"").match(/^(\d{4})-(\d{2})/);return mm&&+mm[1]===dt.getFullYear()&&(+mm[2]-1)===dt.getMonth();}}); }
      }
      done.forEach(function(o){ const sl=slots.find(x=>x.match(o)); if(sl) sl.sum+=commOf(o); });
      const max=Math.max.apply(null,slots.map(x=>x.sum).concat([1]));
      const el=$("#revChart"); if(!el) return;
      el.style.cssText="display:flex;align-items:flex-end;gap:8px;padding:12px 6px;height:180px;overflow-x:auto";
      el.innerHTML=slots.map(function(x){ return '<div style="flex:1;min-width:34px;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:6px;height:100%">'+
        '<div style="font-size:11px;font-weight:700;color:#8a7f76">'+(x.sum?mln(x.sum).replace(" mln",""):"0")+'</div>'+
        '<div style="width:100%;max-width:34px;border-radius:8px 8px 0 0;background:linear-gradient(180deg,var(--red,#C8102E),#ff7a5c);height:'+Math.max(4,Math.round(x.sum/max*130))+'px"></div>'+
        '<small style="font-size:10px;color:#8a7f76;white-space:nowrap">'+x.label+'</small></div>'; }).join("");
      /* Diagramma sarlavhasidagi davr yorlig'i */
      const badge=$("#incChartBadge"); if(badge) badge.textContent={kunlik:"7 kun",haftalik:"8 hafta",oylik:"6 oy",yillik:"5 yil"}[aIncomePeriod]||"6 oy";
    })();
    /* ===== TOP restoranlar — FAQAT yetkazilgan (pul tushgan) buyurtmalar =====
       Ilgari bekor qilingan va hali yo'ldagi buyurtmalar ham aylanmaga
       qo'shilardi: restoran "top" ga chiqib, aslida pul kelmagan bo'lardi.
       Taomlar ham buyurtma tarkibidan (dona bilan) sanaladi. */
    const rAgg={};
    done.forEach(function(o){
      if(!o.rest) return;
      if(!rAgg[o.rest]) rAgg[o.rest]={name:o.rest,rev:0,comm:0,fee:0,profit:0,count:0,items:{}};
      const a=rAgg[o.rest];
      a.rev+=(o.amount||0); a.comm+=commOf(o); a.fee+=feeOf(o); a.profit+=profitOf(o); a.count++;
      let ls=[]; try{ ls=YZ_ITEMS.lines(o); }catch(e){}
      if(ls.length) ls.forEach(function(l){ const k=String(l.name||""); if(k) a.items[k]=(a.items[k]||0)+(Number(l.qty)||1); });
      else if(o.item) a.items[o.item]=(a.items[o.item]||0)+1;
    });
    const topR=Object.values(rAgg).sort((a,b)=>b.rev-a.rev).slice(0,5);
    $("#topRests").innerHTML=topR.length?topR.map((r,i)=>`
      <div class="topitem" data-toprest="${esc(r.name)}" style="cursor:pointer"><span class="rank">${i+1}</span>
        <span style="font-size:18px">🏪</span>
        <span class="ti-name">${esc(r.name)}</span>
        <span class="ti-val">${money(r.rev)}</span></div>`).join(""):'<p style="color:var(--grey);font-size:13px">Hozircha yetkazilgan buyurtma yo\'q</p>';
    $$("#topRests .topitem").forEach(function(it){ it.addEventListener("click",function(){ showTopRestModal(rAgg[it.dataset.toprest]); }); });
    /* ===== MOLIYA XULOSASI: aylanma → komissiya → xarajat → sof foyda =====
       Butun zanjir bitta qatorда ko'rinadi, shuning uchun "qayerdan qancha
       tushdi va qayerga qancha ketdi" degan savol ochiq qolmaydi. */
    const note=$("#gmvNote");
    if(note){
      const totalGMV=done.reduce((s,o)=>s+(o.amount||0),0);
      const totalSite=done.reduce((s,o)=>s+commOf(o),0);
      const totalFee=done.reduce((s,o)=>s+feeOf(o),0);
      const totalRest=totalGMV-totalSite;
      const totalProfit=totalSite-totalFee;
      note.innerHTML=`<b>${money(done.length)} ta yetkazilgan buyurtma</b> · `
        + `Aylanma: <b>${money(totalGMV)}</b> · `
        + `Restoranlarga: <b>${money(totalRest)}</b> · `
        + `Komissiya: <b style="color:#16a34a">${money(totalSite)}</b> · `
        + `Kuryer xarajati: <b style="color:#c2410c">− ${money(totalFee)}</b> · `
        + `Sof foyda: <b style="color:${totalProfit<0?'#C8102E':'#16a34a'}">${money(totalProfit)} so'm</b>`;
    }
    renderFinance(done);
  }

  /* ===== MOLIYA: kirim, xarajat va sof foyda (admin dashboard) =====
     Bitta buyurtmadagi pul zanjiri:
       mijoz to'laydi (aylanma)
         → restoranga: aylanma − komissiya
         → saytga:     komissiya
             → kuryerga: yetkazish haqi (XARAJAT)
             → saytga qoladi: sof foyda
     Barcha raqamlar HAQIQIY buyurtmalardan. Komissiya foizi buyurtma
     yaratilganда, kuryer haqi esa yetkazilganда buyurtmaga muhrlanadi
     (server/src/orders-core.js) — shuning uchun eski hisobotlar o'zgarmaydi. */
  function renderFinance(done){
    /* Moliya bloki «Daromad» bo'limiga qo'yiladi (dashboardga emas). GMV
       yozuvidan keyin, TOP restoranlardan oldin tursin. */
    var host=document.getElementById("view-income"); if(!host) return;
    var box=document.getElementById("adminFinance");
    if(!box){
      box=document.createElement("div"); box.id="adminFinance"; box.className="panel";
      box.style.marginTop="16px";
      /* GMV yozuvidan keyin joylashsin (mavjud bo'lsa uning ortiga) */
      var gmv=document.getElementById("gmvNote");
      if(gmv && gmv.nextSibling) host.insertBefore(box, gmv.nextSibling);
      else host.appendChild(box);
    }
    var inP=(done||[]).filter(function(o){ return aInPeriod(o,aIncomePeriod); });
    var gmv=inP.reduce(function(s,o){return s+(Number(o.amount)||0);},0);
    var comm=inP.reduce(function(s,o){return s+commOf(o);},0);
    var fee=inP.reduce(function(s,o){return s+feeOf(o);},0);
    var toRest=gmv-comm;
    var profit=comm-fee;
    var label={kunlik:"bugun",haftalik:"so'nggi hafta",oylik:"so'nggi oy",yillik:"so'nggi yil"}[aIncomePeriod]||"so'nggi oy";

    /* Kuryerlar bo'yicha xarajat — kimga qancha to'langan */
    var byC={};
    inP.forEach(function(o){
      var n=o.courier||"— (biriktirilmagan)";
      if(!byC[n]) byC[n]={name:n, count:0, fee:0};
      byC[n].count++; byC[n].fee+=feeOf(o);
    });
    var couriers=Object.values(byC).sort(function(a,b){return b.fee-a.fee;});

    /* Restoranlar bo'yicha komissiya — kimdan qancha tushdi */
    var byR={};
    inP.forEach(function(o){
      var n=o.rest||"—";
      if(!byR[n]) byR[n]={name:n, count:0, gmv:0, comm:0};
      byR[n].count++; byR[n].gmv+=(Number(o.amount)||0); byR[n].comm+=commOf(o);
    });
    var rests=Object.values(byR).sort(function(a,b){return b.comm-a.comm;});

    var row=function(icon,k,v,color,strong){
      return '<div class="fin-row'+(strong?' tot':'')+'" style="display:flex;justify-content:space-between;gap:10px;padding:9px 0">'
        + '<span style="color:var(--grey)">'+icon+' '+k+'</span>'
        + '<b style="'+(color?'color:'+color+';':'')+'white-space:nowrap">'+v+'</b></div>';
    };
    /* Foyda ulushi: komissiyaning necha foizi sayt qo'lida qoladi */
    var keepPct=comm?Math.round(profit/comm*100):0;
    var barFee=comm?Math.max(0,Math.min(100,Math.round(fee/comm*100))):0;

    box.innerHTML=
      '<div class="panel-head"><h3>💰 Moliya: kirim, xarajat va sof foyda</h3>'
        + '<span style="color:var(--grey);font-size:13px">'+label+' · '+inP.length+' ta yetkazilgan</span></div>'
      + '<div class="panel-body">'
        + row('🧾','Mijozlar to\'lagan (aylanma)', money(gmv)+" so'm")
        + row('🏪','Restoranlarga o\'tkaziladi', '− '+money(toRest)+" so'm", '#c2410c')
        + row('💚','Sayt komissiyasi (kirim)', money(comm)+" so'm", '#16a34a')
        + row('🛵','Kuryerlarga to\'landi (xarajat)', '− '+money(fee)+" so'm", '#c2410c')
        + row('📈','SOF FOYDA', money(profit)+" so'm", profit<0?'#C8102E':'#16a34a', true)
        + '<div style="height:14px;background:#e9f7ef;border-radius:8px;overflow:hidden;margin-top:10px;display:flex">'
          + (comm?'<div style="width:'+barFee+'%;background:#f59e0b"></div>':'')
        + '</div>'
        + '<div style="display:flex;justify-content:space-between;font-size:12px;color:var(--grey);margin-top:5px">'
          + '<span>🛵 Kuryerga: '+barFee+'%</span><span>📈 Sizga qoladi: '+keepPct+'%</span></div>'
        + (couriers.length
            ? '<div style="font-size:12px;color:var(--grey);margin-top:14px;font-weight:700">KURYERLAR BO\'YICHA XARAJAT</div>'
              + '<div style="max-height:220px;overflow-y:auto">'
              + couriers.map(function(c){
                  return '<div style="display:flex;justify-content:space-between;gap:10px;padding:7px 0;border-bottom:1px solid var(--line);font-size:13px">'
                    + '<span>🛵 <b>'+esc(c.name)+'</b> <span style="color:var(--grey)">· '+c.count+' ta</span></span>'
                    + '<b style="color:#c2410c;white-space:nowrap">− '+money(c.fee)+" so'm</b></div>";
                }).join('') + '</div>'
            : '')
        + (rests.length
            ? '<div style="font-size:12px;color:var(--grey);margin-top:14px;font-weight:700">RESTORANLAR BO\'YICHA KOMISSIYA</div>'
              + '<div style="max-height:220px;overflow-y:auto">'
              + rests.map(function(r){
                  return '<div style="display:flex;justify-content:space-between;gap:10px;padding:7px 0;border-bottom:1px solid var(--line);font-size:13px">'
                    + '<span>🏪 <b>'+esc(r.name)+'</b> <span style="color:var(--grey)">· '+r.count+' ta · '+money(r.gmv)+" so'm</span></span>"
                    + '<b style="color:#16a34a;white-space:nowrap">+ '+money(r.comm)+" so'm</b></div>";
                }).join('') + '</div>'
            : '')
        + (inP.length ? '' : '<p style="color:var(--grey);font-size:13px;margin-top:10px">Bu davrda yetkazilgan buyurtma yo\'q — davrni yuqoridagi tugmalar bilan almashtiring.</p>')
      + '</div>';
  }

  /* ===== BOT va SAYT reytingi (admin dashboard) =====
     Necha foiz buyurtma Telegram botdan, necha foiz saytdan kelgan + pastda
     o'sha manba bo'yicha mijozlar. Mijoz ustiga bosilsa — to'liq ma'lumot. */
  function renderSourceStats(live){
    var host=document.getElementById("view-dash"); if(!host) return;
    var box=document.getElementById("adminSrcStats");
    if(!box){ box=document.createElement("div"); box.className="panel"; box.id="adminSrcStats"; box.style.marginTop="16px"; host.appendChild(box); }
    var orders=(live||[]).filter(function(o){return o.status!=="cancelled";});
    var tg=orders.filter(function(o){return o.source==="telegram";});
    var web=orders.filter(function(o){return o.source!=="telegram";});
    var total=orders.length||1;
    var tgP=Math.round(tg.length/total*100), webP=100-(orders.length?tgP:0);
    if(!orders.length){ tgP=0; webP=0; }
    box.innerHTML=srcStatsHtml("🤖 Bot va 🌐 sayt reytingi", tg.length, web.length, tgP, webP, srcCustomers(orders));
    bindSrcCustomers(box, orders);
  }
  /* Manba bo'yicha bo'lingan mijozlar (telefon bo'yicha) */
  function srcCustomers(orders){
    var map={};
    orders.forEach(function(o){
      var d=String(o.phone||"").replace(/\D/g,"")||(String(o.user||"").toLowerCase()+"|"+String(o.addr||"").toLowerCase());
      if(!map[d]) map[d]={name:o.user||"—",phone:o.phone||"—",addr:o.addr||"",tg:0,web:0};
      if(o.source==="telegram") map[d].tg++; else map[d].web++;
    });
    return Object.values(map).map(function(c){ c.count=c.tg+c.web; c.src=c.tg>c.web?"telegram":"sayt"; return c; })
      .sort(function(a,b){return b.count-a.count;});
  }
  /* Umumiy HTML — admin va restoran panellari bir xil ko'rinishда ishlatadi */
  function srcStatsHtml(title, tgN, webN, tgP, webP, custs){
    var bar='<div style="display:flex;height:16px;border-radius:9px;overflow:hidden;margin:10px 0 6px;background:#f1eef0">'+
        (tgP>0?'<div style="width:'+tgP+'%;background:#2563eb"></div>':'')+
        (webP>0?'<div style="width:'+webP+'%;background:#16a34a"></div>':'')+'</div>';
    var legend='<div style="display:flex;gap:16px;flex-wrap:wrap;font-size:13px;margin-bottom:6px">'+
        '<span style="display:flex;align-items:center;gap:6px"><span style="width:12px;height:12px;border-radius:3px;background:#2563eb;display:inline-block"></span>🤖 Telegram: <b>'+tgP+'%</b> ('+tgN+' ta)</span>'+
        '<span style="display:flex;align-items:center;gap:6px"><span style="width:12px;height:12px;border-radius:3px;background:#16a34a;display:inline-block"></span>🌐 Sayt: <b>'+webP+'%</b> ('+webN+' ta)</span>'+
      '</div>';
    var list=custs.length
      ? '<div style="max-height:360px;overflow-y:auto;margin-top:8px">'+custs.map(function(c,i){
          return '<div class="src-cust" data-srcph="'+esc(String(c.phone||"").replace(/\D/g,""))+'" style="display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--line);cursor:pointer">'+
            '<span style="width:24px;height:24px;border-radius:50%;background:'+(c.src==="telegram"?"#2563eb":"#16a34a")+';color:#fff;display:flex;align-items:center;justify-content:center;font-size:12px;flex-shrink:0">'+(c.src==="telegram"?"🤖":"🌐")+'</span>'+
            '<div style="flex:1;min-width:0"><div style="font-weight:700">'+esc(c.name)+'</div><div style="color:var(--grey);font-size:12px">📞 '+esc(c.phone)+'</div></div>'+
            '<div style="text-align:right;font-size:12px;white-space:nowrap"><b>'+c.count+' ta</b><div style="color:var(--grey)">🤖'+c.tg+' · 🌐'+c.web+'</div></div>'+
          '</div>'; }).join("")+'</div>'
      : '<p style="color:var(--grey);font-size:13px;margin-top:6px">Hozircha buyurtma yo\'q.</p>';
    return '<div class="panel-head"><h3>'+title+'</h3><span style="color:var(--grey);font-size:13px">'+(tgN+webN)+' buyurtma</span></div><div class="panel-body">'+bar+legend+
      '<div style="font-size:12px;color:var(--grey);margin-top:10px;font-weight:700">Manba bo\'yicha mijozlar (ustiga bosing):</div>'+list+'</div>';
  }
  function bindSrcCustomers(box, orders){
    box.querySelectorAll(".src-cust").forEach(function(el){
      el.addEventListener("click",function(){
        var d=el.dataset.srcph; if(!d) return;
        /* Mijoz kartochkasi — foydalanuvchilar bo'limidagi bilan bir xil */
        var u=allUsers().find(function(x){return String(x.phone||"").replace(/\D/g,"")===d;});
        if(u){ openUser(u.id); return; }
        /* Ro'yxatda bo'lmasa — o'sha telefon bo'yicha oddiy modal */
        openPhoneCustomer(d, orders);
      });
    });
  }
  /* Foydalanuvchilar ro'yxatida bo'lmagan mijoz uchun tez modal */
  function openPhoneCustomer(dig, orders){
    var mine=orders.filter(function(o){return String(o.phone||"").replace(/\D/g,"")===dig;});
    if(!mine.length) return;
    var name=mine[0].user||"Mijoz", phone=mine[0].phone||"—";
    /* "Jami sarflagan" — FAQAT yetkazilgan (done) buyurtmalar (kabinet / boshqa
       mijoz kartochkalari bilan bir xil; bekor qilingan/yo'ldagi hisobga olinmaydi). */
    var spent=mine.filter(function(o){return o.status==="done";}).reduce(function(s,o){return s+(o.amount||0);},0);
    var hist=mine.map(function(o){ var st=OSM[o.status]||[o.status,"warn"];
      return '<div style="border:1px solid var(--line);border-radius:10px;padding:10px;margin-bottom:8px"><div style="display:flex;justify-content:space-between"><b>'+(o.emoji||"🍽️")+' '+esc(o.item)+'</b><span class="pill '+st[1]+'">'+st[0]+'</span></div><div style="color:var(--grey);font-size:12px;margin-top:4px">'+fmtDateTime(o)+' · '+money(o.amount)+" so'm · "+esc(o.rest||"—")+'</div></div>'; }).join("");
    infoModal("🕶️ "+esc(name)+" (mehmon)",
      '<div style="display:flex;flex-direction:column;gap:8px;font-size:14px;margin-bottom:12px">'+
      omr("Telefon","📞 "+esc(phone))+omr("Buyurtmalar",mine.length+" ta")+omr("Jami sarflagan",money(spent)+" so'm")+
      '</div><h4 style="margin:8px 0">Buyurtmalar tarixi</h4>'+hist);
  }
  /* Bir xillik: telefon (yoki ism+manzil) bo'yicha eng ko'p buyurtma bergan mijozlar */
  function adminTopCustomers(orders, n){
    var map={};
    (orders||[]).forEach(function(o){
      if(o.status==="cancelled") return;
      var phone=String(o.phone||"").replace(/\D/g,"");
      var key=phone || (String(o.user||"").toLowerCase().trim()+"|"+String(o.addr||"").toLowerCase().trim());
      if(!key || key==="|") return;
      if(!map[key]) map[key]={name:o.user||"—", phone:o.phone||"—", addr:o.addr||"", rests:{}, count:0};
      map[key].count++; if(o.rest) map[key].rests[o.rest]=1;
    });
    /* n berilmasa — HAMMASI qaytadi (ro'yxat scroll ichida ko'rsatiladi) */
    var all=Object.values(map).sort(function(a,b){return b.count-a.count;});
    return n?all.slice(0,n):all;
  }
  function renderAdminTopCustomers(live){
    var host=document.getElementById("view-dash"); if(!host) return;
    var list=adminTopCustomers(live);
    var box=document.getElementById("adminTopCust");
    if(!box){ box=document.createElement("div"); box.className="panel"; box.id="adminTopCust"; box.style.marginTop="16px"; host.appendChild(box); }
    /* Mijozlar ko'payib ketsa ham panel cho'zilmaydi — ichida scroll bo'ladi */
    box.innerHTML='<div class="panel-head"><h3>👑 Eng ko\'p buyurtma bergan mijozlar</h3><span style="color:var(--grey);font-size:13px">'+list.length+' ta</span></div><div class="panel-body">'+
      (list.length?'<div style="max-height:500px;overflow-y:auto">'+list.map(function(c,i){ var rc=Object.keys(c.rests).length; return '<div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--line)"><span style="background:var(--red);color:#fff;width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:12px;flex-shrink:0">'+(i+1)+'</span><div style="flex:1;min-width:0"><div style="font-weight:700">'+esc(c.name)+'</div><div style="color:var(--grey);font-size:13px">📞 '+esc(c.phone)+(c.addr?' · 📍 '+esc(c.addr):'')+(rc?' · '+rc+' restoran':'')+'</div></div><b style="color:var(--red);white-space:nowrap">'+c.count+' marta</b></div>'; }).join("")+'</div>':'<p style="color:var(--grey)">Hozircha buyurtma yo\'q.</p>')+
      '</div>';
  }
  /* (Eng past reytingli restoranlar bo'limi olib tashlandi — endi u faqat TOP
     restoranlar ro'yxatida ko'rinadi: eng pastda turgani = eng past reytingli.) */

  /* =========================================================
     RESTORANLAR — render (desktop jadval + mobile karta)
     ========================================================= */
  /* Restoranning backend yozuvi (ish vaqti shu yerda) */
  function beRest(r){
    try{ const list=(typeof STORE!=="undefined"&&STORE.restaurants)?(STORE.restaurants()||[]):[];
      return list.find(x=>x.login&&r.login&&x.login===r.login) || list.find(x=>x.name===r.name) || null; }catch(e){ return null; }
  }
  /* Restoran O'ZI belgilagan ish vaqti — admin ham AYNAN shuni ko'radi */
  function restHours(r){ const be=beRest(r); return be ? YZ_TIME.restHours(be) : "—"; }
  function restOpenNow(r){ const be=beRest(r); return be ? YZ_TIME.restOpen(be) : true; }
  function restOpenBadge(r){
    const be=beRest(r); if(!be) return "";
    return restOpenNow(r)
      ? ` <span class="yz-openbadge is-open" title="Ish vaqti: ${esc(restHours(r))}">🟢 Ochiq</span>`
      : ` <span class="yz-openbadge is-closed" title="Ish vaqti: ${esc(restHours(r))}">🔴 Yopiq</span>`;
  }

  function renderRests(){
    /* Desktop jadval */
    const tb=$("#restTbody"); if(tb){
      tb.innerHTML=RESTS.map(r=>{
        const pend=getPending(r.id,"rest");
        return `<tr data-id="${r.id}">
          <td><div class="tname"><span class="av">${r.emoji}</span>${r.name}${restOpenBadge(r)}</div>
              <div style="color:var(--grey);font-size:11.5px;margin-top:2px">🕒 ${esc(restHours(r))}</div></td>
          <td><span class="star">★ ${r.rating}</span></td>
          <td>${money(r.orders)}</td>
          <td class="money">${money(r.rev)}</td>
          <td><b style="color:var(--green)">${money(r.siteCut)}</b></td>
          <td><span class="mono">${r.login}</span></td>
          <td>${pend
            ? `<span class="pill warn">O'chiriladi · ${formatCountdown(pend.deleteAt-Date.now())}</span>`
            : `<span class="pill ${r.status==="ok"?"ok":"warn"}">${r.status==="ok"?"Faol":"Nazorat"}</span>`}</td>
        </tr>`;
      }).join("");
      $$("#restTbody tr").forEach(tr=>tr.addEventListener("click",()=>openRest(+tr.dataset.id)));
    }
    /* Mobile kartalar */
    const mc=$("#restCards"); if(mc){
      mc.innerHTML=RESTS.map(r=>{
        const pend=getPending(r.id,"rest");
        return `<div class="mcard" data-id="${r.id}">
          <div class="mcard-top">
            <span class="mcard-icon">${r.emoji}</span>
            <div class="mcard-info"><div class="mcard-name">${r.name}${restOpenBadge(r)}</div><div class="mcard-sub">🕒 ${esc(restHours(r))}${r.addr?" · "+esc(r.addr):""}</div></div>
            ${pend
              ? `<span class="pill warn" style="font-size:10px">⏳ ${formatCountdown(pend.deleteAt-Date.now())}</span>`
              : `<span class="pill ${r.status==="ok"?"ok":"warn"}">${r.status==="ok"?"Faol":"Nazorat"}</span>`}
          </div>
          <div class="mcard-stats">
            <div class="mcard-stat"><span>Reyting</span><b class="star">★ ${r.rating}</b></div>
            <div class="mcard-stat"><span>Buyurtma</span><b>${money(r.orders)}</b></div>
            <div class="mcard-stat"><span>Aylanma</span><b class="money">${mln(r.rev)}</b></div>
            <div class="mcard-stat"><span>Komissiya</span><b style="color:var(--green)">${mln(r.siteCut)}</b></div>
          </div>
        </div>`;
      }).join("");
      $("#restCards").querySelectorAll(".mcard").forEach(c=>c.addEventListener("click",()=>openRest(+c.dataset.id)));
    }
  }

  /* =========================================================
     KURYERLAR — render
     ========================================================= */
  /* Backend kuryer holati (ishdan javob + ish vaqti) — login/nom bo'yicha */
  function beCourier(c){
    try{ const list=(typeof STORE!=="undefined"&&STORE.couriers)?(STORE.couriers()||[]):[];
      return list.find(x=>x.login&&c.login&&x.login===c.login) || list.find(x=>x.name===c.name) || null; }catch(e){ return null; }
  }
  function courLeaveBadge(c){
    const be=beCourier(c);
    if(be && be.onLeave) return ` <span class="pill warn" title="${esc(be.leaveReason||'')}" style="font-size:10px;background:#fef3c7;color:#b45309">🚪 Ishdan javobda</span>`;
    if(be && be.leaveStatus==='pending') return ` <span class="pill warn" title="${esc(be.leaveReason||'')}" style="font-size:10px;background:#fef9c3;color:#a16207">⏳ Javob so'rovi</span>`;
    return "";
  }
  function courHours(c){ const be=beCourier(c); if(!be) return "—"; return YZ_TIME.courHours(be); }
  /* Kuryer AYNAN hozir ish vaqtida bo'lsa — buyurtmalar unga tushadi
     (server ham shu qoidani qo'llaydi: orders-core.js assignCourier) */
  function courOnShift(c){ const be=beCourier(c); return be ? YZ_TIME.courOpen(be) : true; }
  function courShiftBadge(c){
    const be=beCourier(c); if(!be) return "";
    if(be.onLeave) return "";                      // "Ishdan javobda" nishoni allaqachon chiqadi
    return courOnShift(c)
      ? ` <span class="yz-openbadge is-open">🟢 Ishda</span>`
      : ` <span class="yz-openbadge is-closed">🌙 Ish vaqti emas</span>`;
  }
  function renderCouriers(){
    const tb=$("#courTbody"); if(tb){
      tb.innerHTML=COURIERS.map(c=>{
        const pend=getPending(c.id,"courier");
        return `<tr data-id="${c.id}">
          <td><div class="tname"><span class="av">${c.emoji}</span>${c.name}${courLeaveBadge(c)}${courShiftBadge(c)}</div></td>
          <td>${c.rest}</td>
          <td>${money(c.deliveries)} ta</td>
          <!-- Kuryerga HAQIQATDA to'langan haqlar yig'indisi (saytning xarajati) -->
          <td class="money">${money(c.earn||0)}</td>
          <td>${courHours(c)}</td>
          <td><span class="star">★ ${c.rating}</span></td>
          <td><span class="mono">${c.login}</span>${pend?` <span class="pill warn" style="font-size:10px">⏳ ${formatCountdown(pend.deleteAt-Date.now())}</span>`:""}</td>
        </tr>`;
      }).join("");
      $$("#courTbody tr").forEach(tr=>tr.addEventListener("click",()=>openCourier(+tr.dataset.id)));
    }
    const mc=$("#courCards"); if(mc){
      mc.innerHTML=COURIERS.map(c=>{
        const pend=getPending(c.id,"courier");
        return `<div class="mcard" data-id="${c.id}">
          <div class="mcard-top">
            <span class="mcard-icon">${c.emoji}</span>
            <div class="mcard-info"><div class="mcard-name">${c.name}${courLeaveBadge(c)}</div><div class="mcard-sub">${c.rest}</div></div>
            ${pend
              ? `<span class="pill warn" style="font-size:10px">⏳ ${formatCountdown(pend.deleteAt-Date.now())}</span>`
              : `<span class="star">★ ${c.rating}</span>`}
          </div>
          <div class="mcard-stats">
            <div class="mcard-stat"><span>Yetkazgan</span><b>${money(c.deliveries)}</b></div>
            <div class="mcard-stat"><span>To'langan</span><b>${money(c.earn||0)}</b></div>
            <div class="mcard-stat"><span>Login</span><b class="mono">${c.login}</b></div>
          </div>
        </div>`;
      }).join("");
      $("#courCards").querySelectorAll(".mcard").forEach(c=>c.addEventListener("click",()=>openCourier(+c.dataset.id)));
    }
  }

  /* Foydalanuvchilar: ro'yxatdan O'TGANLAR va O'TMAY buyurtma berganlar (mehmon).
     Backend ikki guruhni alohida qaytaradi (/api/users). */
  let LIVE_USERS=[], GUEST_USERS=[];
  let userTab="registered";   // 'registered' | 'guest'
  function loadLiveUsers(){
    if(typeof STORE==="undefined" || !STORE.fetchUsers) return;
    STORE.fetchUsers().then(data=>{
      /* Eski format (massiv) bilan ham ishlaydi */
      const reg = Array.isArray(data) ? data : (data && data.registered) || [];
      const guests = (data && data.guests) || [];
      const all=(typeof STORE!=="undefined")?(STORE.orders()||[]):[];
      const revs=(typeof STORE!=="undefined"&&STORE.reviews)?(STORE.reviews()||[]):[];
      LIVE_USERS=reg.map(u=>{
        const mine=all.filter(o=>o.user===u.name);
        const done=mine.filter(o=>o.status==="done");
        const spent=done.reduce((s,o)=>s+(o.amount||0)+(o.delivery||0),0);
        const cnt={}; mine.forEach(o=>{ if(o.rest) cnt[o.rest]=(cnt[o.rest]||0)+1; });
        const fav=Object.entries(cnt).sort((a,b)=>b[1]-a[1])[0];
        const last=mine[0] ? (YZ_TIME.fmtDate(mine[0].created_at)||u.joined||"—") : (u.joined||"—");
        return { id:100000+(u.id||0), backendId:u.id, login:u.login||"", name:u.name, emoji:"👤",
          phone:u.phone||"", email:u.email||"",
          orders:mine.length, done:done.length,
          cancelled:mine.filter(o=>o.status==="cancelled").length,
          spent:spent, fav:fav?fav[0]:"—",
          reviews:revs.filter(r=>r.name===u.name).length,
          last:last, joined:u.joined||"—", reg:true, guest:false };
      });
      /* Mehmonlar — backend telefon bo'yicha yig'ib beradi (id = "g_998..."), lekin
         PUL/sanoqni admin O'ZI buyurtma keshidan (STORE.orders — hamma buyurtma)
         qayta hisoblaydi: "Jami sarflagan" FAQAT yetkazilgan (done), aynan
         ro'yxatdan o'tgan mijozlardagidek. Server soni turli statusni
         qo'shib yuborardi — panellararo farq chiqardi. */
      const digs=(s)=>String(s||"").replace(/\D/g,"");
      GUEST_USERS=guests.map((g,i)=>{
        const gd=digs(g.phone);
        const mine=gd?all.filter(o=>digs(o.phone)===gd):[];
        const done=mine.filter(o=>o.status==="done");
        const spent=done.reduce((s,o)=>s+(o.amount||0),0);
        const restSet={}; mine.forEach(o=>{ if(o.rest) restSet[o.rest]=1; });
        const nRest=Object.keys(restSet).length || g.rests || 0;
        return {
          id: 200000+i, guestId:g.id, name:g.name||"Mehmon", emoji:"🕶️",
          phone:g.phone||"", email:"",
          orders: mine.length || g.orders || 0,
          done: done.length,
          cancelled: mine.filter(o=>o.status==="cancelled").length,
          spent: spent,
          fav:(nRest?nRest+" restoran":"—"),
          addr:g.addr||"", reviews:0, last:g.last||"—", joined:"—", reg:false, guest:true };
      });
      renderUsers();
    }).catch(()=>{});
  }
  /* Tanlangan tabga qarab ro'yxat */
  function currentUsers(){ return userTab==="guest" ? GUEST_USERS : LIVE_USERS.concat(USERS); }
  function allUsers(){ return LIVE_USERS.concat(GUEST_USERS).concat(USERS); }

  function renderUserTabs(){
    var host=document.getElementById("userTabs"); if(!host) return;
    var seg=function(k,label,n){ return '<button class="utab" data-utab="'+k+'" style="border:none;border-radius:10px;padding:8px 16px;font-size:13px;font-weight:700;cursor:pointer;margin-right:8px;background:'+(userTab===k?'var(--red,#C8102E)':'#f1eef0')+';color:'+(userTab===k?'#fff':'#777')+'">'+label+' <span style="opacity:.85">'+n+'</span></button>'; };
    host.innerHTML=seg("registered","✅ Ro'yxatdan o'tgan",LIVE_USERS.length)+seg("guest","🕶️ Ro'yxatsiz (mehmon)",GUEST_USERS.length);
    host.querySelectorAll(".utab").forEach(function(b){ b.addEventListener("click",function(){ userTab=b.dataset.utab; renderUsers(); }); });
  }

  function renderUsers(){
    renderUserTabs();
    const rows=currentUsers();
    const guestMode=userTab==="guest";
    const tb=$("#userTbody"); if(tb){
      tb.innerHTML=rows.length?rows.map(u=>`
        <tr data-id="${u.id}">
          <td><div class="tname"><span class="av">${u.emoji}</span>${esc(u.name)}${u.reg?' <span class="pill ok" style="font-size:10px">ro\'yxatda</span>':' <span class="pill warn" style="font-size:10px">mehmon</span>'}</div></td>
          <td>${money(u.orders)}</td><td class="money">${money(u.spent)}</td>
          <td>${guestMode?esc(u.phone):esc(u.fav)}</td><td>${guestMode?esc(u.fav):u.reviews}</td><td>${esc(u.last)}</td>
        </tr>`).join(""):`<tr><td colspan="6" style="color:var(--grey);padding:20px">${guestMode?"Ro'yxatdan o'tmay buyurtma bergan mijoz yo'q.":"Ro'yxatdan o'tgan foydalanuvchi yo'q."}</td></tr>`;
      $$("#userTbody tr[data-id]").forEach(tr=>tr.addEventListener("click",()=>openUser(+tr.dataset.id)));
    }
    const mc=$("#userCards"); if(mc){
      mc.innerHTML=rows.length?rows.map(u=>`
        <div class="mcard" data-id="${u.id}">
          <div class="mcard-top">
            <span class="mcard-icon">${u.emoji}</span>
            <div class="mcard-info"><div class="mcard-name">${esc(u.name)}${u.guest?' <span class="pill warn" style="font-size:9px">mehmon</span>':''}</div><div class="mcard-sub">${esc(u.phone)}</div></div>
            <span class="pill ${u.guest?'warn':'ok'}">${u.orders} buyurtma</span>
          </div>
          <div class="mcard-stats">
            <div class="mcard-stat"><span>Sarflagan</span><b class="money">${money(u.spent)}</b></div>
            <div class="mcard-stat"><span>${u.guest?'Restoran':'Sevimli'}</span><b>${esc(u.fav)}</b></div>
            <div class="mcard-stat"><span>Oxirgi</span><b>${esc(u.last)}</b></div>
          </div>
        </div>`).join(""):`<p style="color:#9a8d83;text-align:center;padding:24px;font-size:14px">${guestMode?"Mehmon mijoz yo'q.":"Ro'yxatdan o'tgan foydalanuvchi yo'q."}</p>`;
      mc.querySelectorAll(".mcard").forEach(c=>c.addEventListener("click",()=>openUser(+c.dataset.id)));
    }
    const demand={};
    USERS.forEach(u=>demand[u.fav]=(demand[u.fav]||0)+u.orders);
    const topD=Object.entries(demand).sort((a,b)=>b[1]-a[1]).slice(0,5);
    const maxD=topD[0]?topD[0][1]:1;
    const dl=$("#demandList"); if(dl)
      dl.innerHTML=topD.map(([d,v])=>`
        <div style="margin-bottom:12px"><div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px"><b>${d}</b><span>${v} buyurtma</span></div>
        <div style="height:8px;background:#F3EEF0;border-radius:6px;overflow:hidden"><div style="height:100%;width:${Math.round(v/maxD*100)}%;background:linear-gradient(90deg,var(--gold),var(--red))"></div></div></div>`).join("");
  }

  /* Mobile cards unified */
  function renderMobileCards(){ renderRests(); renderCouriers(); renderUsers(); }

  /* =========================================================
     DETAIL DRAWER
     ========================================================= */
  function drawer(html){ $("#ddBody").innerHTML=html; $("#ddrawer").classList.add("open"); $("#dbackdrop").classList.add("open"); }
  function setHead(emoji,title,sub){ $("#ddAv").textContent=emoji; $("#ddTitle").textContent=title; $("#ddSub").textContent=sub; }
  function closeDrawer(){ $("#ddrawer").classList.remove("open"); $("#dbackdrop").classList.remove("open"); }

  /* =========================================================
     PAROL: ko'zcha (ko'rsatish/yashirish) + yangi parolni bir marta ko'rsatish
     ---------------------------------------------------------
     MUHIM: parollar bazada faqat bcrypt xeshi sifatida turadi (accounts.pass_hash),
     shuning uchun MAVJUD parolni qaytarib olib ko'rsatishning imkoni yo'q.
     Ko'zcha — admin HOZIR yozayotgan yangi parolni ko'rish uchun; saqlangach
     yangi parol bir marta katta qilib chiqadi, nusxa olib egasiga beriladi.
     ========================================================= */

  /* Parol maydoni HTML'i. `type="password"` MUHIM — ux-inputs.js aynan shu
     turdagi input'larni topib, yoniga 👁 ko'zcha qo'yadi (drawer dinamik
     ochilsa ham, MutationObserver orqali ishlaydi). */
  function passFieldHtml(id, label, ph){
    return '<div class="add-field"><label>'+esc(label)+'</label>'+
      '<input id="'+id+'" type="password" placeholder="'+esc(ph||"••••••")+'" autocomplete="new-password">'+
      '</div>';
  }

  /* Yangi parolni BIR MARTA ko'rsatish (nusxa olish tugmasi bilan) */
  function showNewPassOnce(who, pass){
    infoModal("🔑 Yangi parol",
      '<p style="font-size:13px;color:var(--grey);line-height:1.55;margin:0 0 12px">'+
        '<b>'+esc(who)+'</b> uchun yangi parol o\'rnatildi. Bu parol <b>faqat hozir</b> ko\'rinadi — '+
        'bazaga xeshlangan holda yoziladi va boshqa qayta ko\'rsatib bo\'lmaydi. Nusxa olib egasiga yetkazing.'+
      '</p>'+
      '<div class="np-box">'+
        '<div class="np-val" id="npVal">'+esc(pass)+'</div>'+
        '<button type="button" class="np-copy" id="npCopy">📋 Nusxa</button>'+
      '</div>');
    const btn=document.getElementById("npCopy");
    if(btn) btn.addEventListener("click",async()=>{
      let ok=false;
      try{ await navigator.clipboard.writeText(pass); ok=true; }catch(e){}
      if(!ok){
        /* Zaxira: matnni belgilab qo'yamiz, foydalanuvchi qo'lda nusxa oladi */
        try{
          const r=document.createRange(); r.selectNodeContents(document.getElementById("npVal"));
          const s=window.getSelection(); s.removeAllRanges(); s.addRange(r);
        }catch(e){}
      }
      btn.textContent = ok ? "✅ Olindi" : "Belgilandi — Ctrl+C";
      setTimeout(()=>{ btn.textContent="📋 Nusxa"; }, 2200);
    });
  }

  /* =========================================================
     RESTORAN DRAWER
     ========================================================= */
  /* ===== Hamkorlik shartnomasi (restoran) ===== */
  function showRestContract(r){
    infoModal("📄 Hamkorlik shartnomasi",
      '<div style="font-size:13.5px;line-height:1.6;color:var(--ink)">'+
      '<p><b>Tomonlar:</b> «Yetkaz.uz» platformasi (bundan keyin — Platforma) va <b>'+esc(r.name||"Restoran")+'</b> (bundan keyin — Restoran).</p>'+
      '<p><b>1. Shartnoma predmeti.</b> Platforma Restoran taomlarini o\'z ilovasi orqali sotishga joylashtiradi, buyurtmalarni qabul qiladi va kuryerlar orqali mijozga yetkazadi.</p>'+
      '<p><b>2. Komissiya.</b> Har bir yetkazilgan buyurtmadan Platforma <b>'+(r.commission!=null?r.commission:18)+'%</b> komissiya oladi. Qolgan summa Restoranга o\'tkaziladi.</p>'+
      '<p><b>3. Restoran majburiyatlari.</b> Sifatli va yangi mahsulot tayyorlash; ish vaqtiga rioya qilish; buyurtmani belgilangan muddatда tayyorlash; menyu va narxlarni to\'g\'ri ko\'rsatish.</p>'+
      '<p><b>4. Platforma majburiyatlari.</b> Buyurtmalarni yetkazib berish; kuryer biriktirish; to\'lovlarni o\'z vaqtida amalga oshirish; texnik qo\'llab-quvvatlash.</p>'+
      '<p><b>5. To\'lovlar.</b> Hisob-kitob har hafta/oy yakunida real yetkazilган buyurtmalар bo\'yicha amalga oshiriladi.</p>'+
      '<p><b>6. Shartnomani bekor qilish.</b> Har ikki tomon 7 kun oldin ogohlantirib shartnomани bekor qilishi mumkin. Qoidabuzarlikда Platforma bir tomonlama bekor qilishi mumkin.</p>'+
      '<p style="color:var(--grey);margin-top:10px">Ushbu shartnoma tizimда saqlanadi va istalган vaqtда qayta ko\'rilishi mumkin.</p>'+
      '</div>');
  }
  /* ===== Kuryer mehnat shartnomasi ===== */
  function showCourierContract(c){
    infoModal("📄 Kuryer bilan tuzilган shartnoma",
      '<div style="font-size:13.5px;line-height:1.6;color:var(--ink)">'+
      '<p><b>Tomonlar:</b> «Yetkaz.uz» Platformasi va kuryer <b>'+esc((c&&c.name)||"")+'</b>.</p>'+
      '<p><b>1. Ish tavsifi.</b> Kuryer restoranlardан buyurtмани olib, mijozга belgilangan manzilга o\'z vaqtida yetkazadi.</p>'+
      '<p><b>2. To\'lov.</b> Har bir yetkazилган buyurtма uchun <b>'+((c&&c.fee)?money(c.fee)+" so\'m":"shartnomада belgilanган")+'</b> haq to\'lanadi. Daromad faqat yetkazилган buyurtмалардан hisoblanadi.</p>'+
      '<p><b>3. Kuryer majburiyatlari.</b> Buyurtмани butun va toza holда yetkazish; xushmuomalalik; belgilanган vaqtга rioya; transport va telefon aloqasини ta\'minlash.</p>'+
      '<p><b>4. Platforma majburiyatlari.</b> Buyurtмалар bilan ta\'minlash; haqni o\'z vaqtида to\'lash; texnik yordam.</p>'+
      '<p><b>5. Restoranlar.</b> Kuryer bir nechta restoranга biriktirilishi mumkin (adminга ko\'ra).</p>'+
      '<p><b>6. Bekor qilish.</b> Qoidabuzarlik yoki 3 martадан ortiq shikoyатда shartnома bekor qilinishi mumkin.</p>'+
      '<p style="color:var(--grey);margin-top:10px">Shartnoма tizимда saqlanadi va admin tomonидан qayta ko\'rилиши mumkin.</p>'+
      '</div>');
  }
  /* ===== Restoranга mavjud kuryer biriktirish ===== */
  function assignCourierModal(r){
    var list=(typeof COURIERS!=="undefined"?COURIERS:[]);
    var rowsHtml=list.length? list.map(function(c){
      var rests=(c.rest||"").split(",").map(function(x){return x.trim();}).filter(Boolean);
      var already=rests.indexOf(r.name)>=0;
      return '<div class="fin-row" style="align-items:center;gap:10px"><span>🛵 <b>'+esc(c.name)+'</b><br><small style="color:var(--grey)">'+(esc(rests.join(", "))||"biriktirilмаган")+'</small></span>'+
        (already?'<b style="color:#16a34a">✓ Biriktirilган</b>':'<button class="assign-one" data-cid="'+c.id+'" data-clogin="'+c.login+'" style="background:#2563eb;color:#fff;border:none;border-radius:8px;padding:7px 13px;font-size:12px;font-weight:700;cursor:pointer">Biriktirish</button>')+'</div>';
    }).join(""):'<p style="color:var(--grey)">Avval «Kuryerlar» bo\'limidан kuryer qo\'shing.</p>';
    infoModal("🛵 "+esc(r.name)+" ga kuryer biriktirish",
      '<p style="color:var(--grey);font-size:13px;margin-bottom:10px">Saytдаги mavjud kuryerlардан birини tanlang. Bitta kuryer bir nechta restoranда ishlashi mumkin.</p>'+
      '<div style="display:flex;flex-direction:column;gap:10px">'+rowsHtml+'</div>');
    setTimeout(function(){
      document.querySelectorAll("#infoModal .assign-one").forEach(function(b){
        b.addEventListener("click",function(){
          var c=COURIERS.find(function(x){return x.id==b.dataset.cid||x.login===b.dataset.clogin;}); if(!c) return;
          var rests=(c.rest||"").split(",").map(function(x){return x.trim();}).filter(Boolean);
          if(rests.indexOf(r.name)<0) rests.push(r.name);
          c.rest=rests.join(", ");
          save(SK.couriers,COURIERS);
          if(typeof STORE!=="undefined" && STORE.editCourier) STORE.editCourier({login:c.login, rest:c.rest});
          var m=document.getElementById("infoModal"); if(m) m.remove();
          toast("✅ "+c.name+" — "+r.name+" ga biriktirilди");
          renderAll();
        });
      });
    },0);
  }

  function openRest(id){
    const r=RESTS.find(x=>x.id===id); if(!r) return;
    setHead(r.emoji, r.name, r.addr+" · "+r.phone);
    const pend=getPending(id,"rest");
    const myCouriers=COURIERS.filter(c=>c.rest===r.name);
    const beR=beRest(r);
    const openH=beR&&beR.openH!=null?beR.openH:9, closeH=beR&&beR.closeH!=null?beR.closeH:23;
    /* Restoran O'ZI belgilagan ish vaqti va HOZIRGI holati — admin ham ko'radi */
    const rOpen=restOpenNow(r), rHours=restHours(r);
    drawer(`
      <div class="dd-sec"><h4>Ishlash darajasi</h4>
        <div class="kv">
          <div class="k"><span>Reyting</span><b class="star">★ ${r.rating}</b></div>
          <div class="k"><span>Buyurtmalar</span><b>${money(r.orders)}</b></div>
          <div class="k"><span>Holati</span><b>${r.status==="ok"?"Faol":"Nazoratda"}</b></div>
          <div class="k"><span>Kuryerlar</span><b>${myCouriers.length}</b></div>
        </div></div>
      ${(()=>{ const curPct=(r.commission!=null?r.commission:18);
               /* Ko'rsatilgan foiz — HAQIQIY yig'indidan (eski buyurtmalar boshqa
                  foiz bilan muhrlangan bo'lishi mumkin). Joriy foiz alohida yoziladi. */
               const effPct=r.rev?Math.round(r.siteCut/r.rev*100):curPct;
               const same=(effPct===curPct);
        return `<div class="dd-sec"><h4>Moliya${same?` (${curPct}% komissiya)`:` (joriy ${curPct}%, o'rtacha ${effPct}%)`}</h4>
        <div class="fin-row"><span>Aylanma (yetkazilgan ${money(r.orders||0)} ta)</span><b>${money(r.rev)} so'm</b></div>
        <div class="fin-row"><span>Restoranga${same?` (${100-curPct}%)`:''}</span><b>${money(r.restGets)} so'm</b></div>
        <div class="fin-row tot"><span>Menga${same?` (${curPct}%)`:` (${effPct}%)`}</span><b>${money(r.siteCut)} so'm</b></div>
      </div>`; })()}
      <div class="dd-sec"><h4>Kirish ma'lumotlari</h4>
        <div class="kv">
          <div class="k"><span>Login</span><b class="mono">${r.login}</b></div>
          <div class="k"><span>Parol</span><b class="mono">••••••</b></div>
        </div>
        <p style="color:var(--grey);font-size:12px;margin-top:6px">Parol xavfsizlik uchun xeshlangan holda saqlanadi — uni ko'rib bo'lmaydi. Kerak bo'lsa quyida yangisini o'rnating.</p></div>
      <div class="dd-sec"><h4>Qo'shimcha ma'lumot</h4>
        <div class="kv">
          <div class="k"><span>Egasi</span><b>${esc((beR&&beR.owner)||'—')}</b></div>
          <div class="k"><span>Email</span><b>${esc((beR&&beR.email)||'—')}</b></div>
          <div class="k"><span>Manzil</span><b>${esc((beR&&beR.addr)||r.addr||'—')}</b></div>
          <div class="k"><span>Ish vaqti</span><b>${esc(rHours)} <span class="yz-openbadge ${rOpen?'is-open':'is-closed'}">${rOpen?'🟢 Hozir ochiq':'🔴 Hozir yopiq'}</span></b></div>
          <div class="k"><span>Hudud</span><b>${esc((beR&&beR.area)||'—')}</b></div>
        </div>
        ${(beR&&beR.descr)?`<p style="color:var(--grey);font-size:13px;margin-top:8px">${esc(beR.descr)}</p>`:''}
      </div>
      <div class="dd-sec"><h4>✏️ Tahrirlash (barcha ma'lumot)</h4>
        <div class="add-row">
          <div class="add-field" style="flex:0 0 84px"><label>Emoji</label><input id="edrEmoji" value="${esc(r.emoji||'🏪')}" maxlength="4" style="text-align:center;font-size:18px"></div>
          <div class="add-field" style="flex:1"><label>Nomi</label><input id="edrName" value="${esc(r.name)}"></div>
        </div>
        <div class="add-field"><label>Nomi (kirill)</label><input id="edrNameCyr" value="${esc(r.nameCyr||(beR&&beR.nameCyr)||'')}" placeholder="Ixtiyoriy"></div>
        <div class="add-field"><label>Telefon</label><input id="edrPhone" value="${esc((r.phone!=null?r.phone:(beR&&beR.phone))||'')}"></div>
        <div class="add-field"><label>Komissiya (%)</label><input id="edrComm" type="number" value="${r.commission!=null?r.commission:18}"></div>
        <div class="add-row">
          <div class="add-field"><label>Ochilish (soat)</label><input id="edrOpen" type="number" min="0" max="23" value="${openH}"></div>
          <div class="add-field"><label>Yopilish (soat)</label><input id="edrClose" type="number" min="0" max="24" value="${closeH}"></div>
        </div>
        <p style="color:var(--grey);font-size:12px;margin:-2px 0 8px">Tungi smena mumkin (20 → 02), bir xil son = 24 soat. Vaqt Toshkent (UTC+5) bo'yicha.</p>
        <div class="add-row">
          <div class="add-field"><label>Yetkazish vaqti (daqiqa)</label><input id="edrEta" type="number" min="5" max="120" value="${r.eta||(beR&&beR.eta)||20}"></div>
          <div class="add-field"><label>Masofa (matn)</label><input id="edrDist" value="${esc(r.dist||(beR&&beR.dist)||'')}" placeholder="2.5 km"></div>
        </div>
        <div class="add-field"><label>Kategoriya / kalit so'z (kw)</label><input id="edrKw" value="${esc(r.kw||(beR&&beR.kw)||'')}" placeholder="milliy / fastfood / shirinlik"></div>
        <div class="add-field"><label>Ish vaqti (matn)</label><input id="edrHours" value="${esc(r.hours||(beR&&beR.hours)||'')}" placeholder="Masalan: Har kuni 9:00–23:00"></div>
        <div class="add-field"><label>Egasi (F.I.Sh)</label><input id="edrOwner" value="${esc(r.owner||(beR&&beR.owner)||'')}"></div>
        <div class="add-field"><label>Email</label><input id="edrEmail" value="${esc(r.email||(beR&&beR.email)||'')}" placeholder="email@example.com"></div>
        <div class="add-field"><label>Manzil</label><input id="edrAddr" value="${esc(r.addr||(beR&&beR.addr)||'')}"></div>
        <div class="add-field"><label>Yetkazish hududi</label><input id="edrArea" value="${esc(r.area||(beR&&beR.area)||'')}"></div>
        <div class="add-field"><label>Tavsif</label><input id="edrDescr" value="${esc(r.descr||(beR&&beR.descr)||'')}"></div>
        ${passFieldHtml("edrPass","Yangi parol (bo'sh = o'zgarmaydi)")}
        <button class="dd-action-btn" id="edrSave" style="background:#16a34a;color:#fff;margin-top:6px">💾 Hammasini saqlash</button>
      </div>
      <div class="dd-sec">
        <button class="dd-action-btn" id="assignCourBtn" style="background:#2563eb;color:#fff;width:100%;margin-bottom:8px">🛵 Kuryer biriktirish</button>
        <button class="dd-action-btn" id="restContractBtn" style="background:#f4f1f2;color:var(--ink);width:100%;margin-bottom:8px">📄 Shartnoma haqida</button>
        ${pend ? `
          <div class="pending-warn">
            <span>⏳</span>
            <div>
              <b>Shartnoma bekor qilingan</b>
              <p>${formatCountdown(pend.deleteAt-Date.now())} keyin to'liq o'chiriladi</p>
            </div>
          </div>
          <button class="dd-action-btn dd-restore" data-id="${id}" data-type="rest" style="margin-top:10px">↩ Shartnomani tiklash</button>
        ` : `
          <button class="dd-action-btn dd-danger" data-id="${id}" data-type="rest">🗑 Restoranni o'chirish</button>
        `}
      </div>`);
    const acBtn=$("#assignCourBtn"); if(acBtn) acBtn.addEventListener("click",()=>assignCourierModal(r));
    const rcBtn=$("#restContractBtn"); if(rcBtn) rcBtn.addEventListener("click",()=>showRestContract(r));

    // Hodisalar
    const delBtn=$("#ddBody .dd-danger");
    if(delBtn) delBtn.addEventListener("click",()=>{ closeDrawer(); cancelRest(id); });
    const restBtn=$("#ddBody .dd-restore");
    if(restBtn) restBtn.addEventListener("click",()=>{ restoreItem(id,"rest"); closeDrawer(); });
    const saveBtn=$("#edrSave");
    if(saveBtn) saveBtn.addEventListener("click",()=>{
      const val=id=>{ const el=document.getElementById(id); return el?el.value.trim():""; };
      const name=val("edrName")||r.name;
      const phone=val("edrPhone");
      const comm=Math.max(0,Math.min(50,parseInt($("#edrComm").value,10)||18));
      /* 0–23 / 0–24: tungi smena (20→02) va 24 soat (9→9) ham ruxsat etiladi.
         `|| 9` ishlatilmaydi — 0 (yarim tun) haqiqiy qiymat. */
      const rawOh=parseInt($("#edrOpen").value,10), rawCh=parseInt($("#edrClose").value,10);
      const oh=Math.max(0,Math.min(23,Number.isFinite(rawOh)?rawOh:9));
      const ch=Math.max(0,Math.min(24,Number.isFinite(rawCh)?rawCh:23));
      const rawEta=parseInt($("#edrEta")&&$("#edrEta").value,10);
      const eta=Math.max(5,Math.min(120,Number.isFinite(rawEta)?rawEta:20));
      const emojiV=val("edrEmoji")||r.emoji||"🏪";
      const emailV=val("edrEmail");
      if(emailV && window.YZ_EMAIL && !YZ_EMAIL.valid(emailV)){ toast("Email noto'g'ri formatda"); return; }
      const pass=($("#edrPass").value||"").trim();
      const oldName=r.name;
      r.name=name; r.phone=phone; r.commission=comm; r.emoji=emojiV; r.addr=val("edrAddr")||r.addr;
      recompute(); save(SK.rests,RESTS);
      if(typeof STORE!=="undefined" && STORE.editRestaurant){
        const body={login:r.login,name:name,phone:phone,commission:comm,openH:oh,closeH:ch,emoji:emojiV,
          nameCyr:val("edrNameCyr"), kw:val("edrKw"), eta:eta, dist:val("edrDist"), hours:val("edrHours"),
          owner:val("edrOwner"), email:emailV, addr:val("edrAddr"), area:val("edrArea"), descr:val("edrDescr")};
        if(pass) body.pass=pass;
        Promise.resolve(STORE.editRestaurant(body)).then(function(){
          try{ if(STORE.fetchAdminRestaurants) return STORE.fetchAdminRestaurants(); }catch(e){}
        }).then(function(){ try{ syncEntitiesFromBackend(); renderAll(); }catch(e){} });
      }
      closeDrawer(); renderAll();
      toast(`✅ ${name} — barcha ma'lumot saqlandi${pass?" (parol o'zgartirildi)":""}`);
      if(pass) showNewPassOnce(name, pass);
      if(name!==oldName) COURIERS.forEach(c=>{ if(c.rest===oldName) c.rest=name; });
    });
  }

  /* ===== RESTORANNI O'CHIRISH — DARHOL va ISHONCHLI =====
     Ilgari o'chirish localStorage'даги 6 soatlik "pending" ga tushardi va
     haqiqiy o'chirish FAQAT admin brauzeri o'sha payt ochiq bo'lsa ishlardi.
     Brauzer yopilsa yoki boshqa qurilmadan qaralsa — restoran qaytib kelaverardi
     (Versal shundan ketmayotgan edi). Endi tugma bosilishi bilan backenddan
     to'g'ridan-to'g'ri o'chiriladi. */
  async function cancelRest(id){
    const r=RESTS.find(x=>x.id===id); if(!r) return;
    confirmModal({
      icon: "🗑",
      title: "Restoranni o'chirish",
      desc: `<b>${esc(r.name)}</b> restorani butunlay o'chirilsinmi?<br><br>
             ❌ Bu amalni ortga qaytarib bo'lmaydi.<br>
             Restoran akkaunti, taomlari va e'lonlari o'chadi (buyurtma tarixi qoladi).`,
      confirmLabel: "Ha, o'chirish",
      confirmClass: "confirm-danger",
      onConfirm: async ()=>{
        if(typeof STORE==="undefined" || !STORE.deleteRestaurant){ toast("Serverga ulanib bo'lmadi"); return; }
        const res=await STORE.deleteRestaurant(r.login);
        if(res && res.error){ toast(res.error); return; }
        /* Mahalliy ro'yxatдан ham darhol olib tashlaymiz (backend = manba) */
        RESTS=RESTS.filter(x=>x.id!==id); save(SK.rests,RESTS);
        PENDING=PENDING.filter(p=>!(p.id===id&&p.type==="rest")); save(SK.pending,PENDING);
        if(typeof STORE.fetchCouriers==="function") try{ await STORE.fetchCouriers(); }catch(e){}
        renderAll();
        toast(`✅ ${r.name} o'chirildi`);
      }
    });
  }

  /* =========================================================
     RESTORAN QO'SHISH MODALI
     ========================================================= */
  function openAddRest(){
    const addModal = document.getElementById("addRestModal");
    if(addModal) addModal.classList.add("open");
    const backdrop = document.getElementById("addRestBackdrop");
    if(backdrop) backdrop.classList.add("open");
  }
  function closeAddRest(){
    const m=document.getElementById("addRestModal");
    const b=document.getElementById("addRestBackdrop");
    if(m) m.classList.remove("open");
    if(b) b.classList.remove("open");
  }
  function submitAddRest(){
    const f=(id)=>{ const el=document.getElementById(id); return el?el.value.trim():""; };
    const name=f("arName"), emoji=f("arEmoji")||"🏪", phone=f("arPhone"), addr=f("arAddr");
    const login=f("arLogin"), pass=f("arPass"), commission=parseFloat(f("arComm"))||18;
    const owner=f("arOwner"), hours=f("arHours");

    if(!vName(name)){ arErr("Restoran nomini to'g'ri kiriting (kamida 2 harf, raqam emas)"); return; }
    /* Egasining F.I.Sh. — MAJBURIY (kim bilan shartnoma tuzilayotgani aniq bo'lsin) */
    if(!vName(owner)){ arErr("Egasining F.I.Sh. ni to'g'ri kiriting (kamida 2 harf, raqam emas)"); return; }
    if(!(window.YZ_PHONE && YZ_PHONE.valid(phone))){ arErr("Telefon raqamini to'g'ri kiriting: +998 XX XXX XX XX"); return; }
    var arEmailV=f("arEmail"); if(arEmailV && window.YZ_EMAIL && !YZ_EMAIL.valid(arEmailV)){ arErr("Email noto'g'ri formatda"); return; }
    if(!addr || addr.length<3){  arErr("Manzilni to'liq kiriting"); return; }
    /* Ish vaqti — faqat "08:00 - 23:00" ko'rinishida (raqam va ikki nuqta) */
    if(hours && !window.YZ_HOURS.valid(hours)){ arErr("Ish vaqtini faqat raqam va ikki nuqta bilan kiriting: 08:00 - 23:00"); return; }
    if(!vLogin(login)){ arErr("Login kamida 3 belgi — faqat harf, raqam yoki _"); return; }
    if(!vPass(pass)){  arErr("Parol kamida 4 belgi bo'lsin"); return; }
    var arAgree=document.getElementById("arAgree");
    if(arAgree && !arAgree.checked){ arErr("Shartnoma shartlarini o'qib, roziligingizni belgilang"); return; }
    if(RESTS.find(r=>r.login===login)){ arErr("Bu login allaqachon band!"); return; }

    /* SERVER birinchi — restoran akkaunti HAQIQATAN yaratilgach ro'yxatga qo'shamiz
       (aks holda ishlamaydigan restoran chiqardi). */
    const btn=document.getElementById("arSubmit"); if(btn) btn.disabled=true;
    if(typeof STORE==="undefined" || !STORE.addRestaurant){ arErr("Tizim tayyor emas"); if(btn) btn.disabled=false; return; }
    STORE.addRestaurant({name,emoji,phone,addr,login,pass,commission, owner, email:f("arEmail"), hours, area:f("arArea"), descr:f("arDescr")}).then(function(r){
      if(btn) btn.disabled=false;
      if(!r || r.error){ arErr((r&&r.error)||"Restoran qo'shilmadi — qayta urinib ko'ring"); return; }
      const newId = Math.max(0,...RESTS.map(r=>r.id).concat([0])) + 1;
      RESTS.push({ id:newId, name, emoji, phone, addr, login,
        rev:0, orders:0, rating:0, status:"ok", siteCut:0, restGets:0,
        joinedAt:new Date().toLocaleDateString("ru-RU"), commission });
      recompute(); save(SK.rests, RESTS);
      closeAddRest(); renderAll();
      toast(`✅ ${name} muvaffaqiyatli qo'shildi!`);
      ["arName","arEmoji","arPhone","arAddr","arLogin","arPass","arComm"].forEach(id=>{
        const el=document.getElementById(id);
        if(el) el.value = id==="arEmoji"?"🏪":id==="arComm"?"18":"";
      });
      if(document.getElementById("arAgree")) document.getElementById("arAgree").checked=false;
      document.getElementById("arErr").textContent="";
    });
  }
  function arErr(msg){ const el=document.getElementById("arErr"); if(el) el.textContent=msg; }

  /* =========================================================
     KURYER DRAWER
     ========================================================= */
  function openCourier(id){
    const c=COURIERS.find(x=>x.id===id); if(!c) return;
    setHead(c.emoji, c.name, c.phone);
    const pend=getPending(id,"courier");
    const beC=(typeof STORE!=="undefined"&&STORE.couriers)?STORE.couriers().find(x=>x.login===c.login):null;
    const be=beC||{};
    const lvStatus=be.leaveStatus||c.leaveStatus||'none';
    const onLeave=be.onLeave!=null?be.onLeave:c.onLeave;
    const leaveReason=be.leaveReason||c.leaveReason||'';
    /* Ish vaqti — backend yozuvidan (admin belgilaydi), Toshkent vaqti bo'yicha */
    const cHours=YZ_TIME.courHours(beC||c);
    const cOnShift=YZ_TIME.courOpen(beC||c);
    const holatTxt=onLeave?'🚪 Ishdan javobda':(lvStatus==='pending'?'⏳ Javob so\'rovi kutilmoqda':(cOnShift?'🟢 Ishda':'🌙 Ish vaqti emas'));
    const holatCol=onLeave?'#d97706':(lvStatus==='pending'?'#b45309':(cOnShift?'#16a34a':'#9ca3af'));
    drawer(`
      <div class="dd-sec"><h4>Ish ma'lumotlari</h4>
        <div class="kv">
          <div class="k"><span>Restoranlar</span><b>${esc(c.rest)||"—"}</b></div>
          <div class="k"><span>Reyting</span><b class="star">★ ${c.rating}</b></div>
          <div class="k"><span>Yetkazgan</span><b>${money(c.deliveries)} ta</b></div>
          <!-- Xarajat: shu kuryerga haqiqatda to'langan haqlar yig'indisi
               (har buyurtmaga yetkazilgan paytdagi haq muhrlangan) -->
          <div class="k"><span>1 yetkazish haqi</span><b>${money(c.fee||0)} so'm</b></div>
          <div class="k"><span>Jami to'langan</span><b style="color:#c2410c">${money(c.earn||0)} so'm</b></div>
          <div class="k"><span>Telefon</span><b>${esc(c.phone)||"—"}</b></div>
          <div class="k"><span>Ish vaqti</span><b>${esc(cHours)}</b></div>
          <div class="k"><span>Holati</span><b style="color:${holatCol}">${holatTxt}</b></div>
        </div>
        ${(onLeave||lvStatus==='denied')&&leaveReason?`<p style="color:#b45309;font-size:13px;margin-top:8px">Javob sababi: <b>${esc(leaveReason)}</b></p>`:''}
        ${lvStatus==='pending'?`
          <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:12px;padding:12px;margin-top:10px">
            <b style="color:#b45309">🚪 Ishdan javob so'rovi</b>
            <p style="color:var(--grey);font-size:13px;margin:4px 0 10px">Kuryer ishdan javob so'rayapti${leaveReason?`: <b>${esc(leaveReason)}</b>`:''}. Tasdiqlasangiz — javobga chiqadi va faol buyurtmalari boshqa kuryerga o'tadi.</p>
            <div style="display:flex;gap:8px">
              <button class="dd-action-btn" id="cLvApprove" style="background:#16a34a;color:#fff;flex:1">✅ Tasdiqlash</button>
              <button class="dd-action-btn" id="cLvDeny" style="background:#ef4444;color:#fff;flex:1">❌ Rad etish</button>
            </div>
          </div>`:''}
      </div>
      <div class="dd-sec"><h4>Haq (shartnoma)</h4>
        <div class="fin-row"><span>Bitta yetkazish haqi</span><b>${c.fee?money(c.fee)+" so'm":"belgilanmagan"}</b></div>
        <p style="color:var(--grey);font-size:12px;margin-top:6px">Kuryerning umumiy daromadi faqat kuryerning o'ziga ko'rinadi.</p>
      </div>
      <div class="dd-sec"><h4>Kirish</h4>
        <div class="kv">
          <div class="k"><span>Login</span><b class="mono">${c.login}</b></div>
          <div class="k"><span>Parol</span><b class="mono">••••••</b></div>
        </div>
        <p style="color:var(--grey);font-size:12px;margin-top:6px">Parol xavfsizlik uchun xeshlangan holda saqlanadi — uni ko'rib bo'lmaydi. Kerak bo'lsa quyida yangisini o'rnating.</p></div>
      <div class="dd-sec"><h4>Qo'shimcha ma'lumot</h4>
        <div class="kv">
          <div class="k"><span>Transport</span><b>${esc((beC&&beC.transport)||'—')}</b></div>
          <div class="k"><span>Manzil</span><b>${esc((beC&&beC.address)||'—')}</b></div>
          <div class="k"><span>Email</span><b>${esc((beC&&beC.email)||'—')}</b></div>
          <div class="k"><span>Tug'ilgan</span><b>${esc((beC&&beC.birthdate)||'—')}</b></div>
        </div></div>
      <div class="dd-sec"><h4>✏️ Tahrirlash (barcha ma'lumot)</h4>
        <div class="add-row">
          <div class="add-field" style="flex:0 0 84px"><label>Emoji</label><input id="edcEmoji" value="${esc(c.emoji||'🛵')}" maxlength="4" style="text-align:center;font-size:18px"></div>
          <div class="add-field" style="flex:1"><label>Ism</label><input id="edcName" value="${esc(c.name)}"></div>
        </div>
        <div class="add-field"><label>Telefon</label><input id="edcPhone" type="tel" value="${esc(c.phone||'')}"></div>
        <div class="add-field"><label>Restoranlar (vergul bilan ajrating)</label><input id="edcRest" value="${esc(c.rest)||''}" placeholder="Restoran nomi"></div>
        <div class="add-field"><label>Bir yetkazish haqi (so'm)</label><input id="edcFee" type="number" value="${c.fee||0}"></div>
        <div style="display:flex;gap:10px">
          <div class="add-field" style="flex:1"><label>Ish boshi (soat)</label><input id="edcOpenH" type="number" min="0" max="23" value="${(beC&&beC.openH!=null)?beC.openH:(c.openH!=null?c.openH:8)}"></div>
          <div class="add-field" style="flex:1"><label>Ish oxiri (soat)</label><input id="edcCloseH" type="number" min="0" max="24" value="${(beC&&beC.closeH!=null)?beC.closeH:(c.closeH!=null?c.closeH:22)}"></div>
        </div>
        <p style="color:var(--grey);font-size:12px;margin:-2px 0 8px">Tungi smena mumkin (20 → 02), bir xil son = 24 soat. Vaqt Toshkent (UTC+5) bo'yicha.</p>
        <div class="add-row">
          <div class="add-field" style="flex:1"><label>Transport</label><input id="edcTransport" value="${esc((beC&&beC.transport)||'')}" placeholder="Mototsikl / Avto"></div>
          <div class="add-field" style="flex:1"><label>Avto raqami</label><input id="edcPlate" value="${esc((beC&&beC.plate)||'')}" placeholder="01 A 123 BC"></div>
        </div>
        <div class="add-field"><label>Manzil</label><input id="edcAddress" value="${esc((beC&&beC.address)||'')}"></div>
        <div class="add-field"><label>Email</label><input id="edcEmail" type="email" value="${esc((beC&&beC.email)||'')}" placeholder="email@example.com"></div>
        <div class="add-row">
          <div class="add-field" style="flex:1"><label>Tug'ilgan sana</label><input id="edcBirth" type="date" value="${esc((beC&&beC.birthdate)||'')}"></div>
          <div class="add-field" style="flex:1"><label>Pasport</label><input id="edcPassport" value="${esc((beC&&beC.passport)||'')}" placeholder="AA 1234567"></div>
        </div>
        ${passFieldHtml("edcPass","Yangi parol (bo'sh = o'zgarmaydi)")}
        <button class="dd-action-btn" id="edcSave" style="background:#16a34a;color:#fff;margin-top:6px">💾 Hammasini saqlash</button>
      </div>
      <div class="dd-sec">
        <button class="dd-action-btn" id="courContractBtn" style="background:#f4f1f2;color:var(--ink);width:100%;margin-bottom:8px">📄 Kuryer bilan tuzilgan shartnoma</button>
        ${pend ? `
          <div class="pending-warn">
            <span>⏳</span>
            <div><b>Ishdan bo'shatish kutilmoqda</b>
            <p>${formatCountdown(pend.deleteAt-Date.now())} keyin to'liq o'chiriladi</p></div>
          </div>
          <button class="dd-action-btn dd-restore" data-id="${id}" data-type="courier" style="margin-top:10px">↩ Qaytarib olish</button>
        ` : `
          <button class="dd-action-btn dd-danger" data-id="${id}" data-type="courier">🗑 Kuryerni o'chirish</button>
        `}
      </div>`);
    const ccBtn=$("#courContractBtn"); if(ccBtn) ccBtn.addEventListener("click",()=>showCourierContract(c));

    /* Ishdan-javob so'rovini tasdiqlash / rad etish */
    async function decideLeave(approve){
      if(typeof STORE==="undefined"||!STORE.courierLeaveDecision){ toast("Serverga ulanib bo'lmadi"); return; }
      const r=await STORE.courierLeaveDecision(c.login, approve);
      if(r && !r.error){
        if(typeof STORE.fetchCouriers==="function") await STORE.fetchCouriers();
        closeDrawer(); renderAll();
        toast(approve?("✅ Javob berildi"+(r.reassigned?(" · "+r.reassigned+" ta buyurtma boshqa kuryerga o'tdi"):"")):"❌ So'rov rad etildi");
      } else toast((r&&r.error)||"Serverga ulanib bo'lmadi");
    }
    const apprBtn=$("#cLvApprove"); if(apprBtn) apprBtn.addEventListener("click",()=>decideLeave(true));
    const denyBtn=$("#cLvDeny"); if(denyBtn) denyBtn.addEventListener("click",()=>decideLeave(false));

    const delBtn=$("#ddBody .dd-danger");
    if(delBtn) delBtn.addEventListener("click",()=>{ closeDrawer(); dismissCourier(id); });
    const restBtn=$("#ddBody .dd-restore");
    if(restBtn) restBtn.addEventListener("click",()=>{ restoreItem(id,"courier"); closeDrawer(); });
    const saveBtn=$("#edcSave");
    if(saveBtn) saveBtn.addEventListener("click",()=>{
      const name=($("#edcName").value||"").trim()||c.name;
      const phone=($("#edcPhone").value||"").trim();
      const rest=($("#edcRest").value||"").trim();
      const fee=Math.max(0,parseInt(($("#edcFee").value||"").replace(/\D/g,""),10)||0);
      /* Tungi smena (22 → 06) va 24 soat (8 → 8) ham qo'llab-quvvatlanadi —
         hours.js dagi qoida bilan bir xil. `|| 0` ishlatilmaydi: 0 haqiqiy soat. */
      const rawO=parseInt(($("#edcOpenH")||{}).value,10), rawC=parseInt(($("#edcCloseH")||{}).value,10);
      const openH=Math.max(0,Math.min(23,Number.isFinite(rawO)?rawO:8));
      const closeH=Math.max(0,Math.min(24,Number.isFinite(rawC)?rawC:22));
      const pass=($("#edcPass").value||"").trim();
      const val=id=>{ const el=document.getElementById(id); return el?el.value.trim():""; };
      const emailV=val("edcEmail");
      if(emailV && window.YZ_EMAIL && !YZ_EMAIL.valid(emailV)){ toast("Email noto'g'ri formatda"); return; }
      const emojiV=val("edcEmoji")||c.emoji||"🛵";
      c.name=name; c.phone=phone; c.rest=rest; c.fee=fee; c.openH=openH; c.closeH=closeH; c.emoji=emojiV;
      recompute(); save(SK.couriers,COURIERS);
      if(typeof STORE!=="undefined" && STORE.editCourier){
        const body={login:c.login,name:name,phone:phone,rest:rest,fee:fee,openH:openH,closeH:closeH,emoji:emojiV,
          transport:val("edcTransport"), plate:val("edcPlate"), address:val("edcAddress"),
          email:emailV, birthdate:val("edcBirth"), passport:val("edcPassport")};
        if(pass) body.pass=pass;
        Promise.resolve(STORE.editCourier(body)).then(function(){
          try{ if(STORE.fetchCouriers) return STORE.fetchCouriers(); }catch(e){}
        }).then(function(){ try{ syncEntitiesFromBackend(); renderAll(); }catch(e){} });
      }
      closeDrawer(); renderAll();
      toast(`✅ ${name} — barcha ma'lumot saqlandi${pass?" (parol o'zgartirildi)":""}`);
      if(pass) showNewPassOnce(name, pass);
    });
  }

  /* Kuryerni o'chirish — restorandagidek DARHOL (localStorage pending emas) */
  async function dismissCourier(id){
    const c=COURIERS.find(x=>x.id===id); if(!c) return;
    confirmModal({
      icon: "🗑",
      title: "Kuryerni o'chirish",
      desc: `<b>${esc(c.name)}</b> kuryer butunlay o'chirilsinmi?<br><br>
             ❌ Bu amalni ortga qaytarib bo'lmaydi.<br>
             Kuryer akkaunti o'chadi (yetkazgan buyurtmalari tarixда qoladi).`,
      confirmLabel: "Ha, o'chirish",
      confirmClass: "confirm-danger",
      onConfirm: async ()=>{
        if(typeof STORE==="undefined" || !STORE.deleteCourier){ toast("Serverga ulanib bo'lmadi"); return; }
        const res=await STORE.deleteCourier(c.login);
        if(res && res.error){ toast(res.error); return; }
        COURIERS=COURIERS.filter(x=>x.id!==id); save(SK.couriers,COURIERS);
        PENDING=PENDING.filter(p=>!(p.id===id&&p.type==="courier")); save(SK.pending,PENDING);
        if(typeof STORE.fetchCouriers==="function") try{ await STORE.fetchCouriers(); }catch(e){}
        renderAll();
        toast(`✅ ${c.name} o'chirildi`);
      }
    });
  }

  /* Tiklash (shartnoma qaytarish) */
  function restoreItem(id, type){
    PENDING = PENDING.filter(p=>!(p.id===id&&p.type===type));
    save(SK.pending, PENDING);
    renderAll();
    toast("✅ Muvaffaqiyatli tiklandi!");
  }

  /* =========================================================
     KURYER QO'SHISH
     ========================================================= */
  function openAddCourier(){
    // Restoran select ni to'ldirish
    const sel=document.getElementById("acRest");
    if(sel) sel.innerHTML=RESTS.map(r=>`<option value="${r.name}">${r.emoji} ${r.name}</option>`).join("");
    const m=document.getElementById("addCourierModal");
    const b=document.getElementById("addCourierBackdrop");
    if(m) m.classList.add("open");
    if(b) b.classList.add("open");
  }
  function closeAddCourier(){
    const m=document.getElementById("addCourierModal");
    const b=document.getElementById("addCourierBackdrop");
    if(m) m.classList.remove("open");
    if(b) b.classList.remove("open");
  }
  function submitAddCourier(){
    const f=(id)=>{ const el=document.getElementById(id); return el?el.value.trim():""; };
    const name=f("acName"), phone=f("acPhone"), rest=f("acRest"), login=f("acLogin"), pass=f("acPass");
    const fee=parseInt((f("acFee")||"").replace(/\D/g,""),10)||0;

    if(!vName(name)){  acErr("Ismni to'g'ri kiriting (kamida 2 harf, raqam emas)"); return; }
    if(!(window.YZ_PHONE && YZ_PHONE.valid(phone))){ acErr("Telefon raqamini to'g'ri kiriting: +998 XX XXX XX XX"); return; }
    var acEmailV=f("acEmail"); if(acEmailV && window.YZ_EMAIL && !YZ_EMAIL.valid(acEmailV)){ acErr("Email noto'g'ri formatda"); return; }
    if(!fee){   acErr("Bir yetkazish haqini kiriting"); return; }
    if(!vLogin(login)){ acErr("Login kamida 3 belgi — faqat harf, raqam yoki _"); return; }
    if(!vPass(pass)){  acErr("Parol kamida 4 belgi bo'lsin"); return; }
    var acAgree=document.getElementById("acAgree");
    if(acAgree && !acAgree.checked){ acErr("Shartnoma shartlarini o'qib, roziligingizni belgilang"); return; }
    if(COURIERS.find(c=>c.login===login)){ acErr("Bu login band!"); return; }

    /* SERVER birinchi — akkaunt HAQIQATAN yaratilgach ro'yxatga qo'shamiz.
       Aks holda "qo'shildi" deb ko'rsatib, aslida ishlamaydigan kuryer chiqardi. */
    const btn=document.getElementById("acSubmit"); if(btn) btn.disabled=true;
    if(typeof STORE==="undefined" || !STORE.addCourier){ acErr("Tizim tayyor emas"); if(btn) btn.disabled=false; return; }
    STORE.addCourier({name,phone,rest,login,pass,fee, transport:f("acTransport"), birthdate:f("acBirth"), address:f("acAddress"), email:f("acEmail")}).then(function(r){
      if(btn) btn.disabled=false;
      if(!r || r.error){ acErr((r&&r.error)||"Kuryer qo'shilmadi — qayta urinib ko'ring"); return; }
      /* Server tasdiqladi — endi lokal ro'yxatga */
      const newId = Math.max(0,...COURIERS.map(c=>c.id).concat([0])) + 1;
      COURIERS.push({ id:newId, name, emoji:"🛵", phone, rest, login, fee,
        deliveries:0, rating:0, earn:0, status:"ok", joinedAt:new Date().toLocaleDateString("ru-RU") });
      recompute(); save(SK.couriers, COURIERS);
      closeAddCourier(); renderAll();
      toast(`✅ ${name} kuryerlar ro'yxatiga qo'shildi!`);
      ["acName","acPhone","acFee","acLogin","acPass"].forEach(id=>{ const el=document.getElementById(id); if(el) el.value=""; });
      if(document.getElementById("acAgree")) document.getElementById("acAgree").checked=false;
      document.getElementById("acErr").textContent="";
    });
  }
  function acErr(msg){ const el=document.getElementById("acErr"); if(el) el.textContent=msg; }

  /* =========================================================
     USER DRAWER
     ========================================================= */
  /* created_at bazaga UTC yoziladi — Toshkent vaqtiga o'giramiz (hours.js).
     Ilgari UTC satr shundayligicha ko'rsatilardi va vaqt 5 soat orqada edi. */
  function fmtDateTime(o){
    return YZ_TIME.fmtDateTime((o&&o.created_at)||"") || (o&&o.time) || "—";
  }
  function showTopRestModal(agg){
    if(!agg) return;
    /* Komissiya RESTS'дан (adminRestaurants — komissiya bilan); ommaviy
       bootstrap'да komissiya yo'q. rating/ish vaqti uchun bootstrap ham yaraydi. */
    var restRec=RESTS.find(function(x){return x.name===agg.name;})||{};
    var beR=((typeof STORE!=="undefined"&&STORE.restaurants)?STORE.restaurants():[]).find(function(x){return x.name===agg.name;})||{};
    /* Komissiya/xarajat/foyda renderDash da har buyurtmaning O'Z shartlari
       bo'yicha yig'ilgan — bu yerda qayta hisoblamaymiz (mos kelishi uchun). */
    var comm=(restRec.commission!=null?restRec.commission:18);
    var site=agg.comm!=null?agg.comm:Math.round(agg.rev*comm/100);
    var effPct=agg.rev?Math.round(site/agg.rev*100):comm;
    var sorted=Object.entries(agg.items||{}).sort(function(a,b){return b[1]-a[1];});
    var topItem=sorted[0];
    /* Taomlar endi DONA bo'yicha sanaladi (buyurtma tarkibidan) */
    var itemsList=sorted.length?sorted.map(function(e){return '<div class="fin-row"><span>'+esc(e[0])+'</span><b>'+e[1]+' dona</b></div>';}).join(""):'<p style="color:var(--grey)">—</p>';
    var row=function(k,v){return '<div style="display:flex;justify-content:space-between;gap:10px;font-size:14px"><span style="color:var(--grey)">'+k+'</span><b>'+v+'</b></div>';};
    infoModal("🏪 "+esc(agg.name),
      '<div style="display:flex;flex-direction:column;gap:10px">'+
      row("Reyting","★ "+(beR.rating||"—"))+
      row("Yetkazilgan buyurtmalar",agg.count+" ta")+
      row("Eng ko'p sotilgan",topItem?(esc(topItem[0])+" ("+topItem[1]+" dona)"):"—")+
      row("Aylanma",money(agg.rev)+" so'm")+
      row("Restoranga o'tdi",money(agg.rev-site)+" so'm")+
      row("Komissiya daromadi ("+effPct+"%)",money(site)+" so'm")+
      (agg.fee!=null?row("Kuryer xarajati","− "+money(agg.fee)+" so'm"):"")+
      (agg.profit!=null?row("Sof foyda",money(agg.profit)+" so'm"):"")+
      '</div><h4 style="margin:14px 0 6px">Taomlari (sotilgan)</h4>'+itemsList);
  }
  function openUser(id){
    const u=allUsers().find(x=>x.id===id); if(!u) return;
    setHead(u.emoji,u.name,u.phone);
    /* Mehmon mijoz — buyurtmalari TELEFON bo'yicha topiladi (ismi har xil yozilishi
       mumkin). Ro'yxatdagi foydalanuvchi — ism bo'yicha (avvalgidek). */
    const uDig=String(u.phone||"").replace(/\D/g,"");
    const orders=((typeof STORE!=="undefined")?STORE.orders():[]).filter(function(o){
      if(u.guest) return uDig && String(o.phone||"").replace(/\D/g,"")===uDig;
      return o.user===u.name;
    });
    const spent=orders.filter(function(o){return o.status==="done";}).reduce(function(s,o){return s+(o.amount||0)+(o.delivery||0);},0);
    const hist=orders.length?orders.map(function(o){
      const st=OSM[o.status]||[o.status,"warn"];
      return '<div style="border:1px solid var(--line);border-radius:12px;padding:12px;margin-bottom:10px">'+
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><b>'+(o.emoji||"🍽️")+' '+esc(o.item)+'</b><span class="pill '+st[1]+'">'+st[0]+'</span></div>'+
        '<div style="display:flex;flex-direction:column;gap:6px;font-size:13px">'+
        omr("Sana / vaqt",fmtDateTime(o))+
        omr("Restoran",esc(o.rest)||"—")+
        omr("Kuryer",esc(o.courier)||"—")+
        omr("Manzil",esc(o.addr)||"—")+
        omr("Buyurtma summasi",money(o.amount)+" so'm")+
        ((o.delivery||0)>0?omr("Yetkazish",money(o.delivery)+" so'm")+omr("Yakuniy summa","<b>"+money((o.amount||0)+(o.delivery||0))+" so'm</b>"):"")+
        omr("To'lov",o.pay==="cash"?"💵 Naqd":"💳 Karta")+
        (o.reason?omr("Bekor sababi","<span style=\"color:#C8102E\">"+esc(o.reason)+"</span>"):"")+
        '</div></div>';
    }).join(""):'<p style="color:var(--grey)">Hali buyurtma bermagan.</p>';
    /* Restoran oynasi (openRest) bilan BIR XIL tuzilma: umumiy ko'rsatkichlar →
       moliya → kirish ma'lumotlari → qo'shimcha → tahrirlash → tarix. */
    const done=orders.filter(o=>o.status==="done");
    const cancelled=orders.filter(o=>o.status==="cancelled");
    const active=orders.filter(o=>!["done","cancelled"].includes(o.status));
    const ortacha=done.length?Math.round(spent/done.length):0;
    const cnt={}; orders.forEach(o=>{ if(o.rest) cnt[o.rest]=(cnt[o.rest]||0)+1; });
    const fav=Object.entries(cnt).sort((a,b)=>b[1]-a[1])[0];
    const myRevs=((typeof STORE!=="undefined"&&STORE.reviews)?STORE.reviews():[]).filter(r=>r.name===u.name);
    const oxirgi=orders[0]?fmtDateTime(orders[0]):"—";

    drawer(`
      <div class="dd-sec"><h4>Faollik</h4>
        <div class="kv">
          <div class="k"><span>Jami buyurtma</span><b>${orders.length}</b></div>
          <div class="k"><span>Yetkazilgan</span><b style="color:var(--green)">${done.length}</b></div>
          <div class="k"><span>Faol</span><b>${active.length}</b></div>
          <div class="k"><span>Bekor qilingan</span><b style="color:#C8102E">${cancelled.length}</b></div>
        </div></div>
      <div class="dd-sec"><h4>Moliya</h4>
        <div class="fin-row"><span>Jami sarflagan</span><b>${money(spent)} so'm</b></div>
        <div class="fin-row"><span>O'rtacha chek</span><b>${money(ortacha)} so'm</b></div>
        <div class="fin-row tot"><span>Sevimli restoran</span><b>${esc(fav?fav[0]:"—")}</b></div>
      </div>
      <div class="dd-sec"><h4>Kirish ma'lumotlari</h4>
        <div class="kv">
          <div class="k"><span>Login</span><b class="mono">${esc(u.login||"—")}</b></div>
          <div class="k"><span>Parol</span><b class="mono">••••••</b></div>
        </div>
        <p style="color:var(--grey);font-size:12px;margin-top:6px">Parol xavfsizlik uchun xeshlangan holda saqlanadi — uni ko'rib bo'lmaydi. Kerak bo'lsa quyida yangisini o'rnating.</p></div>
      <div class="dd-sec"><h4>Qo'shimcha ma'lumot</h4>
        <div class="kv">
          <div class="k"><span>Telefon</span><b>${esc(u.phone)||"—"}</b></div>
          <div class="k"><span>Email</span><b>${esc(u.email)||"—"}</b></div>
          <div class="k"><span>Qo'shilgan</span><b>${esc(u.joined)||"—"}</b></div>
          <div class="k"><span>Oxirgi buyurtma</span><b>${esc(oxirgi)}</b></div>
          <div class="k"><span>Izohlari</span><b>${myRevs.length}</b></div>
        </div>
      </div>
      ${u.backendId?`
      <div class="dd-sec"><h4>✏️ Tahrirlash</h4>
        <div class="add-field"><label>Ism</label><input id="eduName" value="${esc(u.name)}"></div>
        <div class="add-field"><label>Telefon</label><input id="eduPhone" type="tel" value="${esc(u.phone)}"></div>
        <div class="add-field"><label>Email</label><input id="eduEmail" type="email" value="${esc(u.email)}" placeholder="email@example.com"></div>
        <div class="add-field"><label>Login</label><input id="eduLogin" value="${esc(u.login)}"></div>
        ${passFieldHtml("eduPass","Yangi parol (bo'sh = o'zgarmaydi)")}
        <button class="dd-action-btn" id="eduSave" style="background:#16a34a;color:#fff;margin-top:6px">💾 Saqlash</button>
      </div>`:`
      <div class="dd-sec"><p style="color:var(--grey);font-size:13px">Bu yozuv namuna ma'lumot — tahrirlab bo'lmaydi.</p></div>`}
      <div class="dd-sec"><h4>Buyurtmalar tarixi (${orders.length})</h4>
        ${hist}
      </div>`);

    const sv=$("#eduSave");
    if(sv) sv.addEventListener("click",async()=>{
      const val=id=>{ const el=document.getElementById(id); return el?el.value.trim():""; };
      const name=val("eduName"), login=val("eduLogin"), email=val("eduEmail"), pass=val("eduPass");
      if(name.length<2){ toast("Ismni to'ldiring"); return; }
      if(login.length<3){ toast("Login kamida 3 belgi bo'lsin"); return; }
      if(email && window.YZ_EMAIL && !YZ_EMAIL.valid(email)){ toast("Email noto'g'ri formatda"); return; }
      if(pass && pass.length<6){ toast("Parol kamida 6 belgi bo'lsin"); return; }
      sv.disabled=true;
      const body={ id:u.backendId, name:name, phone:val("eduPhone"), email:email, login:login };
      if(pass) body.pass=pass;
      const r=(typeof STORE!=="undefined"&&STORE.editUser)? await STORE.editUser(body) : null;
      sv.disabled=false;
      if(r && !r.error){
        closeDrawer(); loadLiveUsers();
        toast(`✅ ${name} ma'lumotlari tahrirlandi${pass?" (parol o'zgartirildi)":""}`);
        if(pass) showNewPassOnce(name, pass);
      } else toast((r&&r.error)||"Serverga ulanib bo'lmadi");
    });
  }

  /* =========================================================
     SETTINGS
     ========================================================= */
  /* Moliyaviy/bildirishnoma sozlamalari — localStorage'ga saqlanadi (yangi restoran/kuryer
     qo'shishда standart qiymat sifatida ishlatish uchun ma'lumot). */
  function saveSettings(){
    try{
      const g=id=>{ const el=document.getElementById(id); return el?el.value:""; };
      const toggles=[]; document.querySelectorAll('#view-settings .toggle-switch input[type="checkbox"]').forEach(c=>toggles.push(!!c.checked));
      const s={ comm:g("setComm"), delivery:g("setDelivery"), min:g("setMin"), courier:g("setCourier"), toggles:toggles };
      localStorage.setItem("yz_admin_settings", JSON.stringify(s));
      toast("Sozlamalar saqlandi ✓");
    }catch(e){ toast("Saqlashда xato"); }
  }
  function loadSettings(){
    try{
      const s=JSON.parse(localStorage.getItem("yz_admin_settings")||"{}");
      const set=(id,v)=>{ const el=document.getElementById(id); if(el && v!=null && v!=="") el.value=v; };
      set("setComm",s.comm); set("setDelivery",s.delivery); set("setMin",s.min); set("setCourier",s.courier);
      if(Array.isArray(s.toggles)){ document.querySelectorAll('#view-settings .toggle-switch input[type="checkbox"]').forEach((c,i)=>{ if(s.toggles[i]!=null) c.checked=s.toggles[i]; }); }
    }catch(e){}
  }
  function fillProfile(){
    const ses=(typeof STORE!=="undefined")?STORE.session():null; if(!ses) return;
    const set=(id,v)=>{ const el=document.getElementById(id); if(el && !el.value) el.value=(v||""); };
    set("setName",ses.name); set("setPhone",ses.phone); set("setEmail",ses.email); set("setLogin",ses.login);
  }
  /* Sayt egasi raqami — serverdagi qiymatni maydonga qo'yamiz */
  function fillOwnerSettings(){
    if(typeof STORE==="undefined" || !STORE.settings) return;
    const s=STORE.settings()||{};
    const set=(id,v)=>{ const el=document.getElementById(id); if(el && document.activeElement!==el) el.value=(v||""); };
    set("setOwnerPhone",s.ownerPhone); set("setOwnerName",s.ownerName);
    set("setSupportPhone",s.supportPhone); set("setSupportUsername",s.supportUsername);
    set("setSupportLink",s.supportLink); set("setSupportNote",s.supportNote);
  }
  async function saveOwnerSettings(){
    const f=(id)=>{ const el=document.getElementById(id); return el?el.value.trim():""; };
    const phone=f("setOwnerPhone");
    if(phone && window.YZ_PHONE && !YZ_PHONE.valid(phone)){ toast("❌ Telefon raqami noto'g'ri"); return; }
    const btn=document.getElementById("setOwnerSave"); if(btn) btn.disabled=true;
    const r=(typeof STORE!=="undefined"&&STORE.updateSettings)? await STORE.updateSettings({ownerPhone:phone, ownerName:f("setOwnerName")}) : null;
    if(btn) btn.disabled=false;
    if(r && !r.error) toast("✅ Sayt egasi raqami saqlandi — mijozlar shu raqamni ko'radi");
    else toast((r&&r.error)||"Serverga ulanib bo'lmadi");
  }
  async function saveSupportSettings(){
    const f=(id)=>{ const el=document.getElementById(id); return el?el.value.trim():""; };
    const phone=f("setSupportPhone");
    if(phone && window.YZ_PHONE && !YZ_PHONE.valid(phone)){ toast("❌ Yordam telefoni noto'g'ri"); return; }
    let username=f("setSupportUsername");
    if(username && !username.startsWith("@") && !/^https?:\/\//.test(username)) username="@"+username.replace(/^@+/,"");
    let link=f("setSupportLink");
    if(link && !/^https?:\/\//.test(link)) link="https://"+link;
    const btn=document.getElementById("setSupportSave"); if(btn) btn.disabled=true;
    const r=(typeof STORE!=="undefined"&&STORE.updateSettings)
      ? await STORE.updateSettings({ supportPhone:phone, supportUsername:username, supportLink:link, supportNote:f("setSupportNote") })
      : null;
    if(btn) btn.disabled=false;
    if(r && !r.error){
      toast("✅ Yordam kontaktlari saqlandi — mijoz/restoran/kuryer «Shikoyat / yordam» bo'limида ko'radi");
      fillOwnerSettings();
    } else toast((r&&r.error)||"Serverga ulanib bo'lmadi");
  }
  async function saveProfile(){
    const f=(id)=>{ const el=document.getElementById(id); return el?el.value.trim():""; };
    const data={ name:f("setName"), phone:f("setPhone"), email:f("setEmail"), login:f("setLogin") };
    const pass=f("setPass"); if(pass) data.pass=pass;
    if(data.phone && window.YZ_PHONE && !YZ_PHONE.valid(data.phone)){ toast("❌ Telefon raqami noto'g'ri (+998 XX XXX XX XX)"); return; }
    if(data.email && window.YZ_EMAIL && !YZ_EMAIL.valid(data.email)){ toast("❌ Email noto'g'ri formatda"); return; }
    if(typeof STORE==="undefined" || !STORE.updateProfile){ toast("Tizim tayyor emas"); return; }
    const res=await STORE.updateProfile(data);
    if(res && res.error){ toast("❌ "+res.error); return; }
    const p=document.getElementById("setPass"); if(p) p.value="";
    if(res && res.name){ const hn=document.getElementById("sbName"); if(hn) hn.textContent=res.name; }
    toast("✅ Profil ma'lumotlari yangilandi");
  }
  function postAnnounce(){
    const t=$("#annText"); if(!t||!t.value.trim()){ toast("Matn kiriting"); return; }
    const text=t.value.trim();
    const entry={ rest:"Yetkaz", text:text, tag:"E'LON", emoji:"📢", date:new Date().toLocaleDateString("ru-RU") };
    /* localStorage (shu brauzerда darhol) */
    try{ const k="yetkaz_announcements"; const arr=JSON.parse(localStorage.getItem(k)||"[]"); arr.unshift(entry); localStorage.setItem(k,JSON.stringify(arr.slice(0,20))); }catch(e){}
    /* Backendга — barcha mijozlarда (bosh sahifа/kabinet) ko'rinishi uchun */
    try{ if(typeof STORE!=="undefined" && STORE.addAnnouncement) STORE.addAnnouncement({rest:"Yetkaz", text:text, tag:"E'LON", emoji:"📢", dish:""}); }catch(e){}
    toast("E'lon saytga joylandi ✓ — bosh sahifада ko'rinadi"); t.value="";
    setTimeout(renderAnnList, 400);
  }

  /* Joylangan BARCHA e'lonlar (backenddan) — o'chirish tugmasi bilan.
     Admin istalgan e'lonni (restoranlarnikini ham) o'chira oladi. */
  function renderAnnList(){
    const host=$("#annList"); if(!host) return;
    const list=(typeof STORE!=="undefined"&&STORE.announcements)?STORE.announcements():[];
    if(!list.length){ host.innerHTML='<p style="color:var(--grey);font-size:13px">Hozircha e\'lon yo\'q.</p>'; return; }
    host.innerHTML=list.map(function(a){
      const who=a.rest && a.rest!=="Yetkaz" ? ('🏪 '+esc(a.rest)) : '📢 Sayt e\'loni';
      return '<div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--line)">'+
        (a.img?'<img src="'+esc(a.img)+'" alt="" style="width:44px;height:44px;border-radius:10px;object-fit:cover;flex:none">':'<span style="font-size:22px;flex:none">'+(a.emoji||'📢')+'</span>')+
        '<div style="flex:1;min-width:0"><div style="font-weight:700;font-size:13px">'+who+(a.tag?' · <span style="color:var(--red)">'+esc(a.tag)+'</span>':'')+'</div>'+
          '<div style="color:var(--grey);font-size:13px;word-break:break-word">'+esc(a.text)+'</div></div>'+
        (a.id!=null?'<button class="add-action-btn" data-delann="'+esc(String(a.id))+'" style="background:#C8102E;flex:none">🗑 O\'chirish</button>'
                  :'<button class="add-action-btn" data-delanntext="'+esc(a.text)+'" data-delannrest="'+esc(a.rest||"")+'" style="background:#C8102E;flex:none">🗑 O\'chirish</button>')+
        '</div>';
    }).join("");
    /* id bo'yicha (ishonchli) */
    host.querySelectorAll('[data-delann]').forEach(function(b){ b.addEventListener('click',async function(){
      b.disabled=true;
      const r=(typeof STORE!=="undefined"&&STORE.deleteAnnouncementById)? await STORE.deleteAnnouncementById(b.dataset.delann):null;
      if(r&&r.error){ b.disabled=false; toast(r.error); } else { toast("E'lon o'chirildi ✓"); renderAnnList(); }
    }); });
    /* eski (id'siz) yozuvlar — matn bo'yicha */
    host.querySelectorAll('[data-delanntext]').forEach(function(b){ b.addEventListener('click',function(){
      if(typeof STORE!=="undefined"&&STORE.deleteAnnouncement) STORE.deleteAnnouncement({text:b.dataset.delanntext, rest:b.dataset.delannrest||undefined});
      toast("E'lon o'chirildi ✓"); setTimeout(renderAnnList,300);
    }); });
  }

  function renderAdminReviews(){
    const tb=$("#adminReviews"); if(!tb) return;
    const rv=(typeof STORE!=="undefined")?STORE.reviews():[];
    tb.innerHTML=rv.length?rv.slice(0,8).map(r=>`
      <div style="padding:10px 0;border-bottom:1px solid var(--line)">
        <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap">
          <b>${r.ava||"👤"} ${esc(r.name)} → ${esc(r.dish)}</b>
          <span class="star">${"★".repeat(Math.max(0,Math.min(5,r.rating|0)))}${"☆".repeat(5-Math.max(0,Math.min(5,r.rating|0)))}</span>
        </div>
        <div style="font-size:13px;margin-top:4px;color:var(--grey)">${esc(r.text)} ${r.flagged?'<span class="pill red">signal</span>':""}</div>
      </div>`).join(""):`<p style="color:var(--grey)">Hali izoh yo'q.</p>`;
  }

  function emptyStates(){
    var map={restCards:"Hali restoran yo'q. Yuqoridagi \"+ Restoran qo'shish\" tugmasi orqali qo'shing.",
             courCards:"Hali kuryer yo'q. Yuqoridagi \"+ Kuryer qo'shish\" tugmasi orqali qo'shing.",
             userCards:"Hali foydalanuvchi yo'q."};
    Object.keys(map).forEach(function(id){ var el=document.getElementById(id); if(el && !el.children.length && !(el.textContent||"").trim()) el.innerHTML='<p style="color:#9a8d83;text-align:center;padding:24px;font-size:14px">'+map[id]+'</p>'; });
  }
  function renderAll(){
    syncEntitiesFromBackend();   // backend = manba: hamma restoran/kuryer to'liq ma'lumoti bilan
    renderDash(); renderIncome(); renderLiveOrders(); renderRests(); renderCouriers(); renderUsers(); renderAdminReviews();
    updateSuspBadge();
    /* Ochiq bo'lgan bo'limlarni ham yangilaymiz (yangi shubhali buyurtma / izoh darrov ko'rinsin) */
    try{ if(document.querySelector("#view-suspicious.show")) renderSuspicious(); }catch(e){}
    try{ if(document.querySelector("#view-comments.show")) renderComments(); }catch(e){}
    emptyStates();
    renderPendingCountdowns();
    /* Tepadagi "ochiq/yopiq" hisoblagichi restoranlar ro'yxati bilan birga
       yangilansin (kirish paytida RESTS hali bo'sh bo'lishi mumkin). */
    try{ updateOnlineStatus(); }catch(e){}
    loadLiveUsers();   // ro'yxatdan o'tganlarni backenddan yangilash
  }

  /* Pending countdown ni har daqiqada yangilash */
  function renderPendingCountdowns(){
    // Jadval va kartalardagi countdown larni yangilash
    PENDING.forEach(p=>{
      // Faqat display o'zgartirish — to'liq rerender qilmaymiz
    });
  }

  /* =========================================================
     ADMIN / ONLINE — mobil header modallari + ish vaqti
     ========================================================= */
  /* Platforma holati — QOTIRIB yozilgan 08:00–22:00 emas, balki HAR BIR
     restoranning O'ZI belgilagan ish vaqtidan kelib chiqadi (Toshkent vaqti).
     Kamida bitta restoran ochiq bo'lsa — platforma buyurtma qabul qiladi. */
  function openRestsNow(){ return RESTS.filter(restOpenNow); }
  function isWorkTime(){ return RESTS.length ? openRestsNow().length>0 : true; }
  function updateOnlineStatus(){
    const badge=document.querySelector(".tb-badge"); if(!badge) return;
    const n=openRestsNow().length, total=RESTS.length;
    if(isWorkTime()){ badge.textContent=`🟢 Ochiq: ${n}/${total}`; badge.style.background="#16a34a"; badge.style.color="#fff"; }
    else { badge.textContent="🔴 Hamma yopiq"; badge.style.background="#9ca3af"; badge.style.color="#fff"; }
    badge.title="Restoranlarning hozirgi ish holati (Toshkent vaqti)";
  }
  function infoModal(title, html){
    let el=document.getElementById("infoModal"); if(el) el.remove();
    el=document.createElement("div"); el.id="infoModal";
    el.style.cssText="position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;padding:18px;backdrop-filter:blur(2px)";
    el.innerHTML="<div style=\"background:#fff;border-radius:20px;max-width:400px;width:100%;padding:22px;position:relative;max-height:90vh;overflow:auto\">"+
      "<button id=\"infoModalClose\" style=\"position:absolute;top:14px;right:14px;border:none;background:#f1f1f4;width:34px;height:34px;border-radius:50%;font-size:16px;cursor:pointer\">✕</button>"+
      "<h3 style=\"margin:0 0 14px\">"+title+"</h3>"+html+"</div>";
    document.body.appendChild(el);
    try{ history.pushState({infoModal:1}, ""); }catch(e){}
    let popped=false;
    const close=()=>{ el.remove(); if(!popped){ popped=true; try{ history.back(); }catch(e){} } };
    el._closeOnBack=()=>{ popped=true; el.remove(); };
    el.addEventListener("click",e=>{ if(e.target===el) close(); });
    document.getElementById("infoModalClose").addEventListener("click",close);
  }
  /* Har bir restoranning ish vaqti va hozirgi holati — admin bir joydan ko'radi.
     Bu AYNAN mijoz saytda ko'radigan holat (yagona manba: hours.js). */
  function openOnlineModal(){
    const row=(k,v)=>`<div style="display:flex;justify-content:space-between;gap:10px"><span style="color:var(--grey)">${k}</span><b>${v}</b></div>`;
    const n=openRestsNow().length;
    const list=RESTS.length ? RESTS.map(r=>{
      const open=restOpenNow(r);
      return `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 0;border-bottom:1px solid var(--line)">
        <span>${r.emoji||'🏪'} <b>${esc(r.name)}</b><br><small style="color:var(--grey)">🕒 ${esc(restHours(r))}</small></span>
        <span class="yz-openbadge ${open?'is-open':'is-closed'}">${open?'🟢 Ochiq':'🔴 Yopiq'}</span>
      </div>`;
    }).join("") : `<p style="color:var(--grey)">Hali restoran qo'shilmagan.</p>`;
    infoModal("🕒 Restoranlar ish vaqti",
      `<div style="display:flex;flex-direction:column;gap:10px;font-size:14px;margin-bottom:12px">`+
      row("Hozir ochiq", `<span style="color:${n?'#16a34a':'#9ca3af'}">${n} / ${RESTS.length}</span>`)+
      row("Hozir soat (Toshkent)", YZ_TIME.nowClock())+
      `</div>${list}`+
      `<p style="color:var(--grey);font-size:13px;margin-top:14px">Ish vaqtini restoran <b>o'zi</b> (Sozlamalar → Ish vaqti) yoki siz restoran kartasidan o'zgartirasiz. Yopiq restorandan mijoz buyurtma bera olmaydi.</p>`);
  }
  function openAdminModal(){
    const ses=(typeof STORE!=="undefined")?STORE.session():null;
    const row=(k,v)=>`<div style="display:flex;justify-content:space-between;gap:10px"><span style="color:var(--grey)">${k}</span><b>${v}</b></div>`;
    infoModal("🛡 Administrator",
      `<div style="text-align:center;margin-bottom:14px"><div style="font-size:46px">🛡</div><b style="font-size:17px">${(ses&&ses.name)||'Administrator'}</b></div>`+
      `<div style="display:flex;flex-direction:column;gap:10px;font-size:14px">`+
      row("Rol","Sayt egasi / Administrator")+
      row("Login",`<span class="mono">${(ses&&ses.login)||'admin'}</span>`)+
      row("Vakolat","To'liq boshqaruv")+
      `</div><p style="color:var(--grey);font-size:13px;margin-top:14px">Administrator restoran va kuryerlarni qo'shadi, login/parol beradi, komissiya va yetkazish haqlarini belgilaydi hamda barcha buyurtmalarni kuzatadi.</p>`);
  }

  let toastT; function toast(m){ const e=$("#toast2"); if(!e) return; e.textContent=m; e.classList.add("show"); clearTimeout(toastT); toastT=setTimeout(()=>e.classList.remove("show"),3000); }

  /* =========================================================
     INIT
     ========================================================= */
  document.addEventListener("DOMContentLoaded",()=>{
    // Panellarni davriy yangilaymiz (jonli buyurtma/holat o'zgarishi ko'rinsin)
    setInterval(()=>{ renderAll(); }, 60000);

    // Shikoyatlarni davriy yuklaymiz (yangi shikoyat kelsa hisoblagich ko'rinadi)
    loadComplaints();
    setInterval(loadComplaints, 20000);

    // Realtime: yangi buyurtma/status o'zgarganda jadval va KPI yangilanadi
    if(typeof STORE!=="undefined" && STORE.onChange){
      STORE.onChange(()=>{ try{
        syncEntitiesFromBackend(); renderDash(); renderIncome(); renderLiveOrders(); renderRests(); renderCouriers();
        /* Yangi shubhali buyurtma / izoh kelsa — hisoblagich va ochiq bo'lim yangilanadi */
        updateSuspBadge(); fillOwnerSettings();
        if(document.querySelector("#view-suspicious.show")) renderSuspicious();
        if(document.querySelector("#view-comments.show")) renderComments();
      }catch(e){} });
    }
    /* Kuryerlar bootstrap'da yo'q — ularni alohida davriy yangilaymiz (ishdan-javob holati ham) */
    if(typeof STORE!=="undefined" && STORE.fetchCouriers){
      setInterval(function(){ STORE.fetchCouriers().then(function(){ try{ syncEntitiesFromBackend(); renderCouriers(); renderDash(); renderIncome(); }catch(e){} }); }, 12000);
    }
    /* Restoranlar (komissiya bilan) — admin endpoint'дан. Darrov + davriy. */
    if(typeof STORE!=="undefined" && STORE.fetchAdminRestaurants){
      STORE.fetchAdminRestaurants().then(function(){ try{ syncEntitiesFromBackend(); renderRests(); renderDash(); renderIncome(); }catch(e){} });
      setInterval(function(){ STORE.fetchAdminRestaurants().then(function(){ try{ syncEntitiesFromBackend(); renderRests(); renderIncome(); }catch(e){} }); }, 15000);
    }

    /* ===== Sessiya — SERVERда tekshiriladi =====
       localStorage'dagi yz_session ga ishonmaymiz: uni brauzerда qo'lda yozib
       panelni ochib bo'lmasin. Rol /api/auth/me javobidan olinadi. */
    showLogin();
    if(typeof STORE!=="undefined" && STORE.sessionExpired && STORE.sessionExpired()){
      $("#loginErr").textContent="Sessiyangiz tugadi — qaytadan kiring.";
    }
    if(typeof STORE!=="undefined" && STORE.verifySession){
      STORE.verifySession().then(v=>{
        if(v.ok && v.account.role==="admin"){ enterAdmin(); }
        else if(!v.ok && v.reason==="offline" && v.session && v.session.role==="admin"){
          /* Tarmoq yo'q — keshdagi ma'lumot bilan ishlaymiz (yozuvlar baribir
             serverга yetmaydi, shuning uchun ogohlantiramiz) */
          enterAdmin();
          toast("⚠️ Serverga ulanib bo'lmadi — ma'lumot eskirgan bo'lishi mumkin");
        }
        /* aks holda: login ekrani ochiq qoladi */
      }).catch(()=>{});
    }

    // Mobil header: admin / online — modallar + avtomatik holat
    const badgeEl=document.querySelector(".tb-badge");
    if(badgeEl){ badgeEl.style.cursor="pointer"; badgeEl.addEventListener("click",openOnlineModal); }
    const userEl=document.querySelector(".tb-user");
    if(userEl){ userEl.style.cursor="pointer"; userEl.addEventListener("click",openAdminModal); }
    updateOnlineStatus();
    /* Ish vaqti chegarasidan o'tganda ro'yxatdagi 🟢/🔴 nishonlar ham
       yangilansin — admin sahifani qayta yuklamasin. */
    setInterval(()=>{
      updateOnlineStatus();
      try{ if(document.querySelector('#view-rest.show') || document.querySelector('#view-courier.show')) renderAll(); }catch(e){}
    }, 30000);

    $("#loginBtn").addEventListener("click",login);
    $("#alPass").addEventListener("keydown",e=>{ if(e.key==="Enter") login(); });
    $$(".sb-link").forEach(l=>l.addEventListener("click",()=>nav(l.dataset.view)));
    $("#ddClose").addEventListener("click",closeDrawer);
    $("#dbackdrop").addEventListener("click",closeDrawer);
    $("#logoutBtn").addEventListener("click",()=>{
      if(typeof STORE!=="undefined") STORE.clearSession();
      $("#app").classList.remove("show");
      $("#loginWrap").style.display="flex";
      $("#alPass").value="";
      try{location.href="index.html";}catch(e){}
    });

    // Izohlar bo'limi — qidiruv (ijobiy/salbiy tab renderComments ichida)
    const cs=document.getElementById("cmtSearch");
    if(cs) cs.addEventListener("input",function(){ cmtQuery=cs.value; renderComments(); });

    // Loginlar bo'limi — qidiruv va yangilash
    const ls=document.getElementById("loginSearch");
    if(ls) ls.addEventListener("input",function(){ loginQuery=ls.value; renderLogins(); });
    const lr=document.getElementById("loginRefresh");
    if(lr) lr.addEventListener("click",loadAccounts);

    // Bloklangan raqamlar bo'limi
    const blkRefresh=document.getElementById("blockRefreshBtn");
    if(blkRefresh) blkRefresh.addEventListener("click",loadBlocked);
    const blkAdd=document.getElementById("blockAddBtn");
    if(blkAdd) blkAdd.addEventListener("click",async function(){
      const inp=document.getElementById("blockPhoneInput");
      const val=(inp&&inp.value||"").trim();
      if(val.replace(/\D/g,"").length<9){ toast("Telefon raqamini to'liq kiriting"); return; }
      blkAdd.disabled=true;
      const r=await STORE.blockPhone(val,"Admin tomonidan bloklandi");
      blkAdd.disabled=false;
      if(r && !r.error){ if(inp) inp.value=""; BLOCKED=r.list||[]; renderBlocked(); toast("Raqam bloklandi"); }
      else toast((r&&r.error)||"Xatolik");
    });

    // Restoran qo'shish
    const addRestBtn=document.getElementById("addRestBtn");
    if(addRestBtn) addRestBtn.addEventListener("click",openAddRest);
    const addRestBtnM=document.getElementById("addRestBtnM"); if(addRestBtnM) addRestBtnM.addEventListener("click",openAddRest);
    const addRestBackdrop=document.getElementById("addRestBackdrop");
    if(addRestBackdrop) addRestBackdrop.addEventListener("click",closeAddRest);
    const arClose=document.getElementById("arClose");
    if(arClose) arClose.addEventListener("click",closeAddRest);
    const arSubmit=document.getElementById("arSubmit");
    if(arSubmit) arSubmit.addEventListener("click",submitAddRest);

    // Kuryer qo'shish
    const addCourBtn=document.getElementById("addCourierBtn");
    if(addCourBtn) addCourBtn.addEventListener("click",openAddCourier);
    const addCourBtnM=document.getElementById("addCourierBtnM"); if(addCourBtnM) addCourBtnM.addEventListener("click",openAddCourier);
    const addCourBackdrop=document.getElementById("addCourierBackdrop");
    if(addCourBackdrop) addCourBackdrop.addEventListener("click",closeAddCourier);
    const acClose=document.getElementById("acClose");
    if(acClose) acClose.addEventListener("click",closeAddCourier);
    const acSubmit=document.getElementById("acSubmit");
    if(acSubmit) acSubmit.addEventListener("click",submitAddCourier);

    // Settings
    const ss=$("#setSave"); if(ss) ss.addEventListener("click",saveSettings);
    loadSettings();
    const sps=$("#setProfileSave"); if(sps) sps.addEventListener("click",saveProfile);
    fillProfile();
    const sos=$("#setOwnerSave"); if(sos) sos.addEventListener("click",saveOwnerSettings);
    const sss=$("#setSupportSave"); if(sss) sss.addEventListener("click",saveSupportSettings);
    fillOwnerSettings();
    if(window.YZ_PHONE){ ["arPhone","acPhone","setPhone","setOwnerPhone","setSupportPhone"].forEach(function(id){ var el=document.getElementById(id); if(el) YZ_PHONE.attach(el); }); }
    if(typeof STORE!=="undefined" && STORE.fetchCouriers){ STORE.fetchCouriers().then(function(){ try{ syncEntitiesFromBackend(); renderAll(); }catch(e){} }); }
    const ab=$("#annBtn"); if(ab) ab.addEventListener("click",postAnnounce);
    renderAnnList();
  });
})();
