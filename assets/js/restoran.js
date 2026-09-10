/* ===== Yetkaz.uz — Restoran egasi paneli ===== */
(function(){
  try{ if(typeof STORE!=="undefined") STORE.setPanelRole("restoran"); }catch(e){}
  const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
  const money=n=>Math.round(n).toLocaleString("ru-RU");
  const mln=n=>(n/1e6).toFixed(1).replace(".",",")+" mln";
  /* XSS himoyasi — ta'rif assets/js/safe.js da (YAGONA manba, `'` ni ham escape
     qiladi). Bu yerда faqat qisqartma. Yangi kod uchun: html`...` teg shabloni. */
  const esc=YZ_SAFE.esc, html=YZ_SAFE.html, raw=YZ_SAFE.raw;

  /* Har bir restoran FAQAT o'z ma'lumotlarini ko'radi. Kuryer/sayt ichki foydasi YO'Q. */
  /* Parollar bu yerda saqlanmaydi — kirish backend orqali (xeshlangan) tekshiriladi */
  const RESTS=[];
  function priceOf(d){ return Math.round(d.price*(1-(d.discount||0)/100)); }
  /* Restoranning shartnoma komissiyasi. MUHIM: sayt komissiyasi ommaviy
     bootstrap'дан olib tashlangan (mijozga ko'rinmasin) — shuning uchun uni
     endi restoran O'Z SESSIYASIDAN oladi (login/`/me` javobida keladi, faqat
     restoranning o'ziga). CUR.commission — kirishда o'rnatiladi. */
  function restPct(r){
    if(r && r.commission!=null) return Number(r.commission)||0;
    try{ const ses=curSession(); if(ses && ses.commission!=null) return Number(ses.commission)||0; }catch(e){}
    return (r&&r.commissionPct!=null)?r.commissionPct:18;
  }
  /* ===== HAQIQIY SOTUV — buyurtma TARKIBIDAN (o.items) =====
     Ilgari statistika buyurtma YORLIG'I bo'yicha hisoblanardi ("Osh +2 ta"):
     ko'p taomli buyurtmada faqat birinchi taom sanalar, butun summa esa
     o'shanga yozilardi — ya'ni "eng ko'p sotilgan taom" va "taomdan daromad"
     jadvallari noto'g'ri edi. Endi har bir taom O'Z dona soni va O'Z summasi
     bilan hisoblanadi (server pricing.js bergan qatorlardan).

     Qaytadi: { "Taom nomi": {name, emoji, qty, gross, orders} } */
  function salesMap(orders){
    var m={};
    function bucket(name, emoji){
      var k=String(name||"").trim(); if(!k) return null;
      if(!m[k]) m[k]={name:k, emoji:emoji||"🍽️", qty:0, gross:0, orders:0};
      return m[k];
    }
    (orders||[]).forEach(function(o){
      var ls=[]; try{ ls=YZ_ITEMS.lines(o); }catch(e){}
      if(ls.length){
        ls.forEach(function(l){
          var b=bucket(l.name, l.emoji); if(!b) return;
          var q=Number(l.qty)||0;
          b.qty+=q;
          b.gross+=Number(l.sum) || ((Number(l.eff)||Number(l.price)||0)*(q||1));
          b.orders++;
        });
      } else {
        /* Eski buyurtma — tarkibi saqlanmagan. Yorliqdan ("Osh +2 ta") taxminan
           olamiz, aks holda eski sotuvlar hisobdan butunlay tushib qolardi. */
        var b=bucket(String(o.item||"").replace(/\s*\+\d+\s*ta\s*$/,""), o.emoji); if(!b) return;
        b.qty+=Number(o.qtyTotal)||1;
        b.gross+=Number(o.amount)||0;
        b.orders++;
      }
    });
    return m;
  }
  /* Restoranning yetkazilgan (pul tushgan) buyurtmalari */
  function doneOrdersOf(rest){
    try{ return ((typeof STORE!=="undefined"&&STORE.ordersFor)?STORE.ordersFor(rest):[]).filter(function(o){return o.status==="done";}); }
    catch(e){ return []; }
  }
  /* Restoranга tushadigan sof summa — server buyurtmaga MUHRLAGAN foiz bo'yicha
     (o.restNet). Eski buyurtmalarda maydon bo'lmasa — berilgan (yoki joriy) foiz bilan. */
  function netOf(o, pct){
    if(o && o.restNet!=null) return Number(o.restNet)||0;
    var p=(pct!=null && isFinite(pct)) ? Number(pct) : 18;
    return Math.round((Number(o&&o.amount)||0)*(100-p)/100);
  }

  /* MUHIM: komissiya HAR BUYURTMAGA muhrlanadi (har xil foiz bo'lishi mumkin) va
     bir buyurtmada bir necha taom bo'ladi — shuning uchun "bitta taomga qancha
     komissiya" ANIQ emas. Yagona to'g'ri usul: butun restoran bo'yicha haqiqiy
     qoldiq ulushi (net/gross) ni taomlarga PROPORSIONAL taqsimlash. */

  /* Taomlar bo'yicha "sizga qoladi" ni ANIQ taqsimlaydi: yig'indi berilgan
     `totalNet` ga TENG bo'ladi — 1 so'm ham yo'qolmaydi/qo'shilmaydi (eng katta
     kasrli qoldiqqa ega taomlarga ortiqcha so'm(lar) beriladi — "largest remainder"). */
  function allocNet(items, totalGross, totalNet){
    var out={};
    if(!items.length) return out;
    if(!totalGross){ items.forEach(function(it){ out[it.key]=0; }); return out; }
    var acc=0, fr=[];
    items.forEach(function(it){
      var exact=it.gross*totalNet/totalGross;
      var fl=Math.floor(exact);
      out[it.key]=fl; acc+=fl;
      fr.push({key:it.key, f:exact-fl});
    });
    var left=Math.round(totalNet-acc);
    fr.sort(function(a,b){return b.f-a.f;});
    for(var i=0;i<fr.length && i<left;i++) out[fr[i].key]+=1;
    if(left>fr.length && fr.length) out[fr[0].key]+=(left-fr.length);
    return out;
  }

  /* Bir buyurtma ro'yxati (done) bo'yicha taom -> {qty, gross, orders, net}.
     `net` — taomlar yig'indisi KO'RSATILGAN taomlarning sof daromadiga teng
     bo'ladigan qilib taqsimlangan. «Taomlar» va «Daromad» jadvallari SHUNI
     ishlatadi — ikkalasi bir xil. */
  function dishTable(doneOrders, dishes, r){
    var sales=salesMap(doneOrders);
    var totGross=doneOrders.reduce(function(s,o){return s+(Number(o.amount)||0);},0);
    var totNet=doneOrders.reduce(function(s,o){return s+netOf(o, restPct(r));},0);
    var keepRate=totGross ? (totNet/totGross) : ((100-restPct(r))/100);
    /* Ko'rsatilgan taomlar bo'yicha tushum (o'chirilgan taom tarixi bo'lsa —
       undan kamroq); shu qismning sof daromadi = shownGross*keepRate. */
    var shownGross=(dishes||[]).reduce(function(s,d){return s+((sales[d.name]&&sales[d.name].gross)||0);},0);
    var shownNet=Math.round(shownGross*keepRate);
    var items=(dishes||[]).map(function(d){return {key:d.name, gross:(sales[d.name]&&sales[d.name].gross)||0};});
    var alloc=allocNet(items, shownGross, shownNet);
    var out={};
    (dishes||[]).forEach(function(d){
      var s=sales[d.name];
      out[d.name]={ qty:s?s.qty:0, gross:s?s.gross:0, orders:s?s.orders:0, net:alloc[d.name]||0 };
    });
    out.__totals={ gross:totGross, net:totNet, shownGross:shownGross, shownNet:shownNet };
    return out;
  }

  function recompute(r){
    var done=doneOrdersOf(r&&r.name);
    var dt=dishTable(done, r.dishes, r);
    r.dishes.forEach(d=>{
      var t=dt[d.name]||{qty:0,gross:0,net:0};
      d.eff=priceOf(d);
      d.sold=t.qty;                           // REAL dona soni (katalog ustuni emas)
      d.gross=t.gross;                        // REAL tushum (chegirma qo'llangan holda)
      d.net=t.net;                            // taqsimlangan sof ulush
      d.commission=d.gross-d.net;
    });
    r.gross=dt.__totals.gross;
    r.net=dt.__totals.net;
    r.commission=r.gross-r.net;
    r.orders=done.length;
  }
  RESTS.forEach(r=>{ r.discount=0; r.announcements=[]; r.dishes.forEach(d=>d.discount=d.discount||0); recompute(r); });

  let CUR=null;

  /* Taomlarni backend katalogidan yuklaymiz — qo'shilgan/o'chirilgan SAQLANADI */
  function loadDishes(){
    if(!CUR) return;
    try{
      if(typeof STORE!=="undefined" && STORE.mergeDishes && typeof DISHES!=="undefined"){
        const cat=STORE.mergeDishes(DISHES).filter(d=>d.rest===CUR.name);
        CUR.dishes=cat.map(d=>({name:d.name,emoji:d.emoji||"🍽️",price:d.price||0,sold:d.sold||0,discount:d.discount||0,photo:d.photo||"",
          rating:d.rating||0, ratingCount:d.ratingCount||0, kind:d.kind||"taom", maxQty:d.maxQty||0}));
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
      /* Komissiyani sessiyadан olamiz (ommaviy bootstrap'да yo'q) */
      if(r){ if(acc.commission!=null) r.commission=acc.commission; enter(r); return; }
      enter({name:acc.name,login:acc.login,commission:(acc.commission!=null?acc.commission:18)}); return;
    }
    if(acc && acc.target){ try{ location.href=acc.target; }catch(e){} return; }
    $("#loginErr").textContent="Login yoki parol xato.";
  }
  function syncFromBackend(){
    try{
      var list=(typeof STORE!=="undefined"&&STORE.restaurants)?STORE.restaurants():[];
      /* Avval login bo'yicha, topilmasa NOM bo'yicha topamiz. Ilgari faqat login
         bo'yicha qidirilardi: login nusxasi (restaurants.login) accounts bilan
         mos kelmay qolsa, restoran o'z ma'lumotini (nom/rasm/ish vaqti) umuman
         topolmasdi. Backend endi loginni yarashtiradi, bu esa qo'shimcha himoya. */
      var be=list.find(function(x){return x.login===CUR.login;}) || list.find(function(x){return x.name===CUR.name;}) || null;
      if(be){ CUR.name=be.name; if(be.emoji)CUR.emoji=be.emoji; CUR.photo=be.photo||CUR.photo; if(be.login)CUR.login=be.login; }
    }catch(e){}
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

  /* ===== RESTORAN NOMI — panelning BIRINCHI sahifasida =====
     Yon menyudagi kichik yozuv yetarli emas edi: telefonda menyu yopiq turadi
     va restoran o'z nomini umuman ko'rmasdi. Endi dashboard tepasida rasm,
     nom, ish vaqti va manzil bilan turadi. */
  function renderRestHead(){
    var box=document.getElementById("restHead"); if(!box||!CUR) return;
    var p=curRestPhoto();
    var be=(function(){ try{ return (STORE.restaurants()||[]).find(function(x){return x.name===CUR.name;})||{}; }catch(e){ return {}; } })();
    var open=(function(){ try{ return YZ_TIME.restOpen(be); }catch(e){ return true; } })();
    var hrs=(function(){ try{ return YZ_TIME.restHours(be); }catch(e){ return ""; } })();
    box.innerHTML=
      '<div class="rest-head-ava">'+(p?'<img src="'+esc(p)+'" alt="">':esc(CUR.emoji||"🏪"))+'</div>'+
      '<div class="rest-head-info">'+
        '<div class="rest-head-kicker">Restoran paneli</div>'+
        '<h1 class="rest-head-name">'+esc(CUR.name)+'</h1>'+
        '<div class="rest-head-meta">'+
          '<span class="'+(open?'rh-open':'rh-closed')+'">'+(open?'🟢 Ochiq':'🔴 Yopiq')+(hrs?' · '+esc(hrs):'')+'</span>'+
          (be.addr?'<span>📍 '+esc(be.addr)+'</span>':'')+
        '</div>'+
      '</div>';
  }

  function nav(view){
    $$(".sb-link").forEach(l=>l.classList.toggle("active",l.dataset.view===view));
    $$(".view").forEach(v=>v.classList.toggle("show",v.id==="view-"+view));
    const t={dash:"Mening panelim",orders:"Buyurtmalar",dishes:"Taom qo'shish",income:"Daromad hisoboti",promo:"E'lon va chegirma",help:"Shikoyat / yordam",settings:"Sozlamalar"};
    if(view==="settings"){ fillSettings(); renderRestPhotoCard(); }
    if(view==="help"){ try{ YZ_COMPLAINT.mount(document.getElementById("restComplaintBox")); }catch(e){} }
    /* Sarlavhada restoran nomi ham turadi — qaysi restoran sifatida
       ishlayotgani har bo'limda ko'rinib tursin. */
    $("#tbTitle").textContent=(CUR&&CUR.name) ? (CUR.name+" — "+(t[view]||"")) : (t[view]||"");
    if(view==="dash") renderRestHead();
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
  /* Rasm yuklash SOZLAMALARДА (#rPhotoArea) — ilgari dashboard tepasida turib,
     buyurtmalarni pastga surib yuborardi. Endi dashboardда faqat buyurtmalar. */
  function renderRestPhotoCard(){
    var card=document.getElementById("rPhotoArea"); if(!card) return;
    var p=curRestPhoto();
    card.innerHTML='<div><div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap">'+
      '<div style="width:76px;height:76px;border-radius:16px;background:#f3eef0;display:flex;align-items:center;justify-content:center;font-size:36px;overflow:hidden;flex:none">'+
        (p?'<img src="'+p+'" alt="" style="width:100%;height:100%;object-fit:cover">':(CUR.emoji||"\ud83c\udfea"))+'</div>'+
      '<div style="flex:1;min-width:190px">'+
        '<p style="color:var(--grey);font-size:13px;margin:0 0 8px">Rasmni yuklang yoki kameradan oling — bosh sahifada kartochkangizda ko\'rinadi.</p>'+
        '<label class="set-save" style="display:inline-block;cursor:pointer;padding:9px 14px">\ud83d\udcf7 Rasm tanlash / olish'+
          '<input type="file" id="restPhotoInput" accept="image/*" capture="environment" style="display:none"></label>'+
        (p?'<div style="color:var(--grey);font-size:12px;margin-top:7px">Rasm yuklangan ✓ — almashtirish uchun qayta tanlang</div>'
          :'<div style="color:var(--grey);font-size:12px;margin-top:7px">Rasm hali yuklanmagan — hozircha belgi ko\'rsatilmoqda</div>')+
      '</div></div></div>';
    var inp=document.getElementById("restPhotoInput");
    if(inp) inp.addEventListener("change",function(e){ if(e.target.files&&e.target.files[0]) uploadRestPhoto(e.target.files[0]); });
  }
  /* Sof daromad davri: 'kunlik' | 'haftalik' | 'oylik' | 'yillik'.
     Davr/ustun bo'linishi YZ_TIME.incomeChart da (admin/kuryer bilan bir xil). */
  let incomePeriod="oylik";
  function renderDash(){
    const r=CUR;
    /* REAL hisob-kitob: pul FAQAT mijoz tasdiqlagan (done) buyurtmalardan yoziladi.
       Bekor qilinganlar daromadga kirmaydi. Davr (kunlik/haftalik/oylik) tanlanadi. */
    const live=(typeof STORE!=="undefined"&&STORE.ordersFor)?STORE.ordersFor(r.name):[];
    const paid=live.filter(o=>o.status==="done");            // mijoz qabul qilgan = to'lov yozilgan
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
    /* Daromad grafigi «Daromad hisoboti» bo'limida (renderIncome) — davrga
       qarab o'zgaradi va ustunlar yig'indisi kartadagi raqamga teng bo'ladi. */
    /* REAL: eng ko'p sotilgan va talab — buyurtma TARKIBI bo'yicha.
       Har taom o'z dona soni bilan sanaladi (yorliq emas — salesMap izohiga q.). */
    const agg=salesMap(paid);
    const top=Object.values(agg).sort((a,b)=>b.qty-a.qty).slice(0,5);
    $("#topDishes").innerHTML=top.length?top.map((d,i)=>`
      <div class="topitem" data-topname="${esc(d.name)}" style="cursor:pointer"><span class="rank">${i+1}</span><span style="font-size:20px">${d.emoji}</span>
        <span class="ti-name">${esc(d.name)}</span><span class="ti-val">${money(d.qty)} dona</span></div>`).join(""):'<p style="color:var(--grey);font-size:13px">Hozircha buyurtma yo\'q</p>';
    const maxd=(top[0]&&top[0].qty)||1;
    $("#demandList").innerHTML=top.length?top.map(d=>`
      <div style="margin-bottom:12px"><div style="display:flex;justify-content:space-between;font-size:14px;margin-bottom:4px"><b>${d.emoji} ${esc(d.name)}</b><span>${money(d.qty)} dona · ${money(d.orders)} buyurtmada</span></div>
      <div style="height:9px;background:#F3EEF0;border-radius:6px;overflow:hidden"><div style="height:100%;width:${Math.round(d.qty/maxd*100)}%;background:linear-gradient(90deg,var(--gold),var(--red))"></div></div></div>`).join(""):'<p style="color:var(--grey);font-size:13px">Talab ma\'lumoti buyurtmalar bilan to\'ladi</p>';
    /* Eng ko'p sotilgan taom ustiga bosilganda — to'liq ma'lumot (asl rasm bilan) */
    $$("#topDishes .topitem").forEach(function(it){ it.addEventListener("click",function(){
      const nm=it.dataset.topname; const d=agg[nm]; if(!d) return;
      showTopDishModal(d, findRestDish(nm));
    }); });
    /* Rasm kartochkasi endi SOZLAMALARДА — u yerда nav()/fillSettings chizadi */
    renderRestHead();       // restoran nomi — birinchi sahifaning eng tepasida
    renderDashOrders();     // dashboard'даги jonli buyurtmalar (eng tepada)
    renderSourceStats();    // bot va sayt reytingi
    renderTopCustomers();
  }
  /* Bot va sayt reytingi — restoranga necha foiz buyurtma botdan, necha foiz saytdan */
  function renderSourceStats(){
    var host=document.getElementById("view-dash"); if(!host) return;
    var orders=((typeof STORE!=="undefined"&&STORE.ordersFor)?STORE.ordersFor(CUR.name):[]).filter(function(o){return o.status!=="cancelled";});
    var tg=orders.filter(function(o){return o.source==="telegram";});
    var web=orders.filter(function(o){return o.source!=="telegram";});
    var total=orders.length||1;
    var tgP=orders.length?Math.round(tg.length/total*100):0, webP=orders.length?100-tgP:0;
    var box=document.getElementById("restSrcStats");
    if(!box){ box=document.createElement("div"); box.id="restSrcStats"; box.className="panel"; box.style.marginTop="16px"; host.appendChild(box); }
    /* Manba bo'yicha mijozlar (telefon bo'yicha) */
    var map={};
    orders.forEach(function(o){ var d=String(o.phone||"").replace(/\D/g,"")||o.user; if(!d) return;
      if(!map[d]) map[d]={name:o.user||"—",phone:o.phone||"—",addr:o.addr||"",tg:0,web:0};
      if(o.source==="telegram") map[d].tg++; else map[d].web++; });
    var custs=Object.values(map).map(function(c){ c.count=c.tg+c.web; c.src=c.tg>c.web?"telegram":"sayt"; return c; }).sort(function(a,b){return b.count-a.count;});
    var bar='<div style="display:flex;height:16px;border-radius:9px;overflow:hidden;margin:10px 0 6px;background:#f1eef0">'+(tgP>0?'<div style="width:'+tgP+'%;background:#2563eb"></div>':'')+(webP>0?'<div style="width:'+webP+'%;background:#16a34a"></div>':'')+'</div>';
    var legend='<div style="display:flex;gap:16px;flex-wrap:wrap;font-size:13px;margin-bottom:6px"><span>🤖 Telegram: <b>'+tgP+'%</b> ('+tg.length+' ta)</span><span>🌐 Sayt: <b>'+webP+'%</b> ('+web.length+' ta)</span></div>';
    var list=custs.length?'<div style="max-height:320px;overflow-y:auto;margin-top:8px">'+custs.map(function(c){
      return '<div class="rsrc-c" data-ph="'+esc(String(c.phone||"").replace(/\D/g,""))+'" style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--line);cursor:pointer"><span style="width:24px;height:24px;border-radius:50%;background:'+(c.src==="telegram"?"#2563eb":"#16a34a")+';color:#fff;display:flex;align-items:center;justify-content:center;font-size:12px;flex-shrink:0">'+(c.src==="telegram"?"🤖":"🌐")+'</span><div style="flex:1;min-width:0"><div style="font-weight:700">'+esc(c.name)+'</div><div style="color:var(--grey);font-size:12px">📞 '+esc(c.phone)+'</div></div><div style="text-align:right;font-size:12px"><b>'+c.count+' ta</b><div style="color:var(--grey)">🤖'+c.tg+' · 🌐'+c.web+'</div></div></div>';
    }).join("")+'</div>':'<p style="color:var(--grey);font-size:13px;margin-top:6px">Hozircha buyurtma yo\'q.</p>';
    box.innerHTML='<div class="panel-head"><h3>🤖 Bot va 🌐 sayt reytingi</h3><span style="color:var(--grey);font-size:13px">'+orders.length+' buyurtma</span></div><div class="panel-body">'+bar+legend+'<div style="font-size:12px;color:var(--grey);margin-top:10px;font-weight:700">Manba bo\'yicha mijozlar (ustiga bosing):</div>'+list+'</div>';
    box.querySelectorAll(".rsrc-c").forEach(function(el){ el.addEventListener("click",function(){ openCustomerModal(el.dataset.ph); }); });
  }
  /* Mijoz kartochkasi — telefon bo'yicha (restoran o'z buyurtmalari doirasida) */
  function openCustomerModal(dig){
    var orders=((typeof STORE!=="undefined"&&STORE.ordersFor)?STORE.ordersFor(CUR.name):[]).filter(function(o){return String(o.phone||"").replace(/\D/g,"")===dig;});
    if(!orders.length) return;
    var name=orders[0].user||"Mijoz", phone=orders[0].phone||"—";
    var spent=orders.filter(function(o){return o.status==="done";}).reduce(function(s,o){return s+(o.amount||0);},0);
    var el=document.getElementById("custModal"); if(el) el.remove();
    el=document.createElement("div"); el.id="custModal";
    el.style.cssText="position:fixed;inset:0;z-index:10001;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;padding:18px";
    var hist=orders.map(function(o){ var s=RSM[o.status]||["?","warn"];
      return '<div style="border:1px solid var(--line);border-radius:10px;padding:10px;margin-bottom:8px"><div style="display:flex;justify-content:space-between;gap:8px"><b>'+(o.emoji||"🍽️")+' '+esc(o.item)+'</b><span class="pill '+s[1]+'">'+s[0]+'</span></div><div style="color:var(--grey);font-size:12px;margin-top:4px">'+fmtDateTime(o)+' · '+money(o.amount)+" so'm · "+(o.source==="telegram"?"🤖 Telegram":"🌐 Sayt")+'</div></div>'; }).join("");
    el.innerHTML='<div style="background:#fff;border-radius:20px;max-width:440px;width:100%;padding:22px;position:relative;max-height:90vh;overflow:auto">'+
      '<button id="custClose" style="position:absolute;top:14px;right:14px;border:none;background:#f1f1f4;width:34px;height:34px;border-radius:50%;font-size:16px;cursor:pointer">✕</button>'+
      '<div style="text-align:center;font-size:42px">👤</div><h3 style="text-align:center;margin:6px 0 12px">'+esc(name)+'</h3>'+
      '<div style="display:flex;flex-direction:column;gap:8px;font-size:14px;margin-bottom:14px">'+
      omr("Telefon",'<a href="tel:'+encodeURIComponent(phone)+'" style="color:var(--red);text-decoration:none">'+esc(phone)+'</a>')+
      omr("Buyurtmalar",orders.length+" ta")+omr("Jami sarflagan",money(spent)+" so'm")+'</div>'+
      '<h4 style="margin:8px 0">Buyurtmalar tarixi</h4>'+hist+'</div>';
    document.body.appendChild(el);
    el.querySelector("#custClose").addEventListener("click",function(){ el.remove(); });
    el.addEventListener("click",function(e){ if(e.target===el) el.remove(); });
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
      (list.length?'<div style="max-height:500px;overflow-y:auto">'+list.map(function(c,i){ return '<div class="topcust-row" data-ph="'+esc(String(c.phone||"").replace(/\D/g,""))+'" style="display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--line);cursor:pointer"><span style="background:var(--red);color:#fff;width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:12px;flex-shrink:0">'+(i+1)+'</span><div style="flex:1;min-width:0"><div style="font-weight:700">'+esc(c.name)+'</div><div style="color:var(--grey);font-size:13px">📞 '+esc(c.phone)+(c.addr?' · 📍 '+esc(c.addr):'')+'</div></div><b style="color:var(--red);white-space:nowrap">'+c.count+' marta</b></div>'; }).join("")+'</div>':'<p style="color:var(--grey)">Hozircha doimiy mijoz yo\'q.</p>')+
      '</div>';
    /* Mijoz ustiga bosilsa — to'liq ma'lumot va buyurtma tarixi */
    box.querySelectorAll(".topcust-row").forEach(function(el){ el.addEventListener("click",function(){ if(el.dataset.ph) openCustomerModal(el.dataset.ph); }); });
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
      /* salesMap qaytargan REAL ko'rsatkichlar: qty — dona, orders — nechta
         buyurtmada uchragan, gross — o'sha taomdan tushgan umumiy summa. */
      row("Sotilgan dona", money(d.qty)+" dona")+
      row("Nechta buyurtmada", money(d.orders)+" ta")+
      row("Narxi", (dish&&dish.price?money(dish.price)+" so'm":"—"))+
      row("Reyting", (dish&&dish.rating?dish.rating:"—"))+
      row("Shu taomdan tushum", money(d.gross)+" so'm")+
      '</div></div>';
    document.body.appendChild(el);
    el.querySelector("#tdmClose").addEventListener("click",function(){ el.remove(); });
    el.addEventListener("click",function(e){ if(e.target===el) el.remove(); });
  }

  function isSoldout(name){
    try{ return ((typeof STORE!=="undefined"&&STORE.overrides)?(STORE.overrides().soldout||[]):[]).indexOf(CUR.name+"|"+name)>=0; }catch(e){ return false; }
  }
  function renderDishes(){
    const kindIco={taom:"🍽️",ichimlik:"🥤",shirinlik:"🍰"};
    $("#dishTbody").innerHTML=CUR.dishes.map((d,i)=>{ const so=isSoldout(d.name);
      const rt=(d.rating||0); const rtHtml=rt>0?`<span class="star" style="color:#f5a623">★ ${rt}</span> <span style="color:var(--grey);font-size:11px">(${d.ratingCount||0})</span>`:'<span style="color:var(--grey);font-size:12px">—</span>';
      const lim=(d.maxQty>0)?` <span class="pill blue" style="font-size:10px" title="Bir buyurtmada eng ko'pi ${d.maxQty} ta">max ${d.maxQty}</span>`:'';
      return `
      <tr${so?' style="opacity:.6"':''}>
        <td><div class="tname">${d.photo?`<img src="${d.photo}" class="av" alt="" style="object-fit:cover">`:`<span class="av">${kindIco[d.kind]||d.emoji}</span>`}${esc(d.name)}${so?' <span class="pill warn" style="font-size:10px">Tugagan</span>':''}${lim}</div></td>
        <td>${d.discount?`<span style="text-decoration:line-through;color:var(--grey)">${money(d.price)}</span> <b style="color:var(--red)">${money(d.eff)}</b> <span class="pill red">-${d.discount}%</span>`:money(d.price)}</td>
        <td>${rtHtml}</td>
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

  /* Tanlangan taom turi: 'taom' | 'ichimlik' | 'shirinlik' */
  var ndKind="taom";
  const KIND_CAT={taom:"Fastfood",ichimlik:"Ichimlik",shirinlik:"Shirinlik"};
  const KIND_EMOJI={taom:"🍽️",ichimlik:"🥤",shirinlik:"🍰"};
  const KIND_NAMELBL={taom:"Taom nomi",ichimlik:"Ichimlik nomi",shirinlik:"Shirinlik nomi"};
  const KIND_NAMEPH={taom:"Masalan: Tovuqli burger",ichimlik:"Masalan: Coca-Cola",shirinlik:"Masalan: Tiramisu"};
  function setDishKind(kind){
    ndKind=KIND_CAT[kind]?kind:"taom";
    $$(".nd-kind").forEach(function(b){ b.classList.toggle("active",b.dataset.kind===ndKind); });
    /* Faqat shu turga tegishli maydonlar ko'rinadi */
    $$(".nd-f").forEach(function(el){ el.hidden = !el.classList.contains("nd-"+ndKind); });
    var lbl=$("#ndNameLbl"); if(lbl) lbl.textContent=KIND_NAMELBL[ndKind];
    var nm=$("#ndName"); if(nm) nm.placeholder=KIND_NAMEPH[ndKind];
    var em=$("#ndEmoji"); if(em && (!em.value || Object.values(KIND_EMOJI).indexOf(em.value)>=0)) em.value=KIND_EMOJI[ndKind];
  }
  async function addDish(){
    const name=$("#ndName").value.trim(), price=parseInt(($("#ndPrice").value||"").replace(/\D/g,""),10), emoji=($("#ndEmoji").value.trim()||KIND_EMOJI[ndKind]);
    const maxQty=Math.max(0, parseInt(($("#ndMaxQty").value||"").replace(/\D/g,""),10)||0);
    const kindLabel={taom:"Taom",ichimlik:"Ichimlik",shirinlik:"Shirinlik"}[ndKind];
    if(name.length<2){ toast(kindLabel+" nomini kiriting"); return; }
    if(!price || price<1000){ toast("To'g'ri narx kiriting"); return; }
    /* Turga qarab qo'shimcha maydonlar */
    var weight="", ingredients="", descr="", volume="", dtype="", allergens="";
    if(ndKind==="taom"){
      weight=(($("#ndWeight")||{}).value||"").trim();
      ingredients=(($("#ndIngredients")||{}).value||"").trim();
      descr=(($("#ndDescr")||{}).value||"").trim();
    } else if(ndKind==="ichimlik"){
      volume=(($("#ndVolume")||{}).value||"").trim();
      dtype=(($("#ndDtype")||{}).value||"").trim();
      descr=(($("#ndDescrDrink")||{}).value||"").trim();
      weight=volume;   // ro'yxatда vazn ustunida hajm ko'rinsin
    } else if(ndKind==="shirinlik"){
      weight=(($("#ndWeightSweet")||{}).value||"").trim();
      allergens=(($("#ndAllergens")||{}).value||"").trim();
      descr=(($("#ndDescrSweet")||{}).value||"").trim();
    }
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
    try{ if(typeof STORE!=="undefined") STORE.addDish({id:Date.now(),name:name,emoji:emoji,price:price,rest:CUR.name,cat:KIND_CAT[ndKind],kw:"",photo:photo,sold:0,
      kind:ndKind, maxQty:maxQty, weight:weight,ingredients:ingredients,descr:descr, volume:volume, dtype:dtype, allergens:allergens}); }catch(e){}
    loadDishes(); renderAll();
    $("#ndName").value=""; $("#ndPrice").value=""; $("#ndMaxQty").value=""; $("#ndEmoji").value=KIND_EMOJI[ndKind];
    ["#ndWeight","#ndIngredients","#ndDescr","#ndVolume","#ndDescrDrink","#ndWeightSweet","#ndAllergens","#ndDescrSweet"].forEach(function(s){ var el=$(s); if(el) el.value=""; });
    var dt=$("#ndDtype"); if(dt) dt.value="";
    if(fileInput) fileInput.value="";
    toast(photo?(kindLabel+" rasm bilan qo'shildi ✓"):(kindLabel+" qo'shildi ✓"));
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

    /* Faol aksiyalar paneli — BACKENDDAGI barcha e'lonlar (shu restoranniki).
       Ilgari faqat CUR.announcements (localStorage, shu brauzer) ko'rinardi:
       boshqa qurilma/sessiyada joylangan eski e'lonni o'chirib bo'lmasdi.
       Endi hamma joylangan e'lon ko'rinadi va id bo'yicha ishonchli o'chadi. */
    const activeList=$("#activePromoList"), promoCount=$("#promoCount");
    let backendAnns=[];
    try{ backendAnns=((typeof STORE!=="undefined"&&STORE.announcements)?STORE.announcements():[]).filter(a=>a.rest===CUR.name); }catch(e){}
    /* Backend bo'sh bo'lса (offline) — localStorage zaxirasi */
    const allAnns=backendAnns.length?backendAnns:(CUR.announcements||[]);
    if(activeList){
      if(allAnns.length){
        activeList.innerHTML=allAnns.map((a,ai)=>`
          <div class="promo-ann-item">
            ${a.img?`<img src="${a.img}" alt="" style="width:46px;height:46px;border-radius:10px;object-fit:cover;flex:none;margin-right:10px">`:""}
            <div class="pai-left">
              <span class="pai-tag">${a.tag||"AKSIYA"}</span>
              <div class="pai-text">${esc(a.text)}</div>
              <div class="pai-date">${esc(a.date||"")}</div>
            </div>
            <button class="pai-del" data-aid="${a.id!=null?esc(String(a.id)):""}" data-atext="${esc(a.text)}">Olib tashlash</button>
          </div>`).join("");
        activeList.querySelectorAll(".pai-del").forEach(b=>b.addEventListener("click",async()=>{
          const id=b.dataset.aid, delText=b.dataset.atext;
          /* localStorage zaxirasidan ham olib tashlaymiz */
          try{
            const k="yetkaz_announcements";
            const arr=JSON.parse(localStorage.getItem(k)||"[]");
            localStorage.setItem(k,JSON.stringify(arr.filter(a=>!(a.rest===CUR.name && a.text===delText))));
          }catch(e){}
          if(CUR.announcements) CUR.announcements=CUR.announcements.filter(a=>a.text!==delText);
          /* Backenddan o'chirish — id bo'lса ishonchli, bo'lmasa matn bo'yicha */
          try{
            if(id && typeof STORE!=="undefined" && STORE.deleteAnnouncementById) await STORE.deleteAnnouncementById(id);
            else if(typeof STORE!=="undefined" && STORE.deleteAnnouncement) STORE.deleteAnnouncement({rest:CUR.name, text:delText});
          }catch(e){}
          renderPromo(); toast("E'lon o'chirildi ✓");
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
    const pct=restPct(r);
    /* REAL: pul faqat mijoz tasdiqlagan (done) buyurtmalardan yoziladi */
    const live=(typeof STORE!=="undefined"&&STORE.ordersFor)?STORE.ordersFor(r.name):[];
    /* Davr/ustun mantiqi — YZ_TIME.incomeChart (admin/kuryer bilan AYNAN bir xil).
       "Shu davr" = grafikning oxirgi (joriy) ustuni; ular 1 so'mgacha teng. */
    const IC=YZ_TIME.incomeChart(incomePeriod);
    const allDone=live.filter(o=>o.status==="done");
    const doneOrders=allDone.filter(o=>IC.isCurrent(o.created_at));
    const gross=doneOrders.reduce((s,o)=>s+(o.amount||0),0);
    /* Sof daromad HAR BUYURTMANING O'Z foizidan yig'iladi (netOf) — umumiy
       summaga bitta foiz qo'llash noto'g'ri bo'lardi: admin foizni o'zgartirgan
       bo'lsa, eski va yangi buyurtmalar turli shartda. */
    const net=doneOrders.reduce((s,o)=>s+netOf(o,pct),0);
    const commission=gross-net;
    /* To'lov turi bo'yicha bo'linish — necha kishi karta, nechasi naqd to'ladi.
       MUHIM: bu yerда ham FAQAT restoran daromadi (net) ko'rsatiladi. */
    const cardOrders=doneOrders.filter(o=>o.pay!=="cash");
    const cashOrders=doneOrders.filter(o=>o.pay==="cash");
    const cardNet=cardOrders.reduce((s,o)=>s+netOf(o,pct),0);
    const cashNet=cashOrders.reduce((s,o)=>s+netOf(o,pct),0);
    const pLabel=IC.periodLabel;
    /* REAL grafik — TANLANGAN davrga qarab (kunlik→7 kun ... yillik→5 yil).
       Ustun = o'sha davrdagi SOF daromad (netOf, har buyurtmaning o'z foizidan).
       Oxirgi ustun = yuqoridagi «Sizning daromadingiz» (net) — 1 so'm farq yo'q. */
    const barSums=IC.series(allDone,o=>netOf(o,pct));
    const barMax=Math.max.apply(null,barSums.concat([1]));
    const revBars=IC.buckets.map(function(x,i){ const v=barSums[i]; const cur=i===IC.curIndex;
      return '<div class="bar-col"><div class="bv" style="color:'+(cur?'#15803d':'')+'">'+(v?mln(v).replace(" mln",""):"0")+'</div>'+
        '<div class="bar" style="height:'+Math.max(4,Math.round(v/barMax*150))+'px'+(cur?';background:linear-gradient(180deg,#15803d,#22c55e)':'')+'"></div><small>'+x.label+'</small></div>'; }).join("");
    const revChartEl=$("#revChart"); if(revChartEl) revChartEl.innerHTML=revBars;
    const rct=$("#revChartTitle"); if(rct) rct.textContent="Daromad grafigi (mln so'm)";
    const rcs=$("#revChartSpan"); if(rcs) rcs.textContent=IC.spanLabel;
    const rcn=$("#revChartNote"); if(rcn) rcn.innerHTML="Oxirgi (yashil) ustun — «"+pLabel+"» sof daromadingiz: <b>"+money(net)+" so'm</b>. Har ustun sof daromad (komissiya chegirilgan).";
    const seg=(k,t)=>`<button class="inc-seg" data-period="${k}" style="border:none;border-radius:8px;padding:5px 12px;font-size:12px;font-weight:700;cursor:pointer;margin:0 4px 4px 0;background:${incomePeriod===k?'var(--red,#C8102E)':'#f1eef0'};color:${incomePeriod===k?'#fff':'#777'}">${t}</button>`;
    /* ===== Har bir taom bo'yicha REAL sotuv =====
       Ilgari buyurtma YORLIG'I ("Osh +2 ta") taom nomi bilan solishtirilardi:
       ko'p taomli buyurtmada faqat BIRINCHI taom sanalar va BUTUN buyurtma
       summasi o'shanga yozilardi. Endi buyurtma tarkibidagi har bir qator
       o'z dona soni va o'z summasi bilan hisoblanadi (salesMap). */
    /* Taomlar jadvali — «Taomlar» tabidagi bilan AYNAN bir xil usul (dishTable):
       taomlar bo'yicha "sizga qoladi" yig'indisi restoran sof daromadiga
       (ko'rsatilgan taomlar qismiga) TENG — 1 so'm ham farq yo'q. */
    const dt=dishTable(doneOrders, r.dishes, r);
    const dishStats=function(dish){
      var t=dt[dish.name];
      if(!t || !t.qty) return { sold:0, qty:0, gross:0, net:0 };
      return { sold:t.orders, qty:t.qty, gross:t.gross, net:t.net };
    };
    /* Eng ko'p sotilgan taomlar (nima ko'p sotilyapti) — DONA bo'yicha */
    const rows=r.dishes.map(d=>({d, st:dishStats(d)}));
    const best=rows.slice().sort((a,b)=>b.st.qty-a.st.qty).filter(x=>x.st.qty>0).slice(0,5);
    const maxSold=(best[0]&&best[0].st.qty)||1;
    const bestSellers = best.length ? best.map(x=>`
      <div style="margin-bottom:12px"><div style="display:flex;justify-content:space-between;font-size:14px;margin-bottom:4px"><b>${x.d.emoji||"🍽️"} ${esc(x.d.name)}</b><span>${money(x.st.qty)} dona</span></div>
      <div style="height:9px;background:#F3EEF0;border-radius:6px;overflow:hidden"><div style="height:100%;width:${Math.round(x.st.qty/maxSold*100)}%;background:linear-gradient(90deg,var(--gold),var(--red))"></div></div></div>`).join("") : '<p style="color:var(--grey);font-size:13px">Hozircha sotuv yo\'q</p>';
    $("#incomeBody").innerHTML=`
      <div class="panel"><div class="panel-body" style="padding:12px 14px">
        <div style="font-size:12px;font-weight:700;color:var(--grey);margin-bottom:7px">DAVR</div>
        <div style="display:flex;flex-wrap:wrap">${seg("kunlik","Kunlik")}${seg("haftalik","Haftalik")}${seg("oylik","Oylik")}${seg("yillik","Yillik")}</div>
      </div></div>
      <div class="row2">
        <div class="panel"><div class="panel-head"><h3>Daromad xulosasi (${pLabel})</h3></div><div class="panel-body">
          <div class="fin-row"><span>Buyurtmalar (yetkazilgan)</span><b>${money(doneOrders.length)} ta</b></div>
          <div class="fin-row"><span>Mijozlar to'lagan (aylanma)</span><b>${money(gross)} so'm</b></div>
          <div class="fin-row"><span>Sayt komissiyasi (${gross?Math.round(commission/gross*100):pct}%)</span><b style="color:var(--red)">− ${money(commission)} so'm</b></div>
          <div class="fin-row tot"><span>Sizning daromadingiz</span><b style="color:var(--green)">${money(net)} so'm</b></div>
        </div></div>
        <div class="panel"><div class="panel-head"><h3>💳 To'lov turi bo'yicha</h3></div><div class="panel-body">
          <div class="fin-row"><span>💳 Karta orqali</span><b>${money(cardOrders.length)} ta · ${money(cardNet)} so'm</b></div>
          <div class="fin-row"><span>💵 Naqd</span><b>${money(cashOrders.length)} ta · ${money(cashNet)} so'm</b></div>
          <div style="height:14px;background:#f1eef0;border-radius:8px;overflow:hidden;margin-top:8px;display:flex">
            ${doneOrders.length?`<div style="width:${Math.round(cardOrders.length/doneOrders.length*100)}%;background:#2563eb"></div><div style="width:${Math.round(cashOrders.length/doneOrders.length*100)}%;background:#16a34a"></div>`:''}
          </div>
          <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--grey);margin-top:5px"><span>💳 ${doneOrders.length?Math.round(cardOrders.length/doneOrders.length*100):0}%</span><span>💵 ${doneOrders.length?Math.round(cashOrders.length/doneOrders.length*100):0}%</span></div>
        </div></div>
      </div>
      <div class="panel"><div class="panel-head"><h3>🔥 Eng ko'p sotilgan taomlar</h3></div><div class="panel-body">
        ${bestSellers}
      </div></div>
      <div class="panel"><div class="panel-head"><h3>Har bir taomdan qancha daromad (${pLabel})</h3></div>
        <div class="panel-body" style="padding:0;overflow-x:auto">
          <table class="tbl"><thead><tr><th>Taom</th><th>1 dona narx</th><th>Sotildi (dona)</th><th>Tushum</th><th>Sizga qoladi</th></tr></thead>
          <tbody>${r.dishes.map(d=>{const st=dishStats(d);return `<tr><td><div class="tname">${d.photo?`<img src="${d.photo}" class="av" alt="" style="object-fit:cover">`:`<span class="av">${d.emoji}</span>`}${esc(d.name)}</div></td>
            <td>${money(d.price)}</td>
            <td>${money(st.qty)}</td><td>${money(st.gross)}</td><td class="money">${money(st.net)}</td></tr>`;}).join("")}
            ${(dt.__totals.gross-dt.__totals.shownGross)>0?`<tr style="color:var(--grey)"><td><i>Menyudan olib tashlangan taomlar</i></td><td>—</td><td>—</td><td>${money(dt.__totals.gross-dt.__totals.shownGross)}</td><td class="money">${money(dt.__totals.net-dt.__totals.shownNet)}</td></tr>`:''}
          </tbody>
          <tfoot><tr style="font-weight:800;border-top:2px solid var(--line)"><td>Jami</td><td></td><td></td><td>${money(dt.__totals.gross)}</td><td class="money" style="color:var(--green)">${money(dt.__totals.net)}</td></tr></tfoot>
          </table>
        </div></div>
      <p style="color:var(--grey);font-size:13px;padding:4px">Jadval «Sizga qoladi» ustunining yig'indisi yuqoridagi «Sizning daromadingiz» bilan bir xil (${money(net)} so'm).</p>`;
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
  /* Buyurtma QAYERDAN kelgan — Telegram mini ilovasidanmi yoki saytdanmi
     (server `source` maydonini yozadi: server/src/orders-core.js) */
  function srcBadge(x){
    var tg=(x&&x.source)==="telegram";
    return '<span class="pill '+(tg?"blue":"ok")+'" title="'+(tg?"Telegram bot orqali":"Sayt orqali")+'">'
      +(tg?"🤖 Telegram":"🌐 Sayt")+'</span>';
  }
  function rActions(x){
    var b=function(act,label,bg){ return "<button class=\"r-act\" data-act=\""+act+"\" data-id=\""+x.id+"\" style=\"border:none;border-radius:8px;padding:7px 12px;font-size:13px;font-weight:700;cursor:pointer;margin:2px;background:"+bg+";color:#fff\">"+label+"</button>"; };
    /* Faqat rad etish — va faqat 3 daqiqalik oyna ichida */
    if(canReject(x)) return "<span style=\"color:var(--grey);font-size:12px;margin-right:6px\">Rad etishga: "+rejectLeftText(x)+"</span>"+b("cancelled","✕ Rad etish","#C8102E");
    return "";
  }
  /* Buyurtmalar jadvalini KO'RSATILGAN tbody ga render qiladi (bir nechta joy uchun:
     buyurtmalar bo'limi + dashboard). Logika bitta — takrorlanmaydi. */
  /* Buyurtmadagi jami dona soni (YZ_ITEMS — barcha panellar uchun yagona manba) */
  function orderQty(x){ try{ return YZ_ITEMS.qty(x); }catch(e){ return 0; } }
  /* Ko'p taomli buyurtma uchun jadval qatoridagi rasm lentasi (yon tomonga suriladi) */
  function itemsStrip(x){ try{ return YZ_ITEMS.strip(x); }catch(e){ return ""; } }
  /* MIJOZ IZOHI ("sous bilan", "achchiq solmang") — oshxona AYNAN shuni
     bajarishi kerak, shuning uchun jadval qatorida ham to'liq ko'rsatiladi. */
  function itemsNotes(x){ try{ return YZ_ITEMS.notesHtml(x,{title:"Mijoz izohi — shunday tayyorlang"}); }catch(e){ return ""; } }

  function renderOrdersInto(tbId){
    const o=(typeof STORE!=="undefined")?STORE.ordersFor(CUR.name):[];
    const tb=$("#"+tbId); if(!tb) return;
    tb.innerHTML=o.length?o.map(function(x){ const s=RSM[x.status]||["?","warn"];
      var ph=orderPhoto(x);
      var av=ph?"<img src=\""+ph+"\" class=\"av\" alt=\"\" style=\"object-fit:cover\">":"<span class=\"av\">"+(x.emoji||"🍽️")+"</span>";
      /* Ko'p mahsulotli buyurtma: nom ostida BARCHA taomlar rasmi (gorizontal scroll)
         va "N xil · M dona" belgisi — restoran nima tayyorlashini darrov ko'radi. */
      var n=(x.items&&x.items.length)||0;
      var extra = n>1
        ? "<div class=\"o-more\">"+n+" xil · "+orderQty(x)+" dona</div>"+itemsStrip(x)
        : "";
      return "<tr style=\"cursor:pointer\" data-oid=\""+x.id+"\"><td><div class=\"tname\">"+av+esc(x.item)+"</div>"+extra+itemsNotes(x)+"</td><td>"+esc(x.user)+"</td><td>📍 "+esc(x.addr)+"</td><td class=\"money\">"+money(x.amount)+"</td><td>"+srcBadge(x)+"</td><td><div style=\"display:flex;align-items:center;gap:8px;flex-wrap:wrap\"><span class=\"pill "+s[1]+"\">"+s[0]+"</span>"+rActions(x)+"</div></td></tr>"; }).join("")
      :"<tr><td colspan=6 style=\"color:var(--grey);padding:20px\">Hozircha buyurtma yoq.</td></tr>";
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
      /* Server rad etsa (masalan buyurtma allaqachon yo'lda) — sababini ko'rsatamiz */
      if(typeof STORE!=="undefined" && STORE.updateOrder) STORE.updateOrder(id,{status:"cancelled", reason:reason},{
        onFail:function(err){ toast((err&&err.message)||"Bekor qilib bo'lmadi"); renderOrdersView(); renderDash(); }
      });
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
    /* Buyurtma tarkibi — HAR BIR taom rasmi, dona soni va summasi bilan.
       Ro'yxat uzun bo'lsa (20–30 mahsulot) ichida scroll bo'ladi, modal
       cho'zilib ketmaydi (YZ_ITEMS — order-items.js). */
    var itemsHtml=""; try{ itemsHtml=YZ_ITEMS.listHtml(o,{maxHeight:280}); }catch(e){}
    el.innerHTML="<div style=\"background:#fff;border-radius:20px;max-width:460px;width:100%;padding:22px;position:relative;max-height:90vh;overflow:auto\">"+
      "<button id=\"ordModalClose\" style=\"position:absolute;top:14px;right:14px;border:none;background:#f1f1f4;width:34px;height:34px;border-radius:50%;font-size:16px;cursor:pointer;z-index:2\">✕</button>"+
      head+
      "<h3 style=\"text-align:center;margin:6px 0 2px\">"+esc(o.item)+"</h3>"+
      "<div style=\"text-align:center;margin-bottom:14px\"><span class=\"pill "+s[1]+"\">"+s[0]+"</span></div>"+
      itemsNotes(o)+
      itemsHtml+
      "<div style=\"display:flex;flex-direction:column;gap:10px;font-size:14px\">"+
        omr("Mijoz",esc(o.user)||"-")+omr("Telefon",o.phone?("<a href=\"tel:"+encodeURIComponent(o.phone)+"\" style=\"color:var(--red);text-decoration:none\">"+esc(o.phone)+"</a>"):"-")+
        omr("Manzil",esc(o.addr)||"-")+
        (orderQty(o)?omr("Jami mahsulot",orderQty(o)+" dona"):"")+
        omr("Summa",money(o.amount)+" so'm")+omr("To'lov",(typeof STORE!=="undefined"&&STORE.payLabel)?STORE.payLabel(o.pay):(o.pay==="cash"?"💵 Naqd":"💳 Karta"))+
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
    try{ if(typeof YZ_SUPPORT!=="undefined"){ var sb=document.getElementById("restLoginSupport"); if(sb) YZ_SUPPORT.mount(sb,{compact:true,intro:""}); } }catch(e){}
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
  /* Login/parolni o'zgartirish restoran panelidan OLIB TASHLANDI — buni FAQAT
     admin bajaradi (admin panel «Loginlar» bo'limi). #setLogin/#setName endi
     faqat ko'rsatish uchun (readonly). */

  /* Admin qo'shgan (lokal demo massivда yo'q) restoran uchun backenddan minimal panel */
  function buildBackendRest(ses){
    let be=null;
    try{ be=(typeof STORE!=="undefined"&&STORE.restaurants)?STORE.restaurants().find(x=>x.login===ses.login||x.name===ses.name):null; }catch(e){}
    const nameV=(be&&be.name)||ses.name||ses.login;
    let dishes=[];
    try{ dishes=((typeof STORE!=="undefined"&&STORE.overrides)?(STORE.overrides().added||[]):[]).filter(d=>d.rest===nameV)
          .map(d=>({name:d.name,emoji:d.emoji||"🍽️",price:d.price||0,sold:d.sold||0,discount:0,photo:d.photo||""})); }catch(e){}
    /* Komissiya SESSIYADAN (ses.commission) — ommaviy bootstrap'да yo'q */
    const comm=(ses&&ses.commission!=null)?ses.commission:((be&&be.commission!=null)?be.commission:18);
    const r={ id:(be&&be.id)||Date.now(), name:nameV, emoji:(be&&be.emoji)||"🏪", login:ses.login,
      rating:(be&&be.rating)||0, commission:comm, commissionPct:comm, dishes:dishes, announcements:[] };
    recompute(r);
    return r;
  }

  /* Sessiyadan panelni ochish (rol allaqachon tasdiqlangan bo'lishi kerak) */
  async function enterFromSession(ses){
    var rr=RESTS.find(x=>x.login===ses.login);
    if(!rr){ try{ if(STORE.ready) await STORE.ready(); }catch(e){} rr=buildBackendRest(ses); }
    /* Komissiyani sessiyadan CUR ga muhrlaymiz (ommaviy bootstrap'да yo'q) */
    if(rr && ses && ses.commission!=null) rr.commission=ses.commission;
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
    /* Taom turi tanlash (Taom / Ichimlik / Shirinlik) */
    $$(".nd-kind").forEach(function(b){ b.addEventListener("click",function(){ setDishKind(b.dataset.kind); }); });
    setDishKind("taom");
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
