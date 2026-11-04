// Lista blanca de Smart Living: qué puede hacer cada tipo de dispositivo.
// Nada que no esté en esta tabla llega a Home Assistant.
//
// Tipos: «luz» (luces y apagadores), «escena» (escenas y scripts de Home
// Assistant, que el huésped solo puede activar), «cortina» (persianas),
// «clima» (aires acondicionados) y «bocina» (Sonos y otros media_player: solo
// reproducir/pausa, silencio y volumen; la música se elige fuera).
//
// Cada acción confirma con el estado nuevo; `confirma(e, parametros, antes)`
// recibe también el estado de antes de la orden (lo usa «activar», que no
// tiene un estado final fijo sino un cambio). Opcionales por acción:
//   · validarEstado(e, p): los parámetros contra lo que el aparato admite
//     (rango de temperatura, modos del ventilador).
//   · sinEspera: se da por hecha cuando HA acepta la orden, sin `confirma`
//     (persianas: tardan 30 s o más en llegar; su avance llega por los eventos).
//   · objetivo: la acción va a una entidad «extra» del mismo aparato (la
//     pantalla del aire), no a la principal.
// `extras` del tipo: entidades del mismo aparato que se amarran al dispositivo.

const pctDeBrillo = (b) => Math.round((b / 255) * 100);

export const TIPOS = {
  luz: Object.freeze({
    // Entidades de Home Assistant que pueden mapearse como luz. Un enchufe
    // o apagador (switch) se presenta en la TV como luz de encendido/apagado.
    dominios: Object.freeze(['light', 'switch']),

    // Acciones que el dispositivo concreto soporta, según su dominio y lo que
    // reporta Home Assistant. La TV solo muestra estas.
    capacidadesDe(dominio, atributos) {
      const caps = ['encender', 'apagar'];
      if (dominio === 'light') {
        const modos = Array.isArray(atributos?.supported_color_modes)
          ? atributos.supported_color_modes
          : [];
        if (modos.some((m) => m !== 'onoff')) caps.push('brillo');
      }
      return caps;
    },

    // Estado que ve la TV (nunca los atributos crudos de Home Assistant).
    estadoDe(dominio, e) {
      const salida = { encendida: e.state === 'on' };
      const b = e.attributes?.brightness;
      if (dominio === 'light' && e.state === 'on' && typeof b === 'number') {
        salida.brillo = pctDeBrillo(b);
      }
      return salida;
    },

    acciones: Object.freeze({
      encender: Object.freeze({
        parametros: Object.freeze([]),
        validar: () => true,
        servicio: (dominio) => ({ dominio, servicio: 'turn_on', datos: {} }),
        confirma: (e) => e.state === 'on',
      }),
      apagar: Object.freeze({
        parametros: Object.freeze([]),
        validar: () => true,
        servicio: (dominio) => ({ dominio, servicio: 'turn_off', datos: {} }),
        confirma: (e) => e.state === 'off',
      }),
      brillo: Object.freeze({
        parametros: Object.freeze(['porcentaje']),
        validar: ({ porcentaje }) =>
          Number.isInteger(porcentaje) && porcentaje >= 1 && porcentaje <= 100,
        servicio: (_dominio, { porcentaje }) => ({
          dominio: 'light',
          servicio: 'turn_on',
          datos: { brightness_pct: porcentaje },
        }),
        // Los focos redondean el brillo a sus propios pasos: se acepta ±2 %.
        confirma: (e, { porcentaje }) =>
          e.state === 'on' &&
          typeof e.attributes?.brightness === 'number' &&
          Math.abs(pctDeBrillo(e.attributes.brightness) - porcentaje) <= 2,
      }),
    }),
  }),

  escena: Object.freeze({
    // Escenas (scene) y scripts (script): para el huésped son lo mismo, un botón.
    dominios: Object.freeze(['scene', 'script']),

    // Una escena que nunca se ha activado está en «unknown» y sí se puede
    // activar: solo cuenta como no disponible lo que HA reporta caído.
    noDisponible: Object.freeze(['unavailable']),

    capacidadesDe: () => ['activar'],

    // No tiene encendido/apagado: la TV no muestra estado.
    estadoDe: () => ({}),

    acciones: Object.freeze({
      activar: Object.freeze({
        parametros: Object.freeze([]),
        validar: () => true,
        servicio: (dominio) => ({ dominio, servicio: 'turn_on', datos: {} }),
        // La escena cambia su estado a la hora en que se activó; el script
        // cambia last_triggered al arrancar. Cualquiera de los dos confirma.
        confirma: (e, _p, antes) =>
          Boolean(antes) &&
          (e.state !== antes.state || (e.attributes?.last_triggered ?? null) !== (antes.attributes?.last_triggered ?? null)),
      }),
    }),
  }),
};

// --------------------------------------------------------- cortina y clima

const ABRIR = 1, CERRAR = 2, DETENER = 8; // CoverEntityFeature (4 = ir a una posición: no se usa)
const TEMPERATURA = 1, VENTILADOR = 8, APAGAR = 128, ENCENDER = 256; // ClimateEntityFeature
const tiene = (atributos, bit) => (Number(atributos?.supported_features) & bit) === bit;
const posicionDe = (e) => (typeof e?.attributes?.current_position === 'number' ? e.attributes.current_position : null);
const numero = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const listaDe = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && /^[a-z0-9_]{1,24}$/.test(x)) : []);

TIPOS.cortina = Object.freeze({
  dominios: Object.freeze(['cover']),
  capacidadesDe(_dominio, atributos) {
    const caps = [];
    if (tiene(atributos, ABRIR)) caps.push('abrir');
    if (tiene(atributos, CERRAR)) caps.push('cerrar');
    if (tiene(atributos, DETENER)) caps.push('detener');
    return caps;
  },
  // abierta: deja pasar luz (posición > 0); movimiento según HA.
  estadoDe(_dominio, e) {
    const pos = posicionDe(e);
    const salida = {
      abierta: pos !== null ? pos > 0 : e.state !== 'closed',
      movimiento: e.state === 'opening' ? 'abriendo' : e.state === 'closing' ? 'cerrando' : 'quieta',
    };
    if (pos !== null) salida.posicion = pos;
    return salida;
  },
  acciones: Object.freeze({
    abrir: Object.freeze({
      parametros: Object.freeze([]),
      validar: () => true,
      sinEspera: true,
      servicio: () => ({ dominio: 'cover', servicio: 'open_cover', datos: {} }),
    }),
    cerrar: Object.freeze({
      parametros: Object.freeze([]),
      validar: () => true,
      sinEspera: true,
      servicio: () => ({ dominio: 'cover', servicio: 'close_cover', datos: {} }),
    }),
    detener: Object.freeze({
      parametros: Object.freeze([]),
      validar: () => true,
      sinEspera: true,
      servicio: () => ({ dominio: 'cover', servicio: 'stop_cover', datos: {} }),
    }),
  }),
});
TIPOS.clima = Object.freeze({
  dominios: Object.freeze(['climate']),
  // La pantalla del aire (AC Freedom: switch.<aire>_display) es otra entidad del mismo aparato.
  extras: Object.freeze({ pantalla: Object.freeze({ dominios: Object.freeze(['switch']) }) }),
  capacidadesDe(_dominio, atributos, extras = {}) {
    const caps = [];
    const modos = listaDe(atributos?.hvac_modes);
    if (tiene(atributos, ENCENDER) || modos.some((m) => m !== 'off')) caps.push('encender');
    if (tiene(atributos, APAGAR) || modos.includes('off')) caps.push('apagar');
    if (tiene(atributos, TEMPERATURA) && numero(atributos?.min_temp) !== null && numero(atributos?.max_temp) !== null) caps.push('temperatura');
    if (tiene(atributos, VENTILADOR) && listaDe(atributos?.fan_modes).length) caps.push('ventilador');
    const p = extras.pantalla;
    if (p && !['unavailable', 'unknown'].includes(p.state)) caps.push('pantalla_encender', 'pantalla_apagar');
    return caps;
  },
  // Lo que la TV necesita para pintar la tarjeta y la ventana del aire.
  estadoDe(_dominio, e, extras = {}) {
    const a = e.attributes ?? {};
    const salida = { encendido: e.state !== 'off', modo: String(e.state).slice(0, 24) };
    for (const [k, v] of [['temperatura', a.temperature], ['actual', a.current_temperature], ['minimo', a.min_temp], ['maximo', a.max_temp], ['paso', a.target_temp_step]]) {
      if (numero(v) !== null) salida[k] = v;
    }
    if (typeof a.fan_mode === 'string') salida.ventilador = a.fan_mode.slice(0, 24);
    const ventiladores = listaDe(a.fan_modes).join(',');
    if (ventiladores && ventiladores.length <= 64) salida.ventiladores = ventiladores;
    if (typeof a.hvac_action === 'string') salida.accion = a.hvac_action.slice(0, 24);
    const p = extras.pantalla;
    if (p && !['unavailable', 'unknown'].includes(p.state)) salida.pantalla = p.state === 'on';
    return salida;
  },
  acciones: Object.freeze({
    encender: Object.freeze({
      parametros: Object.freeze([]),
      validar: () => true,
      servicio: () => ({ dominio: 'climate', servicio: 'turn_on', datos: {} }),
      confirma: (e) => e.state !== 'off',
    }),
    apagar: Object.freeze({
      parametros: Object.freeze([]),
      validar: () => true,
      servicio: () => ({ dominio: 'climate', servicio: 'turn_off', datos: {} }),
      confirma: (e) => e.state === 'off',
    }),
    temperatura: Object.freeze({
      parametros: Object.freeze(['grados']),
      validar: ({ grados }) => numero(grados) !== null,
      // Dentro del rango del aire y en sus pasos (0.5 o 1).
      validarEstado: (e, { grados }) => {
        const a = e.attributes ?? {};
        const min = numero(a.min_temp), max = numero(a.max_temp);
        const paso = numero(a.target_temp_step) || 0.5;
        if (min === null || max === null || grados < min - 1e-9 || grados > max + 1e-9) return false;
        return Math.abs(Math.round(grados / paso) * paso - grados) < 1e-6;
      },
      servicio: (_d, { grados }) => ({ dominio: 'climate', servicio: 'set_temperature', datos: { temperature: grados } }),
      confirma: (e, { grados }) => numero(e.attributes?.temperature) !== null && Math.abs(e.attributes.temperature - grados) < 0.01,
    }),
    ventilador: Object.freeze({
      parametros: Object.freeze(['modo']),
      validar: ({ modo }) => typeof modo === 'string' && /^[a-z0-9_]{1,24}$/.test(modo),
      validarEstado: (e, { modo }) => listaDe(e.attributes?.fan_modes).includes(modo),
      servicio: (_d, { modo }) => ({ dominio: 'climate', servicio: 'set_fan_mode', datos: { fan_mode: modo } }),
      confirma: (e, { modo }) => e.attributes?.fan_mode === modo,
    }),
    pantalla_encender: Object.freeze({
      parametros: Object.freeze([]),
      validar: () => true,
      objetivo: 'pantalla',
      servicio: () => ({ dominio: 'switch', servicio: 'turn_on', datos: {} }),
      confirma: (e) => e.state === 'on',
    }),
    pantalla_apagar: Object.freeze({
      parametros: Object.freeze([]),
      validar: () => true,
      objetivo: 'pantalla',
      servicio: () => ({ dominio: 'switch', servicio: 'turn_off', datos: {} }),
      confirma: (e) => e.state === 'off',
    }),
  }),
});

// ------------------------------------------------------------------ bocina

const PAUSA = 1, VOLUMEN = 4, SILENCIO = 8, REPRODUCIR = 16384; // MediaPlayerEntityFeature
// Texto para la TV: a lo más 64 unidades (lo que deja pasar la puerta), sin cortar un carácter.
function corto(v) {
  if (typeof v !== 'string') return null;
  let t = v.replace(/\s+/g, ' ').trim();
  if (!t) return null;
  if (t.length > 64) {
    const c = Array.from(t);
    while (c.join('').length > 63) c.pop();
    t = `${c.join('').trimEnd()}…`;
  }
  return t;
}
const volumenDe = (e) => {
  const v = numero(e?.attributes?.volume_level);
  return v === null ? null : Math.round(Math.min(1, Math.max(0, v)) * 100);
};

TIPOS.bocina = Object.freeze({
  dominios: Object.freeze(['media_player']),
  capacidadesDe(_dominio, atributos) {
    const caps = [];
    if (tiene(atributos, REPRODUCIR)) caps.push('reproducir');
    if (tiene(atributos, PAUSA)) caps.push('pausar');
    if (tiene(atributos, SILENCIO)) caps.push('silenciar', 'quitar_silencio');
    if (tiene(atributos, VOLUMEN)) caps.push('volumen');
    return caps;
  },
  // sonando / pausa / sin_musica (idle, apagada o en espera: no hay nada que reanudar).
  estadoDe(_dominio, e) {
    const a = e.attributes ?? {};
    const salida = { estado: e.state === 'playing' ? 'sonando' : e.state === 'paused' ? 'pausa' : 'sin_musica' };
    const vol = volumenDe(e);
    if (vol !== null) salida.volumen = vol;
    if (typeof a.is_volume_muted === 'boolean') salida.silencio = a.is_volume_muted;
    if (salida.estado !== 'sin_musica') {
      const titulo = corto(a.media_title);
      const artista = corto(a.media_artist) || corto(a.media_album_artist);
      if (titulo) salida.titulo = titulo;
      if (artista) salida.artista = artista;
    }
    return salida;
  },
  acciones: Object.freeze({
    reproducir: Object.freeze({
      parametros: Object.freeze([]),
      validar: () => true,
      servicio: () => ({ dominio: 'media_player', servicio: 'media_play', datos: {} }),
      confirma: (e) => e.state === 'playing',
    }),
    pausar: Object.freeze({
      parametros: Object.freeze([]),
      validar: () => true,
      servicio: () => ({ dominio: 'media_player', servicio: 'media_pause', datos: {} }),
      // Una radio en vivo puede quedar «idle» en vez de «paused».
      confirma: (e) => e.state === 'paused' || e.state === 'idle',
    }),
    silenciar: Object.freeze({
      parametros: Object.freeze([]),
      validar: () => true,
      servicio: () => ({ dominio: 'media_player', servicio: 'volume_mute', datos: { is_volume_muted: true } }),
      confirma: (e) => e.attributes?.is_volume_muted === true,
    }),
    quitar_silencio: Object.freeze({
      parametros: Object.freeze([]),
      validar: () => true,
      servicio: () => ({ dominio: 'media_player', servicio: 'volume_mute', datos: { is_volume_muted: false } }),
      confirma: (e) => e.attributes?.is_volume_muted === false,
    }),
    volumen: Object.freeze({
      parametros: Object.freeze(['porcentaje']),
      validar: ({ porcentaje }) => Number.isInteger(porcentaje) && porcentaje >= 0 && porcentaje <= 100,
      servicio: (_d, { porcentaje }) => ({ dominio: 'media_player', servicio: 'volume_set', datos: { volume_level: porcentaje / 100 } }),
      // Algunas bocinas guardan el volumen en sus propios pasos: se acepta ±1 %.
      confirma: (e, { porcentaje }) => volumenDe(e) !== null && Math.abs(volumenDe(e) - porcentaje) <= 1,
    }),
  }),
});
Object.freeze(TIPOS);

// Estados de Home Assistant que el tipo trata como «no disponible».
const NO_DISPONIBLE_COMUN = Object.freeze(['unavailable', 'unknown']);
export const noDisponibleDe = (tipo) => TIPOS[tipo]?.noDisponible ?? NO_DISPONIBLE_COMUN;

// Dominio de Home Assistant → tipo de Smart Living.
export const TIPO_DE_DOMINIO = Object.freeze(
  Object.fromEntries(Object.entries(TIPOS).flatMap(([tipo, t]) => t.dominios.map((d) => [d, tipo]))),
);
