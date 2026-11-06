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
  const send = (body) => fetch(hook, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  let r = await send(payload);
  let detail = "";
  if (!r.ok) {
    detail = await r.text();
    // Los canales de tipo Foro exigen crear un hilo: cada tester abre su propio post.
    if (r.status === 400 && /thread_name|220001/.test(detail)) {
      r = await send({ ...payload, thread_name: ("Tester · " + (clean(d.name, 60) || email)).slice(0, 100) });
      if (!r.ok) detail = await r.text();
    }
  }
  if (!r.ok) {
    console.log("Discord error", r.status, detail);
    let code = "";
    try { code = JSON.parse(detail).code ?? ""; } catch {}
    return json({ error: "discord_" + r.status + (code ? "_" + code : "") }, 502);
  }
  return json({ ok: true });
}

// Informe de testers de Not From Here (página oculta /notfromhere/report-dziytekbyb/).
const REPORT_LABELS = {
  nombre: "Nombre", movil: "Móvil", partidas: "Partidas", record: "Mejor partida",
  diversion: "Diversión (1-5)", dificultad: "Dificultad", volver: "Volvería a jugar",
  super: "Entendió el súper", favorito: "Súper o clase favorita", evolucion: "Evolución del súper",
  legibilidad: "Se ve bien (1-5)", fallos: "Fallos o dudas", mejor: "Lo mejor", cambiar: "Lo que cambiaría",
};
const LONG_FIELDS = new Set(["fallos", "mejor", "cambiar"]);

async function postToDiscord(env, payload, threadName) {
  const hook = String(env.DISCORD_WEBHOOK_URL).trim().replace("://discordapp.com/", "://discord.com/");
  const send = (body) => fetch(hook, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  let r = await send(payload);
  let detail = "";
  if (!r.ok) {
    detail = await r.text();
    if (r.status === 400 && /thread_name|220001/.test(detail)) {
      r = await send({ ...payload, thread_name: threadName.slice(0, 100) });
      if (!r.ok) detail = await r.text();
    }
  }
  if (!r.ok) {
    console.log("Discord error", r.status, detail);
    let code = "";
    try { code = JSON.parse(detail).code ?? ""; } catch {}
    return "discord_" + r.status + (code ? "_" + code : "");
  }
  return "";
}

async function handleReport(request, env) {
  if (request.method !== "POST") return json({ error: "method" }, 405);
  const origin = request.headers.get("origin");
  if (origin && !ALLOWED_ORIGINS.includes(origin)) return json({ error: "origin" }, 403);
  let d;
  try { d = await request.json(); } catch { return json({ error: "bad_request" }, 400); }
  if (d.website) return json({ ok: true });
  if (!/^[1-5]$/.test(String(d.diversion ?? ""))) return json({ error: "diversion" }, 400);
  if (!env.DISCORD_WEBHOOK_URL) return json({ error: "config" }, 500);

  const fields = [];
  for (const [k, label] of Object.entries(REPORT_LABELS)) {
    const max = LONG_FIELDS.has(k) ? 800 : 120;
    const v = String(d[k] ?? "").replace(/`/g, "'").trim().slice(0, max);
    if (!v || k === "nombre") continue;
    fields.push({ name: label, value: v, inline: !LONG_FIELDS.has(k) && k !== "favorito" && k !== "record" });
  }
  const name = clean(d.nombre, 40) || "Anónimo";
  const lang = clean(d.lang, 5).toUpperCase() || "?";
  const payload = {
    username: "Not From Here · Informes",
    allowed_mentions: { parse: [] },
    embeds: [{
      title: "📋 Informe de tester · " + name,
      description: "Idioma: " + lang + " · Versión: " + (clean(d.version, 20) || "?"),
      color: 0x46e0d6,
      fields,
      timestamp: new Date().toISOString(),
    }],
  };
  const err = await postToDiscord(env, payload, "Informe · " + name);
  if (err) return json({ error: err }, 502);
  return json({ ok: true });
}

// Páginas legales: responden 200 con y sin barra final, sin redirecciones (Google Play las revisa con un bot).
// "/privacy" cubre el enlace relativo "../privacy/" cuando delete-account se abre sin barra final.
const LEGAL_PAGES = {
  "/notfromhere/privacy": "/notfromhere/privacy/",
  "/notfromhere/delete-account": "/notfromhere/delete-account/",
  "/privacy": "/notfromhere/privacy/",
  "/privacy/": "/notfromhere/privacy/",
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/tester") return handleTester(request, env);
    if (url.pathname === "/api/report") return handleReport(request, env);
    if (url.pathname.startsWith("/notfromhere/report-")) {
      const res = await env.ASSETS.fetch(request);
      const out = new Response(res.body, res);
      out.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
      out.headers.set("Referrer-Policy", "no-referrer");
      out.headers.set("Cache-Control", "no-store");
      return out;
    }
    const legal = LEGAL_PAGES[url.pathname];
    if (legal) return env.ASSETS.fetch(new Request(new URL(legal, url), request));
    return env.ASSETS.fetch(request);
  },
};
