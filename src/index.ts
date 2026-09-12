// ═══════════════════════════════════════════════════════════════════════════
//  SERVIDOR DE LICENCIAS  (infraestructura del PROVEEDOR — tú)
//  Genera y valida las llaves de licencia del producto (Formulario COD).
//
//  Endpoints:
//   • POST /validate           (público) — lo llama la app del comprador.
//   • GET  /admin              (privado) — panel para generar/ver/revocar llaves.
//   • POST /admin/issue        (privado) — genera una llave nueva (3 meses).
//   • POST /admin/renew        (privado) — extiende los meses de una llave.
//   • POST /admin/revoke       (privado) — anula una llave (queda inservible).
//   • GET  /admin/list         (privado) — lista todas las llaves.
//
//  Los endpoints /admin/* exigen el header  x-admin-secret == LICENSE_ADMIN_SECRET.
// ═══════════════════════════════════════════════════════════════════════════

interface Env {
  LICENSES: KVNamespace;
  LICENSE_ADMIN_SECRET?: string;
}

interface License {
  buyer: string; // nombre/ref del comprador (para que sepas de quién es)
  createdAt: number; // epoch ms
  updatesUntil: number; // epoch ms — hasta cuándo recibe actualizaciones (compra + 3 meses)
  store: string | null; // tienda a la que quedó amarrada (se fija en la 1ª validación)
  revoked: boolean;
}

const DAY = 24 * 60 * 60 * 1000;

function jsonRes(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" },
  });
}

// Normaliza el dominio de tienda para comparar (minúsculas, sin protocolo/barras).
function normStore(s: string): string {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");
}

// Genera una llave tipo COD-XXXX-XXXX-XXXX-XXXX (sin caracteres confusos).
function genKey(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sin I,O,0,1
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < 16; i++) {
    out += alphabet[bytes[i] % alphabet.length];
    if (i % 4 === 3 && i !== 15) out += "-";
  }
  return "COD-" + out;
}

function isAdmin(req: Request, env: Env): boolean {
  if (!env.LICENSE_ADMIN_SECRET) return false;
  const got = req.headers.get("x-admin-secret") || "";
  return got.length > 0 && got === env.LICENSE_ADMIN_SECRET;
}

async function getLicense(env: Env, key: string): Promise<License | null> {
  const raw = await env.LICENSES.get("license:" + key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as License;
  } catch {
    return null;
  }
}

async function putLicense(env: Env, key: string, lic: License): Promise<void> {
  await env.LICENSES.put("license:" + key, JSON.stringify(lic));
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;

    if (req.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, x-admin-secret",
        },
      });
    }

    // ── VALIDAR (público) — lo llama la app del comprador ────────────────────
    if (req.method === "POST" && path === "/validate") {
      let body: { key?: string; store?: string };
      try {
        body = await req.json();
      } catch {
        return jsonRes({ valid: false, updates: false, reason: "json" }, 400);
      }
      const key = String(body.key || "").trim();
      const store = normStore(body.store || "");
      if (!key) return jsonRes({ valid: false, updates: false, reason: "sin-llave" });

      const lic = await getLicense(env, key);
      if (!lic) return jsonRes({ valid: false, updates: false, reason: "no-existe" });
      if (lic.revoked) return jsonRes({ valid: false, updates: false, reason: "revocada" });

      // Amarre a una sola tienda: se fija en la 1ª validación con tienda.
      if (!lic.store) {
        if (store) {
          lic.store = store;
          await putLicense(env, key, lic);
        }
      } else if (store && lic.store !== store) {
        // Llave usada en OTRA tienda distinta a la que se activó → rechaza.
        return jsonRes({ valid: false, updates: false, reason: "otra-tienda" });
      }

      // updates = ¿dentro de los 3 meses? (vencido NO invalida: sigue funcionando)
      const updates = Date.now() < lic.updatesUntil;
      return jsonRes({ valid: true, updates, reason: updates ? "activa" : "vencida-updates" });
    }

    // ── ADMIN ────────────────────────────────────────────────────────────────
    if (path === "/admin" && req.method === "GET") {
      return new Response(adminHtml(), { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
    }

    if (path.startsWith("/admin/")) {
      if (!isAdmin(req, env)) return jsonRes({ ok: false, error: "No autorizado." }, 401);

      if (req.method === "POST" && path === "/admin/issue") {
        let body: { buyer?: string; months?: number };
        try {
          body = await req.json();
        } catch {
          return jsonRes({ ok: false, error: "json" }, 400);
        }
        const buyer = String(body.buyer || "").trim() || "sin-nombre";
        const months = Number(body.months) > 0 ? Number(body.months) : 3;
        const now = Date.now();
        const key = genKey();
        const lic: License = {
          buyer,
          createdAt: now,
          updatesUntil: now + months * 30 * DAY,
          store: null,
          revoked: false,
        };
        await putLicense(env, key, lic);
        return jsonRes({ ok: true, key, license: lic });
      }

      if (req.method === "POST" && path === "/admin/renew") {
        let body: { key?: string; months?: number };
        try {
          body = await req.json();
        } catch {
          return jsonRes({ ok: false, error: "json" }, 400);
        }
        const key = String(body.key || "").trim();
        const months = Number(body.months) > 0 ? Number(body.months) : 3;
        const lic = await getLicense(env, key);
        if (!lic) return jsonRes({ ok: false, error: "no-existe" }, 404);
        // Extiende desde hoy o desde el vencimiento (lo que sea mayor).
        const base = Math.max(Date.now(), lic.updatesUntil);
        lic.updatesUntil = base + months * 30 * DAY;
        await putLicense(env, key, lic);
        return jsonRes({ ok: true, license: lic });
      }

      if (req.method === "POST" && path === "/admin/revoke") {
        let body: { key?: string; revoked?: boolean };
        try {
          body = await req.json();
        } catch {
          return jsonRes({ ok: false, error: "json" }, 400);
        }
        const key = String(body.key || "").trim();
        const lic = await getLicense(env, key);
        if (!lic) return jsonRes({ ok: false, error: "no-existe" }, 404);
        lic.revoked = body.revoked === false ? false : true;
        await putLicense(env, key, lic);
        return jsonRes({ ok: true, license: lic });
      }

      if (req.method === "GET" && path === "/admin/list") {
        const out: Array<{ key: string } & License> = [];
        let cursor: string | undefined;
        do {
          const list = await env.LICENSES.list({ prefix: "license:", cursor });
          for (const k of list.keys) {
            const lic = await getLicense(env, k.name.replace("license:", ""));
            if (lic) out.push({ key: k.name.replace("license:", ""), ...lic });
          }
          cursor = list.list_complete ? undefined : list.cursor;
        } while (cursor);
        out.sort((a, b) => b.createdAt - a.createdAt);
        return jsonRes({ ok: true, licenses: out });
      }

      return jsonRes({ ok: false, error: "Ruta admin no encontrada." }, 404);
    }

    if (path === "/" || path === "/health") {
      return jsonRes({ ok: true, service: "cod-licencias" });
    }

    return jsonRes({ ok: false, error: "Ruta no encontrada." }, 404);
  },
};

// Panel HTML mínimo para generar/ver/revocar llaves (protegido por el secreto).
function adminHtml(): string {
  return `<!doctype html><html lang="es"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Licencias — Formulario COD</title>
<style>
:root{color-scheme:light dark}
body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:#f4f6f5;color:#17211d;padding:22px 14px 60px}
@media(prefers-color-scheme:dark){body{background:#0f1613;color:#eaf0ec}.card{background:#161d19!important;border-color:#29332d!important}input{background:#0f1613!important;color:#eaf0ec!important;border-color:#29332d!important}th{color:#9aa8a1!important}tr{border-color:#29332d!important}}
.wrap{max-width:760px;margin:0 auto}
h1{font-size:1.3rem;margin:0 0 4px}p.sub{color:#5f6b64;margin:0 0 18px;font-size:.9rem}
.card{background:#fff;border:1px solid #e4e7e2;border-radius:14px;padding:18px;margin-bottom:16px}
label{display:block;font-size:.8rem;font-weight:700;margin:10px 0 4px}
input{width:100%;box-sizing:border-box;padding:11px 12px;font-size:16px;border:1px solid #d7dcd8;border-radius:9px}
button{margin-top:12px;padding:11px 16px;font-size:15px;font-weight:700;border:0;border-radius:9px;background:#1f6f54;color:#fff;cursor:pointer}
button.sec{background:transparent;border:1px solid #c33;color:#c33;padding:6px 10px;font-size:13px;margin:0}
.key{font-family:ui-monospace,Menlo,monospace;font-weight:700;font-size:1.1rem;letter-spacing:.5px;background:#eaf6f0;color:#0d5a3f;padding:10px 12px;border-radius:8px;display:inline-block;margin-top:8px;user-select:all}
table{width:100%;border-collapse:collapse;margin-top:8px;font-size:.82rem}
th,td{text-align:left;padding:7px 6px;border-bottom:1px solid #eee;vertical-align:top}
th{font-size:.72rem;text-transform:uppercase;color:#8a948f}
code{font-family:ui-monospace,Menlo,monospace}
.muted{color:#8a948f}.ok{color:#1f8f5f;font-weight:700}.warn{color:#c88a00;font-weight:700}.bad{color:#c33;font-weight:700}
.hide{display:none}
</style></head><body><div class="wrap">
<h1>🔑 Licencias — Formulario COD</h1>
<p class="sub">Genera una llave al vender. Pégala en tu clave de administrador para entrar.</p>

<div class="card" id="authCard">
  <label>Clave de administrador (LICENSE_ADMIN_SECRET)</label>
  <input id="secret" type="password" placeholder="tu clave de administrador" autocomplete="off">
  <button onclick="enter()">Entrar</button>
  <p id="authErr" class="bad hide" style="margin:10px 0 0">Clave incorrecta.</p>
</div>

<div id="app" class="hide">
  <div class="card">
    <b>Generar una llave nueva</b>
    <label>Nombre / referencia del comprador</label>
    <input id="buyer" placeholder="Ej: Juan Pérez - Tienda X">
    <label>Meses de actualizaciones/soporte (por defecto 3)</label>
    <input id="months" type="number" value="3" min="1">
    <button onclick="issue()">Generar llave</button>
    <div id="issued" class="hide" style="margin-top:12px">
      <div>Entrega esta llave al comprador:</div>
      <div class="key" id="newKey"></div>
    </div>
  </div>

  <div class="card">
    <b>Llaves emitidas</b>
    <button class="sec" style="border-color:#1f6f54;color:#1f6f54;float:right" onclick="load()">Refrescar</button>
    <div id="list"><p class="muted">Cargando…</p></div>
  </div>
</div>

<script>
var S="";
function h(){return {"Content-Type":"application/json","x-admin-secret":S}}
function enter(){
  S=document.getElementById('secret').value.trim();
  fetch('/admin/list',{headers:{"x-admin-secret":S}}).then(function(r){
    if(r.status===401){document.getElementById('authErr').classList.remove('hide');return}
    document.getElementById('authCard').classList.add('hide');
    document.getElementById('app').classList.remove('hide');
    load();
  });
}
function issue(){
  var buyer=document.getElementById('buyer').value.trim();
  var months=parseInt(document.getElementById('months').value,10)||3;
  fetch('/admin/issue',{method:'POST',headers:h(),body:JSON.stringify({buyer:buyer,months:months})})
   .then(function(r){return r.json()}).then(function(d){
     if(d.ok){document.getElementById('issued').classList.remove('hide');
       document.getElementById('newKey').textContent=d.key;
       document.getElementById('buyer').value='';load();}
     else alert('Error: '+(d.error||'?'));
   });
}
function fmt(ms){var dt=new Date(ms);return dt.getFullYear()+'-'+String(dt.getMonth()+1).padStart(2,'0')+'-'+String(dt.getDate()).padStart(2,'0')}
function load(){
  fetch('/admin/list',{headers:{"x-admin-secret":S}}).then(function(r){return r.json()}).then(function(d){
    if(!d.ok){document.getElementById('list').innerHTML='<p class="bad">No autorizado.</p>';return}
    if(!d.licenses.length){document.getElementById('list').innerHTML='<p class="muted">Aún no hay llaves.</p>';return}
    var now=Date.now();
    var rows=d.licenses.map(function(l){
      var estado=l.revoked?'<span class="bad">Revocada</span>':(now<l.updatesUntil?'<span class="ok">Activa</span>':'<span class="warn">Vencida (funciona, sin updates)</span>');
      var tienda=l.store?('<code>'+l.store+'</code>'):'<span class="muted">sin activar</span>';
      var btn=l.revoked?('<button class="sec" style="border-color:#1f6f54;color:#1f6f54" onclick="revoke(\\''+l.key+'\\',false)">Reactivar</button>'):('<button class="sec" onclick="revoke(\\''+l.key+'\\',true)">Revocar</button>');
      return '<tr><td><code>'+l.key+'</code></td><td>'+(l.buyer||'')+'</td><td>'+tienda+'</td><td>'+estado+'<div class="muted">updates hasta '+fmt(l.updatesUntil)+'</div></td><td>'+btn+'</td></tr>';
    }).join('');
    document.getElementById('list').innerHTML='<table><thead><tr><th>Llave</th><th>Comprador</th><th>Tienda</th><th>Estado</th><th></th></tr></thead><tbody>'+rows+'</tbody></table>';
  });
}
function revoke(key,val){
  fetch('/admin/revoke',{method:'POST',headers:h(),body:JSON.stringify({key:key,revoked:val})})
   .then(function(r){return r.json()}).then(function(){load()});
}
</script>
</div></body></html>`;
}
