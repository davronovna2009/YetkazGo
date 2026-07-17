# ===== Yetkaz.uz backend — Docker image =====
# Backend + statik frontend (bir xil origin, 5050-port).
# Bot (YetkazGo_bot) alohida joylashadi — bu image faqat sayt/backend uchun.

FROM node:22-alpine

# Sog'liq tekshiruvi uchun wget (alpine'da bor, lekin aniqlik uchun)
WORKDIR /app/server

# Bog'liqliklar (kesh uchun avval faqat manifest)
COPY server/package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev

# Backend kodi
COPY server/ ./

# ===== Statik frontend (loyiha ildizidan beriladi -> ROOT_DIR = ../) =====
# MUHIM: Dockerfile'da COPY — bu SHELL emas, shuning uchun `2>/dev/null || true`
# kabi konstruksiyalar ISHLAMAYDI (ular fayl nomi deb qabul qilinib, build
# yiqiladi). Har bir manba ANIQ va MAVJUD bo'lishi kerak.
COPY assets/ ../assets/
COPY *.html ../
# PWA: service worker + barcha web-manifestlar (admin/kabinet/kuryer/restoran/manifest)
COPY sw.js ../
COPY *.webmanifest ../
COPY favicon.ico ../

# Ma'lumot va yuklamalar uchun doimiy papkalar (volume tavsiya etiladi)
RUN mkdir -p data uploads backups
VOLUME ["/app/server/data", "/app/server/uploads", "/app/server/backups"]

ENV NODE_ENV=production
ENV PORT=5050
EXPOSE 5050

# Sog'liq tekshiruvi
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:5050/api/health || exit 1

CMD ["node", "--env-file-if-exists=.env", "src/app.js"]
