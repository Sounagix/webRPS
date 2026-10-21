# Random Player Studio — web

Web del estudio, publicada en https://randomplayerstudio.com mediante Cloudflare Pages.

Sitio estático en `public/` servido por un Worker (`src/index.js`), que además recibe las solicitudes de tester en `/api/tester` y las envía a Discord. Necesita el secreto `DISCORD_WEBHOOK_URL` en Cloudflare. Cada push a `main` se publica solo.
