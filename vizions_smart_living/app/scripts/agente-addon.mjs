// Agente de Vizions Smart Living dentro del complemento de Home Assistant.
//
// Lee las Opciones del complemento (/data/options.json, las escribe el
// Supervisor de Home Assistant) y arranca el adaptador y el agente, igual que
// scripts/agente.mjs pero sin archivos en la casa: la llave de la propiedad y
// el token de Home Assistant se capturan en la pantalla del complemento.
//
// Qué controla el huésped: lo que tenga la etiqueta de las Opciones («Vizions»)
// en Home Assistant (src/descubrir.mjs), más los dispositivos escritos a mano
// en «dispositivos». Si cambia la lista, el agente se rearma solo.
//
// Salidas: 0 = lo detuvo Home Assistant (SIGTERM). 2 = Opciones inválidas
// (run.sh no reintenta: hay que corregirlas). Cualquier otra = falla; run.sh
// lo vuelve a arrancar.
//
// Vizions Panel (la tablet del dueño): con la opción «panel» (encendida de
// fábrica) instala la tarjeta, su recurso y el tablero (src/panel-instalar.mjs)
// en segundo plano; si algo falla queda en el registro y el agente sigue.
//
// Ningún registro incluye la llave ni el token.

import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { crearAdaptador, validarMapeo } from '../src/adaptador.mjs';
import { crearAgente } from '../src/agente.mjs';
import { crearDescubridor } from '../src/descubrir.mjs';
import { instalarPanel } from '../src/panel-instalar.mjs';
import { ID_VALIDO } from '../src/protocolo.mjs';

export class ErrorOpciones extends Error {}

const texto = (v) => typeof v === 'string' && v.trim() !== '';

// Opciones del complemento → configuración del adaptador y del agente.
export function configDeOpciones(o, { permitirWs = false } = {}) {
  const falla = (msg) => {
    throw new ErrorOpciones(msg);
  };
  if (!o || typeof o !== 'object' || Array.isArray(o)) falla('No hay Opciones');
  const propiedad = typeof o.propiedad === 'string' ? o.propiedad.trim() : '';
  if (!ID_VALIDO.test(propiedad)) falla('«propiedad» inválida: minúsculas, números y guiones (ej. casadelrey-p1)');
  if (!texto(o.llave) || o.llave.trim().length < 32) falla('Falta la «llave» de la propiedad (la da Vizions)');
  let puerta;
  try {
    puerta = new URL(String(o.puerta || ''));
  } catch {
    falla('«puerta» inválida');
  }
  if (puerta.protocol !== 'wss:' && !(permitirWs && puerta.protocol === 'ws:')) falla('«puerta» debe empezar con wss://');
  let ha;
  try {
    ha = new URL(String(o.ha_url || ''));
  } catch {
    falla('«ha_url» inválida');
  }
  if (ha.protocol !== 'http:' && ha.protocol !== 'https:') falla('«ha_url» debe ser http:// o https://');
  if (!texto(o.ha_token)) falla('Falta el «ha_token» de Home Assistant');
  const etiqueta = typeof o.etiqueta === 'string' ? o.etiqueta.trim() : '';
  if (o.dispositivos !== undefined && !Array.isArray(o.dispositivos)) falla('«dispositivos» debe ser una lista');
  if (o.panel !== undefined && typeof o.panel !== 'boolean') falla('«panel» debe ser verdadero o falso');
  const lista = o.dispositivos || [];
  if (!etiqueta && lista.length === 0) falla('Pon la «etiqueta» (Vizions) o agrega dispositivos en «dispositivos»');
  const dispositivos = lista.map((d, i) => {
    if (!d || typeof d !== 'object') falla(`dispositivo #${i + 1}: debe tener id, tipo, entidad, nombre_es y nombre_en`);
    return {
      id: String(d.id || '').trim(),
      tipo: String(d.tipo || '').trim(),
      entidad: String(d.entidad || '').trim(),
      nombre: { es: String(d.nombre_es || '').trim(), en: String(d.nombre_en || '').trim() },
    };
  });
  return {
    propiedad,
    llave: o.llave.trim(),
    urlPuerta: puerta.href,
    urlBase: ha.origin,
    token: o.ha_token.trim(),
    etiqueta,
    panel: o.panel !== false,
    mapeo: { dispositivos },
  };
}

const hora = () => new Date().toISOString();
const log = (e) => console.log(hora(), JSON.stringify(e));

export function arrancar(cfg) {
  const adaptador = crearAdaptador({
    urlBase: cfg.urlBase,
    token: cfg.token,
    mapeo: cfg.mapeo,
    registrar: (e) => log({ evento: 'orden', ...e }),
  });
  const agente = crearAgente({ urlPuerta: cfg.urlPuerta, propiedad: cfg.propiedad, llave: cfg.llave, adaptador, registrar: log });
  adaptador.suscribir((ev) => {
    if (ev.tipo === 'conexion') log({ evento: 'home-assistant', conectado: ev.conectado });
    // ADAPTADOR-RECONEXION-01: por qué no conecta (token rechazado, sin respuesta, sin pong); sigue reintentando
    if (ev.tipo === 'aviso') log({ evento: 'home-assistant-aviso', motivo: ev.motivo, ...(ev.reintentoMs ? { reintento_s: Math.round(ev.reintentoMs / 1000) } : {}) });
  });
  agente.iniciar();
  log({ evento: 'arranque', propiedad: cfg.propiedad, puerta: cfg.urlPuerta, dispositivos: cfg.mapeo.dispositivos.map((d) => d.id) });
  return {
    cerrar() {
      agente.cerrar();
      adaptador.cerrar();
    },
  };
}

// Arranca con los dispositivos fijos y, si hay etiqueta, espera el primer
// descubrimiento (hasta esperaInicialMs) para no conectarse dos veces al inicio.
// Cada lista nueva se valida antes de soltar la anterior.
export function iniciarAddon(cfg, { esperaInicialMs = 10000, opcionesDescubridor = {} } = {}) {
  let corriendo = null;
  let firma = null;
  let cerrado = false;
  const poner = (dispositivos, motivo) => {
    if (cerrado) return;
    clearTimeout(tInicial);
    const f = JSON.stringify(dispositivos);
    if (f === firma) return;
    try {
      validarMapeo({ dispositivos });
    } catch (e) {
      log({ evento: 'lista-rechazada', error: String(e && e.message ? e.message : e) });
      return;
    }
    if (corriendo) {
      corriendo.cerrar();
      log({ evento: 'rearmado', motivo, dispositivos: dispositivos.map((d) => d.id) });
    }
    firma = f;
    corriendo = arrancar({ ...cfg, mapeo: { dispositivos } });
  };
  let tInicial = null;
  let descubridor = null;
  if (cfg.etiqueta) {
    descubridor = crearDescubridor({
      urlBase: cfg.urlBase,
      token: cfg.token,
      etiqueta: cfg.etiqueta,
      fijos: cfg.mapeo.dispositivos,
      alCambiar: (lista) => poner(lista, 'etiqueta'),
      registrar: log,
      ...opcionesDescubridor,
    });
    tInicial = setTimeout(() => poner(cfg.mapeo.dispositivos, 'sin-descubrimiento'), esperaInicialMs);
    descubridor.iniciar();
  } else {
    poner(cfg.mapeo.dispositivos, 'fijos');
  }
  return {
    cerrar() {
      cerrado = true;
      clearTimeout(tInicial);
      if (descubridor) descubridor.cerrar();
      if (corriendo) corriendo.cerrar();
    },
  };
}

async function main() {
  let cfg;
  try {
    const ruta = process.env.SL_OPCIONES || '/data/options.json';
    cfg = configDeOpciones(JSON.parse(readFileSync(ruta, 'utf8')), { permitirWs: process.env.SL_PERMITIR_WS === '1' });
  } catch (e) {
    log({ evento: 'opciones-invalidas', error: e instanceof ErrorOpciones ? e.message : 'No se pudieron leer las Opciones' });
    process.exit(2);
  }
  let corriendo;
  try {
    validarMapeo(cfg.mapeo);
    corriendo = iniciarAddon(cfg);
  } catch (e) {
    // El mapeo lo valida el adaptador; sus mensajes no llevan secretos.
    log({ evento: 'opciones-invalidas', error: String(e && e.message ? e.message : e) });
    process.exit(2);
  }
  if (cfg.panel) {
    instalarPanel({
      origen: process.env.SL_PANEL_TARJETA || fileURLToPath(new URL('../panel/vizions-panel-card.js', import.meta.url)),
      configHA: process.env.SL_HA_CONFIG || '/homeassistant',
      urlWs: process.env.SL_SUPERVISOR_WS || 'ws://supervisor/core/websocket',
      token: process.env.SUPERVISOR_TOKEN || '',
      urlHa: cfg.urlBase,
      registrar: log,
    });
  } else log({ evento: 'panel-omitido', motivo: 'opción «panel» apagada' });
  const salir = () => {
    log({ evento: 'detenido' });
    corriendo.cerrar();
    process.exit(0);
  };
  process.on('SIGTERM', salir);
  process.on('SIGINT', salir);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main();
