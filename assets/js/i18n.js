/* ===== Yetkaz.uz — Lotin/Kiril tarjima ===== */
const I18N = (function(){
  const DICT = {
    lat:{
      nav_restaurants:"Restoranlar", nav_dishes:"Taomlar", nav_about:"Sayt haqida",
      cart:"Savat", login:"Kirish",
      hero_kicker:"Navoiy, Xatirchi bo'ylab yetkazib beramiz",
      hero_w1:"Mazza.", hero_w2:"Tezlik.", hero_w3:"Yetkaz",
      hero_sub:"Yoqtirgan taomingizni tanlang — biz eshigingizgacha yetkazamiz.",
      search_ph:"Taom yoki restoran qidiring...", order_start:"Buyurtmani boshlash",
      dishes_title:"Mashhur taomlar", dishes_sub:"Eng ko'p buyurtma qilinadigan, ishtahani ochadigan taomlar",
      rest_title:"Eng yaqin restoran va kafelar", rest_sub:"Sizga yaqin joylardan tez yetkazib berish",
      about_title:"Yetkaz qanday ishlaydi?", about_sub:"Atigi 4 qadam — va taom eshigingizda",
      step1_t:"Taom tanlang", step1_d:"Yaqin atrofdagi restoranlarni ochib, yoqtirgan taomingizni tanlang va \"+\" tugmasi bilan savatga qo'shing. Bir nechta taom qo'shishingiz mumkin.",
      step2_t:"Ma'lumot kiriting", step2_d:"Ism, telefon raqamingiz va aniq yetkazish manzilingizni kiriting. Joylashuvni avtomatik aniqlash tugmasidan ham foydalanishingiz mumkin.",
      step3_t:"Buyurtma bering", step3_d:"To'lov usulini tanlang (naqd yoki karta, minimal 20 000 so'm) va buyurtmani tasdiqlang — u darhol restoranga yuboriladi.",
      step4_t:"Kuzatib boring", step4_d:"Buyurtmangiz jonli kuzatiladi: qabul qilindi → tayyorlanmoqda → yo'lda → yetib keldi. Yetganda \"Qabul qildim\" bilan tasdiqlaysiz.",
      footer_about:"Navoiy, Xatirchi bo'ylab tez va ishonchli ovqat yetkazib berish xizmati.",
      footer_owner:"Sayt egasi", footer_partners:"Hamkor restoranlar", footer_join:"Biz bilan ishlang",
      footer_courier:"Kuryer bo'lib ishlash", footer_addrest:"Restoran qo'shish",
      footer_terms:"Foydalanish shartlari", footer_admin:"Admin panel", footer_cabinet:"Mening kabinetim", footer_contact:"Aloqa", footer_rights:"Barcha huquqlar himoyalangan",
      cart_title:"Savatingiz", total:"Jami", sum:"so'm", min_note:"Minimal buyurtma: 20 000 so'm",
      checkout:"Buyurtma berish",
      onb_title:"Xush kelibsiz! 👋",
      onb_text:"Yetkaz'da birinchi marta? Buyurtma berish juda oson — taom tanlang, savatga qo'shing va manzilingizni kiriting. Boshlaymizmi?",
      onb_skip:"Keyinroq", onb_start:"Ko'rsatmani ko'rish",
      /* app.js */
      login_title:"Ro'yxatdan o'tish / Kirish", login_sub:"Buyurtma berish uchun ma'lumotlaringizni kiriting",
      lbl_name:"Ismingiz", lbl_phone:"Telefon raqami", lbl_address:"Yetkazish manzili",
      ph_name:"Masalan: Fayozbek", ph_phone:"+998 90 123 45 67", ph_address:"Masalan: Xatirchi, ko'cha, uy, kvartira...",
      continue:"Davom etish", order_title:"Buyurtmani tasdiqlash",
      pay_card:"Karta", pay_cash:"Naqd", paymethod:"To'lov usuli",
      sum_items:"Taomlar", sum_delivery:"Yetkazish", sum_total:"Jami to'lov", place_order:"Buyurtmani tasdiqlash",
      err_name:"Ismingizni kiriting", err_phone:"To'g'ri telefon raqam kiriting",
      err_address:"Manzilni kiriting",
      err_min:"Minimal buyurtma 20 000 so'm bo'lishi kerak",
      debt_warn:"Sizda to'lanmagan qarz yo'q ✓",
      track_title:"Buyurtmangiz qabul qilindi!",
      st_accepted:"Qabul qilindi", st_cooking:"Tayyorlanmoqda", st_ready:"Tayyor",
      st_ontheway:"Yo'lda", st_arrived:"Yetib keldi",
      track_eta:"Yetib borish vaqti", min_short:"daqiqa",
      arrived_msg:"Buyurtmangiz yetkazildi. Yoqimli ishtaha! 🎉",
      empty_cart:"Savatingiz bo'sh", empty_hint:"Taomlardan tanlab qo'shing",
      t_added:"Savatga qo'shildi", t_min:"Minimal buyurtma 20 000 so'm", t_ordered:"Buyurtma qabul qilindi!",
      delivery_free_soon:"Bepul yetkazish yaqin orada",
      new_user:"Yangi foydalanuvchi", rating:"reyting", min_eta:"daq",
      order_now:"Buyurtma", view_menu:"Menyuni ko'rish",
      free:"Bepul", free_delivery:"Tez yetkazib berish", footer_team:"Yetkaz jamoasi",
      orders_word:"buyurtma", reviews_title:"Mijozlar fikri", reviews_sub:"Haqiqiy buyurtmalardan haqiqiy izohlar", nav_reviews:"Izohlar", back:"Orqaga", open_now:"Hozir ochiq", rest_menu:"Menyu",
      stat_rest:"Restoran", stat_dish:"Taom turi", stat_eta:"daqiqada yetkazish", stat_rating:"o'rtacha reyting"
    },
    cyr:{
      nav_restaurants:"Ресторанлар", nav_dishes:"Таомлар", nav_about:"Сайт ҳақида",
      cart:"Сават", login:"Кириш",
      hero_kicker:"Навоий, Хатирчи бўйлаб етказиб берамиз",
      hero_w1:"Мазза.", hero_w2:"Тезлик.", hero_w3:"Етказ",
      hero_sub:"Ёқтирган таомингизни танланг — биз эшигингизгача етказамиз.",
      search_ph:"Таом ёки ресторан қидиринг...", order_start:"Буюртмани бошлаш",
      dishes_title:"Машҳур таомлар", dishes_sub:"Энг кўп буюртма қилинадиган, иштаҳани очадиган таомлар",
      rest_title:"Энг яқин ресторан ва кафелар", rest_sub:"Сизга яқин жойлардан тез етказиб бериш",
      about_title:"Yetkaz қандай ишлайди?", about_sub:"Атиги 4 қадам — ва таом эшигингизда",
      step1_t:"Таом танланг", step1_d:"Ресторан ёки таомни танлаб саватга қўшинг.",
      step2_t:"Рўйхатдан ўтинг", step2_d:"Исм, телефон ва манзилингизни киритинг.",
      step3_t:"Буюртма беринг", step3_d:"Тўлов усулини танланг (мин. 20 000 сўм).",
      step4_t:"Кузатинг", step4_d:"Таймер ва статус орқали буюртмани кузатинг.",
      footer_about:"Навоий, Хатирчи бўйлаб тез ва ишончли овқат етказиб бериш хизмати.",
      footer_owner:"Сайт эгаси", footer_partners:"Ҳамкор ресторанлар", footer_join:"Биз билан ишланг",
      footer_courier:"Курьер бўлиб ишлаш", footer_addrest:"Ресторан қўшиш",
      footer_terms:"Фойдаланиш шартлари", footer_admin:"Админ панел", footer_cabinet:"Менинг кабинетим", footer_contact:"Алоқа", footer_rights:"Барча ҳуқуқлар ҳимояланган",
      cart_title:"Саватингиз", total:"Жами", sum:"сўм", min_note:"Минимал буюртма: 20 000 сўм",
      checkout:"Буюртма бериш",
      onb_title:"Хуш келибсиз! 👋",
      onb_text:"Yetkaz'да биринчи марта? Буюртма бериш жуда осон — таом танланг, саватга қўшинг ва манзилингизни киритинг. Бошлаймизми?",
      onb_skip:"Кейинроқ", onb_start:"Кўрсатмани кўриш",
      login_title:"Рўйхатдан ўтиш / Кириш", login_sub:"Буюртма бериш учун маълумотларингизни киритинг",
      lbl_name:"Исмингиз", lbl_phone:"Телефон рақами", lbl_address:"Етказиш манзили",
      ph_name:"Масалан: Фаёзбек", ph_phone:"+998 90 123 45 67", ph_address:"Масалан: Хатирчи, кўча, уй, квартира...",
      continue:"Давом этиш", order_title:"Буюртмани тасдиқлаш",
      pay_card:"Карта", pay_cash:"Нақд", paymethod:"Тўлов усули",
      sum_items:"Таомлар", sum_delivery:"Етказиш", sum_total:"Жами тўлов", place_order:"Буюртмани тасдиқлаш",
      err_name:"Исмингизни киритинг", err_phone:"Тўғри телефон рақам киритинг",
      err_address:"Манзилни киритинг",
      err_min:"Минимал буюртма 20 000 сўм бўлиши керак",
      debt_warn:"Сизда тўланмаган қарз йўқ ✓",
      track_title:"Буюртмангиз қабул қилинди!",
      st_accepted:"Қабул қилинди", st_cooking:"Тайёрланмоқда", st_ready:"Тайёр",
      st_ontheway:"Йўлда", st_arrived:"Етиб келди",
      track_eta:"Етиб бориш вақти", min_short:"дақиқа",
      arrived_msg:"Буюртмангиз етказилди. Ёқимли иштаҳа! 🎉",
      empty_cart:"Саватингиз бўш", empty_hint:"Таомлардан танлаб қўшинг",
      t_added:"Саватга қўшилди", t_min:"Минимал буюртма 20 000 сўм", t_ordered:"Буюртма қабул қилинди!",
      delivery_free_soon:"Бепул етказиш яқин орада",
      new_user:"Янги фойдаланувчи", rating:"рейтинг", min_eta:"дақ",
      order_now:"Буюртма", view_menu:"Менюни кўриш",
      free:"Бепул", free_delivery:"Тез етказиб бериш", footer_team:"Yetkaz жамоаси",
      orders_word:"буюртма", reviews_title:"Мижозлар фикри", reviews_sub:"Ҳақиқий буюртмалардан ҳақиқий изоҳлар", nav_reviews:"Изоҳлар", back:"Орқага", open_now:"Ҳозир очиқ", rest_menu:"Меню",
      stat_rest:"Ресторан", stat_dish:"Таом тури", stat_eta:"дақиқада етказиш", stat_rating:"ўртача рейтинг"
    }
  };
  let lang = "lat";
  function t(key){ return (DICT[lang] && DICT[lang][key]) || (DICT.lat[key]||key); }
  function apply(){
    document.querySelectorAll("[data-i18n]").forEach(el=>{ el.textContent = t(el.getAttribute("data-i18n")); });
    document.querySelectorAll("[data-i18n-ph]").forEach(el=>{ el.setAttribute("placeholder", t(el.getAttribute("data-i18n-ph"))); });
    document.documentElement.setAttribute("lang", lang==="lat"?"uz":"uz-Cyrl");
  }
  function toggle(){ lang = (lang==="lat")?"cyr":"lat"; apply(); return lang; }
  function current(){ return lang; }
  return { t, apply, toggle, current };
})();

/* ===== Kabinet uchun kengaytirilgan tarjima ===== */
(function(){
  /* Kabinet matnlari */
  const KAB = {
    lat:{
      taomlar:"Taomlar", profil:"Mening kabinetim", rests:"Restoranlar",
      review:"Izoh qoldirish", help:"Qanday buyurtma berish",
      hammasi:"Hammasi", fastfood:"Fastfood", milliy:"Milliy",
      ichimlik:"Ichimlik", shirinlik:"Shirinlik",
      restoranlar_chip:"🏪 Restoranlar",
      savat_bosh:"🛒 Savatingiz bo'sh",
      savat_bosh_hint:"Quyidagi taomlardan tanlang",
      jami:"Jami", yetkazish:"Yetkazish", bepul:"🛵 Bepul",
      minimal_warn:"⚠️ Minimal 20 000 so'm (yana {n} so'm)",
      minimal_ok:"✅ Yetkazish bepul 🛵",
      buyurtma_berish:"Buyurtma berish",
      savatga_qoshildi:"Savatga qo'shildi",
      buyurtma_title:"📋 Buyurtma",
      buyurtma_sub:"Ma'lumotlarni to'ldiring",
      ism:"Ismingiz", tel:"Telefon raqam",
      manzil:"Yetkazish manzili", tolov:"To'lov usuli",
      karta:"💳 Karta", naqd:"💵 Naqd",
      taomlar_count:"ta", tasdiq:"✅ Buyurtmani tasdiqlash",
      qabul:"Buyurtma qabul qilindi!",
      ok_btn:"Tushunarli, yopish",
      yetib_keldi:"Yetib keldi! 🎉",
      mazali:"Buyurtmangiz eshigingizda.\nOvqatingiz mazali bo'lsin!",
      rahmat:"Rahmat!",
      aksiyalar:"🔥 Aksiyalar", bugungi:"Bugungi maxsus takliflar",
      chegirmali:"🏷️ Chegirmali taomlar", elonlar:"📢 E'lonlar",
      restoranga:"Restoraniga o'tish →",
      buyurtmalar_tarixi:"Buyurtmalar tarixi",
      izohlarim:"Mening izohlarim",
      izoh_qoldirish_btn:"Izohni yuborish",
      onl:"● Online", chiqish:"← Chiqish",
      qidirish:"🔍 Restoran qidirish...",
      daq:"daq", yulduz:"★",
    },
    cyr:{
      taomlar:"Таомлар", profil:"Менинг кабинетим", rests:"Ресторанлар",
      review:"Изоҳ қолдириш", help:"Қандай буюртма бериш",
      hammasi:"Ҳаммаси", fastfood:"Фастфуд", milliy:"Миллий",
      ichimlik:"Ичимлик", shirinlik:"Ширинлик",
      restoranlar_chip:"🏪 Ресторанлар",
      savat_bosh:"🛒 Саватингиз бўш",
      savat_bosh_hint:"Қуйидаги таомлардан танланг",
      jami:"Жами", yetkazish:"Етказиш", bepul:"🛵 Бепул",
      minimal_warn:"⚠️ Минимал 20 000 сўм (яна {n} сўм)",
      minimal_ok:"✅ Етказиш бепул 🛵",
      buyurtma_berish:"Буюртма бериш",
      savatga_qoshildi:"Саватга қўшилди",
      buyurtma_title:"📋 Буюртма",
      buyurtma_sub:"Маълумотларни тўлдиринг",
      ism:"Исмингиз", tel:"Телефон рақами",
      manzil:"Етказиш манзили", tolov:"Тўлов усули",
      karta:"💳 Карта", naqd:"💵 Нақд",
      taomlar_count:"та", tasdiq:"✅ Буюртмани тасдиқлаш",
      qabul:"Буюртма қабул қилинди!",
      ok_btn:"Тушунарли, ёпиш",
      yetib_keldi:"Етиб келди! 🎉",
      mazali:"Буюртмангиз эшигингизда.\nОвқатингиз мазали бўлсин!",
      rahmat:"Раҳмат!",
      aksiyalar:"🔥 Акциялар", bugungi:"Бугунги махсус таклифлар",
      chegirmali:"🏷️ Чегирмали таомлар", elonlar:"📢 Эълонлар",
      restoranga:"Ресторанига ўтиш →",
      buyurtmalar_tarixi:"Буюртмалар тарихи",
      izohlarim:"Менинг изоҳларим",
      izoh_qoldirish_btn:"Изоҳни юбориш",
      onl:"● Онлайн", chiqish:"← Чиқиш",
      qidirish:"🔍 Ресторан қидириш...",
      daq:"дақ", yulduz:"★",
    }
  };

  /* Kabinet uchun tarjima funksiyasi */
  window.KT = function(key, vars){
    const lang = localStorage.getItem('yz_lang')||'lat';
    const dict = KAB[lang]||KAB.lat;
    let str = dict[key]||KAB.lat[key]||key;
    if(vars) Object.keys(vars).forEach(k=>{ str=str.replace('{'+k+'}',vars[k]); });
    return str;
  };

  /* DOM elementlarini yangilash */
  window.KT_APPLY = function(){
    const lang = localStorage.getItem('yz_lang')||'lat';
    const dict = KAB[lang]||KAB.lat;

    /* data-kt atributli elementlarni yangilash */
    document.querySelectorAll('[data-kt]').forEach(el=>{
      const key=el.getAttribute('data-kt');
      if(dict[key]) el.textContent=dict[key];
    });
    document.querySelectorAll('[data-kt-ph]').forEach(el=>{
      const key=el.getAttribute('data-kt-ph');
      if(dict[key]) el.placeholder=dict[key];
    });

    /* Sidebar links */
    const links={taomlar:'taomlar',profil:'profil',rests:'rests',review:'review',help:'help'};
    Object.keys(links).forEach(view=>{
      const el=document.querySelector('.sb-link[data-view="'+view+'"] .ic-label');
      if(el && dict[view]) el.textContent=dict[view];
    });

    /* Topbar title */
    const tb=document.getElementById('tbTitle');
    if(tb){
      const cur=document.querySelector('.sb-link.active');
      const view=cur&&cur.dataset.view;
      if(view && dict[view]) tb.textContent=dict[view];
    }

    /* Online badge */
    const badge=document.querySelector('.tb-badge');
    if(badge && dict.onl) badge.textContent=dict.onl;

    /* Chiqish tugmasi */
    const logout=document.getElementById('logoutBtn');
    if(logout && dict.chiqish) logout.textContent=dict.chiqish;

    /* Chip kategoriyalar */
    const chips=document.querySelectorAll('#kFilters .kchip');
    chips.forEach(ch=>{
      const c=ch.dataset.c;
      if(!c) return;
      if(c==='Hammasi'||c==='Ҳаммаси') ch.textContent=dict.hammasi;
      else if(c==='Fastfood'||c==='Фастфуд') ch.textContent=dict.fastfood;
      else if(c==='Milliy'||c==='Миллий') ch.textContent=dict.milliy;
      else if(c==='Ichimlik'||c==='Ичимлик') ch.textContent=dict.ichimlik;
      else if(c==='Shirinlik'||c==='Ширинлик') ch.textContent=dict.shirinlik;
      else if(c.includes('Restoran')||c.includes('Ресторан')) ch.textContent=dict.restoranlar_chip;
    });

    /* Taom nomlari (nameCyr) */
    if(typeof DISHES!=='undefined'){
      document.querySelectorAll('#kMenu .kcard').forEach(card=>{
        const id=+card.dataset.id;
        const d=DISHES.find(x=>x.id===id);
        if(!d) return;
        const h4=card.querySelector('h4');
        if(h4) h4.textContent=(lang==='cyr'&&d.nameCyr)?d.nameCyr:d.name;
      });
    }

    /* Restoran nomlari */
    if(typeof RESTAURANTS!=='undefined'){
      document.querySelectorAll('#kRestGrid .krest-card').forEach(card=>{
        const rname=card.dataset.rest;
        const r=RESTAURANTS.find(x=>x.name===rname);
        if(!r) return;
        const h3=card.querySelector('h3');
        if(h3) h3.textContent=(lang==='cyr'&&r.nameCyr)?r.nameCyr:r.name;
      });
    }

    /* Savat drawer */
    const drHead=document.querySelector('.kab-dr-head h3');
    if(drHead) drHead.textContent='🛒 '+(lang==='cyr'?'Саватингиз':'Savatingiz');

    /* Rests qidiruv placeholder */
    const srch=document.getElementById('kRestSearch');
    if(srch) srch.placeholder=dict.qidirish;
  };
})();
