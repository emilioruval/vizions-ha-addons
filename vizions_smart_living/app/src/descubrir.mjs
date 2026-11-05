// Descubre en Home Assistant los dispositivos con la etiqueta de Vizions.
//
// El instalador marca en Home Assistant (con la etiqueta «Vizions») qué puede
// controlar el huésped. Este módulo lee las etiquetas, los dispositivos, las
// entidades y los estados con el usuario de Vizions (no necesita admin) y arma
// el mapeo del adaptador. Escucha los cambios del registro de Home Assistant:
// poner o quitar la etiqueta se refleja en segundos, sin reiniciar nada.
//
// Reglas:
//   · solo entidades de los dominios de algún tipo: luz (light, switch),
//     escena (scene, script), cortina (cover), clima (climate) y bocina
//     (media_player);
//   · una entidad con la etiqueta entra siempre (salvo deshabilitada);
//   · si la etiqueta está en el dispositivo, entran sus luces, apagadores,
//     persianas, aires y bocinas normales: no los de configuración/diagnóstico (bloqueo
//     infantil, luz del indicador…) ni los ocultos. Las escenas y scripts
//     entran solo con la etiqueta puesta en ellos (un hub no mete sus escenas);
//   · aires: la pantalla del aparato (switch «…display» / «Pantalla») se
//     amarra al aire como extra; ningún interruptor de un aparato que tenga
//     un aire entra como luz (AC Freedom crea Display, Sleep, Health, Eco…);
//   · bocinas: tampoco entran los interruptores de un aparato que tenga una
//     bocina (Sonos crea Loudness, Crossfade, Night sound…);
//   · nombres repetidos que arma HA («Dining Room Dining Room») quedan en uno;
//   · el id sale del entity_id (switch.escritorio_interruptor_1 →
//     escritorio-interruptor-1), el nombre de Home Assistant y el inglés de
//     traducirNombre.

import { TIPOS, TIPO_DE_DOMINIO } from './tipos.mjs';
import { traducirNombre } from './traducir.mjs';

// Los que entran por la etiqueta del dispositivo (las escenas no).
const POR_APARATO = [...TIPOS.luz.dominios, ...TIPOS.cortina.dominios, ...TIPOS.clima.dominios, ...TIPOS.bocina.dominios];
const PANTALLA = /(^|[^a-z])(display|pantalla)([^a-z]|$)/i;
const ENTIDAD_VALIDA = /^[a-z_]+\.[a-z0-9_]+$/;
const EVENTOS = ['entity_registry_updated', 'device_registry_updated', 'label_registry_updated'];
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();

// «Dining Room Dining Room» → «Dining Room» (HA junta el nombre del aparato y el de la entidad).
function sinRepetir(nombre) {
  const p = nombre.split(/\s+/);
  if (p.length >= 2 && p.length % 2 === 0) {
    const m = p.length / 2;
    if (p.slice(0, m).join(' ').toLowerCase() === p.slice(m).join(' ').toLowerCase()) return p.slice(0, m).join(' ');
  }
  return nombre;
}

function idDe(entidad, usados) {
  const [dominio, objeto] = entidad.split('.');
  const limpio = (s) => s.replace(/_+/g, '-').replace(/^-+|-+$/g, '').slice(0, 63).replace(/-+$/, '');
  for (const c of [limpio(objeto), limpio(`${dominio}-${objeto}`)]) if (c && !usados.has(c)) return c;
  for (let i = 2; ; i += 1) {
    const c = `${limpio(objeto).slice(0, 58).replace(/-+$/, '')}-${i}`;
    if (!usados.has(c)) return c;
  }
}

// Registro de Home Assistant → lista de dispositivos del mapeo.
// `fijos` son los dispositivos escritos a mano en las Opciones: van primero y
// mandan sobre los descubiertos (misma entidad = se usa el fijo).
export function dispositivosEtiquetados({ etiquetas = [], dispositivos = [], entidades = [], estados = [] }, nombreEtiqueta, fijos = []) {
  const objetivo = norm(nombreEtiqueta);
  const marcas = new Set(objetivo ? etiquetas.filter((l) => norm(l.name) === objetivo).map((l) => l.label_id) : []);
  const tiene = (x) => Array.isArray(x?.labels) && x.labels.some((l) => marcas.has(l));
  const aparatos = new Map(dispositivos.map((d) => [d.id, d]));
  const amigable = new Map(estados.map((s) => [s.entity_id, s.attributes?.friendly_name]));
  const lista = fijos.map((d) => ({ ...d }));
  const usados = new Set(lista.map((d) => d.id));
  const yaEstan = new Set(lista.map((d) => d.entidad));
  for (const d of fijos) for (const x of Object.values(d.extras ?? {})) yaEstan.add(x);
  if (!marcas.size) return { etiqueta: false, dispositivos: lista };
  const validas = entidades.filter((e) => typeof e?.entity_id === 'string' && ENTIDAD_VALIDA.test(e.entity_id));
  const dominio = (e) => e.entity_id.split('.')[0];
  // Aparatos que tienen un aire o una bocina: sus interruptores son ajustes de ese aparato, no luces.
  const conPrincipal = new Set(validas.filter((e) => ['climate', 'media_player'].includes(dominio(e)) && e.device_id).map((e) => e.device_id));
  const elegidas = validas
    .filter((e) => Object.hasOwn(TIPO_DE_DOMINIO, dominio(e)) && !e.disabled_by && !yaEstan.has(e.entity_id))
    .filter((e) => !(dominio(e) === 'switch' && e.device_id && conPrincipal.has(e.device_id)))
    .filter((e) => {
      if (tiene(e)) return true;
      if (!POR_APARATO.includes(e.entity_id.split('.')[0])) return false;
      const ap = e.device_id ? aparatos.get(e.device_id) : null;
      return !!ap && tiene(ap) && !ap.disabled_by && !e.entity_category && !e.hidden_by;
    })
    .sort((a, b) => (a.entity_id < b.entity_id ? -1 : a.entity_id > b.entity_id ? 1 : 0));
  for (const e of elegidas) {
    const id = idDe(e.entity_id, usados);
    usados.add(id);
    const es = sinRepetir(String(amigable.get(e.entity_id) || e.name || e.original_name || e.entity_id.split('.')[1].replace(/_/g, ' ')).trim().replace(/\s+/g, ' '));
    const tipo = TIPO_DE_DOMINIO[dominio(e)];
    const disp = { id, tipo, entidad: e.entity_id, nombre: { es, en: traducirNombre(es, { tipo }) || es } };
    if (tipo === 'clima' && e.device_id) {
      // La pantalla del mismo aparato (la primera por entity_id), aunque no tenga la etiqueta.
      const pantalla = validas
        .filter((x) => x.device_id === e.device_id && dominio(x) === 'switch' && !x.disabled_by && !yaEstan.has(x.entity_id))
        .filter((x) => PANTALLA.test(x.entity_id.split('.')[1].replace(/_/g, ' ')) || PANTALLA.test(String(x.name || '')) || PANTALLA.test(String(x.original_name || '')) || x.translation_key === 'display')
        .sort((a, b) => (a.entity_id < b.entity_id ? -1 : 1))[0];
      if (pantalla) {
        disp.extras = { pantalla: pantalla.entity_id };
        yaEstan.add(pantalla.entity_id);
      }
    }
    lista.push(disp);
  }
  return { etiqueta: true, dispositivos: lista };
}

// Conexión propia a Home Assistant que vigila el registro y avisa con
// alCambiar(lista) cada vez que cambia lo que el huésped puede controlar.
//
// SMART-LIVING-DESCUBRIR-VIGIA-01: se recupera solo cuando HA se reinicia, igual
// que el adaptador (ADAPTADOR-RECONEXION-01). Antes, una conexión aceptada a medio
// reinicio que nunca contestaba, o una consulta sin respuesta, lo dejaban trabado
// para siempre: ya no se enteraba de las etiquetas hasta reiniciar el complemento.
//   · la conexión tiene tiempoConexionMs para autenticarse;
//   · ya conectada, un ping cada intervaloPingMs: sin pong en tiempoPongMs, se corta;
//   · cada consulta tiene tiempoPeticionMs: sin respuesta cuenta como fallo y la
//     siguiente revisión vuelve a intentar (ya no se queda esperando para siempre);
//   · cortar suelta la conexión sin esperar su cierre y reintenta una sola vez
//     (el cierre tardío de la vieja no abre otra);
//   · el sondeo solo consulta con la conexión ya autenticada.
export function crearDescubridor({
  urlBase,
  token,
  etiqueta,
  fijos = [],
  alCambiar,
  WebSocketImpl = globalThis.WebSocket,
  esperaMs = 1500,
  intervaloMs = 60000,
  reconexionMs = [1000, 2000, 5000, 10000, 30000],
  tiempoConexionMs = 15000,
  tiempoPeticionMs = 15000,
  intervaloPingMs = 30000,
  tiempoPongMs = 10000,
  registrar = () => {},
} = {}) {
  const url = new URL(urlBase);
  const urlWs = `${url.protocol === 'https:' ? 'wss:' : 'ws:'}//${url.host}/api/websocket`;
  let ws = null;
  let listo = false; // conexión autenticada
  let cerrado = false;
  let intentos = 0;
  let siguiente = 1;
  const pendientes = new Map();
  let ultimo = null;
  let tRefresco = null;
  let tSondeo = null;
  let tReconexion = null;
  let enCurso = false;
  let otraVez = false;
  const vigia = { conexion: null, ping: null, pong: null };

  function soltarVigia() {
    clearTimeout(vigia.conexion);
    clearInterval(vigia.ping);
    clearTimeout(vigia.pong);
    vigia.conexion = vigia.ping = vigia.pong = null;
  }

  function rechazarPendientes() {
    for (const p of pendientes.values()) {
      clearTimeout(p.t);
      p.mal(new Error('sin conexión'));
    }
    pendientes.clear();
  }

  function programarReconexion() {
    if (cerrado) return;
    clearTimeout(tReconexion);
    const espera = reconexionMs[Math.min(intentos, reconexionMs.length - 1)];
    intentos += 1;
    tReconexion = setTimeout(conectar, espera);
  }

  // Suelta la conexión s (si sigue siendo la actual) y programa un solo reintento.
  function soltar(s) {
    if (ws !== s) return;
    ws = null;
    listo = false;
    soltarVigia();
    rechazarPendientes();
    programarReconexion();
  }

  // Corta una conexión que no responde (o que HA rechazó): no espera a que se cierre.
  function cortar(s, motivo) {
    if (ws !== s) return;
    if (motivo) registrar({ evento: 'descubrimiento-aviso', motivo });
    soltar(s);
    try {
      s.close();
    } catch {
      /* ya estaba cerrándose */
    }
  }

  const pedir = (tipo, extra = {}) =>
    new Promise((ok, mal) => {
      const s = ws;
      if (!s || !listo || s.readyState !== 1) return mal(new Error('sin conexión'));
      const id = siguiente++;
      const t = setTimeout(() => {
        if (!pendientes.has(id)) return;
        pendientes.delete(id);
        mal(new Error('sin respuesta'));
      }, tiempoPeticionMs);
      pendientes.set(id, { ok, mal, t });
      try {
        s.send(JSON.stringify({ id, type: tipo, ...extra }));
      } catch {
        /* el temporizador lo resuelve */
      }
    });

  async function refrescar() {
    if (enCurso) {
      otraVez = true;
      return;
    }
    enCurso = true;
    try {
      const [etiquetas, dispositivos, entidades, estados] = await Promise.all([
        pedir('config/label_registry/list'),
        pedir('config/device_registry/list'),
        pedir('config/entity_registry/list'),
        pedir('get_states'),
      ]);
      const r = dispositivosEtiquetados({ etiquetas, dispositivos, entidades, estados }, etiqueta, fijos);
      const firma = JSON.stringify(r.dispositivos);
      if (firma !== ultimo) {
        ultimo = firma;
        registrar({ evento: 'descubrimiento', etiqueta: r.etiqueta, dispositivos: r.dispositivos.map((d) => d.id) });
        alCambiar(r.dispositivos);
      }
    } catch (e) {
      registrar({ evento: 'descubrimiento-fallo', error: String(e && e.message ? e.message : e) });
    } finally {
      enCurso = false;
      if (otraVez) {
        otraVez = false;
        programar();
      }
    }
  }

  function programar() {
    if (cerrado) return;
    clearTimeout(tRefresco);
    tRefresco = setTimeout(refrescar, esperaMs);
  }

  function conectar() {
    if (cerrado || ws) return;
    let s;
    try {
      s = new WebSocketImpl(urlWs);
    } catch {
      programarReconexion();
      return;
    }
    ws = s;
    listo = false;
    soltarVigia();
    vigia.conexion = setTimeout(() => {
      if (ws === s && !listo) cortar(s, 'SIN_RESPUESTA');
    }, tiempoConexionMs);
    s.onmessage = (m) => {
      if (ws !== s) return;
      let d;
      try {
        d = JSON.parse(typeof m.data === 'string' ? m.data : String(m.data));
      } catch {
        return;
      }
      if (d.type === 'auth_required') return s.send(JSON.stringify({ type: 'auth', access_token: token }));
      if (d.type === 'auth_invalid') {
        registrar({ evento: 'descubrimiento-fallo', error: 'Home Assistant rechazó el token' });
        return cortar(s, null);
      }
      if (d.type === 'auth_ok') {
        intentos = 0;
        listo = true;
        clearTimeout(vigia.conexion);
        vigia.conexion = null;
        clearInterval(vigia.ping);
        vigia.ping = setInterval(() => {
          if (ws !== s || vigia.pong) return;
          try {
            s.send(JSON.stringify({ id: siguiente++, type: 'ping' }));
          } catch {
            /* el temporizador lo resuelve */
          }
          vigia.pong = setTimeout(() => cortar(s, 'SIN_PONG'), tiempoPongMs);
        }, intervaloPingMs);
        for (const ev of EVENTOS) pedir('subscribe_events', { event_type: ev }).catch(() => {});
        refrescar();
        return;
      }
      if (d.type === 'pong') {
        clearTimeout(vigia.pong);
        vigia.pong = null;
        return;
      }
      if (d.type === 'event') return programar();
      if (d.type === 'result' && pendientes.has(d.id)) {
        const p = pendientes.get(d.id);
        pendientes.delete(d.id);
        clearTimeout(p.t);
        if (d.success) p.ok(d.result);
        else p.mal(new Error((d.error && d.error.code) || 'error'));
      }
    };
    s.onclose = () => soltar(s);
    s.onerror = () => {};
  }

  return {
    iniciar() {
      conectar();
      tSondeo = setInterval(() => {
        if (ws && listo && ws.readyState === 1) refrescar();
      }, intervaloMs);
    },
    cerrar() {
      cerrado = true;
      clearTimeout(tRefresco);
      clearTimeout(tReconexion);
      clearInterval(tSondeo);
      soltarVigia();
      const s = ws;
      ws = null;
      listo = false;
      rechazarPendientes();
      if (s && typeof s.close === 'function') {
        try {
          s.close();
        } catch {
          /* ya cerrada */
        }
      }
    },
  };
}
