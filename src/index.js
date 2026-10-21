// Worker de randomplayerstudio.com: sirve la web estática y recibe solicitudes de tester.
const ALLOWED_ORIGINS = ["https://randomplayerstudio.com", "https://www.randomplayerstudio.com"];

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

const clean = (v, max = 100) => String(v ?? "").replace(/[\r\n`]+/g, " ").trim().slice(0, max);

async function handleTester(request, env) {
  if (request.method !== "POST") return json({ error: "method" }, 405);
  const origin = request.headers.get("origin");
  if (origin && !ALLOWED_ORIGINS.includes(origin)) return json({ error: "origin" }, 403);

  let d;
  try { d = await request.json(); } catch { return json({ error: "bad_request" }, 400); }

  // Campo trampa para bots: si viene relleno, fingimos éxito y no enviamos nada.
  if (d.website) return json({ ok: true });

  const email = clean(d.email, 120);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "email" }, 400);
  if (!d.consent) return json({ error: "consent" }, 400);
  if (!env.DISCORD_WEBHOOK_URL) return json({ error: "config" }, 500);

  const field = (name, value) => ({ name, value: clean(value) || "—", inline: true });
  const payload = {
    username: "Not From Here · Testers",
    allowed_mentions: { parse: [] },
    embeds: [{
      title: "🛸 New tester request",
      color: 0x00a8f0,
      fields: [
        field("Name", d.name),
        { name: "Google Play email", value: email, inline: true },
        field("Phone", d.device),
        field("Country", d.country),
        field("Plays", d.plays),
        field("Found us via", d.source),
        field("Language", d.lang),
      ],
      timestamp: new Date().toISOString(),
    }],
  };

  // Discord ya no acepta bien el dominio antiguo discordapp.com: lo normalizamos.
  const hook = String(env.DISCORD_WEBHOOK_URL).trim().replace("://discordapp.com/", "://discord.com/");
  const r = await fetch(hook, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!r.ok) return json({ error: "discord_" + r.status }, 502);
  return json({ ok: true });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/tester") return handleTester(request, env);
    return env.ASSETS.fetch(request);
  },
};
