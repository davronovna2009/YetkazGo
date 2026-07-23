/* ===== KATTA va SHUBHALI buyurtmalar qoidalari — YAGONA manba =====

   Bu yerда uchta narsa hal qilinadi:

   1) KURYER QO'NG'IROG'I (callRule)
      Buyurtma katta bo'lsa (10 donadan ko'p YOKI 300 000 so'mdan qimmat),
      kuryer «Yo'lga chiqdim» tugmasini BOSA OLMAYDI: avval mijozga qo'ng'iroq
      qilib "rostdan shuncha buyurtma berdingizmi?" deb tasdiqlashi shart.
      Mijoz tasdiqlagach kuryer «Mijoz tasdiqladi» bosadi va tugmalar ochiladi.

   2) SHUBHALI BUYURTMA (suspicionCheck)
      Juda katta / g'ayrioddiy buyurtma (masalan 100–200 ta har xil taom)
      to'g'ridan-to'g'ri restoranga TUSHMAYDI. U `status = 'review'` bilan
      saqlanadi va FAQAT admin panelida ko'rinadi. Admin tasdiqlagandan keyingina
      restoranga, so'ng kuryerga boradi. Admin rad etsa — bekor qilinadi.

   3) Chegaralarni bir joydan o'zgartirish — panellar ham shu sonlarni
      ko'rsatadi (/api/order-rules).

   MUHIM: bu qoidalar blocks.js dagi BLOKLASH qoidalaridan ALOHIDA. U yerда
   raqam bloklanadi (spam), bu yerда esa buyurtma tekshiruvga olinadi. */

/* ---- 1) Kuryer qo'ng'irog'i shart bo'ladigan chegaralar ---- */
export const CALL_QTY = 10;          // shundan KO'P dona bo'lsa
export const CALL_AMOUNT = 300000;   // yoki shundan QIMMAT bo'lsa (so'm)

/* ---- 2) Shubhali (adminга yo'naltiriladigan) buyurtma chegaralari ----
   FAQAT HAJMI KATTA buyurtma adminga boradi: 20 donadan ko'p mahsulot,
   yoki juda qimmat, yoki juda ko'p xil taom. Oddiy (kichik) buyurtma
   TO'G'RIDAN restoranga/kuryerga boradi — adminga TUSHMAYDI.

   MUHIM: "qisqa vaqtда ko'p buyurtma" qoidasi BU YERДА YO'Q. Ilgari 30
   daqiqada 3 ta buyurtma bergan oddiy mijozning KICHIK buyurtmasi ham
   adminga ketardi. Ketma-ket spam allaqachon blocks.js da hal qilinadi
   (10 daqiqada 6 ta → raqam bloklanadi). */
export const SUSPECT_QTY = 20;            // 20 donadan ko'p mahsulot
export const SUSPECT_AMOUNT = 3000000;    // 3 mln so'mdan qimmat
export const SUSPECT_LINES = 30;          // 30 xildan ko'p turli taom

/* Buyurtmadagi JAMI dona soni (2 ta osh + 3 ta somsa = 5) */
export function totalQty(lines) {
  if (!Array.isArray(lines)) return 0;
  return lines.reduce((s, l) => s + (Number(l && l.qty) || 0), 0);
}

/* Kuryer yo'lga chiqishdan oldin qo'ng'iroq qilishi shartmi?
   Qaytaradi: { required: boolean, reason: string } */
export function callRule(amount, lines) {
  const qty = totalQty(lines);
  const sum = Number(amount) || 0;
  const why = [];
  if (qty > CALL_QTY) why.push(`${qty} dona mahsulot (${CALL_QTY} tadan ko'p)`);
  if (sum > CALL_AMOUNT) why.push(`${sum.toLocaleString('ru-RU')} so'm (${CALL_AMOUNT.toLocaleString('ru-RU')} so'mdan qimmat)`);
  return { required: why.length > 0, reason: why.join(' · ') };
}

/* Buyurtma shubhalimi (adminga yo'naltiriladimi)?
   FAQAT hajm bo'yicha — buyurtma vaqti/tezligi bilan ALOQASI YO'Q.
   Qaytaradi: { suspicious: boolean, reason: string } */
export function suspicionCheck({ amount, lines }) {
  const qty = totalQty(lines);
  const sum = Number(amount) || 0;
  const kinds = Array.isArray(lines) ? lines.length : 0;
  const why = [];

  if (qty > SUSPECT_QTY) why.push(`${qty} dona mahsulot`);
  if (sum > SUSPECT_AMOUNT) why.push(`${sum.toLocaleString('ru-RU')} so'm`);
  if (kinds > SUSPECT_LINES) why.push(`${kinds} xil turli taom`);

  return { suspicious: why.length > 0, reason: why.join(' · ') };
}

/* Panellar ko'rsatishi uchun chegaralar to'plami */
export function rulesSnapshot() {
  return {
    callQty: CALL_QTY, callAmount: CALL_AMOUNT,
    suspectQty: SUSPECT_QTY, suspectAmount: SUSPECT_AMOUNT, suspectLines: SUSPECT_LINES,
  };
}
