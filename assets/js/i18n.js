/* ===== Yetkaz.uz — Lotin<->Kiril AVTOMATIK harf almashtirish (transliteratsiya) =====
   Lotin va kirilcha o'zbekcha — bir xil til, ikki xil alifbo. Ilgari faqat
   qo'lda kiritilgan "nameCyr"/"textCyr" maydonlari bo'lsa tarjima ko'rinardi —
   bo'lmasa (juda ko'p taom/restoran/izohда) o'sha joy DOIM lotincha qolib
   ketardi (kirillcha rejimда ham). Endi bo'lmagan joyni shu funksiya
   AVTOMATIK harflab beradi — hech qayerда aralash alifbo qolmaydi.
   Idempotent: lotincha matnga toLat() yoki kirillcha matnга toCyr() chaqirilsa
   o'zgarmaydi (faqat "boshqa" alifbodagi harflar almashtiriladi) — shuning
   uchun manba qaysi alifboда bo'lishidan qat'i nazar xavfsiz chaqirish mumkin. */
const YZ_TRANSLIT = (function(){
  /* Email/URL — bularni HARFLAMAYMIZ (aks holda "gmail.com" ham
     kirillashib, manzil buzilib qolardi). */
  const SKIP_RE = /([\w.+-]+@[\w-]+\.[\w.-]+|https?:\/\/\S+)/g;
  function safe(s, fn){
    s=String(s==null?"":s);
    const parts=s.split(SKIP_RE);
    let out="";
    for(let i=0;i<parts.length;i++) out += (i%2===1) ? parts[i] : fn(parts[i]);
    return out;
  }
  function applyCase1(orig, out){
    // bitta belgiga mos, bitta chiqish belgisi — katta/kichik to'g'ridan-to'g'ri ko'chadi
    if(orig!==orig.toLowerCase() && orig===orig.toUpperCase()) return out.toUpperCase();
    return out;
  }
  /* Lotin -> Kiril: ko'p harfli birikmalar UZUNROQdan boshlab tekshiriladi */
  const L2C_MULTI = [
    ["yo","ё"],["yu","ю"],["ya","я"],["sh","ш"],["ch","ч"],["ng","нг"],
    ["o'","ў"],["o‘","ў"],["oʻ","ў"],["o´","ў"],["o`","ў"],
    ["g'","ғ"],["g‘","ғ"],["gʻ","ғ"],["g´","ғ"],["g`","ғ"]
  ];
  const L2C_SINGLE = {a:"а",b:"б",d:"д",e:"е",f:"ф",g:"г",h:"ҳ",i:"и",j:"ж",k:"к",l:"л",m:"м",
    n:"н",o:"о",p:"п",q:"қ",r:"р",s:"с",t:"т",u:"у",v:"в",x:"х",y:"й",z:"з",
    "'":"ъ","‘":"ъ","ʻ":"ъ"};
  function toCyrRaw(s){
    let out="", i=0; const n=s.length;
    while(i<n){
      let hit=null;
      for(const [pat,rep] of L2C_MULTI){
        if(s.substr(i,pat.length).toLowerCase()===pat){ hit=[pat,rep]; break; }
      }
      if(hit){
        const orig=s.substr(i,hit[0].length);
        /* Kiril natija BIR belgi — "Sh"/"SH" farqi yo'q, ikkalasi ham "Ш" bo'ladi */
        out += (orig[0]===orig[0].toUpperCase() && orig[0]!==orig[0].toLowerCase())
          ? hit[1].toUpperCase() : hit[1];
        i+=hit[0].length; continue;
      }
      const ch=s[i], lc=ch.toLowerCase();
      if(L2C_SINGLE[lc]!=null){ out+=applyCase1(ch, L2C_SINGLE[lc]); }
      else out+=ch;   // raqam, tinish belgisi, allaqachon kirill, emoji — o'zgarmaydi
      i++;
    }
    return out;
  }
  /* Kiril -> Lotin (har bir kirill harfi — bitta belgi, lekin ba'zilari
     IKKI/UCH lotin harfiga o'giriladi — shu joyda "Sh" (so'z boshi) va
     "SH" (butun so'z BOSH harflarda) farqlanadi: keyingi harfga qaraymiz). */
  const C2L = {"а":"a","б":"b","в":"v","г":"g","д":"d","е":"e","ё":"yo","ж":"j","з":"z","и":"i",
    "й":"y","к":"k","л":"l","м":"m","н":"n","о":"o","п":"p","р":"r","с":"s","т":"t","у":"u",
    "ф":"f","х":"x","ц":"ts","ч":"ch","ш":"sh","щ":"sh","ъ":"'","э":"e","ю":"yu","я":"ya",
    "қ":"q","ғ":"g'","ў":"o'","ҳ":"h"};
  function toLatRaw(s){
    const arr=Array.from(s);
    let out="";
    for(let i=0;i<arr.length;i++){
      const ch=arr[i], lc=ch.toLowerCase();
      const rep=C2L[lc];
      if(rep==null){ out+=ch; continue; }
      const isUpper = ch!==ch.toLowerCase() && ch===ch.toUpperCase();
      if(!isUpper){ out+=rep; continue; }
      if(rep.length<=1){ out+=rep.toUpperCase(); continue; }
      const next=arr[i+1];
      const nextIsLowerLetter = next!=null && next!==next.toUpperCase() && next===next.toLowerCase();
      out += nextIsLowerLetter ? (rep.charAt(0).toUpperCase()+rep.slice(1)) : rep.toUpperCase();
    }
    return out;
  }
  function toCyr(s){ return safe(s, toCyrRaw); }
  function toLat(s){ return safe(s, toLatRaw); }
  return { toCyr, toLat };
})();
try{ if(typeof window!=="undefined") window.YZ_TRANSLIT = YZ_TRANSLIT; }catch(e){}

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
      cart_title:"Savatingiz", total:"Jami", sum:"so'm", min_note:"Minimal buyurtma: {min} so'm",
      checkout:"Buyurtma berish",
      /* Taomga izoh — restoran va kuryer aynan shuni ko'radi */
      note_label:"Shu taomga izoh", note_ph:"Masalan: sous bilan yuboring",
      note_saved:"Izoh saqlandi ✓", note_cleared:"Izoh o'chirildi",
      note_save:"Saqlash", note_clear:"O'chirish",
      note_hint:"Tilagingizni yozing — restoran shunday tayyorlaydi, kuryer esa qo'shib olib keladi.",
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
      err_name:"Ism kamida 4 harf bo'lsin", err_phone:"To'g'ri telefon raqam kiriting",
      err_address:"Manzilni kiriting",
      err_min:"Minimal buyurtma {min} so'm bo'lishi kerak",
      debt_warn:"Sizda to'lanmagan qarz yo'q ✓",
      track_title:"Buyurtmangiz qabul qilindi!",
      st_accepted:"Qabul qilindi", st_cooking:"Tayyorlanmoqda", st_ready:"Tayyor",
      st_ontheway:"Yo'lda", st_arrived:"Yetib keldi",
      track_eta:"Yetib borish vaqti", min_short:"daqiqa",
      arrived_msg:"Buyurtmangiz yetkazildi. Yoqimli ishtaha! 🎉",
      empty_cart:"Savatingiz bo'sh", empty_hint:"Taomlardan tanlab qo'shing",
      t_added:"Savatga qo'shildi", t_min:"Minimal buyurtma {min} so'm", t_ordered:"Buyurtma qabul qilindi!",
      delivery_free_soon:"Bepul yetkazish yaqin orada",
      new_user:"Yangi foydalanuvchi", rating:"reyting", min_eta:"daq",
      order_now:"Buyurtma", view_menu:"Menyuni ko'rish",
      free:"Bepul", free_delivery:"Tez yetkazib berish", footer_team:"Yetkaz jamoasi",
      orders_word:"buyurtma", reviews_title:"Mijozlar fikri", reviews_sub:"Haqiqiy buyurtmalardan haqiqiy izohlar", nav_reviews:"Izohlar", back:"Orqaga", open_now:"Hozir ochiq", rest_menu:"Menyu",
      stat_rest:"Restoran", stat_dish:"Taom turi", stat_eta:"daqiqada yetkazish", stat_rating:"o'rtacha reyting",
      added_btn:"Savatga qo'shish", view_cart_btn:"Savatni ko'rish", ingredients_l:"Tarkibi",
      soldout:"Tugagan", closed_now:"hozir yopiq", nothing_found:"Hech narsa topilmadi",
      today_rec:"Bugungi tavsiya", rec_sub:"Har kuni boshqa restoran taomlari birinchi chiqadi",
      ri_hours:"Ish vaqti", ri_addr:"Manzil", ri_area:"Yetkazish hududi", ri_contact:"Aloqa",
      ri_about:"haqida", ri_rating:"Reyting", closed_l:"Yopiq", open_l:"Ochiq",
      rate_title:"Baholang", rate_send:"Yuborish", cancel_btn:"Bekor qilish",
      got_it:"Rahmat, oldim!", rate_thanks:"Rahmat! Bahoyingiz yuborildi"
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
      cart_title:"Саватингиз", total:"Жами", sum:"сўм", min_note:"Минимал буюртма: {min} сўм",
      checkout:"Буюртма бериш",
      note_label:"Шу таомга изоҳ", note_ph:"Масалан: соус билан юборинг",
      note_saved:"Изоҳ сақланди ✓", note_cleared:"Изоҳ ўчирилди",
      note_save:"Сақлаш", note_clear:"Ўчириш",
      note_hint:"Тилагингизни ёзинг — ресторан шундай тайёрлайди, курьер эса қўшиб олиб келади.",
      onb_title:"Хуш келибсиз! 👋",
      onb_text:"Yetkaz'да биринчи марта? Буюртма бериш жуда осон — таом танланг, саватга қўшинг ва манзилингизни киритинг. Бошлаймизми?",
      onb_skip:"Кейинроқ", onb_start:"Кўрсатмани кўриш",
      login_title:"Рўйхатдан ўтиш / Кириш", login_sub:"Буюртма бериш учун маълумотларингизни киритинг",
      lbl_name:"Исмингиз", lbl_phone:"Телефон рақами", lbl_address:"Етказиш манзили",
      ph_name:"Масалан: Фаёзбек", ph_phone:"+998 90 123 45 67", ph_address:"Масалан: Хатирчи, кўча, уй, квартира...",
      continue:"Давом этиш", order_title:"Буюртмани тасдиқлаш",
      pay_card:"Карта", pay_cash:"Нақд", paymethod:"Тўлов усули",
      sum_items:"Таомлар", sum_delivery:"Етказиш", sum_total:"Жами тўлов", place_order:"Буюртмани тасдиқлаш",
      err_name:"Исм камида 4 ҳарф бўлсин", err_phone:"Тўғри телефон рақам киритинг",
      err_address:"Манзилни киритинг",
      err_min:"Минимал буюртма {min} сўм бўлиши керак",
      debt_warn:"Сизда тўланмаган қарз йўқ ✓",
      track_title:"Буюртмангиз қабул қилинди!",
      st_accepted:"Қабул қилинди", st_cooking:"Тайёрланмоқда", st_ready:"Тайёр",
      st_ontheway:"Йўлда", st_arrived:"Етиб келди",
      track_eta:"Етиб бориш вақти", min_short:"дақиқа",
      arrived_msg:"Буюртмангиз етказилди. Ёқимли иштаҳа! 🎉",
      empty_cart:"Саватингиз бўш", empty_hint:"Таомлардан танлаб қўшинг",
      t_added:"Саватга қўшилди", t_min:"Минимал буюртма {min} сўм", t_ordered:"Буюртма қабул қилинди!",
      delivery_free_soon:"Бепул етказиш яқин орада",
      new_user:"Янги фойдаланувчи", rating:"рейтинг", min_eta:"дақ",
      order_now:"Буюртма", view_menu:"Менюни кўриш",
      free:"Бепул", free_delivery:"Тез етказиб бериш", footer_team:"Yetkaz жамоаси",
      orders_word:"буюртма", reviews_title:"Мижозлар фикри", reviews_sub:"Ҳақиқий буюртмалардан ҳақиқий изоҳлар", nav_reviews:"Изоҳлар", back:"Орқага", open_now:"Ҳозир очиқ", rest_menu:"Меню",
      stat_rest:"Ресторан", stat_dish:"Таом тури", stat_eta:"дақиқада етказиш", stat_rating:"ўртача рейтинг",
      added_btn:"Саватга қўшиш", view_cart_btn:"Саватни кўриш", ingredients_l:"Таркиби",
      soldout:"Тугаган", closed_now:"ҳозир ёпиқ", nothing_found:"Ҳеч нарса топилмади",
      today_rec:"Бугунги тавсия", rec_sub:"Ҳар куни бошқа ресторан таомлари биринчи чиқади",
      ri_hours:"Иш вақти", ri_addr:"Манзил", ri_area:"Етказиш ҳудуди", ri_contact:"Алоқа",
      ri_about:"ҳақида", ri_rating:"Рейтинг", closed_l:"Ёпиқ", open_l:"Очиқ",
      rate_title:"Баҳоланг", rate_send:"Юбориш", cancel_btn:"Бекор қилиш",
      got_it:"Раҳмат, олдим!", rate_thanks:"Раҳмат! Баҳоингиз юборилди"
    }
  };
  /* ===== TIL SAQLASH JOYI =====
     Bosh sayt (index.html): HAR YANGI TASHRIF kirillcha ochilsin — tanlov
     faqat SHU sessiya uchun eslanadi (sessionStorage). Foydalanuvchi o'zi
     lotinga o'tsa, o'sha oynada shunday qoladi; brauzerни qayta ochса yana
     kirillcha. Kabinet (kabinet.html) — bu yerда til hisob sozlamasi,
     shuning uchun DOIMIY saqlanadi (localStorage). */
  var IS_KAB = false;
  try{ IS_KAB = /kabinet/i.test((typeof location!=="undefined" && location.pathname) || ""); }catch(e){}
  function langRead(){
    try{
      var v = (IS_KAB ? localStorage : sessionStorage).getItem('yz_lang');
      return (v==='lat'||v==='cyr') ? v : null;
    }catch(e){ return null; }
  }
  function langWrite(v){
    try{ (IS_KAB ? localStorage : sessionStorage).setItem('yz_lang', v); }catch(e){}
    /* Kabinet KT() localStorage'ni o'qiydi — shu sessiyada ham mos bo'lsin */
    if(!IS_KAB){ try{ localStorage.setItem('yz_lang', v); }catch(e){} }
  }
  let lang = langRead() || "cyr";
  /* `vars` — {n:"..."} kabi qiymatlar matndagi "{n}" o'rniga qo'yiladi
     (masalan minimal buyurtma summasi — admin sozlamasidan, qattiq yozilmagan). */
  function t(key, vars){
    let str = (DICT[lang] && DICT[lang][key]) || (DICT.lat[key]||key);
    if(vars) Object.keys(vars).forEach(k=>{ str=str.split('{'+k+'}').join(vars[k]); });
    return str;
  }
  function apply(){
    document.querySelectorAll("[data-i18n]").forEach(el=>{ el.textContent = t(el.getAttribute("data-i18n")); });
    document.querySelectorAll("[data-i18n-ph]").forEach(el=>{ el.setAttribute("placeholder", t(el.getAttribute("data-i18n-ph"))); });
    document.documentElement.setAttribute("lang", lang==="lat"?"uz":"uz-Cyrl");
    /* Kabinet matnlari ham shu tilga o'tsin (i18n.js pastida e'lon qilinadi) */
    if(typeof window.KT_APPLY === "function") window.KT_APPLY();
  }
  /* Tilni to'g'ridan-to'g'ri o'rnatish. Kabinet sozlamalari shuni chaqiradi —
     ilgari bu funksiya yo'q edi, shuning uchun til almashmasdi. */
  function setLang(l){
    lang = (l==="cyr") ? "cyr" : "lat";
    langWrite(lang);
    return lang;
  }
  /* Boshqa sahifada/tabda o'zgargan bo'lsa — sinxronlash */
  function sync(){
    var saved = langRead();
    if(saved && saved!==lang) lang = saved;
    return lang;
  }
  function toggle(){ return setLang(lang==="lat" ? "cyr" : "lat"); }
  function current(){ return lang; }
  return { t, apply, toggle, current, setLang, sync };
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
      restoranlar_chip:"Restoranlar",
      savat_bosh:"Savatingiz bo'sh",
      savat_bosh_hint:"Quyidagi taomlardan tanlang",
      jami:"Jami", yetkazish:"Yetkazish", bepul:"Bepul",
      minimal_warn:"Minimal {min} so'm (yana {n} so'm)",
      minimal_ok:"Yetkazish bepul",
      buyurtma_berish:"Buyurtma berish",
      savatga_qoshildi:"Savatga qo'shildi",
      buyurtma_title:"Buyurtma",
      buyurtma_sub:"Ma'lumotlarni to'ldiring",
      ism:"Ismingiz", tel:"Telefon raqam",
      manzil:"Yetkazish manzili", tolov:"To'lov usuli",
      karta:"Karta", naqd:"Naqd",
      taomlar_count:"ta", tasdiq:"Buyurtmani tasdiqlash",
      qabul:"Buyurtma qabul qilindi!",
      ok_btn:"Tushunarli, yopish",
      yetib_keldi:"Yetib keldi!",
      mazali:"Buyurtmangiz eshigingizda.\nOvqatingiz mazali bo'lsin!",
      rahmat:"Rahmat!",
      aksiyalar:"Aksiyalar", bugungi:"Bugungi maxsus takliflar",
      chegirmali:"Chegirmali taomlar", elonlar:"E'lonlar",
      restoranga:"Restoraniga o'tish",
      buyurtmalar_tarixi:"Buyurtmalar tarixi",
      izohlarim:"Mening izohlarim",
      izoh_qoldirish_btn:"Izohni yuborish",
      onl:"Online", chiqish:"Chiqish",
      qidirish:"Restoran qidirish...",
      daq:"daq",
      /* --- kabinet.html statik matnlari --- */
      settings:"Sozlamalar", yordam:"Yordam", savat:"Savat",
      menyu:"Menyu", profil_short:"Profil", chiqish_short:"Chiqish",
      savat_head:"Savatingiz",
      login_sub_kab:"Foydalanuvchi uchun shaxsiy kabinet",
      login_l:"Login", parol_l:"Parol", kirish_btn:"Kirish",
      ph_userlogin:"Foydalanuvchi logini",
      login_hint:"Hisobingiz yo'qmi? Ro'yxatdan o'ting.",
      th_taom:"Taom", th_restoran:"Restoran", th_sana:"Sana",
      th_summa:"Summa", th_yetkazildi:"Yetkazildi", th_holat:"Holat",
      f_buyurtma:"Buyurtma", f_baho:"Bahoyingiz", f_izoh:"Izoh",
      ph_izoh:"Fikringizni yozing...", f_sabab:"Past bahoga sabab",
      opt_choose:"— sababni tanlang —", opt_late:"Kechikdi",
      opt_quality:"Sifat yomon", opt_wrong:"Noto'g'ri taom keldi", opt_other:"Boshqa",
      f_photo:"Taom rasmi (AI tahlil qiladi)",
      rev_note:"Eslatma: asossiz salbiy izohlar avtomatik tekshiriladi. \"Kechikdi\" shikoyati kuryer yetkazish vaqti bilan, \"sifat yomon\" esa AI rasm tahlili bilan solishtiriladi.",
      help_title:"Qanday buyurtma beraman? (4 qadam)",
      hs1_t:"Taom tanlang", hs1_d:"Restoran yoki taomni tanlab savatga qo'shing.",
      hs2_t:"Ro'yxatdan o'ting", hs2_d:"Ism, telefon va manzilingizni kiriting.",
      hs3_t:"Buyurtma bering", hs3_d:"To'lov usulini tanlang (minimal 20 000 so'm, yetkazish bepul).",
      hs4_t:"Kuzating", hs4_d:"Timer va status orqali buyurtmani kuzating — yetib kelganda yashil bo'ladi.",
      video_soon:"Video qo'llanma tez orada qo'shiladi",
      set_profile:"Profil ma'lumotlari",
      f_ism:"Ism", ph_ism:"Ism familiya", f_tel:"Telefon",
      f_email:"Email (ixtiyoriy)", f_addr:"Standart yetkazish manzili",
      ph_addr:"Buyurtma berishda avtomatik to'ladi",
      saqlash:"Saqlash", set_login:"Login va parol",
      f_newpass:"Yangi parol (bo'sh = o'zgarmaydi)",
      set_lang:"Til", set_lang_hint:"Tanlangan til butun sayt uchun saqlanadi.",
      set_notif:"Bildirishnomalar",
      notif_sound:"Buyurtma holati o'zgarsa ovozli bildirishnoma",
    },
    cyr:{
      taomlar:"Таомлар", profil:"Менинг кабинетим", rests:"Ресторанлар",
      review:"Изоҳ қолдириш", help:"Қандай буюртма бериш",
      hammasi:"Ҳаммаси", fastfood:"Фастфуд", milliy:"Миллий",
      ichimlik:"Ичимлик", shirinlik:"Ширинлик",
      restoranlar_chip:"Ресторанлар",
      savat_bosh:"Саватингиз бўш",
      savat_bosh_hint:"Қуйидаги таомлардан танланг",
      jami:"Жами", yetkazish:"Етказиш", bepul:"Бепул",
      minimal_warn:"Минимал {min} сўм (яна {n} сўм)",
      minimal_ok:"Етказиш бепул",
      buyurtma_berish:"Буюртма бериш",
      savatga_qoshildi:"Саватга қўшилди",
      buyurtma_title:"Буюртма",
      buyurtma_sub:"Маълумотларни тўлдиринг",
      ism:"Исмингиз", tel:"Телефон рақами",
      manzil:"Етказиш манзили", tolov:"Тўлов усули",
      karta:"Карта", naqd:"Нақд",
      taomlar_count:"та", tasdiq:"Буюртмани тасдиқлаш",
      qabul:"Буюртма қабул қилинди!",
      ok_btn:"Тушунарли, ёпиш",
      yetib_keldi:"Етиб келди!",
      mazali:"Буюртмангиз эшигингизда.\nОвқатингиз мазали бўлсин!",
      rahmat:"Раҳмат!",
      aksiyalar:"Акциялар", bugungi:"Бугунги махсус таклифлар",
      chegirmali:"Чегирмали таомлар", elonlar:"Эълонлар",
      restoranga:"Ресторанига ўтиш",
      buyurtmalar_tarixi:"Буюртмалар тарихи",
      izohlarim:"Менинг изоҳларим",
      izoh_qoldirish_btn:"Изоҳни юбориш",
      onl:"Онлайн", chiqish:"Чиқиш",
      qidirish:"Ресторан қидириш...",
      daq:"дақ",
      /* --- kabinet.html статик матнлари --- */
      settings:"Созламалар", yordam:"Ёрдам", savat:"Сават",
      menyu:"Меню", profil_short:"Профил", chiqish_short:"Чиқиш",
      savat_head:"Саватингиз",
      login_sub_kab:"Фойдаланувчи учун шахсий кабинет",
      login_l:"Логин", parol_l:"Парол", kirish_btn:"Кириш",
      ph_userlogin:"Фойдаланувчи логини",
      login_hint:"Ҳисобингиз йўқми? Рўйхатдан ўтинг.",
      th_taom:"Таом", th_restoran:"Ресторан", th_sana:"Сана",
      th_summa:"Сумма", th_yetkazildi:"Етказилди", th_holat:"Ҳолат",
      f_buyurtma:"Буюртма", f_baho:"Баҳоингиз", f_izoh:"Изоҳ",
      ph_izoh:"Фикрингизни ёзинг...", f_sabab:"Паст баҳога сабаб",
      opt_choose:"— сабабни танланг —", opt_late:"Кечикди",
      opt_quality:"Сифат ёмон", opt_wrong:"Нотўғри таом келди", opt_other:"Бошқа",
      f_photo:"Таом расми (AI таҳлил қилади)",
      rev_note:"Эслатма: асоссиз салбий изоҳлар автоматик текширилади. \"Кечикди\" шикояти курьер етказиш вақти билан, \"сифат ёмон\" эса AI расм таҳлили билан солиштирилади.",
      help_title:"Қандай буюртма бераман? (4 қадам)",
      hs1_t:"Таом танланг", hs1_d:"Ресторан ёки таомни танлаб саватга қўшинг.",
      hs2_t:"Рўйхатдан ўтинг", hs2_d:"Исм, телефон ва манзилингизни киритинг.",
      hs3_t:"Буюртма беринг", hs3_d:"Тўлов усулини танланг (минимал 20 000 сўм, етказиш бепул).",
      hs4_t:"Кузатинг", hs4_d:"Таймер ва статус орқали буюртмани кузатинг — етиб келганда яшил бўлади.",
      video_soon:"Видео қўлланма тез орада қўшилади",
      set_profile:"Профил маълумотлари",
      f_ism:"Исм", ph_ism:"Исм фамилия", f_tel:"Телефон",
      f_email:"Email (ихтиёрий)", f_addr:"Стандарт етказиш манзили",
      ph_addr:"Буюртма беришда автоматик тўлади",
      saqlash:"Сақлаш", set_login:"Логин ва парол",
      f_newpass:"Янги парол (бўш = ўзгармайди)",
      set_lang:"Тил", set_lang_hint:"Танланган тил бутун сайт учун сақланади.",
      set_notif:"Билдиришномалар",
      notif_sound:"Буюртма ҳолати ўзгарса овозли билдиришнома",
    }
  };

  /* Joriy til — I18N (bosh sayt: sessiya; kabinet: doimiy) bilan bir xil manba */
  function KLANG(){
    try{ if(typeof I18N!=="undefined" && I18N.current) return I18N.current(); }catch(e){}
    try{ return localStorage.getItem('yz_lang')||'cyr'; }catch(e){ return 'cyr'; }
  }
  /* Kabinet uchun tarjima funksiyasi */
  window.KT = function(key, vars){
    const lang = KLANG();
    const dict = KAB[lang]||KAB.lat;
    let str = dict[key]||KAB.lat[key]||key;
    if(vars) Object.keys(vars).forEach(k=>{ str=str.replace('{'+k+'}',vars[k]); });
    return str;
  };

  /* DOM elementlarini yangilash */
  window.KT_APPLY = function(){
    const lang = KLANG();
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
    const links={taomlar:'taomlar',profil:'profil',rests:'rests',review:'review',help:'help',settings:'settings'};
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

    /* Chiqish tugmasi (ikon HTML'da statik — faqat matnni almashtiramiz) */
    const logoutTxt=document.querySelector('#logoutBtn')&&document.getElementById('logoutBtn').lastChild;
    if(logoutTxt && logoutTxt.nodeType===3 && dict.chiqish) logoutTxt.textContent=' '+dict.chiqish;

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
      document.querySelectorAll('#kMenu .card').forEach(card=>{
        const id=+card.dataset.id;
        const d=DISHES.find(x=>x.id===id);
        if(!d) return;
        const h3=card.querySelector('h3');
        if(h3) h3.textContent = lang==='cyr' ? YZ_TRANSLIT.toCyr(d.nameCyr||d.name) : YZ_TRANSLIT.toLat(d.name);
      });
    }

    /* Restoran nomlari */
    if(typeof RESTAURANTS!=='undefined'){
      document.querySelectorAll('#kRestGrid .rest-card').forEach(card=>{
        const rname=card.dataset.rest;
        const r=RESTAURANTS.find(x=>x.name===rname);
        if(!r) return;
        const h3=card.querySelector('h3');
        if(h3) h3.textContent = lang==='cyr' ? YZ_TRANSLIT.toCyr(r.nameCyr||r.name) : YZ_TRANSLIT.toLat(r.name);
      });
    }

    /* Savat drawer (ikon HTML'da statik — faqat matn spanini almashtiramiz) */
    const drHeadTxt=document.querySelector('.kab-dr-head h3 [data-kt="savat_head"]');
    if(drHeadTxt) drHeadTxt.textContent=(lang==='cyr'?'Саватингиз':'Savatingiz');

    /* Rests qidiruv placeholder */
    const srch=document.getElementById('kRestSearch');
    if(srch) srch.placeholder=dict.qidirish;
  };
})();
