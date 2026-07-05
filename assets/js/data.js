/* ===== Yetkaz.uz — Namuna ma'lumotlar (real fotolar + emoji zaxira) ===== */
const UN = (id, w=800) => `https://images.unsplash.com/photo-${id}?w=${w}&q=80&auto=format&fit=crop`;

const DISHES = [];

const DISH_CATS = ["Hammasi","Fastfood","Milliy","Ichimlik","Shirinlik"];
const DISH_CATS_CYR = {"Hammasi":"Ҳаммаси","Fastfood":"Фастфуд","Milliy":"Миллий","Ichimlik":"Ичимлик","Shirinlik":"Ширинлик"};

const RESTAURANTS = [];

const REVIEWS = [];

/* Hero: 10 ta almashinuvchi real taom fotosi (orqa fon) */
const HERO_IMAGES = [
  { url:UN("1568901346375-23c9450c58cd",1600), emoji:"🍔" },
  { url:UN("1628840042765-356cda07504e",1600), emoji:"🍕" },
  { url:UN("1569718212165-3a8278d5f624",1600),    emoji:"🍝" },
  { url:UN("1596797038530-2c107229654b",1600), emoji:"🍣" },
  { url:UN("1633237308525-cd587cf71926",1600), emoji:"🥩" },
  { url:UN("1569718212165-3a8278d5f624",1600), emoji:"🍜" },
  { url:UN("1512621776951-a57141f2eefd",1600), emoji:"🥗" },
  { url:UN("1573080496219-bb080dd4f877",1600), emoji:"🍟" },
  { url:UN("1578985545062-69928b1d9587",1600), emoji:"🍰" },
  { url:UN("1633237308525-cd587cf71926",1600), emoji:"🍢" }
];
