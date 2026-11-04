// Instala el Vizions Panel (la tablet del dueño) en el Home Assistant de la casa.
//
// Lo llama el complemento al arrancar (scripts/agente-addon.mjs). Tres pasos,
// todos repetibles sin romper nada:
//
//   1. Copia la tarjeta armada a /homeassistant/www/vizions/ (HA la sirve como
//      /local/vizions/vizions-panel-card.js). Solo escribe si cambió.
//   2. Registra el recurso de la tarjeta (Ajustes → Paneles → Recursos) con la
//      versión en la dirección (?v=…), para que la tablet tome la nueva al
//      actualizar. Si ya hay uno de la tarjeta, lo actualiza; si hay repetidos,
//      deja uno solo.
//   3. Crea el tablero «Vizions Panel» (/vizions-panel) solo si ningún tablero
//      tiene ya la tarjeta. Nunca pisa un tablero que el dueño ya armó.
//
// Los pasos 2 y 3 necesitan permisos de administrador: van por el WebSocket del
// Supervisor (ws://supervisor/core/websocket) con el SUPERVISOR_TOKEN del
// complemento (config.yaml: homeassistant_api: true). El token de Vizions
// (ha_token) no es administrador y no sirve para esto.
//
// HA solo sirve /local si la carpeta www existía cuando arrancó: al final se
// revisa que la tarjeta se descargue y, si no, el registro pide reiniciar HA una vez.
//
// Nunca lanza: cada falla queda en el registro y el agente sigue.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const RUTA_LOCAL = '/local/vizions/vizions-panel-card.js';
export const TABLERO = 'vizions-panel';
export const TIPO_TARJETA = 'custom:vizions-panel-card';
export const CONFIG_TABLERO = { views: [{ title: 'Casa', path: 'panel', type: 'panel', cards: [{ type: TIPO_TARJETA }] }] };
export const DATOS_TABLERO = { url_path: TABLERO, title: 'Vizions Panel', icon: 'mdi:tablet-dashboard', mode: 'storage', require_admin: false, show_in_sidebar: true };

const md5 = (b) => createHash('md5').update(b).digest('hex');
const espera = (ms) =>
  new Promise((r) => {
    const t = setTimeout(r, ms);
    if (t.unref) t.unref();
  });
const mensaje = (e) => String(e && e.message ? e.message : e).slice(0, 300);

// Versión y dirección del recurso a partir del archivo armado.
export function datosTarjeta(texto) {
  const v = /^\/\/ Vizions Panel ([0-9][0-9.]*) /.exec(texto);
  if (!v) throw new Error('el archivo no es la tarjeta armada del Vizions Panel');
  const huella = md5(texto).slice(0, 8);
  return { version: v[1], huella, url: `${RUTA_LOCAL}?v=${v[1]}-${huella}` };
}

// Paso 1. Devuelve { archivo: 'copiado' | 'igual', wwwNueva, version, url, huellaCompleta }.
export function copiarTarjeta({ origen, configHA }) {
  if (!existsSync(origen)) throw new Error(`no está la tarjeta armada (${origen})`);
  if (!existsSync(configHA)) throw new Error(`no se ve la configuración de Home Assistant (${configHA}); falta «map: homeassistant_config» en config.yaml`);
  const texto = readFileSync(origen, 'utf8');
  const datos = datosTarjeta(texto);
  const www = join(configHA, 'www');
  const wwwNueva = !existsSync(www);
  const dir = join(www, 'vizions');
  mkdirSync(dir, { recursive: true });
  const destino = join(dir, 'vizions-panel-card.js');
  let archivo = 'igual';
  if (!existsSync(destino) || md5(readFileSync(destino)) !== md5(texto)) {
    const tmp = `${destino}.tmp-${process.pid}`;
    writeFileSync(tmp, texto);
    renameSync(tmp, destino);
    archivo = 'copiado';
  }
  return { archivo, wwwNueva, ...datos, huellaCompleta: md5(texto) };
}

// Cliente mínimo del WebSocket de Home Assistant.
export function conectar({ url, token, WS = globalThis.WebSocket, tiempoMs = 15000 }) {
  return new Promise((ok, mal) => {
    let s;
    try {
      s = new WS(url);
    } catch (e) {
      mal(new Error(`no se pudo abrir ${url}: ${mensaje(e)}`));
      return;
    }
    let id = 0;
    const pend = new Map();
    let listo = false;
    const tInicio = setTimeout(() => {
      try {
        s.close();
      } catch {
        /* nada */
      }
      mal(new Error('Home Assistant no contestó'));
    }, tiempoMs);
    if (tInicio.unref) tInicio.unref();
    const api = {
      enviar(type, extra = {}) {
        return new Promise((a, b) => {
          id += 1;
          const n = id;
          const t = setTimeout(() => {
            pend.delete(n);
            b(new Error(`${type}: sin respuesta`));
          }, tiempoMs);
          if (t.unref) t.unref();
          pend.set(n, { a, b, t, type });
          s.send(JSON.stringify({ id: n, type, ...extra }));
        });
      },
      cerrar() {
        try {
          s.close();
        } catch {
          /* ya cerrado */
        }
      },
    };
    s.onmessage = (m) => {
      let d;
      try {
        d = JSON.parse(String(m.data));
      } catch {
        return;
      }
      if (d.type === 'auth_required') s.send(JSON.stringify({ type: 'auth', access_token: token }));
      else if (d.type === 'auth_ok') {
        listo = true;
        clearTimeout(tInicio);
        ok(api);
      } else if (d.type === 'auth_invalid') {
        clearTimeout(tInicio);
        mal(new Error('Home Assistant rechazó el token del Supervisor'));
        api.cerrar();
      } else if (d.type === 'result' && pend.has(d.id)) {
        const p = pend.get(d.id);
        pend.delete(d.id);
        clearTimeout(p.t);
        if (d.success) p.a(d.result);
        else {
          const e = new Error(`${p.type}: ${d.error?.message || d.error?.code || 'falló'}`);
          e.codigo = d.error?.code;
          p.b(e);
        }
      }
    };
    s.onerror = () => {
      if (!listo) {
        clearTimeout(tInicio);
        mal(new Error(`no se pudo conectar a ${url}`));
      }
    };
    s.onclose = () => {
      for (const p of pend.values()) {
        clearTimeout(p.t);
        p.b(new Error(`${p.type}: se cerró la conexión`));
      }
      pend.clear();
    };
  });
}

const rutaDe = (u) => {
  try {
    return new URL(u, 'http://x').pathname;
  } catch {
    return '';
  }
};
const esNuestro = (r) => r && typeof r.url === 'string' && rutaDe(r.url).endsWith('/vizions-panel-card.js');

// Paso 2. Devuelve 'creado' | 'actualizado' | 'igual'.
export async function asegurarRecurso(ws, url) {
  const lista = (await ws.enviar('lovelace/resources')) || [];
  const nuestros = lista.filter(esNuestro);
  if (!nuestros.length) {
    await ws.enviar('lovelace/resources/create', { res_type: 'module', url });
    return 'creado';
  }
  // Se queda el de /local/vizions/ (si hay); los demás de la tarjeta se quitan (cargarla dos veces no sirve).
  nuestros.sort((a, b) => (rutaDe(a.url) === RUTA_LOCAL ? 0 : 1) - (rutaDe(b.url) === RUTA_LOCAL ? 0 : 1));
  const [queda, ...sobran] = nuestros;
  for (const r of sobran) await ws.enviar('lovelace/resources/delete', { resource_id: r.id });
  if (queda.url === url && queda.type === 'module') return sobran.length ? 'actualizado' : 'igual';
  await ws.enviar('lovelace/resources/update', { resource_id: queda.id, res_type: 'module', url });
  return 'actualizado';
}

const tieneTarjeta = (cfg) => JSON.stringify(cfg || {}).includes(`"${TIPO_TARJETA}"`);
async function configDe(ws, urlPath) {
  try {
    return await ws.enviar('lovelace/config', urlPath ? { url_path: urlPath } : {});
  } catch (e) {
    if (e.codigo === 'config_not_found') return null;
    throw e;
  }
}

// Paso 3. Devuelve { tablero: 'creado' | 'existe' | 'configurado' | 'ocupado', url_path }.
export async function asegurarTablero(ws) {
  const tableros = (await ws.enviar('lovelace/dashboards/list')) || [];
  // ¿Algún tablero (incluido el principal) ya tiene la tarjeta? Entonces no se crea otro.
  for (const t of [{ url_path: null }, ...tableros]) {
    let cfg = null;
    try {
      cfg = await configDe(ws, t.url_path);
    } catch {
      cfg = null; // uno que no se puede leer no detiene a los demás
    }
    if (tieneTarjeta(cfg)) return { tablero: 'existe', url_path: t.url_path || 'lovelace' };
  }
  const ya = tableros.find((t) => t.url_path === TABLERO);
  if (ya) {
    // Existe /vizions-panel sin la tarjeta: si está vacío se le pone; si el dueño lo armó a su gusto, no se toca.
    const cfg = await configDe(ws, TABLERO);
    if (cfg && Array.isArray(cfg.views) && cfg.views.length) return { tablero: 'ocupado', url_path: TABLERO };
    await ws.enviar('lovelace/config/save', { url_path: TABLERO, config: CONFIG_TABLERO });
    return { tablero: 'configurado', url_path: TABLERO };
  }
  await ws.enviar('lovelace/dashboards/create', DATOS_TABLERO);
  await ws.enviar('lovelace/config/save', { url_path: TABLERO, config: CONFIG_TABLERO });
  return { tablero: 'creado', url_path: TABLERO };
}

// ¿HA ya sirve la tarjeta? true | false (404: falta reiniciar HA) | null (no se pudo revisar,
// o contestó otra cosa: eso no lo arregla un reinicio y no se avisa).
export async function tarjetaServida(urlHa, url, huellaCompleta, { fetchImpl = globalThis.fetch, tiempoMs = 10000 } = {}) {
  if (!urlHa) return null;
  try {
    const r = await fetchImpl(urlHa.replace(/\/+$/, '') + url, { signal: AbortSignal.timeout(tiempoMs) });
    if (r.status === 404) return false;
    if (!r.ok) return null;
    return md5(Buffer.from(await r.arrayBuffer())) === huellaCompleta ? true : null;
  } catch {
    return null;
  }
}

// Todo junto. Nunca lanza; devuelve lo que hizo (para el banco).
export async function instalarPanel({
  origen,
  configHA = '/homeassistant',
  urlWs = 'ws://supervisor/core/websocket',
  token = '',
  urlHa = '',
  registrar = () => {},
  reintentosMs = [10000, 30000, 60000, 120000],
  WS = globalThis.WebSocket,
  fetchImpl = globalThis.fetch,
  tiempoMs = 15000,
} = {}) {
  const log = (e) => {
    try {
      registrar(e);
    } catch {
      /* el registro nunca rompe la instalación */
    }
  };
  if (!token) {
    log({ evento: 'panel-omitido', motivo: 'sin token del Supervisor (¿fuera de Home Assistant?)' });
    return { ok: false, omitido: true };
  }
  let copia;
  try {
    copia = copiarTarjeta({ origen, configHA });
  } catch (e) {
    log({ evento: 'panel-error', paso: 'copiar', error: mensaje(e) });
    return { ok: false, paso: 'copiar' };
  }
  let recurso;
  let tablero;
  for (let intento = 0; ; intento += 1) {
    let ws = null;
    let paso = 'conectar';
    try {
      ws = await conectar({ url: urlWs, token, WS, tiempoMs });
      paso = 'recurso';
      recurso = await asegurarRecurso(ws, copia.url);
      paso = 'tablero';
      tablero = await asegurarTablero(ws);
      ws.cerrar();
      break;
    } catch (e) {
      if (ws) ws.cerrar();
      if (intento >= reintentosMs.length) {
        log({ evento: 'panel-error', paso, error: mensaje(e) });
        return { ok: false, paso, ...copia };
      }
      log({ evento: 'panel-reintento', paso, error: mensaje(e), reintento_s: Math.round(reintentosMs[intento] / 1000) });
      await espera(reintentosMs[intento]);
    }
  }
  const servida = await tarjetaServida(urlHa, copia.url, copia.huellaCompleta, { fetchImpl });
  const r = { ok: true, version: copia.version, archivo: copia.archivo, wwwNueva: copia.wwwNueva, recurso, tablero: tablero.tablero, url_path: tablero.url_path, servida };
  log({ evento: 'panel', version: r.version, archivo: r.archivo, recurso, tablero: r.tablero, tablero_url: `/${r.url_path}` });
  if (servida === false) log({ evento: 'panel-aviso', motivo: 'Reinicia Home Assistant una vez (Ajustes → Sistema → Reiniciar) para que sirva la carpeta www y cargue la tarjeta' });
  if (tablero.tablero === 'ocupado') log({ evento: 'panel-aviso', motivo: `El tablero /${TABLERO} ya existe con otro contenido; no se tocó. Agrega la tarjeta «${TIPO_TARJETA}» a mano.` });
  return r;
}
