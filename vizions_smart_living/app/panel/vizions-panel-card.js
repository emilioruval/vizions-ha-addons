// Vizions Panel 0.11.0 — tarjeta de Home Assistant (Vizions Smart Living).
// Archivo ARMADO por scripts/panel-construir.mjs: no se edita a mano.
// Huella del contenido: c8a5accef0072c26427903b2ff080e47
// ---- src/tipos.mjs
const __vp_tipos = (() => {
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

const TIPOS = {
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
const noDisponibleDe = (tipo) => TIPOS[tipo]?.noDisponible ?? NO_DISPONIBLE_COMUN;

// Dominio de Home Assistant → tipo de Smart Living.
const TIPO_DE_DOMINIO = Object.freeze(
  Object.fromEntries(Object.entries(TIPOS).flatMap(([tipo, t]) => t.dominios.map((d) => [d, tipo]))),
);

return { TIPOS, noDisponibleDe, TIPO_DE_DOMINIO };
})();

// ---- src/traducir.mjs
const __vp_traducir = (() => {
// Nombre en inglés a partir del nombre en español que tiene Home Assistant.
//
// Home Assistant guarda un solo nombre por entidad. Para que la TV y el
// celular cambien de idioma, el complemento traduce los nombres comunes de una
// casa con un diccionario: «Luz de la sala» → «Living room light»,
// «Recámara principal» → «Main bedroom», «Escritorio Interruptor 1» →
// «Desk Switch 1». Las palabras que no conoce (nombres propios, marcas,
// números) se quedan igual; si no reconoce ninguna, regresa el nombre tal cual.

const PALABRAS = {
  // lo que se controla
  luz: 'light', luces: 'lights', lampara: 'lamp', lamparas: 'lamps', foco: 'bulb', focos: 'bulbs',
  apagador: 'switch', apagadores: 'switches', interruptor: 'switch', interruptores: 'switches',
  contacto: 'outlet', enchufe: 'plug', ventilador: 'fan', tira: 'strip', spot: 'spot', spots: 'spots',
  candil: 'chandelier', arbotante: 'sconce', arbotantes: 'sconces', reflector: 'floodlight', reflectores: 'floodlights',
  // lugares
  sala: 'living room', estancia: 'living room', comedor: 'dining room', cocina: 'kitchen', antecomedor: 'breakfast nook',
  recamara: 'bedroom', recamaras: 'bedrooms', habitacion: 'bedroom', dormitorio: 'bedroom', cuarto: 'room',
  bano: 'bathroom', banos: 'bathrooms', medio: 'half', terraza: 'terrace', balcon: 'balcony', alberca: 'pool', piscina: 'pool',
  jardin: 'garden', patio: 'patio', entrada: 'entrance', acceso: 'entrance', pasillo: 'hallway', vestibulo: 'lobby',
  escalera: 'stairs', escaleras: 'stairs', cochera: 'garage', garaje: 'garage', estudio: 'study', oficina: 'office',
  escritorio: 'desk', vestidor: 'walk-in closet', closet: 'closet', lavanderia: 'laundry room', bodega: 'storage room',
  azotea: 'rooftop', roof: 'rooftop', palapa: 'palapa', asador: 'grill', bar: 'bar', barra: 'bar', isla: 'island',
  gimnasio: 'gym', cine: 'theater', juegos: 'game room', fachada: 'facade', muelle: 'dock', playa: 'beach', jacuzzi: 'jacuzzi',
  regadera: 'shower', tina: 'tub', espejo: 'mirror', techo: 'ceiling', pared: 'wall', piso: 'floor', mesa: 'table',
  buro: 'nightstand', noche: 'night', lectura: 'reading', ambiente: 'ambient', invitados: 'guest', huespedes: 'guest', visitas: 'guest',
  ninos: 'kids', servicio: 'service', canal: 'channel', zona: 'area',
  // adjetivos (en inglés van antes)
  principal: 'main', exterior: 'outdoor', exteriores: 'outdoor', interior: 'indoor', izquierda: 'left', izquierdo: 'left',
  derecha: 'right', derecho: 'right', central: 'center', grande: 'large', chica: 'small', chico: 'small', colgante: 'pendant',
  superior: 'upper', inferior: 'lower', alta: 'upper', alto: 'upper', baja: 'lower', bajo: 'lower', frontal: 'front',
  trasera: 'back', trasero: 'back', general: 'main', decorativa: 'accent', decorativas: 'accent', indirecta: 'indirect',
  arriba: 'upstairs', abajo: 'downstairs', y: 'and',
  // escenas
  escena: 'scene', modo: 'mode', bienvenida: 'welcome', llegada: 'arrival', salida: 'leaving', fiesta: 'party',
  cena: 'dinner', pelicula: 'movie', peliculas: 'movies', dormir: 'sleep', despertar: 'wake up', relajacion: 'relax',
  romantica: 'romantic', romantico: 'romantic', manana: 'morning', todo: 'all', toda: 'all', todos: 'all', todas: 'all',
  apagado: 'off', apagada: 'off', apagados: 'off', apagadas: 'off', encendido: 'on', encendida: 'on', encendidos: 'on', encendidas: 'on',
};
// Nombres completos de escenas que no salen palabra por palabra.
const FRASES_ESCENA = {
  'buenas noches': 'Good night', 'buenos dias': 'Good morning', 'buenas tardes': 'Good afternoon',
  'hora de dormir': 'Bedtime', 'todo apagado': 'All off', 'apagar todo': 'All off', 'apagar todas las luces': 'All lights off',
  'todo encendido': 'All on', 'encender todo': 'All on', 'prender todo': 'All on', 'cine': 'Movie', 'modo cine': 'Movie mode',
  'noche de cine': 'Movie night', 'noche': 'Night',
};
const ADJETIVOS = new Set(['principal', 'exterior', 'exteriores', 'interior', 'izquierda', 'izquierdo', 'derecha', 'derecho', 'central', 'grande', 'chica', 'chico', 'colgante', 'superior', 'inferior', 'alta', 'alto', 'baja', 'bajo', 'frontal', 'trasera', 'trasero', 'general', 'decorativa', 'decorativas', 'indirecta', 'medio']);
// Verbos al inicio del nombre («Apagar luces exteriores» → «Turn off outdoor lights»).
const VERBOS = { apagar: 'turn off', encender: 'turn on', prender: 'turn on', abrir: 'open', cerrar: 'close', activar: 'activate' };
// Sustantivos que en inglés van al final: «Luz terraza» → «Terrace light», «Modo noche» → «Night mode».
const DISPOSITIVOS = new Set(['luz', 'luces', 'lampara', 'lamparas', 'foco', 'focos', 'apagador', 'apagadores', 'interruptor', 'interruptores', 'contacto', 'enchufe', 'ventilador', 'tira', 'spot', 'spots', 'candil', 'arbotante', 'arbotantes', 'reflector', 'reflectores', 'modo', 'escena']);
const ARTICULOS = new Set(['el', 'la', 'los', 'las']);
const UNIONES = new Set(['de', 'del', 'en']);

const clave = (p) => p.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

// Traduce un tramo sin «de»: «recámara principal» → «main bedroom»,
// «luz terraza» → «terrace light».
function tramo(palabras, cuenta) {
  const ps = palabras.filter((p) => !ARTICULOS.has(clave(p)));
  if (!ps.length) return [];
  let cosa = [];
  if (ps.length > 1 && DISPOSITIVOS.has(clave(ps[0])) && !/^\d+$/.test(ps[1])) cosa = [ps.shift()];
  const adjetivos = [];
  const resto = [];
  for (const p of ps) {
    const k = clave(p);
    if (Object.hasOwn(PALABRAS, k)) cuenta.n += 1;
    if (ADJETIVOS.has(k)) adjetivos.push(PALABRAS[k]);
    else resto.push(Object.hasOwn(PALABRAS, k) ? PALABRAS[k] : p);
  }
  for (const p of cosa) cuenta.n += 1;
  return [...adjetivos, ...resto, ...cosa.map((p) => PALABRAS[clave(p)])];
}

function traducirNombre(nombre, { tipo } = {}) {
  const original = String(nombre ?? '').trim().replace(/\s+/g, ' ');
  if (!original) return original;
  if (tipo === 'escena') {
    const frase = FRASES_ESCENA[clave(original).replace(/[^\p{L}\p{N} ]/gu, '').trim()];
    if (frase) return frase;
  }
  const palabras = original.split(' ');
  if (palabras.length > 1 && Object.hasOwn(VERBOS, clave(palabras[0]))) {
    const resto = traducirNombre(palabras.slice(1).join(' '));
    const verbo = VERBOS[clave(palabras[0])];
    return verbo.charAt(0).toUpperCase() + verbo.slice(1) + ' ' + resto.charAt(0).toLowerCase() + resto.slice(1);
  }
  const tramos = [[]];
  for (const p of palabras) {
    if (UNIONES.has(clave(p)) && tramos[tramos.length - 1].length) tramos.push([]);
    else tramos[tramos.length - 1].push(p);
  }
  const cuenta = { n: 0 };
  // «Luz de la terraza de la recámara» → recámara, terraza, luz
  const salida = tramos.filter((t) => t.length).reverse().flatMap((t) => tramo(t, cuenta));
  if (!cuenta.n || !salida.length) return original;
  // «Escritorio Interruptor 1» (cada palabra con mayúscula) → «Desk Switch 1»;
  // las siglas (TV, LED) no cuentan como palabras.
  const letras = palabras.filter((p) => /^\p{L}/u.test(p) && !/^\p{Lu}+$/u.test(p) && !ARTICULOS.has(clave(p)) && !UNIONES.has(clave(p)));
  const titulo = letras.length > 1 && letras.every((p) => /^\p{Lu}/u.test(p));
  let texto = salida.join(' ');
  // TODO EN MAYÚSCULAS («LUZ DE LA SALA») → «Living room light»
  if (original === original.toUpperCase()) texto = texto.replace(/\p{L}+/gu, (w) => (w === w.toUpperCase() && w.length > 1 && w !== 'LED' ? w.toLowerCase() : w));
  if (titulo) texto = texto.replace(/(^|[\s-])(\p{Ll})/gu, (_m, a, b) => a + b.toUpperCase());
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

return { traducirNombre };
})();

// ---- src/descubrir.mjs
const __vp_descubrir = (() => {
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

const { TIPOS, TIPO_DE_DOMINIO } = __vp_tipos;
const { traducirNombre } = __vp_traducir;

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
function dispositivosEtiquetados({ etiquetas = [], dispositivos = [], entidades = [], estados = [] }, nombreEtiqueta, fijos = []) {
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
function crearDescubridor({
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

return { dispositivosEtiquetados, crearDescubridor };
})();

// ---- panel/tarjeta.mjs
const __vp_tarjeta = (() => {
// Vizions Panel — la tarjeta propia de Home Assistant para la tablet del dueño.
//
// VIZIONS-PANEL-01 y 02. Dibuja, dentro del propio Home Assistant de la casa, el
// diseño aprobado el 2 nov 2026: «Casa» (saludo, clima de afuera, resumen y
// escenas) y una pestaña por cuarto con fichas de vidrio. Responsiva: tablet
// horizontal, vertical y celular.
//
// Qué aparece: SOLO lo que tenga la etiqueta «Vizions Panel» en Home Assistant
// (aparte de «Vizions», que es la del huésped en la TV y el celular). Usa las
// mismas reglas que la TV (src/descubrir.mjs): etiqueta en la entidad o en el
// dispositivo, sin entidades de configuración, ocultas ni deshabilitadas.
// Los cuartos son las áreas de Home Assistant; la foto del cuarto es la imagen
// del área. Lo que no tiene área va a «Otros».
//
// Qué hace un toque: lo mismo que la TV, con la lista blanca de src/tipos.mjs
// (luz: encender/apagar; persiana: abrir/cerrar/detener; aire: encender/apagar;
// bocina: reproducir/pausar; escena: activar). La orden va directo a Home
// Assistant por la red local, con el usuario de la tablet; no pasa por la nube.
//
// VIZIONS-PANEL-02: accesos rápidos en Casa (etiqueta «Vizions Panel Inicio»),
// escenas compactas, sombra para que el texto se lea sobre fotos claras, y
// ventanas al MANTENER PRESIONADA una ficha: luz (brillo, tono de blanco y
// color), aire (temperatura, modo y ventilador), bocina (controles, volumen y
// silencio) y persiana (subir/detener/bajar y posición). El toque normal sigue
// prendiendo y apagando. Lo que el dueño puede ajustar de más que el huésped
// (color, tono, modo del aire, pistas, posición) vive aquí, en CONTROLES de la
// ventana; src/tipos.mjs (la lista de la TV) no cambia.
//
// VIZIONS-PANEL-03: pestaña «Cámaras» con las cámaras etiquetadas «Vizions Panel»
// (en la entidad o en su dispositivo). Cuadrícula con la imagen de cada una (se
// refresca cada 10 s) y, al tocar, la vista grande en vivo (el MJPEG que da Home
// Assistant para cualquier cámara) con pantalla completa. Las imágenes salen del
// propio Home Assistant de la casa con su token temporal; nada pasa por la nube.
//
// VIZIONS-PANEL-04: modo kiosko. En la tablet (usuario SIN administrador) se
// esconden la barra lateral y el encabezado de Home Assistant: queda solo el
// panel, a pantalla completa. El dueño con administrador ve Home Assistant
// normal (para poder editar). «kiosko: false» en la tarjeta lo apaga; en la
// dirección, ?kiosko=0 lo apaga y ?kiosko=1 lo prende (para probarlo como admin).
// La instalación (archivo, recurso y tablero) la hace el complemento solo.
// 0.4.1: el kiosko también quita el espacio de la barra lateral en HA 2026.10
// (sidebar-shell / --ha-sidebar-width); antes quedaba una franja a la izquierda.
// 0.4.2: en la tablet (app de HA) el panel llega hasta las orillas por debajo de las
// barras de Android (antes HA dejaba ese hueco en blanco) y la página ya no se desliza;
// el texto se recorre para no quedar debajo de esas barras.
// 0.4.3: en kiosko, «Atrás» (el gesto de la orilla en Android, el botón del navegador)
// ya no saca del panel a otras páginas de HA: se queda donde está.
// 0.4.4: el número grande de las ventanas (brillo, volumen, posición) tenía el mismo
// nombre de estilo que la vista grande de la cámara y se dibujaba como caja de 16:9.
//
// VIZIONS-PANEL-06 (0.5.0, mockups aprobados el 6 nov 2026):
//  · Bocinas: ya no son fichas en la fila del cuarto ni en Accesos rápidos. Las
//    maneja un chip de audio (en Casa, todas las de la casa; en un cuarto, las de
//    ese cuarto) que abre un panel lateral sólido con una tarjeta por bocina:
//    anterior/reproducir/siguiente, silencio y volumen. Mantener presionada la
//    tarjeta abre la ventana de música de siempre.
//  · Cámaras sin foto (una cámara genérica solo con video, como las de un grabador
//    Hikvision): Home Assistant contesta 500 a la foto y al MJPEG. Si la foto de una
//    cámara falla, el panel la marca «sin foto» 10 min y usa el reproductor de video
//    del propio Home Assistant (ha-camera-stream: WebRTC o HLS, lo que tenga), igual
//    que su ventana de cámara. En la cuadrícula, video en vivo para las primeras 4
//    cámaras sin foto; las demás dicen «Toca para ver en vivo». Sin foto y sin video:
//    «Sin imagen». Las cámaras con foto siguen igual.
//
// VIZIONS-PANEL-06b (0.5.1): el botón de pantalla completa de la cámara grande ahora también sale
// (antes solo entraba, y para salir hacía falta el gesto «Atrás» de Android; en una tablet de kiosko
// sin gestos no había salida). Cambia de icono y de texto. Esc también sale.
//
// VIZIONS-PANEL-07 (0.6.0, mockup aprobado el 7 nov 2026):
//  · Chip de aires: en Casa (todos los aires de la casa, con la temperatura de adentro; sustituye
//    al chip «Interior») y en cada cuarto con aire (los de ese cuarto). Abre un panel lateral
//    sólido con una tarjeta por aire: encender/apagar, − temperatura + y el modo. Mantener
//    presionada la tarjeta abre la ventana completa del aire (ventilador incluido). Las fichas de
//    aire se quedan en la fila del cuarto y en Accesos rápidos.
//  · El chip de cámaras de Casa se puede tocar: abre un panel lateral con las cámaras (mismas
//    reglas de video en vivo: hasta 4, «Toca para ver en vivo», «Sin imagen»). Tocar una cámara
//    la abre en grande en la pestaña Cámaras; «Ver todas» lleva a la cuadrícula.
//  · Un solo panel lateral a la vez (audio, aires o cámaras).
//
// VIZIONS-PANEL-08 (0.7.0, mockups aprobados el 9 nov 2026):
//  · Cuartos: con 2 o más luces (`light.`), una tarjeta ancha «Luces» las junta (cuántas encendidas, una
//    barrita por luz y un botón para apagar/encender todas); con 2 o más persianas, una tarjeta «Persianas»
//    (▲ ▼ para todas). Tocar la tarjeta abre el panel lateral con cada una. Los apagadores/enchufes
//    (`switch.`) siguen sueltos. Etiqueta nueva «Vizions Panel Favorito»: esa luz o persiana sale también
//    suelta en la fila (con estrella).
//  · Casa: el chip de Persianas se toca (panel con todas las persianas de la casa) y hay chip «Escenas»
//    (panel con los botones y «Ver todas»). La fila de escenas de abajo se quitó.
//  · Pestaña «Escenas» (si hay): botones agrupados por cuarto (área de HA) y «Toda la casa».
//  · Automatizaciones (`automation.`) con la etiqueta del panel: botón que la corre en ese momento
//    (automation.trigger). Solo en el panel del dueño: la TV del huésped no las toma.
//
// VIZIONS-PANEL-09 (0.8.0, aprobado el 9 nov 2026): cada aparato se ve con el ícono que le da Home
// Assistant (el automático o el que se le ponga a mano en sus Ajustes, p. ej. mdi:chandelier), en las
// fichas, los botones de escenas y las tarjetas de aire y bocina. Lo pinta el propio HA (ha-state-icon);
// mientras carga, o si no está, se ve el ícono genérico de siempre.
// También: abajo de la hora, la pila de la tablet (solo el ícono: nivel, rayo si carga, roja si baja).
// Se lee de Kiosk Satellite (kioskSatellite.getDeviceInfo), Fully Kiosk (fully.getBatteryLevel) o del
// navegador (navigator.getBattery, solo con https); si no hay de dónde, no aparece.
//
// VIZIONS-PANEL-10 (0.9.0, aprobado el 9 nov 2026): una tablet por cuarto. Con `?cuarto=` en la dirección
// (nombre del área, sin importar mayúsculas ni acentos, o su id) — o `cuarto:` en la configuración de la
// tarjeta — el panel abre en ese cuarto al cargar, y si alguien lo deja en otra pestaña (o con un panel o
// ventana abiertos) regresa solo a los 5 min sin tocar la pantalla (no si hay una cámara en pantalla
// completa). Sin `?cuarto=`, todo igual que antes.
//
// VIZIONS-PANEL-11 (0.10.0, mockup aprobado el 10 nov 2026): ventiladores (`fan.`), solo en el panel del
// dueño (la TV del huésped no los toma). Chip «Ventiladores» en Casa (todos los de la casa) y en cada cuarto
// con ventilador (los de ese cuarto): abre un panel lateral con una tarjeta por ventilador — encender/apagar,
// velocidad (un botón por paso, según `percentage_step`; sin velocidad no hay fila) y oscilación (si la
// soporta). En el cuarto la ficha se queda; con 2 o más ventiladores, una tarjeta ancha «Ventiladores» los
// junta (botón para apagar/encender todos) y los favoritos salen también sueltos. Un apagador que en HA se
// muestra como ventilador («Mostrar como → Ventilador») sale una sola vez, como ventilador.
//
// VIZIONS-PANEL-12 (0.11.0, mockup aprobado el 14 nov 2026): acomodo para celular. Cuando la tarjeta mide
// menos de ANCHO_MOVIL px de ancho (un teléfono; la tablet no cambia) se marca `movil`: la foto queda como
// franja arriba, marca/hora/pila en una línea, pestañas y chips en filas que se deslizan (la pestaña activa
// se centra sola), fichas en dos columnas (las tarjetas anchas ocupan las dos), cámaras una por renglón, y
// los paneles laterales y la ventana salen como hoja desde abajo (se cierran con la X, tocando afuera o
// deslizando hacia abajo desde su asa). Misma tarjeta y mismo tablero; el kiosko sigue siendo para quien no
// es administrador.
//
// Se arma en un solo archivo con scripts/panel-construir.mjs.

const { dispositivosEtiquetados } = __vp_descubrir;
const { TIPOS, noDisponibleDe } = __vp_tipos;
const { traducirNombre } = __vp_traducir;

const VERSION_PANEL = '0.11.0';
const ETIQUETA_PANEL = 'Vizions Panel';
const ETIQUETA_INICIO = 'Vizions Panel Inicio';
const ETIQUETA_FAVORITO = 'Vizions Panel Favorito';
const EVENTOS_REGISTRO = ['entity_registry_updated', 'device_registry_updated', 'area_registry_updated', 'label_registry_updated'];
const OTROS = '__otros__';
const ORDEN_TIPOS = ['luz', 'cortina', 'clima', 'ventilador', 'bocina', 'escena'];
const CASA = '__casa__';
const CAMARAS = '__camaras__';
const ESCENAS = '__escenas__';
// PANEL-06: cuántas cámaras sin foto se ven en vivo a la vez en la cuadrícula, y cuánto dura la marca «sin foto».
const MAX_VIVO = 4;
const SIN_FOTO_MS = 10 * 60 * 1000;
const CAM_STREAM = 2; // CameraEntityFeature.STREAM

// ------------------------------------------------------------------ kiosko

// ¿Esconder la barra lateral y el encabezado de Home Assistant?
// busqueda = location.search. El parámetro de la dirección manda sobre todo.
function quiereKiosko({ esAdmin, config, busqueda } = {}) {
  let p = null;
  try {
    p = new URLSearchParams(busqueda || '').get('kiosko');
  } catch {
    p = null;
  }
  if (p === '0') return false;
  if (p === '1') return true;
  if (config === false) return false;
  return !esAdmin;
}

// Estilos que se meten en Home Assistant (no en la tarjeta), por raíz de sombra.
// home-assistant-main: sin barra lateral. ha-drawer: sin el cajón ni su velo
// (en celular se abre deslizando). hui-root: sin encabezado ni su espacio.
// Cubre las dos formas que ha tenido HA: hasta 2026.2 (mdc-drawer, --mdc-drawer-width)
// y desde 2026.10 (sidebar-shell / wa-drawer, --ha-sidebar-width).
const KIOSKO_ID = 'vizions-panel-kiosko';
const CSS_KIOSKO = {
  'home-assistant-main':
    ':host{--mdc-drawer-width:0px !important;--mdc-top-app-bar-width:100% !important;--ha-sidebar-width:0px !important;--ha-top-app-bar-width:100% !important}ha-sidebar{display:none !important}',
  'ha-drawer':
    '.mdc-drawer,.mdc-drawer-scrim,.sidebar-shell,wa-drawer{display:none !important}.mdc-drawer-app-content,.app-content{margin-left:0 !important;margin-right:0 !important;padding-inline-start:0 !important;width:100% !important}',
  'hui-root': ':host{--header-height:0px !important}.header{display:none !important}hui-view-container,#view{padding-top:0 !important;padding-bottom:0 !important}',
  // La página entera: fondo oscuro (nunca el blanco de HA) y sin deslizarse; solo el panel se desliza por dentro.
  documento: 'html,body{background:#1c1f24 !important;overflow:hidden !important;overscroll-behavior:none !important}',
};

// Las raíces de sombra de Home Assistant donde va cada estilo, subiendo desde la tarjeta.
function raicesKiosko(tarjeta) {
  const r = {};
  let n = tarjeta;
  for (let i = 0; n && i < 40; i += 1) {
    const raiz = n.getRootNode && n.getRootNode();
    if (!raiz || !raiz.host) break;
    const nombre = raiz.host.localName;
    if (nombre === 'hui-root' || nombre === 'home-assistant-main') r[nombre] = raiz.host.shadowRoot;
    n = raiz.host;
  }
  const main = r['home-assistant-main'];
  const cajon = main && main.querySelector('ha-drawer');
  if (cajon && cajon.shadowRoot) r['ha-drawer'] = cajon.shadowRoot;
  if (tarjeta.ownerDocument && tarjeta.ownerDocument.head) r.documento = tarjeta.ownerDocument.head;
  return r;
}

// ------------------------------------------------------------------ textos

const TXT = {
  es: {
    casa: 'Casa', otros: 'Otros', escenas: 'Escenas', escena: 'Escena', automatizacion: 'Automatización', activada: 'Activada',
    luces: (n) => (n === 1 ? '1 luz encendida' : `${n} luces encendidas`),
    deLuces: (a, b) => (b === 1 ? `${a} de 1 luz encendida` : `${a} de ${b} luces encendidas`),
    dias: 'Buenos días', tardes: 'Buenas tardes', noches: 'Buenas noches',
    encendida: 'Encendida', apagada: 'Apagada', apagado: 'Apagado',
    abierta: 'Abierta', cerrada: 'Cerrada', abriendo: 'Abriendo…', cerrando: 'Cerrando…',
    noDisp: 'No disponible', sonando: 'Reproduciendo', pausa: 'En pausa', sinMusica: 'Sin música',
    interior: 'Interior', musica: 'Música', persianas: 'Persianas', abiertas: (n) => (n === 1 ? '1 abierta' : `${n} abiertas`), todasCerradas: 'Cerradas',
    humedad: (h) => `Humedad ${h} %`,
    fresco: 'FRESCO', agradable: 'AGRADABLE', caluroso: 'CALUROSO',
    climaVerbo: { cooling: 'Enfriando', heating: 'Calentando', drying: 'Secando', fan: 'Ventilando', cool: 'Frío', heat: 'Calor', dry: 'Seco', fan_only: 'Ventilador', auto: 'Automático', heat_cool: 'Automático' },
    a: 'a', espera: 'Encendido',
    vacioTitulo: 'Todavía no hay nada en el panel',
    vacioTexto: 'En Home Assistant, pon la etiqueta «Vizions Panel» a las luces, persianas, aires, bocinas y escenas que quieras ver aquí.',
    errorRegistro: 'No se pudo leer Home Assistant. Reintentando…',
    errorOrden: 'No se pudo enviar la orden. Intenta de nuevo.',
    cuartos: 'Cuartos', accesos: 'Accesos rápidos',
    camaras: 'Cámaras', enLinea: (n) => `${n} EN LÍNEA`, sinConexionN: (n) => `${n} SIN CONEXIÓN`, sinConexion: 'Sin conexión', enVivo: 'EN VIVO', verTodas: 'Ver todas', pantallaCompleta: 'Pantalla completa', salirPantalla: 'Salir de pantalla completa', abrirCamara: (n) => `Abrir ${n} en grande`, camarasChip: (n) => (n === 1 ? '1 en línea' : `${n} en línea`),
    brillo: 'Brillo', tono: 'Tono de blanco', tonos: { 2700: 'Cálido', 4000: 'Neutro', 6500: 'Frío' }, color: 'Color',
    colores: { ambar: 'Ámbar', coral: 'Coral', rosa: 'Rosa', violeta: 'Violeta', azul: 'Azul', turquesa: 'Turquesa' },
    apagar: 'Apagar', encender: 'Encender', listo: 'Listo', cerrar: 'Cerrar',
    modo: 'Modo', ventilador: 'Ventilador', bajarTemp: 'Bajar temperatura', subirTemp: 'Subir temperatura', ahora: (t) => `ahora ${t}°`,
    modos: { cool: 'Frío', heat: 'Calor', dry: 'Seco', fan_only: 'Ventilador', auto: 'Auto', heat_cool: 'Auto' },
    vels: { auto: 'Auto', low: 'Baja', medium: 'Media', middle: 'Media', high: 'Alta', silent: 'Silencio', quiet: 'Silencio', turbo: 'Turbo', on: 'Encendido', off: 'Apagado', diffuse: 'Difuso', focus: 'Directo' },
    volumen: 'Volumen', silenciar: 'Silenciar', quitarSilencio: 'Quitar silencio', anterior: 'Anterior', siguiente: 'Siguiente', reproducirPausar: 'Reproducir o pausar',
    subir: 'Subir', detener: 'Detener', bajar: 'Bajar', posicion: 'Posición',
    bocinas: (n) => `${n} bocinas`, reproduciendoN: (n) => `${n} reproduciendo`, enPausa: 'en pausa', sinMusicaMin: 'sin música', sinConexionMin: 'sin conexión',
    audioCasa: 'Audio de la casa', audioDe: (c) => `Audio · ${c}`, abrirAudio: 'Abrir el audio', sinImagen: 'Sin imagen', tocaVivo: 'Toca para ver en vivo',
    bateria: (n, c) => `Batería ${n} %${c ? ', cargando' : ''}`,
    todaLaCasa: 'Toda la casa', escenasSobre: (n) => (n === 1 ? '1 escena' : `${n} escenas`), luces2: 'Luces', lucesDe: (on, n) => (on === 0 ? 'Todas apagadas' : on === n ? 'Todas encendidas' : `${on} de ${n} encendidas`),
    persianasDe: (ab, n) => (ab === 0 ? 'Todas cerradas' : ab === n ? 'Todas abiertas' : `${ab} de ${n} ${ab === 1 ? 'abierta' : 'abiertas'}`),
    apagarTodas: 'Apagar todas', encenderTodas: 'Encender todas', abrirTodas: 'Abrir todas', cerrarTodas: 'Cerrar todas', favorito: 'Favorito',
    lucesDeCuarto: (c) => `Luces · ${c}`, persianasCasa: 'Persianas de la casa', persianasDeCuarto: (c) => `Persianas · ${c}`,
    abrirLuces: 'Abrir las luces', abrirPersianas: 'Abrir las persianas', abrirEscenas: 'Abrir las escenas', escenasN: (n) => `${n}`,
    ventiladores: (n) => `${n} ventiladores`, ventiladores2: 'Ventiladores', ventiladoresDe: (on, n) => (on === 0 ? 'Todos apagados' : on === n ? 'Todos encendidos' : `${on} de ${n} encendidos`),
    ventiladoresCasa: 'Ventiladores de la casa', ventiladoresDeCuarto: (c) => `Ventiladores · ${c}`, abrirVentiladores: 'Abrir los ventiladores', apagarTodos: 'Apagar todos', encenderTodos: 'Encender todos',
    velocidad: 'Velocidad', velDe: (v, n) => `Vel. ${v} de ${n}`, oscilacion: 'Oscilación', encendidoV: 'Encendido',
    aires: (n) => `${n} aires`, encendidosN: (n) => (n === 1 ? '1 encendido' : `${n} encendidos`), apagadosMin: 'apagados', adentro: (t) => `${t}° adentro`,
    airesCasa: 'Aires de la casa', airesDe: (c) => `Aires · ${c}`, abrirAires: 'Abrir los aires', abrirCamaras: 'Abrir las cámaras', camarasLat: (n) => `Cámaras · ${n} en línea`,
    clima: { 'clear-night': 'DESPEJADO', cloudy: 'NUBLADO', exceptional: 'EXCEPCIONAL', fog: 'NIEBLA', hail: 'GRANIZO', lightning: 'TORMENTA', 'lightning-rainy': 'TORMENTA', partlycloudy: 'PARCIALMENTE NUBLADO', pouring: 'AGUACERO', rainy: 'LLUVIA', snowy: 'NIEVE', 'snowy-rainy': 'AGUANIEVE', sunny: 'SOLEADO', windy: 'VIENTO', 'windy-variant': 'VIENTO' },
  },
  en: {
    casa: 'Home', otros: 'Other', escenas: 'Scenes', escena: 'Scene', automatizacion: 'Automation', activada: 'Activated',
    luces: (n) => (n === 1 ? '1 light on' : `${n} lights on`),
    deLuces: (a, b) => (b === 1 ? `${a} of 1 light on` : `${a} of ${b} lights on`),
    dias: 'Good morning', tardes: 'Good afternoon', noches: 'Good evening',
    encendida: 'On', apagada: 'Off', apagado: 'Off',
    abierta: 'Open', cerrada: 'Closed', abriendo: 'Opening…', cerrando: 'Closing…',
    noDisp: 'Unavailable', sonando: 'Playing', pausa: 'Paused', sinMusica: 'No music',
    interior: 'Indoor', musica: 'Music', persianas: 'Blinds', abiertas: (n) => `${n} open`, todasCerradas: 'Closed',
    humedad: (h) => `Humidity ${h} %`,
    fresco: 'COOL', agradable: 'COMFORTABLE', caluroso: 'WARM',
    climaVerbo: { cooling: 'Cooling', heating: 'Heating', drying: 'Drying', fan: 'Fan', cool: 'Cool', heat: 'Heat', dry: 'Dry', fan_only: 'Fan', auto: 'Auto', heat_cool: 'Auto' },
    a: 'to', espera: 'On',
    vacioTitulo: 'Nothing on the panel yet',
    vacioTexto: 'In Home Assistant, add the «Vizions Panel» label to the lights, blinds, air conditioners, speakers and scenes you want to see here.',
    errorRegistro: 'Could not read Home Assistant. Retrying…',
    errorOrden: 'The command could not be sent. Please try again.',
    cuartos: 'Rooms', accesos: 'Quick access',
    camaras: 'Cameras', enLinea: (n) => `${n} ONLINE`, sinConexionN: (n) => `${n} OFFLINE`, sinConexion: 'Offline', enVivo: 'LIVE', verTodas: 'View all', pantallaCompleta: 'Full screen', salirPantalla: 'Exit full screen', abrirCamara: (n) => `Open ${n} full size`, camarasChip: (n) => `${n} online`,
    brillo: 'Brightness', tono: 'White tone', tonos: { 2700: 'Warm', 4000: 'Neutral', 6500: 'Cool' }, color: 'Color',
    colores: { ambar: 'Amber', coral: 'Coral', rosa: 'Pink', violeta: 'Violet', azul: 'Blue', turquesa: 'Turquoise' },
    apagar: 'Turn off', encender: 'Turn on', listo: 'Done', cerrar: 'Close',
    modo: 'Mode', ventilador: 'Fan', bajarTemp: 'Lower temperature', subirTemp: 'Raise temperature', ahora: (t) => `now ${t}°`,
    modos: { cool: 'Cool', heat: 'Heat', dry: 'Dry', fan_only: 'Fan', auto: 'Auto', heat_cool: 'Auto' },
    vels: { auto: 'Auto', low: 'Low', medium: 'Medium', middle: 'Medium', high: 'High', silent: 'Quiet', quiet: 'Quiet', turbo: 'Turbo', on: 'On', off: 'Off', diffuse: 'Diffuse', focus: 'Focus' },
    volumen: 'Volume', silenciar: 'Mute', quitarSilencio: 'Unmute', anterior: 'Previous', siguiente: 'Next', reproducirPausar: 'Play or pause',
    subir: 'Up', detener: 'Stop', bajar: 'Down', posicion: 'Position',
    bocinas: (n) => `${n} speakers`, reproduciendoN: (n) => `${n} playing`, enPausa: 'paused', sinMusicaMin: 'no music', sinConexionMin: 'offline',
    audioCasa: 'Home audio', audioDe: (c) => `Audio · ${c}`, abrirAudio: 'Open audio', sinImagen: 'No image', tocaVivo: 'Tap to watch live',
    bateria: (n, c) => `Battery ${n}%${c ? ', charging' : ''}`,
    todaLaCasa: 'Whole home', escenasSobre: (n) => (n === 1 ? '1 scene' : `${n} scenes`), luces2: 'Lights', lucesDe: (on, n) => (on === 0 ? 'All off' : on === n ? 'All on' : `${on} of ${n} on`),
    persianasDe: (ab, n) => (ab === 0 ? 'All closed' : ab === n ? 'All open' : `${ab} of ${n} open`),
    apagarTodas: 'Turn all off', encenderTodas: 'Turn all on', abrirTodas: 'Open all', cerrarTodas: 'Close all', favorito: 'Favorite',
    lucesDeCuarto: (c) => `Lights · ${c}`, persianasCasa: 'Home blinds', persianasDeCuarto: (c) => `Blinds · ${c}`,
    abrirLuces: 'Open lights', abrirPersianas: 'Open blinds', abrirEscenas: 'Open scenes', escenasN: (n) => `${n}`,
    ventiladores: (n) => `${n} fans`, ventiladores2: 'Fans', ventiladoresDe: (on, n) => (on === 0 ? 'All off' : on === n ? 'All on' : `${on} of ${n} on`),
    ventiladoresCasa: 'Home fans', ventiladoresDeCuarto: (c) => `Fans · ${c}`, abrirVentiladores: 'Open fans', apagarTodos: 'Turn all off', encenderTodos: 'Turn all on',
    velocidad: 'Speed', velDe: (v, n) => `Speed ${v} of ${n}`, oscilacion: 'Oscillation', encendidoV: 'On',
    aires: (n) => `${n} A/C units`, encendidosN: (n) => `${n} on`, apagadosMin: 'off', adentro: (t) => `${t}° inside`,
    airesCasa: 'Home A/C', airesDe: (c) => `A/C · ${c}`, abrirAires: 'Open A/C', abrirCamaras: 'Open cameras', camarasLat: (n) => `Cameras · ${n} online`,
    clima: { 'clear-night': 'CLEAR', cloudy: 'CLOUDY', exceptional: 'EXCEPTIONAL', fog: 'FOG', hail: 'HAIL', lightning: 'STORM', 'lightning-rainy': 'STORM', partlycloudy: 'PARTLY CLOUDY', pouring: 'POURING', rainy: 'RAIN', snowy: 'SNOW', 'snowy-rainy': 'SLEET', sunny: 'SUNNY', windy: 'WINDY', 'windy-variant': 'WINDY' },
  },
};

const idiomaDe = (hass) => (String(hass?.locale?.language || hass?.language || 'es').toLowerCase().startsWith('en') ? 'en' : 'es');

// ------------------------------------------------------------------ íconos (trazos 24×24)

const ICONOS = {
  light: 'M9 18h6 M10 22h4 M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.1V18h6v-1.2c0-.8.4-1.6 1-2.1A7 7 0 0 0 12 2Z',
  switch: 'M12 22v-5 M9 8V2 M15 8V2 M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z',
  cortina: 'M3 3h18 M20 7H8 M20 11H8 M10 19h10 M8 15h12 M4 3v14 M4 17a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z',
  clima: 'M2 12h20 M12 2v20 M20 16l-4-4 4-4 M4 8l4 4-4 4 M16 4l-4 4-4-4 M8 20l4-4 4 4',
  bocina: 'M6 2h12v20H6z M12 11a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z M12 6h.01',
  escena: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9Z M19 17v4 M17 19h4',
  termometro: 'M14 4v10.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0Z',
  musica: 'M9 18V5l12-2v13 M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z M21 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
  cerrar: 'M6 6l12 12 M18 6L6 18', menos: 'M5 12h14', mas: 'M12 5v14 M5 12h14',
  anterior: 'M19 20 9 12l10-8v16Z M5 19V5', siguiente: 'M5 4l10 8-10 8V4Z M19 5v14', play: 'M7 4l13 8-13 8V4Z', pausa: 'M6 4h4v16H6z M14 4h4v16h-4z',
  silencio: 'M11 5 6 9H2v6h4l5 4V5Z M22 9l-6 6 M16 9l6 6', sonido: 'M11 5 6 9H2v6h4l5 4V5Z M15.5 8.5a5 5 0 0 1 0 7 M19 5a10 10 0 0 1 0 14',
  arriba: 'M6 15l6-6 6 6', alto: 'M7 7h10v10H7z', abajo: 'M6 9l6 6 6-6',
  camara: 'M16 13l5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5 M4 6h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z',
  ecualizador: 'M6 19v-6 M12 19V5 M18 19v-9', derecha: 'M9 6l6 6-6 6',
  rejilla: 'M3 3h7v7H3z M14 3h7v7h-7z M14 14h7v7h-7z M3 14h7v7H3z', completa: 'M8 3H5a2 2 0 0 0-2 2v3 M21 8V5a2 2 0 0 0-2-2h-3 M3 16v3a2 2 0 0 0 2 2h3 M16 21h3a2 2 0 0 0 2-2v-3',
  reducir: 'M8 3v3a2 2 0 0 1-2 2H3 M21 8h-3a2 2 0 0 1-2-2V3 M3 16h3a2 2 0 0 1 2 2v3 M16 21v-3a2 2 0 0 1 2-2h3',
  encendido: 'M12 2v10 M18.4 6.6a9 9 0 1 1-12.77.04',
  estrella: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9Z',
  rayo: 'M13 2 4 14h7l-1 8 9-12h-7l1-8Z',
  ventilador: 'M12 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z M12 10c0-3 1-7 4-7s2 4-2 7 M14 12c3 0 7 1 7 4s-4 2-7-2 M12 14c0 3-1 7-4 7s-2-4 2-7 M10 12c-3 0-7-1-7-4s4-2 7 2',
};
const iconoDe = (d) => (d.tipo === 'luz' ? ICONOS[d.entidad.startsWith('switch.') ? 'switch' : 'light'] : ICONOS[d.tipo] || ICONOS.escena);

// ------------------------------------------------------------------ utilidades

function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const grados = (v) => {
  const n = num(v);
  if (n === null) return null;
  return String(Math.round(n * 10) / 10).replace(/\.0$/, '');
};
// Solo rutas propias de HA (/local/…, /api/image/serve/…) o http(s), sin comillas ni paréntesis.
const urlSegura = (u) => (typeof u === 'string' && /^(\/(?!\/)|https?:\/\/)[^"'()\\\s<>]*$/.test(u) ? u : null);

// PANEL-05: al subir la imagen de un área, Home Assistant anota en el área la
// MINIATURA (/api/image/serve/<id>/512x512, 512 px de ancho); estirada a pantalla
// completa se pixelea. Para una imagen subida a HA se pide la original y, debajo,
// la miniatura, que se ve si la original no carga. Cualquier otra dirección
// (/local/…, https://…) queda igual.
const MINIATURA_HA = /^\/api\/image\/serve\/([A-Za-z0-9_-]+)\/\d+x\d+(?:-[^/]*)?$/;
function capasFoto(u) {
  const s = urlSegura(u);
  if (!s) return [];
  const m = MINIATURA_HA.exec(s);
  return m ? [`/api/image/serve/${m[1]}/original`, s] : [s];
}

// ------------------------------------------------------------------ cámaras

const normal = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
const ID_CAMARA = /^camera\.[a-z0-9_]+$/;

// Cámaras con la etiqueta (en la entidad, o en su dispositivo si la cámara no es de configuración ni oculta).
function camarasEtiquetadas({ etiquetas = [], dispositivos = [], entidades = [], areas = [], estados = {} }, nombreEtiqueta, idioma = 'es') {
  const objetivo = normal(nombreEtiqueta);
  const marcas = new Set(objetivo ? etiquetas.filter((l) => normal(l.name) === objetivo).map((l) => l.label_id) : []);
  if (!marcas.size) return [];
  const tiene = (x) => Array.isArray(x?.labels) && x.labels.some((l) => marcas.has(l));
  const aparatos = new Map(dispositivos.map((d) => [d.id, d]));
  const areaNombre = new Map(areas.map((a) => [a.area_id, a.name]));
  const loc = idioma === 'en' ? 'en' : 'es';
  return entidades
    .filter((e) => typeof e?.entity_id === 'string' && ID_CAMARA.test(e.entity_id) && !e.disabled_by)
    .filter((e) => {
      if (tiene(e)) return true;
      const ap = e.device_id ? aparatos.get(e.device_id) : null;
      return !!ap && tiene(ap) && !ap.disabled_by && !e.entity_category && !e.hidden_by;
    })
    .map((e) => {
      const ap = e.device_id ? aparatos.get(e.device_id) : null;
      const area = e.area_id || ap?.area_id || null;
      const es = String(estados[e.entity_id]?.attributes?.friendly_name || e.name || e.original_name || e.entity_id.split('.')[1].replace(/_/g, ' ')).trim();
      const lugarEs = area && areaNombre.has(area) ? areaNombre.get(area) : '';
      return {
        entidad: e.entity_id,
        nombre: idioma === 'en' ? traducirNombre(es) || es : es,
        lugar: idioma === 'en' && lugarEs ? traducirNombre(lugarEs) || lugarEs : lugarEs,
      };
    })
    .sort((x, y) => x.nombre.localeCompare(y.nombre, loc));
}

// Imagen (o video en vivo) de una cámara, con el token temporal que Home Assistant pone en su estado.
function urlCamara(estado, vivo = false, tic = 0) {
  const tok = estado?.attributes?.access_token;
  const id = estado?.entity_id;
  if (typeof tok !== 'string' || !/^[A-Za-z0-9]{8,256}$/.test(tok) || typeof id !== 'string' || !ID_CAMARA.test(id)) return null;
  return vivo ? `/api/camera_proxy_stream/${id}?token=${tok}` : `/api/camera_proxy/${id}?token=${tok}&t=${Math.floor(Number(tic) || 0)}`;
}
const camaraEnLinea = (estado) => !!estado && !['unavailable', 'unknown'].includes(estado.state) && urlCamara(estado) !== null;
// PANEL-06: ¿la cámara da video (stream)? Es lo que permite verla sin foto.
const camaraConVideo = (estado) => (Number(estado?.attributes?.supported_features) & CAM_STREAM) === CAM_STREAM;

// ------------------------------------------------------------------ modelo (sin DOM: se prueba en Node)

// PANEL-11: ventiladores (`fan.`). Solo el panel: src/tipos.mjs (la lista de la TV del huésped) no los conoce.
const FAN_VELOCIDAD = 1, FAN_OSCILAR = 2; // FanEntityFeature
const tieneBit = (a, b) => (Number(a?.supported_features) & b) === b;
// Cuántos botones de velocidad: los pasos de HA (100 / percentage_step) si son de 2 a 10; con pasos muy finos
// (de 1 en 1) se dan 4; sin velocidad (o un solo paso), 0.
function pasosVentilador(atributos) {
  if (!tieneBit(atributos, FAN_VELOCIDAD)) return 0;
  const paso = num(atributos?.percentage_step);
  if (paso === null || paso <= 0) return 4;
  const n = Math.round(100 / paso);
  return n < 2 ? 0 : n > 10 ? 4 : n;
}
const TIPOS_PANEL = Object.freeze({
  ventilador: Object.freeze({
    dominios: Object.freeze(['fan']),
    capacidadesDe(_dominio, atributos) {
      const caps = ['encender', 'apagar'];
      if (pasosVentilador(atributos)) caps.push('velocidad');
      if (tieneBit(atributos, FAN_OSCILAR)) caps.push('oscilar');
      return caps;
    },
    estadoDe(_dominio, e) {
      const a = e.attributes || {};
      const salida = { encendido: e.state === 'on' };
      const p = num(a.percentage);
      if (p !== null) salida.porcentaje = Math.max(0, Math.min(100, Math.round(p)));
      const n = pasosVentilador(a);
      if (n) {
        salida.pasos = n;
        salida.nivel = salida.encendido && p !== null && p > 0 ? Math.max(1, Math.min(n, Math.round((p * n) / 100))) : 0;
      }
      if (typeof a.oscillating === 'boolean') salida.oscilando = a.oscillating;
      return salida;
    },
    acciones: Object.freeze({
      encender: Object.freeze({ validar: () => true, servicio: () => ({ dominio: 'fan', servicio: 'turn_on', datos: {} }) }),
      apagar: Object.freeze({ validar: () => true, servicio: () => ({ dominio: 'fan', servicio: 'turn_off', datos: {} }) }),
      velocidad: Object.freeze({
        validar: ({ porcentaje }) => Number.isInteger(porcentaje) && porcentaje >= 1 && porcentaje <= 100,
        servicio: (_d, { porcentaje }) => ({ dominio: 'fan', servicio: 'set_percentage', datos: { percentage: porcentaje } }),
      }),
      oscilar: Object.freeze({
        validar: ({ valor }) => typeof valor === 'boolean',
        servicio: (_d, { valor }) => ({ dominio: 'fan', servicio: 'oscillate', datos: { oscillating: valor } }),
      }),
    }),
  }),
});
// El tipo de un dispositivo: el de la lista de la TV o, si no, el propio del panel.
const tipoDe = (tipo) => (Object.hasOwn(TIPOS, tipo) ? TIPOS[tipo] : Object.hasOwn(TIPOS_PANEL, tipo) ? TIPOS_PANEL[tipo] : null);

// PANEL-11: los ventiladores con una etiqueta (en la entidad, o en su dispositivo si la entidad es normal:
// no de configuración, oculta ni deshabilitada). Mismas reglas que src/descubrir.mjs para luces y aires.
function ventiladoresEtiquetados({ etiquetas = [], dispositivos = [], entidades = [], estados = [] }, nombreEtiqueta) {
  const norm = (x) => String(x ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
  const objetivo = norm(nombreEtiqueta);
  const marcas = new Set(objetivo ? etiquetas.filter((l) => norm(l.name) === objetivo).map((l) => l.label_id) : []);
  if (!marcas.size) return [];
  const tiene = (x) => Array.isArray(x?.labels) && x.labels.some((l) => marcas.has(l));
  const aparatos = new Map(dispositivos.map((d) => [d.id, d]));
  const amigable = new Map(estados.map((x) => [x.entity_id, x.attributes?.friendly_name]));
  return entidades
    .filter((e) => typeof e?.entity_id === 'string' && /^fan\.[a-z0-9_]+$/.test(e.entity_id) && !e.disabled_by)
    .filter((e) => {
      if (tiene(e)) return true;
      const ap = e.device_id ? aparatos.get(e.device_id) : null;
      return !!ap && tiene(ap) && !ap.disabled_by && !e.entity_category && !e.hidden_by;
    })
    .sort((a, b) => (a.entity_id < b.entity_id ? -1 : 1))
    .map((e) => {
      const es = String(amigable.get(e.entity_id) || e.name || e.original_name || e.entity_id.split('.')[1].replace(/_/g, ' ')).trim().replace(/\s+/g, ' ');
      return { id: `ventilador-${e.entity_id.split('.')[1].replace(/_+/g, '-')}`, tipo: 'ventilador', entidad: e.entity_id, nombre: { es, en: traducirNombre(es, { tipo: 'ventilador' }) || es } };
    });
}

// PANEL-08: las automatizaciones con una etiqueta, como «escenas» del panel (un botón que la corre).
// Solo el panel: src/descubrir.mjs (la TV del huésped) no conoce `automation.`.
function rutinasEtiquetadas({ etiquetas = [], entidades = [], estados = [] }, nombreEtiqueta, idioma = 'es') {
  const norm = (x) => String(x ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
  const objetivo = norm(nombreEtiqueta);
  const marcas = new Set(objetivo ? etiquetas.filter((l) => norm(l.name) === objetivo).map((l) => l.label_id) : []);
  if (!marcas.size) return [];
  const amigable = new Map(estados.map((x) => [x.entity_id, x.attributes?.friendly_name]));
  return entidades
    .filter((e) => typeof e?.entity_id === 'string' && /^automation\.[a-z0-9_]+$/.test(e.entity_id) && !e.disabled_by && (e.labels || []).some((l) => marcas.has(l)))
    .sort((a, b) => (a.entity_id < b.entity_id ? -1 : 1))
    .map((e) => {
      const es = String(amigable.get(e.entity_id) || e.name || e.original_name || e.entity_id.split('.')[1].replace(/_/g, ' ')).trim();
      return { id: `rutina-${e.entity_id.split('.')[1].replace(/_+/g, '-')}`, tipo: 'escena', entidad: e.entity_id, nombre: { es, en: traducirNombre(es, { tipo: 'escena' }) || es } };
    });
}

// Registros de Home Assistant + estados → cuartos con sus dispositivos, y escenas.
function armarModelo({ etiquetas = [], dispositivos = [], entidades = [], areas = [], estados = {}, etiqueta = ETIQUETA_PANEL, etiquetaInicio = ETIQUETA_INICIO, etiquetaFavorito = ETIQUETA_FAVORITO, idioma = 'es' }) {
  const registro = { etiquetas, dispositivos, entidades, estados: Object.values(estados) };
  const ent = new Map(entidades.map((e) => [e.entity_id, e]));
  const apar = new Map(dispositivos.map((d) => [d.id, d]));
  // PANEL-11: los ventiladores (solo el panel). Un apagador que HA muestra como ventilador («Mostrar como»,
  // switch_as_x) queda oculto por esa integración y su ventilador toma su aparato (o, sin aparato, su nombre):
  // si ese ventilador sale en el panel, el apagador ya no sale también como luz.
  const vents = ventiladoresEtiquetados(registro, etiqueta);
  const ventsInicio = etiquetaInicio ? ventiladoresEtiquetados(registro, etiquetaInicio) : [];
  const envolventes = [...vents, ...ventsInicio].map((d) => ent.get(d.entidad)).filter((f) => f && f.platform === 'switch_as_x');
  const envuelto = (d) => {
    if (d.tipo !== 'luz' || !d.entidad.startsWith('switch.')) return false;
    const e = ent.get(d.entidad);
    if (!e || e.hidden_by !== 'integration') return false;
    return envolventes.some((f) => (e.device_id ? f.device_id === e.device_id : !f.device_id && !!f.original_name && f.original_name === e.original_name));
  };
  // PANEL-08: las automatizaciones con la etiqueta del panel van como escenas (botón que la corre).
  const lista = [...dispositivosEtiquetados(registro, etiqueta).dispositivos.filter((d) => !envuelto(d)), ...vents, ...rutinasEtiquetadas(registro, etiqueta, idioma)];
  // Accesos rápidos de Casa: lo que tenga la etiqueta de inicio (con o sin la del panel).
  const deInicio = etiquetaInicio ? [...dispositivosEtiquetados(registro, etiquetaInicio).dispositivos.filter((d) => !envuelto(d)), ...ventsInicio, ...rutinasEtiquetadas(registro, etiquetaInicio, idioma)] : [];
  // PANEL-08: las luces y persianas con la etiqueta de favoritos salen también sueltas en la fila del cuarto (PANEL-11: y los ventiladores).
  const favoritos = new Set(etiquetaFavorito ? [...dispositivosEtiquetados(registro, etiquetaFavorito).dispositivos, ...ventiladoresEtiquetados(registro, etiquetaFavorito)].map((d) => d.entidad) : []);
  const areaDe = (entidad) => {
    const e = ent.get(entidad);
    if (!e) return null;
    if (e.area_id) return e.area_id;
    const d = e.device_id ? apar.get(e.device_id) : null;
    return d?.area_id || null;
  };
  const porArea = new Map();
  const escenas = [];
  for (const d of lista) {
    if (d.tipo === 'escena') {
      escenas.push(d);
      continue;
    }
    const a = areaDe(d.entidad);
    const clave = a && areas.some((x) => x.area_id === a) ? a : OTROS;
    if (!porArea.has(clave)) porArea.set(clave, []);
    porArea.get(clave).push(d);
  }
  const loc = idioma === 'en' ? 'en' : 'es';
  const nombreDe = (d) => d.nombre?.[idioma] || d.nombre?.es || d.entidad;
  const ordenTipo = (d) => ORDEN_TIPOS.indexOf(d.tipo);
  for (const ds of porArea.values()) ds.sort((x, y) => ordenTipo(x) - ordenTipo(y) || nombreDe(x).localeCompare(nombreDe(y), loc));
  for (const d of deInicio) if (d.tipo === 'escena' && !escenas.some((x) => x.entidad === d.entidad)) escenas.push(d);
  escenas.sort((x, y) => nombreDe(x).localeCompare(nombreDe(y), loc));
  const porNombre = (x, y) => nombreDe(x).localeCompare(nombreDe(y), loc);
  // PANEL-06: las bocinas no van en Accesos rápidos ni en la fila del cuarto: las maneja el chip de audio.
  const accesos = deInicio.filter((d) => d.tipo !== 'escena' && d.tipo !== 'bocina').sort((x, y) => ordenTipo(x) - ordenTipo(y) || porNombre(x, y));
  const cuarto = (id, nombre, foto) => {
    const ds = porArea.get(id);
    return { id, nombre, foto, dispositivos: ds.filter((d) => d.tipo !== 'bocina'), bocinas: ds.filter((d) => d.tipo === 'bocina').sort(porNombre) };
  };
  const cuartos = areas
    .filter((a) => porArea.has(a.area_id))
    .map((a) => cuarto(a.area_id, idioma === 'en' ? traducirNombre(a.name) || a.name : a.name, urlSegura(a.picture)))
    .sort((x, y) => x.nombre.localeCompare(y.nombre, loc));
  if (porArea.has(OTROS)) cuartos.push(cuarto(OTROS, TXT[idioma].otros, null));
  // Todas las bocinas de la casa (las del panel y las de inicio), una vez cada una.
  const vistas = new Set();
  const bocinas = [...lista, ...deInicio].filter((d) => d.tipo === 'bocina' && (vistas.has(d.entidad) ? false : vistas.add(d.entidad))).sort(porNombre);
  // PANEL-07: todos los aires de la casa (los del panel y los de inicio), una vez cada uno.
  const aires = [...lista, ...deInicio].filter((d) => d.tipo === 'clima' && (vistas.has(d.entidad) ? false : vistas.add(d.entidad))).sort(porNombre);
  // PANEL-08: todas las persianas de la casa (las del panel y las de inicio), una vez cada una.
  const persianas = [...lista, ...deInicio].filter((d) => d.tipo === 'cortina' && (vistas.has(d.entidad) ? false : vistas.add(d.entidad))).sort(porNombre);
  // PANEL-11: todos los ventiladores de la casa (los del panel y los de inicio), una vez cada uno.
  const ventiladores = [...lista, ...deInicio].filter((d) => d.tipo === 'ventilador' && (vistas.has(d.entidad) ? false : vistas.add(d.entidad))).sort(porNombre);
  // PANEL-08: las escenas por cuarto (área de HA), en el orden de los cuartos; las sin cuarto, al final.
  const gruposEscenas = [];
  for (const c of cuartos) {
    if (c.id === OTROS) continue;
    const de = escenas.filter((d) => areaDe(d.entidad) === c.id);
    if (de.length) gruposEscenas.push({ id: c.id, nombre: c.nombre, escenas: de });
  }
  for (const a of areas) {
    if (cuartos.some((c) => c.id === a.area_id)) continue;
    const de = escenas.filter((d) => areaDe(d.entidad) === a.area_id);
    if (de.length) gruposEscenas.push({ id: a.area_id, nombre: idioma === 'en' ? traducirNombre(a.name) || a.name : a.name, escenas: de });
  }
  const sueltas = escenas.filter((d) => !gruposEscenas.some((g) => g.escenas.includes(d)));
  if (sueltas.length) gruposEscenas.push({ id: CASA, nombre: TXT[idioma].todaLaCasa, escenas: sueltas });
  const camaras = camarasEtiquetadas({ etiquetas, dispositivos, entidades, areas, estados }, etiqueta, idioma);
  const total = new Set([...lista, ...deInicio].map((d) => d.entidad)).size + camaras.length;
  return { cuartos, escenas, gruposEscenas, accesos, bocinas, aires, persianas, ventiladores, favoritos, camaras, total };
}

// Qué hace un toque sobre la ficha (o null si el aparato no lo permite).
function accionDeToque(tipo, estado, caps) {
  let a = null;
  if (tipo === 'luz') a = estado.encendida ? 'apagar' : 'encender';
  else if (tipo === 'cortina') a = estado.movimiento !== 'quieta' ? 'detener' : estado.abierta ? 'cerrar' : 'abrir';
  else if (tipo === 'clima') a = estado.encendido ? 'apagar' : 'encender';
  else if (tipo === 'ventilador') a = estado.encendido ? 'apagar' : 'encender';
  else if (tipo === 'bocina') a = estado.estado === 'sonando' ? 'pausar' : 'reproducir';
  else if (tipo === 'escena') a = 'activar';
  return a && caps.includes(a) ? a : null;
}

// Un dispositivo + los estados → lo que pinta la ficha.
function fichaDe(d, estados, idioma = 'es') {
  const T = TXT[idioma];
  const dominio = d.entidad.split('.')[0];
  const nombre = d.nombre?.[idioma] || d.nombre?.es || d.entidad;
  const base = { id: d.id, entidad: d.entidad, tipo: d.tipo, nombre, icono: iconoDe(d), on: false, pct: null, accion: null, disponible: false, sub: T.noDisp };
  const e = estados[d.entidad];
  const t = tipoDe(d.tipo);
  if (!t || !e || noDisponibleDe(d.tipo).includes(e.state)) return base;
  const extras = {};
  for (const [k, id] of Object.entries(d.extras || {})) if (estados[id]) extras[k] = estados[id];
  const caps = t.capacidadesDe(dominio, e.attributes || {}, extras);
  const est = t.estadoDe(dominio, e, extras);
  const f = { ...base, disponible: true, accion: accionDeToque(d.tipo, est, caps), estado: est };
  if (d.tipo === 'luz') {
    f.on = est.encendida;
    f.sub = est.encendida ? (num(est.brillo) !== null ? `${est.brillo} %` : T.encendida) : T.apagada;
    if (est.encendida && num(est.brillo) !== null) f.pct = est.brillo;
  } else if (d.tipo === 'cortina') {
    f.on = est.abierta;
    if (est.movimiento === 'abriendo') f.sub = T.abriendo;
    else if (est.movimiento === 'cerrando') f.sub = T.cerrando;
    else if (est.abierta) f.sub = num(est.posicion) !== null && est.posicion < 100 ? `${T.abierta} ${est.posicion} %` : T.abierta;
    else f.sub = T.cerrada;
  } else if (d.tipo === 'clima') {
    f.on = est.encendido;
    if (!est.encendido) f.sub = T.apagado;
    else {
      const verbo = T.climaVerbo[est.accion] || T.climaVerbo[est.modo] || T.espera;
      f.sub = grados(est.temperatura) !== null ? `${verbo} ${T.a} ${grados(est.temperatura)}°` : verbo;
    }
  } else if (d.tipo === 'ventilador') {
    f.on = est.encendido;
    f.sub = !est.encendido ? T.apagado : est.pasos && est.nivel ? T.velDe(est.nivel, est.pasos) : T.encendidoV;
    if (est.encendido && est.pasos && num(est.porcentaje) !== null) f.pct = est.porcentaje;
  } else if (d.tipo === 'bocina') {
    f.on = est.estado === 'sonando';
    f.sub = est.estado === 'sonando' ? est.titulo || T.sonando : est.estado === 'pausa' ? T.pausa : T.sinMusica;
    if (f.on && num(est.volumen) !== null) f.pct = est.volumen;
  } else if (d.tipo === 'escena') {
    f.sub = d.entidad.startsWith('automation.') ? T.automatizacion : T.escena;
  }
  return f;
}

// Orden de Home Assistant para una acción de la lista blanca.
function ordenDe(d, accion) {
  // PANEL-08: una automatización se CORRE (trigger); su turn_on la habilitaría, que no es lo mismo.
  if (d.tipo === 'escena' && d.entidad.startsWith('automation.')) return accion === 'activar' ? { dominio: 'automation', servicio: 'trigger', datos: { entity_id: d.entidad } } : null;
  const t = tipoDe(d.tipo);
  const a = t?.acciones?.[accion];
  if (!a) return null;
  const dominio = d.entidad.split('.')[0];
  const s = a.servicio(dominio, {});
  const objetivo = a.objetivo ? d.extras?.[a.objetivo] : d.entidad;
  if (!objetivo) return null;
  return { dominio: s.dominio, servicio: s.servicio, datos: { ...s.datos, entity_id: objetivo } };
}

// ------------------------------------------------------------------ ventanas (mantener presionada una ficha)

const MODOS_COLOR = ['hs', 'rgb', 'rgbw', 'rgbww', 'xy'];
const TONOS = [2700, 4000, 6500];
const PUNTO_TONO = { 2700: '#FFC98A', 4000: '#FFF1DC', 6500: '#DCEBFF' };
const COLORES = [['ambar', [255, 180, 92]], ['coral', [255, 122, 107]], ['rosa', [242, 138, 198]], ['violeta', [168, 139, 255]], ['azul', [111, 168, 255]], ['turquesa', [95, 211, 196]]];
const ANTERIOR = 16, SIGUIENTE = 32, POSICION = 4; // MediaPlayerEntityFeature / CoverEntityFeature
const bit = (a, b) => (Number(a?.supported_features) & b) === b;
// «on_low» → «On low» para los modos que no están en la lista de textos.
const bonito = (m) => { const t = String(m).replace(/_/g, ' '); return t.charAt(0).toUpperCase() + t.slice(1); };
const modosDe = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && /^[a-z0-9_]{1,24}$/.test(x)) : []);

// Qué se puede ajustar en la ventana de un dispositivo (null = no tiene ventana).
// PANEL-08: lo que un aparato permite (lista blanca de src/tipos.mjs), o [] si está caído.
function capsDe(d, estados) {
  const e = estados[d.entidad];
  const t = tipoDe(d.tipo);
  if (!t || !e || noDisponibleDe(d.tipo).includes(e.state)) return [];
  const extras = {};
  for (const [k, id] of Object.entries(d.extras || {})) if (estados[id]) extras[k] = estados[id];
  return t.capacidadesDe(d.entidad.split('.')[0], e.attributes || {}, extras);
}

function controlesDe(d, estados) {
  const e = estados[d.entidad];
  const t = tipoDe(d.tipo);
  if (!t || !e || noDisponibleDe(d.tipo).includes(e.state)) return null;
  const dominio = d.entidad.split('.')[0];
  const a = e.attributes || {};
  const extras = {};
  for (const [k, id] of Object.entries(d.extras || {})) if (estados[id]) extras[k] = estados[id];
  const caps = t.capacidadesDe(dominio, a, extras);
  const c = { tipo: d.tipo, caps };
  if (d.tipo === 'luz') {
    if (dominio !== 'light') return null;
    const modos = Array.isArray(a.supported_color_modes) ? a.supported_color_modes : [];
    c.brillo = caps.includes('brillo');
    c.tono = modos.includes('color_temp');
    c.color = modos.some((m) => MODOS_COLOR.includes(m));
    if (!c.brillo && !c.tono && !c.color) return null;
  } else if (d.tipo === 'clima') {
    c.temp = caps.includes('temperatura');
    c.modos = modosDe(a.hvac_modes).filter((m) => m !== 'off');
    c.vels = caps.includes('ventilador') ? modosDe(a.fan_modes) : [];
  } else if (d.tipo === 'bocina') {
    c.volumen = caps.includes('volumen');
    c.silencio = caps.includes('silenciar');
    c.play = caps.includes('reproducir') || caps.includes('pausar');
    c.anterior = bit(a, ANTERIOR);
    c.siguiente = bit(a, SIGUIENTE);
  } else if (d.tipo === 'cortina') {
    c.posicion = bit(a, POSICION) && num(a.current_position) !== null;
  } else return null;
  return c;
}

// Un control de la ventana → orden de Home Assistant, o null si el aparato no lo permite
// o el valor no es válido. Lo común usa la lista blanca de src/tipos.mjs.
function ordenControl(d, estados, control, valor) {
  // PANEL-08: el interruptor de una luz del panel lateral sirve también para las que solo prenden/apagan
  // (esas no tienen ventana, así que controlesDe da null).
  if (control === 'onoff' && d.tipo === 'luz') {
    const acc = estados[d.entidad]?.state === 'on' ? 'apagar' : 'encender';
    return capsDe(d, estados).includes(acc) ? ordenDe(d, acc) : null;
  }
  // PANEL-11: ventilador (no tiene ventana): encender/apagar, velocidad (el número del botón) y oscilación.
  if (d.tipo === 'ventilador') {
    const e = estados[d.entidad];
    const caps = capsDe(d, estados);
    if (!e || !caps.length) return null;
    const a = e.attributes || {};
    const ac = TIPOS_PANEL.ventilador.acciones;
    const propio = (srv) => ({ dominio: srv.dominio, servicio: srv.servicio, datos: { ...srv.datos, entity_id: d.entidad } });
    if (control === 'onoff') {
      const acc = e.state === 'on' ? 'apagar' : 'encender';
      return caps.includes(acc) ? propio(ac[acc].servicio()) : null;
    }
    if (control === 'velocidad') {
      const n = pasosVentilador(a);
      const v = Number(valor);
      if (!caps.includes('velocidad') || !Number.isInteger(v) || v < 1 || v > n) return null;
      const p = { porcentaje: Math.round((v * 100) / n) };
      return ac.velocidad.validar(p) ? propio(ac.velocidad.servicio(null, p)) : null;
    }
    if (control === 'oscilar') return caps.includes('oscilar') && e.state === 'on' ? propio(ac.oscilar.servicio(null, { valor: a.oscillating !== true })) : null;
    return null;
  }
  const c = controlesDe(d, estados);
  if (!c) return null;
  const e = estados[d.entidad];
  const a = e.attributes || {};
  const dominio = d.entidad.split('.')[0];
  const de = (accion, p = {}) => {
    const ac = tipoDe(d.tipo).acciones[accion];
    if (!ac || !c.caps.includes(accion) || !ac.validar(p) || (ac.validarEstado && !ac.validarEstado(e, p))) return null;
    const s = ac.servicio(dominio, p);
    const objetivo = ac.objetivo ? d.extras?.[ac.objetivo] : d.entidad;
    return objetivo ? { dominio: s.dominio, servicio: s.servicio, datos: { ...s.datos, entity_id: objetivo } } : null;
  };
  const propio = (dom, srv, datos) => ({ dominio: dom, servicio: srv, datos: { ...datos, entity_id: d.entidad } });
  const entero = (v, min, max) => {
    const n = Number(v);
    return Number.isFinite(n) && Math.round(n) === n && n >= min && n <= max ? n : null;
  };
  switch (control) {
    case 'onoff':
      if (d.tipo === 'luz') return de(e.state === 'on' ? 'apagar' : 'encender');
      if (d.tipo === 'clima') return de(e.state !== 'off' ? 'apagar' : 'encender');
      return null;
    case 'brillo': {
      const p = entero(valor, 1, 100);
      return c.brillo && p !== null ? de('brillo', { porcentaje: p }) : null;
    }
    case 'tono': {
      const k = Number(valor);
      if (!c.tono || !TONOS.includes(k)) return null;
      const min = num(a.min_color_temp_kelvin) ?? 2000;
      const max = num(a.max_color_temp_kelvin) ?? 6500;
      return propio('light', 'turn_on', { color_temp_kelvin: Math.min(max, Math.max(min, k)) });
    }
    case 'color': {
      const col = COLORES.find((x) => x[0] === valor);
      return c.color && col ? propio('light', 'turn_on', { rgb_color: [...col[1]] }) : null;
    }
    case 'temp': {
      const actual = num(a.temperature);
      const dir = valor === '+' ? 1 : valor === '-' ? -1 : 0;
      if (!c.temp || actual === null || !dir) return null;
      const paso = num(a.target_temp_step) || 0.5;
      let g = Math.round((actual + dir * paso) / paso) * paso;
      g = Math.round(g * 100) / 100;
      const min = num(a.min_temp);
      const max = num(a.max_temp);
      if (min !== null) g = Math.max(min, g);
      if (max !== null) g = Math.min(max, g);
      return g === actual ? null : de('temperatura', { grados: g });
    }
    case 'modo':
      return c.modos?.includes(valor) ? propio('climate', 'set_hvac_mode', { hvac_mode: valor }) : null;
    case 'vent':
      return c.vels?.includes(valor) ? de('ventilador', { modo: valor }) : null;
    case 'play':
      return d.tipo === 'bocina' ? de(e.state === 'playing' ? 'pausar' : 'reproducir') : null;
    case 'anterior':
      return c.anterior ? propio('media_player', 'media_previous_track', {}) : null;
    case 'siguiente':
      return c.siguiente ? propio('media_player', 'media_next_track', {}) : null;
    case 'volumen': {
      const p = entero(valor, 0, 100);
      return c.volumen && p !== null ? de('volumen', { porcentaje: p }) : null;
    }
    case 'silencio':
      return c.silencio ? de(a.is_volume_muted === true ? 'quitar_silencio' : 'silenciar') : null;
    case 'abrir':
    case 'cerrar':
    case 'detener':
      return d.tipo === 'cortina' ? de(control) : null;
    case 'posicion': {
      const p = entero(valor, 0, 100);
      return c.posicion && p !== null ? propio('cover', 'set_cover_position', { position: p }) : null;
    }
    default:
      return null;
  }
}

const confort = (t, T) => (t < 20 ? T.fresco : t <= 26 ? T.agradable : T.caluroso);

// Encabezado de un cuarto: «24° · AGRADABLE» y «Humedad 58 % · 3 de 4 luces encendidas».
function encabezadoCuarto(fichas, estados, idioma = 'es') {
  const T = TXT[idioma];
  const aire = fichas.find((f) => f.tipo === 'clima' && f.disponible && num(f.estado?.actual) !== null);
  const sobre = aire ? `${grados(aire.estado.actual)}° · ${confort(aire.estado.actual, T)}` : '';
  const luces = fichas.filter((f) => f.tipo === 'luz');
  const partes = [];
  const hum = aire ? num(estados[aire.entidad]?.attributes?.current_humidity) : null;
  if (hum !== null) partes.push(T.humedad(Math.round(hum)));
  if (luces.length) partes.push(T.deLuces(luces.filter((f) => f.on).length, luces.length));
  return { sobre, sub: partes.join(' · ') };
}

// ------------------------------------------------------------------ estilos

const CSS = `
:host{display:block;height:100%;--vp-tinte:#FFE2B0}
*{box-sizing:border-box}
button{font-family:inherit;margin:0}
button:focus{outline:none}
button:focus-visible{outline:2px solid rgba(255,255,255,0.75);outline-offset:2px}
.hoja:focus{outline:none}
.raiz{position:relative;width:100%;height:100%;min-height:calc(100vh - var(--header-height, 56px));overflow:hidden;color:#FFFFFF;font-family:'Inter',system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;background-color:#1c1f24;background-position:center center;background-size:cover;background-repeat:no-repeat}
.velo{position:absolute;top:0;left:0;right:0;bottom:0;background:rgba(8,10,14,0.30)}
.sombra{position:absolute;top:0;left:0;right:0;bottom:0;pointer-events:none;background:linear-gradient(to top,rgba(8,10,14,0.62) 0%,rgba(8,10,14,0.30) 45%,rgba(8,10,14,0) 75%)}
:host([kiosko]){--vp-arriba:var(--safe-area-inset-top,env(safe-area-inset-top,0px));--vp-abajo:var(--safe-area-inset-bottom,env(safe-area-inset-bottom,0px))}
.capa{position:absolute;top:0;left:0;right:0;bottom:0;padding:calc(clamp(16px,3vw,36px) + var(--vp-arriba,0px)) 0 calc(clamp(16px,2.5vw,30px) + var(--vp-abajo,0px)) clamp(16px,4.4vw,56px);display:flex;flex-direction:column;gap:clamp(12px,2vw,20px);overflow-y:auto;scrollbar-width:none}
.capa::-webkit-scrollbar{display:none}
.der{padding-right:clamp(16px,4.4vw,56px)}
.barra{display:flex;align-items:center;gap:12px 16px;flex-wrap:wrap;flex:none}
.marca{font-size:15px;font-weight:600;letter-spacing:0.24em;white-space:nowrap;text-transform:uppercase;max-width:40vw;overflow:hidden;text-overflow:ellipsis}
.hora{font-size:22px;font-weight:500;margin-left:auto;order:3;font-variant-numeric:tabular-nums;display:flex;flex-direction:column;align-items:flex-end;gap:6px}
.bat{display:flex;align-items:center;gap:4px;color:rgba(255,255,255,0.78);line-height:0}
.bat svg{stroke:currentColor;fill:currentColor}
.bat .cel{position:relative;display:block;width:24px;height:12px;border:1.5px solid currentColor;border-radius:3px;box-sizing:border-box}
.bat .cel::after{content:'';position:absolute;right:-4px;top:2.5px;width:2px;height:4px;border-radius:1px;background:currentColor}
.bat .cel i{position:absolute;left:1.5px;top:1.5px;bottom:1.5px;border-radius:1px;background:currentColor}
.bat.carga{color:#9FE1CB}
.bat.carga .cel i{background:#5DCAA5}
.bat.baja{color:#F09595}
.tabs{order:2;margin:0 auto;display:flex;gap:2px;padding:6px;border-radius:30px;overflow-x:auto;max-width:100%;scrollbar-width:none}
.tabs::-webkit-scrollbar,.fila::-webkit-scrollbar{display:none}
.tab{flex:none;white-space:nowrap;height:44px;padding:0 16px;border-radius:22px;border:0;cursor:pointer;font-size:15px;font-weight:500;background:transparent;color:rgba(255,255,255,0.84)}
.tab.activa{color:#FFFFFF;background:rgba(255,255,255,0.28);box-shadow:inset 0 0 0 1px rgba(255,255,255,0.35)}
.vidrio{background:rgba(255,255,255,0.10);border:1px solid rgba(255,255,255,0.20);-webkit-backdrop-filter:blur(24px) saturate(140%);backdrop-filter:blur(24px) saturate(140%)}
.vidrio.on{background:rgba(255,255,255,0.28);border-color:rgba(255,255,255,0.42)}
.centro{flex:1 0 auto;display:flex;flex-direction:column;justify-content:center}
.sobre{font-size:15px;font-weight:500;letter-spacing:0.14em;opacity:0.88;min-height:18px}
.titulo{font-size:clamp(48px,10vw,132px);font-weight:600;letter-spacing:-0.045em;line-height:1;margin-top:12px;overflow-wrap:anywhere}
.titulo.casa{font-size:clamp(44px,9vw,112px)}
.sub{font-size:clamp(16px,1.6vw,20px);color:rgba(255,255,255,0.86);margin-top:16px;min-height:1.2em}
.chips{display:flex;gap:10px;margin-top:24px;flex-wrap:wrap}
.chip{height:44px;padding:0 16px;border-radius:22px;display:flex;align-items:center;gap:10px;font-size:15px;white-space:nowrap}
.chip svg{flex:none;stroke:currentColor}
.chip .et{color:rgba(255,255,255,0.78)}
.chip .va{font-weight:500}
.abajo{flex:none;display:flex;flex-direction:column;gap:16px}
.etiqueta{font-size:13px;font-weight:600;letter-spacing:0.14em;color:rgba(255,255,255,0.82);text-transform:uppercase}
.fila{display:flex;gap:14px;overflow-x:auto;scrollbar-width:none}
.ficha{flex:none;width:clamp(150px,15vw,190px);height:clamp(124px,12vw,150px);padding:16px 16px 14px;border-radius:22px;cursor:pointer;text-align:left;color:#FFFFFF;display:flex;flex-direction:column;justify-content:space-between;transition:background-color .2s,border-color .2s,opacity .2s}
.ficha,.escena{-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;touch-action:manipulation}
.escena{flex:1 0 auto;min-width:150px;height:72px;padding:0 18px;border-radius:20px;cursor:pointer;text-align:left;color:#FFFFFF;display:flex;align-items:center;gap:12px}
.escena svg{flex:none;stroke:rgba(255,255,255,0.85)}
.escena.on svg{stroke:var(--vp-tinte)}
.escena .tx{display:flex;flex-direction:column;gap:2px;min-width:0}
.escena .nom{font-size:16px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.escena .est{font-size:13px;color:rgba(255,255,255,0.72)}
.escena.on .est{color:#FFFFFF}
.abajo .etiqueta+.fila+.etiqueta{margin-top:6px}
.ficha .cab{display:flex;justify-content:space-between;align-items:flex-start;gap:8px}
.ficha .nom{font-size:17px;font-weight:500;letter-spacing:-0.01em;line-height:1.25;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow-wrap:anywhere}
.ficha svg{flex:none;stroke:rgba(255,255,255,0.85)}
.ficha.on svg{stroke:var(--vp-tinte)}
.ficha .pie{display:flex;flex-direction:column;gap:10px}
.ficha .est{font-size:15px;color:rgba(255,255,255,0.74);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ficha.on .est{color:#FFFFFF}
.barrita{display:block;height:4px;border-radius:2px;background:rgba(255,255,255,0.25);overflow:hidden}
.barrita i{display:block;height:4px;border-radius:2px;background:var(--vp-tinte)}
.ficha.nodisp{opacity:0.55;cursor:default}
.ficha.espera{opacity:0.7}
.ficha[disabled]{cursor:default}
.puntos{display:flex;justify-content:center;gap:8px}
.puntos span{width:6px;height:6px;border-radius:3px;background:rgba(255,255,255,0.45)}
.puntos span:first-child{width:22px;background:#FFFFFF}
.vacio{max-width:560px;padding:28px;border-radius:24px;margin-top:24px}
.vacio h2{margin:0 0 10px;font-size:24px;font-weight:600;letter-spacing:-0.02em}
.vacio p{margin:0;font-size:16px;line-height:1.5;color:rgba(255,255,255,0.86)}
.aviso{position:absolute;left:50%;bottom:24px;transform:translateX(-50%);max-width:calc(100% - 32px);padding:12px 20px;border-radius:16px;font-size:15px;background:rgba(20,22,26,0.82);border:1px solid rgba(255,255,255,0.2)}
.fondo-hoja{position:absolute;top:0;left:0;right:0;bottom:0;background:rgba(8,10,14,0.5)}
.hoja{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:calc(100% - 32px);max-width:560px;max-height:calc(100% - 32px);overflow-y:auto;padding:clamp(20px,3vw,32px);border-radius:28px;display:flex;flex-direction:column;gap:22px;background:rgba(40,42,48,0.55);border:1px solid rgba(255,255,255,0.26);-webkit-backdrop-filter:blur(36px) saturate(150%);backdrop-filter:blur(36px) saturate(150%)}
.cab-hoja{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}
.tit-hoja{font-size:24px;font-weight:600;letter-spacing:-0.02em;overflow-wrap:anywhere}
.sub-hoja{font-size:15px;color:rgba(255,255,255,0.78);margin-top:4px}
.cerrar,.redondo{border-radius:50%;color:#FFFFFF;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;flex:none}
.cerrar{width:48px;height:48px}
.redondo{width:72px;height:72px}
.cerrar svg,.redondo svg,.opc svg,.play svg{stroke:currentColor}
.bloque{display:flex;flex-direction:column;gap:12px}
.fila-et{display:flex;align-items:baseline;justify-content:space-between;gap:12px}
.cifra{font-size:56px;font-weight:300;letter-spacing:-0.04em;line-height:1}
.desl{position:relative;height:64px;border-radius:20px;overflow:hidden;background:rgba(255,255,255,0.14)}
.desl i{position:absolute;top:0;left:0;bottom:0;border-radius:20px;background:var(--vp-tinte)}
.desl input{position:absolute;top:0;left:0;width:100%;height:100%;margin:0;opacity:0;cursor:pointer}
.opciones{display:flex;gap:10px;flex-wrap:wrap}
.opc{min-height:48px;padding:0 18px;border-radius:24px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:10px;font-size:15px;font-weight:500;color:#FFFFFF}
.opc.sel{background:rgba(255,255,255,0.30);border-color:rgba(255,255,255,0.55)}
.punto{width:14px;height:14px;border-radius:7px;flex:none}
.muestra{width:48px;height:48px;border-radius:24px;cursor:pointer;padding:0;border:1px solid rgba(255,255,255,0.35)}
.muestra.sel{border:3px solid #FFFFFF;box-shadow:0 0 0 3px rgba(255,255,255,0.25)}
.seg{display:grid;grid-template-columns:repeat(auto-fit,minmax(96px,1fr));gap:8px}
.seg .opc{border-radius:18px;padding:0 8px}
.temp{display:flex;align-items:center;justify-content:space-between;gap:16px}
.temp .num{font-size:clamp(64px,10vw,104px);font-weight:300;letter-spacing:-0.05em;line-height:1;text-align:center}
.temp .ahora{font-size:16px;color:rgba(255,255,255,0.84);margin-top:8px;text-align:center}
.controles{display:flex;align-items:center;justify-content:center;gap:18px}
.play{width:72px;height:72px;border-radius:36px;border:0;background:#FFFFFF;color:#111315;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0}
.pie-hoja{display:flex;gap:12px}
.pie-hoja button{flex:1;height:56px;border-radius:18px;font-size:16px;font-weight:500;cursor:pointer;color:#FFFFFF}
.pie-hoja .listo{border:0;background:#FFFFFF;color:#111315;font-weight:600}
.centro.cams{justify-content:flex-start;gap:20px}
.titulo.cams{font-size:clamp(40px,6vw,72px)}
.rejilla{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px}
.camara{position:relative;aspect-ratio:16/9;border-radius:22px;overflow:hidden;cursor:pointer;padding:0;color:#FFFFFF;text-align:left;background:rgba(10,12,16,0.55);border:1px solid rgba(255,255,255,0.20);display:block;width:100%}
.camara img,.grande img{position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover}
.camara[disabled]{cursor:default}
.camara .nada,.grande .nada{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);display:flex;flex-direction:column;align-items:center;gap:8px;font-size:14px;color:rgba(255,255,255,0.72)}
.camara .nada svg,.grande .nada svg{stroke:currentColor}
.chipcam{position:absolute;top:14px;left:14px;height:30px;padding:0 12px;border-radius:15px;display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;letter-spacing:0.06em;background:rgba(0,0,0,0.5)}
.chipcam i{width:8px;height:8px;border-radius:4px;background:#FF6B5E}
.chipcam.fuera i{background:#9AA6A2}
.piecam{position:absolute;left:0;right:0;bottom:0;padding:28px 16px 14px;display:flex;justify-content:space-between;align-items:flex-end;gap:8px;background:linear-gradient(to top,rgba(0,0,0,0.6),rgba(0,0,0,0))}
.piecam .n{display:block;font-size:18px;font-weight:600;letter-spacing:-0.01em}
.piecam .l{display:block;font-size:14px;color:rgba(255,255,255,0.8);margin-top:2px}
.grande{position:relative;width:100%;aspect-ratio:16/9;max-height:max(220px,calc(100vh - var(--header-height, 56px) - 330px));border-radius:26px;overflow:hidden;background:rgba(10,12,16,0.6);border:1px solid rgba(255,255,255,0.22)}
.grande:fullscreen{max-height:none;border-radius:0;border:0;aspect-ratio:auto}
.grande:fullscreen img{object-fit:contain;background:#000}
.cab-cams{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;flex-wrap:wrap}
.btn-cam{height:48px;padding:0 20px;border-radius:24px;color:#FFFFFF;font-size:15px;font-weight:500;cursor:pointer;display:flex;align-items:center;gap:8px}
.btn-cam svg{stroke:currentColor}
.camara .nada{top:40%;max-width:86%;text-align:center;line-height:1.3}
.vivo{position:absolute;top:0;left:0;right:0;bottom:0;background:#000;pointer-events:none}
.grande .vivo{pointer-events:auto}
.vivo ha-camera-stream{display:block;width:100%;height:100%;--video-max-height:100%}
.chip.audio{cursor:pointer;color:#FFFFFF;background:rgba(31,90,74,0.88);border:1px solid rgba(93,202,165,0.85);-webkit-user-select:none;user-select:none}
.chip.audio.quieto{background:rgba(31,90,74,0.5);border-color:rgba(93,202,165,0.45)}
.chip.audio svg{stroke:#9FE1CB}
.chip.audio .et{color:rgba(225,245,238,0.9)}
.fondo-lateral{position:absolute;top:0;left:0;right:0;bottom:0;background:rgba(5,9,11,0.55)}
.lateral{position:absolute;top:calc(12px + var(--vp-arriba,0px));right:12px;bottom:calc(12px + var(--vp-abajo,0px));width:min(420px,calc(100% - 24px));padding:20px;border-radius:26px;background:#11181C;border:1px solid rgba(255,255,255,0.14);display:flex;flex-direction:column;gap:16px;color:#FFFFFF}
.lateral:focus{outline:none}
.cab-lat{display:flex;align-items:center;justify-content:space-between;gap:12px;flex:none}
.cab-lat .cerrar{background:#1D262B;border:0}
.lista-lat{flex:1 1 auto;overflow-y:auto;display:flex;flex-direction:column;gap:12px;scrollbar-width:none}
.lista-lat::-webkit-scrollbar{display:none}
.boc{flex:none;border-radius:20px;padding:16px;background:#16392F;border:1px solid #2F8A6F;display:flex;flex-direction:column;gap:14px;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;touch-action:manipulation}
.boc.quieta{background:#162126;border-color:#2A3A3F}
.boc.nodisp{background:#15191C;border-color:#262C30}
.boc-cab{display:flex;align-items:center;gap:12px;min-width:0}
.boc-ic{width:44px;height:44px;border-radius:22px;background:#205A49;color:#9FE1CB;display:flex;align-items:center;justify-content:center;flex:none}
.quieta .boc-ic{background:#1F2F33}
.nodisp .boc-ic{background:#22282C;color:#7D8593}
.boc-ic svg,.boc-btn svg{stroke:currentColor}
.boc-tx{min-width:0;display:flex;flex-direction:column;gap:2px}
.boc-nom{font-size:17px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.boc-sub{font-size:14px;color:#9FE1CB;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.quieta .boc-sub{color:#8FA3A7}
.nodisp .boc-sub{color:#8A929E}
.boc-ctl{display:flex;align-items:center;gap:8px}
.boc-btn{width:44px;height:44px;border-radius:22px;border:0;background:transparent;color:#D4E8E1;display:flex;align-items:center;justify-content:center;padding:0;cursor:pointer;flex:none}
.boc-btn.play{width:52px;height:52px;border-radius:26px;background:#FFFFFF;color:#111315}
.boc-btn[disabled]{opacity:0.3;cursor:default}
.boc-vol{display:flex;align-items:center;gap:10px}
.boc-vol .desl{flex:1;height:36px;border-radius:12px}
.boc-vol .desl i{border-radius:12px;background:#5DCAA5}
.boc-vol .desl input[disabled]{cursor:default}
.boc-num{font-size:15px;color:#9FE1CB;min-width:40px;text-align:right;font-variant-numeric:tabular-nums}
.nodisp .boc-ctl,.nodisp .boc-vol{opacity:0.45}
.chip.aire,.chip.cams{cursor:pointer;color:#FFFFFF;-webkit-user-select:none;user-select:none}
.chip.aire{background:rgba(22,54,80,0.9);border:1px solid #5DA9E9}
.chip.aire.quieto{background:rgba(22,54,80,0.5);border-color:rgba(93,169,233,0.45)}
.chip.aire svg{stroke:#B5D4F4}
.chip.aire .et{color:rgba(230,241,251,0.9)}
.chip.cams{background:rgba(36,42,48,0.9);border:1px solid rgba(255,255,255,0.42)}
.chip.cams i{width:8px;height:8px;border-radius:4px;background:#FF6B5E;flex:none}
.chip.cams.quieto i{background:#9AA6A2}
.chip.cams .et{color:rgba(255,255,255,0.8)}
.clm{flex:none;border-radius:20px;padding:16px;background:#132C42;border:1px solid #378ADD;display:flex;flex-direction:column;gap:14px;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;touch-action:manipulation}
.clm.quieta{background:#162126;border-color:#2A3A3F}
.clm.nodisp{background:#15191C;border-color:#262C30}
.clm-cab{display:flex;align-items:center;gap:12px;min-width:0}
.clm-ic{width:44px;height:44px;border-radius:22px;background:#1D4568;color:#B5D4F4;display:flex;align-items:center;justify-content:center;flex:none}
.quieta .clm-ic{background:#1F2F33;color:#8FA3A7}
.nodisp .clm-ic{background:#22282C;color:#7D8593}
.clm-ic svg,.clm-pw svg,.clm-btn svg{stroke:currentColor}
.clm-tx{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.clm-nom{font-size:17px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.clm-sub{font-size:14px;color:#85B7EB;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.quieta .clm-sub{color:#8FA3A7}
.nodisp .clm-sub{color:#8A929E}
.clm-pw{width:48px;height:48px;border-radius:24px;border:0;background:#1F2F33;color:#D4E8E1;display:flex;align-items:center;justify-content:center;padding:0;cursor:pointer;flex:none}
.clm-pw.on{background:#FFFFFF;color:#111315}
.clm-pw[disabled],.clm-btn[disabled]{opacity:0.35;cursor:default}
.clm-temp{display:flex;align-items:center;justify-content:space-between;gap:12px}
.clm-cifra{display:flex;flex-direction:column;align-items:center;gap:4px;min-width:0}
.clm-temp .num{font-size:44px;font-weight:300;letter-spacing:-0.04em;line-height:1;font-variant-numeric:tabular-nums}
.clm-temp .ahora{font-size:13px;color:rgba(255,255,255,0.72);white-space:nowrap}
.quieta .clm-temp .num{opacity:0.5}
.clm-btn{width:48px;height:48px;border-radius:24px;border:0;background:#1D3A52;color:#FFFFFF;display:flex;align-items:center;justify-content:center;padding:0;cursor:pointer;flex:none}
.quieta .clm-btn{background:#1F2F33}
.clm-modos{display:flex;gap:6px;flex-wrap:wrap}
.clm-modo{flex:1 1 auto;height:38px;padding:0 8px;border-radius:19px;border:0;background:#1D3A52;color:#FFFFFF;font-size:13px;font-weight:500;cursor:pointer;white-space:nowrap}
.clm-modo.sel{background:#FFFFFF;color:#0C447C}
.lateral .camara{flex:none;border-radius:18px}
.lateral .piecam{padding:24px 14px 12px}
.lateral .piecam .n{font-size:16px}
.lateral .piecam .l{font-size:13px}
.lateral .btn-cam{flex:none;justify-content:center;background:#1D262B;border:0}
.ic{display:inline-flex;align-items:center;justify-content:center;flex:none;line-height:0;--icon-primary-color:currentColor}
.ic ha-state-icon{display:flex;color:inherit}
.ficha .ic,.escena .ic{color:rgba(255,255,255,0.85)}
.ficha.on .ic{color:var(--vp-tinte)}
.grupo{flex:none;width:calc(clamp(150px,15vw,190px) * 2 + 14px);height:clamp(124px,12vw,150px);padding:16px 16px 14px;border-radius:22px;cursor:pointer;color:#FFFFFF;display:flex;flex-direction:column;justify-content:space-between;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;touch-action:manipulation;transition:background-color .2s,border-color .2s}
.g-cab{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;min-width:0}
.g-tx{display:flex;flex-direction:column;gap:4px;min-width:0}
.g-nom{display:flex;align-items:center;gap:8px;font-size:17px;font-weight:500;letter-spacing:-0.01em}
.g-nom svg{flex:none;stroke:rgba(255,255,255,0.85)}
.grupo.on .g-nom svg{stroke:var(--vp-tinte)}
.grupo.pers .g-nom svg{stroke:#9FD3F0}
.g-sub{font-size:15px;color:rgba(255,255,255,0.74);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.grupo.on .g-sub{color:#FFFFFF}
.g-btns{display:flex;gap:8px;flex:none}
.g-btn{width:44px;height:44px;border-radius:22px;border:0;background:rgba(255,255,255,0.16);color:#FFFFFF;display:flex;align-items:center;justify-content:center;padding:0;cursor:pointer}
.g-btn svg{stroke:currentColor}
.g-btn.on{background:#FFFFFF;color:#111315}
.g-btn[disabled]{opacity:0.35;cursor:default}
.g-seg{display:flex;gap:5px}
.g-seg i{flex:1;height:5px;border-radius:3px;background:rgba(255,255,255,0.22)}
.g-seg i.on{background:var(--vp-tinte)}
.grupo.pers .g-seg i.on{background:#9FD3F0}
.g-seg i.nd{background:rgba(255,255,255,0.08)}
.ficha .cab-ic{position:relative;display:flex;flex:none}
.ficha .cab-ic svg:first-child{position:absolute;top:-7px;right:-8px;fill:var(--vp-tinte);stroke:none}
.lat-acc{display:flex;gap:10px;flex:none}
.btn-lat{flex:1;height:44px;border-radius:22px;border:0;background:#1D262B;color:#FFFFFF;font-size:15px;font-weight:500;cursor:pointer}
.lz{flex:none;border-radius:18px;padding:14px 16px;background:#1A2428;border:1px solid #33454B;display:flex;flex-direction:column;gap:12px;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;touch-action:manipulation}
.lz.quieta{background:#162126;border-color:#2A3A3F}
.lz.nodisp{background:#15191C;border-color:#262C30}
.lz-cab{display:flex;align-items:center;gap:12px;min-width:0}
.lz-tx{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.lz-nom{display:flex;align-items:center;gap:6px;font-size:17px;font-weight:600;min-width:0}
.lz-nom>span:first-child{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lz-fav{display:flex;flex:none}
.lz-fav svg{fill:var(--vp-tinte);stroke:none}
.lz-sub{font-size:14px;color:#A9B8BC;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.nodisp .lz-sub{color:#8A929E}
.lz-tg{width:56px;height:32px;border-radius:16px;border:0;background:#2F3D42;position:relative;padding:0;cursor:pointer;flex:none}
.lz-tg i{position:absolute;left:4px;top:4px;width:24px;height:24px;border-radius:12px;background:#FFFFFF;transition:left .15s}
.lz-tg.on{background:var(--vp-tinte)}
.lz-tg.on i{left:28px}
.lz-tg[disabled],.lz-btn[disabled]{opacity:0.35;cursor:default}
.lz-btns{display:flex;gap:8px;flex:none}
.lz-btn{width:44px;height:44px;border-radius:22px;border:0;background:#1F2F33;color:#FFFFFF;display:flex;align-items:center;justify-content:center;padding:0;cursor:pointer}
.lz-btn svg{stroke:currentColor}
.lz-br{height:36px;border-radius:12px}
.lz-br i{border-radius:12px}
.quieta .lz-br i{background:rgba(255,255,255,0.18)}
.lat-et{margin-top:6px}
.lat-esc{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
.lat-esc .escena{min-width:0;height:64px;padding:0 14px}
.chip.pers,.chip.escs{cursor:pointer;color:#FFFFFF;-webkit-user-select:none;user-select:none}
.chip.pers{background:rgba(30,62,78,0.9);border:1px solid #6FB8DC}
.chip.pers.quieto{background:rgba(30,62,78,0.5);border-color:rgba(111,184,220,0.45)}
.chip.pers svg{stroke:#9FD3F0}
.chip.pers .et{color:rgba(225,240,248,0.9)}
.chip.escs{background:rgba(70,52,110,0.9);border:1px solid #AFA9EC}
.chip.escs svg{stroke:#CECBF6}
.chip.vent{cursor:pointer;color:#FFFFFF;background:rgba(78,60,38,0.9);border:1px solid #D9B48A;-webkit-user-select:none;user-select:none}
.chip.vent.quieto{background:rgba(78,60,38,0.5);border-color:rgba(217,180,138,0.45)}
.chip.vent svg{stroke:#F2D6B3}
.chip.vent .et{color:rgba(250,238,222,0.9)}
.grupo.vent .g-nom svg{stroke:#F2D6B3}
.grupo.vent .g-seg i.on{background:#F2D6B3}
.vt-vel .clm-modo{background:#4A3A28}
.vt-vel .clm-modo.sel{background:#FFFFFF;color:#633806}
.vt-osc{display:flex;align-items:center;justify-content:space-between;gap:12px;font-size:14px;color:rgba(255,255,255,0.85)}
.clm.vt:not(.quieta):not(.nodisp){background:#3A2C1E;border-color:#D9B48A}
.clm.vt:not(.quieta):not(.nodisp) .clm-ic{background:#5A4128;color:#F2D6B3}
.clm.vt:not(.quieta):not(.nodisp) .clm-sub{color:#E8C9A4}
.chip.escs .et{color:rgba(238,237,254,0.9)}
@media (orientation: portrait){.fila .grupo{grid-column:span 2;width:auto;height:140px}}
@media (max-width: 960px){.tabs{order:4;flex-basis:100%;margin:0}}
@media (orientation: portrait){.fila.escenas .escena{min-width:0}.fila{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));overflow:visible}.ficha{width:auto;height:140px}.puntos{display:none}}
.asa{display:none}
:host([movil]) .raiz{background-position:center top;background-size:auto 340px}
:host([movil]) .sombra{background:linear-gradient(to bottom,rgba(8,10,14,0.10) 0,rgba(8,10,14,0.35) 180px,#16191D 300px,#16191D 100%)}
:host([movil]) .capa{padding:calc(14px + var(--vp-arriba,0px)) 0 calc(20px + var(--vp-abajo,0px)) 16px;gap:12px}
:host([movil]) .der{padding-right:16px}
:host([movil]) .barra{gap:10px}
:host([movil]) .marca{font-size:12px;letter-spacing:0.2em;max-width:62vw}
:host([movil]) .hora{font-size:17px;flex-direction:row;align-items:center;gap:8px}
:host([movil]) .tabs{order:4;flex-basis:100%;margin:0;padding:4px;border-radius:24px}
:host([movil]) .tab{height:36px;padding:0 14px;font-size:14px;border-radius:18px}
:host([movil]) .centro{flex:none;justify-content:flex-start;margin-top:12px}
:host([movil]) .titulo,:host([movil]) .titulo.casa,:host([movil]) .titulo.cams{font-size:36px;margin-top:4px}
:host([movil]) .sobre{font-size:12px;min-height:0}
:host([movil]) .sub{font-size:14px;margin-top:6px}
:host([movil]) .chips{flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none;margin:16px -16px 0 0;padding-right:16px}
:host([movil]) .chips::-webkit-scrollbar{display:none}
:host([movil]) .chip{flex:none;height:38px;padding:0 13px;font-size:13px;gap:7px}
:host([movil]) .abajo{margin-top:6px;gap:12px}
:host([movil]) .fila{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;overflow:visible}
:host([movil]) .ficha{width:auto;height:112px;padding:12px 12px 10px;border-radius:18px}
:host([movil]) .ficha .nom{font-size:15px}
:host([movil]) .fila .grupo{grid-column:1/-1;width:auto;height:116px;padding:12px 14px}
:host([movil]) .fila.escenas .escena{min-width:0;height:60px;padding:0 12px}
:host([movil]) .puntos{display:none}
:host([movil]) .rejilla{gap:12px}
:host([movil]) .grande{border-radius:18px}
:host([movil]) .lateral{top:auto;left:0;right:0;bottom:0;width:auto;max-height:86%;padding:8px 16px calc(16px + var(--vp-abajo,0px));border-radius:24px 24px 0 0;border-bottom:0;gap:12px}
:host([movil]) .lista-lat{min-height:0}
:host([movil]) .hoja{top:auto;left:0;right:0;bottom:0;transform:none;width:auto;max-width:none;max-height:86%;padding:8px 18px calc(20px + var(--vp-abajo,0px));border-radius:24px 24px 0 0;gap:18px}
:host([movil]) .tit-hoja{font-size:20px}
:host([movil]) .asa{display:block;flex:none;align-self:center;width:44px;height:5px;border-radius:3px;background:rgba(255,255,255,0.35);margin:2px 0 4px;touch-action:none}
`;

// ------------------------------------------------------------------ dibujo (texto HTML; todo lo de HA va escapado)

// PANEL-12: debajo de este ancho (px de la tarjeta) va el acomodo de celular.
const ANCHO_MOVIL = 600;
const esMovil = (ancho) => Number.isFinite(ancho) && ancho > 0 && ancho < ANCHO_MOVIL;
// Cuánto se desliza la hoja hacia abajo para cerrarla.
const CERRAR_DESLIZANDO = 80;

// PANEL-10: el cuarto de esta tablet (`?cuarto=` o `cuarto:`) → id del cuarto, o null si no existe.
// Vale el id del área o su nombre (sin importar mayúsculas, acentos ni espacios de más).
const VOLVER_MS = 5 * 60 * 1000;
function cuartoDeParametro(modelo, valor) {
  const norm = (x) => String(x ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().replace(/\s+/g, ' ').toLowerCase();
  const v = norm(valor);
  if (!v || !modelo) return null;
  const c = (modelo.cuartos || []).find((x) => x.id !== OTROS && (norm(x.id) === v || norm(x.nombre) === v));
  return c ? c.id : null;
}

// PANEL-09: la pila de la tablet → { nivel 0–100, cargando } (o null si el dato no sirve).
// Kiosk Satellite no documenta si da 0–1 o 0–100: hasta 1 se toma como fracción.
function normalizarBateria(nivel, cargando) {
  let n = typeof nivel === 'string' ? Number(nivel.replace('%', '').trim()) : nivel;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return null;
  if (n <= 1) n *= 100;
  return { nivel: Math.max(0, Math.min(100, Math.round(n))), cargando: cargando === true || cargando === 'true' || cargando === 1 };
}

// PANEL-09: el ícono de la pila (sin número; el porcentaje va en la etiqueta para lectores de pantalla).
function htmlBateria(b, idioma) {
  if (!b) return '';
  const T = TXT[idioma];
  const baja = !b.cargando && b.nivel <= 20;
  return `<span class="bat${b.cargando ? ' carga' : ''}${baja ? ' baja' : ''}" role="img" aria-label="${esc(T.bateria(b.nivel, b.cargando))}" data-nivel="${b.nivel}">${b.cargando ? svg(ICONOS.rayo, 14) : ''}<span class="cel"><i style="width:calc((100% - 3px) * ${b.nivel / 100})"></i></span></span>`;
}

// PANEL-09: el lugar del ícono de un aparato. La tarjeta le pone adentro el ícono de HA (ha-state-icon);
// el genérico queda mientras tanto (y si HA no lo tiene).
const icono = (entidad, generico, tam = 30) => `<span class="ic" data-icono="${esc(entidad)}" style="--mdc-icon-size:${tam}px;width:${tam}px;height:${tam}px">${svg(generico, tam)}</span>`;
const svg = (d, tam = 30) => `<svg width="${tam}" height="${tam}" viewBox="0 0 24 24" fill="none" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${esc(d)}"></path></svg>`;

function htmlFicha(f, { espera = false, activada = false, idioma = 'es', favorito = false } = {}) {
  const T = TXT[idioma];
  const clases = ['ficha', 'vidrio'];
  if (favorito) clases.push('fav');
  if (f.on || activada) clases.push('on');
  if (!f.disponible) clases.push('nodisp');
  if (espera) clases.push('espera');
  const sub = activada ? T.activada : f.sub;
  const barra = f.pct !== null && f.pct !== undefined ? `<span class="barrita"><i style="width:${Math.max(0, Math.min(100, Math.round(f.pct)))}%"></i></span>` : '';
  const desactivada = !f.disponible || !f.accion ? ' disabled' : '';
  const presion = f.tipo === 'escena' ? '' : ` aria-pressed="${f.on ? 'true' : 'false'}"`;
  return `<button class="${clases.join(' ')}" data-ficha="${esc(f.entidad)}"${presion}${desactivada}><span class="cab"><span class="nom">${esc(f.nombre)}</span>${favorito ? `<span class="cab-ic">${svg(ICONOS.estrella, 14)}${icono(f.entidad, f.icono)}</span>` : icono(f.entidad, f.icono)}</span><span class="pie"><span class="est">${esc(sub)}</span>${barra}</span></button>`;
}

function htmlEscena(f, { espera = false, activada = false, idioma = 'es' } = {}) {
  const T = TXT[idioma];
  const clases = ['escena', 'vidrio'];
  if (activada) clases.push('on');
  if (!f.disponible) clases.push('nodisp');
  if (espera) clases.push('espera');
  const desactivada = !f.disponible || !f.accion ? ' disabled' : '';
  return `<button class="${clases.join(' ')}" data-ficha="${esc(f.entidad)}"${desactivada}>${icono(f.entidad, f.icono, 24)}<span class="tx"><span class="nom">${esc(f.nombre)}</span><span class="est">${esc(activada ? T.activada : f.sub)}</span></span></button>`;
}

// La ventana de un dispositivo. `vista.arrastre` = lo que el dedo está moviendo en una barra.
function htmlVentana(d, estados, idioma, vista, lugar) {
  const T = TXT[idioma];
  const c = controlesDe(d, estados);
  if (!c) return '';
  const e = estados[d.entidad];
  const a = e.attributes || {};
  const f = fichaDe(d, estados, idioma);
  const arr = vista.arrastre && vista.arrastre.entidad === d.entidad ? vista.arrastre : null;
  const valorDe = (control, real) => (arr && arr.control === control ? arr.valor : real);
  const opc = (control, valor, contenido, { sel = false, etiqueta = '', clase = 'opc vidrio', estilo = '' } = {}) =>
    `<button class="${clase}${sel ? ' sel' : ''}"${estilo ? ` style="${esc(estilo)}"` : ''} data-control="${esc(control)}" data-valor="${esc(valor)}" aria-pressed="${sel ? 'true' : 'false'}"${etiqueta ? ` aria-label="${esc(etiqueta)}"` : ''}>${contenido}</button>`;
  const desl = (control, valor, min, max, etiqueta) => {
    const v = Math.max(min, Math.min(max, Math.round(Number(valor) || 0)));
    const pct = max > min ? Math.round(((v - min) / (max - min)) * 100) : 0;
    return `<div class="desl"><i style="width:${pct}%"></i><input type="range" min="${min}" max="${max}" step="1" value="${v}" data-control="${esc(control)}" aria-label="${esc(etiqueta)}"></div>`;
  };
  const bloque = (et, cuerpo, derecha = '') => `<div class="bloque"><div class="fila-et"><span class="etiqueta">${esc(et)}</span>${derecha}</div>${cuerpo}</div>`;
  let cuerpo = '';
  let pie = '';
  const listo = `<button class="listo" data-cerrar="1">${esc(T.listo)}</button>`;
  if (d.tipo === 'luz') {
    const prendida = e.state === 'on';
    if (c.brillo) {
      const b = valorDe('brillo', prendida && num(f.pct) !== null ? f.pct : 0);
      cuerpo += bloque(T.brillo, desl('brillo', b || 1, 1, 100, T.brillo), `<span class="cifra">${esc(prendida || arr ? `${b} %` : T.apagada)}</span>`);
    }
    if (c.tono) {
      const k = prendida && a.color_mode === 'color_temp' ? num(a.color_temp_kelvin) : null;
      const cerca = k !== null ? TONOS.reduce((x, y) => (Math.abs(y - k) < Math.abs(x - k) ? y : x)) : null;
      cuerpo += bloque(T.tono, `<div class="opciones">${TONOS.map((t) => opc('tono', t, `<span class="punto" style="background:${PUNTO_TONO[t]}"></span><span>${esc(T.tonos[t])}</span>`, { sel: t === cerca })).join('')}</div>`);
    }
    if (c.color) {
      const rgb = prendida && MODOS_COLOR.includes(a.color_mode) && Array.isArray(a.rgb_color) ? a.rgb_color : null;
      const sel = rgb ? COLORES.find(([, x]) => Math.abs(x[0] - rgb[0]) + Math.abs(x[1] - rgb[1]) + Math.abs(x[2] - rgb[2]) < 60)?.[0] : null;
      cuerpo += bloque(T.color, `<div class="opciones">${COLORES.map(([id, x]) => opc('color', id, '', { sel: id === sel, etiqueta: T.colores[id], clase: 'muestra', estilo: `background:rgb(${x.join(',')})` })).join('')}</div>`);
    }
    pie = `<div class="pie-hoja"><button class="vidrio" data-control="onoff" data-valor="">${esc(prendida ? T.apagar : T.encender)}</button>${listo}</div>`;
  } else if (d.tipo === 'clima') {
    const est = f.estado;
    if (c.temp && num(a.temperature) !== null) {
      cuerpo += `<div class="temp">${opc('temp', '-', svg(ICONOS.menos, 28), { etiqueta: T.bajarTemp, clase: 'redondo vidrio' })}<div><div class="num">${esc(grados(a.temperature))}°</div><div class="ahora">${esc([est.encendido ? f.sub : T.apagado, num(est.actual) !== null ? T.ahora(grados(est.actual)) : ''].filter(Boolean).join(' · '))}</div></div>${opc('temp', '+', svg(ICONOS.mas, 28), { etiqueta: T.subirTemp, clase: 'redondo vidrio' })}</div>`;
    }
    if (c.modos.length) cuerpo += bloque(T.modo, `<div class="seg">${c.modos.map((m) => opc('modo', m, esc(T.modos[m] || bonito(m)), { sel: e.state === m })).join('')}</div>`);
    if (c.vels.length) cuerpo += bloque(T.ventilador, `<div class="seg">${c.vels.map((m) => opc('vent', m, esc(T.vels[m] || bonito(m)), { sel: a.fan_mode === m })).join('')}</div>`);
    const onoff = c.caps.includes(est.encendido ? 'apagar' : 'encender') ? `<button class="vidrio" data-control="onoff" data-valor="">${esc(est.encendido ? T.apagar : T.encender)}</button>` : '';
    pie = `<div class="pie-hoja">${onoff}${listo}</div>`;
  } else if (d.tipo === 'bocina') {
    const est = f.estado;
    const sonando = e.state === 'playing';
    if (c.play || c.anterior || c.siguiente) {
      cuerpo += `<div class="controles">${c.anterior ? opc('anterior', '', svg(ICONOS.anterior, 24), { etiqueta: T.anterior, clase: 'cerrar vidrio' }) : ''}${c.play ? opc('play', '', svg(sonando ? ICONOS.pausa : ICONOS.play, 28), { etiqueta: T.reproducirPausar, clase: 'play' }) : ''}${c.siguiente ? opc('siguiente', '', svg(ICONOS.siguiente, 24), { etiqueta: T.siguiente, clase: 'cerrar vidrio' }) : ''}</div>`;
    }
    if (c.volumen) {
      const v = valorDe('volumen', num(est.volumen) ?? 0);
      const silencio = c.silencio ? opc('silencio', '', svg(est.silencio ? ICONOS.silencio : ICONOS.sonido, 22), { sel: est.silencio === true, etiqueta: est.silencio ? T.quitarSilencio : T.silenciar, clase: 'cerrar vidrio' }) : '';
      cuerpo += bloque(T.volumen, desl('volumen', v, 0, 100, T.volumen), `<span style="display:flex;align-items:center;gap:12px"><span class="cifra" style="font-size:40px">${esc(`${v} %`)}</span>${silencio}</span>`);
    }
    pie = `<div class="pie-hoja">${listo}</div>`;
  } else if (d.tipo === 'cortina') {
    const botones = [['abrir', T.subir, ICONOS.arriba], ['detener', T.detener, ICONOS.alto], ['cerrar', T.bajar, ICONOS.abajo]].filter(([k]) => c.caps.includes(k));
    if (botones.length) cuerpo += `<div class="seg">${botones.map(([k, et, ic]) => opc(k, '', `${svg(ic, 26)}<span>${esc(et)}</span>`, { estilo: 'min-height:84px;flex-direction:column;gap:6px' })).join('')}</div>`;
    if (c.posicion) {
      const p = valorDe('posicion', num(a.current_position) ?? 0);
      cuerpo += bloque(T.posicion, desl('posicion', p, 0, 100, T.posicion), `<span class="cifra" style="font-size:40px">${esc(`${p} %`)}</span>`);
    }
    pie = `<div class="pie-hoja">${listo}</div>`;
  }
  const sub = [lugar, f.sub].filter(Boolean).join(' · ');
  return `<div class="fondo-hoja" data-cerrar="1"></div><div class="hoja" tabindex="-1" role="dialog" aria-modal="true" aria-label="${esc(f.nombre)}" data-hoja="${esc(d.entidad)}"><div class="asa" data-asa="hoja" aria-hidden="true"></div><div class="cab-hoja"><div><div class="tit-hoja">${esc(f.nombre)}</div><div class="sub-hoja">${esc(sub)}</div></div><button class="cerrar vidrio" data-cerrar="1" aria-label="${esc(T.cerrar)}">${svg(ICONOS.cerrar, 20)}</button></div>${cuerpo}${pie}</div>`;
}

function htmlChip(icono, et, va) {
  return `<div class="chip vidrio">${svg(icono, 18)}<span class="et">${esc(et)}</span><span class="va">${esc(va)}</span></div>`;
}

// ------------------------------------------------------------------ PANEL-06: audio (chip + panel lateral)

const textoCorto = (v, max = 40) => {
  if (typeof v !== 'string') return '';
  const t = v.replace(/\s+/g, ' ').trim();
  const c = Array.from(t);
  return c.length > max ? `${c.slice(0, max - 1).join('').trimEnd()}…` : t;
};

// Lo que dice el chip de audio para un grupo de bocinas (las de la casa o las de un cuarto).
function resumenAudio(bocinas, estados, idioma = 'es') {
  const T = TXT[idioma];
  const fichas = bocinas.map((d) => fichaDe(d, estados, idioma));
  const sonando = fichas.filter((f) => f.disponible && f.on).length;
  if (fichas.length === 1) {
    const f = fichas[0];
    return { nombre: f.nombre, estado: f.disponible ? (f.on ? T.sonando : f.estado?.estado === 'pausa' ? T.pausa : T.sinMusica) : T.noDisp, sonando };
  }
  const pausa = fichas.some((f) => f.disponible && f.estado?.estado === 'pausa');
  const algunaViva = fichas.some((f) => f.disponible);
  return { nombre: T.bocinas(fichas.length), estado: sonando ? T.reproduciendoN(sonando) : pausa ? T.enPausa : algunaViva ? T.sinMusicaMin : T.sinConexionMin, sonando };
}

function htmlChipAudio(grupo, bocinas, estados, idioma, abierta) {
  const T = TXT[idioma];
  const r = resumenAudio(bocinas, estados, idioma);
  return `<button class="chip vidrio audio${r.sonando ? '' : ' quieto'}" data-audio="${esc(grupo)}" aria-haspopup="dialog" aria-expanded="${abierta ? 'true' : 'false'}" aria-label="${esc(`${T.abrirAudio}: ${r.nombre} · ${r.estado}`)}">${svg(ICONOS.ecualizador, 18)}<span class="va">${esc(r.nombre)}</span><span class="et">${esc(r.estado)}</span>${svg(ICONOS.derecha, 16)}</button>`;
}

// Una tarjeta de bocina del panel lateral. `vista.arrastre` = el volumen que el dedo está moviendo.
function htmlBocina(d, estados, idioma, vista) {
  const T = TXT[idioma];
  const f = fichaDe(d, estados, idioma);
  const c = f.disponible ? controlesDe(d, estados) : null;
  const e = estados[d.entidad];
  const a = e?.attributes || {};
  const fuente = f.disponible ? textoCorto(a.source || a.app_name || '') : '';
  const sub = [fuente, f.disponible ? f.sub : T.sinConexion].filter(Boolean).join(' · ');
  const clases = ['boc'];
  if (!f.disponible) clases.push('nodisp');
  else if (!f.on) clases.push('quieta');
  const ent = esc(d.entidad);
  const boton = (control, icono, etiqueta, puede, extra = '', tam = 22) =>
    `<button class="boc-btn${extra}" data-control="${control}" data-valor="" data-entidad="${ent}" aria-label="${esc(etiqueta)}"${puede ? '' : ' disabled'}>${svg(icono, tam)}</button>`;
  const ctl = `<div class="boc-ctl">${boton('anterior', ICONOS.anterior, T.anterior, !!c?.anterior)}${boton('play', f.on ? ICONOS.pausa : ICONOS.play, T.reproducirPausar, !!c?.play, ' play', 24)}${boton('siguiente', ICONOS.siguiente, T.siguiente, !!c?.siguiente)}</div>`;
  const arr = vista.arrastre && vista.arrastre.entidad === d.entidad && vista.arrastre.control === 'volumen' ? vista.arrastre : null;
  const real = num(f.estado?.volumen);
  const v = arr ? Math.max(0, Math.min(100, Math.round(arr.valor))) : real ?? 0;
  const silencio = f.estado?.silencio === true;
  const mute = boton('silencio', silencio ? ICONOS.silencio : ICONOS.sonido, silencio ? T.quitarSilencio : T.silenciar, !!c?.silencio);
  const desl = `<div class="desl"><i style="width:${c?.volumen ? v : 0}%"></i><input type="range" min="0" max="100" step="1" value="${c?.volumen ? v : 0}" data-control="volumen" data-entidad="${ent}" aria-label="${esc(T.volumen)}"${c?.volumen ? '' : ' disabled'}></div>`;
  const numTxt = c?.volumen && (arr || real !== null) ? `${silencio && !arr ? 0 : v}` : '–';
  const vol = `<div class="boc-vol">${mute}${desl}<span class="boc-num">${esc(numTxt)}</span></div>`;
  return `<div class="${clases.join(' ')}" data-bocina="${ent}"><div class="boc-cab"><span class="boc-ic">${icono(d.entidad, ICONOS.bocina, 22)}</span><span class="boc-tx"><span class="boc-nom">${esc(f.nombre)}</span><span class="boc-sub">${esc(sub)}</span></span></div>${ctl}${vol}</div>`;
}

// PANEL-07: un panel lateral (audio, aires o cámaras). `cuerpo` va en la lista que se desliza; `pie` abajo.
function htmlLateral(tipo, titulo, cuerpo, idioma, pie = '', arriba = '') {
  const T = TXT[idioma];
  return `<div class="fondo-lateral" data-cerrar-lateral="1"></div><div class="lateral" role="dialog" aria-modal="true" aria-label="${esc(titulo)}" tabindex="-1" data-lateral="${esc(tipo)}"><div class="asa" data-asa="lateral" aria-hidden="true"></div><div class="cab-lat"><span class="etiqueta">${esc(titulo)}</span><button class="cerrar" data-cerrar-lateral="1" aria-label="${esc(T.cerrar)}">${svg(ICONOS.cerrar, 20)}</button></div>${arriba}<div class="lista-lat">${cuerpo}</div>${pie}</div>`;
}

// ------------------------------------------------------------------ PANEL-08: luces y persianas agrupadas

// Las luces que se juntan en la tarjeta «Luces»: solo `light.` (los apagadores y enchufes van sueltos).
const lucesDe = (c) => (c?.dispositivos || []).filter((d) => d.tipo === 'luz' && d.entidad.startsWith('light.'));
const persianasDe = (c) => (c?.dispositivos || []).filter((d) => d.tipo === 'cortina');
// PANEL-11: los ventiladores de un cuarto.
const ventiladoresDe = (c) => (c?.dispositivos || []).filter((d) => d.tipo === 'ventilador');

// La tarjeta ancha de un grupo (tipo 'luces' o 'persianas') de un cuarto (o de la casa).
function htmlGrupo(tipo, grupoId, lista, estados, idioma, abierta) {
  const T = TXT[idioma];
  const fichas = lista.map((d) => fichaDe(d, estados, idioma));
  const vivas = fichas.filter((f) => f.disponible);
  const on = vivas.filter((f) => f.on).length;
  const luz = tipo === 'luces';
  const vent = tipo === 'ventiladores';
  const titulo = luz ? T.luces2 : vent ? T.ventiladores2 : T.persianas;
  const sub = vivas.length ? (luz ? T.lucesDe(on, vivas.length) : vent ? T.ventiladoresDe(on, vivas.length) : T.persianasDe(on, vivas.length)) : T.noDisp;
  const seg = fichas.map((f) => `<i class="${f.disponible ? (f.on ? 'on' : 'off') : 'nd'}"></i>`).join('');
  const id = esc(grupoId);
  const boton = (accion, icono, etiqueta, extra = '') => `<button class="g-btn${extra}" data-todas="${accion}" data-cual="${tipo}" data-grupo-id="${id}" aria-label="${esc(etiqueta)}"${vivas.length ? '' : ' disabled'}>${svg(icono, 20)}</button>`;
  const botones = luz
    ? boton(on ? 'apagar' : 'encender', ICONOS.encendido, on ? T.apagarTodas : T.encenderTodas, on ? ' on' : '')
    : vent
      ? boton(on ? 'apagar' : 'encender', ICONOS.encendido, on ? T.apagarTodos : T.encenderTodos, on ? ' on' : '')
      : `${boton('abrir', ICONOS.arriba, T.abrirTodas)}${boton('cerrar', ICONOS.abajo, T.cerrarTodas)}`;
  return `<div class="grupo vidrio${on ? ' on' : ''}${luz ? '' : vent ? ' vent' : ' pers'}" data-grupo="${tipo}" data-grupo-id="${id}" role="button" tabindex="0" aria-haspopup="dialog" aria-expanded="${abierta ? 'true' : 'false'}" aria-label="${esc(`${luz ? T.abrirLuces : vent ? T.abrirVentiladores : T.abrirPersianas}: ${sub}`)}"><div class="g-cab"><span class="g-tx"><span class="g-nom">${svg(luz ? ICONOS.light : vent ? ICONOS.ventilador : ICONOS.cortina, 20)}<span>${esc(titulo)}</span></span><span class="g-sub">${esc(sub)}</span></span><span class="g-btns">${botones}</span></div><div class="g-seg">${seg}</div></div>`;
}

// Los botones «todas» de arriba del panel lateral de luces o persianas.
function htmlAccionesTodas(tipo, grupoId, idioma) {
  const T = TXT[idioma];
  const b = (accion, texto) => `<button class="btn-lat" data-todas="${accion}" data-cual="${tipo}" data-grupo-id="${esc(grupoId)}">${esc(texto)}</button>`;
  const botones = tipo === 'luces' ? b('apagar', T.apagarTodas) + b('encender', T.encenderTodas) : tipo === 'ventiladores' ? b('apagar', T.apagarTodos) + b('encender', T.encenderTodos) : b('abrir', T.abrirTodas) + b('cerrar', T.cerrarTodas);
  return `<div class="lat-acc">${botones}</div>`;
}

// Un renglón del panel lateral: una luz (interruptor y brillo) o una persiana (▲ ■ ▼).
function htmlRenglon(d, estados, idioma, vista, { favorito = false, lugar = '' } = {}) {
  const T = TXT[idioma];
  const f = fichaDe(d, estados, idioma);
  const c = f.disponible ? controlesDe(d, estados) : null;
  const caps = capsDe(d, estados);
  const ent = esc(d.entidad);
  const clases = ['lz'];
  if (!f.disponible) clases.push('nodisp');
  else if (!f.on) clases.push('quieta');
  const sub = [lugar, f.disponible ? f.sub : T.sinConexion].filter(Boolean).join(' · ');
  const estrella = favorito ? `<span class="lz-fav" aria-label="${esc(T.favorito)}">${svg(ICONOS.estrella, 13)}</span>` : '';
  let derecha = '';
  let abajo = '';
  if (d.tipo === 'cortina') {
    clases.push('pr');
    const b = (control, icono, etiqueta) => `<button class="lz-btn" data-control="${control}" data-valor="" data-entidad="${ent}" aria-label="${esc(etiqueta)}"${caps.includes(control) ? '' : ' disabled'}>${svg(icono, 20)}</button>`;
    derecha = `<span class="lz-btns">${b('abrir', ICONOS.arriba, T.subir)}${b('detener', ICONOS.alto, T.detener)}${b('cerrar', ICONOS.abajo, T.bajar)}</span>`;
  } else {
    const puede = caps.includes(f.on ? 'apagar' : 'encender');
    derecha = `<button class="lz-tg${f.on ? ' on' : ''}" role="switch" aria-checked="${f.on ? 'true' : 'false'}" data-control="onoff" data-valor="" data-entidad="${ent}" aria-label="${esc(f.nombre)}"${puede ? '' : ' disabled'}><i></i></button>`;
    if (c && c.brillo) {
      const arr = vista.arrastre && vista.arrastre.entidad === d.entidad && vista.arrastre.control === 'brillo' ? vista.arrastre : null;
      const real = f.on ? num(f.estado?.brillo) : 0;
      const v = arr ? Math.max(1, Math.min(100, Math.round(arr.valor))) : real ?? 0;
      abajo = `<div class="desl lz-br"><i style="width:${v}%"></i><input type="range" min="1" max="100" step="1" value="${Math.max(1, v)}" data-control="brillo" data-entidad="${ent}" aria-label="${esc(T.brillo)}"></div>`;
    }
  }
  return `<div class="${clases.join(' ')}" data-tarjeta="${ent}"><div class="lz-cab"><span class="lz-tx"><span class="lz-nom"><span>${esc(f.nombre)}</span>${estrella}</span><span class="lz-sub">${esc(sub)}</span></span>${derecha}</div>${abajo}</div>`;
}

function htmlChipPersianas(lista, estados, idioma, abierta) {
  const T = TXT[idioma];
  const vivas = lista.map((d) => fichaDe(d, estados, idioma)).filter((f) => f.disponible);
  const ab = vivas.filter((f) => f.on).length;
  const et = ab ? T.abiertas(ab) : T.todasCerradas;
  return `<button class="chip vidrio pers${ab ? '' : ' quieto'}" data-persianas-chip="1" aria-haspopup="dialog" aria-expanded="${abierta ? 'true' : 'false'}" aria-label="${esc(`${T.abrirPersianas}: ${et}`)}">${svg(ICONOS.cortina, 18)}<span class="va">${esc(T.persianas)}</span><span class="et">${esc(et)}</span>${svg(ICONOS.derecha, 16)}</button>`;
}

function htmlChipEscenas(lista, idioma, abierta) {
  const T = TXT[idioma];
  return `<button class="chip vidrio escs" data-escenas-chip="1" aria-haspopup="dialog" aria-expanded="${abierta ? 'true' : 'false'}" aria-label="${esc(`${T.abrirEscenas}: ${lista.length}`)}">${svg(ICONOS.escena, 18)}<span class="va">${esc(T.escenas)}</span><span class="et">${esc(T.escenasN(lista.length))}</span>${svg(ICONOS.derecha, 16)}</button>`;
}

// Las escenas por cuarto (pestaña Escenas y panel lateral): etiqueta + botones.
function htmlGruposEscenas(grupos, estados, opc, idioma, enLateral) {
  return grupos
    .map((g) => {
      const b = g.escenas.map((d) => htmlEscena(fichaDe(d, estados, idioma), opc({ entidad: d.entidad }))).join('');
      return enLateral ? `<div class="etiqueta lat-et">${esc(g.nombre)}</div><div class="lat-esc">${b}</div>` : `<div class="etiqueta der">${esc(g.nombre)}</div><div class="fila escenas der" data-fila="escenas-${esc(g.id)}">${b}</div>`;
    })
    .join('');
}

// ------------------------------------------------------------------ PANEL-07: aires (chip + panel lateral)

// Lo que dice el chip de aires para un grupo (los de la casa o los de un cuarto).
// En Casa (conTemp) también la temperatura de adentro: la del primer aire que la reporte.
function resumenAires(aires, estados, idioma = 'es', conTemp = false) {
  const T = TXT[idioma];
  const fichas = aires.map((d) => fichaDe(d, estados, idioma));
  const encendidos = fichas.filter((f) => f.disponible && f.on).length;
  const conActual = fichas.find((f) => f.disponible && num(f.estado?.actual) !== null);
  const temp = conTemp && conActual ? T.adentro(grados(conActual.estado.actual)) : '';
  let nombre;
  let estado;
  if (fichas.length === 1) {
    const f = fichas[0];
    nombre = f.nombre;
    estado = f.disponible ? f.sub : T.noDisp;
  } else {
    const algunoVivo = fichas.some((f) => f.disponible);
    nombre = T.aires(fichas.length);
    estado = encendidos ? T.encendidosN(encendidos) : algunoVivo ? T.apagadosMin : T.sinConexionMin;
  }
  return { nombre, estado: [estado, temp].filter(Boolean).join(' · '), encendidos };
}

function htmlChipAires(grupo, aires, estados, idioma, abierta) {
  const T = TXT[idioma];
  const r = resumenAires(aires, estados, idioma, grupo === CASA);
  return `<button class="chip vidrio aire${r.encendidos ? '' : ' quieto'}" data-aire="${esc(grupo)}" aria-haspopup="dialog" aria-expanded="${abierta ? 'true' : 'false'}" aria-label="${esc(`${T.abrirAires}: ${r.nombre} · ${r.estado}`)}">${svg(ICONOS.clima, 18)}<span class="va">${esc(r.nombre)}</span><span class="et">${esc(r.estado)}</span>${svg(ICONOS.derecha, 16)}</button>`;
}

// Una tarjeta de aire del panel lateral: encender/apagar, − temperatura + y el modo.
function htmlAire(d, estados, idioma, lugar) {
  const T = TXT[idioma];
  const f = fichaDe(d, estados, idioma);
  const c = f.disponible ? controlesDe(d, estados) : null;
  const e = estados[d.entidad];
  const a = e?.attributes || {};
  const est = f.estado || {};
  const prendido = f.disponible && f.on;
  const verbo = prendido ? T.climaVerbo[est.accion] || T.climaVerbo[est.modo] || T.espera : T.apagado;
  const sub = [lugar, f.disponible ? verbo : T.sinConexion].filter(Boolean).join(' · ');
  const ahora = f.disponible && num(est.actual) !== null ? `<span class="ahora">${esc(T.ahora(grados(est.actual)))}</span>` : '';
  const clases = ['clm'];
  if (!f.disponible) clases.push('nodisp');
  else if (!prendido) clases.push('quieta');
  const ent = esc(d.entidad);
  const puedeOnOff = !!c && c.caps.includes(prendido ? 'apagar' : 'encender');
  const onoff = `<button class="clm-pw${prendido ? ' on' : ''}" data-control="onoff" data-valor="" data-entidad="${ent}" aria-pressed="${prendido ? 'true' : 'false'}" aria-label="${esc(prendido ? T.apagar : T.encender)}"${puedeOnOff ? '' : ' disabled'}>${svg(ICONOS.encendido, 22)}</button>`;
  let cuerpo = '';
  if (c && c.temp && num(a.temperature) !== null) {
    const boton = (v, icono, etiqueta) => `<button class="clm-btn" data-control="temp" data-valor="${v}" data-entidad="${ent}" aria-label="${esc(etiqueta)}"${prendido ? '' : ' disabled'}>${svg(icono, 22)}</button>`;
    cuerpo += `<div class="clm-temp">${boton('-', ICONOS.menos, T.bajarTemp)}<span class="clm-cifra"><span class="num">${esc(grados(a.temperature))}°</span>${ahora}</span>${boton('+', ICONOS.mas, T.subirTemp)}</div>`;
  }
  if (prendido && c && c.modos.length) {
    cuerpo += `<div class="clm-modos">${c.modos.map((m) => `<button class="clm-modo${e.state === m ? ' sel' : ''}" data-control="modo" data-valor="${esc(m)}" data-entidad="${ent}" aria-pressed="${e.state === m ? 'true' : 'false'}">${esc(T.modos[m] || bonito(m))}</button>`).join('')}</div>`;
  }
  return `<div class="${clases.join(' ')}" data-clima="${ent}"><div class="clm-cab"><span class="clm-ic">${icono(d.entidad, ICONOS.clima, 22)}</span><span class="clm-tx"><span class="clm-nom">${esc(f.nombre)}</span><span class="clm-sub">${esc(sub)}</span></span>${onoff}</div>${cuerpo}</div>`;
}

// ------------------------------------------------------------------ PANEL-11: ventiladores (chip + panel lateral)

// Lo que dice el chip de ventiladores: con uno, su nombre y su estado; con varios, cuántos encendidos.
function resumenVentiladores(lista, estados, idioma = 'es') {
  const T = TXT[idioma];
  const fichas = lista.map((d) => fichaDe(d, estados, idioma));
  const encendidos = fichas.filter((f) => f.disponible && f.on).length;
  if (fichas.length === 1) return { nombre: fichas[0].nombre, estado: fichas[0].disponible ? fichas[0].sub : T.noDisp, encendidos };
  const algunoVivo = fichas.some((f) => f.disponible);
  return { nombre: T.ventiladores(fichas.length), estado: encendidos ? T.encendidosN(encendidos) : algunoVivo ? T.apagadosMin : T.sinConexionMin, encendidos };
}

function htmlChipVentiladores(grupo, lista, estados, idioma, abierta) {
  const T = TXT[idioma];
  const r = resumenVentiladores(lista, estados, idioma);
  return `<button class="chip vidrio vent${r.encendidos ? '' : ' quieto'}" data-ventiladores="${esc(grupo)}" aria-haspopup="dialog" aria-expanded="${abierta ? 'true' : 'false'}" aria-label="${esc(`${T.abrirVentiladores}: ${r.nombre} · ${r.estado}`)}">${svg(ICONOS.ventilador, 18)}<span class="va">${esc(r.nombre)}</span><span class="et">${esc(r.estado)}</span>${svg(ICONOS.derecha, 16)}</button>`;
}

// Una tarjeta de ventilador del panel lateral: encender/apagar, un botón por velocidad y la oscilación.
function htmlVentilador(d, estados, idioma, lugar) {
  const T = TXT[idioma];
  const f = fichaDe(d, estados, idioma);
  const caps = capsDe(d, estados);
  const est = f.estado || {};
  const prendido = f.disponible && f.on;
  const sub = [lugar, f.disponible ? f.sub : T.sinConexion].filter(Boolean).join(' · ');
  const clases = ['clm', 'vt'];
  if (!f.disponible) clases.push('nodisp');
  else if (!prendido) clases.push('quieta');
  const ent = esc(d.entidad);
  const puedeOnOff = caps.includes(prendido ? 'apagar' : 'encender');
  const onoff = `<button class="clm-pw${prendido ? ' on' : ''}" data-control="onoff" data-valor="" data-entidad="${ent}" aria-pressed="${prendido ? 'true' : 'false'}" aria-label="${esc(prendido ? T.apagar : T.encender)}"${puedeOnOff ? '' : ' disabled'}>${svg(ICONOS.encendido, 22)}</button>`;
  let cuerpo = '';
  if (caps.includes('velocidad') && est.pasos) {
    const botones = Array.from({ length: est.pasos }, (_, i) => i + 1)
      .map((k) => `<button class="clm-modo${est.nivel === k ? ' sel' : ''}" data-control="velocidad" data-valor="${k}" data-entidad="${ent}" aria-pressed="${est.nivel === k ? 'true' : 'false'}" aria-label="${esc(`${T.velocidad} ${k}`)}">${k}</button>`)
      .join('');
    cuerpo += `<div class="clm-modos vt-vel" role="group" aria-label="${esc(T.velocidad)}">${botones}</div>`;
  }
  if (caps.includes('oscilar')) {
    const osc = prendido && est.oscilando === true;
    cuerpo += `<div class="vt-osc"><span>${esc(T.oscilacion)}</span><button class="lz-tg${osc ? ' on' : ''}" role="switch" aria-checked="${osc ? 'true' : 'false'}" data-control="oscilar" data-valor="" data-entidad="${ent}" aria-label="${esc(T.oscilacion)}"${prendido ? '' : ' disabled'}><i></i></button></div>`;
  }
  return `<div class="${clases.join(' ')}" data-clima="${ent}"><div class="clm-cab"><span class="clm-ic">${icono(d.entidad, ICONOS.ventilador, 22)}</span><span class="clm-tx"><span class="clm-nom">${esc(f.nombre)}</span><span class="clm-sub">${esc(sub)}</span></span>${onoff}</div>${cuerpo}</div>`;
}

// ------------------------------------------------------------------ PANEL-07: cámaras (chip de Casa + panel lateral)

function htmlChipCamaras(camaras, estados, idioma, abierta) {
  const T = TXT[idioma];
  const n = camaras.filter((c) => camaraEnLinea(estados[c.entidad])).length;
  return `<button class="chip vidrio cams${n ? '' : ' quieto'}" data-camaras-chip="1" aria-haspopup="dialog" aria-expanded="${abierta ? 'true' : 'false'}" aria-label="${esc(`${T.abrirCamaras}: ${T.camarasChip(n)}`)}"><i></i>${svg(ICONOS.camara, 18)}<span class="va">${esc(T.camaras)}</span><span class="et">${esc(T.camarasChip(n))}</span>${svg(ICONOS.derecha, 16)}</button>`;
}

// PANEL-07: las celdas de cámara (cuadrícula de la pestaña Cámaras y panel lateral de Casa).
// Mismas reglas que PANEL-06: foto si la hay; sin foto, video en vivo para las primeras MAX_VIVO;
// las demás «Toca para ver en vivo»; sin foto ni video, «Sin imagen» (no se abre).
function celdasCamaras(camaras, estados, idioma, vista) {
  const T = TXT[idioma];
  const sinFoto = vista.sinFoto || new Set();
  const nada = (texto) => `<span class="nada">${svg(ICONOS.camara, 32)}<span>${esc(texto)}</span></span>`;
  const chipVivo = `<span class="chipcam"><i></i><span>${esc(T.enVivo)}</span></span>`;
  let enVivo = 0;
  return camaras
    .map((c) => {
      const e = estados[c.entidad];
      const ok = camaraEnLinea(e);
      let medio;
      let chip = '';
      let abre = ok;
      if (!ok) {
        medio = nada(T.sinConexion);
        chip = `<span class="chipcam fuera"><i></i><span>${esc(T.sinConexion)}</span></span>`;
      } else if (!sinFoto.has(c.entidad)) {
        medio = `<img src="${esc(urlCamara(e, false, vista.tic || 0))}" alt="" loading="lazy" data-foto="${esc(c.entidad)}">`;
      } else if (camaraConVideo(e) && !vista.sinReproductor) {
        if (enVivo < MAX_VIVO) {
          enVivo += 1;
          medio = `<div class="vivo" data-vivo="${esc(c.entidad)}" data-ajuste="cover"></div>`;
          chip = chipVivo;
        } else medio = nada(T.tocaVivo);
      } else {
        medio = nada(T.sinImagen);
        abre = false;
      }
      return `<button class="camara" data-camara="${esc(c.entidad)}" aria-label="${esc(T.abrirCamara(c.nombre))}"${abre ? '' : ' disabled'}>${medio}${chip}<span class="piecam"><span><span class="n">${esc(c.nombre)}</span><span class="l">${esc(c.lugar)}</span></span></span></button>`;
    })
    .join('');
}

// PANEL-07: en el panel lateral (angosto) primero las cámaras que se ven; al final las de «Sin imagen»
// y las sin conexión. Fuera de eso, el mismo orden que la cuadrícula.
function ordenPanelCamaras(camaras, estados, vista = {}) {
  const sinFoto = vista.sinFoto || new Set();
  const rango = (c) => {
    const e = estados[c.entidad];
    if (!camaraEnLinea(e)) return 2;
    return sinFoto.has(c.entidad) && !(camaraConVideo(e) && !vista.sinReproductor) ? 1 : 0;
  };
  return camaras.map((c, i) => [c, rango(c), i]).sort((x, y) => x[1] - y[1] || x[2] - y[2]).map((x) => x[0]);
}

const FMT_FECHA = new Map();
function partesHora(fecha, idioma, zona) {
  const clave = `${idioma}|${zona}`;
  if (!FMT_FECHA.has(clave)) {
    const loc = idioma === 'en' ? 'en-US' : 'es-MX';
    const opc = zona ? { timeZone: zona } : {};
    let f;
    try {
      f = {
        hora: new Intl.DateTimeFormat(loc, { ...opc, hour: '2-digit', minute: '2-digit', hourCycle: idioma === 'en' ? 'h12' : 'h23' }),
        h: new Intl.DateTimeFormat('en-US', { ...opc, hour: 'numeric', hourCycle: 'h23' }),
        dia: new Intl.DateTimeFormat(loc, { ...opc, weekday: 'long', day: 'numeric', month: 'long' }),
      };
    } catch {
      return partesHora(fecha, idioma, '');
    }
    FMT_FECHA.set(clave, f);
  }
  const f = FMT_FECHA.get(clave);
  const dia = f.dia.format(fecha);
  return { hora: f.hora.format(fecha), h: Number(f.h.format(fecha)) % 24, dia: dia.charAt(0).toUpperCase() + dia.slice(1) };
}

// Toda la pantalla como texto. `vista` trae lo que la tarjeta recuerda (pestaña, esperas…).
function dibujar({ modelo, estados, idioma = 'es', marca = '', fondo = null, ahora = new Date(), zona = '', vista = {} }) {
  const T = TXT[idioma];
  // PANEL-07: ¿el chip (tipo, grupo) es el del panel lateral abierto?
  const abierto = (tipo, grupo) => !!vista.lateral && vista.lateral.tipo === tipo && vista.lateral.grupo === grupo;
  const { hora, h, dia } = partesHora(ahora, idioma, zona);
  const camaras = modelo.camaras || [];
  const enCamaras = vista.pestana === CAMARAS && camaras.length > 0;
  // PANEL-08: pestaña «Escenas» (si hay), antes de Cámaras.
  const escenas = modelo.escenas || [];
  const enEscenas = vista.pestana === ESCENAS && escenas.length > 0;
  const cuartoSel = enCamaras || enEscenas ? null : modelo.cuartos.find((c) => c.id === vista.pestana);
  const pestana = enCamaras ? CAMARAS : enEscenas ? ESCENAS : cuartoSel ? cuartoSel.id : CASA;
  const tabs = [{ id: CASA, nombre: T.casa }, ...modelo.cuartos.map((c) => ({ id: c.id, nombre: c.nombre })), ...(escenas.length ? [{ id: ESCENAS, nombre: T.escenas }] : []), ...(camaras.length ? [{ id: CAMARAS, nombre: T.camaras }] : [])]
    .map((t) => `<button class="tab${t.id === pestana ? ' activa' : ''}" data-tab="${esc(t.id)}"${t.id === pestana ? ' aria-current="page"' : ''}>${esc(t.nombre)}</button>`)
    .join('');
  const espera = vista.espera || new Set();
  const opc = (f) => ({ espera: espera.has(f.entidad), activada: vista.activada === f.entidad, idioma });
  const capas = capasFoto(cuartoSel ? cuartoSel.foto || fondo : fondo);
  const estiloFondo = capas.length ? ` style="background-image:${capas.map((u) => `url(&quot;${esc(u)}&quot;)`).join(', ')}"` : '';
  let centro;
  let abajo = '';
  if (enCamaras) {
    const enLinea = camaras.filter((c) => camaraEnLinea(estados[c.entidad]));
    const fuera = camaras.length - enLinea.length;
    const sobre = [T.enLinea(enLinea.length), fuera ? T.sinConexionN(fuera) : ''].filter(Boolean).join(' · ');
    const sel = camaras.find((c) => c.entidad === vista.camara);
    // PANEL-06: una cámara «sin foto» (su foto falló) se ve con el reproductor de video de Home Assistant.
    const sinFoto = vista.sinFoto || new Set();
    const nada = (texto, tam) => `<span class="nada">${svg(ICONOS.camara, tam)}<span>${esc(texto)}</span></span>`;
    const chipVivo = `<span class="chipcam"><i></i><span>${esc(T.enVivo)}</span></span>`;
    let cuerpo;
    let boton = '';
    if (sel) {
      const e = estados[sel.entidad];
      const ok = camaraEnLinea(e);
      let medio;
      let vivo = false;
      if (!ok) medio = nada(T.sinConexion, 40);
      else if (!sinFoto.has(sel.entidad)) {
        medio = `<img src="${esc(urlCamara(e, true))}" alt="${esc(sel.nombre)}" data-foto="${esc(sel.entidad)}">`;
        vivo = true;
      } else if (camaraConVideo(e) && !vista.sinReproductor) {
        medio = `<div class="vivo" data-vivo="${esc(sel.entidad)}" data-ajuste="cover"></div>`;
        vivo = true;
      } else medio = nada(T.sinImagen, 40);
      const chip = vivo ? chipVivo : ok ? '' : `<span class="chipcam fuera"><i></i><span>${esc(T.sinConexion)}</span></span>`;
      cuerpo = `<div class="grande" data-grande="${esc(sel.entidad)}">${medio}${chip}<div class="piecam"><span><span class="n">${esc(sel.nombre)}</span><span class="l">${esc(sel.lugar)}</span></span><button class="cerrar vidrio" data-pantalla="1" aria-pressed="${vista.completa ? 'true' : 'false'}" aria-label="${esc(vista.completa ? T.salirPantalla : T.pantallaCompleta)}">${svg(vista.completa ? ICONOS.reducir : ICONOS.completa, 22)}</button></div></div>`;
      boton = `<button class="btn-cam vidrio" data-camaras-todas="1">${svg(ICONOS.rejilla, 18)}<span>${esc(T.verTodas)}</span></button>`;
    } else {
      cuerpo = `<div class="rejilla">${celdasCamaras(camaras, estados, idioma, vista)}</div>`;
    }
    centro = `<div class="cab-cams"><div><div class="sobre">${esc(sobre)}</div><div class="titulo cams">${esc(T.camaras)}</div></div>${boton}</div>${cuerpo}`;
  } else if (enEscenas) {
    // PANEL-08: todas las escenas, scripts y automatizaciones del panel, agrupadas por cuarto.
    centro = `<div class="sobre">${esc(T.escenasSobre(escenas.length))}</div><div class="titulo">${esc(T.escenas)}</div>`;
    abajo = `<div class="abajo escenas-tab">${htmlGruposEscenas(modelo.gruposEscenas || [], estados, opc, idioma, false)}</div>`;
  } else if (!cuartoSel) {
    const vistos = new Set();
    const todas = [...modelo.cuartos.flatMap((c) => c.dispositivos), ...modelo.accesos]
      .filter((d) => (vistos.has(d.entidad) ? false : vistos.add(d.entidad)))
      .map((d) => fichaDe(d, estados, idioma));
    const exterior = Object.values(estados)
      .filter((s) => s.entity_id.startsWith('weather.') && !['unavailable', 'unknown'].includes(s.state))
      .sort((a, b) => (a.entity_id < b.entity_id ? -1 : 1))[0];
    const sobre = exterior && grados(exterior.attributes?.temperature) !== null ? `${grados(exterior.attributes.temperature)}° · ${T.clima[exterior.state] || String(exterior.state).toUpperCase()}` : '';
    const saludo = h >= 5 && h < 12 ? T.dias : h >= 12 && h < 19 ? T.tardes : T.noches;
    const luces = todas.filter((f) => f.tipo === 'luz' && f.on).length;
    const chips = [];
    // PANEL-07: el chip de aires (con la temperatura de adentro) sustituye al chip «Interior».
    const aires = modelo.aires || [];
    if (aires.length) chips.push(htmlChipAires(CASA, aires, estados, idioma, abierto('aire', CASA)));
    // PANEL-11: el chip de ventiladores abre el panel con todos los ventiladores de la casa.
    const ventiladores = modelo.ventiladores || [];
    if (ventiladores.length) chips.push(htmlChipVentiladores(CASA, ventiladores, estados, idioma, abierto('ventiladores', CASA)));
    // PANEL-06: el chip de audio abre el panel lateral con todas las bocinas de la casa.
    const bocinas = modelo.bocinas || [];
    if (bocinas.length) chips.push(htmlChipAudio(CASA, bocinas, estados, idioma, abierto('audio', CASA)));
    // PANEL-07: el chip de cámaras abre el panel lateral con las cámaras.
    if (camaras.length) chips.push(htmlChipCamaras(camaras, estados, idioma, abierto('camaras', CASA)));
    // PANEL-08: el chip de persianas abre el panel con todas las persianas de la casa; el de escenas, sus botones.
    const persianas = modelo.persianas || [];
    if (persianas.some((d) => fichaDe(d, estados, idioma).disponible)) chips.push(htmlChipPersianas(persianas, estados, idioma, abierto('persianas', CASA)));
    if (escenas.length) chips.push(htmlChipEscenas(escenas, idioma, abierto('escenas', CASA)));
    const vacio = modelo.total === 0 ? `<div class="vacio vidrio"><h2>${esc(T.vacioTitulo)}</h2><p>${esc(T.vacioTexto)}</p></div>` : '';
    centro = `<div class="sobre">${esc(sobre)}</div><div class="titulo casa">${esc(saludo)}</div><div class="sub">${esc(modelo.total ? `${dia} · ${T.luces(luces)}` : dia)}</div>${chips.length ? `<div class="chips">${chips.join('')}</div>` : ''}${vacio}`;
    const partes = [];
    if (modelo.accesos.length) {
      const fichas = modelo.accesos.map((d) => fichaDe(d, estados, idioma)).map((f) => htmlFicha(f, opc(f))).join('');
      partes.push(`<div class="etiqueta der">${esc(T.accesos)}</div><div class="fila accesos der" data-fila="accesos">${fichas}</div>`);
    }
    if (partes.length) abajo = `<div class="abajo">${partes.join('')}</div>`;
  } else {
    const fichas = cuartoSel.dispositivos.map((d) => fichaDe(d, estados, idioma));
    const enc = encabezadoCuarto(fichas, estados, idioma);
    const bocinas = cuartoSel.bocinas || [];
    // PANEL-07: el chip de aires del cuarto (sus fichas siguen en la fila) y el de audio.
    const aires = airesDe(cuartoSel);
    const cs = [];
    if (aires.length) cs.push(htmlChipAires(cuartoSel.id, aires, estados, idioma, abierto('aire', cuartoSel.id)));
    // PANEL-11: el chip de ventiladores del cuarto.
    const ventG = ventiladoresDe(cuartoSel);
    if (ventG.length) cs.push(htmlChipVentiladores(cuartoSel.id, ventG, estados, idioma, abierto('ventiladores', cuartoSel.id)));
    if (bocinas.length) cs.push(htmlChipAudio(cuartoSel.id, bocinas, estados, idioma, abierto('audio', cuartoSel.id)));
    const chip = cs.length ? `<div class="chips">${cs.join('')}</div>` : '';
    centro = `<div class="sobre">${esc(enc.sobre)}</div><div class="titulo">${esc(cuartoSel.nombre)}</div><div class="sub">${esc(enc.sub)}</div>${chip}`;
    // PANEL-08: con 2 o más luces (o persianas), una tarjeta las junta; las favoritas salen también sueltas.
    const favs = modelo.favoritos || new Set();
    const lucesG = lucesDe(cuartoSel);
    const persG = persianasDe(cuartoSel);
    const juntaL = lucesG.length >= 2;
    const juntaP = persG.length >= 2;
    const juntaV = ventG.length >= 2;
    const piezas = [];
    let pusoL = false;
    let pusoP = false;
    let pusoV = false;
    cuartoSel.dispositivos.forEach((d, i) => {
      const enL = juntaL && lucesG.includes(d);
      const enP = juntaP && persG.includes(d);
      const enV = juntaV && ventG.includes(d);
      if (enL && !pusoL) {
        piezas.push(htmlGrupo('luces', cuartoSel.id, lucesG, estados, idioma, abierto('luces', cuartoSel.id)));
        pusoL = true;
      }
      if (enP && !pusoP) {
        piezas.push(htmlGrupo('persianas', cuartoSel.id, persG, estados, idioma, abierto('persianas', cuartoSel.id)));
        pusoP = true;
      }
      if (enV && !pusoV) {
        piezas.push(htmlGrupo('ventiladores', cuartoSel.id, ventG, estados, idioma, abierto('ventiladores', cuartoSel.id)));
        pusoV = true;
      }
      if ((enL || enP || enV) && !favs.has(d.entidad)) return;
      piezas.push(htmlFicha(fichas[i], { ...opc(fichas[i]), favorito: (enL || enP || enV) && favs.has(d.entidad) }));
    });
    const html = piezas.join('');
    const puntos = piezas.length + (pusoL ? 1 : 0) + (pusoP ? 1 : 0) + (pusoV ? 1 : 0) > 6 ? '<div class="puntos der" aria-hidden="true"><span></span><span></span></div>' : '';
    if (piezas.length) abajo = `<div class="abajo"><div class="fila der" data-fila="${esc(cuartoSel.id)}">${html}</div>${puntos}</div>`;
  }
  const aviso = vista.aviso ? `<div class="aviso" role="status">${esc(vista.aviso)}</div>` : '';
  // PANEL-06/07: el panel lateral abierto (audio, aires o cámaras), solo en la pestaña de donde se abrió.
  let audio = '';
  const grupo = grupoLateral(modelo, vista.lateral);
  if (grupo && !enCamaras && !enEscenas && (grupo.id === CASA ? !cuartoSel : cuartoSel && cuartoSel.id === grupo.id)) {
    const lugarDe = (d) => (grupo.id === CASA ? (modelo.cuartos.find((c) => c.id !== OTROS && c.dispositivos.some((x) => x.entidad === d.entidad)) || {}).nombre || '' : '');
    const favs = modelo.favoritos || new Set();
    if (grupo.tipo === 'luces' || grupo.tipo === 'persianas') {
      const titulo = grupo.tipo === 'luces' ? T.lucesDeCuarto(grupo.nombre) : grupo.id === CASA ? T.persianasCasa : T.persianasDeCuarto(grupo.nombre);
      const cuerpo = grupo.lista.map((d) => htmlRenglon(d, estados, idioma, vista, { favorito: favs.has(d.entidad), lugar: lugarDe(d) })).join('');
      audio = htmlLateral(grupo.tipo, titulo, cuerpo, idioma, '', htmlAccionesTodas(grupo.tipo, grupo.id, idioma));
    } else if (grupo.tipo === 'ventiladores') {
      // PANEL-11: una tarjeta por ventilador; con 2 o más, arriba «Apagar todos» / «Encender todos».
      const titulo = grupo.id === CASA ? T.ventiladoresCasa : T.ventiladoresDeCuarto(grupo.nombre);
      const arriba = grupo.lista.length >= 2 ? htmlAccionesTodas('ventiladores', grupo.id, idioma) : '';
      audio = htmlLateral('ventiladores', titulo, grupo.lista.map((d) => htmlVentilador(d, estados, idioma, lugarDe(d))).join(''), idioma, '', arriba);
    } else if (grupo.tipo === 'escenas') {
      const pie = `<button class="btn-cam" data-ir-escenas="1">${svg(ICONOS.rejilla, 18)}<span>${esc(T.verTodas)}</span></button>`;
      audio = htmlLateral('escenas', T.escenas, htmlGruposEscenas(modelo.gruposEscenas || [], estados, opc, idioma, true), idioma, pie);
    } else if (grupo.tipo === 'audio') {
      audio = htmlLateral('audio', grupo.id === CASA ? T.audioCasa : T.audioDe(grupo.nombre), grupo.lista.map((d) => htmlBocina(d, estados, idioma, vista)).join(''), idioma);
    } else if (grupo.tipo === 'aire') {
      audio = htmlLateral('aire', grupo.id === CASA ? T.airesCasa : T.airesDe(grupo.nombre), grupo.lista.map((d) => htmlAire(d, estados, idioma, lugarDe(d))).join(''), idioma);
    } else {
      const n = grupo.lista.filter((c) => camaraEnLinea(estados[c.entidad])).length;
      const pie = `<button class="btn-cam" data-ir-camaras="1">${svg(ICONOS.rejilla, 18)}<span>${esc(T.verTodas)}</span></button>`;
      audio = htmlLateral('camaras', T.camarasLat(n), celdasCamaras(ordenPanelCamaras(grupo.lista, estados, vista), estados, idioma, vista), idioma, pie);
    }
  }
  let ventana = '';
  if (vista.ventana) {
    const cuarto = modelo.cuartos.find((c) => [...c.dispositivos, ...(c.bocinas || [])].some((x) => x.entidad === vista.ventana));
    const d = cuarto
      ? [...cuarto.dispositivos, ...(cuarto.bocinas || [])].find((x) => x.entidad === vista.ventana)
      : modelo.accesos.find((x) => x.entidad === vista.ventana) || (modelo.bocinas || []).find((x) => x.entidad === vista.ventana) || (modelo.aires || []).find((x) => x.entidad === vista.ventana) || (modelo.persianas || []).find((x) => x.entidad === vista.ventana);
    if (d) ventana = htmlVentana(d, estados, idioma, vista, cuarto && cuarto.id !== OTROS ? cuarto.nombre : '');
  }
  return `<div class="raiz"${estiloFondo}><div class="velo"></div><div class="sombra"></div><div class="capa"><div class="barra der"><div class="marca">${esc(marca)}</div><nav class="tabs vidrio" aria-label="${esc(T.cuartos)}">${tabs}</nav><div class="hora">${esc(hora)}${htmlBateria(vista.bateria, idioma)}</div></div><div class="centro der${enCamaras ? ' cams' : ''}">${centro}</div>${abajo}</div>${audio}${ventana}${aviso}</div>`;
}

// PANEL-06b: ¿la cámara grande de esta tarjeta está en pantalla completa? (dentro de la sombra)
function enPantallaCompleta(raiz) {
  const fe = raiz && (raiz.fullscreenElement || raiz.webkitFullscreenElement);
  return fe && fe.classList && fe.classList.contains('grande') ? fe : null;
}
function salirDePantallaCompleta() {
  try {
    const salir = document.exitFullscreen || document.webkitExitFullscreen;
    const r = salir ? salir.call(document) : null;
    if (r && r.catch) r.catch(() => {});
  } catch {
    /* ya no estaba */
  }
}

// PANEL-07: los aires de un cuarto (sus fichas de la fila que son aires).
const airesDe = (c) => (c?.dispositivos || []).filter((d) => d.tipo === 'clima');

// PANEL-06/07: lo que muestra un panel lateral { tipo: 'audio' | 'aire' | 'camaras', grupo: CASA o id del cuarto }:
// las bocinas o los aires de la casa o del cuarto, o las cámaras (solo en Casa). null si ya no hay nada.
function grupoLateral(modelo, lateral) {
  if (!lateral || !modelo) return null;
  const { tipo, grupo } = lateral;
  const de = (lista, c) => (lista.length ? { tipo, id: c ? c.id : CASA, nombre: c ? c.nombre : '', lista } : null);
  if (tipo === 'camaras') return grupo === CASA ? de(modelo.camaras || [], null) : null;
  // PANEL-08: escenas (solo Casa), persianas (Casa o cuarto) y luces (cuarto).
  if (tipo === 'escenas') return grupo === CASA ? de(modelo.escenas || [], null) : null;
  if (tipo === 'persianas' || tipo === 'luces') {
    if (grupo === CASA) return tipo === 'persianas' ? de(modelo.persianas || [], null) : null;
    const c = (modelo.cuartos || []).find((x) => x.id === grupo);
    return c ? de(tipo === 'luces' ? lucesDe(c) : persianasDe(c), c) : null;
  }
  // PANEL-11: ventiladores (Casa o cuarto).
  if (tipo === 'ventiladores') {
    if (grupo === CASA) return de(modelo.ventiladores || [], null);
    const c = (modelo.cuartos || []).find((x) => x.id === grupo);
    return c ? de(ventiladoresDe(c), c) : null;
  }
  if (tipo !== 'audio' && tipo !== 'aire') return null;
  if (grupo === CASA) return de((tipo === 'audio' ? modelo.bocinas : modelo.aires) || [], null);
  const c = (modelo.cuartos || []).find((x) => x.id === grupo);
  return c ? de(tipo === 'audio' ? c.bocinas || [] : airesDe(c), c) : null;
}

// PANEL-06: el grupo de bocinas de un chip de audio (CASA = todas; si no, las del cuarto), o null si ya no hay.
function grupoAudio(modelo, id) {
  const g = grupoLateral(modelo, { tipo: 'audio', grupo: id });
  return g ? { id: g.id, nombre: g.nombre, bocinas: g.lista } : null;
}

// ------------------------------------------------------------------ actualizar sin reemplazar
// Pone en `a` (lo que ya está en pantalla) lo de `b` (lo nuevo) cambiando solo lo
// distinto: un toque que empieza antes de un cambio de estado no se pierde, y las
// filas no pierden lo deslizado. Una ficha de otra entidad se reemplaza entera.
function morph(a, b) {
  if (a.nodeType === 3 || a.nodeType === 8) {
    if (a.nodeValue !== b.nodeValue) a.nodeValue = b.nodeValue;
    return;
  }
  for (const at of [...a.attributes]) if (!b.hasAttribute(at.name)) a.removeAttribute(at.name);
  for (const at of [...b.attributes]) if (a.getAttribute(at.name) !== at.value) a.setAttribute(at.name, at.value);
  if ('disabled' in a && a.disabled !== b.hasAttribute('disabled')) a.disabled = b.hasAttribute('disabled');
  // PANEL-06: lo de adentro de un espacio de video lo maneja la tarjeta (el reproductor de HA); no se toca.
  if (a.hasAttribute && a.hasAttribute('data-vivo')) return;
  // PANEL-09: el ícono de HA que ya está puesto en su lugar se queda (la tarjeta le pasa el estado nuevo).
  if (a.hasAttribute && a.hasAttribute('data-icono') && a.firstElementChild && a.firstElementChild.localName === 'ha-state-icon') return;
  const ac = [...a.childNodes];
  const bc = [...b.childNodes];
  const clave = (n) => (n.nodeType === 1 ? `${n.getAttribute('data-ficha')}|${n.getAttribute('data-bocina')}|${n.getAttribute('data-clima')}|${n.getAttribute('data-tarjeta')}|${n.getAttribute('data-grupo')}|${n.getAttribute('data-vivo')}|${n.getAttribute('data-lateral')}` : '');
  bc.forEach((y, i) => {
    const x = ac[i];
    if (!x) a.appendChild(y);
    else if (x.nodeType !== y.nodeType || x.nodeName !== y.nodeName || clave(x) !== clave(y)) a.replaceChild(y, x);
    else morph(x, y);
  });
  for (let i = bc.length; i < ac.length; i += 1) a.removeChild(ac[i]);
}

// ------------------------------------------------------------------ la tarjeta

if (typeof HTMLElement !== 'undefined' && typeof customElements !== 'undefined' && !customElements.get('vizions-panel-card')) {
  // La fuente Inter (si hay internet); sin internet se usa la del sistema.
  try {
    if (!document.getElementById('vizions-panel-fuente')) {
      const l = document.createElement('link');
      l.id = 'vizions-panel-fuente';
      l.rel = 'stylesheet';
      l.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&display=swap';
      document.head.appendChild(l);
    }
  } catch {
    /* sin documento: nada */
  }

  class VizionsPanelCard extends HTMLElement {
    constructor() {
      super();
      this._cfg = { etiqueta: ETIQUETA_PANEL, etiquetaInicio: ETIQUETA_INICIO, etiquetaFavorito: ETIQUETA_FAVORITO, marca: '', fondo: '' };
      this._ventana = null;
      this._arrastre = null;
      this._camara = null;
      this._lateral = null; // PANEL-07: panel lateral abierto { tipo: 'audio' | 'aire' | 'camaras', grupo: CASA o id del cuarto }
      this._sinFoto = new Map(); // PANEL-06: cámara → hasta cuándo se trata como «sin foto»
      this._vivos = new Map(); // PANEL-06: cámara → su reproductor de Home Assistant (ha-camera-stream)
      this._reg = null;
      this._unsubs = [];
      this._espera = new Map();
      this._activada = null;
      this._aviso = '';
      this._html = '';
      this._pestana = null;
      try {
        this._pestana = localStorage.getItem('vizions-panel-pestana');
      } catch {
        this._pestana = null;
      }
      // PANEL-10: el cuarto de esta tablet (?cuarto= en la dirección) y cuándo se tocó la pantalla por última vez.
      this._cuartoPedido = null;
      try {
        this._cuartoPedido = new URLSearchParams(window.location.search).get('cuarto');
      } catch {
        this._cuartoPedido = null;
      }
      this._cuartoAplicado = false;
      this._volverMs = VOLVER_MS;
      this._ultimoToque = Date.now();
      const toque = () => {
        this._ultimoToque = Date.now();
      };
      for (const t of ['pointerdown', 'touchstart', 'keydown', 'wheel']) this.addEventListener(t, toque, { passive: true, capture: true });
      this.attachShadow({ mode: 'open' });
      this.shadowRoot.innerHTML = `<style>${CSS}</style><div id="vp"></div>`;
      const r = this.shadowRoot;
      r.addEventListener('click', (ev) => this._clic(ev));
      // PANEL-12: en celular, la hoja (panel o ventana) se cierra deslizándola hacia abajo desde su asa o su cabecera.
      r.addEventListener('touchstart', (ev) => this._deslizarInicio(ev), { passive: true });
      r.addEventListener('touchmove', (ev) => this._deslizarMover(ev), { passive: true });
      r.addEventListener('touchend', () => this._deslizarFin());
      r.addEventListener('touchcancel', () => this._deslizarFin(true));
      // Mantener presionada una ficha abre su ventana (también clic derecho en una compu).
      r.addEventListener('pointerdown', (ev) => this._presionar(ev));
      r.addEventListener('pointermove', (ev) => this._mover(ev));
      r.addEventListener('pointerup', () => this._soltar());
      r.addEventListener('pointercancel', () => this._soltar());
      r.addEventListener('contextmenu', (ev) => {
        const b = ev.target.closest('[data-ficha], [data-bocina], [data-clima], [data-tarjeta]');
        if (!b) return;
        ev.preventDefault();
        if ((b.dataset.bocina || b.dataset.clima || b.dataset.tarjeta) && ev.target.closest('button, input')) return;
        if (this._abrirVentana(b.dataset.ficha || b.dataset.bocina || b.dataset.clima || b.dataset.tarjeta)) this._suprimirClic = Date.now();
      });
      // Barras: «input» mientras se arrastra, «change» al soltar (ahí se manda la orden).
      // La de la ventana es del aparato de la ventana; las del panel de audio dicen de qué bocina son.
      r.addEventListener('input', (ev) => {
        const i = ev.target;
        const entidad = i.matches && i.matches('input[data-control]') ? i.dataset.entidad || this._ventana : null;
        if (!entidad) return;
        this._arrastre = { entidad, control: i.dataset.control, valor: Number(i.value), hasta: Date.now() + 60000 };
        this._render();
      });
      r.addEventListener('change', (ev) => {
        const i = ev.target;
        const entidad = i.matches && i.matches('input[data-control]') ? i.dataset.entidad || this._ventana : null;
        if (!entidad) return;
        this._arrastre = { entidad, control: i.dataset.control, valor: Number(i.value), hasta: Date.now() + 2500 };
        this._control(i.dataset.control, i.value, entidad);
        setTimeout(() => this._render(), 2600);
      });
      // PANEL-06: si la foto (o el MJPEG) de una cámara falla, se marca «sin foto» y se usa el video de HA.
      // Los errores de <img> no suben: se atrapan de camino hacia abajo (captura).
      r.addEventListener(
        'error',
        (ev) => {
          const img = ev.target;
          if (!img || img.localName !== 'img' || !img.dataset || !img.dataset.foto) return;
          if (this._marcarSinFoto(img.dataset.foto)) this._render();
        },
        true,
      );
      this._alPantalla = () => this._render();
      this.addEventListener('keydown', (ev) => {
        // PANEL-08: la tarjeta de grupo es role=button: Enter o espacio la abren.
        const g = (ev.key === 'Enter' || ev.key === ' ') && ev.composedPath().find((x) => x.dataset && x.dataset.grupo);
        if (g && !ev.composedPath().some((x) => x.localName === 'button')) {
          ev.preventDefault();
          g.click();
          return;
        }
        if (ev.key !== 'Escape') return;
        if (enPantallaCompleta(this.shadowRoot)) salirDePantallaCompleta();
        else if (this._ventana) this._cerrarVentana();
        else if (this._lateral) this._cerrarLateral();
      });
    }

    // PANEL-06: marca una cámara «sin foto» por SIN_FOTO_MS. Devuelve true si cambió algo.
    _marcarSinFoto(entidad) {
      if (typeof entidad !== 'string' || !ID_CAMARA.test(entidad)) return false;
      const ya = this._sinFoto.get(entidad);
      if (ya && ya > Date.now()) return false;
      this._sinFoto.set(entidad, Date.now() + SIN_FOTO_MS);
      return true;
    }

    setConfig(c) {
      const cfg = c || {};
      this._cfg = {
        etiqueta: typeof cfg.etiqueta === 'string' && cfg.etiqueta.trim() ? cfg.etiqueta.trim() : ETIQUETA_PANEL,
        etiquetaInicio: typeof cfg.etiqueta_inicio === 'string' && cfg.etiqueta_inicio.trim() ? cfg.etiqueta_inicio.trim() : ETIQUETA_INICIO,
        etiquetaFavorito: typeof cfg.etiqueta_favorito === 'string' && cfg.etiqueta_favorito.trim() ? cfg.etiqueta_favorito.trim() : ETIQUETA_FAVORITO,
        marca: typeof cfg.marca === 'string' ? cfg.marca.trim() : '',
        fondo: urlSegura(cfg.fondo) || '',
        kiosko: cfg.kiosko === false ? false : true,
        cuarto: typeof cfg.cuarto === 'string' && cfg.cuarto.trim() ? cfg.cuarto.trim() : '',
      };
      this._kiosko();
      this._render();
    }

    static getStubConfig() {
      return { etiqueta: ETIQUETA_PANEL };
    }

    getCardSize() {
      return 12;
    }

    getGridOptions() {
      return { columns: 'full', rows: 'auto' };
    }

    set hass(h) {
      const primera = !this._hass;
      this._hass = h;
      if (primera && this.isConnected) this._conectar();
      this._kiosko();
      for (const [ent, d] of this._espera) {
        const s = h.states[ent];
        if (!s || s.last_updated !== d.desde || Date.now() > d.hasta) this._espera.delete(ent);
      }
      this._render();
    }

    connectedCallback() {
      // Cada 5 s: el reloj y, en la pestaña Cámaras, la imagen nueva de cada cámara (cambia cada 10 s).
      this._reloj = setInterval(() => {
        this._volverAlCuarto();
        this._render();
      }, 5000);
      // PANEL-09: la pila de la tablet, al conectar y cada minuto.
      this._leerBateria();
      this._tBateria = setInterval(() => this._leerBateria(), 60000);
      document.addEventListener('fullscreenchange', this._alPantalla);
      if (this._hass && !this._conectado) this._conectar();
      this._kiosko();
      // Home Assistant termina de armar su pantalla después de conectar la tarjeta.
      this._tKiosko = setTimeout(() => this._kiosko(), 300);
      // PANEL-12: el acomodo de celular depende del ancho de la tarjeta (no de la pantalla).
      if (typeof ResizeObserver === 'function') {
        this._medida = new ResizeObserver(() => this._medirAncho());
        this._medida.observe(this);
      }
      this._medirAncho();
    }

    disconnectedCallback() {
      clearInterval(this._reloj);
      clearInterval(this._tBateria);
      document.removeEventListener('fullscreenchange', this._alPantalla);
      this._vivos.clear();
      clearTimeout(this._tRecarga);
      clearTimeout(this._tKiosko);
      this._quitarKiosko();
      if (this._medida) this._medida.disconnect();
      this._medida = null;
      for (const u of this._unsubs) {
        try {
          u();
        } catch {
          /* ya cerrada */
        }
      }
      this._unsubs = [];
      this._conectado = false;
    }

    // Pone (o quita) los estilos del modo kiosko en Home Assistant. Barato: se llama seguido.
    _kiosko() {
      if (!this.isConnected || !this._hass) return;
      let busqueda = '';
      try {
        busqueda = window.location.search;
      } catch {
        busqueda = '';
      }
      const quiere = quiereKiosko({ esAdmin: !!(this._hass.user && this._hass.user.is_admin), config: this._cfg.kiosko, busqueda });
      if (!quiere) {
        this._quitarKiosko();
        return;
      }
      const raices = raicesKiosko(this);
      this._estilosKiosko = this._estilosKiosko || [];
      for (const [donde, css] of Object.entries(CSS_KIOSKO)) {
        const raiz = raices[donde];
        if (!raiz || raiz.querySelector(`#${KIOSKO_ID}`)) continue;
        const st = document.createElement('style');
        st.id = KIOSKO_ID;
        st.textContent = css;
        raiz.appendChild(st);
        this._estilosKiosko.push(st);
      }
      this.toggleAttribute('kiosko', true);
      this._guardarAtras();
    }

    _quitarKiosko() {
      for (const st of this._estilosKiosko || []) st.remove();
      this._estilosKiosko = [];
      this.removeAttribute('kiosko');
      this._soltarAtras();
    }

    // «Atrás» no saca del panel. Se deja una entrada de más en el historial (la misma
    // dirección) y, cuando el navegador regresa, se atrapa el aviso ANTES que Home
    // Assistant (que lo escucha en window, sin captura) y se vuelve a la dirección del panel.
    _guardarAtras() {
      if (this._atras || typeof window === 'undefined' || !window.history) return;
      const aqui = window.location.pathname + window.location.search + window.location.hash;
      this._atras = (ev) => {
        ev.stopImmediatePropagation();
        try {
          window.history.pushState(window.history.state, '', aqui);
        } catch {
          /* sin historial: nada */
        }
      };
      try {
        window.history.pushState(window.history.state, '', aqui);
      } catch {
        /* sin historial: nada */
      }
      window.addEventListener('popstate', this._atras, true);
    }

    _soltarAtras() {
      if (!this._atras) return;
      window.removeEventListener('popstate', this._atras, true);
      this._atras = null;
    }

    async _conectar() {
      if (this._conectado || !this._hass) return;
      this._conectado = true;
      const con = this._hass.connection;
      for (const ev of EVENTOS_REGISTRO) {
        try {
          const u = await con.subscribeEvents(() => this._programarRecarga(), ev);
          if (!this._conectado) u();
          else this._unsubs.push(u);
        } catch {
          /* sin permiso para ese evento: se queda con el sondeo */
        }
      }
      if (!this._sondeo) this._sondeo = setInterval(() => this._recargar(), 60000);
      this._recargar();
    }

    _programarRecarga() {
      clearTimeout(this._tRecarga);
      this._tRecarga = setTimeout(() => this._recargar(), 800);
    }

    async _recargar() {
      const h = this._hass;
      if (!h) return;
      try {
        const [etiquetas, dispositivos, entidades, areas] = await Promise.all([
          h.callWS({ type: 'config/label_registry/list' }),
          h.callWS({ type: 'config/device_registry/list' }),
          h.callWS({ type: 'config/entity_registry/list' }),
          h.callWS({ type: 'config/area_registry/list' }),
        ]);
        this._reg = { etiquetas, dispositivos, entidades, areas };
        this._errorReg = false;
      } catch (e) {
        console.warn('[vizions-panel] registros', e);
        this._errorReg = true;
        clearTimeout(this._tRecarga);
        this._tRecarga = setTimeout(() => this._recargar(), 10000);
      }
      this._render();
    }

    _modelo(idioma) {
      if (!this._reg || !this._hass) return { cuartos: [], escenas: [], total: 0 };
      return armarModelo({ ...this._reg, estados: this._hass.states, etiqueta: this._cfg.etiqueta, etiquetaInicio: this._cfg.etiquetaInicio, etiquetaFavorito: this._cfg.etiquetaFavorito, idioma });
    }

    _render() {
      const raiz = this.shadowRoot && this.shadowRoot.getElementById('vp');
      if (!raiz || !this._hass) return;
      const idioma = idiomaDe(this._hass);
      if (this._activada && Date.now() > this._activada.hasta) this._activada = null;
      this._modeloActual = this._modelo(idioma);
      // PANEL-10: al cargar, la pestaña del cuarto de esta tablet (una sola vez, cuando ya hay cuartos).
      if (!this._cuartoAplicado && this._cuartoDeTablet() !== undefined && (this._modeloActual.cuartos || []).length) {
        const id = cuartoDeParametro(this._modeloActual, this._cuartoDeTablet());
        if (id) this._pestana = id;
        this._cuartoAplicado = true;
      }
      // Si lo de la ventana ya no está (le quitaron la etiqueta) o ya no se puede ajustar, se cierra.
      if (this._ventana) {
        const d = this._dispositivo(this._ventana);
        if (!d || !controlesDe(d, this._hass.states)) this._ventana = null;
      }
      if (this._arrastre && Date.now() > this._arrastre.hasta) this._arrastre = null;
      if (this._camara && !(this._modeloActual.camaras || []).some((c) => c.entidad === this._camara)) this._camara = null;
      // PANEL-06/07: si el panel lateral ya no tiene nada (les quitaron la etiqueta), se cierra.
      if (this._lateral && !grupoLateral(this._modeloActual, this._lateral)) this._lateral = null;
      const ahora = Date.now();
      for (const [ent, hasta] of this._sinFoto) if (hasta <= ahora) this._sinFoto.delete(ent);
      const T = TXT[idioma];
      const html = this._reg
        ? dibujar({
            modelo: this._modeloActual,
            estados: this._hass.states,
            idioma,
            marca: this._cfg.marca || this._hass.config?.location_name || '',
            fondo: this._cfg.fondo || null,
            zona: this._hass.config?.time_zone || '',
            vista: {
              pestana: this._pestana,
              espera: new Set(this._espera.keys()),
              activada: this._activada?.entidad,
              aviso: this._aviso,
              ventana: this._ventana,
              arrastre: this._arrastre,
              camara: this._camara,
              tic: Math.floor(Date.now() / 10000),
              lateral: this._lateral,
              sinFoto: new Set(this._sinFoto.keys()),
              sinReproductor: this._sinReproductor === true,
              completa: !!enPantallaCompleta(this.shadowRoot),
              bateria: this._bateria || null,
            },
          })
        : `<div class="raiz"><div class="velo"></div><div class="capa der"><div class="sobre">${this._errorReg ? esc(T.errorRegistro) : ''}</div></div></div>`;
      if (html !== this._html) {
        const nuevo = document.createElement('template');
        nuevo.innerHTML = html;
        const viejo = raiz.firstElementChild;
        if (viejo && nuevo.content.firstElementChild) morph(viejo, nuevo.content.firstElementChild);
        else raiz.replaceChildren(nuevo.content);
        this._html = html;
      }
      this._montarVivos();
      this._montarIconos();
      this._centrarPestana();
    }

    // PANEL-12: celular o tablet según el ancho de la tarjeta.
    _medirAncho() {
      const movil = esMovil(this.getBoundingClientRect().width);
      if (movil === this.hasAttribute('movil')) return;
      this.toggleAttribute('movil', movil);
      this._pestanaCentrada = null;
      this._centrarPestana();
    }

    // PANEL-12: en celular la fila de pestañas se desliza; la activa se centra cuando cambia.
    _centrarPestana() {
      if (!this.hasAttribute('movil') || this._pestanaCentrada === this._pestana) return;
      const tabs = this.shadowRoot && this.shadowRoot.querySelector('.tabs');
      const activa = tabs && tabs.querySelector('.tab.activa');
      if (!activa || !tabs.clientWidth) return;
      const a = activa.getBoundingClientRect();
      const t = tabs.getBoundingClientRect();
      tabs.scrollLeft += a.left + a.width / 2 - (t.left + t.width / 2);
      this._pestanaCentrada = this._pestana;
    }

    // PANEL-12: deslizar la hoja hacia abajo (solo celular). Empieza en el asa o en la cabecera, no en botones.
    _deslizarInicio(ev) {
      this._desliz = null;
      if (!this.hasAttribute('movil') || ev.touches.length !== 1) return;
      const t = ev.target;
      if (!t.closest || t.closest('button, input')) return;
      const zona = t.closest('[data-asa], .cab-lat, .cab-hoja');
      const hoja = zona && zona.closest('.lateral, .hoja');
      if (!hoja) return;
      this._desliz = { hoja, tipo: hoja.classList.contains('lateral') ? 'lateral' : 'hoja', y0: ev.touches[0].clientY, dy: 0 };
    }

    _deslizarMover(ev) {
      const d = this._desliz;
      if (!d || !ev.touches.length) return;
      d.dy = Math.max(0, ev.touches[0].clientY - d.y0);
      d.hoja.style.transform = d.dy ? `translateY(${d.dy}px)` : '';
    }

    _deslizarFin(cancelado = false) {
      const d = this._desliz;
      this._desliz = null;
      if (!d) return;
      d.hoja.style.transform = '';
      if (cancelado || d.dy < CERRAR_DESLIZANDO) return;
      if (d.tipo === 'lateral') this._cerrarLateral();
      else this._cerrarVentana();
    }

    // PANEL-10: lo pedido en la dirección manda sobre la configuración; undefined si no hay ninguno.
    _cuartoDeTablet() {
      return this._cuartoPedido || (this._cfg && this._cfg.cuarto) || undefined;
    }

    // PANEL-10: tras VOLVER_MS sin tocar la pantalla, de vuelta al cuarto de la tablet (todo cerrado).
    _volverAlCuarto() {
      const pedido = this._cuartoDeTablet();
      if (!pedido || !this._modeloActual) return;
      const id = cuartoDeParametro(this._modeloActual, pedido);
      if (!id || Date.now() - this._ultimoToque < this._volverMs) return;
      if (enPantallaCompleta(this.shadowRoot)) return;
      if (this._pestana === id && !this._lateral && !this._ventana && !this._camara) return;
      this._pestana = id;
      this._lateral = null;
      this._ventana = null;
      this._camara = null;
      this._arrastre = null;
      try {
        localStorage.setItem('vizions-panel-pestana', this._pestana);
      } catch {
        /* sin almacenamiento */
      }
      this._render();
    }

    // PANEL-09: lee la pila de la tablet de donde se pueda; si no hay de dónde, no se muestra.
    async _leerBateria() {
      let b = null;
      try {
        const ks = window.kioskSatellite;
        const fk = window.fully;
        if (ks && typeof ks.getDeviceInfo === 'function') {
          const i = await ks.getDeviceInfo();
          if (i) b = normalizarBateria(i.battery, i.charging);
        } else if (fk && typeof fk.getBatteryLevel === 'function') {
          b = normalizarBateria(fk.getBatteryLevel(), typeof fk.isPlugged === 'function' ? fk.isPlugged() : false);
        } else if (typeof navigator !== 'undefined' && typeof navigator.getBattery === 'function') {
          const m = await navigator.getBattery();
          if (m) {
            b = normalizarBateria(m.level, m.charging);
            if (!this._pilaEscucha) {
              this._pilaEscucha = true;
              const otra = () => this._leerBateria();
              m.addEventListener('levelchange', otra);
              m.addEventListener('chargingchange', otra);
            }
          }
        }
      } catch {
        b = null; // sin permiso (http) o sin dato: no se muestra
      }
      const antes = this._bateria;
      this._bateria = b;
      if (JSON.stringify(antes || null) !== JSON.stringify(b)) this._render();
    }

    // PANEL-09: en cada lugar [data-icono] pone el ícono de HA (ha-state-icon) con el estado de su aparato.
    _montarIconos() {
      const lugares = this.shadowRoot ? [...this.shadowRoot.querySelectorAll('[data-icono]')] : [];
      if (!lugares.length || !this._hass || this._sinIconos) return;
      if (!customElements.get('ha-state-icon')) {
        this._cargarIconos();
        return;
      }
      for (const l of lugares) {
        const estado = this._hass.states[l.dataset.icono];
        if (!estado) continue;
        let el = l.firstElementChild;
        if (!el || el.localName !== 'ha-state-icon') {
          el = document.createElement('ha-state-icon');
          l.replaceChildren(el);
        }
        if (el.hass !== this._hass) el.hass = this._hass;
        if (el.stateObj !== estado) el.stateObj = estado;
      }
    }

    // PANEL-09: ha-state-icon es de HA, pero se carga cuando alguna tarjeta lo usa. Se le pide a HA una
    // tarjeta «tile» (sin mostrarla) para que lo cargue; si en 10 s no aparece, se quedan los genéricos.
    _cargarIconos() {
      if (this._cargandoIconos || this._sinIconos) return;
      const ent = this.shadowRoot.querySelector('[data-icono]')?.dataset.icono;
      this._cargandoIconos = (async () => {
        try {
          const ayudas = typeof window.loadCardHelpers === 'function' ? await window.loadCardHelpers() : null;
          if (ayudas && ayudas.createCardElement && ent) {
            const t = ayudas.createCardElement({ type: 'tile', entity: ent });
            if (t) t.hass = this._hass;
          }
        } catch (e) {
          console.warn('[vizions-panel] iconos', e);
        }
        const listo = await Promise.race([customElements.whenDefined('ha-state-icon').then(() => true), new Promise((r) => setTimeout(() => r(false), 10000))]);
        this._cargandoIconos = null;
        if (!listo) this._sinIconos = true;
        else this._montarIconos();
      })();
    }

    // PANEL-06: pone el reproductor de video de Home Assistant en cada espacio [data-vivo] y le pasa
    // el estado nuevo (el token de la cámara cambia cada pocos minutos). Un reproductor por cámara,
    // reutilizado mientras su espacio siga en pantalla; al salir de la pestaña se suelta.
    _montarVivos() {
      const espacios = this.shadowRoot ? [...this.shadowRoot.querySelectorAll('[data-vivo]')] : [];
      for (const [ent, el] of this._vivos) if (!espacios.some((s) => s.dataset.vivo === ent && s.contains(el))) this._vivos.delete(ent);
      if (!espacios.length || !this._hass) return;
      if (!customElements.get('ha-camera-stream')) {
        this._cargarReproductor(espacios[0].dataset.vivo);
        return;
      }
      // document.fullscreenElement da el anfitrión de la tarjeta (sombra); el elemento real lo da la raíz de sombra.
      const completa = enPantallaCompleta(this.shadowRoot);
      for (const s of espacios) {
        const ent = s.dataset.vivo;
        const estado = this._hass.states[ent];
        if (!estado) continue;
        let el = this._vivos.get(ent);
        if (!el || !s.contains(el)) {
          el = document.createElement('ha-camera-stream');
          el.muted = true;
          el.controls = false;
          el.allowExoPlayer = false;
          s.replaceChildren(el);
          this._vivos.set(ent, el);
        }
        const ajuste = completa && completa.contains && completa.contains(s) ? 'contain' : s.dataset.ajuste || 'cover';
        if (el.fitMode !== ajuste) el.fitMode = ajuste;
        if (el.hass !== this._hass) el.hass = this._hass;
        if (el.stateObj !== estado) el.stateObj = estado;
      }
    }

    // PANEL-06: ha-camera-stream es del propio Home Assistant, pero se carga cuando alguna tarjeta
    // de cámara lo pide. Se le pide a HA una tarjeta de cámara (sin mostrarla) para que lo cargue;
    // si en 10 s no aparece, la cámara dice «Sin imagen».
    _cargarReproductor(entidad) {
      if (this._cargando || this._sinReproductor) return;
      this._cargando = (async () => {
        try {
          const ayudas = typeof window.loadCardHelpers === 'function' ? await window.loadCardHelpers() : null;
          if (ayudas && ayudas.createCardElement) {
            const t = ayudas.createCardElement({ type: 'picture-entity', entity: entidad, camera_view: 'live', show_name: false, show_state: false });
            if (t) t.hass = this._hass;
          }
        } catch (e) {
          console.warn('[vizions-panel] reproductor', e);
        }
        const listo = await Promise.race([customElements.whenDefined('ha-camera-stream').then(() => true), new Promise((r) => setTimeout(() => r(false), 10000))]);
        this._cargando = null;
        if (!listo) this._sinReproductor = true;
        this._render();
      })();
    }

    _dispositivo(entidad) {
      const m = this._modeloActual;
      if (!m) return null;
      return [...m.escenas, ...m.accesos, ...(m.bocinas || []), ...(m.aires || []), ...m.cuartos.flatMap((c) => [...c.dispositivos, ...(c.bocinas || [])])].find((x) => x.entidad === entidad) || null;
    }

    _abrirVentana(entidad) {
      const d = this._dispositivo(entidad);
      if (!d || !this._hass || !controlesDe(d, this._hass.states)) return false;
      this._ventana = entidad;
      this._arrastre = null;
      this._render();
      try {
        if (navigator.vibrate) navigator.vibrate(12);
      } catch {
        /* sin vibración */
      }
      // El foco va a la ventana misma (Esc la cierra, Tab recorre sus botones) y no a la X:
      // así no se pinta un anillo blanco en la X al abrirla con el dedo.
      const hoja = this.shadowRoot.querySelector('.hoja');
      if (hoja) hoja.focus({ preventScroll: true });
      return true;
    }

    _cerrarVentana() {
      this._ventana = null;
      this._arrastre = null;
      this._render();
    }

    _presionar(ev) {
      if (ev.button > 0) return;
      const b = ev.target.closest('[data-ficha], [data-bocina], [data-clima], [data-tarjeta]');
      clearTimeout(this._lp);
      this._lp = null;
      if (!b || b.disabled) return;
      // En la tarjeta de una bocina, un aire, una luz o una persiana del panel, los botones y la barra son suyos.
      if ((b.dataset.bocina || b.dataset.clima || b.dataset.tarjeta) && ev.target.closest('button, input')) return;
      this._lpInicio = { x: ev.clientX, y: ev.clientY };
      const entidad = b.dataset.ficha || b.dataset.bocina || b.dataset.clima || b.dataset.tarjeta;
      this._lp = setTimeout(() => {
        this._lp = null;
        // Un toque largo nunca prende ni apaga, tenga ventana o no.
        this._suprimirClic = Date.now();
        this._abrirVentana(entidad);
      }, 550);
    }

    _mover(ev) {
      if (this._lp && this._lpInicio && Math.hypot(ev.clientX - this._lpInicio.x, ev.clientY - this._lpInicio.y) > 12) this._soltar();
    }

    _soltar() {
      clearTimeout(this._lp);
      this._lp = null;
    }

    _clic(ev) {
      // El clic que sigue a mantener presionado no prende ni apaga.
      if (this._suprimirClic && Date.now() - this._suprimirClic < 1500) {
        this._suprimirClic = 0;
        return;
      }
      if (ev.target.closest('[data-cerrar]')) {
        this._cerrarVentana();
        return;
      }
      // PANEL-06/07: los paneles laterales (audio, aires, cámaras). El mismo chip abre y cierra.
      if (ev.target.closest('[data-cerrar-lateral]')) {
        this._cerrarLateral();
        return;
      }
      // PANEL-08: «todas» (apagar/encender luces, abrir/cerrar persianas) de una tarjeta de grupo o del panel.
      const todas = ev.target.closest('[data-todas]');
      if (todas) {
        if (!todas.disabled) this._todas(todas.dataset.todas, todas.dataset.cual, todas.dataset.grupoId);
        return;
      }
      if (ev.target.closest('[data-ir-escenas]')) {
        this._irAPestana(ESCENAS);
        return;
      }
      const chip = ev.target.closest('[data-audio], [data-aire], [data-ventiladores], [data-camaras-chip], [data-persianas-chip], [data-escenas-chip], [data-grupo]');
      if (chip) {
        const l = chip.dataset.ventiladores
          ? { tipo: 'ventiladores', grupo: chip.dataset.ventiladores }
          : chip.dataset.audio
          ? { tipo: 'audio', grupo: chip.dataset.audio }
          : chip.dataset.aire
            ? { tipo: 'aire', grupo: chip.dataset.aire }
            : chip.dataset.grupo
              ? { tipo: chip.dataset.grupo, grupo: chip.dataset.grupoId }
              : chip.dataset.persianasChip
                ? { tipo: 'persianas', grupo: CASA }
                : chip.dataset.escenasChip
                  ? { tipo: 'escenas', grupo: CASA }
                  : { tipo: 'camaras', grupo: CASA };
        if (this._lateral && this._lateral.tipo === l.tipo && this._lateral.grupo === l.grupo) this._cerrarLateral();
        else this._abrirLateral(l);
        return;
      }
      // PANEL-07: desde el panel de cámaras se va a la pestaña Cámaras (una cámara en grande, o todas).
      const irCam = ev.target.closest('.lateral [data-camara], [data-ir-camaras]');
      if (irCam) {
        if (irCam.disabled) return;
        this._irACamaras(irCam.dataset.camara || null);
        return;
      }
      const ctl = ev.target.closest('button[data-control]');
      if (ctl) {
        const ent = ctl.dataset.entidad || this._ventana;
        // En el panel de audio, un botón (silencio, reproducir…) manda sobre el número que el dedo dejó en la barra.
        if (ctl.dataset.entidad && this._arrastre && this._arrastre.entidad === ent) this._arrastre = null;
        if (!ctl.disabled) this._control(ctl.dataset.control, ctl.dataset.valor, ent);
        return;
      }
      const cam = ev.target.closest('[data-camara]');
      if (cam && !cam.disabled) {
        this._camara = cam.dataset.camara;
        this._render();
        return;
      }
      if (ev.target.closest('[data-camaras-todas]')) {
        this._camara = null;
        this._render();
        return;
      }
      if (ev.target.closest('[data-pantalla]')) {
        // PANEL-06b: el mismo botón entra y sale (en kiosko sin gestos no hay otra salida).
        if (enPantallaCompleta(this.shadowRoot)) salirDePantallaCompleta();
        else {
          const g = this.shadowRoot.querySelector('.grande');
          try {
            const r = g && (g.requestFullscreen || g.webkitRequestFullscreen) ? (g.requestFullscreen || g.webkitRequestFullscreen).call(g) : null;
            if (r && r.catch) r.catch(() => {});
          } catch {
            /* sin pantalla completa */
          }
        }
        return;
      }
      const tab = ev.target.closest('[data-tab]');
      if (tab) {
        this._ventana = null;
        this._camara = null;
        this._lateral = null;
        this._pestana = tab.dataset.tab;
        try {
          localStorage.setItem('vizions-panel-pestana', this._pestana);
        } catch {
          /* sin almacenamiento */
        }
        this._render();
        return;
      }
      const boton = ev.target.closest('[data-ficha]');
      if (boton && !boton.disabled) this._tocar(boton.dataset.ficha);
    }

    _control(control, valor, entidad = this._ventana) {
      const h = this._hass;
      const d = entidad ? this._dispositivo(entidad) : null;
      if (!h || !d) return;
      const orden = ordenControl(d, h.states, control, valor);
      if (orden) this._enviar(d, orden);
    }

    // PANEL-06/07: abre un panel lateral { tipo, grupo } y le pasa el foco.
    _abrirLateral(lateral) {
      if (!grupoLateral(this._modeloActual, lateral)) return;
      this._lateral = lateral;
      this._ventana = null;
      this._arrastre = null;
      this._render();
      const lat = this.shadowRoot.querySelector('.lateral');
      if (lat) lat.focus({ preventScroll: true });
    }

    _cerrarLateral() {
      this._lateral = null;
      this._arrastre = null;
      this._render();
    }

    // PANEL-08: «todas» de un grupo: una orden por servicio con todas las entidades que lo permiten.
    _todas(accion, cual, grupoId) {
      const h = this._hass;
      const g = grupoLateral(this._modeloActual, { tipo: cual, grupo: grupoId });
      if (!h || !g) return;
      const porServicio = new Map();
      for (const d of g.lista) {
        const f = fichaDe(d, h.states, idiomaDe(h));
        if (!f.disponible) continue;
        if (!capsDe(d, h.states).includes(accion)) continue;
        const o = ordenDe(d, accion);
        if (!o) continue;
        const k = `${o.dominio}.${o.servicio}`;
        if (!porServicio.has(k)) porServicio.set(k, { ...o, datos: { ...o.datos, entity_id: [] } });
        porServicio.get(k).datos.entity_id.push(o.datos.entity_id);
        this._espera.set(d.entidad, { desde: h.states[d.entidad]?.last_updated, hasta: Date.now() + 5000 });
      }
      if (!porServicio.size) return;
      this._render();
      setTimeout(() => this._render(), 5200);
      for (const o of porServicio.values()) {
        Promise.resolve(h.callService(o.dominio, o.servicio, o.datos)).catch((e) => {
          console.warn('[vizions-panel] todas', e);
          this._aviso = TXT[idiomaDe(h)].errorOrden;
          this._render();
          clearTimeout(this._tAviso);
          this._tAviso = setTimeout(() => {
            this._aviso = '';
            this._render();
          }, 4000);
        });
      }
    }

    // PANEL-08: ir a una pestaña (Escenas) desde un panel lateral.
    _irAPestana(id) {
      this._lateral = null;
      this._ventana = null;
      this._camara = null;
      this._pestana = id;
      try {
        localStorage.setItem('vizions-panel-pestana', this._pestana);
      } catch {
        /* sin almacenamiento */
      }
      this._render();
    }

    // PANEL-07: a la pestaña Cámaras, con una cámara en grande (o la cuadrícula).
    _irACamaras(camara) {
      this._lateral = null;
      this._ventana = null;
      this._camara = camara;
      this._pestana = CAMARAS;
      try {
        localStorage.setItem('vizions-panel-pestana', this._pestana);
      } catch {
        /* sin almacenamiento */
      }
      this._render();
    }

    async _tocar(entidad) {
      const h = this._hass;
      if (!h || !this._modeloActual) return;
      const d = this._dispositivo(entidad);
      if (!d) return;
      const f = fichaDe(d, h.states, idiomaDe(h));
      if (!f.accion) return;
      const orden = ordenDe(d, f.accion);
      if (orden) this._enviar(d, orden);
    }

    async _enviar(d, orden) {
      const h = this._hass;
      const idioma = idiomaDe(h);
      const entidad = d.entidad;
      const antes = h.states[entidad];
      this._espera.set(entidad, { desde: antes?.last_updated, hasta: Date.now() + 5000 });
      if (d.tipo === 'escena') this._activada = { entidad, hasta: Date.now() + 3000 };
      this._render();
      setTimeout(() => {
        this._espera.delete(entidad);
        this._render();
      }, 5200);
      if (d.tipo === 'escena') setTimeout(() => this._render(), 3100);
      try {
        await h.callService(orden.dominio, orden.servicio, orden.datos);
      } catch (e) {
        console.warn('[vizions-panel] orden', e);
        this._espera.delete(entidad);
        if (this._activada?.entidad === entidad) this._activada = null;
        this._arrastre = null;
        this._aviso = TXT[idioma].errorOrden;
        this._render();
        clearTimeout(this._tAviso);
        this._tAviso = setTimeout(() => {
          this._aviso = '';
          this._render();
        }, 4000);
      }
    }
  }

  customElements.define('vizions-panel-card', VizionsPanelCard);
  window.customCards = window.customCards || [];
  window.customCards.push({ type: 'vizions-panel-card', name: 'Vizions Panel', description: 'Tablero de la tablet del dueño (Vizions Smart Living)' });
  console.info(`%c VIZIONS PANEL %c ${VERSION_PANEL} `, 'background:#111;color:#FFE2B0', 'background:#FFE2B0;color:#111');
}

return { VERSION_PANEL, ETIQUETA_PANEL, ETIQUETA_INICIO, ETIQUETA_FAVORITO, MAX_VIVO, SIN_FOTO_MS, quiereKiosko, KIOSKO_ID, CSS_KIOSKO, raicesKiosko, idiomaDe, esc, urlSegura, capasFoto, camarasEtiquetadas, urlCamara, camaraConVideo, pasosVentilador, TIPOS_PANEL, ventiladoresEtiquetados, rutinasEtiquetadas, armarModelo, accionDeToque, fichaDe, ordenDe, TONOS, COLORES, capsDe, controlesDe, ordenControl, encabezadoCuarto, ANCHO_MOVIL, esMovil, CERRAR_DESLIZANDO, VOLVER_MS, cuartoDeParametro, normalizarBateria, resumenAudio, resumenAires, resumenVentiladores, ordenPanelCamaras, dibujar, enPantallaCompleta, grupoLateral, grupoAudio, morph };
})();
export const VIZIONS_PANEL = __vp_tarjeta;
