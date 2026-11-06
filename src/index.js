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

const COLS = ["lang", "version", ...Object.keys(REPORT_LABELS)];

async function handleReport(request, env) {
  if (request.method !== "POST") return json({ error: "method" }, 405);
  const origin = request.headers.get("origin");
  if (origin && !ALLOWED_ORIGINS.includes(origin)) return json({ error: "origin" }, 403);
  let d;
  try { d = await request.json(); } catch { return json({ error: "bad_request" }, 400); }
  if (d.website) return json({ ok: true });
  if (!/^[1-5]$/.test(String(d.diversion ?? ""))) return json({ error: "diversion" }, 400);
  if (!env.REPORTS) return json({ error: "config" }, 500);

  const val = (k) => {
    const max = LONG_FIELDS.has(k) ? 800 : 120;
    const v = String(d[k] ?? "").trim().slice(0, max);
    if (k === "diversion" || k === "legibilidad") return /^[1-5]$/.test(v) ? Number(v) : null;
    return v || null;
  };
  const values = COLS.map(val);
  await env.REPORTS.prepare(
    "INSERT INTO reports (created, " + COLS.join(", ") + ") VALUES (?, " + COLS.map(() => "?").join(", ") + ")"
  ).bind(new Date().toISOString(), ...values).run();
  return json({ ok: true });
}

// ---------- Estadística ----------
async function loadStats(env, sinceIso) {
  const where = sinceIso ? " WHERE created >= ?" : "";
  const bind = sinceIso ? [sinceIso] : [];
  const q = (sql) => env.REPORTS.prepare(sql).bind(...bind);
  const [tot, dist] = await Promise.all([
    q("SELECT COUNT(*) n, AVG(diversion) fun, AVG(legibilidad) leg FROM reports" + where).first(),
    Promise.all(["volver", "dificultad", "super", "evolucion", "partidas", "lang"].map(async (k) => {
      const r = await q("SELECT " + k + " v, COUNT(*) n FROM reports" + where + (where ? " AND " : " WHERE ") + k + " IS NOT NULL GROUP BY " + k + " ORDER BY n DESC").all();
      return [k, r.results];
    })),
  ]);
  return { n: tot?.n || 0, fun: tot?.fun, leg: tot?.leg, dist: Object.fromEntries(dist) };
}
const fmt1 = (x) => (x == null ? "–" : (Math.round(x * 10) / 10).toFixed(1));
const pct = (rows, key) => {
  const total = rows.reduce((a, r) => a + r.n, 0);
  const hit = rows.find((r) => r.v === key);
  return total ? Math.round((100 * (hit?.n || 0)) / total) + " %" : "–";
};
const distLine = (rows) => (rows && rows.length ? rows.map((r) => r.v + " " + r.n).join(" · ") : "–");

async function dailyReport(env) {
  if (!env.REPORTS || !env.DISCORD_WEBHOOK_URL) return;
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const day = await loadStats(env, since);
  if (!day.n) return; // sin informes nuevos, no se publica nada
  const all = await loadStats(env, null);
  const texts = await env.REPORTS.prepare(
    "SELECT nombre, fallos, mejor, cambiar FROM reports WHERE created >= ? ORDER BY created DESC LIMIT 15"
  ).bind(since).all();
  const lines = (k) => texts.results.filter((r) => r[k]).map((r) => "• " + (r.nombre || "Anónimo") + ": " + String(r[k]).replace(/\s+/g, " ").slice(0, 160)).join("\n").slice(0, 1000) || "–";
  const key = await env.REPORTS.prepare("SELECT v FROM config WHERE k = 'stats_key'").first("v");
  const payload = {
    username: "Not From Here · Informes",
    allowed_mentions: { parse: [] },
    embeds: [{
      title: "📊 Informe diario de testers",
      description: "**" + day.n + "** informe" + (day.n === 1 ? "" : "s") + " nuevo" + (day.n === 1 ? "" : "s") + " en las últimas 24 h · **" + all.n + "** en total" +
        (key ? "\n[Ver estadística completa](https://randomplayerstudio.com/notfromhere/report-dziytekbyb/stats?key=" + key + ")" : ""),
      color: 0x46e0d6,
      fields: [
        { name: "Diversión media", value: fmt1(day.fun) + " / 5 (total " + fmt1(all.fun) + ")", inline: true },
        { name: "Se ve bien", value: fmt1(day.leg) + " / 5 (total " + fmt1(all.leg) + ")", inline: true },
        { name: "Volverían a jugar", value: pct(day.dist.volver, "Sí") + " (total " + pct(all.dist.volver, "Sí") + ")", inline: true },
        { name: "Dificultad", value: distLine(day.dist.dificultad), inline: false },
        { name: "¿Entendieron el súper?", value: distLine(day.dist.super), inline: false },
        { name: "Idiomas", value: distLine(day.dist.lang), inline: true },
        { name: "Fallos o dudas", value: lines("fallos"), inline: false },
        { name: "Lo mejor", value: lines("mejor"), inline: false },
        { name: "Lo que cambiarían", value: lines("cambiar"), inline: false },
      ],
      timestamp: new Date().toISOString(),
    }],
  };
  await postToDiscord(env, payload, "Informe diario " + new Date().toISOString().slice(0, 10));
}

const esc = (x) => String(x ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

async function handleStats(request, env, url) {
  const headers = { "X-Robots-Tag": "noindex, nofollow, noarchive", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };
  const key = env.REPORTS ? await env.REPORTS.prepare("SELECT v FROM config WHERE k = 'stats_key'").first("v") : null;
  if (!key || url.searchParams.get("key") !== key) return new Response("Not found", { status: 404, headers });
  const rows = (await env.REPORTS.prepare("SELECT * FROM reports ORDER BY created DESC").all()).results;
  if (url.searchParams.get("format") === "csv") {
    const cols = ["created", ...COLS];
    const csv = [cols.join(",")].concat(rows.map((r) => cols.map((c) => '"' + String(r[c] ?? "").replace(/"/g, '""') + '"').join(","))).join("\n");
    return new Response("\ufeff" + csv, { headers: { ...headers, "content-type": "text/csv; charset=utf-8", "content-disposition": "attachment; filename=nfh-informes.csv" } });
  }
  const st = await loadStats(env, null);
  const bars = (title, list) => {
    const total = (list || []).reduce((a, r) => a + r.n, 0) || 1;
    return '<section class="box"><h2>' + esc(title) + "</h2>" + ((list || []).map((r) =>
      '<div class="bar"><span>' + esc(r.v) + '</span><i style="width:' + Math.round((100 * r.n) / total) + '%"></i><b>' + r.n + "</b></div>").join("") || '<p class="dim">–</p>') + "</section>";
  };
  const labels = { created: "Fecha", ...REPORT_LABELS, lang: "Idioma", version: "Versión" };
  const cols = ["created", "nombre", "lang", "version", "diversion", "legibilidad", "dificultad", "volver", "partidas", "record", "super", "evolucion", "favorito", "movil", "fallos", "mejor", "cambiar"];
  const table = "<table><thead><tr>" + cols.map((c) => "<th>" + esc(labels[c] || c) + "</th>").join("") + "</tr></thead><tbody>" +
    rows.map((r) => "<tr>" + cols.map((c) => "<td>" + esc(c === "created" ? String(r[c]).slice(0, 16).replace("T", " ") : r[c]) + "</td>").join("") + "</tr>").join("") + "</tbody></table>";
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Estadística · Informes NFH</title>
<style>:root{color-scheme:dark}body{margin:0;background:#0a0f10;color:#e3ecea;font:15px/1.5 system-ui,sans-serif;padding:24px max(16px,env(safe-area-inset-left,0px))}
.wrap{max-width:1100px;margin:0 auto;display:grid;gap:20px}h1{font-size:28px;margin:0}h2{font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:#46e0d6;margin:0 0 10px}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px}.kpi,.box{border:1px solid #233536;background:#111a1b;padding:14px 16px}
.kpi b{display:block;font-size:30px;font-variant-numeric:tabular-nums}.kpi span,.dim{color:#8aa3a0;font-size:13px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px}.bar{display:grid;grid-template-columns:minmax(0,9em) 1fr 2.5em;gap:10px;align-items:center;margin:6px 0;font-size:14px}
.bar i{display:block;height:10px;background:#46e0d6;border-radius:2px;min-width:2px}.bar b{text-align:right;font-variant-numeric:tabular-nums}
.tbl{overflow-x:auto;border:1px solid #233536}table{border-collapse:collapse;font-size:13px;min-width:1400px}th,td{border-bottom:1px solid #233536;padding:8px 10px;text-align:left;vertical-align:top}th{color:#8aa3a0;font-weight:600;position:sticky;top:0;background:#111a1b}
a{color:#46e0d6}</style></head><body><div class="wrap">
<h1>Informes de testers · Not From Here</h1>
<div class="kpis"><div class="kpi"><b>${st.n}</b><span>informes</span></div><div class="kpi"><b>${fmt1(st.fun)}</b><span>diversión media (1-5)</span></div>
<div class="kpi"><b>${fmt1(st.leg)}</b><span>se ve bien (1-5)</span></div><div class="kpi"><b>${pct(st.dist.volver, "Sí")}</b><span>volverían a jugar</span></div></div>
<div class="grid">${bars("Dificultad", st.dist.dificultad)}${bars("¿Volvería a jugar?", st.dist.volver)}${bars("¿Entendió el súper?", st.dist.super)}${bars("Evolución del súper", st.dist.evolucion)}${bars("Partidas jugadas", st.dist.partidas)}${bars("Idioma", st.dist.lang)}</div>
<p><a href="?key=${esc(key)}&amp;format=csv">Descargar todos los informes (CSV)</a></p>
<div class="tbl">${table}</div></div></body></html>`;
  return new Response(html, { headers: { ...headers, "content-type": "text/html; charset=utf-8" } });
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
  async scheduled(event, env, ctx) {
    ctx.waitUntil(dailyReport(env));
  },
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/tester") return handleTester(request, env);
    if (url.pathname === "/api/report") return handleReport(request, env);
    if (url.pathname === "/notfromhere/report-dziytekbyb/stats") return handleStats(request, env, url);
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
