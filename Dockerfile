# ===== Yetkaz.uz backend — Docker image =====
# Backend + statik frontend (bir xil origin, 5050-port).
# Bot (YetkazGo_bot) alohida joylashadi — bu image faqat sayt/backend uchun.

FROM node:22-alpine

WORKDIR /app/server

# Bog'liqliklar (kesh uchun avval faqat manifest)
COPY server/package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev

# Backend kodi
COPY server/ ./

# Statik frontend (loyiha ildizidan beriladi -> ROOT_DIR = ../)
COPY assets/ ../assets/
COPY *.html ../
COPY sw.js manifest.webmanifest ../ 2>/dev/null || true
COPY README.md ../ 2>/dev/null || true

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
