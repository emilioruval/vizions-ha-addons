// Agente de Smart Living: corre en la casa, junto a Home Assistant.
//
// Abre una conexión saliente hacia la puerta de Vizions (así nunca hay que
// abrir puertos en el router de la villa), se identifica con la llave de su
// propiedad y la mantiene abierta. Por ella recibe órdenes, que pasa al
// adaptador (mapeo y lista blanca), y manda los estados de los dispositivos.
// El token de Home Assistant nunca sale de la casa.
//
// Usa el WebSocket nativo de Node 22+ (se puede inyectar con `WebSocketImpl`).

import { ID_VALIDO, VERSION_PROTOCOLO } from './protocolo.mjs';

export class ErrorAgente extends Error {
  constructor(mensaje) {
    super(mensaje);
    this.name = 'ErrorAgente';
  }
}

export function crearAgente({
  urlPuerta,
  propiedad,
  llave,
  adaptador,
  WebSocketImpl = globalThis.WebSocket,
  reconexionMs = [1000, 2000, 5000, 10000, 30000],
  esperaRechazoMs = 5 * 60 * 1000,
  esperaReemplazoMs = 60 * 1000,
  silencioMaxMs = 75 * 1000,
  registrar = () => {},
} = {}) {
  let url;
  try {
    url = new URL(urlPuerta);
  } catch {
    throw new ErrorAgente('urlPuerta inválida');
  }
  if (url.protocol !== 'ws:' && url.protocol !== 'wss:') throw new ErrorAgente('urlPuerta debe ser ws o wss');
  if (typeof propiedad !== 'string' || !ID_VALIDO.test(propiedad)) throw new ErrorAgente('propiedad inválida');
  if (typeof llave !== 'string' || llave.trim() === '') throw new ErrorAgente('Falta la llave de la propiedad');
  if (!adaptador || typeof adaptador.ejecutar !== 'function') throw new ErrorAgente('Falta el adaptador');
  if (typeof WebSocketImpl !== 'function') throw new ErrorAgente('Este Node no trae WebSocket');

  let socket = null;
  let listo = false;
  let cerrado = false;
  let intentos = 0;
  let proximaEspera = null;
  let temporizador = null;
  let ultimoMensaje = 0;
  let fotosEnCurso = 0;
  const cola = [];

  const anotar = (entrada) => {
    try {
      registrar({ fecha: new Date().toISOString(), propiedad, ...entrada });
    } catch {
      /* un registro que falla no tumba el agente */
    }
  };

  function enviar(msg) {
    if (socket && socket.readyState === 1) socket.send(JSON.stringify(msg));
  }

  // Foto completa de la casa. Los cambios que lleguen mientras se arma se
  // guardan y se mandan después, para que la foto no los pise.
  async function enviarFoto() {
    const ws = socket;
    fotosEnCurso += 1;
    let msg;
    try {
      msg = { t: 'estado', ha: adaptador.conectado, dispositivos: await adaptador.listar() };
    } catch {
      msg = { t: 'estado', ha: false, dispositivos: [] };
    }
    fotosEnCurso -= 1;
    if (socket !== ws || !listo) return;
    enviar(msg);
    if (fotosEnCurso === 0) for (const m of cola.splice(0)) enviar(m);
  }

  const dejarDeOir = adaptador.suscribir((ev) => {
    if (!listo) return;
    if (ev.tipo === 'conexion') {
      if (ev.conectado) enviarFoto();
      else enviar({ t: 'ha', conectado: false });
      return;
    }
    if (ev.tipo === 'dispositivo') {
      const msg = { t: 'dispositivo', dispositivo: ev.dispositivo };
      if (fotosEnCurso > 0) cola.push(msg);
      else enviar(msg);
    }
  });

  async function atender(ws, m) {
    let resultado;
    try {
      resultado = await adaptador.ejecutar(m.dispositivo, m.accion, m.parametros);
    } catch {
      resultado = { ok: false, confirmado: false, codigo: 'ERROR_AGENTE', mensaje: 'Error interno del agente' };
    }
    if (socket === ws) enviar({ t: 'resultado', id: m.id, resultado });
  }

  function soltar(ws, motivo) {
    if (socket !== ws) return;
    socket = null;
    const estaba = listo;
    listo = false;
    cola.length = 0;
    if (estaba) anotar({ evento: 'desconectado', motivo });
    try {
      ws.close();
    } catch {
      /* ya estaba cerrado */
    }
    programar();
  }

  function alMensaje(ws, m) {
    if (m.t === 'bienvenida') {
      listo = true;
      intentos = 0;
      anotar({ evento: 'conectado' });
      enviarFoto();
    } else if (m.t === 'ping') {
      enviar({ t: 'pong' });
    } else if (m.t === 'orden') {
      const valida =
        listo &&
        typeof m.id === 'string' &&
        m.id.length <= 64 &&
        typeof m.dispositivo === 'string' &&
        typeof m.accion === 'string' &&
        m.parametros !== null &&
        typeof m.parametros === 'object';
      if (valida) atender(ws, m);
    } else if (m.t === 'rechazado') {
      anotar({ evento: 'rechazado', motivo: typeof m.motivo === 'string' ? m.motivo.slice(0, 40) : null });
      proximaEspera = esperaRechazoMs;
      soltar(ws, 'rechazado');
    } else if (m.t === 'reemplazado') {
      anotar({ evento: 'reemplazado' });
      proximaEspera = esperaReemplazoMs;
      soltar(ws, 'reemplazado');
    }
  }

  function abrir() {
    temporizador = null;
    if (cerrado || socket) return;
    let ws;
    try {
      ws = new WebSocketImpl(url.href);
    } catch {
      programar();
      return;
    }
    socket = ws;
    ultimoMensaje = Date.now();
    ws.onopen = () => {
      if (socket !== ws) return;
      ultimoMensaje = Date.now();
      ws.send(JSON.stringify({ t: 'hola', propiedad, llave, version: VERSION_PROTOCOLO }));
    };
    ws.onmessage = (ev) => {
      if (socket !== ws) return;
      ultimoMensaje = Date.now();
      let m;
      try {
        m = JSON.parse(typeof ev.data === 'string' ? ev.data : String(ev.data));
      } catch {
        return;
      }
      if (m === null || typeof m !== 'object') return;
      try {
        alMensaje(ws, m);
      } catch {
        /* un mensaje raro no tumba el agente */
      }
    };
    ws.onerror = () => {};
    ws.onclose = () => soltar(ws, 'cerrado');
  }

  function programar() {
    if (cerrado || temporizador) return;
    let espera;
    if (proximaEspera !== null) {
      espera = proximaEspera;
      proximaEspera = null;
    } else {
      espera = reconexionMs[Math.min(intentos, reconexionMs.length - 1)];
      intentos += 1;
    }
    temporizador = setTimeout(abrir, espera);
  }

  // Si la puerta deja de hablar (ni pings), la conexión está muerta aunque
  // el sistema no lo haya notado: se suelta y se reconecta.
  const vigilancia = setInterval(() => {
    if (socket && Date.now() - ultimoMensaje > silencioMaxMs) {
      anotar({ evento: 'silencio' });
      soltar(socket, 'silencio');
    }
  }, Math.max(50, Math.floor(silencioMaxMs / 3)));

  return {
    iniciar() {
      cerrado = false;
      Promise.resolve(adaptador.conectar?.()).catch((e) =>
        anotar({ evento: 'home-assistant', codigo: e?.codigo ?? 'ERROR' }),
      );
      abrir();
    },
    cerrar() {
      cerrado = true;
      clearTimeout(temporizador);
      temporizador = null;
      clearInterval(vigilancia);
      dejarDeOir();
      const ws = socket;
      socket = null;
      listo = false;
      try {
        ws?.close();
      } catch {
        /* ya estaba cerrado */
      }
    },
    get conectado() {
      return listo;
    },
  };
}
