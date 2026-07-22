/* ===== Yetkaz.uz — Restoran egasi paneli ===== */
(function(){
  const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
  const money=n=>Math.round(n).toLocaleString("ru-RU");
  const mln=n=>(n/1e6).toFixed(1).replace(".",",")+" mln";
  /* XSS himoyasi — ta'rif assets/js/safe.js da (YAGONA manba, `'` ni ham escape
     qiladi). Bu yerда faqat qisqartma. Yangi kod uchun: html`...` teg shabloni. */
  const esc=YZ_SAFE.esc, html=YZ_SAFE.html, raw=YZ_SAFE.raw;
  const COMMISSION=0.18;
  const MONTHS=["Yan","Fev","Mar","Apr","May","Iyun"];

  /* Har bir restoran FAQAT o'z ma'lumotlarini ko'radi. Kuryer/sayt ichki foydasi YO'Q. */
  /* Parollar bu yerda saqlanmaydi — kirish backend orqali (xeshlangan) tekshiriladi */
  const RESTS=[];
  function priceOf(d){ return Math.round(d.price*(1-(d.discount||0)/100)); }
  /* Restoranning shartnoma komissiyasi (backenddan, default 18%) */
  function restPct(r){
    try{ const be=(typeof STORE!=="undefined"&&STORE.restaurants)?STORE.restaurants().find(x=>x.name===(r&&r.name)):null;
      if(be && be.commission!=null) return be.commission; }catch(e){}
    return (r&&r.commissionPct!=null)?r.commissionPct:18;
  }
  function recompute(r){
    const C=restPct(r)/100;
    r.dishes.forEach(d=>{ d.eff=priceOf(d); d.gross=d.eff*d.sold; d.commission=Math.round(d.gross*C); d.net=d.gross-d.commission; });
    r.gross=r.dishes.reduce((s,d)=>s+d.gross,0);
    r.commission=Math.round(r.gross*C);
    r.net=r.gross-r.commission;
    r.orders=r.dishes.reduce((s,d)=>s+d.sold,0);
    const f=[0.82,0.88,0.93,0.9,0.96,1.0];
    r.monthly=f.map(x=>Math.round(r.net*x));
  }
  RESTS.forEach(r=>{ r.discount=0; r.announcements=[]; r.dishes.forEach(d=>d.discount=d.discount||0); recompute(r); });

  let CUR=null;

  /* Taomlarni backend katalogidan yuklaymiz — qo'shilgan/o'chirilgan SAQLANADI */
  function loadDishes(){
    if(!CUR) return;
    try{
      if(typeof STORE!=="undefined" && STORE.mergeDishes && typeof DISHES!=="undefined"){
        const cat=STORE.mergeDishes(DISHES).filter(d=>d.rest===CUR.name);
        CUR.dishes=cat.map(d=>({name:d.name,emoji:d.emoji||"🍽️",price:d.price||0,sold:d.sold||0,discount:d.discount||0,photo:d.photo||""}));
      }
    }catch(e){}
    if(!Array.isArray(CUR.dishes)) CUR.dishes=[];
    recompute(CUR);
  }

  async function login(){
    const u=$("#rlUser").value.trim(), p=$("#rlPass").value.trim();
    $("#loginErr").textContent="";
    const acc=(typeof STORE!=="undefined")? await STORE.login(u,p):null;
    if(acc && acc.offline){ $("#loginErr").textContent="Serverga ulanib bo'lmadi. Saytni server orqali oching (masalan http://localhost:5050) va internetni tekshiring."; return; }
    if(acc && acc.role==="restoran"){
      const r=RESTS.find(x=>x.login===acc.login) || RESTS.find(x=>x.name===acc.name);
      if(r){ enter(r); return; }
      enter({name:acc.name,login:acc.login}); return;
    }
    if(acc && acc.target){ try{ location.href=acc.target; }catch(e){} return; }
    $("#loginErr").textContent="Login yoki parol xato.";
  }
  function syncFromBackend(){
    try{ const be=(typeof STORE!=="undefined"&&STORE.restaurants)?STORE.restaurants().find(x=>x.login===CUR.login):null;
      if(be){ CUR.name=be.name; if(be.emoji)CUR.emoji=be.emoji; CUR.photo=be.photo||CUR.photo; } }catch(e){}
  }
  function enter(r){ CUR=r;
    syncFromBackend(); loadDishes();
    $("#loginWrap").style.display="none"; $("#app").classList.add("show");
    $("#sbName").textContent=CUR.name; $("#sbEmoji").textContent=CUR.emoji||"🏪"; renderAll();
    /* Ish vaqti nishoni DARHOL to'g'ri chiqsin: DOMContentLoaded da CUR hali
       yo'q edi va nishon standart 09:00–23:00 ni ko'rsatardi. */
    try{ yzUpdateOnline(); }catch(e){}
    /* Realtime: backend o'zgarishi (yangi buyurtma, nom, taom) darhol ko'rinadi */
    if(typeof STORE!=="undefined" && STORE.onChange && !window.__restSub){ window.__restSub=true;
      STORE.onChange(()=>{ if(CUR){ syncFromBackend(); loadDishes(); $("#sbName").textContent=CUR.name; renderAll(); try{ yzUpdateOnline(); }catch(e){} } }); }
  }

  function nav(view){
    $$(".sb-link").forEach(l=>l.classList.toggle("active",l.dataset.view===view));
    $$(".view").forEach(v=>v.classList.toggle("show",v.id==="view-"+view));
    const t={dash:"Mening panelim",orders:"Buyurtmalar",dishes:"Mening taomlarim",income:"Daromad hisoboti",promo:"E'lon va chegirma",settings:"Sozlamalar"};
    if(view==="settings"){ fillSettings(); renderRestTg(); }
    $("#tbTitle").textContent=t[view]||"";
    $("#sidebar").classList.remove("open"); window.scrollTo({top:0});
  }

  /* ===== Restoran o'z rasmini yuklaydi (kameradan olib ham) ===== */
  function curRestPhoto(){
    try{ const be=(typeof STORE!=="undefined"&&STORE.restaurants)?STORE.restaurants().find(x=>x.name===CUR.name):null;
      const p=(be&&be.photo)||CUR.photo||""; return /^\/(?:uploads|img)\/|^data:/.test(p)?p:""; }catch(e){ return CUR.photo||""; }
  }
  async function uploadRestPhoto(file){
    if(!file) return; toast("Rasm yuklanmoqda...");
    var dataUrl=await resizeImage(file, 900);
    if(!dataUrl){ toast("Rasmni o'qib bo'lmadi"); return; }
    var url="";
    if(typeof STORE!=="undefined" && STORE.uploadImage){ url=(await STORE.uploadImage(dataUrl))||dataUrl; } else url=dataUrl;
    if(typeof STORE!=="undefined" && STORE.setRestaurantPhoto){ STORE.setRestaurantPhoto(url); }
    CUR.photo=url; renderRestPhotoCard(); toast("Restoran rasmi yangilandi \u2713");
  }
  function renderRestPhotoCard(){
    var sc=$("#statCards"); if(!sc) return;
    var card=document.getElementById("restPhotoCard");
    if(!card){ card=document.createElement("div"); card.id="restPhotoCard"; sc.parentNode.insertBefore(card, sc); }
    var p=curRestPhoto();
    card.innerHTML='<div class="panel" style="margin-bottom:16px"><div class="panel-body" style="display:flex;align-items:center;gap:16px;flex-wrap:wrap">'+
      '<div style="width:76px;height:76px;border-radius:16px;background:#f3eef0;display:flex;align-items:center;justify-content:center;font-size:36px;overflow:hidden;flex:none">'+
        (p?'<img src="'+p+'" alt="" style="width:100%;height:100%;object-fit:cover">':(CUR.emoji||"\ud83c\udfea"))+'</div>'+
      '<div style="flex:1;min-width:190px">'+
        '<b>Restoran rasmi</b>'+
        '<p style="color:var(--grey);font-size:13px;margin:4px 0">O\'z restoraningiz rasmini yuklang yoki kameradan oling — bosh sahifada kartochkangizda ko\'rinadi.</p>'+
        '<label class="set-save" style="display:inline-block;cursor:pointer;padding:9px 14px">\ud83d\udcf7 Rasm tanlash / olish'+
          '<input type="file" id="restPhotoInput" accept="image/*" capture="environment" style="display:none"></label>'+
      '</div></div></div>';
    var inp=document.getElementById("restPhotoInput");
    if(inp) inp.addEventListener("change",function(e){ if(e.target.files&&e.target.files[0]) uploadRestPhoto(e.target.files[0]); });
  }
  /* Sof daromad davri: 'kunlik' | 'haftalik' | 'oylik' (restoran o'zi almashtiradi) */
  let incomePeriod="oylik";
  function orderTimeMs(o){ return YZ_TIME.stamp((o&&o.created_at)||""); }
  function inIncomePeriod(o, period){
    var t=orderTimeMs(o); if(!t) return period==="oylik";  // sanasi yo'q bo'lsa oylikka kirsin
    /* "Kunlik" — AYNAN bugungi kun (Toshkent), oxirgi 24 soat emas */
    if(period==="kunlik") return YZ_TIME.isToday((o&&o.created_at)||"");
    var days=(Date.now()-t)/86400000;
    if(period==="haftalik") return days<7;
    if(period==="yillik") return days<366;
    return days<31;  // oylik
  }
  function renderDash(){
    const r=CUR;
    /* REAL hisob-kitob: pul FAQAT mijoz tasdiqlagan (done) buyurtmalardan yoziladi.
       Bekor qilinganlar daromadga kirmaydi. Davr (kunlik/haftalik/oylik) tanlanadi. */
    const live=(typeof STORE!=="undefined"&&STORE.ordersFor)?STORE.ordersFor(r.name):[];
    const paid=live.filter(o=>o.status==="done");            // mijoz qabul qilgan = to'lov yozilgan
    const pct=restPct(r);
    const orders=live.filter(o=>o.status!=="cancelled").length;
    /* Dashboard PUL ko'rsatmaydi — daromad faqat "Daromad hisoboti" bo'limida.
       Bu yerda restoranga kundalik ish uchun kerakli sonlar turadi. */
    const bugun=live.filter(o=>o.status!=="cancelled" && YZ_TIME.isToday(o.created_at)).length;
    const faol=live.filter(o=>!["done","cancelled"].includes(o.status)).length;
    $("#statCards").innerHTML=`
      <div class="scard c1"><div class="si">🔔</div><b>${money(bugun)}</b><span>Bugungi buyurtmalar</span></div>
      <div class="scard c2"><div class="si">🧾</div><b>${money(orders)}</b><span>Jami buyurtmalar</span></div>
      <div class="scard c3"><div class="si">🛵</div><b>${money(faol)}</b><span>Hozir jarayonda</span></div>
      <div class="scard c4"><div class="si">⭐</div><b>${r.rating||"—"}</b><span>Reyting</span></div>`;
    /* REAL oylik daromad — buyurtmalarni created_at oyiga guruhlab (so'nggi 6 oy) */
    const MON=["Yan","Fev","Mar","Apr","May","Iyun","Iyul","Avg","Sen","Okt","Noy","Dek"];
    const now=new Date();
    const slots=[];
    for(let i=5;i>=0;i--){ const dt=new Date(now.getFullYear(),now.getMonth()-i,1); slots.push({y:dt.getFullYear(),m:dt.getMonth(),label:MON[dt.getMonth()],sum:0}); }
    paid.forEach(function(o){
      const raw=String(o.created_at||""); const mm=raw.match(/^(\d{4})-(\d{2})/);
      const y=mm?+mm[1]:now.getFullYear(), mo=mm?(+mm[2]-1):now.getMonth();
      const oNet=Math.round((o.amount||0)*(100-pct)/100);
      const slot=slots.find(function(x){return x.y===y&&x.m===mo;});
      if(slot) slot.sum+=oNet;
    });
    const max=Math.max.apply(null,slots.map(function(x){return x.sum;}).concat([1]));
    $("#revChart").innerHTML=slots.map(function(x){return `
      <div class="bar-col"><div class="bv">${x.sum?mln(x.sum).replace(" mln",""):"0"}</div>
        <div class="bar" style="height:${Math.max(4,Math.round(x.sum/max*150))}px"></div><small>${x.label}</small></div>`;}).join("");
    /* Real: eng ko'p sotilgan va talab — haqiqiy buyurtmalar bo'yicha (0 dan) */
    const agg={};
    (live||[]).forEach(function(o){ if(!o.item) return; const k=o.item; if(!agg[k]) agg[k]={name:o.item,emoji:o.emoji||"🍽️",sold:0,rev:0}; agg[k].sold++; agg[k].rev+=(o.amount||0); });
    const top=Object.values(agg).sort((a,b)=>b.sold-a.sold).slice(0,5);
    $("#topDishes").innerHTML=top.length?top.map((d,i)=>`
      <div class="topitem" data-topname="${esc(d.name)}" style="cursor:pointer"><span class="rank">${i+1}</span><span style="font-size:20px">${d.emoji}</span>
        <span class="ti-name">${esc(d.name)}</span><span class="ti-val">${money(d.sold)} marta</span></div>`).join(""):'<p style="color:var(--grey);font-size:13px">Hozircha buyurtma yo\'q</p>';
    const maxd=(top[0]&&top[0].sold)||1;
    $("#demandList").innerHTML=top.length?top.map(d=>`
      <div style="margin-bottom:12px"><div style="display:flex;justify-content:space-between;font-size:14px;margin-bottom:4px"><b>${d.emoji} ${esc(d.name)}</b><span>${money(d.sold)} marta</span></div>
      <div style="height:9px;background:#F3EEF0;border-radius:6px;overflow:hidden"><div style="height:100%;width:${Math.round(d.sold/maxd*100)}%;background:linear-gradient(90deg,var(--gold),var(--red))"></div></div></div>`).join(""):'<p style="color:var(--grey);font-size:13px">Talab ma\'lumoti buyurtmalar bilan to\'ladi</p>';
    /* Eng ko'p sotilgan taom ustiga bosilganda — to'liq ma'lumot (asl rasm bilan) */
    $$("#topDishes .topitem").forEach(function(it){ it.addEventListener("click",function(){
      const nm=it.dataset.topname; const d=agg[nm]; if(!d) return;
      showTopDishModal(d, findRestDish(nm));
    }); });
    renderRestPhotoCard();
    renderDashOrders();     // dashboard'даги jonli buyurtmalar
    renderTopCustomers();
  }
  /* Bir xillik: telefon (yoki ism+manzil) bo'yicha guruhlab, eng ko'p buyurtma bergan mijoz */
  function topCustomers(orders, n){
    var map={};
    (orders||[]).forEach(function(o){
      var phone=String(o.phone||"").replace(/\D/g,"");
      var key=phone || (String(o.user||"").toLowerCase().trim()+"|"+String(o.addr||"").toLowerCase().trim());
      if(!key || key==="|") return;
      if(!map[key]) map[key]={name:o.user||"—", phone:o.phone||"—", addr:o.addr||"", count:0};
      map[key].count++;
    });
    /* n berilmasa — HAMMASI qaytadi (ro'yxat scroll ichida ko'rsatiladi) */
    var all=Object.values(map).sort(function(a,b){return b.count-a.count;});
    return n?all.slice(0,n):all;
  }
  function renderTopCustomers(){
    var host=document.getElementById("view-dash"); if(!host) return;
    var orders=(typeof STORE!=="undefined"&&STORE.ordersFor)?STORE.ordersFor(CUR.name):[];
    var list=topCustomers(orders.filter(function(o){return o.status!=="cancelled";}));
    var box=document.getElementById("topCustPanel");
    if(!box){ box=document.createElement("div"); box.id="topCustPanel"; box.className="panel"; box.style.marginTop="16px"; host.appendChild(box); }
    /* Mijozlar ko'payib ketsa ham panel cho'zilmaydi — ichida scroll bo'ladi */
    box.innerHTML='<div class="panel-head"><h3>👑 Doimiy mijozlar (eng ko\'p buyurtma bergan)</h3><span style="color:var(--grey);font-size:13px">'+list.length+' ta</span></div><div class="panel-body">'+
      (list.length?'<div style="max-height:500px;overflow-y:auto">'+list.map(function(c,i){ return '<div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--line)"><span style="background:var(--red);color:#fff;width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:12px;flex-shrink:0">'+(i+1)+'</span><div style="flex:1;min-width:0"><div style="font-weight:700">'+esc(c.name)+'</div><div style="color:var(--grey);font-size:13px">📞 '+esc(c.phone)+(c.addr?' · 📍 '+esc(c.addr):'')+'</div></div><b style="color:var(--red);white-space:nowrap">'+c.count+' marta</b></div>'; }).join("")+'</div>':'<p style="color:var(--grey)">Hozircha doimiy mijoz yo\'q.</p>')+
      '</div>';
  }
  /* Buyurtma nomi (masalan "Shashlik +2 ta") bo'yicha restoran taomini topish */
  function findRestDish(nm){
    var list=CUR.dishes||[];
    return list.find(function(x){return x.name===nm;})
      || list.find(function(x){return x.name&&nm&&nm.indexOf(x.name)===0;})
      || list.find(function(x){return x.name&&nm&&nm.toLowerCase().indexOf(x.name.toLowerCase())>=0;})
      || {};
  }
  /* Eng ko'p sotilgan taom modali */
  function showTopDishModal(d, dish){
    var el=document.getElementById("topDishModal"); if(el) el.remove();
    el=document.createElement("div"); el.id="topDishModal";
    el.style.cssText="position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;padding:18px";
    var hasImg=dish&&dish.photo&&/^\/(?:uploads|img)\/|^data:|^https?:/.test(String(dish.photo));
    var img=hasImg
      ? '<div style="position:relative;height:190px;border-radius:14px;overflow:hidden;margin-bottom:12px;background:#f3eef0">'+
          '<img src="'+dish.photo+'" alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;filter:blur(16px) brightness(.85);transform:scale(1.2)">'+
          '<img src="'+dish.photo+'" alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:contain">'+
        '</div>'
      : '<div style="font-size:60px;text-align:center;margin-bottom:8px">'+(d.emoji||"🍽️")+'</div>';
    var row=function(k,v){ return '<div style="display:flex;justify-content:space-between;gap:10px;font-size:14px"><span style="color:var(--grey)">'+k+'</span><b>'+v+'</b></div>'; };
    el.innerHTML='<div style="background:#fff;border-radius:20px;max-width:420px;width:100%;padding:22px;position:relative;max-height:90vh;overflow:auto">'+
      '<button id="tdmClose" style="position:absolute;top:14px;right:14px;border:none;background:#f1f1f4;width:34px;height:34px;border-radius:50%;font-size:16px;cursor:pointer">✕</button>'+
      img+'<h3 style="text-align:center;margin:4px 0 12px">'+esc(d.name)+'</h3>'+
      '<div style="display:flex;flex-direction:column;gap:10px">'+
      row("Necha marta sotilgan", money(d.sold)+" marta")+
      row("Narxi", (dish&&dish.price?money(dish.price)+" so'm":"—"))+
      row("Reyting", (dish&&dish.rating?dish.rating:"—"))+
      row("Jami daromad", money(d.rev)+" so'm")+
      '</div></div>';
    document.body.appendChild(el);
    el.querySelector("#tdmClose").addEventListener("click",function(){ el.remove(); });
    el.addEventListener("click",function(e){ if(e.target===el) el.remove(); });
  }

  function isSoldout(name){
    try{ return ((typeof STORE!=="undefined"&&STORE.overrides)?(STORE.overrides().soldout||[]):[]).indexOf(CUR.name+"|"+name)>=0; }catch(e){ return false; }
  }
  function renderDishes(){
    $("#dishTbody").innerHTML=CUR.dishes.map((d,i)=>{ const so=isSoldout(d.name); return `
      <tr${so?' style="opacity:.6"':''}>
        <td><div class="tname">${d.photo?`<img src="${d.photo}" class="av" alt="" style="object-fit:cover">`:`<span class="av">${d.emoji}</span>`}${esc(d.name)}${so?' <span class="pill warn" style="font-size:10px">Tugagan</span>':''}</div></td>
        <td>${d.discount?`<span style="text-decoration:line-through;color:var(--grey)">${money(d.price)}</span> <b style="color:var(--red)">${money(d.eff)}</b> <span class="pill red">-${d.discount}%</span>`:money(d.price)}</td>
        <td>${money(d.sold)}</td>
        <td><b style="color:var(--green)">${money(d.net)}</b></td>
        <td style="white-space:nowrap">
          <button class="so-btn" data-name="${esc(d.name)}" title="Sotuvda bor/yo'q" style="background:${so?'#e9f7ef':'#fde9c8'};color:${so?'#16a34a':'#b45309'};border:none;border-radius:8px;padding:6px 9px;font-size:12px;font-weight:700;cursor:pointer;margin-right:4px">${so?'✅ Sotuvga':'⛔ Tugadi'}</button>
          <button class="del-btn" data-i="${i}" title="O'chirish" style="background:#FBE3E6;color:var(--red);border:none;border-radius:8px;padding:6px 9px;font-size:15px;cursor:pointer">🗑</button>
        </td>
      </tr>`;}).join("");
    $$("#dishTbody .del-btn").forEach(b=>b.addEventListener("click",()=>removeDish(+b.dataset.i)));
    $$("#dishTbody .so-btn").forEach(b=>b.addEventListener("click",()=>{
      const name=b.dataset.name; const cur=isSoldout(name);
      if(typeof STORE!=="undefined" && STORE.setSoldout) STORE.setSoldout(CUR.name, name, !cur);
      renderDishes(); toast(!cur?"Taom sotuvdan olindi":"Taom qaytadan sotuvda ✓");
    }));
  }

  /* Rasmni canvas orqali kichraytirib (max 800px) dataURL qaytaradi */
  function resizeImage(file, maxSize){
    return new Promise((resolve)=>{
      const fr=new FileReader();
      fr.onload=()=>{ const img=new Image();
        img.onload=()=>{ let w=img.width, h=img.height; const scale=Math.min(1, maxSize/Math.max(w,h));
          w=Math.round(w*scale); h=Math.round(h*scale);
          const cv=document.createElement("canvas"); cv.width=w; cv.height=h;
          cv.getContext("2d").drawImage(img,0,0,w,h);
          try{ resolve(cv.toDataURL("image/jpeg",0.85)); }catch(e){ resolve(fr.result); } };
        img.onerror=()=>resolve(""); img.src=fr.result; };
      fr.onerror=()=>resolve(""); fr.readAsDataURL(file);
    });
  }

  async function addDish(){
    const name=$("#ndName").value.trim(), price=parseInt(($("#ndPrice").value||"").replace(/\D/g,""),10), emoji=($("#ndEmoji").value.trim()||"🍽️");
    const weight=(($("#ndWeight")||{}).value||"").trim();
    const ingredients=(($("#ndIngredients")||{}).value||"").trim();
    const descr=(($("#ndDescr")||{}).value||"").trim();
    if(name.length<2){ toast("Taom nomini kiriting"); return; }
    if(!price || price<1000){ toast("To'g'ri narx kiriting"); return; }
    const fileInput=$("#ndPhoto");
    let photo="";
    if(fileInput && fileInput.files && fileInput.files[0]){
      toast("Rasm yuklanmoqda...");
      const dataUrl=await resizeImage(fileInput.files[0], 800);
      if(dataUrl){
        if(typeof STORE!=="undefined" && STORE.uploadImage){ photo=(await STORE.uploadImage(dataUrl)) || dataUrl; }
        else photo=dataUrl;
      }
    }
    try{ if(typeof STORE!=="undefined") STORE.addDish({id:Date.now(),name:name,emoji:emoji,price:price,rest:CUR.name,cat:"Fastfood",kw:"",photo:photo,sold:0,weight:weight,ingredients:ingredients,descr:descr}); }catch(e){}
    loadDishes(); renderAll();
    $("#ndName").value=""; $("#ndPrice").value=""; $("#ndEmoji").value="🍽️";
    ["#ndWeight","#ndIngredients","#ndDescr"].forEach(function(s){ var el=$(s); if(el) el.value=""; });
    if(fileInput) fileInput.value="";
    toast(photo?"Taom rasm bilan qo'shildi ✓":"Taom qo'shildi ✓");
  }
  function removeDish(i){
    if(!CUR.dishes || CUR.dishes.length<=1){ toast("Kamida bitta taom qolishi kerak"); return; }
    const nm=CUR.dishes[i] && CUR.dishes[i].name; if(!nm) return;
    try{ if(typeof STORE!=="undefined") STORE.removeDish(CUR.name,nm); }catch(e){}
    loadDishes(); renderAll(); toast("Taom o'chirildi ✓ (saytdan ham o'chadi)");
  }

  /* ===== Rasm yordamchilari va taom tanlash modali ===== */
  function isRealPhoto(p){ return p && /^\/(?:uploads|img)\/|^data:|^https?:/.test(String(p)); }
  function dishImg(d){ return (d && isRealPhoto(d.photo)) ? d.photo : ""; }
  function findDishByItem(item){
    if(!item || !CUR || !CUR.dishes) return null;
    var it=String(item);
    return CUR.dishes.find(function(d){ return d.name && (it===d.name || it.indexOf(d.name)===0); }) || null;
  }
  function orderPhoto(x){ var d=findDishByItem(x&&x.item); return d?dishImg(d):""; }

  var discSelIdx=null;   // chegirma uchun tanlangan taom indeksi
  function updateDiscBtn(){
    var btn=$("#discDishBtn"); if(!btn) return;
    var d=(discSelIdx!=null)?CUR.dishes[discSelIdx]:null;
    if(d){
      var img=dishImg(d);
      btn.innerHTML=(img?'<img src="'+img+'" alt="" class="dpb-img">':'<span class="dpb-emoji">'+(d.emoji||"🍽️")+'</span>')+
        '<span class="dpb-name">'+esc(d.name)+'</span><span class="dpb-arrow">▾</span>';
      btn.classList.add("has-sel");
    } else {
      btn.innerHTML='<span class="dpb-emoji">🍽️</span><span class="dpb-name">Taom tanlang</span><span class="dpb-arrow">▾</span>';
      btn.classList.remove("has-sel");
    }
  }
  function openDishPicker(){
    if(!CUR || !CUR.dishes || !CUR.dishes.length){ toast("Avval taom qo'shing"); return; }
    var el=document.getElementById("dishPickModal"); if(el) el.remove();
    el=document.createElement("div"); el.id="dishPickModal";
    el.style.cssText="position:fixed;inset:0;z-index:10001;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;padding:18px;backdrop-filter:blur(2px)";
    var cards=CUR.dishes.map(function(d,i){
      var img=dishImg(d);
      return '<button type="button" class="dpick-card'+(i===discSelIdx?' sel':'')+'" data-i="'+i+'">'+
        '<div class="dpick-thumb">'+(img?'<img src="'+img+'" alt="">':'<span>'+(d.emoji||"🍽️")+'</span>')+'</div>'+
        '<div class="dpick-name">'+esc(d.name)+'</div>'+
        '<div class="dpick-price">'+money(d.price)+" so'm"+(d.discount>0?' <span class="pill red" style="font-size:10px">-'+d.discount+'%</span>':'')+'</div>'+
        '</button>';
    }).join("");
    el.innerHTML='<div class="dpick-sheet">'+
      '<div class="dpick-head"><h3>🍽️ Taom tanlang</h3><button id="dpickClose" class="dpick-x" aria-label="Yopish">✕</button></div>'+
      '<div class="dpick-grid">'+cards+'</div></div>';
    document.body.appendChild(el);
    var close=function(){ el.remove(); };
    el.addEventListener("click",function(e){ if(e.target===el) close(); });
    el.querySelector("#dpickClose").addEventListener("click",close);
    el.querySelectorAll(".dpick-card").forEach(function(c){ c.addEventListener("click",function(){ discSelIdx=+c.dataset.i; updateDiscBtn(); close(); }); });
  }

  function renderPromo(){
    if(discSelIdx!=null && !CUR.dishes[discSelIdx]) discSelIdx=null;
    updateDiscBtn();

    /* Faol aksiyalar paneli */
    const activeList=$("#activePromoList"), promoCount=$("#promoCount");
    const allAnns=CUR.announcements||[];
    if(activeList){
      if(allAnns.length){
        activeList.innerHTML=allAnns.map((a,ai)=>`
          <div class="promo-ann-item">
            ${a.img?`<img src="${a.img}" alt="" style="width:46px;height:46px;border-radius:10px;object-fit:cover;flex:none;margin-right:10px">`:""}
            <div class="pai-left">
              <span class="pai-tag">${a.tag||"AKSIYA"}</span>
              <div class="pai-text">${a.text}</div>
              <div class="pai-date">${a.date}</div>
            </div>
            <button class="pai-del" data-ai="${ai}">Olib tashlash</button>
          </div>`).join("");
        activeList.querySelectorAll(".pai-del").forEach(b=>b.addEventListener("click",()=>{
          const ai=+b.dataset.ai;
          const delText=(allAnns[ai]||{}).text;
          CUR.announcements.splice(ai,1);
          try{
            const k="yetkaz_announcements";
            const arr=JSON.parse(localStorage.getItem(k)||"[]");
            const filtered=arr.filter(a=>!(a.rest===CUR.name && a.text===delText));
            localStorage.setItem(k,JSON.stringify(filtered));
          }catch(e){}
          /* Backenddan ham o'chirish (boshqa qurilmalarda ham yo'qolsin) */
          try{ if(typeof STORE!=="undefined" && STORE.deleteAnnouncement) STORE.deleteAnnouncement({rest:CUR.name, text:delText}); }catch(e){}
          renderPromo(); toast("E'lon o'chirildi");
        }));
      } else {
        activeList.innerHTML='<p style="color:var(--grey);font-size:13px">Hozircha aksiya yo\'q.</p>';
      }
    }
    if(promoCount) promoCount.textContent=allAnns.length+" ta";

    /* Chegirmalar */
    const discList=$("#discList");
    const disc=CUR.dishes.map((d,i)=>({d,i})).filter(x=>x.d.discount>0);
    if(discList){
      if(disc.length){
        discList.innerHTML=disc.map(x=>`
          <div class="disc-item">
            <span class="disc-emoji">${x.d.emoji}</span>
            <div class="disc-info">
              <div class="disc-name">${x.d.name}</div>
              <div class="disc-prices">
                <span class="disc-old">${money(x.d.price)}</span>
                <span class="disc-new">${money(x.d.eff)} so'm</span>
                <span class="pill red">-${x.d.discount}%</span>
              </div>
            </div>
            <button class="disc-del" data-r="${x.i}">Bekor</button>
          </div>`).join("");
        discList.querySelectorAll(".disc-del").forEach(b=>b.addEventListener("click",()=>{
          const di=+b.dataset.r;
          CUR.dishes[di].discount=0;
          try{ if(typeof STORE!=="undefined") STORE.setDiscount(CUR.name,CUR.dishes[di].name,0); }catch(e){}
          recompute(CUR); renderAll(); toast("Chegirma bekor qilindi");
        }));
      } else {
        discList.innerHTML='<p style="color:var(--grey);font-size:13px">Hozircha chegirma belgilanmagan.</p>';
      }
    }
  }

  async function postAnnounce(){
    const t=$("#annText").value.trim(); if(!t){ toast("E'lon matnini kiriting"); return; }
    const tag=($("#annTag")||{}).value||"AKSIYA";
    /* Reklama rasmi (ixtiyoriy) — tanlangan bo'lsa serverga yuklab, qisqa URL olamiz */
    let img="";
    const fi=$("#annPhoto");
    if(fi && fi.files && fi.files[0]){
      toast("Rasm yuklanmoqda...");
      const dataUrl=await resizeImage(fi.files[0], 900);
      if(dataUrl){ img=(typeof STORE!=="undefined" && STORE.uploadImage)?((await STORE.uploadImage(dataUrl))||dataUrl):dataUrl; }
    }
    const entry={text:t, tag:tag, date:new Date().toLocaleDateString("ru-RU"), emoji:CUR.emoji||"📢", img:img};
    if(!CUR.announcements) CUR.announcements=[];
    CUR.announcements.unshift(entry);
    try{
      const k="yetkaz_announcements";
      const arr=JSON.parse(localStorage.getItem(k)||"[]");
      arr.unshift({rest:CUR.name, text:t, tag:tag, emoji:CUR.emoji||"📢", date:entry.date, img:img});
      localStorage.setItem(k,JSON.stringify(arr.slice(0,20)));
    }catch(e){}
    /* Backendga ham — boshqa qurilmalarda/mijozlarda ko'rinishi uchun */
    try{ if(typeof STORE!=="undefined" && STORE.addAnnouncement) STORE.addAnnouncement({rest:CUR.name, text:t, tag:tag, emoji:CUR.emoji||"📢", dish:"", img:img}); }catch(e){}
    if($("#annText")) $("#annText").value="";
    if(fi) fi.value="";
    const pv=$("#annPhotoPreview"); if(pv){ pv.style.display="none"; pv.innerHTML=""; }
    renderPromo(); toast(img?"E'lon rasm bilan joylandi — saytda ko'rinadi ✓":"E'lon joylandi — saytda ko'rinadi ✓");
  }
  function applyDiscount(){
    const i=discSelIdx, pct=parseInt(($("#discPct").value||"").replace(/\D/g,""),10);
    if(i==null || !CUR.dishes[i]){ toast("Taom tanlang"); return; }
    if(!pct || pct<1 || pct>90){ toast("Chegirma 1–90% oralig'ida"); return; }
    CUR.dishes[i].discount=pct;
    try{ if(typeof STORE!=="undefined") STORE.setDiscount(CUR.name,CUR.dishes[i].name,pct); }catch(e){}
    recompute(CUR); discSelIdx=null; renderAll(); $("#discPct").value="";
    toast("Chegirma belgilandi ✓");
  }
  let tT; function toast(m){ const e=$("#toast2"); if(!e) return; e.textContent=m; e.classList.add("show"); clearTimeout(tT); tT=setTimeout(()=>e.classList.remove("show"),2200); }

  function renderIncome(){
    const r=CUR;
    const pct=restPct(r), keep=100-pct;
    /* REAL: pul faqat mijoz tasdiqlagan (done) buyurtmalardan yoziladi */
    const live=(typeof STORE!=="undefined"&&STORE.ordersFor)?STORE.ordersFor(r.name):[];
    /* Davr tanlovi dashboarddan SHU YERGA ko'chdi — daromad endi faqat shu
       bo'limda ko'rinadi. Ilgari sarlavhada "(oy)" yozilar, hisob esa BUTUN
       davr bo'yicha ketardi — ya'ni yorliq bilan raqam mos kelmasdi. */
    const doneOrders=live.filter(o=>o.status==="done" && inIncomePeriod(o, incomePeriod));
    const gross=doneOrders.reduce((s,o)=>s+(o.amount||0),0);
    const commission=Math.round(gross*pct/100);
    const net=gross-commission;
    const pLabel={kunlik:"bugun",haftalik:"so'nggi hafta",oylik:"so'nggi oy",yillik:"so'nggi yil"}[incomePeriod];
    const seg=(k,t)=>`<button class="inc-seg" data-period="${k}" style="border:none;border-radius:8px;padding:5px 12px;font-size:12px;font-weight:700;cursor:pointer;margin:0 4px 4px 0;background:${incomePeriod===k?'var(--red,#C8102E)':'#f1eef0'};color:${incomePeriod===k?'#fff':'#777'}">${t}</button>`;
    /* Har bir taom bo'yicha REAL: buyurtma nomi (item) taom nomiga mos kelsa hisoblanadi */
    const dishStats=function(dish){
      var m=doneOrders.filter(function(o){ return o.item && (o.item===dish.name || o.item.indexOf(dish.name)===0); });
      var g=m.reduce(function(s,o){return s+(o.amount||0);},0);
      return { sold:m.length, net:Math.round(g*keep/100) };
    };
    /* Eng ko'p sotilgan taomlar (nima ko'p sotilyapti) */
    const rows=r.dishes.map(d=>({d, st:dishStats(d)}));
    const best=rows.slice().sort((a,b)=>b.st.sold-a.st.sold).filter(x=>x.st.sold>0).slice(0,5);
    const maxSold=(best[0]&&best[0].st.sold)||1;
    const bestSellers = best.length ? best.map(x=>`
      <div style="margin-bottom:12px"><div style="display:flex;justify-content:space-between;font-size:14px;margin-bottom:4px"><b>${x.d.emoji||"🍽️"} ${esc(x.d.name)}</b><span>${money(x.st.sold)} marta</span></div>
      <div style="height:9px;background:#F3EEF0;border-radius:6px;overflow:hidden"><div style="height:100%;width:${Math.round(x.st.sold/maxSold*100)}%;background:linear-gradient(90deg,var(--gold),var(--red))"></div></div></div>`).join("") : '<p style="color:var(--grey);font-size:13px">Hozircha sotuv yo\'q</p>';
    $("#incomeBody").innerHTML=`
      <div class="panel"><div class="panel-body" style="padding:12px 14px">
        <div style="font-size:12px;font-weight:700;color:var(--grey);margin-bottom:7px">DAVR</div>
        <div style="display:flex;flex-wrap:wrap">${seg("kunlik","Kunlik")}${seg("haftalik","Haftalik")}${seg("oylik","Oylik")}${seg("yillik","Yillik")}</div>
      </div></div>
      <div class="row2">
        <div class="panel"><div class="panel-head"><h3>Daromad xulosasi (${pLabel})</h3></div><div class="panel-body">
          <div class="fin-row"><span>Buyurtmalar (yetkazilgan)</span><b>${money(doneOrders.length)} ta</b></div>
          <div class="fin-row"><span>Jami savdo</span><b>${money(gross)} so'm</b></div>
          <div class="fin-row"><span>Sayt komissiyasi (${pct}%)</span><b style="color:#C8102E">−${money(commission)} so'm</b></div>
          <div class="fin-row tot"><span>Sizning daromadingiz</span><b>${money(net)} so'm</b></div>
        </div></div>
        <div class="panel"><div class="panel-head"><h3>🔥 Eng ko'p sotilgan taomlar</h3></div><div class="panel-body">
          ${bestSellers}
        </div></div>
      </div>
      <div class="panel"><div class="panel-head"><h3>Har bir taomdan qancha daromad (${pLabel})</h3></div>
        <div class="panel-body" style="padding:0;overflow-x:auto">
          <table class="tbl"><thead><tr><th>Taom</th><th>1 dona narx</th><th>Sotildi</th><th>Daromad</th></tr></thead>
          <tbody>${r.dishes.map(d=>{const st=dishStats(d);return `<tr><td><div class="tname">${d.photo?`<img src="${d.photo}" class="av" alt="" style="object-fit:cover">`:`<span class="av">${d.emoji}</span>`}${esc(d.name)}</div></td>
            <td>${money(d.price)}</td>
            <td>${money(st.sold)}</td><td class="money">${money(st.net)}</td></tr>`;}).join("")}</tbody></table>
        </div></div>
      <p style="color:var(--grey);font-size:13px;padding:4px">Eslatma: bu yerda faqat sizning taomlaringizdan keladigan daromad ko'rsatiladi.</p>`;
    $$("#incomeBody .inc-seg").forEach(function(b){
      b.addEventListener("click",function(e){ e.stopPropagation(); incomePeriod=b.dataset.period; renderIncome(); });
    });
  }

  const RSM={new:["Avtomatik kuryerga yo'naltirilgan","blue"],accepted:["Kuryerga yo'naltirilgan","blue"],ready:["Kuryer kutilmoqda","blue"],ontheway:["Yo'lda","red"],arrived:["Yetkazildi (tasdiq kutilmoqda)","blue"],done:["Yetkazildi","ok"],cancelled:["Bekor qilingan","red"]};

  /* Buyurtma restoran tasdig'isiz to'g'ridan-to'g'ri kuryerga boradi (birdan ko'rinadi).
     Restoran uni faqat 3 daqiqa ichida rad eta oladi. */
  const REJECT_WINDOW_MS=3*60*1000;
  function orderAgeMs(x){
    try{ var raw=(x&&x.created_at)||""; if(!raw) return 0;
      var m=String(raw).match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):?(\d{2})?/);
      if(!m) return 0;
      var t=Date.UTC(+m[1],+m[2]-1,+m[3],+m[4],+m[5],+(m[6]||0));  // SQLite created_at UTC
      var age=Date.now()-t; return age<0?0:age;
    }catch(e){ return 0; }
  }
  function canReject(x){ return x && x.status==="new" && orderAgeMs(x) < REJECT_WINDOW_MS; }
  function rejectLeftText(x){
    var left=Math.max(0, REJECT_WINDOW_MS-orderAgeMs(x));
    var m=Math.floor(left/60000), s=Math.floor((left%60000)/1000);
    return m+":"+String(s).padStart(2,"0");
  }
  function rActions(x){
    var b=function(act,label,bg){ return "<button class=\"r-act\" data-act=\""+act+"\" data-id=\""+x.id+"\" style=\"border:none;border-radius:8px;padding:7px 12px;font-size:13px;font-weight:700;cursor:pointer;margin:2px;background:"+bg+";color:#fff\">"+label+"</button>"; };
    /* Faqat rad etish — va faqat 3 daqiqalik oyna ichida */
    if(canReject(x)) return "<span style=\"color:var(--grey);font-size:12px;margin-right:6px\">Rad etishga: "+rejectLeftText(x)+"</span>"+b("cancelled","✕ Rad etish","#C8102E");
    return "";
  }
  /* Buyurtmalar jadvalini KO'RSATILGAN tbody ga render qiladi (bir nechta joy uchun:
     buyurtmalar bo'limi + dashboard). Logika bitta — takrorlanmaydi. */
  function renderOrdersInto(tbId){
    const o=(typeof STORE!=="undefined")?STORE.ordersFor(CUR.name):[];
    const tb=$("#"+tbId); if(!tb) return;
    tb.innerHTML=o.length?o.map(function(x){ const s=RSM[x.status]||["?","warn"];
      var ph=orderPhoto(x);
      var av=ph?"<img src=\""+ph+"\" class=\"av\" alt=\"\" style=\"object-fit:cover\">":"<span class=\"av\">"+(x.emoji||"🍽️")+"</span>";
      return "<tr style=\"cursor:pointer\" data-oid=\""+x.id+"\"><td><div class=\"tname\">"+av+esc(x.item)+"</div></td><td>"+esc(x.user)+"</td><td>📍 "+esc(x.addr)+"</td><td class=\"money\">"+money(x.amount)+"</td><td><div style=\"display:flex;align-items:center;gap:8px;flex-wrap:wrap\"><span class=\"pill "+s[1]+"\">"+s[0]+"</span>"+rActions(x)+"</div></td></tr>"; }).join("")
      :"<tr><td colspan=5 style=\"color:var(--grey);padding:20px\">Hozircha buyurtma yoq.</td></tr>";
    $$("#"+tbId+" .r-act").forEach(function(btn){ btn.addEventListener("click",function(e){ e.stopPropagation(); rAdvance(btn.dataset.id, btn.dataset.act); }); });
    $$("#"+tbId+" [data-oid]").forEach(function(row){ row.addEventListener("click",function(){ const x=o.find(function(t){return t.id==row.dataset.oid;}); openOrderModal(x); }); });
  }
  function renderOrdersView(){ renderOrdersInto("rOrdersBody"); }
  /* Dashboard'даги jonli buyurtmalar (restoran kirgan joyда darrov ko'radi) */
  function renderDashOrders(){ renderOrdersInto("dashOrdersBody"); }
  function rAdvance(id, status){
    if(status==="cancelled"){ askCancelReason(id); return; }
    if(typeof STORE!=="undefined" && STORE.updateOrder) STORE.updateOrder(id,{status:status});
    renderOrdersView(); renderDash();
    toast(status==="accepted"?"Buyurtma qabul qilindi ✓":status==="ready"?"Tayyor — kuryer chaqirildi 🛵":"Yangilandi");
  }
  /* Bekor qilish — sabab so'raladi va mijozga yuboriladi */
  function askCancelReason(id){
    var el=document.getElementById("cxReasonModal"); if(el) el.remove();
    el=document.createElement("div"); el.id="cxReasonModal";
    el.style.cssText="position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;padding:18px";
    var quick=["Mahsulot tugadi","Restoran hozir band","Manzil noaniq","Yetkazib bo'lmaydi"];
    el.innerHTML='<div style="background:#fff;border-radius:20px;max-width:420px;width:100%;padding:22px">'+
      '<h3 style="margin:0 0 6px">Buyurtmani bekor qilish</h3>'+
      '<p style="color:var(--grey);font-size:13px;margin:0 0 12px">Sababini yozing — u mijozga yuboriladi.</p>'+
      '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px">'+quick.map(function(q){return '<button type="button" class="cxq" style="border:1px solid var(--line);background:#faf7f8;border-radius:999px;padding:6px 11px;font-size:12px;cursor:pointer">'+q+'</button>';}).join("")+'</div>'+
      '<textarea id="cxReason" rows="3" placeholder="Bekor qilish sababi..." style="width:100%;box-sizing:border-box;border:1px solid var(--line);border-radius:12px;padding:10px;font-size:14px;resize:vertical"></textarea>'+
      '<div style="display:flex;gap:10px;margin-top:12px">'+
        '<button id="cxCancel" style="flex:1;padding:11px;border-radius:12px;border:1px solid var(--line);background:#fff;cursor:pointer">Yopish</button>'+
        '<button id="cxOk" style="flex:1;padding:11px;border-radius:12px;border:none;background:#C8102E;color:#fff;font-weight:700;cursor:pointer">Bekor qilish</button>'+
      '</div></div>';
    document.body.appendChild(el);
    var ta=el.querySelector("#cxReason");
    el.querySelectorAll(".cxq").forEach(function(b){ b.addEventListener("click",function(){ ta.value=b.textContent; ta.style.borderColor="var(--line)"; }); });
    el.querySelector("#cxCancel").addEventListener("click",function(){ el.remove(); });
    el.addEventListener("click",function(e){ if(e.target===el) el.remove(); });
    el.querySelector("#cxOk").addEventListener("click",function(){
      var reason=ta.value.trim(); if(!reason){ ta.style.borderColor="#C8102E"; return; }
      if(typeof STORE!=="undefined" && STORE.updateOrder) STORE.updateOrder(id,{status:"cancelled", reason:reason});
      el.remove(); var m=document.getElementById("ordModal"); if(m) m.remove();
      renderOrdersView(); renderDash();
      toast("Buyurtma bekor qilindi — sabab mijozga yuborildi");
    });
  }

  /* Buyurtma to'liq ma'lumot modali (mobil + desktop).
     MUHIM: `created_at`/`done_at` bazaga UTC yoziladi. Ilgari ular satrdan
     to'g'ridan-to'g'ri o'qilardi va restoran soat 14:30 da tushgan buyurtmani
     "09:30" deb ko'rardi. Endi hammasi Toshkent vaqtiga o'giriladi (hours.js). */
  function fmtDateTime(o){
    var raw=(o&&o.created_at)||"";
    return YZ_TIME.fmtDateTime(raw) || (o&&o.time) || "—";
  }
  /* Aniq yetkazilgan vaqt — mijoz tasdiqlaganda backend yozgan done_at */
  function orderDelivered(o){ return YZ_TIME.fmtDateTime((o&&o.done_at)||""); }
  /* Taxminiy yetib borish vaqti = buyurtma vaqti + eta (daqiqa) */
  function orderArrival(o){
    return YZ_TIME.fmtPlus((o&&o.created_at)||"", (o&&Number(o.eta))||15) || "—";
  }
  function openOrderModal(o){
    if(!o) return;
    const s=RSM[o.status]||[o.status,"warn"];
    let el=document.getElementById("ordModal"); if(el) el.remove();
    el=document.createElement("div"); el.id="ordModal";
    el.style.cssText="position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;padding:18px;backdrop-filter:blur(2px)";
    var ph=orderPhoto(o);
    var head=ph
      ? "<div style=\"width:100%;height:180px;border-radius:14px;overflow:hidden;margin-bottom:10px;background:#f4f4f6\"><img src=\""+ph+"\" alt=\"\" style=\"width:100%;height:100%;object-fit:cover\"></div>"
      : "<div style=\"text-align:center;font-size:46px\">"+(o.emoji||"🍽️")+"</div>";
    el.innerHTML="<div style=\"background:#fff;border-radius:20px;max-width:420px;width:100%;padding:22px;position:relative;max-height:90vh;overflow:auto\">"+
      "<button id=\"ordModalClose\" style=\"position:absolute;top:14px;right:14px;border:none;background:#f1f1f4;width:34px;height:34px;border-radius:50%;font-size:16px;cursor:pointer;z-index:2\">✕</button>"+
      head+
      "<h3 style=\"text-align:center;margin:6px 0 2px\">"+esc(o.item)+"</h3>"+
      "<div style=\"text-align:center;margin-bottom:14px\"><span class=\"pill "+s[1]+"\">"+s[0]+"</span></div>"+
      "<div style=\"display:flex;flex-direction:column;gap:10px;font-size:14px\">"+
        omr("Mijoz",esc(o.user)||"-")+omr("Telefon",o.phone?("<a href=\"tel:"+encodeURIComponent(o.phone)+"\" style=\"color:var(--red);text-decoration:none\">"+esc(o.phone)+"</a>"):"-")+
        omr("Manzil",esc(o.addr)||"-")+omr("Summa",money(o.amount)+" so'm")+omr("To'lov",o.pay==="cash"?"💵 Naqd":"💳 Karta")+
        omr("Kuryer",esc(o.courier)||"-")+
        omr("🕐 Buyurtma berilgan",fmtDateTime(o))+
        (orderDelivered(o)
          ? omr("✅ Yetkazilgan","<span style=\"color:#16a34a\">"+orderDelivered(o)+"</span>")
          : omr("🛵 Yetib borish (taxm.)",orderArrival(o)))+
        (o.reason?omr("Bekor sababi","<span style=\"color:#C8102E\">"+esc(o.reason)+"</span>"):"")+
      "</div>"+
      (canReject(o)?"<div style=\"display:flex;align-items:center;gap:8px;margin-top:16px\">"+rActions(o)+"</div><p style=\"color:var(--grey);font-size:12px;margin-top:8px\">Buyurtma avtomatik kuryerga yo'naltirildi. 3 daqiqa ichida rad etishingiz mumkin.</p>":"")+
      "</div>";
    document.body.appendChild(el);
    try{ history.pushState({ordModal:1}, ""); }catch(e){}
    let popped=false;
    const close=function(){ el.remove(); if(!popped){ popped=true; try{ history.back(); }catch(e){} } };
    el._closeOnBack=function(){ popped=true; el.remove(); };
    $$("#ordModal .r-act").forEach(function(btn){ btn.addEventListener("click",function(e){ e.stopPropagation(); rAdvance(btn.dataset.id, btn.dataset.act); close(); }); });
    el.addEventListener("click",function(e){ if(e.target===el) close(); });
    document.getElementById("ordModalClose").addEventListener("click",close);
  }
  /* App ortga: modal ochiq bo'lsa back uni yopadi */
  window.addEventListener("popstate",function(){ const m=document.getElementById("ordModal"); if(m){ if(m._closeOnBack) m._closeOnBack(); else m.remove(); } });
  function omr(k,v){ return "<div style=\"display:flex;justify-content:space-between;gap:10px\"><span style=\"color:var(--grey)\">"+k+"</span><b style=\"text-align:right\">"+v+"</b></div>"; }
  function renderRestReviews(){
    const tb=$("#restReviews"); if(!tb) return;
    const names=CUR.dishes.map(function(d){return d.name;});
    const rv=((typeof STORE!=="undefined")?STORE.reviews():[]).filter(function(r){return names.indexOf(r.dish)>=0;});
    tb.innerHTML=rv.length?rv.map(function(r){ const rr=Math.max(0,Math.min(5,r.rating|0)); return `<div style="padding:10px 0;border-bottom:1px solid var(--line)"><div style="display:flex;justify-content:space-between"><b>${r.ava||"👤"} ${esc(r.name)} → ${esc(r.dish)}</b><span class="star">${"★".repeat(rr)}${"☆".repeat(5-rr)}</span></div><div style="font-size:14px;margin-top:4px">${esc(r.text)} ${r.flagged?'<span class="pill red">signal</span>':''}</div></div>`; }).join(""):`<p style="color:var(--grey)">Sizning taomlaringizga hali izoh yo'q.</p>`;
  }
  function renderAll(){ renderDash(); renderOrdersView(); renderDishes(); renderIncome(); renderPromo(); renderRestReviews(); }

  /* ===== SOZLAMALAR: login / parol o'zgartirish ===== */
  function curSession(){ try{ return (typeof STORE!=="undefined")?STORE.session():null; }catch(e){ return null; } }
  function curRestBackend(){
    try{ return (typeof STORE!=="undefined"&&STORE.restaurants)?STORE.restaurants().find(x=>x.login===(CUR&&CUR.login)||x.name===(CUR&&CUR.name)):null; }catch(e){ return null; }
  }
  function fillSettings(){
    var ses=curSession()||{};
    var li=$("#setLogin"); if(li) li.value=(CUR&&CUR.login)||ses.login||"";
    var nm=$("#setName");  if(nm) nm.value=(CUR&&CUR.name)||ses.name||"";
    /* Restoran ma'lumotlari (saytda ko'rinadigan) */
    var be=curRestBackend()||{};
    var set=function(id,v){ var el=$(id); if(el && document.activeElement!==el) el.value=(v==null?"":v); };
    set("#setDescr", be.descr);
    set("#setAddr", be.addr);
    set("#setArea", be.area);
    set("#setEmail", be.email);
    set("#setOpenH", be.openH!=null?be.openH:9);
    set("#setCloseH", be.closeH!=null?be.closeH:23);
    renderHoursPreview();
  }
  /* Telegramga ulash (umumiy widget — assets/js/tg-link.js).
     Faqat "Sozlamalar" ochilganда chiziladi: har polling'да qayta chizilса,
     ko'rsatilgan ulash kodi yo'qolib ketardi. */
  function renderRestTg(){
    if(window.YZ_TG && typeof STORE!=="undefined") YZ_TG.render("rTgArea", STORE, toast);
  }

  /* Sozlamalarda ish vaqtining JONLI ko'rinishi — restoran egasi o'zgartirgan
     zahoti "hozir ochiq/yopiq" ni ko'radi (mijoz aynan shuni ko'radi). */
  function renderHoursPreview(){
    var box=$("#setHoursNow"); if(!box) return;
    var oh=parseInt(($("#setOpenH")||{}).value,10), ch=parseInt(($("#setCloseH")||{}).value,10);
    var open, hrs;
    try{ open=YZ_TIME.isOpen(oh,ch,9,23); hrs=YZ_TIME.text(oh,ch,9,23); }
    catch(e){ return; }
    var nowTxt=""; try{ nowTxt=YZ_TIME.nowClock(); }catch(e){}
    box.innerHTML='<span class="yz-openbadge '+(open?'is-open':'is-closed')+'">'+(open?'🟢 Hozir ochiq':'🔴 Hozir yopiq')+'</span>'+
      '<span style="color:var(--grey);font-size:12.5px;margin-left:8px">'+esc(hrs)+' · Toshkent vaqti '+esc(nowTxt)+'</span>';
  }
  async function saveRestInfo(){
    var val=function(id){ var el=$(id); return el?el.value:undefined; };
    var data={
      descr:(val("#setDescr")||"").trim(),
      addr:(val("#setAddr")||"").trim(),
      area:(val("#setArea")||"").trim(),
      email:(val("#setEmail")||"").trim(),
      openH:parseInt(val("#setOpenH"),10),
      closeH:parseInt(val("#setCloseH"),10)
    };
    if(isNaN(data.openH)) delete data.openH;
    if(isNaN(data.closeH)) delete data.closeH;
    /* Ish vaqti oraliqlari (hours.js bilan bir xil):
         09 → 23  oddiy kun
         20 → 02  tungi smena (yarim tundan oshadi) — RUXSAT ETILADI
         09 → 09  24 soat
       Ilgari "yopilish ochilishdan katta bo'lsin" deb tungi smena taqiqlangan edi. */
    if(data.openH!=null && (data.openH<0 || data.openH>23)){ toast("Ochilish soati 0–23 oralig'ida bo'lsin"); return; }
    if(data.closeH!=null && (data.closeH<0 || data.closeH>24)){ toast("Yopilish soati 0–24 oralig'ida bo'lsin"); return; }
    var btn=$("#setInfoBtn"); if(btn) btn.disabled=true;
    try{
      var r=(typeof STORE!=="undefined"&&STORE.updateRestaurantInfo)? await STORE.updateRestaurantInfo(data) : null;
      if(r && !r.error){
        toast("Ma'lumot saqlandi — saytda ko'rinadi ✓");
        /* Yangi ish vaqti darrov panelda ham aks etsin (mijoz ko'radiganidek) */
        try{ renderHoursPreview(); yzUpdateOnline(); }catch(e){}
      }
      else toast((r&&r.error)||"Serverga ulanib bo'lmadi");
    }catch(e){ toast("Xatolik — qayta urinib ko'ring"); }
    if(btn) btn.disabled=false;
  }
  async function saveLogin(){
    var li=$("#setLogin"); if(!li) return;
    var v=li.value.trim();
    if(v.length<3){ toast("Login kamida 3 belgi bo'lsin"); return; }
    var cur=(CUR&&CUR.login)||(curSession()||{}).login||"";
    if(v===cur){ toast("Login o'zgarmadi"); return; }
    var btn=$("#setLoginBtn"); if(btn) btn.disabled=true;
    try{
      var acc=(typeof STORE!=="undefined"&&STORE.updateProfile)? await STORE.updateProfile({login:v}) : null;
      if(acc && !acc.error && acc.login){ CUR&&(CUR.login=acc.login); $("#sbName")&&($("#sbName").textContent=CUR?CUR.name:$("#sbName").textContent); toast("Login yangilandi ✓"); }
      else toast((acc&&acc.error)||"Bu login band yoki serverga ulanib bo'lmadi");
    }catch(e){ toast("Xatolik — qayta urinib ko'ring"); }
    if(btn) btn.disabled=false;
    fillSettings();
  }
  async function savePass(){
    var p1=$("#setPass"), p2=$("#setPass2");
    var a=p1?p1.value:"", b=p2?p2.value:"";
    if(a.length<4){ toast("Parol kamida 4 belgi bo'lsin"); return; }
    if(a!==b){ toast("Parollar mos kelmadi"); return; }
    var btn=$("#setPassBtn"); if(btn) btn.disabled=true;
    try{
      var acc=(typeof STORE!=="undefined"&&STORE.updateProfile)? await STORE.updateProfile({pass:a}) : null;
      if(acc && !acc.error){ if(p1)p1.value=""; if(p2)p2.value=""; toast("Parol yangilandi ✓"); }
      else toast((acc&&acc.error)||"Serverga ulanib bo'lmadi — qayta urinib ko'ring");
    }catch(e){ toast("Xatolik — qayta urinib ko'ring"); }
    if(btn) btn.disabled=false;
  }
  function togglePassShow(){
    var on=$("#setPassShow")&&$("#setPassShow").checked;
    ["#setPass","#setPass2"].forEach(function(s){ var el=$(s); if(el) el.type=on?"text":"password"; });
  }

  /* Admin qo'shgan (lokal demo massivда yo'q) restoran uchun backenddan minimal panel */
  function buildBackendRest(ses){
    let be=null;
    try{ be=(typeof STORE!=="undefined"&&STORE.restaurants)?STORE.restaurants().find(x=>x.login===ses.login||x.name===ses.name):null; }catch(e){}
    const nameV=(be&&be.name)||ses.name||ses.login;
    let dishes=[];
    try{ dishes=((typeof STORE!=="undefined"&&STORE.overrides)?(STORE.overrides().added||[]):[]).filter(d=>d.rest===nameV)
          .map(d=>({name:d.name,emoji:d.emoji||"🍽️",price:d.price||0,sold:d.sold||0,discount:0,photo:d.photo||""})); }catch(e){}
    const r={ id:(be&&be.id)||Date.now(), name:nameV, emoji:(be&&be.emoji)||"🏪", login:ses.login,
      rating:(be&&be.rating)||0, commissionPct:(be&&be.commission!=null)?be.commission:18, dishes:dishes, announcements:[] };
    recompute(r);
    return r;
  }

  /* Sessiyadan panelni ochish (rol allaqachon tasdiqlangan bo'lishi kerak) */
  async function enterFromSession(ses){
    var rr=RESTS.find(x=>x.login===ses.login);
    if(!rr){ try{ if(STORE.ready) await STORE.ready(); }catch(e){} rr=buildBackendRest(ses); }
    enter(rr);
  }

  document.addEventListener("DOMContentLoaded", async ()=>{
    /* ===== Sessiya SERVERда tekshiriladi =====
       localStorage'dagi yz_session ga ishonmaymiz — rol /api/auth/me dan keladi. */
    $("#loginWrap").style.display="flex"; $("#app").classList.remove("show");
    if(typeof STORE!=="undefined" && STORE.sessionExpired && STORE.sessionExpired()){
      var le=$("#loginErr"); if(le) le.textContent="Sessiyangiz tugadi — qaytadan kiring.";
    }
    if(typeof STORE!=="undefined" && STORE.verifySession){
      try{
        var v=await STORE.verifySession();
        if(v.ok && v.account.role==="restoran"){ await enterFromSession(v.account); }
        else if(!v.ok && v.reason==="offline" && v.session && v.session.role==="restoran"){
          await enterFromSession(v.session);   // tarmoq yo'q — keshdagi holat bilan
        }
      }catch(e){}
    }
    $("#loginBtn").addEventListener("click",login);
    $("#rlPass").addEventListener("keydown",e=>{ if(e.key==="Enter") login(); });
    $$(".sb-link").forEach(l=>l.addEventListener("click",()=>nav(l.dataset.view)));
    $("#logoutBtn").addEventListener("click",()=>{ if(typeof STORE!=="undefined") STORE.clearSession(); $("#app").classList.remove("show"); $("#loginWrap").style.display="flex"; $("#rlPass").value=""; CUR=null; try{location.href="index.html";}catch(e){} });
    // menuToggle — HTML dagi script boshqaradi (ikki listener bo'lmasin)
    $("#addDishBtn").addEventListener("click",addDish);
    /* Rasm tanlanganда fayl nomini ko'rsatish. Ilgari HTML da inline
       onchange="..." edi — CSP inline hodisalarni bloklaydi. */
    (function(){
      var inp=$("#ndPhoto"), txt=$("#ndPhotoTxt");
      if(!inp||!txt) return;
      inp.addEventListener("change",function(){
        txt.textContent=(this.files&&this.files[0])?this.files[0].name:"Rasm tanlash yoki suratga olish";
      });
    })();
    $("#annBtn").addEventListener("click",postAnnounce);
    /* Reklama rasmi tanlanganda — kichik ko'rinish (preview) */
    var annPhoto=$("#annPhoto");
    if(annPhoto) annPhoto.addEventListener("change", async function(e){
      var f=e.target.files && e.target.files[0]; var pv=$("#annPhotoPreview");
      if(!f || !pv) return;
      var dataUrl=await resizeImage(f, 500);
      if(dataUrl){ pv.style.display="block"; pv.innerHTML='<img src="'+dataUrl+'" alt="" style="max-width:170px;max-height:120px;border-radius:12px;object-fit:cover;border:1px solid var(--line)">'; }
    });
    var ddb=$("#discDishBtn"); if(ddb) ddb.addEventListener("click",openDishPicker);
    $("#discBtn").addEventListener("click",applyDiscount);
    /* Sozlamalar */
    var slb=$("#setLoginBtn"); if(slb) slb.addEventListener("click",saveLogin);
    var spb=$("#setPassBtn");  if(spb) spb.addEventListener("click",savePass);
    var sps=$("#setPassShow");  if(sps) sps.addEventListener("change",togglePassShow);
    var sib=$("#setInfoBtn");  if(sib) sib.addEventListener("click",saveRestInfo);
    /* Ish vaqti maydonlari o'zgarganda "hozir ochiq/yopiq" darrov ko'rinsin */
    ["#setOpenH","#setCloseH"].forEach(function(id){
      var el=$(id); if(el) el.addEventListener("input",renderHoursPreview);
    });
    fillSettings();
    /* Soat o'tishi bilan holat o'zgarsin (sahifa ochiq turganda ham) */
    setInterval(function(){ try{ renderHoursPreview(); }catch(e){} }, 30000);
    /* 5-daqiqalik rad etish oynasi hisoblagichi jonli yangilanadi */
    setInterval(function(){
      try{
        var ov=document.getElementById("view-orders");
        if(!CUR || !ov || !ov.classList.contains("show")) return;
        var live=(typeof STORE!=="undefined"&&STORE.ordersFor)?STORE.ordersFor(CUR.name):[];
        if(live.some(function(o){ return o.status==="new" && orderAgeMs(o) < REJECT_WINDOW_MS+1500; })) renderOrdersView();
      }catch(e){}
    }, 1000);
  });

  /* ===== Online holati: tepadagi "● Online" bosilsa modal chiqadi =====
     MUHIM: ish vaqti — RESTORANNING O'ZINIKI (sozlamalarda belgilaydi, admin
     ham o'zgartira oladi). Ilgari bu yerda 08:00–22:00 qotirib yozilgan edi va
     restoran soat 23 gacha ishlasa ham panelda "Offline" ko'rinardi, saytda esa
     boshqacha — endi ikkalasi ham hours.js (Asia/Tashkent) ga tayanadi. */
  function yzRestRow(){ return curRestBackend(); }
  function yzIsWork(){ try{ return YZ_TIME.restOpen(yzRestRow()); }catch(e){ return true; } }
  function yzHoursText(){ try{ return YZ_TIME.restHours(yzRestRow()); }catch(e){ return "09:00–23:00"; } }
  function yzUpdateOnline(){
    var b=document.querySelector(".tb-badge"); if(!b) return;
    var work=yzIsWork();
    b.textContent=work?"🟢 Ochiq":"🔴 Yopiq";
    b.title="Ish vaqti: "+yzHoursText();
    b.style.background=work?"#16a34a":"#9ca3af"; b.style.color="#fff";
  }
  function yzOnlineModal(){
    var work=yzIsWork(), hrs=yzHoursText();
    var next=""; try{ next=YZ_TIME.restNext(yzRestRow()); }catch(e){}
    var el=document.getElementById("yzOnlineModal"); if(el) el.remove();
    el=document.createElement("div"); el.id="yzOnlineModal";
    el.style.cssText="position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;padding:18px";
    var row=function(k,v){ return '<div style="display:flex;justify-content:space-between;gap:10px"><span style="color:var(--grey)">'+k+'</span><b>'+v+'</b></div>'; };
    el.innerHTML='<div style="background:#fff;border-radius:20px;max-width:400px;width:100%;padding:22px;position:relative">'+
      '<button id="yzOnClose" style="position:absolute;top:14px;right:14px;border:none;background:#f1f1f4;width:34px;height:34px;border-radius:50%;font-size:16px;cursor:pointer">✕</button>'+
      '<h3 style="margin:0 0 14px">🕒 Holat va ish vaqti</h3>'+
      '<div style="display:flex;flex-direction:column;gap:10px;font-size:14px">'+
      row("Hozirgi holat",'<span style="color:'+(work?"#16a34a":"#9ca3af")+'">'+(work?"🟢 Ochiq":"🔴 Yopiq")+'</span>')+
      row("Ish vaqti",esc(hrs))+
      row("Hozir soat (Toshkent)",YZ_TIME.nowClock())+
      (next?row("Keyingi o'zgarish",esc(next)):"")+
      '</div><p style="color:var(--grey);font-size:13px;margin-top:14px">Ish vaqti tashqarisida restoraningiz saytda va Telegram ilovasida <b>yopiq</b> ko\'rinadi — mijozlar buyurtma bera olmaydi. Vaqtni <b>Sozlamalar → Ish vaqti</b> bo\'limida o\'zgartirasiz.</p></div>';
    document.body.appendChild(el);
    el.querySelector("#yzOnClose").addEventListener("click",function(){ el.remove(); });
    el.addEventListener("click",function(e){ if(e.target===el) el.remove(); });
  }
  document.addEventListener("DOMContentLoaded",function(){
    var b=document.querySelector(".tb-badge"); if(b){ b.style.cursor="pointer"; b.addEventListener("click",yzOnlineModal); }
    yzUpdateOnline(); setInterval(yzUpdateOnline,30000);
    /* Backenddan ma'lumot kelgach (yoki admin vaqtni o'zgartirgach) — yangilaymiz */
    if(typeof STORE!=="undefined" && STORE.onChange) STORE.onChange(function(){ try{ yzUpdateOnline(); fillSettings(); }catch(e){} });
  });

})();
