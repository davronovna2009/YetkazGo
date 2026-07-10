/* ===== Yetkaz.uz — Asosiy mantiq ===== */
(function(){
  const $ = (s,r=document)=>r.querySelector(s);
  const $$ = (s,r=document)=>[...r.querySelectorAll(s)];
  const fmt = n => n.toLocaleString("ru-RU");
  const esc = s => String(s==null?"":s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c])); // XSS himoyasi
  const MIN_ORDER = 20000, DELIVERY_FEE = 0;  // yetkazish bepul
  let cart = [];            // {id,name,nameCyr,price,emoji,img,qty}
  let user = { name:"", phone:"", address:"", debt:0 };
  let activeCat = "Hammasi";
  const nm = o => I18N.current()==="cyr" ? (o.nameCyr||o.name) : o.name;
  /* Restoranlar manbai: backend (yangi nom/rasm/restoran) bo'lsa o'sha, bo'lmasa data.js */
  function restList(){
    try{ const be=(typeof STORE!=="undefined"&&STORE.restaurants)?STORE.restaurants().filter(x=>x&&x.active!==false):[];
      if(be&&be.length) return be; }catch(e){}
    return (typeof RESTAURANTS!=="undefined")?RESTAURANTS:[];
  }
  /* Restoran nomi o'zgargan bo'lsa: data.js dagi eski nom -> backenddagi yangi nom */
  function renameMap(){
    const m={};
    try{ if(typeof STORE!=="undefined"&&STORE.restaurants&&typeof RESTAURANTS!=="undefined"){
      STORE.restaurants().forEach(b=>{ const d=RESTAURANTS.find(x=>x.id===b.id); if(d&&d.name&&b.name&&d.name!==b.name) m[d.name]=b.name; }); } }catch(e){}
    return m;
  }
  function catalog(){
    if(typeof STORE==="undefined") return (typeof DISHES!=="undefined"?DISHES:[]);
    const m=renameMap();
    const base=(typeof DISHES!=="undefined"?DISHES:[]).map(d=> m[d.rest]?Object.assign({},d,{rest:m[d.rest]}):d);
    return STORE.mergeDishes(base);
  }

  /* ---------- HERO SLIDER ---------- */
  let slideIx = 0, slideTimer = null;
  function buildHero(){
    const wrap = $("#heroSlides"), dots = $("#heroDots");
    wrap.innerHTML=""; dots.innerHTML="";
    HERO_IMAGES.forEach((im,i)=>{
      const s = document.createElement("div");
      s.className = "hero-slide"+(i===0?" active":"");
      s.style.backgroundImage = `url("${im.url}")`;
      wrap.appendChild(s);
      const d = document.createElement("span");
      if(i===0) d.className="on";
      d.addEventListener("click",()=>goSlide(i));
      dots.appendChild(d);
    });
    startSlides();
  }
  function goSlide(i){
    const slides = $$(".hero-slide"), dots = $$("#heroDots span");
    slides[slideIx].classList.remove("active"); dots[slideIx].classList.remove("on");
    slideIx = (i+slides.length)%slides.length;
    slides[slideIx].classList.add("active"); dots[slideIx].classList.add("on");
  }
  function startSlides(){ clearInterval(slideTimer); slideTimer = setInterval(()=>goSlide(slideIx+1), 4500); }

  /* ---------- RENDER DISHES ---------- */
  function buildFilters(){
    const box = $("#dishFilters"); box.innerHTML="";
    DISH_CATS.forEach(c=>{
      const b=document.createElement("button");
      b.className="chip"+(c===activeCat?" on":"");
      b.textContent = I18N.current()==="cyr" ? (DISH_CATS_CYR[c]||c) : c;
      b.addEventListener("click",()=>{activeCat=c; buildFilters(); renderDishes();});
      box.appendChild(b);
    });
  }
  /* Karta narx (body) va yoysimon "pod" (savat tugmasi) — ikkala qismni yangilaydi.
     Narx kartaning tanasida, "+" / miqdor tugmasi esa pastdagi yoysimon blokda. */
  function updateCardQty(card, d){
    const qty = (cart.find(i=>i.id===d.id)||{}).qty||0;
    const foot = card.querySelector(".card-foot");
    const pod  = card.querySelector(".card-pod-action");
    if(foot){
      const priceHtml = d.discount
        ? `<span style="text-decoration:line-through;color:#b9a;font-size:13px">${fmt(d.price)}</span> ${fmt(d.eff)}`
        : fmt(d.price);
      const weightHtml = d.weight ? `<span class="card-weight">${esc(d.weight)}</span>` : "";
      foot.innerHTML = `${weightHtml}<span class="price">${priceHtml} <small>${I18N.t("sum")}</small></span>`;
    }
    if(!pod) return;
    if(d.soldout){
      pod.innerHTML = `<span class="pod-soldout">Tugagan</span>`;
      return;
    }
    /* Restoran hozir yopiqmi — yopiq bo'lsa savatga qo'shib/uchirib bo'lmaydi */
    const closed = !!(d.rest && !isRestOpen(d.rest));
    if(qty===0){
      if(closed){
        /* "+" o'rniga o'chiq (yopiq) tugma — bosilsa faqat xabar, uchmaydi/qo'shilmaydi */
        pod.innerHTML = `<button class="add-btn add-closed" aria-label="Restoran hozir yopiq" title="Restoran hozir yopiq">⏱</button>`;
        pod.querySelector(".add-btn").addEventListener("click",(e)=>{e.stopPropagation();toast(d.rest+" hozir yopiq","error");});
        return;
      }
      pod.innerHTML = `<button class="add-btn" aria-label="Savatga qo'shish">+</button>`;
      pod.querySelector(".add-btn").addEventListener("click",(e)=>{e.stopPropagation();flyToCart(d,e.currentTarget);addToCart(d);updateAllCards();});
    } else {
      pod.innerHTML = `
        <div class="card-qty">
          <button class="qty-btn qty-minus" aria-label="Kamaytirish">−</button>
          <span class="qty-num">${qty}</span>
          <button class="qty-btn qty-plus${closed?' qty-closed':''}" aria-label="Ko'paytirish">+</button>
        </div>`;
      pod.querySelector(".qty-minus").addEventListener("click",(e)=>{e.stopPropagation();changeQty(d.id,-1);updateAllCards();});
      pod.querySelector(".qty-plus").addEventListener("click",(e)=>{
        e.stopPropagation();
        /* Yopiq bo'lsa: uchmaydi, qo'shilmaydi — faqat xabar */
        if(closed){ toast(d.rest+" hozir yopiq","error"); return; }
        flyToCart(d,e.currentTarget); addToCart(d); updateAllCards();
      });
    }
  }

  /* "Savatga uchish" animatsiyasi — taom rasmini klonlab, savat ikonkasiga
     kichrayib uchirib yuboradi (400–600ms, cubic-bezier). */
  function flyToCart(d, btn){
    try{
      const card  = btn && btn.closest(".card");
      const imgEl = card && card.querySelector(".card-img");
      if(!imgEl) return;
      const mobile = window.innerWidth<=768;
      const target = (mobile ? document.getElementById("mbbCart") : document.getElementById("cartBtn"))
                   || document.getElementById("cartBtn") || document.getElementById("mbbCart");
      if(!target) return;
      const s = imgEl.getBoundingClientRect(), t = target.getBoundingClientRect();
      if(!s.width || !t.width) return;
      const clone = document.createElement("div");
      clone.className = "fly-clone";
      const photo = card.querySelector(".card-photo");
      if(photo && photo.getAttribute("src")){ clone.style.backgroundImage = `url("${photo.getAttribute("src")}")`; }
      else { clone.textContent = d.emoji || "🍽️"; }
      clone.style.left = s.left+"px"; clone.style.top = s.top+"px";
      clone.style.width = s.width+"px"; clone.style.height = s.height+"px";
      document.body.appendChild(clone);
      const dx = (t.left+t.width/2)-(s.left+s.width/2);
      const dy = (t.top+t.height/2)-(s.top+s.height/2);
      requestAnimationFrame(()=>{
        clone.style.transform = `translate(${dx}px,${dy}px) scale(.12)`;
        clone.style.opacity = "0.25";
      });
      setTimeout(()=>{ try{ clone.remove(); }catch(e){} }, 620);
    }catch(e){}
  }

  function updateAllCards(){
    // Barcha kartalarni yangilash (cart o'zgarganda)
    document.querySelectorAll(".card[data-dish-id]").forEach(card=>{
      const id = +card.dataset.dishId;
      const d = catalog().find(x=>x.id===id);
      if(d) updateCardQty(card,d);
    });
  }

  function openDishModal(d){
    const qty = (cart.find(i=>i.id===d.id)||{}).qty||0;
    const price = d.discount ? fmt(d.eff) : fmt(d.price);
    const oldPrice = d.discount ? `<span style="text-decoration:line-through;color:#aaa;font-size:14px;margin-right:6px">${fmt(d.price)}</span>` : "";
    openModal(`
      <div class="dish-modal">
        <div class="dish-modal-img tone-${d.kw}">
          <span class="food-emoji" style="font-size:72px;filter:drop-shadow(0 6px 12px rgba(0,0,0,.2))">${d.emoji}</span>
          <img src="${d.photo}" alt="${esc(nm(d))}" onerror="this.remove()" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:2;">
          ${d.badge?`<span class="card-badge" style="z-index:3;top:12px;left:12px">${d.badge}</span>`:""}
        </div>
        <div class="dish-modal-body">
          <h2 style="font-size:20px;margin-bottom:4px">${esc(nm(d))}</h2>
          <div style="color:var(--grey);font-size:13px;margin-bottom:10px">🏪 ${d.rest}</div>
          <div style="display:flex;gap:12px;margin-bottom:14px;flex-wrap:wrap">
            <span style="display:flex;align-items:center;gap:4px;font-size:13px;color:var(--grey)">⭐ <b style="color:var(--ink)">${d.rating}</b></span>
            <span style="font-size:13px;color:var(--grey)">🛒 ${d.sold}+ buyurtma</span>
            ${d.weight?`<span style="font-size:13px;color:var(--grey)">⚖️ ${esc(d.weight)}</span>`:""}
          </div>
          ${d.descr?`<p style="font-size:14px;color:var(--ink);margin-bottom:10px;line-height:1.5">${esc(d.descr)}</p>`:""}
          ${d.ingredients?`<div style="font-size:13px;color:var(--grey);margin-bottom:14px;line-height:1.5"><b>🥗 Tarkibi:</b> ${esc(d.ingredients)}</div>`:""}
          <div style="display:flex;align-items:center;gap:4px;margin-bottom:18px">
            ${oldPrice}
            <span style="font-size:22px;font-weight:800;color:var(--red)">${price}</span>
            <span style="font-size:13px;color:var(--grey)"> so'm</span>
          </div>
          <div class="dish-modal-foot">
            ${qty===0
              ? `<button class="btn btn-primary btn-block" id="dmAddBtn">Savatga qo'shish</button>`
              : `<div class="dm-qty">
                  <button class="qty-btn qty-minus" id="dmMinus">−</button>
                  <span class="qty-num" id="dmNum">${qty}</span>
                  <button class="qty-btn qty-plus" id="dmPlus">+</button>
                </div>
                <button class="btn btn-primary btn-block" style="margin-top:10px" id="dmGoCart">Savatni ko'rish</button>`
            }
          </div>
        </div>
      </div>`);

    const refreshModal = ()=>{
      const q = (cart.find(i=>i.id===d.id)||{}).qty||0;
      const foot = document.querySelector(".dish-modal-foot");
      if(!foot) return;
      if(q===0){
        foot.innerHTML=`<button class="btn btn-primary btn-block" id="dmAddBtn">Savatga qo'shish</button>`;
        foot.querySelector("#dmAddBtn").addEventListener("click",()=>{addToCart(d);updateAllCards();refreshModal();});
      } else {
        foot.innerHTML=`<div class="dm-qty">
            <button class="qty-btn qty-minus" id="dmMinus">−</button>
            <span class="qty-num" id="dmNum">${q}</span>
            <button class="qty-btn qty-plus" id="dmPlus">+</button>
          </div>
          <button class="btn btn-primary btn-block" style="margin-top:10px" id="dmGoCart">Savatni ko'rish</button>`;
        foot.querySelector("#dmMinus").addEventListener("click",()=>{changeQty(d.id,-1);updateAllCards();refreshModal();});
        foot.querySelector("#dmPlus").addEventListener("click",()=>{addToCart(d);updateAllCards();refreshModal();});
        foot.querySelector("#dmGoCart").addEventListener("click",()=>{closeModal();openCart();});
      }
    };

    const addBtn = document.querySelector("#dmAddBtn");
    if(addBtn) addBtn.addEventListener("click",()=>{addToCart(d);updateAllCards();refreshModal();});
    const minus = document.querySelector("#dmMinus");
    if(minus){
      minus.addEventListener("click",()=>{changeQty(d.id,-1);updateAllCards();refreshModal();});
      document.querySelector("#dmPlus").addEventListener("click",()=>{addToCart(d);updateAllCards();refreshModal();});
      document.querySelector("#dmGoCart").addEventListener("click",()=>{closeModal();openCart();});
    }
  }

  /* Reklama (announcement) shu taomга tegishlimi — nomi yoki rasmi bir xil bo'lsa.
     Shunda taom kartasida ham "aksiya" ko'rinadi (chegirma↔taom bog'lanishi). */
  function dishAdMatch(d){
    try{
      const promos = getAllPromos();
      return promos.find(p=> p && (
        (p.rest===d.rest && p.dish && p.dish===d.name) ||
        (p.img && d.photo && p.img===d.photo)
      )) || null;
    }catch(e){ return null; }
  }
  /* Taom qaysi restoranga tegishli — id topamiz (taom bosilganda o'sha restoranga kiritish uchun) */
  function restIdOf(d){
    try{ const r=restList().find(x=>x.name===d.rest); return r?r.id:null; }catch(e){ return null; }
  }
  function makeDishCard(d, inRest){
    const c=document.createElement("div");
    c.className="card";
    c.dataset.dishId = d.id;
    if(d.discount>0) c.dataset.discounted = "true";
    const ad = dishAdMatch(d);
    const promoBadge = ad ? `<span class="card-promo">🔥 ${esc(ad.tag||"AKSIYA")}</span>` : "";
    c.innerHTML = `
        <div class="card-img tone-${d.kw}" style="cursor:pointer">
          <span class="food-emoji">${d.emoji}</span>
          ${d.photo?`<img class="card-photo-bg" src="${d.photo}" alt="" aria-hidden="true" loading="lazy" onerror="this.remove()">`:""}
          <img class="card-photo" src="${d.photo}" alt="${esc(nm(d))}" loading="lazy" onerror="this.remove()">
          ${d.badge?`<span class="card-badge">${d.badge}</span>`:""}
          ${promoBadge}
        </div>
        <div class="card-body">
          <h3 style="cursor:pointer">${esc(nm(d))}</h3>
          <div class="card-rest">${d.rest}</div>
          <div class="card-meta"><span class="cm-star">★ ${d.rating}</span> · ${d.sold}+ ${I18N.t("orders_word")}</div>
          <div class="card-foot"></div>
        </div>
        <div class="card-pod"><div class="card-pod-action"></div></div>`;
    // Index/aksiya gridida: taomga bosilsa — o'sha taomning restorani sahifasiga kiritamiz
    // (bitta buyurtma = bitta restoran). Restoran sahifasi ichida esa taom tafsilotlari (modal) ochiladi.
    const onDishClick = inRest
      ? ()=>openDishModal(d)
      : ()=>{ const rid=restIdOf(d); if(rid!=null) location.hash="restoran/"+rid; else openDishModal(d); };
    c.querySelector(".card-img").addEventListener("click",onDishClick);
    c.querySelector("h3").addEventListener("click",onDishClick);
    // Card-foot ni render qilish
    updateCardQty(c,d);
    return c;
  }
  /* Kunlik rotatsiya: har kuni boshqa restoran taomlari birinchi chiqadi */
  function dayIndex(){ return Math.floor(Date.now()/86400000); }
  function dailyRestOrder(){
    const names=(typeof RESTAURANTS!=="undefined")?RESTAURANTS.map(r=>r.name):[];
    if(!names.length) return [];
    const off=dayIndex()%names.length;
    return names.slice(off).concat(names.slice(0,off));
  }
  /* ---------- KATEGORIYANI ANIQLASH ----------
     Restoran paneli hozircha barcha taomga "Fastfood" beradi. Kategoriya
     tugmalari (Milliy/Ichimlik/Shirinlik/Fastfood) to'g'ri ishlashi uchun
     taom NOMI va EMOJISIga qarab kategoriyani taxmin qilamiz. Agar restoran
     ANIQ boshqa (Fastfooddan farqli) kategoriya tanlagan bo'lsa — o'sha ustun turadi. */
  const CAT_RULES = [
    { cat:"Ichimlik", emo:"🥤🧃☕🍵🧋🍹🥛🍶🫖🧉🍺🍸🧊",
      kw:["ichimlik","sharbat","juice","cola","kola","pepsi","fanta","sprite","choy","tea","kofe","coffee","cappuccino","kapuchino","latte","suv ","water","limonad","kompot","milkshake","shake","smuzi","smoothie","ayron","ayran","lassi","kvas","energetik","napitok","cok","koktey"] },
    { cat:"Shirinlik", emo:"🍰🎂🧁🍮🍩🍪🍨🍦🍧🥧🍫🍬🍭🍯🥮🍡",
      kw:["tort","cake","shirin","desert","dessert","muzqaymoq","morojen","ice cream","pirog","donut","ponchik","keks","cupcake","pechen","cookie","shokolad","choco","halva","holva","chak-chak","chakchak","chak chak","medovik","napoleon","tiramisu","cheesecake","pudding","jele","zefir","pirojn","vafli","waffle","kruassan","croissant","baklava","pahlava"] },
    { cat:"Milliy", emo:"🍚🍛🥘🫕🍲🥟",
      kw:["osh","palov","plov","manti","mant","lag'mon","lagmon","lagman","somsa","samsa","shashlik","shashlyk","kabob","kabab","kebab","norin","shurva","sho'rva","shorva","dimlama","chuchvara","chuchvora","beshbarmoq","dolma","mastava","mosh","milliy","tandir","hasip","xasip","qozon","kazan","xonim","gumma","jarkop","jarkob","qovurma","kuurdak","qazi","tuxum barak","damlama"] },
    { cat:"Fastfood", emo:"🍔🍟🌭🍕🌮🌯🥪🧀🍗🥙🥗🌭",
      kw:["burger","gamburger","chizburger","cheeseburger","lavash","lavaş","hotdog","hot dog","hot-dog","xotdog","xot-dog","pizza","pitsa","sendvich","sandwich","fri ","fries","kartoshka fri","nagets","nuggets","naggets","shaurma","shawarma","shaverma","doner","döner","dyuner","club","klab","strips","wings","qanot","gyros","salat","salad","sezar","caesar","salata"] }
  ];
  function catFromText(d){
    const hay=((d.name||"")+" "+(d.nameCyr||"")+" ").toLowerCase();
    const emo=d.emoji||"";
    for(const r of CAT_RULES){
      if(emo && r.emo.includes(emo)) return r.cat;
      if(r.kw.some(k=>hay.includes(k))) return r.cat;
    }
    return "";
  }
  function dishCat(d){
    const valid=(typeof DISH_CATS!=="undefined")?DISH_CATS:["Hammasi","Fastfood","Milliy","Ichimlik","Shirinlik"];
    /* 1) Restoran aniq (Fastfooddan farqli) kategoriya tanlagan bo'lsa */
    if(d.cat && d.cat!=="Fastfood" && valid.indexOf(d.cat)>=0) return d.cat;
    /* 2) Nomi/emojisidan taxmin */
    const guess=catFromText(d);
    if(guess) return guess;
    /* 3) Aks holda restoran bergani (yoki Fastfood) */
    return (d.cat && valid.indexOf(d.cat)>=0)?d.cat:"Fastfood";
  }

  let searchQ = "";
  function renderDishes(){
    const g = $("#dishesGrid"); g.innerHTML="";
    const q = searchQ.trim().toLowerCase();
    let list = catalog().filter(d=>activeCat==="Hammasi"||dishCat(d)===activeCat);
    if(q) list = list.filter(d=>{
      const catL=dishCat(d);
      const catC=(typeof DISH_CATS_CYR!=="undefined"&&DISH_CATS_CYR[catL])?DISH_CATS_CYR[catL]:"";
      return (d.name||"").toLowerCase().includes(q) ||
        (d.nameCyr||"").toLowerCase().includes(q) ||
        (d.rest||"").toLowerCase().includes(q) ||
        catL.toLowerCase().includes(q) ||
        catC.toLowerCase().includes(q);
    });
    if(!list.length){ g.innerHTML='<p style="color:var(--grey);grid-column:1/-1;text-align:center;padding:34px 10px">Hech narsa topilmadi 🔍</p>'; return; }
    /* Faqat "Hammasi" va qidiruvsiz holatda kunlik rotatsiya + tavsiya banneri */
    if(activeCat==="Hammasi" && !q){
      const order=dailyRestOrder();
      const featured=order[0]||"";
      const rank=name=>{ const i=order.indexOf(name); return i<0?999:i; };
      list=list.slice().sort((a,b)=>rank(a.rest)-rank(b.rest));
      if(featured){
        const banner=document.createElement("div");
        banner.style.cssText="grid-column:1/-1;display:flex;align-items:center;gap:12px;background:linear-gradient(90deg,#fff4e6,#ffe9ec);border:1px solid #ffd9c2;border-radius:14px;padding:12px 16px;margin-bottom:6px";
        banner.innerHTML='<span style="font-size:24px">🔥</span><div><div style="font-weight:800;color:#C8102E;font-size:15px">Bugungi tavsiya: '+esc(featured)+'</div><div style="font-size:12px;color:#8a7f76">Har kuni boshqa restoran taomlari birinchi chiqadi</div></div>';
        g.appendChild(banner);
      }
    }
    list.forEach(d=>g.appendChild(makeDishCard(d)));
  }

  /* ---------- RESTAURANT PAGE (ko'p sahifa) ---------- */
  /* Restoran haqidagi to'liq ma'lumot bloki (saytda ko'rinadi) */
  function restBackend(name){
    try{ return (typeof STORE!=="undefined"&&STORE.restaurants)?STORE.restaurants().find(x=>x.name===name):null; }catch(e){ return null; }
  }
  function restInfoBlock(r){
    const be=restBackend(r.name)||{};
    const open=isRestOpen(r.name);
    const rows=[];
    rows.push(`<div class="rinfo-row"><span class="rinfo-ico">🕒</span><div><div class="rinfo-k">Ish vaqti</div><div class="rinfo-v">${esc(restHoursText(r.name))} <span class="rinfo-badge ${open?'ok':'off'}">${open?'🟢 Hozir ochiq':'🔴 Yopiq'}</span></div></div></div>`);
    if(be.addr)  rows.push(`<div class="rinfo-row"><span class="rinfo-ico">📍</span><div><div class="rinfo-k">Manzil</div><div class="rinfo-v">${esc(be.addr)}</div></div></div>`);
    if(be.area)  rows.push(`<div class="rinfo-row"><span class="rinfo-ico">🛵</span><div><div class="rinfo-k">Yetkazish hududi</div><div class="rinfo-v">${esc(be.area)}</div></div></div>`);
    if(be.email) rows.push(`<div class="rinfo-row"><span class="rinfo-ico">✉️</span><div><div class="rinfo-k">Aloqa</div><div class="rinfo-v">${esc(be.email)}</div></div></div>`);
    rows.push(`<div class="rinfo-row"><span class="rinfo-ico">⭐</span><div><div class="rinfo-k">Reyting</div><div class="rinfo-v">${r.rating} · ⏱ ${r.eta} ${I18N.t("min_eta")} · 📍 ${esc(r.dist||"")}</div></div></div>`);
    const desc = be.descr ? `<p class="rinfo-desc">${esc(be.descr)}</p>` : "";
    return `<div class="rinfo-card">
      <div class="rinfo-title">🏪 ${esc(nm(r))} haqida</div>
      ${desc}
      <div class="rinfo-grid">${rows.join("")}</div>
    </div>`;
  }
  /* Restoranning O'Z aksiyalari + CHEGIRMALI taomlari — faqat shu restoran sahifasida.
     To'lqinli olovrang banner; chegirmали taom bosilса — modal, «+» savatga qo'shadi. */
  function restPromoBlock(r){
    const menu=catalog().filter(d=>d.rest===r.name);
    const disc=menu.filter(d=>d.discount>0);
    let anns=[]; try{ anns=getAllPromos().filter(p=>p && p.rest===r.name); }catch(e){}
    if(!disc.length && !anns.length) return "";
    const realImg=s=>/^\/uploads\/|^data:|^https?:/.test(String(s||""));
    const annHtml=anns.map(p=>{
      const photo=p.img||promoPhoto(p);
      return `<div class="rpromo-item">
        <div class="rpromo-ph">${photo?`<img src="${photo}" alt="" onerror="this.replaceWith(Object.assign(document.createElement('span'),{textContent:'${p.emoji||"📢"}'}))">`:`<span>${p.emoji||"📢"}</span>`}</div>
        <div class="rpromo-body">
          <div class="rpromo-text">${esc(p.text)}</div>
          <div class="rpromo-meta">${p.tag?`<span class="rpromo-tag">${esc(p.tag)}</span>`:""}${p.dish?`<span class="rpromo-why">🍽️ ${esc(p.dish)}</span>`:""}</div>
        </div>
      </div>`;
    }).join("");
    const discHtml=disc.map(d=>{
      const photo=realImg(d.photo)?d.photo:"";
      return `<div class="rpromo-item rpromo-dish" data-dish-id="${d.id}" style="cursor:pointer">
        <div class="rpromo-ph">${photo?`<img src="${photo}" alt="" onerror="this.remove()">`:`<span>${d.emoji}</span>`}</div>
        <div class="rpromo-body">
          <div class="rpromo-text">${esc(nm(d))}</div>
          <div class="rpromo-meta"><span class="rpromo-old">${fmt(d.price)}</span> <b class="rpromo-new">${fmt(d.eff)} so'm</b> <span class="rpromo-tag">−${d.discount}%</span></div>
          <div class="rpromo-why">🔥 ${d.discount}% chegirma — hoziroq oling!</div>
        </div>
        <button class="rpromo-add" data-add="${d.id}" aria-label="Savatga qo'shish">+</button>
      </div>`;
    }).join("");
    return `<div class="rinfo-card rpromo-banner">
      <div class="rpromo-head">🔥 ${esc(nm(r))} — aksiya va chegirmalar</div>
      <div class="rpromo-list">${annHtml}${discHtml}</div>
      <svg class="rpromo-wave" viewBox="0 0 1440 40" preserveAspectRatio="none" aria-hidden="true"><path d="M0,14 C240,42 480,2 720,18 C960,34 1200,44 1440,20 L1440,40 L0,40 Z" fill="rgba(255,255,255,.28)"/></svg>
    </div>`;
  }

  function openRestaurant(id){
    const r=restList().find(x=>x.id===id)||((typeof RESTAURANTS!=="undefined")?RESTAURANTS.find(x=>x.id===id):null); if(!r) return;
    const menu=catalog().filter(d=>d.rest===r.name);
    const view=$("#restaurantView");
    view.innerHTML=`
      <div class="rhero tone-${r.kw}">
        ${(function(){const p=restPhoto(r.name);return p?`<img class="rhero-photo-bg" src="${p}" alt="" aria-hidden="true" onerror="this.remove()"><img class="rhero-photo" src="${p}" alt="${esc(nm(r))}" onerror="this.remove()">`:"";})()}
        <div class="rhero-overlay"></div>
        <div class="container rhero-inner">
          <button class="rback" id="rBack">← ${I18N.t("back")}</button>
          <div class="rhero-emoji">${r.emoji}</div>
          <h1>${nm(r)}</h1>
          <div class="rhero-meta">
            <span>★ ${r.rating}</span><span>⏱ ${r.eta} ${I18N.t("min_eta")}</span>
            <span>📍 ${r.dist}</span><span class="rhero-open">${restOpenLabel(r.name)}</span>
          </div>
        </div>
      </div>
      <div class="container">
        ${restInfoBlock(r)}
        ${restPromoBlock(r)}
      </div>
      <div class="container rmenu">
        <h2>${I18N.t("rest_menu")}</h2>
        <div class="grid dishes-grid" id="rMenuGrid"></div>
      </div>`;
    const grid=view.querySelector("#rMenuGrid");
    (menu.length?menu:DISHES.slice(0,8)).forEach(d=>grid.appendChild(makeDishCard(d,true)));
    /* Reklama banneri ishlaydi: chegirmali taomga bosilsa modal, «+» savatga qo'shadi */
    view.querySelectorAll(".rpromo-dish").forEach(it=>it.addEventListener("click",(e)=>{
      if(e.target.classList.contains("rpromo-add")) return;
      const d=catalog().find(x=>x.id===+it.dataset.dishId); if(d) openDishModal(d);
    }));
    view.querySelectorAll(".rpromo-add").forEach(b=>b.addEventListener("click",(e)=>{
      e.stopPropagation();
      const d=catalog().find(x=>x.id===+b.dataset.add); if(!d) return;
      flyToCart(d,e.currentTarget); addToCart(d); updateAllCards();
    }));
    $("#rBack").addEventListener("click",()=>{ location.hash=""; });
    document.body.classList.add("ropen");
    window.scrollTo({top:0});
  }
  function closeRestaurant(){
    document.body.classList.remove("ropen");
    $("#restaurantView").innerHTML="";
  }
  function handleHash(){
    const m=location.hash.match(/^#restoran\/(\d+)/);
    if(m){ openRestaurant(parseInt(m[1],10)); }
    else if(document.body.classList.contains("ropen")){ closeRestaurant();
      const rs=document.getElementById("restaurants"); if(rs) rs.scrollIntoView({behavior:"smooth"}); }
  }

  /* ---------- RENDER RESTAURANTS ---------- */
  /* Faqat restoran EGASI yuklagan rasm (uploads/data) ko'rsatiladi; aks holda emoji plitka */
  function restPhoto(name){
    try{
      const be=(typeof STORE!=="undefined"&&STORE.restaurants)?STORE.restaurants().find(x=>x.name===name):null;
      const p=(be&&be.photo)||"";
      return /^\/uploads\/|^data:/.test(p) ? p : "";
    }catch(e){ return ""; }
  }
  /* Restoran haqida backend qo'shimcha ma'lumoti */
  function restExtra(name){
    try{ return (typeof STORE!=="undefined"&&STORE.restaurants)?STORE.restaurants().find(x=>x.name===name)||{}:{}; }catch(e){ return {}; }
  }
  function renderRests(){
    const g=$("#restGrid"); g.innerHTML="";
    restList().forEach(r=>{
      const be=restExtra(r.name);
      const dishCount=catalog().filter(d=>d.rest===r.name).length;
      const addr=be.addr||r.addr||"";
      const hours=(be.open_h!=null&&be.close_h!=null)?(String(be.open_h).padStart(2,"0")+":00–"+String(be.close_h).padStart(2,"0")+":00"):"";
      const openLbl=(typeof restOpenLabel==="function")?restOpenLabel(r.name):"";
      const isOpen=/ochiq|open|очиқ/i.test(openLbl);
      const c=document.createElement("div"); c.className="rest-card";
      c.innerHTML=`
        <div class="rest-img tone-${r.kw}"><span class="food-emoji">${r.emoji}</span>${(function(){const p=restPhoto(r.name);return p?`<img class="rest-photo-bg" src="${p}" alt="" aria-hidden="true" loading="lazy" onerror="this.remove()"><img class="rest-photo" src="${p}" alt="${esc(nm(r))}" loading="lazy" onerror="this.remove()">`:"";})()}
          ${openLbl?`<span class="rest-openbadge ${isOpen?'is-open':'is-closed'}">${isOpen?'🟢 Ochiq':'🔴 Yopiq'}</span>`:""}</div>
        <div class="rest-body">
          <h3>${nm(r)}</h3>
          <div class="rest-meta">
            <span class="star">★ ${r.rating}</span>
            <span>⏱ ${r.eta} ${I18N.t("min_eta")}</span>
            <span>📍 ${r.dist}</span>
          </div>
          <div class="rest-info2">
            <span>🍽️ ${dishCount} ta taom</span>
            ${hours?`<span>🕒 ${hours}</span>`:""}
          </div>
          ${addr?`<div class="rest-addr">📍 ${esc(addr)}</div>`:""}
          ${be.descr?`<div class="rest-descr">${esc(String(be.descr).slice(0,90))}</div>`:""}
        </div>`;
      c.querySelector(".rest-img").style.position="relative";
      c.addEventListener("click",()=>{ location.hash="restoran/"+r.id; });
      g.appendChild(c);
    });
    const fr=$("#footerRests"); fr.innerHTML="";
    restList().forEach(r=>{ const li=document.createElement("li"); li.textContent=nm(r); fr.appendChild(li); });
  }

  /* ---------- REVIEWS ---------- */
  function renderReviews(){
    const g=$("#reviewsGrid"); if(!g) return; g.innerHTML="";
    const live=(typeof STORE!=="undefined")?STORE.reviews():[];
    /* Kuryer reytinglari (dish "🛵 Kuryer: ...") saytda ko'rsatilmaydi — faqat kuryer/admin panelida */
    const isCourierReview = r => /^🛵\s*Kuryer:/.test(String(r&&r.dish||""));
    /* Qaysi restoran taomi ekanligini topamiz */
    const reviewRest = r => { const d=catalog().find(x=>x.name===r.dish); return d?d.rest:(r.rest||""); };
    const revDate = r => { const raw=String(r.date||r.created_at||""); const m=raw.match(/(\d{4})-(\d{2})-(\d{2})/); return m?(m[3]+"."+m[2]+"."+m[1]):(raw.length<=12?raw:""); };
    /* Ommaviy izohlar: faqat 3+ yulduz qabul qilinadi (kuryer reytinglaridan tashqari) */
    [...live, ...REVIEWS].filter(r=>!isCourierReview(r) && (r.rating||0)>=3).slice(0,9).forEach(r=>{
      const stars="★".repeat(r.rating)+"☆".repeat(5-r.rating);
      const txt = (I18N.current()==="cyr" && r.textCyr) ? r.textCyr : r.text;
      const rest=reviewRest(r), dt=revDate(r);
      const el=document.createElement("div"); el.className="review-card";
      el.innerHTML=`<div class="rv-head"><span class="rv-ava">${r.ava}</span>
        <div><div class="rv-name">${esc(r.name)}</div><div class="rv-stars">${stars}</div></div>
        ${dt?`<span class="rv-date">${dt}</span>`:""}</div>
        <p class="rv-text">${esc(txt)}</p>
        <div class="rv-dish">🍽️ ${esc(r.dish)}${rest?` · 🏪 ${esc(rest)}`:""}</div>`;
      g.appendChild(el);
    });
  }

  /* ---------- CART ---------- */
  /* Geolokatsiya: qurilma joylashuvini aniqlab, manzil maydonini to'ldiradi */
  function detectLocation(inputEl, btn){
    if(!navigator.geolocation){ toast("Brauzeringiz joylashuvni qo'llamaydi","error"); return; }
    const orig = btn ? btn.innerHTML : "";
    if(btn){ btn.disabled=true; btn.innerHTML="📍 Aniqlanmoqda..."; }
    const done=()=>{ if(btn){ btn.disabled=false; btn.innerHTML=orig; } };
    navigator.geolocation.getCurrentPosition(async (pos)=>{
      const lat=pos.coords.latitude, lng=pos.coords.longitude;
      let addr="";
      try{
        const r=await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&accept-language=uz`,{headers:{"Accept":"application/json"}});
        const j=await r.json(); addr=(j&&j.display_name)||"";
      }catch(e){}
      if(!addr) addr=`(${lat.toFixed(5)}, ${lng.toFixed(5)})`;
      /* Inputga YOZMAYMIZ — foydalanuvchi yozgani turadi. Joylashuv faqat xotirada. */
      user.geo = { lat:lat, lng:lng, addr:addr };
      done(); toast("Joylashuv aniqlandi 📍 (manzil maydoni o'zgarmaydi)","success");
    }, (err)=>{
      done();
      toast(err && err.code===1 ? "Joylashuvga ruxsat berilmadi" : "Joylashuvni aniqlab bo'lmadi","error");
    }, { enableHighAccuracy:true, timeout:10000, maximumAge:60000 });
  }

  /* Restoran hozir ochiqmi (ish vaqti) */
  function isRestOpen(restName){
    try{
      const r = (typeof STORE!=="undefined" && STORE.restaurants) ? STORE.restaurants().find(x=>x.name===restName) : null;
      if(!r || r.openH==null || r.closeH==null) return true;
      const h = new Date().getHours();
      return h>=r.openH && h<r.closeH;
    }catch(e){ return true; }
  }
  function restHoursText(restName){
    try{
      const r=(typeof STORE!=="undefined"&&STORE.restaurants)?STORE.restaurants().find(x=>x.name===restName):null;
      if(r && r.hours) return String(r.hours);
      const oh=r&&r.openH!=null?r.openH:9, ch=r&&r.closeH!=null?r.closeH:23;
      const pad=n=>String(n).padStart(2,"0");
      return pad(oh)+":00–"+pad(ch)+":00";
    }catch(e){ return "09:00–23:00"; }
  }
  function restOpenLabel(restName){
    try{
      const hrs=restHoursText(restName);
      /* Ish vaqti DOIM ko'rinadi — ochiq/yopiq holati bilan birga */
      return isRestOpen(restName) ? ("🟢 Ochiq · "+hrs) : ("🔴 Yopiq · "+hrs);
    }catch(e){ return "🟢 Ochiq"; }
  }
  function addToCart(d){
    const ex = cart.find(i=>i.id===d.id);
    if(!ex && d.soldout){ toast("Bu taom hozir sotuvda yo'q","error"); return; }
    if(!ex && d.rest && !isRestOpen(d.rest)){ toast(d.rest+" hozir yopiq","error"); return; }
    /* Bitta buyurtmada faqat bitta restoran — boshqa restoran taomi qo'shilsa so'raymiz */
    if(!ex && cart.length && cart[0].rest && d.rest && cart[0].rest!==d.rest){
      const newRest=(typeof RESTAURANTS!=="undefined")?RESTAURANTS.find(x=>x.name===d.rest):null;
      const cnt=(typeof catalog==="function")?catalog().filter(x=>x.rest===d.rest).length:0;
      openModal(`<div style="text-align:center">
        <div style="font-size:42px">🏪</div>
        <h2 style="margin:8px 0">${esc(d.rest)} ga o'tamizmi?</h2>
        <p class="modal-sub">Bitta buyurtmada faqat bitta restoran bo'ladi. Savatingizda <b>${esc(cart[0].rest)}</b> taomlari bor. <b>${esc(d.rest)}</b> ga o'tsangiz — uning barcha taomlarini${cnt?` (${cnt} ta)`:""} ko'rasiz. Savat yangilanadi.</p>
        <div style="display:flex;gap:10px;margin-top:10px">
          <button class="btn btn-outline btn-block" id="keepCart">Yo'q, qolaman</button>
          <button class="btn btn-primary btn-block" id="switchCart">Ha, kirish</button>
        </div></div>`);
      const kc=document.getElementById("keepCart"); if(kc) kc.addEventListener("click",closeModal);
      const sc=document.getElementById("switchCart"); if(sc) sc.addEventListener("click",()=>{
        cart=[{...d, price:(d.eff||d.price), qty:1}];
        updateCart(); updateAllCards(); closeModal(); toast(d.rest+" — savatga qo'shildi","success");
        /* Foydalanuvchini o'sha restoran sahifasiga kiritamiz (hamma taomi ko'rinadi) */
        if(newRest){ try{ location.hash="restoran/"+newRest.id; }catch(e){} }
      });
      return;
    }
    if(ex) ex.qty++; else cart.push({...d, price:(d.eff||d.price), qty:1});
    updateCart(); updateAllCards(); toast(I18N.t("t_added"),"success");
  }
  function changeQty(id,delta){
    const it=cart.find(i=>i.id===id); if(!it) return;
    it.qty+=delta; if(it.qty<=0) cart=cart.filter(i=>i.id!==id);
    updateCart(); updateAllCards();
  }
  function cartTotal(){ return cart.reduce((s,i)=>s+i.price*i.qty,0); }
  /* Yetkazish narxi — restoran masofasi (km) bo'yicha: 4000 + 1500/km */
  function deliveryFee(){
    if(!cart.length) return 0;
    const restName = cart[0].rest;
    let distStr = "";
    try{
      const r = (typeof STORE!=="undefined" && STORE.restaurants) ? STORE.restaurants().find(x=>x.name===restName) : null;
      distStr = (r && r.dist) || ((typeof RESTAURANTS!=="undefined" ? RESTAURANTS.find(x=>x.name===restName) : null)||{}).dist || "";
    }catch(e){}
    const m = String(distStr).match(/[\d.,]+/);
    const km = m ? (parseFloat(m[0].replace(",","."))||2) : 2;
    return Math.max(3000, Math.round((4000 + km*1500)/500)*500);
  }
  function updateCart(){
    $("#cartCount").textContent = cart.reduce((s,i)=>s+i.qty,0);
    const body=$("#cartItems");
    if(!cart.length){ body.innerHTML=`<div class="cart-empty"><div style="font-size:46px">🛒</div><p>${I18N.t("empty_cart")}</p><small>${I18N.t("empty_hint")}</small></div>`; }
    else{
      body.innerHTML="";
      cart.forEach(i=>{
        const row=document.createElement("div"); row.className="cart-row";
        row.innerHTML=`
          <div class="ci-img"><span>${i.emoji}</span></div>
          <div class="ci-info"><h4>${nm(i)}</h4><span>${fmt(i.price)} ${I18N.t("sum")}</span></div>
          <div class="qty"><button data-m="-1">−</button><b>${i.qty}</b><button data-m="1">+</button></div>`;
        row.querySelector('[data-m="-1"]').addEventListener("click",()=>changeQty(i.id,-1));
        row.querySelector('[data-m="1"]').addEventListener("click",()=>changeQty(i.id,1));
        body.appendChild(row);
      });
    }
    const total=cartTotal();
    $("#cartTotal").textContent=fmt(total);
    const note=$("#cartMinNote");
    if(total>0 && total<MIN_ORDER){ note.classList.add("warn"); note.textContent=`${I18N.t("err_min")} ( +${fmt(MIN_ORDER-total)} )`; }
    else{ note.classList.remove("warn"); note.textContent=I18N.t("min_note"); }
  }

  /* ---------- MODAL ---------- */
  /* ===== App-uslubidagi ORTGA QAYTISH =====
     Modal yoki savat ochiq bo'lsa, brauzer/Android "back" tugmasi sahifadan
     chiqmaydi — birma-bir ochiq oynani yopadi. */
  function anyOverlayOpen(){
    return $("#modal").classList.contains("open")
      || $("#cartDrawer").classList.contains("open")
      || !!document.getElementById("arrivedOverlay")
      || $("#onboard").classList.contains("show");
  }
  function closeTopOverlay(){
    if($("#modal").classList.contains("open")){ closeModal(); return; }
    const ao=document.getElementById("arrivedOverlay"); if(ao){ ao.remove(); return; }
    if($("#cartDrawer").classList.contains("open")){ closeCart(); return; }
    if($("#onboard").classList.contains("show")){ $("#onboard").classList.remove("show"); return; }
  }
  let backArmed=false;
  function armBack(){ if(!backArmed){ try{ history.pushState({yzOverlay:1}, ""); backArmed=true; }catch(e){} } }
  window.addEventListener("popstate", ()=>{
    backArmed=false;
    if(anyOverlayOpen()){ closeTopOverlay(); if(anyOverlayOpen()) armBack(); }
  });

  function openModal(html){ $("#modalContent").innerHTML=html; $("#modal").classList.add("open"); $("#modalBackdrop").classList.add("open"); armBack(); }
  function closeModal(){ $("#modal").classList.remove("open"); $("#modalBackdrop").classList.remove("open"); }

  /* Step 1: auth */
  /* ---- UMUMIY KIRISH (login/ro'yxatdan o'tish) ---- */
  function openLogin(){
    openModal(`
      <div class="auth-head">
        <div class="auth-emoji">🔐</div>
        <h2>Kirish</h2>
        <p>Panelingizga xush kelibsiz</p>
        <svg class="auth-wave" viewBox="0 0 400 40" preserveAspectRatio="none" aria-hidden="true"><path d="M0,18 C90,44 170,2 250,20 C320,35 360,32 400,20 L400,40 L0,40 Z" fill="#fff"/></svg>
      </div>
      <div class="auth-body">
      <div class="field"><label>Login</label><input id="lg-login" placeholder="login"></div>
      <div class="field"><label>Parol</label><input id="lg-pass" type="password" placeholder="••••••"></div>
      <div id="lg-err" style="color:var(--red);font-size:13px;min-height:18px;font-weight:600;margin-bottom:6px"></div>
      <button class="btn btn-primary btn-block" id="lg-btn">Kirish</button>
      <p style="text-align:center;margin-top:14px;font-size:14px;color:var(--grey)">Akkountingiz yo'qmi? <a id="lg-reg" style="color:var(--red);font-weight:700;cursor:pointer">Ro'yxatdan o'tish</a></p>
      </div>`);
    $("#lg-pass").addEventListener("keydown",e=>{ if(e.key==="Enter") doLogin(); });
    $("#lg-btn").addEventListener("click",doLogin);
    $("#lg-reg").addEventListener("click",openRegister);
  }
  async function doLogin(){
    const login=$("#lg-login").value.trim(), pass=$("#lg-pass").value.trim();
    if(!login||!pass){ $("#lg-err").textContent="Login va parolni kiriting"; return; }
    const btn=$("#lg-btn"); if(btn){ btn.disabled=true; btn.textContent="Kirilmoqda..."; }
    const acc=(typeof STORE!=="undefined")? await STORE.login(login,pass):null;
    if(btn){ btn.disabled=false; btn.textContent="Kirish"; }
    if(acc && acc.offline){ $("#lg-err").textContent="Serverga ulanib bo'lmadi. Saytni server orqali oching (masalan http://localhost:5050) va internetni tekshiring."; return; }
    if(!acc){ $("#lg-err").textContent="Login yoki parol xato. Akkountingiz bo'lmasa, ro'yxatdan o'ting."; return; }
    /* Rolga qarab paneliga yo'naltiramiz: admin->admin.html, restoran->restoran.html, kuryer->kuryer.html, user->kabinet.html */
    try{ window.location.href=acc.target || "kabinet.html"; }catch(e){}
  }
  function openRegister(){
    openModal(`
      <div class="auth-head">
        <div class="auth-emoji">🎉</div>
        <h2>Ro'yxatdan o'tish</h2>
        <p>Yangi foydalanuvchi akkaunti</p>
        <svg class="auth-wave" viewBox="0 0 400 40" preserveAspectRatio="none" aria-hidden="true"><path d="M0,18 C90,44 170,2 250,20 C320,35 360,32 400,20 L400,40 L0,40 Z" fill="#fff"/></svg>
      </div>
      <div class="auth-body">
      <div class="field"><label>Ism</label><input id="rg-name" placeholder="Ismingiz"></div>
      <div class="field"><label>Telefon</label><input id="rg-phone" placeholder="+998 90 123 45 67"></div>
      <div class="field"><label>Login</label><input id="rg-login" placeholder="login tanlang"></div>
      <div class="field"><label>Parol</label><input id="rg-pass" type="password" placeholder="••••••"></div>
      <div id="rg-err" style="color:var(--red);font-size:13px;min-height:18px;font-weight:600;margin-bottom:6px"></div>
      <button class="btn btn-primary btn-block" id="rg-btn">Ro'yxatdan o'tish</button>
      <p style="text-align:center;margin-top:14px;font-size:14px;color:var(--grey)">Akkountingiz bormi? <a id="rg-back" style="color:var(--red);font-weight:700;cursor:pointer">Kirish</a></p>
      </div>`);
    $("#rg-btn").addEventListener("click",doRegister);
    $("#rg-back").addEventListener("click",openLogin);
    if(window.YZ_PHONE) YZ_PHONE.attach($("#rg-phone"));
  }
  async function doRegister(){
    const name=$("#rg-name").value.trim(), phone=$("#rg-phone").value.trim(), login=$("#rg-login").value.trim(), pass=$("#rg-pass").value.trim();
    const err=m=>{ const e=$("#rg-err"); if(e) e.textContent=m; };
    if(name.length<2) return err("Ismingizni kiriting");
    if(window.YZ_PHONE && !YZ_PHONE.valid(phone)) return err("Telefon raqamini to'g'ri kiriting: +998 XX XXX XX XX");
    if(login.length<3) return err("Login kamida 3 belgi bo'lsin");
    if(pass.length<4) return err("Parol kamida 4 belgi bo'lsin");
    if(typeof STORE==="undefined") return err("Tizim tayyor emas");
    const btn=$("#rg-btn"); if(btn){ btn.disabled=true; btn.textContent="Yuborilmoqda..."; }
    const acc=await STORE.register({name:name,phone:(window.YZ_PHONE?YZ_PHONE.pretty(phone):phone),login:login,pass:pass});
    if(btn){ btn.disabled=false; btn.textContent="Ro'yxatdan o'tish"; }
    if(!acc) return err("Ro'yxatdan o'tishda xatolik");
    if(acc.error) return err(acc.error);
    try{ window.location.href=acc.target; }catch(e){}
  }

  function openAuth(next){
    openModal(`
      <h2>${I18N.t("login_title")}</h2>
      <p class="modal-sub">${I18N.t("login_sub")}</p>
      <div class="field" id="f-name"><label>${I18N.t("lbl_name")}</label>
        <input id="in-name" value="${user.name}" placeholder="${I18N.t("ph_name")}"><div class="err">${I18N.t("err_name")}</div></div>
      <div class="field" id="f-phone"><label>${I18N.t("lbl_phone")}</label>
        <input id="in-phone" value="${user.phone}" placeholder="${I18N.t("ph_phone")}"><div class="err">${I18N.t("err_phone")}</div></div>
      <div class="field" id="f-addr"><label>${I18N.t("lbl_address")}</label>
        <input id="in-addr" value="${user.address}" placeholder="${I18N.t("ph_address")}"><div class="err">${I18N.t("err_address")}</div></div>
      <button type="button" class="btn btn-outline btn-block" id="geoBtn" style="margin-bottom:10px">📍 Joylashuvimni aniqlash</button>
      <button class="btn btn-primary btn-block" id="authNext">${I18N.t("continue")}</button>`);
    const geoBtn=$("#geoBtn"); if(geoBtn) geoBtn.addEventListener("click",()=>detectLocation($("#in-addr"), geoBtn));
    if(window.YZ_PHONE) YZ_PHONE.attach($("#in-phone"));
    $("#authNext").addEventListener("click",()=>{
      const name=$("#in-name").value.trim(), phone=$("#in-phone").value.trim(), addr=$("#in-addr").value.trim();
      let ok=true;
      const setErr=(id,bad)=>{ $(id).classList.toggle("invalid",bad); if(bad) ok=false; };
      setErr("#f-name", name.length<2);
      const phoneOk = window.YZ_PHONE ? YZ_PHONE.valid(phone) : phone.replace(/\D/g,"").length>=9;
      setErr("#f-phone", !phoneOk);
      setErr("#f-addr", addr.length<4);
      if(!ok) return;
      user.name=name; user.phone=(window.YZ_PHONE?YZ_PHONE.pretty(phone):phone); user.address=addr;
      if(typeof next==="function") next();
    });
  }

  /* Step 2: order confirm (min + debt checks) */
  function openOrder(){
    const total=cartTotal();
    if(total<MIN_ORDER){ closeModal(); openCart(); toast(I18N.t("t_min"),"error"); return; }
    const fee=deliveryFee();
    const grand=total+fee;
    const debtOk = user.debt<=0;
    openModal(`
      <h2>${I18N.t("order_title")}</h2>
      <p class="modal-sub">${user.name} · ${user.phone}</p>
      <div class="modal-summary">
        <div class="row"><span>${I18N.t("sum_items")} (${cart.reduce((s,i)=>s+i.qty,0)})</span><span>${fmt(total)} ${I18N.t("sum")}</span></div>
        <div class="row"><span>${I18N.t("sum_delivery")}</span><span>${fmt(fee)} ${I18N.t("sum")}</span></div>
        <div class="row total"><span>${I18N.t("sum_total")}</span><span>${fmt(grand)} ${I18N.t("sum")}</span></div>
      </div>
      <div class="field"><label>${I18N.t("paymethod")}</label>
        <div class="pay-opts">
          <div class="pay-opt on" data-pay="card">💳 ${I18N.t("pay_card")}</div>
          <div class="pay-opt" data-pay="cash">💵 ${I18N.t("pay_cash")}</div>
        </div>
      </div>
      <p style="color:var(--green);font-size:13px;font-weight:600;margin-bottom:14px">${debtOk?I18N.t("debt_warn"):""}</p>
      <button class="btn btn-primary btn-block" id="placeBtn">${I18N.t("place_order")}</button>`);
    $$(".pay-opt").forEach(o=>o.addEventListener("click",()=>{$$(".pay-opt").forEach(x=>x.classList.remove("on"));o.classList.add("on");}));
    $("#placeBtn").addEventListener("click",()=>{
      if(cartTotal()<MIN_ORDER){ toast(I18N.t("t_min"),"error"); return; }
      if(user.debt>0){ toast("Qarz mavjud — buyurtma bloklandi","error"); return; }
      window.__lastPay = (document.querySelector(".pay-opt.on")||{}).dataset?.pay || "card";
      startTracking();
    });
  }

  /* ============================================================
     BUYURTMALAR TIZIMI — activeOrders (localStorage)
     ============================================================ */
  const ORDER_KEY = "yz_active_orders";

  function loadOrders(){ try{ return JSON.parse(localStorage.getItem(ORDER_KEY)||"[]"); }catch(e){ return []; } }
  function saveOrders(arr){ try{ localStorage.setItem(ORDER_KEY,JSON.stringify(arr)); }catch(e){} }

  function genOrderId(){ return Date.now()+"_"+Math.random().toString(36).slice(2,7); }

  /* Barcha timer va interval lar: {orderId: {stepInt, tInt}} */
  const orderTimers = {};

  /* Step 3: tracking + timer */
  function startTracking(){
    const eta = 10 + Math.floor(Math.random()*3)*5; // 10, 15 yoki 20 daqiqa
    const eta_ms = eta * 60 * 1000;
    const now = Date.now();
    const arriveAt = now + eta_ms;

    // Buyurtma ob'ekti
    const orderId = genOrderId();
    const firstItem = cart[0];
    const totalItems = cart.reduce((s,i)=>s+i.qty,0);
    const label = firstItem ? (cart.length>1 ? firstItem.name+" +"+(cart.length-1)+" ta" : firstItem.name) : "Buyurtma";
    const emoji = firstItem ? firstItem.emoji : "🛵";
    const totalPrice = cartTotal();

    const order = {
      id: orderId,
      label,
      emoji,
      totalPrice,
      user: user.name || "Mehmon",   // backend buyurtmasiga moslash uchun
      items: cart.map(i=>({name:i.name, qty:i.qty, emoji:i.emoji})),
      eta,
      arriveAt,
      startAt: now,
      step: 0, // 0=qabul, 1=tayyorlanmoqda, 2=tayyor, 3=yo'lda, 4=yetdi
      done: false,
      arrivedShown: false,
    };

    // Backendga buyurtma yuborish (restoran / kuryer / admin ko'rishi uchun)
    try{
      if(typeof STORE!=="undefined" && STORE.addOrder){
        const restName = (cart[0] && cart[0].rest) || "";
        STORE.addOrder({
          user: user.name || "Mehmon",
          phone: user.phone || "",
          rest: restName,
          item: label,
          emoji: emoji,
          amount: totalPrice,
          delivery: (typeof deliveryFee==="function"?deliveryFee():0),
          addr: (user.address || "") + (user.geo ? " · 📍GPS: " + user.geo.lat.toFixed(5) + "," + user.geo.lng.toFixed(5) : ""),
          pay: window.__lastPay || "card",
          courier: STORE.courierForRest(restName),
          status: "new",
          eta: eta,
          time: new Date().toLocaleTimeString("ru-RU",{hour:"2-digit",minute:"2-digit"})
        });
      }
    }catch(e){}

    // Savatni tozalash
    const savedCart = [...cart];
    cart = []; updateCart(); updateAllCards();

    // Orderni saqlash
    const orders = loadOrders();
    orders.push(order);
    saveOrders(orders);

    // Tracker bannerni yangilash
    renderTrackerBanner();
    renderCartOrders();

    // Step 4: modal ichida mini tracking
    const steps = ["Qabul qilindi","Tayyorlanmoqda","Tayyor","Yo'lda","Yetib keldi"];
    const icons = ["📥","👨‍🍳","✅","🛵","🎉"];

    openModal(`
      <div class="track">
        <div style="text-align:center;margin-bottom:4px">
          <span style="font-size:48px">${emoji}</span>
        </div>
        <h2 style="text-align:center">Buyurtma qabul qilindi!</h2>
        <p class="modal-sub" style="text-align:center">${label}</p>
        <div class="timer" id="tTimer">${String(eta).padStart(2,"0")}:00</div>
        <div class="track-status" id="tStatus">Qabul qilindi</div>
        <div class="track-bar" id="tBar">
          ${steps.map((s,i)=>`<div class="track-step${i===0?" active":""}"><div class="dot">${icons[i]}</div><span>${s}</span></div>`).join("")}
        </div>
        <div style="background:#f0f9f4;border-radius:12px;padding:12px;margin:14px 0;font-size:13px;color:#1c6b3f;text-align:center">
          🛵 Kuryer yo'lga chiqdi. Ushbu oynani yopsangiz ham buyurtmangiz kuzatiladi.
        </div>
        <button class="btn btn-outline btn-block" id="trkClose">Tushunarli, yopish</button>
      </div>`);

    $("#trkClose").addEventListener("click", ()=>{
      closeModal();
    });

    // Orderni animatsiya qilish
    animateOrder(orderId);
  }

  /* Bitta orderni animate qilish */
  function animateOrder(orderId){
    if(orderTimers[orderId]) return; // allaqachon ishlamoqda
    const STEP_TIMES = [0, 3000, 6000, 9000, 13000]; // ms da qachon har step

    // Step progressini hisoblash (sahifa yangilanganda ham ishlaydi)
    function getCurrentStep(order){
      const elapsed = Date.now() - order.startAt;
      const totalMs = order.eta * 60 * 1000;
      const stepMs = totalMs / 4;
      const step = Math.min(4, Math.floor(elapsed / stepMs));
      return step;
    }

    function tick(){
      const orders = loadOrders();
      const idx = orders.findIndex(o=>o.id===orderId);
      if(idx<0) return;
      const order = orders[idx];
      if(order.done) return;

      const left = Math.max(0, order.arriveAt - Date.now());

      // Backenddagi real buyurtmani topish (kuryer statusi bo'yicha)
      let be = null;
      try{
        if(typeof STORE!=="undefined" && STORE.orders){
          be = STORE.orders().find(o=> o.user===order.user && o.item===order.label && o.amount===order.totalPrice);
        }
      }catch(e){}

      // Bosqich: backend bo'lsa real statusdan, bo'lmasa vaqt bo'yicha simulyatsiya
      let step = getCurrentStep(order);
      if(be){
        if(be.status==="new") step = 0;                             // Qabul qilindi
        else if(be.status==="accepted") step = 1;                   // Tayyorlanmoqda
        else if(be.status==="ready") step = 2;                      // Tayyor
        else if(be.status==="ontheway") step = 3;                   // Yo'lda
        else if(be.status==="arrived" || be.status==="done") step = 4; // Yetib keldi
        else step = Math.min(step, 1);
      }
      order.step = step;

      // Restoran rad etdi / buyurtma bekor qilindi — mijozga bildiramiz
      if(be && be.status==="cancelled" && !order.done){
        order.done = true;
        clearInterval(orderTimers[orderId]); delete orderTimers[orderId];
        saveOrders(loadOrders().filter(o=>o.id!==orderId));
        renderTrackerBanner(); renderCartOrders();
        const reason = be.reason || "";
        openModal(`<div style="text-align:center">
          <div style="font-size:42px">❌</div>
          <h2 style="margin:8px 0">Buyurtma bekor qilindi</h2>
          ${reason?`<p class="modal-sub">Restoran ko'rsatgan sabab:</p><p style="font-weight:700;color:var(--red);margin:6px 0 4px">${esc(reason)}</p>`:'<p class="modal-sub">Restoran buyurtmani bekor qildi.</p>'}
          <button class="btn btn-primary btn-block" id="cxOkClose" style="margin-top:12px">Tushunarli</button>
        </div>`);
        const cxb=document.getElementById("cxOkClose"); if(cxb) cxb.addEventListener("click",closeModal);
        toast("Buyurtma bekor qilindi","error");
        return;
      }

      // Yetib keldi: kuryer "Yetkazdim" (arrived) qilganda; backend bo'lmasa vaqt tugaganda
      const shouldFinish = be ? (be.status==="arrived" || be.status==="done") : (left <= 0);
      if(shouldFinish && !order.done){
        order.step = 4;
        order.done = true;
        order.backendId = be ? be.id : null;   // mijoz tasdig'i uchun
        if(be && be.courier) order.courier = be.courier;   // reyting uchun kuryer nomi
        saveOrders(orders);
        showArrivedOverlay(order);
        clearInterval(orderTimers[orderId]);
        delete orderTimers[orderId];
        renderTrackerBanner();
        renderCartOrders();
        return;
      }

      saveOrders(orders);
      renderTrackerBanner();
      renderCartOrders();

      // Agar modal ochiq bo'lsa, uni ham yangilash
      const tTimer = document.getElementById("tTimer");
      const tStatus = document.getElementById("tStatus");
      const tBar = document.getElementById("tBar");
      if(tTimer && !tTimer.classList.contains("done")){
        const m = Math.floor(left/60000);
        const s = Math.floor((left%60000)/1000);
        tTimer.textContent = String(m).padStart(2,"0")+":"+String(s).padStart(2,"0");
      }
      if(tStatus){
        const statusLabels = ["Qabul qilindi","Tayyorlanmoqda","Tayyor","Yo'lda","Yetib keldi"];
        tStatus.textContent = statusLabels[step]||"";
      }
      if(tBar){
        const steps = tBar.querySelectorAll(".track-step");
        steps.forEach((el,i)=>{
          el.classList.toggle("active", i===step);
          el.classList.toggle("done-step", i<step);
        });
      }
    }

    orderTimers[orderId] = setInterval(tick, 1000);
    tick(); // darhol
  }

  /* Sahifa yuklanganda faol orderlarni tiklash */
  function resumeOrders(){
    const orders = loadOrders();
    orders.forEach(o=>{
      if(!o.done) animateOrder(o.id);
    });
    renderTrackerBanner();
    renderCartOrders();
  }

  /* ============================================================
     TRACKER BANNER — stats-band ostida
     ============================================================ */
  function renderTrackerBanner(){
    const orders = loadOrders().filter(o=>!o.done);
    let el = document.getElementById("orderTrackerBand");

    if(!orders.length){
      if(el) el.style.display="none";
      return;
    }

    if(!el){
      el = document.createElement("div");
      el.id = "orderTrackerBand";
      const statsBand = document.querySelector(".stats-band");
      if(statsBand) statsBand.after(el);
      else document.querySelector(".hero").after(el);
    }
    el.style.display = "";

    const stepLabels = ["Qabul qilindi","Tayyorlanmoqda","Tayyor","Yo'lda","Yetib keldi 🎉"];
    const stepColors = ["#f97316","#eab308","#22c55e","#3b82f6","#16a34a"];

    el.innerHTML = `
      <div class="otb-inner">
        <div class="otb-title">🛵 Buyurtmangiz yo'lda</div>
        ${orders.map(o=>{
          const left = Math.max(0, o.arriveAt - Date.now());
          const m = Math.floor(left/60000);
          const s = Math.floor((left%60000)/1000);
          const timeStr = String(m).padStart(2,"0")+":"+String(s).padStart(2,"0");
          const pct = Math.min(100, Math.max(0, Math.round((1 - left/(o.eta*60000))*100)));
          const step = o.step || 0;
          return `
          <div class="otb-order">
            <div class="otb-order-top">
              <span class="otb-emoji">${o.emoji}</span>
              <div class="otb-info">
                <div class="otb-name">${esc(o.label)}</div>
                <div class="otb-status" style="color:${stepColors[step]}">${stepLabels[step]}</div>
              </div>
              <div class="otb-timer">${timeStr}</div>
            </div>
            <div class="otb-bar-wrap">
              <div class="otb-bar" style="width:${pct}%;background:${stepColors[step]}"></div>
            </div>
            ${step<3?`<button class="otb-cancel" data-cancel="${o.id}" style="margin-top:8px;background:#fdecec;color:#C8102E;border:none;border-radius:9px;padding:8px 12px;font-size:13px;font-weight:600;cursor:pointer">✕ Bekor qilish</button>`:""}
          </div>`;
        }).join("")}
      </div>`;
    el.querySelectorAll(".otb-cancel").forEach(b=>b.addEventListener("click",()=>confirmCancelOrder(b.dataset.cancel)));
  }

  /* Buyurtmani bekor qilish (mijoz) */
  function confirmCancelOrder(orderId){
    openModal(`<div style="text-align:center">
      <div style="font-size:42px">🛑</div>
      <h2 style="margin:8px 0">Buyurtmani bekor qilish</h2>
      <p class="modal-sub">Ushbu buyurtmani rostdan bekor qilmoqchimisiz?</p>
      <div style="display:flex;gap:10px;margin-top:8px">
        <button class="btn btn-outline btn-block" id="cxNo">Yo'q</button>
        <button class="btn btn-primary btn-block" id="cxYes" style="background:#C8102E">Ha, bekor qilish</button>
      </div></div>`);
    const no=document.getElementById("cxNo"); if(no) no.addEventListener("click",closeModal);
    const yes=document.getElementById("cxYes"); if(yes) yes.addEventListener("click",()=>{ closeModal(); cancelActiveOrder(orderId); });
  }
  function cancelActiveOrder(orderId){
    const order = loadOrders().find(o=>o.id===orderId);
    if(!order){ return; }
    let be=null;
    try{ if(typeof STORE!=="undefined" && STORE.orders){ be=STORE.orders().find(o=>o.user===order.user && o.item===order.label && o.amount===order.totalPrice); } }catch(e){}
    const beId = order.backendId || (be && be.id);
    if(beId && typeof STORE!=="undefined" && STORE.cancelOrder){ STORE.cancelOrder(beId); }
    if(orderTimers[orderId]){ clearInterval(orderTimers[orderId]); delete orderTimers[orderId]; }
    saveOrders(loadOrders().filter(o=>o.id!==orderId));
    renderTrackerBanner(); renderCartOrders();
    toast("Buyurtma bekor qilindi","success");
  }

  /* ============================================================
     SAVAT ichidagi buyurtmalar
     ============================================================ */
  function renderCartOrders(){
    // Savat drawer ichida faol buyurtmalar ko'rsatish
    let panel = document.getElementById("activeOrdersPanel");
    const orders = loadOrders().filter(o=>!o.done);

    if(!orders.length){
      if(panel) panel.remove();
      return;
    }

    if(!panel){
      panel = document.createElement("div");
      panel.id = "activeOrdersPanel";
      panel.className = "active-orders-panel";
      const drawerBody = document.getElementById("cartItems");
      if(drawerBody) drawerBody.before(panel);
    }

    const stepLabels = ["Qabul qilindi","Tayyorlanmoqda ⏳","Tayyor ✅","Yo'lda 🛵","Yetib keldi 🎉"];
    const stepColors = ["#f97316","#eab308","#22c55e","#3b82f6","#16a34a"];

    panel.innerHTML = `
      <div class="aop-title">Faol buyurtmalar</div>
      ${orders.map(o=>{
        const left = Math.max(0, o.arriveAt - Date.now());
        const m = Math.floor(left/60000);
        const s = Math.floor((left%60000)/1000);
        const timeStr = String(m).padStart(2,"0")+":"+String(s).padStart(2,"0");
        const step = o.step || 0;
        const pct = Math.min(100, Math.max(0, Math.round((1 - left/(o.eta*60000))*100)));
        return `
        <div class="aop-order">
          <div class="aop-row">
            <span class="aop-emoji">${o.emoji}</span>
            <div class="aop-info">
              <div class="aop-name">${esc(o.label)}</div>
              <div class="aop-status" style="color:${stepColors[step]}">${stepLabels[step]}</div>
            </div>
            <div class="aop-time">
              <div class="aop-timer">${timeStr}</div>
              <div class="aop-timer-label">qoldi</div>
            </div>
          </div>
          <div class="aop-progress">
            <div class="aop-progress-fill" style="width:${pct}%;background:${stepColors[step]}"></div>
          </div>
          ${step<3?`<button class="aop-cancel" data-cancel="${o.id}" style="margin-top:8px;width:100%;background:#fdecec;color:#C8102E;border:none;border-radius:9px;padding:9px 12px;font-size:13px;font-weight:700;cursor:pointer">✕ Buyurtmani bekor qilish</button>`:""}
        </div>`;
      }).join("")}
      <div class="aop-divider"></div>`;
    panel.querySelectorAll(".aop-cancel").forEach(b=>b.addEventListener("click",()=>confirmCancelOrder(b.dataset.cancel)));
  }

  /* ============================================================
     YETIB KELDI — fullscreen overlay
     ============================================================ */
  function showArrivedOverlay(order){
    let overlay = document.getElementById("arrivedOverlay");
    if(overlay) overlay.remove();

    overlay = document.createElement("div");
    overlay.id = "arrivedOverlay";
    overlay.className = "arrived-overlay";
    overlay.innerHTML = `
      <div class="arrived-card">
        <button class="arrived-close" id="arrivedClose">✕</button>
        <div class="arrived-emoji">${order.emoji}</div>
        <div class="arrived-title">Yetib keldi! 🎉</div>
        <div class="arrived-name">${esc(order.label)}</div>
        <div class="arrived-msg">Buyurtmangiz eshigingizda.<br>Qabul qildingizmi?</div>
        <button class="btn btn-primary" id="arrivedOk">Rahmat, oldim! ✓</button>
      </div>`;
    document.body.appendChild(overlay);

    const close = ()=>{
      overlay.classList.add("arrived-hide");
      setTimeout(()=>overlay.remove(), 400);
      // Done orderni listdan o'chirish
      const orders = loadOrders().filter(o=>o.id!==order.id);
      saveOrders(orders);
      renderTrackerBanner();
      renderCartOrders();
    };
    // "Rahmat, oldim" — mijoz qabul qilganini tasdiqlaydi (arrived -> done), kuryerда "Yetkazildi" bo'ladi
    const confirmAndClose = ()=>{
      if(order.backendId && typeof STORE!=="undefined" && STORE.confirmReceived){ STORE.confirmReceived(order.backendId); }
      close();
      /* Qabul qilingach — taom va kuryerни baholashni so'raymiz */
      queueRating(order);
      setTimeout(()=>askRating(), 400);
    };

    document.getElementById("arrivedClose").addEventListener("click", close);
    document.getElementById("arrivedOk").addEventListener("click", confirmAndClose);

    // Haptic feedback (mobil uchun) + qo'ng'iroqcha ovozi
    try{ navigator.vibrate && navigator.vibrate([200,100,200]); }catch(e){}
    arriveBell();
  }
  /* Yetib kelganda qo'ng'iroqcha (restoran peshtaxtasidagidek ding-ding) */
  function arriveBell(){
    try{
      const AC = window.AudioContext || window.webkitAudioContext; if(!AC) return;
      const ctx = arriveBell._c || (arriveBell._c = new AC());
      if(ctx.state==="suspended") ctx.resume();
      const t = ctx.currentTime;
      const ding = (f,at,v)=>{ const o=ctx.createOscillator(),g=ctx.createGain(); o.type="sine"; o.frequency.value=f;
        o.connect(g); g.connect(ctx.destination);
        g.gain.setValueAtTime(0.0001,t+at); g.gain.exponentialRampToValueAtTime(v,t+at+0.008); g.gain.exponentialRampToValueAtTime(0.0001,t+at+0.6);
        o.start(t+at); o.stop(t+at+0.65); };
      ding(1046.5,0,0.38); ding(1568,0,0.16); ding(1046.5,0.26,0.34); ding(1568,0.26,0.14);
    }catch(e){}
  }

  /* ============================================================
     REYTING — mijoz TAOM va KURYERni baholaydi (bitta modal, ikki qism).
     Taom bahosi -> restoran/dish (restoran+admin ko'radi); kuryer bahosi ->
     kuryer (kuryer panel+admin ko'radi). Qabul qilingach so'raladi; "keyinroq"
     bosilsa keyingi kirishda yana so'raladi. */
  const RATE_KEY = "yz_pending_ratings";
  function loadPendingRatings(){ try{ return JSON.parse(localStorage.getItem(RATE_KEY)||"[]"); }catch(e){ return []; } }
  function savePendingRatings(a){ try{ localStorage.setItem(RATE_KEY, JSON.stringify(a)); }catch(e){} }
  function orderTokenFor(id){ try{ const m=JSON.parse(localStorage.getItem("yz_order_tokens")||"{}"); return m[String(id)]||""; }catch(e){ return ""; } }
  function queueRating(order){
    const dish = (order.items && order.items[0] && order.items[0].name) || order.label || "";
    const id = order.backendId || order.id;
    const entry = { id:id, token: orderTokenFor(order.backendId), dish:dish, courier: order.courier||"", user: user.name||"Mijoz", at: Date.now() };
    const list = loadPendingRatings().filter(x=>String(x.id)!==String(id));
    list.push(entry); savePendingRatings(list);
  }
  function removePendingRating(id){ savePendingRatings(loadPendingRatings().filter(x=>String(x.id)!==String(id))); }
  function askRating(){
    if($("#modal").classList.contains("open")) return;   // boshqa modal ochiq bo'lsa keyinroq
    const list = loadPendingRatings(); if(!list.length) return;
    const e = list[0];
    const stars = ()=> [1,2,3,4,5].map(n=>`<span class="rate-star" data-n="${n}">☆</span>`).join("");
    openModal(`
      <div style="text-align:center">
        <div style="font-size:40px">⭐</div>
        <h2 style="margin:6px 0 2px">Baholang</h2>
        <p class="modal-sub" style="margin-bottom:14px">Buyurtmangiz uchun rahmat! Fikringiz muhim.</p>
        <div class="rate-block">
          <div class="rate-label">🍽️ ${esc(e.dish||"Taom")}</div>
          <div class="rate-stars" id="rateDish">${stars()}</div>
        </div>
        ${e.courier?`
        <div class="rate-block">
          <div class="rate-label">🛵 Kuryer: ${esc(e.courier)}</div>
          <div class="rate-stars" id="rateCour">${stars()}</div>
        </div>`:""}
        <textarea id="rateText" rows="2" placeholder="Izoh (ixtiyoriy)" style="width:100%;box-sizing:border-box;border:2px solid var(--line);border-radius:11px;padding:10px;font-family:inherit;font-size:14px;margin:10px 0;resize:vertical"></textarea>
        <div style="display:flex;gap:10px">
          <button class="btn btn-outline btn-block" id="rateSkip">Keyinroq</button>
          <button class="btn btn-primary btn-block" id="rateSend">Yuborish</button>
        </div>
      </div>`);
    let dishR=0, courR=0;
    const wire=(boxId, set)=>{ const box=document.getElementById(boxId); if(!box) return;
      box.querySelectorAll(".rate-star").forEach(st=>st.addEventListener("click",()=>{ const n=+st.dataset.n; set(n);
        box.querySelectorAll(".rate-star").forEach((s,i)=> s.textContent=(i<n?"★":"☆")); })); };
    wire("rateDish", n=>dishR=n);
    if(e.courier) wire("rateCour", n=>courR=n);
    const skip=document.getElementById("rateSkip"); if(skip) skip.addEventListener("click", closeModal);  // pending qoladi
    const send=document.getElementById("rateSend"); if(send) send.addEventListener("click",()=>{
      const text=(document.getElementById("rateText")||{}).value||"";
      if(!dishR && !courR){ toast("Kamida bitta baho bering","error"); return; }
      if(dishR>0 && typeof STORE!=="undefined") STORE.addReview({name:e.user, rating:dishR, dish:e.dish, text:text}, e.token);
      if(courR>0 && e.courier && typeof STORE!=="undefined") STORE.addReview({name:e.user, rating:courR, dish:"🛵 Kuryer: "+e.courier, text:text}, e.token);
      removePendingRating(e.id); closeModal(); toast("Rahmat! Bahoyingiz yuborildi ✓","success");
      try{ renderReviews(); }catch(_){}
    });
  }

  function checkout(){
    if(!cart.length){ toast(I18N.t("empty_cart"),"error"); return; }
    if(cartTotal()<MIN_ORDER){ toast(I18N.t("t_min"),"error"); return; }
    closeCart();
    if(!user.name) openAuth(()=>openOrder()); else openOrder();
  }

  /* ---------- DRAWER ---------- */
  function openCart(){ $("#cartDrawer").classList.add("open"); armBack(); }
  function closeCart(){ $("#cartDrawer").classList.remove("open"); }

  /* ---------- TOAST ---------- */
  let toastT=null;
  function toast(msg,type=""){ const el=$("#toast"); el.textContent=msg; el.className="toast show "+type;
    clearTimeout(toastT); toastT=setTimeout(()=>el.className="toast",2200); }

  /* ---------- LANG ---------- */
  function updateLangLabel(){ $("#langLabel").textContent = I18N.current()==="lat" ? "Кирил" : "Lotin"; }
  function reRender(){ buildFilters(); renderDishes(); renderAdPromo(); renderRests(); renderReviews(); updateCart(); updateLangLabel(); }

  /* ---------- REVEAL (skroll animatsiya) ---------- */
  function setupReveal(){
    const els=[...document.querySelectorAll(".section-head, .card, .rest-card, .step, .review-card, .stats")];
    if(!("IntersectionObserver" in window)) return;
    els.forEach(e=>e.classList.add("reveal"));
    const io=new IntersectionObserver((ents)=>{
      ents.forEach(en=>{ if(en.isIntersecting){ en.target.classList.add("in"); io.unobserve(en.target); } });
    },{threshold:0.12, rootMargin:"0px 0px -40px 0px"});
    els.forEach(e=>io.observe(e));
  }

  /* ---------- PROMO (restoran e'lonlari, eng yuqorida) ----------
     Soxta namuna e'lonlar YO'Q — faqat haqiqiy restoranlar joylagan e'lonlar
     (backend/localStorage) ko'rsatiladi. Hech qanaqasi bo'lmasa banner yashiriladi. */
  const DEFAULT_PROMOS=[];

  function getAllPromos(){
    let stored=[];
    try{ stored=JSON.parse(localStorage.getItem("yetkaz_announcements")||"[]"); }catch(e){}
    const be=(typeof STORE!=="undefined" && STORE.announcements)?STORE.announcements():[];
    const all=[...be, ...stored, ...DEFAULT_PROMOS].filter(p=>p&&p.text);
    /* rest+text bo'yicha takrorlanmasin (localStorage + backend) */
    const seen=new Set();
    return all.filter(p=>{ const k=(p.rest||"")+"|"+p.text; if(seen.has(k)) return false; seen.add(k); return true; });
  }

  /* Promo uchun HAQIQIY rasm topish (emoji fallback bilan):
     1) e'londa ko'rsatilgan aniq taom rasmi
     2) shu restoranning rasmi bor birinchi taomi
     3) restoran rasmi
     Hech biri bo'lmasa "" qaytadi -> emoji ko'rsatiladi. */
  function promoPhoto(p){
    try{
      const hasImg = s => /^\/uploads\/|^data:|^https?:/.test(String(s||""));
      const cat = catalog();
      if(p.dish){
        const d = cat.find(x=>x.rest===p.rest && x.name===p.dish && hasImg(x.photo));
        if(d) return d.photo;
      }
      const d2 = cat.find(x=>x.rest===p.rest && hasImg(x.photo));
      if(d2) return d2.photo;
      return restPhoto(p.rest) || "";
    }catch(e){ return ""; }
  }

  /* Chegirmali taomlarni olish */
  function getDiscountedDishes(){
    const ovr = (typeof STORE!=="undefined") ? STORE.overrides() : {discounts:{}};
    const discDishes = [];
    catalog().forEach(d=>{
      const key = d.rest+"|"+d.name;
      const pct = ovr.discounts ? (ovr.discounts[key]||0) : 0;
      if(pct>0 || d.discount>0){
        const p = pct || d.discount;
        discDishes.push({...d, discount:p, eff:Math.round(d.price*(1-p/100))});
      }
    });
    return discDishes;
  }

  /* Promo modal — e'longa bosganda */
  function openPromoModal(){
    const promos = getAllPromos();
    const discDishes = getDiscountedDishes();

    openModal(`
      <div class="promo-modal">
        <h2 style="margin-bottom:4px">🔥 Aksiyalar va chegirmalar</h2>
        <p class="modal-sub">Bugungi maxsus takliflar</p>

        ${discDishes.length ? `
        <div class="promo-section-title">🏷️ Chegirmali taomlar</div>
        <div class="promo-dishes">
          ${discDishes.map(d=>`
          <div class="promo-dish-card" data-id="${d.id}">
            <div class="pdc-img tone-${d.kw}">
              <span style="font-size:32px">${d.emoji}</span>
            </div>
            <div class="pdc-info">
              <div class="pdc-name">${esc(nm(d))}</div>
              <div class="pdc-rest">${d.rest}</div>
              <div class="pdc-prices">
                <span class="pdc-old">${fmt(d.price)}</span>
                <span class="pdc-new">${fmt(d.eff)} so'm</span>
                <span class="pdc-badge">-${d.discount}%</span>
              </div>
            </div>
            <button class="pdc-add" data-id="${d.id}">+</button>
          </div>`).join("")}
        </div>
        ` : ""}

        <div class="promo-section-title" style="margin-top:${discDishes.length?'16px':'0'}">📢 Restoranlar e'lonlari</div>
        <div class="promo-announcements">
          ${promos.map(p=>`
          <div class="promo-ann promo-ann-clickable" data-rest="${esc(p.rest)}">
            <div class="promo-ann-icon">
              ${p.img?`<img src="${p.img}" alt="" style="width:44px;height:44px;border-radius:10px;object-fit:cover;display:block">`:`<span style="font-size:28px">${p.emoji||"📢"}</span>`}
            </div>
            <div class="promo-ann-body">
              <div class="promo-ann-rest">${esc(p.rest)}</div>
              <div class="promo-ann-text">${esc(p.text)}</div>
              <div class="promo-ann-action">Restoraniga o'tish →</div>
            </div>
            ${p.tag?`<span class="promo-ann-tag">${p.tag}</span>`:""}
          </div>`).join("")}
        </div>
      </div>`);

    /* Chegirmali taomlarni savatga qo'shish */
    document.querySelectorAll(".pdc-add").forEach(btn=>{
      btn.addEventListener("click",(e)=>{
        e.stopPropagation();
        const id = +btn.dataset.id;
        const d = catalog().find(x=>x.id===id);
        if(d){ addToCart(d); updateAllCards(); btn.textContent="✓"; btn.style.background="var(--green)"; }
      });
    });
    document.querySelectorAll(".promo-dish-card").forEach(card=>{
      card.addEventListener("click",(e)=>{
        if(e.target.classList.contains("pdc-add")) return; // add tugmasi uchun
        const id = +card.dataset.id;
        const d = catalog().find(x=>x.id===id);
        if(d){ closeModal(); setTimeout(()=>openDishModal(d),150); }
      });
    });

    /* E'lon bandiga bosganda — restoran yoki taomga scroll */
    document.querySelectorAll(".promo-ann").forEach(ann=>{
      ann.style.cursor="pointer";
      ann.addEventListener("click",()=>{
        const restName = ann.dataset.rest;
        if(!restName){ closeModal(); return; }
        const rest = RESTAURANTS.find(r=>r.name===restName);
        if(rest){
          closeModal();
          setTimeout(()=>{ location.hash="restoran/"+rest.id; },150);
        } else {
          closeModal();
          // Restoran topilmasa — taomlar bo'limiga scroll
          setTimeout(()=>{
            const el=document.getElementById("dishes");
            if(el) el.scrollIntoView({behavior:"smooth"});
          },150);
        }
      });
    });
  }

  function loadPromos(){
    const promos = getAllPromos();
    const bar = document.getElementById("promoBar");
    if(!bar) return;
    const slidesEl = document.getElementById("pbSlides");
    if(!slidesEl) return;

    if(!promos.length){ bar.style.display="none"; return; }
    bar.style.display="";

    /* Slayder */
    let cur=0;
    function renderSlide(){
      const p = promos[cur % promos.length];
      /* Chegirma-badge — faqat tag bo'lsa ko'rsatiladi (masalan "15% OFF", "BEPUL") */
      const badge = p.tag ? `<span class="ph-badge">${esc(p.tag)}</span>` : "";
      /* Haqiqiy taom/restoran rasmi (bo'lmasa emoji ko'rsatiladi) */
      const photo = promoPhoto(p);
      const photoInner = `<span class="ph-emoji">${p.emoji||"🍽️"}</span>` +
        (photo ? `<img class="ph-img" src="${photo}" alt="${esc(p.rest)}" onerror="this.remove()">` : "");
      /* Butun hero kartasi bosilganda — mavjud promo modal ochiladi (yangi funksiya yo'q) */
      slidesEl.innerHTML=`
        <div class="ph-card">
          <div class="ph-left">
            <span class="ph-tag">${p.emoji||"🔥"} AKSIYA</span>
            <h3 class="ph-title">${esc(p.rest)||"Yetkaz.uz"}</h3>
            <p class="ph-desc">${esc(p.text)}</p>
            <div class="ph-actions">
              <button class="ph-cta" type="button">Buyurtma berish</button>
              <button class="ph-icon" type="button" aria-label="Batafsil">→</button>
            </div>
          </div>
          <div class="ph-right">
            <div class="ph-photo">${photoInner}</div>
            ${badge}
          </div>
        </div>`;
    }
    renderSlide();
    const iv = setInterval(()=>{
      slidesEl.style.opacity="0";
      setTimeout(()=>{ cur++; renderSlide(); slidesEl.style.opacity="1"; },350);
    },4500);

    /* Bosganda modal */
    slidesEl.addEventListener("click", openPromoModal);

    /* Yopish */
    const cl=document.getElementById("pbClose");
    if(cl) cl.addEventListener("click",(e)=>{
      e.stopPropagation();
      clearInterval(iv);
      bar.style.display="none";
    });
  }

  /* ---------- REKLAMA BANNERI (asosiy bo'limlardan keyin, bir marta) ----------
     Chapda sarlavha + "Batafsil", o'ngda dinamik reklama rasmi (announcements/
     discounts manbasidan), pastida to'lqin. Tagida shu aksiya/chegirma taomlari
     yangi yoysimon kartochkalarda, foni navbatma-navbat olovrang palitrada. */
  let adPromoTimer = null;
  function renderAdPromo(){
    const sec = document.getElementById("adPromo");
    if(!sec) return;
    if(adPromoTimer){ clearInterval(adPromoTimer); adPromoTimer=null; }
    const promos = getAllPromos();
    const disc   = getDiscountedDishes();
    if(!promos.length && !disc.length){ sec.style.display="none"; sec.innerHTML=""; return; }
    sec.style.display="";

    /* Reklamalar ro'yxati — bittadan ko'p bo'lsa slider sekin almashadi */
    const list = promos.length ? promos
      : [{rest:"Yetkaz.uz", text:"Bugungi maxsus takliflar sizni kutmoqda!", tag:"AKSIYA", emoji:"🔥"}];

    const slideHtml = (p)=>{
      /* Rasm: avval restoran yuklagan e'lon rasmi (p.img), bo'lmasa taom/restoran rasmi */
      const photo = p.img || promoPhoto(p);
      const photoInner = `<span class="apb-emoji">${p.emoji||"🔥"}</span>` +
        (photo ? `<img class="apb-img" src="${photo}" alt="${esc(p.rest||"")}" onerror="this.remove()">` : "");
      return `
        <div class="apb-slide">
          <div class="apb-left">
            <span class="apb-tag">${p.emoji||"🔥"} ${esc(p.tag||"AKSIYA")}</span>
            <h2 class="apb-title">${esc(p.text)}</h2>
            ${p.rest?`<div class="apb-rest">🏪 ${esc(p.rest)}</div>`:""}
            ${p.dish?`<div class="apb-dish">🍽️ ${esc(p.dish)}</div>`:""}
            <button class="apb-cta" type="button">Batafsil →</button>
          </div>
          <div class="apb-right">
            <div class="apb-photo">${photoInner}</div>
          </div>
        </div>`;
    };
    const dots = list.length>1
      ? `<div class="apb-dots">${list.map((_,i)=>`<span${i===0?' class="on"':''}></span>`).join("")}</div>` : "";

    /* Tagidagi kartalar: avval chegirmali taomlar; bo'lmasa 1-reklama restoranining taomlari */
    let cards = disc;
    if(!cards.length) cards = catalog().filter(x=>x.rest===list[0].rest).slice(0,4);

    sec.innerHTML = `
      <div class="container">
        <div class="adpromo-banner${list.length>1?' has-slider':''}">
          <div class="apb-slider">${list.map(slideHtml).join("")}</div>
          ${dots}
          <svg class="apb-wave" viewBox="0 0 1440 44" preserveAspectRatio="none" aria-hidden="true">
            <path d="M0,12 C160,46 340,-4 540,18 C740,40 940,44 1140,20 C1270,6 1360,10 1440,24 L1440,44 L0,44 Z" fill="rgba(255,255,255,.24)"/>
          </svg>
        </div>
        ${cards.length?`<div class="grid dishes-grid adpromo-grid" id="adPromoGrid"></div>`:""}
      </div>`;

    /* Slider mantiqi */
    const slides = [...sec.querySelectorAll(".apb-slide")];
    const dotEls = [...sec.querySelectorAll(".apb-dots span")];
    let cur = 0;
    slides.forEach((s,i)=>s.classList.toggle("active", i===0));
    function go(i){
      if(!slides.length) return;
      slides[cur].classList.remove("active"); if(dotEls[cur]) dotEls[cur].classList.remove("on");
      cur = (i+slides.length)%slides.length;
      slides[cur].classList.add("active"); if(dotEls[cur]) dotEls[cur].classList.add("on");
    }
    if(slides.length>1){
      adPromoTimer = setInterval(()=>go(cur+1), 5000);
      dotEls.forEach((d,i)=>d.addEventListener("click",()=>{ go(i); }));
    }

    sec.querySelectorAll(".apb-cta").forEach(b=>b.addEventListener("click", openPromoModal));
    const grid = sec.querySelector("#adPromoGrid");
    if(grid) cards.forEach((d,i)=>{ const card = makeDishCard(d); card.classList.add("apd-"+(i%3)); grid.appendChild(card); });
  }

  /* ============================================================
     YO'L KO'RSATKICH (guided tour) — CapCut uslubida: qorong'i fon + spotlight
     (yoritilgan element) + tooltip karta ("bu yerni bosing"). O'zbek tilida.
     ============================================================ */
  const TOUR_STEPS = [
    { sel:()=>"#dishSearch",  title:"🔍 1. Qidiruv",       text:"Bu yerga taom yoki restoran nomini yozib tez toping.", before:()=>{ try{ closeCart(); }catch(e){} } },
    { sel:()=>"#dishFilters", title:"🍽️ 2. Kategoriyalar", text:"Milliy, Fastfood, Shirinlik, Ichimlik — kerakli turni shu yerdan tanlang." },
    { sel:()=>"#dishesGrid",  title:"➕ 3. Savatga qo'shish", text:"Yoqqan taomdagi qizil «+» tugmasini bosing — taom savatga qo'shiladi va savat ikonkasiga uchib boradi. Bir nechta taom qo'shsangiz bo'ladi." },
    { sel:()=> (window.innerWidth<=768 ? "#mbbCart" : "#cartBtn"), title:"🛒 4. Savatni ochish", text:"Qo'shgan taomlaringizni ko'rish uchun shu savat tugmasini bosing.", before:()=>{ try{ closeCart(); }catch(e){} } },
    { sel:()=>"#cartItems",    title:"🧺 5. Savat ichi",    text:"Bu yerda taomlar ro'yxati. «−» va «+» bilan sonini o'zgartirasiz, jami summa pastda ko'rinadi.", before:()=>{ try{ openCart(); }catch(e){} } },
    { sel:()=>"#checkoutBtn",  title:"✅ 6. Buyurtma berish", text:"«Buyurtma berish» tugmasini bosing → ism, telefon va manzilni kiriting → to'lovni tanlab tasdiqlang. Buyurtma darhol restoranga yuboriladi!", before:()=>{ try{ openCart(); }catch(e){} } },
  ];
  function startTour(){
    if(document.getElementById("yzTour")) return;
    let i=0;
    const ov=document.createElement("div"); ov.id="yzTour";
    ov.innerHTML='<div class="yz-tour-hole"></div><div class="yz-tour-tip"></div>';
    document.body.appendChild(ov);
    const hole=ov.querySelector(".yz-tour-hole"), tip=ov.querySelector(".yz-tour-tip");
    function end(){ try{ ov.remove(); }catch(e){} try{ closeCart(); }catch(e){} toast("Tayyor! Endi buyurtma berishingiz mumkin 🎉","success"); }
    function next(){ i++; if(i>=TOUR_STEPS.length){ end(); return; } show(); }
    function show(){
      const step=TOUR_STEPS[i];
      if(step.before){ try{ step.before(); }catch(e){} }
      const sel=typeof step.sel==="function"?step.sel():step.sel;
      const el=document.querySelector(sel);
      if(!el){ next(); return; }
      el.scrollIntoView({behavior:"smooth", block:"center"});
      setTimeout(()=>{
        const r=el.getBoundingClientRect();
        hole.style.cssText="position:fixed;left:"+(r.left-8)+"px;top:"+(r.top-8)+"px;width:"+(r.width+16)+"px;height:"+(r.height+16)+"px;border-radius:14px;box-shadow:0 0 0 9999px rgba(0,0,0,.62);border:2px solid #fff;transition:.28s ease;z-index:100000;pointer-events:none";
        const below = (r.bottom+170) < window.innerHeight;
        tip.innerHTML='<div class="yz-tour-card"><h4>'+step.title+'</h4><p>'+step.text+'</p>'+
          '<div class="yz-tour-actions"><span class="yz-tour-count">'+(i+1)+' / '+TOUR_STEPS.length+'</span>'+
          '<span><button class="yz-tour-skip">Yopish</button><button class="yz-tour-next">'+(i<TOUR_STEPS.length-1?"Keyingi →":"Tugatish ✓")+'</button></span></div></div>';
        tip.style.cssText="position:fixed;z-index:100001;left:50%;transform:translateX(-50%);width:min(360px,92vw);"+(below?("top:"+(r.bottom+14)+"px"):("bottom:"+(window.innerHeight-r.top+14)+"px"));
        tip.querySelector(".yz-tour-next").addEventListener("click",next);
        tip.querySelector(".yz-tour-skip").addEventListener("click",end);
      },380);
    }
    show();
  }

  /* ---------- INIT ---------- */
  function init(){
    I18N.apply(); updateLangLabel();
    loadPromos();
    buildHero(); buildFilters(); renderDishes(); renderAdPromo(); renderRests(); renderReviews(); updateCart();
    resumeOrders(); // Sahifa yangilanganda faol buyurtmalarni tiklash
    setTimeout(askRating, 1800); // keyingi kirishda baholanmagan buyurtma bo'lsa so'raymiz

    $("#langToggle").addEventListener("click",()=>{ I18N.toggle(); I18N.apply(); reRender(); });
    $("#cartBtn").addEventListener("click",openCart);
    $("#cartClose").addEventListener("click",closeCart);
    $("#checkoutBtn").addEventListener("click",checkout);
    $("#loginBtn").addEventListener("click",openLogin);
    $("#modalClose").addEventListener("click",closeModal);
    $("#modalBackdrop").addEventListener("click",closeModal);
    $("#heroSearchBtn").addEventListener("click",()=>document.getElementById("dishes").scrollIntoView({behavior:"smooth"}));
    const heroFreeEl=$("#heroFree");
    if(heroFreeEl) heroFreeEl.addEventListener("click",()=>{
      openModal(`<div style="text-align:center">
        <div style="font-size:46px">🛵</div>
        <h2 style="margin:8px 0;color:#16a34a">Bepul va tez yetkazib berish!</h2>
        <div style="background:#eafaf0;border:1px solid #bdebd0;border-radius:12px;padding:12px;margin:8px 0;color:#16a34a;font-weight:700">🎉 Aksiya doirasida yetkazib berish BEPUL</div>
        <div style="text-align:left;color:var(--ink);font-size:14px;line-height:1.8;margin-top:6px">
          🕒 O'rtacha yetkazish vaqti: <b>15–25 daqiqa</b>.<br>
          💰 Aksiya kunlari yetkazib berish <b>butunlay bepul</b>.<br>
          🛵 Eng yaqin va bo'sh kuryer <b>avtomatik</b> biriktiriladi.<br>
          📦 Buyurtmani jonli kuzatasiz: qabul → tayyor → yo'lda → yetdi.<br>
          ✅ Yetib kelganда "Oldim, rahmat" tugmasi bilan tasdiqlaysiz.
        </div>
        <button class="btn btn-primary btn-block" id="hfCloseBtn" style="margin-top:14px">Tushunarli</button>
      </div>`);
      const hb=document.getElementById("hfCloseBtn"); if(hb) hb.addEventListener("click",closeModal);
    });
    /* Qidiruv — debounce (250ms). Kategoriya filtri bilan birga ishlaydi. */
    const dsEl=$("#dishSearch");
    if(dsEl){ let dsT=null; dsEl.addEventListener("input",()=>{ searchQ=dsEl.value; clearTimeout(dsT); dsT=setTimeout(renderDishes,250); }); }
    /* Backend ma'lumoti kelганда/yangilanганда taom va izohlarni qayta chizamiz
       (chegirma, "tugagan", yangi izohlar darhol ko'rinsin) */
    if(typeof STORE!=="undefined" && STORE.onChange){ STORE.onChange(()=>{ try{ renderDishes(); renderAdPromo(); renderRests(); renderReviews(); }catch(e){} }); }
    $("#navBurger").addEventListener("click",()=>$("#mainNav").classList.toggle("open"));
    $$("#mainNav a").forEach(a=>a.addEventListener("click",()=>$("#mainNav").classList.remove("open")));

    // onboarding (yangi foydalanuvchi yo'l ko'rsatkichi)
    const onb=$("#onboard"); setTimeout(()=>onb.classList.add("show"),1200);
    $("#onbSkip").addEventListener("click",()=>onb.classList.remove("show"));
    $("#onbStart").addEventListener("click",()=>{ onb.classList.remove("show");
      document.getElementById("dishes").scrollIntoView({behavior:"smooth"}); setTimeout(startTour, 700); });

    // 4-qadam: animatsiya va skroll
    setupReveal();
    const hdr=$("#header"), tt=$("#toTop");
    window.addEventListener("scroll",()=>{
      const y=window.scrollY||window.pageYOffset||0;
      if(hdr) hdr.classList.toggle("scrolled", y>20);
      if(tt) tt.classList.toggle("show", y>520);
    });
    if(tt) tt.addEventListener("click",()=>window.scrollTo({top:0,behavior:"smooth"}));

    window.addEventListener("hashchange",handleHash);
    handleHash();
  }
  document.addEventListener("DOMContentLoaded",init);
})();
