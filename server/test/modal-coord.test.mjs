/* ===== Bosh sayt (app.js) — BUYURTMA MODALLARI KOORDINATSIYASI =====
   Muammo edi: bir nechta faol buyurtма bo'lsa
     • har buyurtмaning 1-soniyalik taymeri BITTA #tTimer ni yangilardi
       -> soat raqamlari sakrar edi
     • "yetib keldi" oynalari ustma-ust ochilar -> "modallar aralashib chiqar" edi
   Tuzatish (app.js):
     • tick() modal DOM ini FAQAT modalдаги data-track-order == shu buyurtма bo'lsa yangilaydi
     • "yetib keldi" oynalari NAVBAT bilan (arrivedQueue/arrivedBusy)
     • "qabul qilindi" oynasi FAQAT yangi buyurtма uchun avto; qolganlari klik bilan
   Bu test SHU ALGORITMNI (app.js dagi bilan bir xil) modellab tekshiradi. */

let PASS = 0, FAIL = 0;
const eq = (a, b, m) => { if (a === b) PASS++; else { FAIL++; console.error(`  ✗ ${m}: kutildi ${JSON.stringify(b)}, keldi ${JSON.stringify(a)}`); } };
const ok = (c, m) => { if (c) PASS++; else { FAIL++; console.error(`  ✗ ${m}`); } };

/* ---- app.js dagi holat ---- */
let modalOwner = null;          // #modalContent [data-track-order] qiymati
let timerText = null;           // #tTimer.textContent
let arrivedQueue = [];
let arrivedBusy = false;
let arrivedOverlayId = null;    // hozir ko'rsatilayotgan "yetib keldi" buyurtмasi
const arrivedShownLog = [];     // ketma-ketlikni tekshirish uchun

function openTrackModal(orderId) { modalOwner = String(orderId); }
function closeModal() { modalOwner = null; }

/* app.js: showArrivedOverlay dagi navbat mantiqi */
function showArrivedOverlay(order) {
  if (arrivedBusy && arrivedOverlayId != null) {
    if (!arrivedQueue.some((o) => String(o.id) === String(order.id))) arrivedQueue.push(order);
    return;
  }
  arrivedBusy = true;
  closeModal();                       // "yetib keldi" ustuvor
  arrivedOverlayId = order.id;
  arrivedShownLog.push(order.id);
}
function closeArrived() {
  arrivedOverlayId = null;
  arrivedBusy = false;
  const next = arrivedQueue.shift();
  if (next) showArrivedOverlay(next);
}

/* app.js: animateOrder.tick() — modal DOM yangilash qismi */
function tick(orderId, remainingText) {
  if (String(modalOwner) !== String(orderId)) return;   // <-- kalit tuzatish
  timerText = remainingText;
}

/* ================= SSENARIYLAR ================= */

/* 1) 3 ta buyurtма — har biri tick qiladi, LEKIN modal oxirgisiniki */
modalOwner = null; timerText = null;
openTrackModal('o1');                       // 1-buyurtма berildi -> modal
tick('o1', '18:00');
eq(timerText, '18:00', 'S1: 1-buyurtма modalда — o\'z taymeri ko\'rinadi');
openTrackModal('o2');                       // 2-buyurtма berildi -> modal o'zgardi
tick('o1', '17:59');                        // 1-buyurtмaning eski ticki
eq(timerText, '18:00', 'S1: 2-buyurtма modalда — 1-buyurtма ticki #tTimer ni O\'ZGARTIRMAYDI (soat sakramaydi)');
tick('o2', '11:30');
eq(timerText, '11:30', 'S1: 2-buyurtма o\'z taymerini ko\'rsatadi');
openTrackModal('o3');
tick('o1', '17:58'); tick('o2', '11:29');
eq(timerText, '11:30', 'S1: 3-buyurtма modalда — 1 va 2 ticklari ta\'sir qilmaydi');
tick('o3', '05:10');
eq(timerText, '05:10', 'S1: 3-buyurtма (oxirgi) taymeri to\'g\'ri');

/* 2) Faol buyurtмa ustiga klik -> o'sha buyurtмaning oynasi */
openTrackModal('o1');                       // ro'yxatdan 1-buyurtмани bosdi
tick('o3', '05:00'); tick('o2', '11:00');
eq(timerText, '05:10', 'S2: klik bilan 1-buyurtма ochildi — boshqa ticklar unga yozmaydi');
tick('o1', '17:40');
eq(timerText, '17:40', 'S2: klik qilingan buyurtма taymeri yangilanadi');

/* 3) "Yetib keldi" oynalari NAVBAT bilan — ustma-ust chiqmaydi */
arrivedQueue = []; arrivedBusy = false; arrivedOverlayId = null; arrivedShownLog.length = 0;
showArrivedOverlay({ id: 'a1', label: 'Palov' });
showArrivedOverlay({ id: 'a2', label: 'Lagmon' });
showArrivedOverlay({ id: 'a3', label: 'Manti' });
eq(arrivedOverlayId, 'a1', 'S3: faqat 1-"yetib keldi" oynasi ochiq');
eq(arrivedQueue.length, 2, 'S3: qolgan 2 tasi navbatда');
eq(modalOwner, null, 'S3: "yetib keldi" ochilганда "qabul qilindi" modal yopildi');
closeArrived();
eq(arrivedOverlayId, 'a2', 'S3: yopilgach 2-si ochildi');
closeArrived();
eq(arrivedOverlayId, 'a3', 'S3: keyin 3-si');
closeArrived();
eq(arrivedOverlayId, null, 'S3: hammasi ko\'rsatildi');
eq(arrivedShownLog.join(','), 'a1,a2,a3', 'S3: ketma-ketlik to\'g\'ri, aralashmadi');

/* 4) Dublikat — bir buyurtма ikki marta navbatга tushmaydi */
arrivedQueue = []; arrivedBusy = false; arrivedOverlayId = null;
showArrivedOverlay({ id: 'b1' });
showArrivedOverlay({ id: 'b2' });
showArrivedOverlay({ id: 'b2' });          // takror (tick 2 marta chaqirsa)
eq(arrivedQueue.length, 1, 'S4: b2 navbatда 1 marta (dublikat yo\'q)');

/* 5) "yetib keldi" ochiq bo'lsa — yangi buyurtма "qabul qilindi" modalини ochmaydi */
arrivedQueue = []; arrivedBusy = false; arrivedOverlayId = null; modalOwner = null;
showArrivedOverlay({ id: 'c1' });
/* app.js: startTracking -> if(!arrivedOverlay) openTrackModal(...) */
const arrivedOpen = arrivedOverlayId != null;
if (!arrivedOpen) openTrackModal('c2');
eq(modalOwner, null, 'S5: "yetib keldi" ochiq -> yangi buyurtма modali ochilmadi (aralashmasin)');

console.log(`\nmodal-coord: ${PASS} o'tdi, ${FAIL} yiqildi`);
process.exit(FAIL ? 1 : 0);
