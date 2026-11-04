// Adaptador Smart Living ↔ Home Assistant.
//
// Traduce órdenes de Smart Living («encender luz-escritorio») a servicios
// de Home Assistant, solo para los dispositivos del mapeo y solo con las
// acciones de la lista blanca (tipos.mjs). Una orden se da por hecha cuando
// Home Assistant reporta el estado nuevo, no cuando acepta la petición.
//
// Sin dependencias: usa fetch y WebSocket nativos (Node 22+). El WebSocket
// se puede inyectar con `WebSocketImpl`; con `null` se confirma solo por REST.

import { TIPOS, noDisponibleDe } from './tipos.mjs';

export class ErrorSmartLiving extends Error {
  constructor(codigo, mensaje) {
    super(mensaje);
    this.name = 'ErrorSmartLiving';
    this.codigo = codigo;
  }
}

const ID_VALIDO = /^[a-z0-9][a-z0-9-]{0,62}$/;
const ENTIDAD_VALIDA = /^[a-z_]+\.[a-z0-9_]+$/;
const noDisponible = (d, e) => noDisponibleDe(d.tipo).includes(e.state);
const esObjetoPlano = (v) =>
  v !== null && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype;
const textoValido = (v) => typeof v === 'string' && v.trim() !== '';

// ---------------------------------------------------------------- mapeo

export function validarMapeo(mapeo) {
  const falla = (msg) => {
    throw new ErrorSmartLiving('MAPEO_INVALIDO', msg);
  };
  if (!mapeo || !Array.isArray(mapeo.dispositivos)) falla('El mapeo debe traer la lista "dispositivos"');
  const ids = new Set();
  const entidades = new Set();
  return mapeo.dispositivos.map((d, i) => {
    const donde = `dispositivo #${i + 1}`;
    if (!esObjetoPlano(d)) falla(`${donde}: debe ser un objeto`);
    if (typeof d.id !== 'string' || !ID_VALIDO.test(d.id)) falla(`${donde}: id inválido`);
    if (ids.has(d.id)) falla(`${donde}: id repetido "${d.id}"`);
    if (typeof d.tipo !== 'string' || !Object.hasOwn(TIPOS, d.tipo)) falla(`${d.id}: tipo no soportado`);
    if (typeof d.entidad !== 'string' || !ENTIDAD_VALIDA.test(d.entidad)) falla(`${d.id}: entidad inválida`);
    const dominio = d.entidad.split('.')[0];
    const tipo = TIPOS[d.tipo];
    if (!tipo.dominios.includes(dominio)) falla(`${d.id}: el tipo "${d.tipo}" no admite entidades "${dominio}"`);
    if (entidades.has(d.entidad)) falla(`${d.id}: la entidad ya está mapeada a otro dispositivo`);
    if (!esObjetoPlano(d.nombre) || !textoValido(d.nombre.es) || !textoValido(d.nombre.en)) {
      falla(`${d.id}: falta el nombre en español e inglés`);
    }
    // Entidades «extra» del mismo aparato (la pantalla del aire), solo las que el tipo admite.
    let extras = null;
    if (d.extras !== undefined) {
      if (!esObjetoPlano(d.extras)) falla(`${d.id}: extras inválidos`);
      const permitidos = tipo.extras ?? {};
      extras = {};
      for (const [k, ent] of Object.entries(d.extras)) {
        if (!Object.hasOwn(permitidos, k)) falla(`${d.id}: el tipo "${d.tipo}" no admite el extra "${k}"`);
        if (typeof ent !== 'string' || !ENTIDAD_VALIDA.test(ent)) falla(`${d.id}: entidad del extra "${k}" inválida`);
        if (!permitidos[k].dominios.includes(ent.split('.')[0])) falla(`${d.id}: el extra "${k}" no admite entidades "${ent.split('.')[0]}"`);
        if (ent === d.entidad || entidades.has(ent)) falla(`${d.id}: la entidad del extra "${k}" ya está mapeada`);
        extras[k] = ent;
      }
      extras = Object.freeze(extras);
    }
    let acciones = null;
    if (d.acciones !== undefined) {
      if (!Array.isArray(d.acciones) || d.acciones.some((a) => typeof a !== 'string' || !Object.hasOwn(tipo.acciones, a))) {
        falla(`${d.id}: lista de acciones inválida`);
      }
      acciones = Object.freeze([...d.acciones]);
    }
    ids.add(d.id);
    entidades.add(d.entidad);
    for (const ent of Object.values(extras ?? {})) entidades.add(ent);
    return Object.freeze({
      id: d.id,
      tipo: d.tipo,
      entidad: d.entidad,
      dominio,
      nombre: Object.freeze({ es: d.nombre.es, en: d.nombre.en }),
      acciones,
      extras,
    });
  });
}

// ------------------------------------------------------------ adaptador

export function crearAdaptador({
  urlBase,
  token,
  mapeo,
  WebSocketImpl = globalThis.WebSocket,
  tiempoConfirmacionMs = 5000,
  tiempoPeticionMs = 5000,
  intervaloSondeoMs = 750,
  reconexionMs = [1000, 2000, 5000, 10000, 30000],
  // ADAPTADOR-RECONEXION-01: un token rechazado ya no detiene los reintentos (HA lo rechaza
  // a veces mientras arranca); se reintenta cada esperaTokenMs. Una conexión que no termina
  // de autenticarse en tiempoConexionMs se corta y se reintenta, y con la conexión abierta
  // se manda un ping cada intervaloPingMs: sin pong en tiempoPongMs, se reconecta.
  esperaTokenMs = 60000,
  tiempoConexionMs = 15000,
  intervaloPingMs = 30000,
  tiempoPongMs = 10000,
  registrar = () => {},
} = {}) {
  let url;
  try {
    url = new URL(urlBase);
  } catch {
    throw new ErrorSmartLiving('CONFIG_INVALIDA', 'urlBase inválida');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ErrorSmartLiving('CONFIG_INVALIDA', 'urlBase debe ser http o https');
  }
  if (!textoValido(token)) throw new ErrorSmartLiving('CONFIG_INVALIDA', 'Falta el token');
  const base = url.origin;
  const urlWs = `${url.protocol === 'https:' ? 'wss:' : 'ws:'}//${url.host}/api/websocket`;

  const lista = validarMapeo(mapeo);
  const porId = new Map(lista.map((d) => [d.id, d]));
  // Entidad (principal o extra) → dispositivo: un cambio en cualquiera repinta al dispositivo.
  const porEntidad = new Map(lista.flatMap((d) => [[d.entidad, d], ...Object.values(d.extras ?? {}).map((x) => [x, d])]));

  const cache = new Map(); // entidad → { state, attributes }
  const esperas = new Set();
  const suscriptores = new Set();
  const ultimoEmitido = new Map(); // id → JSON del último estado enviado

  let socket = null;
  let wsConectado = false;
  let tokenRechazado = false;
  // La primera foto («a») después de suscribirse reemplaza todo; las siguientes
  // son entidades que Home Assistant agrega tarde (integraciones que terminan de
  // cargar después de un reinicio) y solo se suman.
  let fotoPendiente = false;
  let cerrado = false;
  let intentos = 0;
  let temporizadorReconexion = null;
  let avisarListo = null;
  let siguientePing = 1000;

  // ------------------------------------------------------------- REST

  async function pedir(metodo, ruta, cuerpo) {
    let r;
    try {
      r = await fetch(base + ruta, {
        method: metodo,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(cuerpo ? { 'Content-Type': 'application/json' } : {}),
        },
        body: cuerpo ? JSON.stringify(cuerpo) : undefined,
        signal: AbortSignal.timeout(tiempoPeticionMs),
      });
    } catch {
      throw new ErrorSmartLiving('HA_SIN_CONEXION', 'No se pudo conectar con Home Assistant');
    }
    if (r.status === 401 || r.status === 403) {
      throw new ErrorSmartLiving('TOKEN_RECHAZADO', 'Home Assistant rechazó el token');
    }
    return r;
  }

  async function leerEntidad(entidad) {
    const r = await pedir('GET', `/api/states/${entidad}`);
    if (r.status === 404) return null;
    if (!r.ok) throw new ErrorSmartLiving('HA_ERROR', `Home Assistant respondió ${r.status}`);
    const j = await r.json();
    return { state: j.state, attributes: j.attributes ?? {} };
  }

  async function llamarServicio(dominio, servicio, datos) {
    const r = await pedir('POST', `/api/services/${dominio}/${servicio}`, datos);
    if (!r.ok) throw new ErrorSmartLiving('HA_ERROR', `Home Assistant respondió ${r.status}`);
  }

  // ------------------------------------------------- estado y vista TV

  function dispositivo(id) {
    if (typeof id !== 'string' || !porId.has(id)) {
      throw new ErrorSmartLiving('DISPOSITIVO_DESCONOCIDO', 'Dispositivo no registrado en Smart Living');
    }
    return porId.get(id);
  }

  function accionesDe(d, e, extras = {}) {
    const caps = TIPOS[d.tipo].capacidadesDe(d.dominio, e.attributes, extras);
    return d.acciones ? caps.filter((a) => d.acciones.includes(a)) : caps;
  }

  // Lo que ve la TV: nunca la entidad ni los atributos crudos de HA.
  function vista(d, e, extras = {}) {
    const comun = { id: d.id, tipo: d.tipo, nombre: d.nombre };
    if (!e) return { ...comun, disponible: false, motivo: 'ENTIDAD_NO_ENCONTRADA', acciones: [], estado: null };
    if (noDisponible(d, e)) return { ...comun, disponible: false, motivo: 'NO_DISPONIBLE', acciones: [], estado: null };
    return { ...comun, disponible: true, acciones: accionesDe(d, e, extras), estado: TIPOS[d.tipo].estadoDe(d.dominio, e, extras) };
  }

  async function crudoDe(entidad) {
    if (wsConectado && cache.has(entidad)) return cache.get(entidad);
    return leerEntidad(entidad);
  }

  async function estadoCrudo(d) {
    return crudoDe(d.entidad);
  }

  // Estado de los extras ({ pantalla: {state, attributes} | null }); un extra que no se puede leer no tumba al dispositivo.
  async function extrasCrudos(d) {
    const salida = {};
    for (const [k, ent] of Object.entries(d.extras ?? {})) {
      try {
        salida[k] = await crudoDe(ent);
      } catch {
        salida[k] = null;
      }
    }
    return salida;
  }

  function extrasEnCache(d) {
    return Object.fromEntries(Object.entries(d.extras ?? {}).map(([k, ent]) => [k, cache.get(ent) ?? null]));
  }

  async function estado(id) {
    const d = dispositivo(id);
    return vista(d, await estadoCrudo(d), await extrasCrudos(d));
  }

  async function listar() {
    return Promise.all(lista.map((d) => estado(d.id)));
  }

  // ------------------------------------------------------ confirmación

  function esperarEstado(entidad, cumple) {
    let resolver;
    const promesa = new Promise((r) => (resolver = r));
    const espera = { entidad, cumple, hecho: false, terminar };
    function terminar(valor) {
      if (espera.hecho) return;
      espera.hecho = true;
      clearTimeout(limite);
      clearInterval(sondeo);
      esperas.delete(espera);
      resolver(valor);
    }
    esperas.add(espera);
    // Sin WebSocket se confirma preguntando por REST.
    const sondeo = setInterval(async () => {
      if (wsConectado || espera.hecho) return;
      try {
        const e = await leerEntidad(entidad);
        if (e && cumple(e)) terminar(e);
      } catch {
        /* se reintenta en el siguiente sondeo */
      }
    }, intervaloSondeoMs);
    // Al vencer, una última lectura por REST antes de decir «sin confirmar».
    const limite = setTimeout(async () => {
      try {
        const e = await leerEntidad(entidad);
        terminar(e && cumple(e) ? e : null);
      } catch {
        terminar(null);
      }
    }, tiempoConfirmacionMs);
    return { promesa, cancelar: () => terminar(null) };
  }

  function anotar(entrada) {
    try {
      registrar(entrada);
    } catch {
      /* un registro que falla no debe tumbar la orden */
    }
  }

  async function ejecutar(id, accion, parametros = {}) {
    const inicio = Date.now();
    const entrada = {
      fecha: new Date(inicio).toISOString(),
      dispositivo: typeof id === 'string' ? id : null,
      accion: typeof accion === 'string' ? accion : null,
    };
    let resultado;
    try {
      const d = dispositivo(id);
      const tipo = TIPOS[d.tipo];
      if (typeof accion !== 'string' || !Object.hasOwn(tipo.acciones, accion)) {
        throw new ErrorSmartLiving('ACCION_NO_PERMITIDA', 'Acción no permitida para este dispositivo');
      }
      const spec = tipo.acciones[accion];
      if (
        !esObjetoPlano(parametros) ||
        Object.keys(parametros).some((k) => !spec.parametros.includes(k)) ||
        spec.parametros.some((k) => !Object.hasOwn(parametros, k)) ||
        !spec.validar(parametros)
      ) {
        throw new ErrorSmartLiving('PARAMETRO_INVALIDO', 'Parámetros inválidos para la acción');
      }
      const principal = await estadoCrudo(d);
      if (!principal) throw new ErrorSmartLiving('ENTIDAD_NO_ENCONTRADA', 'El dispositivo no existe en Home Assistant');
      if (noDisponible(d, principal)) throw new ErrorSmartLiving('NO_DISPONIBLE', 'El dispositivo no está disponible');
      const extras = await extrasCrudos(d);
      if (!accionesDe(d, principal, extras).includes(accion)) {
        throw new ErrorSmartLiving('ACCION_NO_PERMITIDA', 'Este dispositivo no soporta esa acción');
      }
      if (spec.validarEstado && !spec.validarEstado(principal, parametros)) {
        throw new ErrorSmartLiving('PARAMETRO_INVALIDO', 'El aparato no admite ese valor');
      }
      // La orden va a la entidad principal o a un extra del mismo aparato (la pantalla del aire).
      const entidad = spec.objetivo ? d.extras?.[spec.objetivo] : d.entidad;
      const actual = spec.objetivo ? extras[spec.objetivo] : principal;
      if (!entidad || !actual) throw new ErrorSmartLiving('ENTIDAD_NO_ENCONTRADA', 'El dispositivo no existe en Home Assistant');
      const { dominio, servicio, datos } = spec.servicio(d.dominio, parametros);
      const cuerpo = { ...datos, entity_id: entidad };
      const cumple = (e) => Boolean(e) && spec.confirma(e, parametros, actual);
      const vistaFinal = async () => vista(d, await estadoCrudo(d), await extrasCrudos(d)).estado;

      if (spec.sinEspera) {
        // Persianas: HA aceptó la orden; el avance (30 s o más) llega por los eventos.
        await llamarServicio(dominio, servicio, cuerpo);
        resultado = { ok: true, confirmado: true, estado: vista(d, principal, extras).estado };
      } else if (cumple(actual)) {
        await llamarServicio(dominio, servicio, cuerpo);
        resultado = { ok: true, confirmado: true, sinCambio: true, estado: vista(d, principal, extras).estado };
      } else {
        // La espera se registra antes de la orden: el estado nuevo puede
        // llegar por WebSocket antes que la respuesta HTTP.
        const espera = esperarEstado(entidad, cumple);
        try {
          await llamarServicio(dominio, servicio, cuerpo);
        } catch (e) {
          espera.cancelar();
          throw e;
        }
        const final = await espera.promesa;
        resultado = final
          ? { ok: true, confirmado: true, estado: await vistaFinal() }
          : { ok: false, confirmado: false, codigo: 'SIN_CONFIRMAR', mensaje: 'Home Assistant no confirmó el cambio a tiempo' };
      }
    } catch (e) {
      if (!(e instanceof ErrorSmartLiving)) throw e;
      resultado = { ok: false, confirmado: false, codigo: e.codigo, mensaje: e.message };
    }
    const ms = Date.now() - inicio;
    anotar({ ...entrada, ok: resultado.ok, codigo: resultado.codigo ?? null, ms });
    return { ...resultado, ms };
  }

  // -------------------------------------------- WebSocket y suscriptores

  function emitir(evento) {
    for (const fn of suscriptores) {
      try {
        fn(evento);
      } catch {
        /* un suscriptor con error no afecta a los demás */
      }
    }
  }

  function emitirDispositivo(d) {
    const v = vista(d, cache.get(d.entidad) ?? null, extrasEnCache(d));
    const json = JSON.stringify(v);
    if (ultimoEmitido.get(d.id) === json) return;
    ultimoEmitido.set(d.id, json);
    emitir({ tipo: 'dispositivo', dispositivo: v });
  }

  function actualizado(entidad) {
    const d = porEntidad.get(entidad);
    const e = cache.get(entidad);
    if (e) for (const espera of [...esperas]) if (espera.entidad === entidad && espera.cumple(e)) espera.terminar(e);
    emitirDispositivo(d);
  }

  function alMensaje(ws, m) {
    if (m.type === 'auth_required') {
      ws.send(JSON.stringify({ type: 'auth', access_token: token }));
    } else if (m.type === 'auth_ok') {
      tokenRechazado = false;
      fotoPendiente = true;
      ws.send(JSON.stringify({ id: 1, type: 'subscribe_entities', entity_ids: [...porEntidad.keys()] }));
    } else if (m.type === 'auth_invalid') {
      tokenRechazado = true;
      emitir({ tipo: 'aviso', motivo: 'TOKEN_RECHAZADO', reintentoMs: esperaTokenMs });
      avisarListo?.(new ErrorSmartLiving('TOKEN_RECHAZADO', 'Home Assistant rechazó el token'));
      ws.close();
    } else if (m.type === 'pong') {
      clearTimeout(vigia.pongPendiente);
      vigia.pongPendiente = null;
    } else if (m.type === 'result' && m.id === 1) {
      if (!m.success) {
        ws.close();
        return;
      }
      wsConectado = true;
      intentos = 0;
      clearTimeout(vigia.conexion);
      vigia.conexion = null;
      clearInterval(vigia.ping);
      vigia.ping = setInterval(() => {
        if (socket !== ws || vigia.pongPendiente) return;
        try {
          ws.send(JSON.stringify({ id: siguientePing++, type: 'ping' }));
        } catch {
          /* se cierra solo */
        }
        vigia.pongPendiente = setTimeout(() => cortar(ws, 'SIN_PONG'), tiempoPongMs);
      }, intervaloPingMs);
      emitir({ tipo: 'conexion', conectado: true });
      avisarListo?.(null);
    } else if (m.type === 'event' && m.event) {
      const ev = m.event;
      if (ev.a) {
        if (fotoPendiente) {
          // Foto inicial (también tras reconectar): reemplaza todo lo anterior.
          fotoPendiente = false;
          cache.clear();
          for (const [entidad, s] of Object.entries(ev.a)) {
            if (porEntidad.has(entidad)) cache.set(entidad, { state: s.s, attributes: s.a ?? {} });
          }
          for (const d of lista) actualizado(d.entidad);
        } else {
          // Entidad que aparece después (HA terminando de arrancar): se suma sin borrar las demás.
          for (const [entidad, s] of Object.entries(ev.a)) {
            if (!porEntidad.has(entidad)) continue;
            cache.set(entidad, { state: s.s, attributes: s.a ?? {} });
            actualizado(entidad);
          }
        }
      }
      if (ev.c) {
        for (const [entidad, cambio] of Object.entries(ev.c)) {
          if (!porEntidad.has(entidad)) continue;
          const previo = cache.get(entidad) ?? { state: undefined, attributes: {} };
          const mas = cambio['+'] ?? {};
          const atributos = { ...previo.attributes, ...(mas.a ?? {}) };
          for (const k of cambio['-']?.a ?? []) delete atributos[k];
          cache.set(entidad, { state: mas.s ?? previo.state, attributes: atributos });
          actualizado(entidad);
        }
      }
      if (Array.isArray(ev.r)) {
        for (const entidad of ev.r) {
          if (!porEntidad.has(entidad)) continue;
          cache.delete(entidad);
          actualizado(entidad);
        }
      }
    }
  }

  // Vigilancia de la conexión: que termine de conectarse a tiempo y que, ya conectada, conteste los pings.
  const vigia = { conexion: null, ping: null, pongPendiente: null };
  function soltarVigia() {
    clearTimeout(vigia.conexion);
    clearInterval(vigia.ping);
    clearTimeout(vigia.pongPendiente);
    vigia.conexion = vigia.ping = vigia.pongPendiente = null;
  }
  // Corta una conexión que no responde: se suelta ya (sin esperar su cierre) y se reintenta.
  function cortar(ws, motivo) {
    if (socket !== ws) return;
    soltarVigia();
    socket = null;
    const estaba = wsConectado;
    wsConectado = false;
    if (estaba) emitir({ tipo: 'conexion', conectado: false });
    emitir({ tipo: 'aviso', motivo });
    try {
      ws.close();
    } catch {
      /* ya estaba cerrándose */
    }
    if (!cerrado) programarReconexion();
  }

  function abrir() {
    if (cerrado || socket) return;
    let ws;
    try {
      ws = new WebSocketImpl(urlWs);
    } catch {
      programarReconexion();
      return;
    }
    socket = ws;
    soltarVigia();
    vigia.conexion = setTimeout(() => {
      if (socket === ws && !wsConectado) cortar(ws, 'SIN_RESPUESTA');
    }, tiempoConexionMs);
    ws.onmessage = (ev) => {
      let m;
      try {
        m = JSON.parse(typeof ev.data === 'string' ? ev.data : String(ev.data));
      } catch {
        return;
      }
      try {
        alMensaje(ws, m);
      } catch {
        /* un mensaje raro de HA no debe tumbar el proceso */
      }
    };
    ws.onerror = () => {};
    ws.onclose = () => {
      if (socket !== ws) return;
      soltarVigia();
      socket = null;
      const estaba = wsConectado;
      wsConectado = false;
      if (estaba) emitir({ tipo: 'conexion', conectado: false });
      if (!cerrado) programarReconexion();
    };
  }

  function programarReconexion() {
    if (cerrado || temporizadorReconexion) return;
    const espera = tokenRechazado ? esperaTokenMs : reconexionMs[Math.min(intentos, reconexionMs.length - 1)];
    intentos += 1;
    temporizadorReconexion = setTimeout(() => {
      temporizadorReconexion = null;
      abrir();
    }, espera);
  }

  // Abre el WebSocket y espera la suscripción. Devuelve true si quedó
  // conectado, false si no se pudo en `esperaMs` (sigue reintentando solo).
  function conectar({ esperaMs = 5000 } = {}) {
    if (!WebSocketImpl) return Promise.resolve(false);
    if (wsConectado) return Promise.resolve(true);
    if (tokenRechazado) return Promise.reject(new ErrorSmartLiving('TOKEN_RECHAZADO', 'Home Assistant rechazó el token'));
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        avisarListo = null;
        resolve(false);
      }, esperaMs);
      avisarListo = (error) => {
        clearTimeout(t);
        avisarListo = null;
        if (error) reject(error);
        else resolve(true);
      };
      abrir();
    });
  }

  function suscribir(fn) {
    suscriptores.add(fn);
    return () => suscriptores.delete(fn);
  }

  function cerrar() {
    cerrado = true;
    soltarVigia();
    clearTimeout(temporizadorReconexion);
    temporizadorReconexion = null;
    for (const espera of [...esperas]) espera.terminar(null);
    const ws = socket;
    socket = null;
    wsConectado = false;
    ws?.close();
  }

  return {
    listar,
    estado,
    ejecutar,
    conectar,
    suscribir,
    cerrar,
    get conectado() {
      return wsConectado;
    },
  };
}
