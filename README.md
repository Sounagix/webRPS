# Random Player Studio — web

Web del estudio, publicada en https://randomplayerstudio.com mediante Cloudflare Pages.

Sitio estático en `public/` servido por un Worker (`src/index.js`), que además recibe las solicitudes de tester en `/api/tester` y las envía a Discord. Necesita el secreto `DISCORD_WEBHOOK_URL` en Cloudflare. Los informes de testers se guardan en la base D1 `nfh-reports` y cada día a las 19:00 UTC se publica un resumen en Discord. Cada push a `main` se publica solo.
