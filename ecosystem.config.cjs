/* ===== Yetkaz.uz — pm2 process manager sozlamasi =====
   Backend va Telegram botni 24/7 ishlatadi, yiqilsa avtomat qayta tiklaydi,
   server qayta yuklanганда o'zi ishga tushadi (pm2 startup + pm2 save bilan).

   Ishga tushirish:
     npm i -g pm2
     pm2 start ecosystem.config.cjs
     pm2 save
     pm2 startup        # (chiqan buyruqni admin huquqi bilan bajaring)

   Foydali:
     pm2 status         # holat
     pm2 logs           # loglar
     pm2 restart all    # qayta ishga tushirish
     pm2 stop all       # to'xtatish

   Eslatma: bot alohida papkada (../YetkazGo_bot). Agar u boshqa joyda bo'lsa,
   quyidagi `cwd` ni to'g'rilang yoki bot qatorini olib tashlang. */
module.exports = {
  apps: [
    {
      name: 'yetkaz-backend',
      cwd: './server',
      script: 'src/app.js',
      node_args: '--env-file-if-exists=.env',
      env: { NODE_ENV: 'production' },
      autorestart: true,
      max_restarts: 20,
      min_uptime: '10s',
      watch: false,
    },
    {
      name: 'yetkazgo-bot',
      cwd: '../YetkazGo_bot',
      script: 'src/bot.js',
      env: { NODE_ENV: 'production' },
      autorestart: true,
      max_restarts: 20,
      min_uptime: '10s',
      watch: false,
    },
  ],
};
