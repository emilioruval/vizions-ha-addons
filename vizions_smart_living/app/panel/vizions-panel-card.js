// Vizions Panel 0.15.0 — tarjeta de Home Assistant (Vizions Smart Living).
// Archivo ARMADO por scripts/panel-construir.mjs: no se edita a mano.
// Huella del contenido: 07891f7a012eb0f77f8a21d584d4462c
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
// VIZIONS-PANEL-13 (0.12.0, diseño aprobado el 17 nov 2026): música con Music Assistant. Pestaña «Música» al
// final (lo que suena, «Tu música» con Playlists/Álbumes/Radio/Favoritos y búsqueda, y «Bocinas» para agrupar
// y separar con volumen del grupo que respeta las proporciones), y en Casa una señal chica «Ahora suena»
// debajo de las pestañas que abre un mini modal (anterior/siguiente, play/pausa, silencio, volumen y «Abrir
// Música»). Solo con bocinas de Music Assistant etiquetadas; sin ellas todo queda como antes. Una Sonos que
// sale dos veces (la de Music Assistant y la nativa) aparece una sola vez: la de Music Assistant. Los cuartos
// salen en el orden de Home Assistant (Ajustes → Áreas → Reordenar), ya no por nombre.
//
// VIZIONS-PANEL-13b (0.12.1, pedido de Emilio el 17 nov 2026): la pestaña «Música» va justo después de «Casa»
// (antes de los cuartos); Escenas y Cámaras siguen al final.
//
// VIZIONS-PANEL-13c (0.12.2, aprobado el 17 nov 2026, tras la prueba en la oficina): Spotify ocupado. El panel
// reconoce los tres textos del error («concurrent», «simultaneous», «already playing / one thing at a time»).
// Si otra zona suena de verdad, aviso con «Unir a lo que suena» y «Poner aquí» (detiene la otra y pone la
// música). Si no (la misma zona cambiando de playlist, o la transmisión atorada), reintenta solo; si sigue,
// detiene todas las bocinas de Music Assistant y reintenta una vez; si aun así, pide reiniciar Music Assistant.
// Las órdenes de música ya no sacan además el aviso de Home Assistant. En «Bocinas»: «Silenciada» y botón de
// silencio por bocina, y botón de silencio del grupo junto a «Volumen del grupo».
//
// VIZIONS-PANEL-14 (0.13.0, aprobado el 19 nov 2026): acceso de administración con clave. En Casa, con el
// kiosko activo y «clave_admin» en la tarjeta (SHA-256 de «vizions-panel:» + la clave, 64 hex), un engrane
// discreto junto a la batería abre un teclado. Con la clave correcta el kiosko se suspende 10 minutos (aparece
// la barra lateral de Home Assistant) y en el lugar del engrane queda «Bloquear · m:ss». El kiosko regresa al
// tocar «Bloquear», al vencer el tiempo (si está en otra página de Home Assistant, vuelve al tablero) o al
// recargar. 5 errores seguidos = 30 s de espera. SHA-256 propio: crypto.subtle no existe en http://IP:8123.
// Es un candado de cortesía; la protección real es que el usuario de la tablet no sea administrador.
//
// VIZIONS-PANEL-14b (0.13.1, pedido de Emilio el 19 nov 2026, tras probar 14 en la tablet): capas. Las
// ventanas y los paneles laterales (con su fondo oscuro) quedan encima de «Ahora suena» y su mini modal (antes la
// señal, con z-index 5, salía encima del teclado de la clave, de la ventana de un dispositivo y de la pregunta de
// la TV); los avisos, encima de todo. El teclado ya no muestra 4 círculos vacíos al empezar (parecía que la clave
// era de 4): solo un punto por dígito escrito.
//
// VIZIONS-PANEL-15 (0.13.2, aprobado el 19 nov 2026): cámaras en la vista grande. Una cámara con video
// (supported_features STREAM) se ve directo con el reproductor de Home Assistant (ha-camera-stream: WebRTC o
// HLS), el mismo de su ventana; ya no se pide el MJPEG, que depende de la foto fija: con una Generic sin foto
// (grabador Hikvision) Home Assistant deja esa conexión abierta sin mandar nada ni dar error, y la vista grande
// quedaba transparente con «EN VIVO». El MJPEG sigue para las cámaras sin video (o si el reproductor no carga),
// vigilado: si en ESPERA_FOTO_MS no llega imagen, la cámara pasa a «sin foto» («Sin imagen»).
//
// VIZIONS-PANEL-16 (0.14.0, aprobado el 23 nov 2026): el aire va de grado en grado. En la ventana del aire, un
// dial (arco de 270° entre min_temp y max_temp, redondeados a grados enteros) en lugar de − / +: se arrastra la
// perilla, el número cambia en vivo y la orden se manda UNA vez, al soltar («Suelta para aplicar»). El arco se pinta
// del color del modo y un punto marca la temperatura actual. Con el teclado, las flechas mueven un grado y la orden
// sale 700 ms después de la última. En el panel lateral, − / + mueven un grado entero (24.5 → 25 con +, → 24 con −).
// La temperatura elegida nunca se muestra con decimales (la actual, «ahora 32.9°», sí). Antes, sin
// target_temp_step, el panel subía de 0.5 en 0.5.
//
// VIZIONS-PANEL-17 (0.15.0, aprobado el 24 nov 2026): canciones y «Audio de la TV». En «Tu música», tocar una
// playlist o un álbum ya no la pone: abre su detalle (portada, nombre, «N canciones», Reproducir, Aleatorio y la
// lista, de 50 en 50 con «Ver más»). Las canciones salen de media_player/browse_media de la bocina principal
// (título «Artista - Canción», partido en el primer « - »). Tocar una canción pone la lista DESDE ella hasta el
// final (music_assistant.play_media con la lista de uris, enqueue replace, hasta MAX_COLA); en orden, si el
// aleatorio de Music Assistant estaba prendido se apaga antes. «Aleatorio» lo prende y pone la lista revuelta.
// La que suena se marca con las barritas. Radio y Favoritos no cambian. «Audio de la TV»: en una bocina con
// entrada de TV (source_list con «TV») que está en otra cosa, un botón manda select_source TV (corta la música y
// regresa el audio de la TV), en el mini modal de «Ahora suena», en «Bocinas» y en el panel lateral de audio.
// Con la bocina en la TV, el mini modal y la tarjeta de lo que suena no muestran anterior/play/siguiente (la
// señal de Casa no cambia). Se probó en la oficina el 24 nov (Arc Ultra, Spotify) con usuario sin admin.
//
// Se arma en un solo archivo con scripts/panel-construir.mjs.

const { dispositivosEtiquetados } = __vp_descubrir;
const { TIPOS, noDisponibleDe } = __vp_tipos;
const { traducirNombre } = __vp_traducir;

const VERSION_PANEL = '0.15.0';
const ETIQUETA_PANEL = 'Vizions Panel';
const ETIQUETA_INICIO = 'Vizions Panel Inicio';
const ETIQUETA_FAVORITO = 'Vizions Panel Favorito';
const EVENTOS_REGISTRO = ['entity_registry_updated', 'device_registry_updated', 'area_registry_updated', 'label_registry_updated'];
const OTROS = '__otros__';
const ORDEN_TIPOS = ['luz', 'cortina', 'clima', 'ventilador', 'bocina', 'escena'];
const CASA = '__casa__';
const CAMARAS = '__camaras__';
const ESCENAS = '__escenas__';
const MUSICA = '__musica__';
// PANEL-06: cuántas cámaras sin foto se ven en vivo a la vez en la cuadrícula, y cuánto dura la marca «sin foto».
const MAX_VIVO = 4;
const SIN_FOTO_MS = 10 * 60 * 1000;
// PANEL-15: cuánto se espera la primera imagen del MJPEG de la vista grande antes de darlo por fallido.
const ESPERA_FOTO_MS = 8000;
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

// ------------------------------------------------------------------ candado (PANEL-14)
// «clave_admin» = SHA-256 (hex) de SAL_CLAVE + la clave. En la Mac:
//   printf 'vizions-panel:%s' "$clave" | shasum -a 256
const SAL_CLAVE = 'vizions-panel:';
const DESBLOQUEO_MS = 10 * 60 * 1000;
const INTENTOS_CLAVE = 5;
const ESPERA_CLAVE_MS = 30 * 1000;
const CLAVE_MIN = 4;
const CLAVE_MAX = 8;
const K256 = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];
const ror32 = (x, n) => (x >>> n) | (x << (32 - n));
function bytesUtf8(texto) {
  const t = String(texto);
  if (typeof TextEncoder === 'function') return new TextEncoder().encode(t);
  const b = unescape(encodeURIComponent(t));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}
// SHA-256 propio (crypto.subtle solo existe en páginas https y la tablet abre Home Assistant por http).
function sha256Hex(texto) {
  const datos = bytesUtf8(texto);
  const largo = datos.length;
  const total = Math.ceil((largo + 9) / 64) * 64;
  const m = new Uint8Array(total);
  m.set(datos);
  m[largo] = 0x80;
  const dv = new DataView(m.buffer);
  const bits = largo * 8;
  dv.setUint32(total - 8, Math.floor(bits / 0x100000000));
  dv.setUint32(total - 4, bits >>> 0);
  let h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const w = new Uint32Array(64);
  for (let o = 0; o < total; o += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(o + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = ror32(w[i - 15], 7) ^ ror32(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = ror32(w[i - 2], 17) ^ ror32(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (ror32(e, 6) ^ ror32(e, 11) ^ ror32(e, 25)) + ((e & f) ^ (~e & g)) + K256[i] + w[i]) >>> 0;
      const t2 = ((ror32(a, 2) ^ ror32(a, 13) ^ ror32(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    h = [a, b, c, d, e, f, g, hh].map((x, i) => (x + h[i]) >>> 0);
  }
  return h.map((x) => x.toString(16).padStart(8, '0')).join('');
}
const hashClave = (clave) => sha256Hex(SAL_CLAVE + String(clave));
// El valor de «clave_admin» si es válido (64 hex, en minúsculas); si no, null.
const claveAdminValida = (v) => (typeof v === 'string' && /^[0-9a-f]{64}$/i.test(v.trim()) ? v.trim().toLowerCase() : null);
function estadoCandado(c, ahora) {
  const hasta = Number(c?.hasta) || 0;
  const esperaHasta = Number(c?.esperaHasta) || 0;
  return { abierto: hasta > ahora, restanteMs: Math.max(0, hasta - ahora), espera: esperaHasta > ahora, esperaMs: Math.max(0, esperaHasta - ahora) };
}
// «m:ss», redondeando hacia arriba (10:00 justo al abrir; 0:00 al vencer).
function textoRestante(ms) {
  const s = Math.max(0, Math.ceil((Number(ms) || 0) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
// Un error más; al llegar a INTENTOS_CLAVE, espera ESPERA_CLAVE_MS y se reinicia la cuenta.
function errorClave(c, ahora) {
  const errores = (Number(c?.errores) || 0) + 1;
  return errores >= INTENTOS_CLAVE ? { ...c, errores: 0, esperaHasta: ahora + ESPERA_CLAVE_MS } : { ...c, errores };
}
// Estado del candado en este dispositivo (en memoria: recargar = bloqueado). Vive fuera de la tarjeta para
// sobrevivir cuando Home Assistant la quita y la vuelve a poner al navegar. Exportado para el banco.
const RELOJ_CANDADO = { ahora: () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()) };
const CANDADO = { hasta: 0, errores: 0, esperaHasta: 0, ruta: '', tarjeta: null, timer: null };
const candadoAbierto = () => estadoCandado(CANDADO, RELOJ_CANDADO.ahora()).abierto;
// Vence el desbloqueo: si la tarjeta está en pantalla, vuelve el kiosko; si no, regresa al tablero.
function vencerCandado() {
  const t = CANDADO.tarjeta;
  CANDADO.hasta = 0;
  clearTimeout(CANDADO.timer);
  CANDADO.timer = null;
  if (t && t.isConnected) {
    t._kiosko();
    t._render();
    return 'tarjeta';
  }
  if (!CANDADO.ruta || typeof window === 'undefined' || !window.history) return null;
  try {
    if (window.location.pathname + window.location.search !== CANDADO.ruta) {
      window.history.pushState(null, '', CANDADO.ruta);
      window.dispatchEvent(new window.CustomEvent('location-changed', { detail: { replace: false } }));
    }
  } catch {
    /* sin historial: el kiosko vuelve al regresar al tablero */
  }
  return 'ruta';
}
// ¿La pestaña pedida termina siendo Casa? (misma regla que dibujar)
function esCasa(modelo, pid) {
  if (!pid || pid === CASA) return true;
  if (pid === CAMARAS) return !(modelo.camaras || []).length;
  if (pid === ESCENAS) return !(modelo.escenas || []).length;
  if (pid === MUSICA) return !(modelo.musica && modelo.musica.bocinas && modelo.musica.bocinas.length);
  return !(modelo.cuartos || []).some((c) => c.id === pid);
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
    temperatura: 'Temperatura', soltarAplicar: 'Suelta para aplicar',
    modos: { cool: 'Frío', heat: 'Calor', dry: 'Seco', fan_only: 'Ventilador', auto: 'Auto', heat_cool: 'Auto' },
    vels: { auto: 'Auto', low: 'Baja', medium: 'Media', middle: 'Media', high: 'Alta', silent: 'Silencio', quiet: 'Silencio', turbo: 'Turbo', on: 'Encendido', off: 'Apagado', diffuse: 'Difuso', focus: 'Directo' },
    volumen: 'Volumen', silenciar: 'Silenciar', quitarSilencio: 'Quitar silencio', anterior: 'Anterior', siguiente: 'Siguiente', reproducirPausar: 'Reproducir o pausar',
    subir: 'Subir', detener: 'Detener', bajar: 'Bajar', posicion: 'Posición',
    bocinas: (n) => `${n} bocinas`, reproduciendoN: (n) => `${n} reproduciendo`, enPausa: 'en pausa', sinMusicaMin: 'sin música', sinConexionMin: 'sin conexión',
    audioCasa: 'Audio de la casa', audioDe: (c) => `Audio · ${c}`, abrirAudio: 'Abrir el audio', sinImagen: 'Sin imagen', tocaVivo: 'Toca para ver en vivo',
    ahoraSuena: 'Ahora suena', musPausa: 'En pausa', silenciado: 'Silenciado', zonas: (n) => `${n} zonas`, abrirMusica: 'Abrir Música', cerrarMusica: 'Cerrar controles de música', controlesMusica: 'Controles de música',
    sonandoEn: (g) => `Sonando en ${g}`, enPausaEn: (g) => `En pausa en ${g}`, listaEn: (g) => `Lista en ${g}`, eligeMusica: 'Elige algo de tu música', bocinasN: (n) => (n === 1 ? '1 bocina' : `${n} bocinas`),
    aleatorio: 'Aleatorio', repetir: 'Repetir', tuMusica: 'Tu música', secciones: { playlist: 'Playlists', album: 'Álbumes', radio: 'Radio', favoritos: 'Favoritos' }, tipoItem: { playlist: 'Playlist', album: 'Álbum', radio: 'Estación', track: 'Canción' },
    buscarMusica: 'Buscar en tu música', sinItems: 'No hay música en esta sección', cargando: 'Cargando…', errorBib: 'No se pudo leer tu música. Toca para reintentar.', verMas: 'Ver más',
    bocinasT: 'Bocinas', volGrupo: 'Volumen del grupo', volGrupoAyuda: 'Sube o baja todas las bocinas del grupo a la vez.', unir: 'Unir', enGrupo: 'En el grupo', principal: 'Principal del grupo', libre: 'Libre',
    unirA: (b) => `Unir ${b} al grupo`, sacarDe: (b) => `Sacar ${b} del grupo`, volDe: (b) => `Volumen de ${b}`, volPorBocina: 'Volumen por bocina', zonasT: 'Zonas', reproducirItem: (n) => `Reproducir ${n}`,
    limiteSpotify: (z) => `Spotify ya está sonando en ${z}. Una cuenta de Spotify pone una sola música a la vez.`, unirSonando: 'Unir a lo que suena', ponerAqui: 'Poner aquí',
    reintentando: 'Spotify estaba ocupado. Reintentando…', spotifyAtorado: 'Spotify sigue ocupado. Reinicia Music Assistant (Ajustes → Complementos) e intenta de nuevo.',
    silenciada: 'Silenciada', silenciarGrupo: 'Silenciar el grupo', quitarSilencioGrupo: 'Quitar el silencio del grupo', silenciarB: (b) => `Silenciar ${b}`, quitarSilencioB: (b) => `Quitar el silencio de ${b}`,
    tvTitulo: 'Bocina en la TV', tvTexto: (b) => `${b} está en la TV. Si la unes, se corta el audio de la TV.`, tvSi: 'Unir de todos modos', cancelar: 'Cancelar',
    verCanciones: (n) => `Ver las canciones de ${n}`, volverA: (s) => `Volver a ${s}`, nCanciones: (n) => (n === 1 ? '1 canción' : `${n} canciones`), reproducirTodo: 'Reproducir', reproducirDesde: (c) => `Reproducir desde ${c}`,
    sinCanciones: 'No hay canciones en esta lista', errorCanciones: 'No se pudieron leer las canciones. Toca para reintentar.', audioTV: 'Audio de la TV', audioTVDe: (b) => `Poner el audio de la TV en ${b}`,
    accesoAdmin: 'Acceso de administración', escribeClave: 'Escribe la clave', claveMal: 'Clave incorrecta', esperaClave: (n) => `Demasiados intentos. Espera ${n} s`,
    entrar: 'Entrar', borrar: 'Borrar', bloquear: 'Bloquear', bloquearEn: (t) => `Bloquear · ${t}`,
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
    temperatura: 'Temperature', soltarAplicar: 'Release to apply',
    modos: { cool: 'Cool', heat: 'Heat', dry: 'Dry', fan_only: 'Fan', auto: 'Auto', heat_cool: 'Auto' },
    vels: { auto: 'Auto', low: 'Low', medium: 'Medium', middle: 'Medium', high: 'High', silent: 'Quiet', quiet: 'Quiet', turbo: 'Turbo', on: 'On', off: 'Off', diffuse: 'Diffuse', focus: 'Focus' },
    volumen: 'Volume', silenciar: 'Mute', quitarSilencio: 'Unmute', anterior: 'Previous', siguiente: 'Next', reproducirPausar: 'Play or pause',
    subir: 'Up', detener: 'Stop', bajar: 'Down', posicion: 'Position',
    bocinas: (n) => `${n} speakers`, reproduciendoN: (n) => `${n} playing`, enPausa: 'paused', sinMusicaMin: 'no music', sinConexionMin: 'offline',
    audioCasa: 'Home audio', audioDe: (c) => `Audio · ${c}`, abrirAudio: 'Open audio', sinImagen: 'No image', tocaVivo: 'Tap to watch live',
    ahoraSuena: 'Now playing', musPausa: 'Paused', silenciado: 'Muted', zonas: (n) => `${n} zones`, abrirMusica: 'Open Music', cerrarMusica: 'Close music controls', controlesMusica: 'Music controls',
    sonandoEn: (g) => `Playing on ${g}`, enPausaEn: (g) => `Paused on ${g}`, listaEn: (g) => `Ready on ${g}`, eligeMusica: 'Pick something from your music', bocinasN: (n) => (n === 1 ? '1 speaker' : `${n} speakers`),
    aleatorio: 'Shuffle', repetir: 'Repeat', tuMusica: 'Your music', secciones: { playlist: 'Playlists', album: 'Albums', radio: 'Radio', favoritos: 'Favorites' }, tipoItem: { playlist: 'Playlist', album: 'Album', radio: 'Station', track: 'Song' },
    buscarMusica: 'Search your music', sinItems: 'No music in this section', cargando: 'Loading…', errorBib: 'Could not read your music. Tap to retry.', verMas: 'Show more',
    bocinasT: 'Speakers', volGrupo: 'Group volume', volGrupoAyuda: 'Turns every speaker in the group up or down at once.', unir: 'Join', enGrupo: 'In group', principal: 'Group leader', libre: 'Free',
    unirA: (b) => `Add ${b} to the group`, sacarDe: (b) => `Remove ${b} from the group`, volDe: (b) => `${b} volume`, volPorBocina: 'Volume per speaker', zonasT: 'Zones', reproducirItem: (n) => `Play ${n}`,
    limiteSpotify: (z) => `Spotify is already playing on ${z}. One Spotify account plays one thing at a time.`, unirSonando: 'Join what is playing', ponerAqui: 'Play here',
    reintentando: 'Spotify was busy. Retrying…', spotifyAtorado: 'Spotify is still busy. Restart Music Assistant (Settings → Add-ons) and try again.',
    silenciada: 'Muted', silenciarGrupo: 'Mute the group', quitarSilencioGrupo: 'Unmute the group', silenciarB: (b) => `Mute ${b}`, quitarSilencioB: (b) => `Unmute ${b}`,
    tvTitulo: 'Speaker on TV', tvTexto: (b) => `${b} is playing the TV. Joining it will cut the TV sound.`, tvSi: 'Join anyway', cancelar: 'Cancel',
    verCanciones: (n) => `See the songs in ${n}`, volverA: (s) => `Back to ${s}`, nCanciones: (n) => (n === 1 ? '1 song' : `${n} songs`), reproducirTodo: 'Play', reproducirDesde: (c) => `Play from ${c}`,
    sinCanciones: 'No songs in this list', errorCanciones: 'Could not read the songs. Tap to retry.', audioTV: 'TV audio', audioTVDe: (b) => `Switch ${b} to TV audio`,
    accesoAdmin: 'Admin access', escribeClave: 'Enter the code', claveMal: 'Wrong code', esperaClave: (n) => `Too many tries. Wait ${n} s`,
    entrar: 'Enter', borrar: 'Delete', bloquear: 'Lock', bloquearEn: (t) => `Lock · ${t}`,
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
  aleatorio: 'M16 3h5v5 M4 20 21 3 M21 16v5h-5 M15 15l6 6 M4 4l5 5',
  repetir: 'M17 1l4 4-4 4 M3 11V9a4 4 0 0 1 4-4h14 M7 23l-4-4 4-4 M21 13v2a4 4 0 0 1-4 4H3',
  repetirUno: 'M17 1l4 4-4 4 M3 11V9a4 4 0 0 1 4-4h14 M7 23l-4-4 4-4 M21 13v2a4 4 0 0 1-4 4H3 M11 10h1v4',
  buscar: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Z M20 20l-4-4',
  engrane: 'M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2Z M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z',
  candado: 'M7 11V7a5 5 0 0 1 9.9-1 M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2Z',
  borrar: 'M21 4H8l-7 8 7 8h13a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2Z M18 9l-6 6 M12 9l6 6',
  izquierda: 'M15 6l-6 6 6 6', tv: 'M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z M8 21h8 M12 17v4',
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
// PANEL-16: la temperatura ELEGIDA del aire siempre en grados enteros (24.5 → «25»).
const gradosEnteros = (v) => {
  const n = num(v);
  return n === null ? null : String(Math.round(n));
};
// PANEL-16: los grados enteros que el aire acepta: de min_temp hacia arriba y de max_temp hacia abajo
// (16.5–30.5 → 17–30). Sin rango, 16–30. null si no queda ni un grado.
function rangoGrados(a) {
  const mi = num(a?.min_temp);
  const ma = num(a?.max_temp);
  const min = mi !== null ? Math.ceil(mi - 1e-9) : 16;
  const max = ma !== null ? Math.floor(ma + 1e-9) : 30;
  return max >= min ? { min, max } : null;
}
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
  let lista = [...dispositivosEtiquetados(registro, etiqueta).dispositivos.filter((d) => !envuelto(d)), ...vents, ...rutinasEtiquetadas(registro, etiqueta, idioma)];
  // Accesos rápidos de Casa: lo que tenga la etiqueta de inicio (con o sin la del panel).
  let deInicio = etiquetaInicio ? [...dispositivosEtiquetados(registro, etiquetaInicio).dispositivos.filter((d) => !envuelto(d)), ...ventsInicio, ...rutinasEtiquetadas(registro, etiquetaInicio, idioma)] : [];
  // PANEL-08: las luces y persianas con la etiqueta de favoritos salen también sueltas en la fila del cuarto (PANEL-11: y los ventiladores).
  const favoritos = new Set(etiquetaFavorito ? [...dispositivosEtiquetados(registro, etiquetaFavorito).dispositivos, ...ventiladoresEtiquetados(registro, etiquetaFavorito)].map((d) => d.entidad) : []);
  const areaDe = (entidad) => {
    const e = ent.get(entidad);
    if (!e) return null;
    if (e.area_id) return e.area_id;
    const d = e.device_id ? apar.get(e.device_id) : null;
    return d?.area_id || null;
  };
  // PANEL-13: una bocina de Music Assistant y la misma Sonos por la integración nativa (mismo aparato, o mismo
  // nombre en la misma área) salen una sola vez: la de Music Assistant.
  const esMA = (entidad) => ent.get(entidad)?.platform === 'music_assistant' || typeof estados[entidad]?.attributes?.mass_player_type === 'string';
  const deMA = [...lista, ...deInicio].filter((d) => d.tipo === 'bocina' && esMA(d.entidad));
  if (deMA.length) {
    const nombreN = (d) => normal(d.nombre?.es || d.entidad);
    const aparatoDe = (entidad) => ent.get(entidad)?.device_id || null;
    const duplicada = (d) =>
      d.tipo === 'bocina' && !esMA(d.entidad) && deMA.some((m) => (aparatoDe(d.entidad) && aparatoDe(d.entidad) === aparatoDe(m.entidad)) || (nombreN(d) === nombreN(m) && areaDe(d.entidad) === areaDe(m.entidad)));
    lista = lista.filter((d) => !duplicada(d));
    deInicio = deInicio.filter((d) => !duplicada(d));
  }
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
  // PANEL-13: los cuartos en el orden en que Home Assistant da las áreas (el que se acomoda en Ajustes → Áreas).
  const cuartos = areas.filter((a) => porArea.has(a.area_id)).map((a) => cuarto(a.area_id, idioma === 'en' ? traducirNombre(a.name) || a.name : a.name, urlSegura(a.picture)));
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
  // PANEL-13: las bocinas de Music Assistant (pestaña Música y «Ahora suena»); la instancia sale de su registro.
  const bocinasMA = bocinas.filter((d) => esMA(d.entidad));
  const entrada = bocinasMA.map((d) => ent.get(d.entidad)?.config_entry_id).find((x) => typeof x === 'string' && x) || null;
  const musica = bocinasMA.length ? { bocinas: bocinasMA, entrada, areas: Object.fromEntries(bocinasMA.map((d) => [d.entidad, areaDe(d.entidad)])) } : null;
  return { cuartos, escenas, gruposEscenas, accesos, bocinas, aires, persianas, ventiladores, favoritos, camaras, musica, total };
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
      f.sub = gradosEnteros(est.temperatura) !== null ? `${verbo} ${T.a} ${gradosEnteros(est.temperatura)}°` : verbo;
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
      // PANEL-16: de grado entero en grado entero: 24.5 → 25 con +, → 24 con −.
      const actual = num(a.temperature);
      const dir = valor === '+' ? 1 : valor === '-' ? -1 : 0;
      const rg = rangoGrados(a);
      if (!c.temp || actual === null || !dir || !rg) return null;
      let g = dir > 0 ? Math.floor(actual + 1e-9) + 1 : Math.ceil(actual - 1e-9) - 1;
      g = Math.max(rg.min, Math.min(rg.max, g));
      return g === actual ? null : de('temperatura', { grados: g });
    }
    case 'grados': {
      // PANEL-16: el dial manda los grados exactos (enteros, dentro del rango del aire).
      const rg = rangoGrados(a);
      const g = typeof valor === 'number' ? valor : typeof valor === 'string' && /^-?\d{1,3}$/.test(valor) ? Number(valor) : NaN;
      if (!c.temp || !rg || !Number.isInteger(g) || g < rg.min || g > rg.max) return null;
      return g === num(a.temperature) ? null : de('temperatura', { grados: g });
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
.dial{width:min(250px,100%);margin:0 auto;--dial:#6FA8FF}
.dial-caja{position:relative}
.dial-svg{display:block;width:100%;height:auto;touch-action:none;cursor:grab;outline:none;-webkit-tap-highlight-color:transparent;-webkit-user-select:none;user-select:none}
.dial.arr .dial-svg{cursor:grabbing}
.dial-pista{fill:none;stroke:rgba(255,255,255,0.14);stroke-width:16;stroke-linecap:round}
.dial-svg:focus-visible .dial-pista{stroke:rgba(255,255,255,0.32)}
.dial-marcas{fill:none;stroke:rgba(255,255,255,0.30);stroke-width:2;stroke-linecap:round}
.dial-activo{fill:none;stroke:var(--dial);stroke-width:16;stroke-linecap:round}
.dial-ahora{fill:#FFFFFF;opacity:0.85}
.dial-perilla{fill:#FFFFFF;stroke:var(--dial);stroke-width:4}
.dial-cifra{position:absolute;top:0;left:0;right:0;bottom:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;pointer-events:none;text-align:center}
.dial-cifra .num{margin-bottom:6px;font-size:clamp(56px,8vw,76px);font-weight:300;letter-spacing:-0.05em;line-height:1;font-variant-numeric:tabular-nums}
.dial-sub{font-size:14px;line-height:1.3;color:rgba(255,255,255,0.84);max-width:62%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.seg{grid-template-columns:repeat(auto-fit,minmax(84px,1fr))}
.dial-ext{display:flex;justify-content:space-between;width:66%;margin:-26px auto 0;font-size:13px;color:rgba(255,255,255,0.72)}
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
.ahora{flex:none;display:flex;justify-content:center;position:relative;z-index:5}
.senal{position:relative;z-index:5;display:flex;align-items:center;gap:8px;height:36px;padding:0 14px 0 12px;border-radius:18px;color:#FFFFFF;cursor:pointer;font-size:13px;font-weight:500;max-width:min(320px,100%);-webkit-user-select:none;user-select:none}
.sn-tx{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ecual{display:flex;align-items:flex-end;gap:2px;height:12px;flex:none}
.ecual i{display:block;width:3px;height:6px;border-radius:1px;background:var(--vp-tinte)}
.ecual i:nth-child(2){height:10px}
.ecual i:nth-child(3){height:4px}
.ecual.sonando i{animation:vp-ecual 1s ease-in-out infinite}
.ecual.sonando i:nth-child(2){animation-delay:-.4s}
.ecual.sonando i:nth-child(3){animation-delay:-.7s}
.ecual.pausa i,.ecual.silencio i{background:rgba(255,255,255,0.6)}
@keyframes vp-ecual{0%,100%{height:3px}50%{height:12px}}
@media (prefers-reduced-motion: reduce){.ecual.sonando i{animation:none}}
.cerrar-fondo{position:fixed;top:0;left:0;right:0;bottom:0;background:transparent;border:0;padding:0;cursor:default;z-index:4}
.pop{position:absolute;top:46px;left:50%;transform:translateX(-50%);width:340px;max-width:calc(100vw - 32px);padding:16px;border-radius:24px;display:flex;flex-direction:column;gap:14px;z-index:6;background:rgba(30,32,36,0.62);color:#FFFFFF}
.pop-cab{display:flex;align-items:center;gap:12px}
.pop-tapa{flex:none;width:52px;height:52px;border-radius:14px;overflow:hidden;display:flex;align-items:center;justify-content:center;background:#E9C9A3;color:#111315}
.pop-tapa img,.mus-tapa img{width:100%;height:100%;object-fit:cover;display:block}
.pop-tapa svg,.mus-tapa svg,.pop-x svg,.pop-btn svg,.pop-play svg,.mus-ctl svg,.mus-play svg,.mus-buscar svg{stroke:currentColor}
.pop-tx{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1}
.pop-est{font-size:11px;font-weight:600;letter-spacing:0.14em;color:rgba(255,255,255,0.80);text-transform:uppercase}
.pop-tit{font-size:16px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pop-gr{font-size:13px;color:rgba(255,255,255,0.76);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pop-x{flex:none;width:44px;height:44px;border-radius:22px;border:0;background:transparent;color:#FFFFFF;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0}
.pop-ctl{display:flex;align-items:center;justify-content:center;gap:14px}
.pop-btn{flex:none;width:48px;height:48px;border-radius:24px;border:0;background:rgba(255,255,255,0.12);cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;color:#FFFFFF}
.pop-btn.on{background:rgba(255,255,255,0.30)}
.pop-play{flex:none;width:60px;height:60px;border-radius:30px;border:0;background:#FFFFFF;color:#111315;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0}
.pop-vol{display:flex;align-items:center;gap:10px}
.pop-vol .desl{flex:1;height:36px;border-radius:12px}
.pop-vol .desl i{border-radius:12px}
.pop-num{flex:none;width:48px;text-align:right;font-size:14px;color:rgba(255,255,255,0.82);font-variant-numeric:tabular-nums}
.pop-abrir{height:44px;border-radius:22px;cursor:pointer;font-size:14px;font-weight:500;color:#FFFFFF;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.22)}
.centro.mus{flex:1 0 auto;justify-content:flex-start;gap:16px}
.titulo.mus{font-size:clamp(40px,5.5vw,68px)}
.mus-zonas{display:flex;gap:8px;flex-wrap:wrap}
.mus-zona{height:40px;padding:0 16px;border-radius:20px;border:1px solid rgba(255,255,255,0.22);background:rgba(255,255,255,0.08);color:#FFFFFF;font-size:14px;font-weight:500;cursor:pointer;white-space:nowrap}
.mus-zona.sel{background:#FFFFFF;color:#111315;border-color:#FFFFFF}
.mus-cols{display:grid;grid-template-columns:minmax(0,1.6fr) minmax(300px,1fr);gap:16px;align-items:start}
.mus-izq{display:flex;flex-direction:column;gap:16px;min-width:0}
.mus-card{border-radius:24px;padding:20px;display:flex;flex-direction:column;gap:16px;min-width:0}
.mus-card.mus-ahora{display:grid;grid-template-columns:160px minmax(0,1fr);column-gap:20px;row-gap:14px;align-items:center}
.mus-ahora .mus-tapa{grid-row:1/3}
.mus-ahora .mus-info,.mus-ahora .mus-ctls{grid-column:2}
.mus-tapa{flex:none;width:160px;height:160px;border-radius:20px;overflow:hidden;display:flex;align-items:center;justify-content:center;background:#E9C9A3;color:#111315}
.mus-info{min-width:0;display:flex;flex-direction:column;gap:14px}
.mus-tit{font-size:26px;font-weight:600;letter-spacing:-0.02em;margin-top:8px;overflow-wrap:anywhere}
.mus-sub{font-size:15px;color:rgba(255,255,255,0.78);margin-top:4px}
.mus-barra{display:block;height:6px;border-radius:3px;background:rgba(255,255,255,0.18);overflow:hidden}
.mus-barra i{display:block;height:100%;border-radius:3px;background:var(--vp-tinte)}
.mus-t{display:flex;justify-content:space-between;font-size:13px;color:rgba(255,255,255,0.74);margin-top:6px;font-variant-numeric:tabular-nums}
.mus-ctls{display:flex;align-items:center;gap:14px;flex-wrap:wrap}
.mus-ctl{width:52px;height:52px;border-radius:26px;color:#FFFFFF;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;flex:none}
.mus-ctl.on{background:rgba(255,255,255,0.30);border-color:rgba(255,255,255,0.60)}
.mus-play{width:68px;height:68px;border-radius:34px;border:0;background:#FFFFFF;color:#111315;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;flex:none}
.mus-ctl[disabled],.mus-play[disabled],.mus-unir[disabled],.mus-item[disabled],.mus-mas[disabled]{opacity:0.35;cursor:default}
.mus-cab{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
.mus-pills{display:flex;gap:2px;padding:4px;border-radius:24px;background:rgba(255,255,255,0.08);overflow-x:auto;scrollbar-width:none;max-width:100%}
.mus-pills::-webkit-scrollbar,.mus-zonas::-webkit-scrollbar{display:none}
.mus-pill{flex:none;white-space:nowrap;height:40px;padding:0 16px;border-radius:20px;border:0;cursor:pointer;font-size:14px;font-weight:500;color:#FFFFFF;background:transparent}
.mus-pill.sel{color:#111315;background:#FFFFFF}
.mus-buscar{position:relative;color:rgba(255,255,255,0.80)}
.mus-buscar svg{position:absolute;left:16px;top:13px;pointer-events:none}
.mus-buscar input{width:100%;height:44px;border-radius:22px;padding:0 16px 0 44px;color:#FFFFFF;font-size:15px;font-family:inherit;outline:none;background:rgba(255,255,255,0.10);border:1px solid rgba(255,255,255,0.20)}
.mus-buscar input::placeholder{color:rgba(255,255,255,0.70)}
.mus-rejilla{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px}
.mus-item{display:flex;flex-direction:column;gap:8px;padding:10px;border-radius:18px;cursor:pointer;color:#FFFFFF;text-align:left;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.14);min-width:0}
.mus-it-tapa{display:block;width:100%;aspect-ratio:1/1;border-radius:12px;overflow:hidden;background:rgba(255,255,255,0.10)}
.mus-it-tapa img{width:100%;height:100%;object-fit:cover;display:block}
.mus-ini{display:flex;width:100%;height:100%;align-items:center;justify-content:center;font-size:32px;font-weight:600;color:#111315}
.mus-it-tx{display:flex;flex-direction:column;gap:2px;min-width:0}
.mus-it-nom{font-size:15px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mus-it-meta{font-size:13px;color:rgba(255,255,255,0.74);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mus-vacio{padding:18px;border-radius:18px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.14);color:rgba(255,255,255,0.82);font-size:15px;text-align:center;font-family:inherit}
button.mus-vacio{cursor:pointer;width:100%}
.mus-mas{align-self:center;height:44px;padding:0 22px;border-radius:22px;border:1px solid rgba(255,255,255,0.24);background:rgba(255,255,255,0.08);color:#FFFFFF;font-size:14px;font-weight:500;cursor:pointer}
.mus-vol{display:flex;flex-direction:column;gap:10px}
.mus-vt{font-size:17px;font-weight:600}
.mus-vn{font-size:15px;color:rgba(255,255,255,0.80);font-variant-numeric:tabular-nums}
.mus-desl{height:52px;border-radius:18px}
.mus-desl i{border-radius:18px}
.mus-desl.chico{height:40px;border-radius:14px}
.mus-desl.chico i{border-radius:14px}
.mus-desl input[disabled]{cursor:default}
.mus-ayuda{font-size:13px;color:rgba(255,255,255,0.74)}
.mus-sep{height:1px;background:rgba(255,255,255,0.16)}
.mus-boc{display:flex;flex-direction:column;gap:10px}
.mus-boc-cab{display:flex;align-items:center;justify-content:space-between;gap:12px}
.mus-boc-tx{min-width:0}
.mus-boc-nom{font-size:17px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mus-boc-est{font-size:14px;color:rgba(255,255,255,0.74);margin-top:2px}
.mus-boc:not(.dentro) .mus-desl i{background:rgba(255,255,255,0.35)}
.mus-boc.nodisp{opacity:0.55}
.mus-unir{flex:none;height:40px;padding:0 14px;border-radius:20px;cursor:pointer;font-size:14px;font-weight:500;color:#FFFFFF;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.22)}
.mus-unir.sel{background:rgba(255,255,255,0.30);border-color:rgba(255,255,255,0.55)}
.mus-vpb{display:none}
.mus-vd{display:flex;align-items:center;gap:10px}
.mus-bvol{display:flex;align-items:center;gap:10px}
.mus-bvol .desl{flex:1}
.mus-mute{flex:none;width:40px;height:40px;border-radius:20px;border:0;background:rgba(255,255,255,0.12);color:#FFFFFF;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0}
.mus-mute svg{stroke:currentColor}
.mus-mute.on{background:#FFFFFF;color:#111315}
.mus-mute[disabled]{opacity:0.35;cursor:default}
.mus-volver{align-self:flex-start;display:flex;align-items:center;gap:6px;height:40px;padding:0 16px 0 10px;border-radius:20px;border:1px solid rgba(255,255,255,0.22);background:rgba(255,255,255,0.08);color:#FFFFFF;font-size:14px;font-weight:500;cursor:pointer;font-family:inherit}
.mus-volver svg,.mus-det-bts svg,.mus-tv svg,.pop-tv svg,.boc-tv svg{stroke:currentColor}
.mus-det-cab{display:flex;align-items:flex-end;gap:18px;min-width:0}
.mus-det-tapa{flex:none;width:120px;height:120px;border-radius:18px;overflow:hidden;background:rgba(255,255,255,0.10)}
.mus-det-tapa img,.mus-can-tapa img{width:100%;height:100%;object-fit:cover;display:block}
.mus-det-tapa .mus-ini{font-size:40px}
.mus-det-tx{display:flex;flex-direction:column;gap:6px;min-width:0}
.mus-det-nom{font-size:26px;font-weight:600;letter-spacing:-0.02em;overflow-wrap:anywhere}
.mus-det-sub{font-size:15px;color:rgba(255,255,255,0.80)}
.mus-det-n{font-size:14px;color:rgba(255,255,255,0.76)}
.mus-det-bts{display:flex;gap:10px;flex-wrap:wrap}
.mus-det-play,.mus-det-alea{height:44px;padding:0 20px;border-radius:22px;display:flex;align-items:center;justify-content:center;gap:8px;font-size:15px;font-weight:500;cursor:pointer;font-family:inherit}
.mus-det-play{border:0;background:#FFFFFF;color:#111315}
.mus-det-alea{border:1px solid rgba(255,255,255,0.24);background:rgba(255,255,255,0.08);color:#FFFFFF}
.mus-lista{display:flex;flex-direction:column;gap:2px}
.mus-can{display:flex;align-items:center;gap:14px;min-height:56px;padding:6px 10px;border:0;border-radius:14px;background:transparent;color:#FFFFFF;text-align:left;cursor:pointer;font-family:inherit;min-width:0}
.mus-can.on{background:rgba(255,255,255,0.14)}
.mus-can-n{flex:none;width:28px;display:flex;justify-content:center;font-size:14px;color:rgba(255,255,255,0.74);font-variant-numeric:tabular-nums}
.mus-can-tapa{flex:none;width:44px;height:44px;border-radius:8px;overflow:hidden;background:rgba(255,255,255,0.10)}
.mus-can-tapa .mus-ini{font-size:16px}
.mus-can-tx{display:flex;flex-direction:column;gap:2px;min-width:0}
.mus-can-nom{font-size:16px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mus-can-art{font-size:13px;color:rgba(255,255,255,0.76);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mus-det-play[disabled],.mus-det-alea[disabled],.mus-can[disabled]{opacity:0.35;cursor:default}
.mus-tv,.boc-tv{height:44px;border-radius:14px;display:flex;align-items:center;justify-content:center;gap:10px;font-size:15px;font-weight:500;cursor:pointer;color:#FFFFFF;background:rgba(255,255,255,0.10);border:1px solid rgba(255,255,255,0.24);font-family:inherit}
.pop-pie{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
.pop-tv{height:44px;border-radius:22px;display:flex;align-items:center;justify-content:center;gap:8px;cursor:pointer;font-size:14px;font-weight:500;color:#FFFFFF;background:rgba(255,255,255,0.14);border:1px solid rgba(255,255,255,0.28);font-family:inherit}
.aviso.con-accion{display:flex;align-items:center;gap:12px;flex-wrap:wrap;justify-content:center;z-index:7}
.aviso button{flex:none;height:36px;padding:0 14px;border-radius:18px;border:0;background:#FFFFFF;color:#111315;font-size:14px;font-weight:600;cursor:pointer}
.hoja.confirmar{max-width:440px;gap:16px}
.hora-fila{display:flex;align-items:center;gap:10px}
.eng{width:34px;height:34px;border-radius:50%;padding:0;display:flex;align-items:center;justify-content:center;cursor:pointer;color:rgba(255,255,255,0.55)}
.eng svg,.candado svg,.tecla svg{stroke:currentColor}
.candado{display:flex;align-items:center;gap:8px;height:34px;padding:0 14px;border-radius:17px;cursor:pointer;color:#FFFFFF;font-size:14px;font-weight:500;font-variant-numeric:tabular-nums;white-space:nowrap}
.hoja.clave{max-width:360px;align-items:stretch;text-align:center}
.clave .pin{display:flex;gap:14px;justify-content:center;margin:2px 0;min-height:14px}
.clave .pin i{width:14px;height:14px;border-radius:50%;background:#FFFFFF}
.teclado{display:grid;grid-template-columns:repeat(3,72px);gap:12px;justify-content:center}
.tecla{height:72px;border-radius:50%;font-size:26px;color:#FFFFFF;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0}
.tecla[disabled],.clave .listo[disabled]{opacity:0.35;cursor:default}
.sub-hoja.alerta{color:#FFB4A8}
.clave.mal{animation:sacude .35s}
@keyframes sacude{0%,100%{translate:0}25%{translate:-8px}75%{translate:8px}}
.fondo-lateral,.lateral,.fondo-hoja,.hoja{z-index:8}
.aviso,.aviso.con-accion{z-index:9}
@media (max-width: 960px){.mus-cols{grid-template-columns:minmax(0,1fr)}}
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
:host([movil]) .dial{width:min(240px,100%)}
:host([movil]) .titulo.mus{font-size:36px}
:host([movil]) .ahora{justify-content:flex-start}
:host([movil]) .pop{left:0;transform:none;width:calc(100vw - 32px)}
:host([movil]) .mus-cols{grid-template-columns:minmax(0,1fr);gap:12px}
:host([movil]) .mus-card{padding:16px;border-radius:20px;gap:12px}
:host([movil]) .mus-card.mus-ahora{grid-template-columns:88px minmax(0,1fr);column-gap:14px;row-gap:12px}
:host([movil]) .mus-ahora .mus-tapa{grid-row:1;width:88px;height:88px;border-radius:14px}
:host([movil]) .mus-ahora .mus-ctls{grid-column:1/-1;justify-content:center}
:host([movil]) .mus-info{gap:10px}
:host([movil]) .mus-izq{display:contents}
:host([movil]) .mus-ahora{order:1}
:host([movil]) .mus-bocinas{order:2}
:host([movil]) .mus-bib{order:3}
:host([movil]) .mus-pills{width:100%}
:host([movil]) .mus-pill{flex:1 0 auto;padding:0 10px;font-size:13px}
:host([movil]) .mus-tit{font-size:18px;margin-top:4px}
:host([movil]) .mus-ctls{gap:8px}
:host([movil]) .mus-ctl{width:44px;height:44px}
:host([movil]) .mus-play{width:56px;height:56px}
:host([movil]) .mus-rejilla{grid-template-columns:minmax(0,1fr);gap:8px}
:host([movil]) .mus-item{flex-direction:row;align-items:center;padding:8px;gap:12px}
:host([movil]) .mus-det-tapa{width:88px;height:88px;border-radius:14px}
:host([movil]) .mus-det-nom{font-size:20px}
:host([movil]) .mus-det-bts > button{flex:1}
:host([movil]) .mus-can{gap:12px;padding:5px 6px}
:host([movil]) .mus-it-tapa{width:52px;height:52px;flex:none}
:host([movil]) .mus-ini{font-size:20px}
:host([movil]) .mus-vpb{display:block}
:host([movil]) .mus-bocinas:not(.abierto) .mus-boc .mus-bvol{display:none}
:host([movil]) .mus-zonas{flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none;margin-right:-16px;padding-right:16px}
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

// ------------------------------------------------------------------ PANEL-16: dial del aire
// Arco de 270° (de las 7:30 a las 4:30, en el sentido del reloj) dentro de un cuadro de 300×300.
const DIAL = Object.freeze({ lado: 300, radio: 124, inicio: 135, barrido: 270 });
const COLOR_DIAL = { cool: '#6FA8FF', heat: '#FFB45C', heat_cool: '#5FD3C4', auto: '#5FD3C4', dry: '#8FD3E8', fan_only: '#C9CED6' };
const dos = (x) => String(Math.round(x * 100) / 100);
function anguloDial(v, min, max) {
  const t = max > min ? (v - min) / (max - min) : 0;
  return DIAL.inicio + Math.max(0, Math.min(1, t)) * DIAL.barrido;
}
function puntoDial(angulo, r = DIAL.radio) {
  const a = (angulo * Math.PI) / 180;
  const c = DIAL.lado / 2;
  return [c + r * Math.cos(a), c + r * Math.sin(a)];
}
function arcoDial(a1, a2) {
  if (!(a2 - a1 > 0.01)) return '';
  const [x1, y1] = puntoDial(a1);
  const [x2, y2] = puntoDial(a2);
  return `M ${dos(x1)} ${dos(y1)} A ${DIAL.radio} ${DIAL.radio} 0 ${a2 - a1 > 180 ? 1 : 0} 1 ${dos(x2)} ${dos(y2)}`;
}
// Los grados (enteros) de un punto del cuadro del dial. En el centro (sobre el número) no hay: null, o
// `previo` si ya se está arrastrando. El hueco de abajo va al extremo más cercano, y mientras se arrastra no
// se brinca de un extremo al otro por el hueco (se queda en `previo`).
function gradosDeDial(x, y, min, max, previo = null) {
  const c = DIAL.lado / 2;
  if (!Number.isFinite(x) || !Number.isFinite(y) || Math.hypot(x - c, y - c) < DIAL.radio * 0.35) return previo;
  let ang = (Math.atan2(y - c, x - c) * 180) / Math.PI;
  if (ang < 0) ang += 360;
  let rel = ang - DIAL.inicio;
  if (rel < 0) rel += 360;
  if (rel > DIAL.barrido) rel = rel < (DIAL.barrido + 360) / 2 ? DIAL.barrido : 0;
  const v = Math.max(min, Math.min(max, Math.round(min + (rel / DIAL.barrido) * (max - min))));
  if (previo !== null && Math.abs(v - previo) > (max - min) / 2) return previo;
  return v;
}
// Las marcas de cada grado (de cada 2 si el rango pasa de 30): las pares, un poco más largas.
function marcasDial(min, max) {
  const salto = max - min > 30 ? 2 : 1;
  let d = '';
  for (let g = min; g <= max; g += salto) {
    const ang = anguloDial(g, min, max);
    const [x1, y1] = puntoDial(ang, DIAL.radio - (g % 2 === 0 ? 30 : 26));
    const [x2, y2] = puntoDial(ang, DIAL.radio - 18);
    d += `M ${dos(x1)} ${dos(y1)} L ${dos(x2)} ${dos(y2)} `;
  }
  return d.trim();
}
// El dial de la ventana del aire. `valor` = los grados que se muestran (los del dedo si está arrastrando).
function htmlDial({ valor, min, max, actual = null, modo = 'off', encendido = false, lineas = [], etiqueta = 'Temperatura', arrastrando = false }) {
  const v = Math.max(min, Math.min(max, Math.round(valor)));
  const ang = anguloDial(v, min, max);
  const [px, py] = puntoDial(ang);
  const color = encendido ? COLOR_DIAL[modo] || COLOR_DIAL.cool : 'rgba(255,255,255,0.38)';
  let ahora = '';
  if (num(actual) !== null) {
    const [ax, ay] = puntoDial(anguloDial(actual, min, max));
    ahora = `<circle class="dial-ahora" cx="${dos(ax)}" cy="${dos(ay)}" r="4"></circle>`;
  }
  return `<div class="dial${arrastrando ? ' arr' : ''}" style="--dial:${color}"><div class="dial-caja"><svg class="dial-svg" viewBox="0 0 ${DIAL.lado} ${DIAL.lado}" data-dial="1" role="slider" tabindex="0" aria-label="${esc(etiqueta)}" aria-valuemin="${min}" aria-valuemax="${max}" aria-valuenow="${v}" aria-valuetext="${v}°"><path class="dial-pista" d="${arcoDial(DIAL.inicio, DIAL.inicio + DIAL.barrido)}"></path><path class="dial-marcas" d="${marcasDial(min, max)}"></path><path class="dial-activo" d="${arcoDial(DIAL.inicio, ang)}"></path>${ahora}<circle class="dial-perilla" cx="${dos(px)}" cy="${dos(py)}" r="${arrastrando ? 16 : 13}"></circle></svg><div class="dial-cifra" aria-hidden="true"><div class="num">${v}°</div>${lineas.filter(Boolean).map((l) => `<div class="dial-sub">${esc(l)}</div>`).join('')}</div></div><div class="dial-ext" aria-hidden="true"><span>${min}°</span><span>${max}°</span></div></div>`;
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
    const rg = c.temp && num(a.temperature) !== null ? rangoGrados(a) : null;
    if (rg) {
      // PANEL-16: dial de grados enteros; mientras el dedo lo mueve manda `vista.arrastre` (control «grados»).
      const real = Math.max(rg.min, Math.min(rg.max, Math.round(a.temperature)));
      const v = valorDe('grados', real);
      const arrastrando = !!(arr && arr.control === 'grados' && arr.dedo);
      const verbo = T.climaVerbo[est.accion] || T.climaVerbo[est.modo] || T.espera;
      const estado = est.encendido ? `${verbo} ${T.a} ${v}°` : T.apagado;
      const lineas = arrastrando ? [T.soltarAplicar] : [estado, num(est.actual) !== null ? T.ahora(grados(est.actual)) : ''];
      cuerpo += htmlDial({ valor: v, min: rg.min, max: rg.max, actual: est.actual, modo: e.state, encendido: !!est.encendido, lineas, etiqueta: T.temperatura, arrastrando });
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
  // PANEL-17: «Audio de la TV» en una bocina con entrada de TV que está en otra cosa.
  const tvB = f.disponible && puedeAudioTV(e) ? `<button class="boc-tv" data-audio-tv="${ent}" aria-label="${esc(T.audioTVDe(f.nombre))}">${svg(ICONOS.tv, 18)}<span>${esc(T.audioTV)}</span></button>` : '';
  return `<div class="${clases.join(' ')}" data-bocina="${ent}"><div class="boc-cab"><span class="boc-ic">${icono(d.entidad, ICONOS.bocina, 22)}</span><span class="boc-tx"><span class="boc-nom">${esc(f.nombre)}</span><span class="boc-sub">${esc(sub)}</span></span></div>${ctl}${vol}${tvB}</div>`;
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
    cuerpo += `<div class="clm-temp">${boton('-', ICONOS.menos, T.bajarTemp)}<span class="clm-cifra"><span class="num">${esc(gradosEnteros(a.temperature))}°</span>${ahora}</span>${boton('+', ICONOS.mas, T.subirTemp)}</div>`;
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
  // PANEL-13: pestaña «Música» si hay bocinas de Music Assistant (PANEL-13b: justo después de Casa).
  const musica = modelo.musica && modelo.musica.bocinas && modelo.musica.bocinas.length ? modelo.musica : null;
  const enMusica = vista.pestana === MUSICA && !!musica;
  const cuartoSel = enCamaras || enEscenas || enMusica ? null : modelo.cuartos.find((c) => c.id === vista.pestana);
  const pestana = enCamaras ? CAMARAS : enEscenas ? ESCENAS : enMusica ? MUSICA : cuartoSel ? cuartoSel.id : CASA;
  // PANEL-13b: «Música» va justo después de Casa (antes de los cuartos).
  const tabs = [{ id: CASA, nombre: T.casa }, ...(musica ? [{ id: MUSICA, nombre: T.musica }] : []), ...modelo.cuartos.map((c) => ({ id: c.id, nombre: c.nombre })), ...(escenas.length ? [{ id: ESCENAS, nombre: T.escenas }] : []), ...(camaras.length ? [{ id: CAMARAS, nombre: T.camaras }] : [])]
    .map((t) => `<button class="tab${t.id === pestana ? ' activa' : ''}" data-tab="${esc(t.id)}"${t.id === pestana ? ' aria-current="page"' : ''}>${esc(t.nombre)}</button>`)
    .join('');
  const espera = vista.espera || new Set();
  const opc = (f) => ({ espera: espera.has(f.entidad), activada: vista.activada === f.entidad, idioma });
  const capas = capasFoto(cuartoSel ? cuartoSel.foto || fondo : fondo);
  const estiloFondo = capas.length ? ` style="background-image:${capas.map((u) => `url(&quot;${esc(u)}&quot;)`).join(', ')}"` : '';
  let centro;
  let abajo = '';
  let ahoraSuena = '';
  if (enMusica) {
    centro = htmlMusica(modelo, estados, idioma, vista, ahora.getTime());
  } else if (enCamaras) {
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
      else if (camaraConVideo(e) && !vista.sinReproductor) {
        // PANEL-15: con video, directo el reproductor de Home Assistant (no depende de la foto fija).
        medio = `<div class="vivo" data-vivo="${esc(sel.entidad)}" data-ajuste="cover"></div>`;
        vivo = true;
      } else if (!sinFoto.has(sel.entidad)) {
        medio = `<img src="${esc(urlCamara(e, true))}" alt="${esc(sel.nombre)}" data-foto="${esc(sel.entidad)}" data-mjpeg="1">`;
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
    // PANEL-13: las de Music Assistant ya no van en el chip (las maneja «Ahora suena» y la pestaña Música).
    const deMusica = new Set(musica ? musica.bocinas.map((d) => d.entidad) : []);
    const bocinas = (modelo.bocinas || []).filter((d) => !deMusica.has(d.entidad));
    if (bocinas.length) chips.push(htmlChipAudio(CASA, bocinas, estados, idioma, abierto('audio', CASA)));
    if (musica) {
      const el = elegirSonando(gruposMusica(musica.bocinas, estados), estados, { cuarto: vista.cuartoTablet || null, areas: musica.areas });
      if (el) ahoraSuena = htmlAhora(modelo, estados, idioma, vista, el);
    }
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
  // PANEL-13: el aviso del límite de Spotify trae un botón para unir a lo que suena.
  const aviso = vista.aviso ? (vista.avisoAccion === 'limite' ? `<div class="aviso con-accion" role="status"><span>${esc(vista.aviso)}</span><button data-unir-sonando="1">${esc(T.unirSonando)}</button><button data-poner-aqui="1">${esc(T.ponerAqui)}</button></div>` : `<div class="aviso" role="status">${esc(vista.aviso)}</div>`) : '';
  // PANEL-06/07: el panel lateral abierto (audio, aires o cámaras), solo en la pestaña de donde se abrió.
  let audio = '';
  const grupo = grupoLateral(modelo, vista.lateral);
  if (grupo && !enCamaras && !enEscenas && !enMusica && (grupo.id === CASA ? !cuartoSel : cuartoSel && cuartoSel.id === grupo.id)) {
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
  if (vista.confirmarTV && musica) ventana += htmlConfirmarTV(vista.confirmarTV, modelo, estados, idioma);
  // PANEL-14: en Casa, el engrane (o «Bloquear · m:ss») junto a la batería y la hoja de la clave.
  const enCasa = pestana === CASA;
  const bat = htmlBateria(vista.bateria, idioma);
  const filaHora = enCasa && vista.candado ? `<div class="hora-fila">${htmlCandado(vista.candado, idioma)}${bat}</div>` : bat;
  const clave = enCasa && vista.candado && !vista.candado.abierto && vista.clave ? htmlClave(vista.clave, idioma) : '';
  return `<div class="raiz"${estiloFondo}><div class="velo"></div><div class="sombra"></div><div class="capa"><div class="barra der"><div class="marca">${esc(marca)}</div><nav class="tabs vidrio" aria-label="${esc(T.cuartos)}">${tabs}</nav><div class="hora">${esc(hora)}${filaHora}</div></div>${ahoraSuena}<div class="centro der${enCamaras ? ' cams' : ''}${enMusica ? ' mus' : ''}">${centro}</div>${abajo}</div>${audio}${ventana}${clave}${aviso}</div>`;
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

// ------------------------------------------------------------------ PANEL-13: música (Music Assistant)

const LIMITE_BIB = 24;
const SECCIONES_BIB = ['playlist', 'album', 'radio', 'favoritos'];
const COLORES_TAPA = ['#E9C9A3', '#BFD8D2', '#D7C7E6', '#F1D58A', '#C9D7EE', '#E8B9A8'];
const vivoMus = (e) => !!e && !['unavailable', 'unknown'].includes(e.state);
const idsDe = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x) : []);

// Volumen de una bocina en % (o null si no lo da).
function volPct(e) {
  const v = num(e?.attributes?.volume_level);
  return v === null ? null : Math.round(Math.min(1, Math.max(0, v)) * 100);
}

// Las bocinas (de Music Assistant) en grupos, según `group_members`: el primero es el principal. Una bocina
// sola es su propio grupo; si el principal no tiene la etiqueta, el grupo es `externo`. `disponible` = su
// principal está disponible.
function gruposMusica(bocinas, estados) {
  const ids = new Set((bocinas || []).map((d) => d.entidad));
  const mapa = new Map();
  for (const d of bocinas || []) {
    const e = estados[d.entidad];
    const gm = vivoMus(e) ? idsDe(e.attributes?.group_members) : [];
    const principal = gm.length > 1 && gm.includes(d.entidad) ? gm[0] : d.entidad;
    if (!mapa.has(principal)) mapa.set(principal, { principal, miembros: [], externo: !ids.has(principal) });
    const g = mapa.get(principal);
    if (!g.miembros.includes(d.entidad)) g.miembros.push(d.entidad);
  }
  return [...mapa.values()].map((g) => ({ ...g, miembros: ids.has(g.principal) ? [g.principal, ...g.miembros.filter((x) => x !== g.principal)] : g.miembros, disponible: vivoMus(estados[g.principal]) }));
}

// Todas las bocinas de un grupo (principal primero, aunque no tenga la etiqueta).
const todasDelGrupo = (g) => [...new Set([g.principal, ...g.miembros])];

// { entidad: volumen % } de las que están disponibles y dan volumen.
function volumenesDe(ids, estados) {
  const salida = {};
  for (const x of ids || []) {
    const e = estados[x];
    const v = vivoMus(e) ? volPct(e) : null;
    if (v !== null) salida[x] = v;
  }
  return salida;
}

function maestroVolumen(vols) {
  const vals = Object.values(vols || {}).filter((v) => typeof v === 'number' && Number.isFinite(v));
  return vals.length ? Math.max(...vals) : 0;
}

// Volumen del grupo: el maestro es el más alto; al moverlo cada bocina queda en vol × nuevo / maestro
// (se respetan las proporciones). Con el maestro en 0 todas reciben el nuevo.
function volumenesGrupo(vols, nuevo) {
  const n = Math.max(0, Math.min(100, Math.round(Number(nuevo) || 0)));
  const maestro = maestroVolumen(vols);
  const salida = {};
  for (const [k, v] of Object.entries(vols || {})) {
    const actual = typeof v === 'number' && Number.isFinite(v) ? v : 0;
    salida[k] = maestro > 0 ? Math.max(0, Math.min(100, Math.round((actual * n) / maestro))) : n;
  }
  return salida;
}

// Las órdenes para llevar el volumen del grupo a `nuevo` (solo las bocinas que cambian).
function ordenesVolumenGrupo(grupo, estados, nuevo) {
  const vols = volumenesDe(todasDelGrupo(grupo), estados);
  const nuevos = volumenesGrupo(vols, nuevo);
  return Object.keys(vols)
    .filter((k) => nuevos[k] !== vols[k])
    .map((k) => ({ dominio: 'media_player', servicio: 'volume_set', datos: { entity_id: k, volume_level: nuevos[k] / 100 } }));
}

const ordenVolumen = (entidad, pct) => ({ dominio: 'media_player', servicio: 'volume_set', datos: { entity_id: entidad, volume_level: Math.max(0, Math.min(100, Math.round(Number(pct) || 0))) / 100 } });

// Qué grupo muestra «Ahora suena»: los que suenan (si no, los que están en pausa); primero el del cuarto de
// la tablet, luego el de más bocinas, luego el que cambió más reciente. `zonas` = cuántos compiten.
function elegirSonando(grupos, estados, { cuarto = null, areas = {} } = {}) {
  const de = (s) => (grupos || []).filter((g) => g.disponible && estados[g.principal]?.state === s);
  let cand = de('playing');
  if (!cand.length) cand = de('paused');
  if (!cand.length) return null;
  const enCuarto = (g) => (cuarto && areas[g.principal] === cuarto ? 1 : 0);
  const cuando = (g) => Date.parse(estados[g.principal]?.attributes?.media_position_updated_at || '') || 0;
  const orden = [...cand].sort((a, b) => enCuarto(b) - enCuarto(a) || b.miembros.length - a.miembros.length || cuando(b) - cuando(a));
  return { grupo: orden[0], zonas: cand.length };
}

// El grupo que se maneja en la pestaña Música: el elegido a mano, el que suena, el del cuarto de la tablet,
// el primero disponible o el primero.
function grupoSeleccionado(grupos, { sel = null, sonando = null, cuarto = null, areas = {} } = {}) {
  if (!grupos || !grupos.length) return null;
  return (
    grupos.find((g) => sel && g.principal === sel) ||
    (sonando && grupos.find((g) => g.principal === sonando.grupo.principal)) ||
    grupos.find((g) => cuarto && areas[g.principal] === cuarto) ||
    grupos.find((g) => g.disponible) ||
    grupos[0]
  );
}

// La señal chica de Casa: sonando (título), en pausa o silenciado; null si no hay nada que mostrar.
function senalMusica(grupo, estados, idioma = 'es') {
  const T = TXT[idioma];
  const e = grupo && estados[grupo.principal];
  if (!vivoMus(e) || !['playing', 'paused'].includes(e.state)) return null;
  const a = e.attributes || {};
  if (a.is_volume_muted === true) return { tipo: 'silencio', texto: T.silenciado };
  if (e.state === 'paused') return { tipo: 'pausa', texto: T.musPausa };
  return { tipo: 'sonando', texto: textoCorto(a.media_title, 32) || T.sonando };
}

// Portada de lo que suena: SOLO entity_picture_local (pasa por Home Assistant; sirve por el túnel https).
// entity_picture es http://IP:8095 de Music Assistant: no se usa.
function portadaMusica(e) {
  const u = e?.attributes?.entity_picture_local;
  return typeof u === 'string' && u.startsWith('/') ? urlSegura(u) : null;
}

// Portada de un elemento de la biblioteca. Si la página es https (túnel) y la imagen es http, no se pide
// (el navegador la bloquea): null → cuadro de color con la inicial.
function imagenBiblioteca(url, paginaHttps = false) {
  const s = urlSegura(url);
  if (!s) return null;
  if (paginaHttps && /^http:\/\//i.test(s)) return null;
  return s;
}

// Respuesta de music_assistant.get_library → [{ uri, nombre, imagen, tipo, sub }] (sin los que no tienen nombre).
function itemsBiblioteca(resp) {
  const items = Array.isArray(resp?.items) ? resp.items : [];
  return items
    .filter((i) => i && typeof i.uri === 'string' && i.uri && typeof i.name === 'string' && i.name.trim())
    .map((i) => ({
      uri: i.uri,
      nombre: i.name.trim(),
      imagen: typeof i.image === 'string' ? i.image : null,
      tipo: typeof i.media_type === 'string' ? i.media_type : '',
      sub: Array.isArray(i.artists) ? i.artists.map((x) => (x && typeof x.name === 'string' ? x.name : '')).filter(Boolean).join(', ') : '',
    }));
}

// Lo que se le pide a get_library para una sección (Favoritos = canciones favoritas).
function pedidoBiblioteca(entrada, seccion, offset = 0, busqueda = '') {
  const fav = seccion === 'favoritos';
  const datos = { config_entry_id: entrada, media_type: fav ? 'track' : seccion, limit: LIMITE_BIB, offset };
  if (fav) datos.favorite = true;
  const q = typeof busqueda === 'string' ? busqueda.trim() : '';
  if (q) datos.search = q;
  return datos;
}

const ordenReproducir = (principal, item) => ({ dominio: 'music_assistant', servicio: 'play_media', datos: { entity_id: principal, media_id: item.uri, media_type: item.tipo, enqueue: 'replace' } });
const ordenUnir = (principal, entidades) => ({ dominio: 'media_player', servicio: 'join', datos: { entity_id: principal, group_members: [].concat(entidades) } });
const ordenSeparar = (entidad) => ({ dominio: 'media_player', servicio: 'unjoin', datos: { entity_id: entidad } });

// Botones de lo que suena (al principal del grupo; silencio a todas las del grupo). null si no se puede.
function ordenMusica(accion, grupo, estados) {
  const e = grupo && estados[grupo.principal];
  if (!vivoMus(e)) return null;
  const a = e.attributes || {};
  const p = { entity_id: grupo.principal };
  if (accion === 'play') return { dominio: 'media_player', servicio: 'media_play_pause', datos: p };
  if (accion === 'anterior') return { dominio: 'media_player', servicio: 'media_previous_track', datos: p };
  if (accion === 'siguiente') return { dominio: 'media_player', servicio: 'media_next_track', datos: p };
  if (accion === 'aleatorio') return { dominio: 'media_player', servicio: 'shuffle_set', datos: { ...p, shuffle: a.shuffle !== true } };
  if (accion === 'repetir') return { dominio: 'media_player', servicio: 'repeat_set', datos: { ...p, repeat: a.repeat === 'all' ? 'one' : a.repeat === 'one' ? 'off' : 'all' } };
  if (accion === 'silencio') return { dominio: 'media_player', servicio: 'volume_mute', datos: { entity_id: todasDelGrupo(grupo), is_volume_muted: a.is_volume_muted !== true } };
  return null;
}

// Spotify (Music Assistant) da una sola transmisión por cuenta: ¿el error es ese?
// PANEL-13c: tres textos posibles (el del registro, el que llega a la tablet y el del motor Soloist).
const esLimiteSpotify = (err) => /concurrent|simultaneous|already playing|one thing at a time/i.test(String(err?.message || err?.error?.message || err || ''));
// PANEL-13c: cuánto se espera a que Spotify suelte la transmisión antes de reintentar.
const ESPERA_SPOTIFY = 2000;
// PANEL-13c: los OTROS grupos que de verdad están sonando (o en pausa) y por eso tienen la transmisión.
function gruposOtrosSonando(grupos, estados, principal) {
  return (grupos || []).filter((g) => g.disponible && g.principal !== principal && ['playing', 'paused'].includes(estados[g.principal]?.state));
}
const ordenDetener = (ids) => ({ dominio: 'media_player', servicio: 'media_stop', datos: { entity_id: [].concat(ids) } });
const ordenSilencioBocina = (entidad, estados) => ({ dominio: 'media_player', servicio: 'volume_mute', datos: { entity_id: entidad, is_volume_muted: estados[entidad]?.attributes?.is_volume_muted !== true } });
// La bocina está en la entrada de la TV (Arc/Beam/Ray).
const enTV = (e) => e?.attributes?.source === 'TV';

// PANEL-17: el detalle de una playlist o un álbum. Filas por página, tope de la cola y qué tipos abren detalle.
const POR_PAGINA_DET = 50;
const MAX_COLA = 250;
const TIPOS_DETALLE = ['playlist', 'album'];
// «Artista - Canción» → { cancion, artista }, partido en el PRIMER « - » (la canción puede traer más).
function partirTitulo(t) {
  const s = typeof t === 'string' ? t.trim() : '';
  const k = s.indexOf(' - ');
  if (k <= 0) return { cancion: s, artista: '' };
  const cancion = s.slice(k + 3).trim();
  return cancion ? { cancion, artista: s.slice(0, k).trim() } : { cancion: s, artista: '' };
}
// Respuesta de media_player/browse_media → [{ uri, cancion, artista, imagen }] (solo lo que se puede poner).
function cancionesDe(resp) {
  const hijos = Array.isArray(resp?.children) ? resp.children : [];
  return hijos
    .filter((c) => c && c.can_play !== false && c.can_expand !== true && typeof c.media_content_id === 'string' && c.media_content_id)
    .map((c) => ({ uri: c.media_content_id, ...partirTitulo(c.title), imagen: typeof c.thumbnail === 'string' ? c.thumbnail : null }))
    .filter((c) => c.cancion);
}
// Poner la lista desde la canción i hasta el final (como mucho MAX_COLA). null si i no existe.
function ordenDesde(principal, canciones, i) {
  const lista = Array.isArray(canciones) ? canciones : [];
  if (!principal || !Number.isInteger(i) || i < 0 || i >= lista.length) return null;
  return { dominio: 'music_assistant', servicio: 'play_media', datos: { entity_id: principal, media_id: lista.slice(i, i + MAX_COLA).map((c) => c.uri), media_type: 'track', enqueue: 'replace' } };
}
function barajar(lista, azar = Math.random) {
  const a = Array.isArray(lista) ? [...lista] : [];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(azar() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
const ordenAleatorio = (principal, on) => ({ dominio: 'media_player', servicio: 'shuffle_set', datos: { entity_id: principal, shuffle: on === true } });
// Cuál de las canciones suena (o está en pausa) en la bocina: por su uri; -1 si ninguna.
function cancionSonando(e, canciones) {
  if (!vivoMus(e) || !['playing', 'paused'].includes(e.state)) return -1;
  const id = e.attributes?.media_content_id;
  return typeof id === 'string' && id ? (Array.isArray(canciones) ? canciones : []).findIndex((c) => c.uri === id) : -1;
}
// PANEL-17: la bocina tiene entrada de TV y está en otra cosa → se ofrece «Audio de la TV».
function puedeAudioTV(e) {
  if (!vivoMus(e)) return false;
  const a = e.attributes || {};
  return Array.isArray(a.source_list) && a.source_list.includes('TV') && a.source !== 'TV';
}
const ordenAudioTV = (entidad) => ({ dominio: 'media_player', servicio: 'select_source', datos: { entity_id: entidad, source: 'TV' } });

// Avance de lo que suena { pos, dur } en segundos (se mueve en el navegador mientras suena).
function progresoMusica(e, ahora = Date.now()) {
  const a = e?.attributes || {};
  const dur = num(a.media_duration);
  if (!dur || dur <= 0) return null;
  let pos = num(a.media_position) ?? 0;
  const t = Date.parse(a.media_position_updated_at || '');
  if (e.state === 'playing' && Number.isFinite(t)) pos += Math.max(0, (ahora - t) / 1000);
  return { pos: Math.min(dur, Math.max(0, pos)), dur };
}
const tiempoMusica = (s) => {
  const n = Math.max(0, Math.floor(Number(s) || 0));
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
};

function nombreBocinaMus(entidad, musica, estados, idioma) {
  const d = (musica?.bocinas || []).find((x) => x.entidad === entidad);
  return d ? d.nombre?.[idioma] || d.nombre?.es || entidad : estados[entidad]?.attributes?.friendly_name || entidad;
}
// «Sala + Cocina»: las bocinas del grupo (con el principal aunque no tenga la etiqueta).
function etiquetaGrupo(grupo, musica, estados, idioma = 'es') {
  return todasDelGrupo(grupo)
    .filter((x) => x === grupo.principal || grupo.miembros.includes(x))
    .map((x) => nombreBocinaMus(x, musica, estados, idioma))
    .join(' + ');
}

// La señal «Ahora suena» de Casa y, abierto, su mini modal.
function htmlAhora(modelo, estados, idioma, vista, el) {
  const T = TXT[idioma];
  const g = el.grupo;
  const s = senalMusica(g, estados, idioma);
  if (!s) return '';
  const e = estados[g.principal];
  const a = e.attributes || {};
  const texto = el.zonas > 1 ? `${s.texto} · ${T.zonas(el.zonas)}` : s.texto;
  const abierto = !!vista.popMusica;
  const senal = `<button class="senal vidrio" data-senal="1" aria-expanded="${abierto ? 'true' : 'false'}" aria-label="${esc(`${T.ahoraSuena}: ${texto}`)}"><span class="ecual ${s.tipo}" aria-hidden="true"><i></i><i></i><i></i></span><span class="sn-tx">${esc(texto)}</span></button>`;
  if (!abierto) return `<div class="ahora der">${senal}</div>`;
  const p = esc(g.principal);
  const portada0 = portadaMusica(e);
  const portada = portada0 && !(vista.tapasMalas || new Set()).has(portada0) ? portada0 : null;
  const est = s.tipo === 'sonando' ? T.sonando : s.tipo === 'pausa' ? T.musPausa : T.silenciado;
  const maestro = maestroVolumen(volumenesDe(todasDelGrupo(g), estados));
  const arr = vista.arrMus && vista.arrMus.clave === `grupo:${g.principal}` ? vista.arrMus : null;
  const v = arr ? arr.valor : maestro;
  const mudo = a.is_volume_muted === true;
  const b = (accion, icono, etq) => `<button class="pop-btn" data-mus="${accion}" data-principal="${p}" aria-label="${esc(etq)}">${svg(icono, 18)}</button>`;
  // PANEL-17: con la bocina en la TV no hay anterior/play/siguiente; «Audio de la TV» si alguna del grupo puede.
  const tv = enTV(e);
  const tvEnt = todasDelGrupo(g).find((x) => puedeAudioTV(estados[x])) || null;
  const abrir = `<button class="pop-abrir" data-ir-musica="1">${esc(T.abrirMusica)}</button>`;
  const pie = tvEnt ? `<div class="pop-pie"><button class="pop-tv" data-audio-tv="${esc(tvEnt)}" aria-label="${esc(T.audioTVDe(nombreBocinaMus(tvEnt, modelo.musica, estados, idioma)))}">${svg(ICONOS.tv, 18)}<span>${esc(T.audioTV)}</span></button>${abrir}</div>` : abrir;
  const pop =
    `<div class="pop vidrio" role="dialog" aria-label="${esc(T.controlesMusica)}">` +
    `<div class="pop-cab"><span class="pop-tapa" aria-hidden="true">${tv ? svg(ICONOS.tv, 22) : portada ? `<img src="${esc(portada)}" alt="" data-tapa="${esc(portada)}">` : svg(ICONOS.musica, 22)}</span><span class="pop-tx"><span class="pop-est">${esc(est)}</span><span class="pop-tit">${esc(textoCorto(a.media_title, 48) || T.sonando)}</span><span class="pop-gr">${esc(etiquetaGrupo(g, modelo.musica, estados, idioma))}</span></span><button class="pop-x" data-pop-cerrar="1" aria-label="${esc(T.cerrar)}">${svg(ICONOS.cerrar, 18)}</button></div>` +
    (tv ? '' : `<div class="pop-ctl">${b('anterior', ICONOS.anterior, T.anterior)}<button class="pop-play" data-mus="play" data-principal="${p}" aria-label="${esc(T.reproducirPausar)}">${svg(e.state === 'playing' ? ICONOS.pausa : ICONOS.play, 22)}</button>${b('siguiente', ICONOS.siguiente, T.siguiente)}</div>`) +
    `<div class="pop-vol"><button class="pop-btn${mudo ? ' on' : ''}" data-mus="silencio" data-principal="${p}" aria-pressed="${mudo ? 'true' : 'false'}" aria-label="${esc(mudo ? T.quitarSilencio : T.silenciar)}">${svg(mudo ? ICONOS.silencio : ICONOS.sonido, 18)}</button><div class="desl"><i style="width:${v}%"></i><input type="range" min="0" max="100" step="1" value="${v}" data-mus-vol="grupo" data-principal="${p}" aria-label="${esc(T.volGrupo)}"></div><span class="pop-num">${esc(`${v} %`)}</span></div>` +
    `${pie}</div>`;
  return `<div class="ahora der"><button class="cerrar-fondo" data-pop-cerrar="1" tabindex="-1" aria-label="${esc(T.cerrarMusica)}"></button>${senal}${pop}</div>`;
}

// La pestaña Música: zonas (si hay más de un grupo), lo que suena, «Tu música» y «Bocinas».
function htmlMusica(modelo, estados, idioma, vista, ahoraMs) {
  const T = TXT[idioma];
  const m = modelo.musica;
  const grupos = gruposMusica(m.bocinas, estados);
  const el = elegirSonando(grupos, estados, { cuarto: vista.cuartoTablet || null, areas: m.areas });
  const g = grupoSeleccionado(grupos, { sel: vista.grupoMusica || null, sonando: el, cuarto: vista.cuartoTablet || null, areas: m.areas });
  const e = estados[g.principal];
  const vivo = g.disponible;
  const a = e?.attributes || {};
  const p = esc(g.principal);
  const etq = etiquetaGrupo(g, m, estados, idioma);
  const st = vivo ? e.state : 'unavailable';
  const cab0 = st === 'playing' ? T.sonandoEn(etq) : st === 'paused' ? T.enPausaEn(etq) : vivo ? T.listaEn(etq) : `${etq} · ${T.noDisp}`;
  const mudoG = vivo && a.is_volume_muted === true;
  const cab = mudoG ? `${cab0} · ${T.silenciado}` : cab0;
  const conMusica = vivo && (st === 'playing' || st === 'paused') && typeof a.media_title === 'string' && a.media_title.trim() !== '';
  const subt = conMusica ? [textoCorto(a.media_artist, 50), textoCorto(a.media_album_name, 50)].filter(Boolean).join(' · ') : '';
  const malas = vista.tapasMalas || new Set();
  const portada0 = conMusica ? portadaMusica(e) : null;
  const portada = portada0 && !malas.has(portada0) ? portada0 : null;
  const prog = conMusica ? progresoMusica(e, ahoraMs) : null;
  const barra = prog ? `<div class="mus-prog"><span class="mus-barra"><i style="width:${Math.round((prog.pos / prog.dur) * 1000) / 10}%"></i></span><span class="mus-t"><span>${tiempoMusica(prog.pos)}</span><span>${tiempoMusica(prog.dur)}</span></span></div>` : '';
  const dis = vivo ? '' : ' disabled';
  const ctl = (accion, icono, etiqueta, on = null) => `<button class="mus-ctl vidrio${on ? ' on' : ''}" data-mus="${accion}" data-principal="${p}" aria-label="${esc(etiqueta)}"${on === null ? '' : ` aria-pressed="${on ? 'true' : 'false'}"`}${dis}>${svg(icono, 22)}</button>`;
  const rep = a.repeat === 'all' || a.repeat === 'one';
  // PANEL-17: con la bocina en la TV no van los controles de música.
  const tvG = vivo && enTV(e);
  const controles = tvG ? '' : `<div class="mus-ctls">${ctl('aleatorio', ICONOS.aleatorio, T.aleatorio, a.shuffle === true)}${ctl('anterior', ICONOS.anterior, T.anterior)}<button class="mus-play" data-mus="play" data-principal="${p}" aria-label="${esc(T.reproducirPausar)}"${dis}>${svg(st === 'playing' ? ICONOS.pausa : ICONOS.play, 26)}</button>${ctl('siguiente', ICONOS.siguiente, T.siguiente)}${ctl('repetir', a.repeat === 'one' ? ICONOS.repetirUno : ICONOS.repetir, T.repetir, rep)}</div>`;
  const zonas =
    grupos.length > 1
      ? `<div class="mus-zonas" role="group" aria-label="${esc(T.zonasT)}">${grupos.map((x) => `<button class="mus-zona${x.principal === g.principal ? ' sel' : ''}" data-zona="${esc(x.principal)}" aria-pressed="${x.principal === g.principal ? 'true' : 'false'}">${esc(etiquetaGrupo(x, m, estados, idioma))}</button>`).join('')}</div>`
      : '';
  const ahora = `<div class="mus-card vidrio mus-ahora"><div class="mus-tapa" aria-hidden="true">${portada ? `<img src="${esc(portada)}" alt="" data-tapa="${esc(portada)}">` : svg(tvG ? ICONOS.tv : ICONOS.musica, 44)}</div><div class="mus-info"><div><span class="etiqueta">${esc(cab)}</span><div class="mus-tit">${esc(conMusica ? textoCorto(a.media_title, 60) : T.eligeMusica)}</div>${subt ? `<div class="mus-sub">${esc(subt)}</div>` : ''}</div>${barra}</div>${controles}</div>`;
  // «Tu música»
  const b = vista.bib || {};
  const seccion = SECCIONES_BIB.includes(b.seccion) ? b.seccion : 'playlist';
  const items = Array.isArray(b.items) ? b.items : [];
  const pills = SECCIONES_BIB.map((x) => `<button class="mus-pill${x === seccion ? ' sel' : ''}" data-bib-sec="${x}" aria-pressed="${x === seccion ? 'true' : 'false'}">${esc(T.secciones[x])}</button>`).join('');
  const buscar = `<div class="mus-buscar">${svg(ICONOS.buscar, 18)}<input type="search" data-bib-buscar="1" value="${esc(b.busqueda || '')}" placeholder="${esc(T.buscarMusica)}" aria-label="${esc(T.buscarMusica)}" autocomplete="off" enterkeyhint="search"></div>`;
  const tarjetas = items
    .map((it, i) => {
      const img0 = imagenBiblioteca(it.imagen, vista.https === true);
      const img = img0 && !malas.has(img0) ? img0 : null;
      const tapa = img ? `<img src="${esc(img)}" alt="" loading="lazy" data-tapa="${esc(img)}">` : `<span class="mus-ini" style="background:${COLORES_TAPA[i % COLORES_TAPA.length]}">${esc((Array.from(it.nombre)[0] || '').toLocaleUpperCase())}</span>`;
      const meta = it.sub || T.tipoItem[it.tipo] || '';
      return `<button class="mus-item" data-bib-item="${i}" aria-label="${esc(TIPOS_DETALLE.includes(it.tipo) ? T.verCanciones(it.nombre) : T.reproducirItem(it.nombre))}"${vivo && !vista.poniendo ? '' : ' disabled'}><span class="mus-it-tapa">${tapa}</span><span class="mus-it-tx"><span class="mus-it-nom">${esc(it.nombre)}</span><span class="mus-it-meta">${esc(meta)}</span></span></button>`;
    })
    .join('');
  let estado = '';
  if (b.error) estado = `<button class="mus-vacio" data-bib-reintentar="1">${esc(T.errorBib)}</button>`;
  else if (!items.length && b.cargando) estado = `<div class="mus-vacio">${esc(T.cargando)}</div>`;
  else if (!items.length && b.cargada) estado = `<div class="mus-vacio">${esc(T.sinItems)}</div>`;
  const mas = items.length && !b.fin && !b.error ? `<button class="mus-mas" data-bib-mas="1"${b.cargando ? ' disabled' : ''}>${esc(b.cargando ? T.cargando : T.verMas)}</button>` : '';
  // PANEL-17: con una playlist o un álbum abierto, su detalle va en el lugar de la cuadrícula.
  const bib = vista.detalle && vista.detalle.item ? htmlDetalle(vista.detalle, seccion, g, estados, idioma, vista, vivo) : `<div class="mus-card vidrio mus-bib"><div class="mus-cab"><span class="etiqueta">${esc(T.tuMusica)}</span><div class="mus-pills" role="group" aria-label="${esc(T.tuMusica)}">${pills}</div></div>${buscar}${tarjetas ? `<div class="mus-rejilla">${tarjetas}</div>` : ''}${estado}${mas}</div>`;
  // «Bocinas»
  const todos = todasDelGrupo(g);
  const arr = vista.arrMus || null;
  const maestro = maestroVolumen(volumenesDe(todos, estados));
  const vM = arr && arr.clave === `grupo:${g.principal}` ? arr.valor : maestro;
  const mudoBtn = `<button class="mus-mute${mudoG ? ' on' : ''}" data-mus="silencio" data-principal="${p}" aria-pressed="${mudoG ? 'true' : 'false'}" aria-label="${esc(mudoG ? T.quitarSilencioGrupo : T.silenciarGrupo)}"${dis}>${svg(mudoG ? ICONOS.silencio : ICONOS.sonido, 18)}</button>`;
  const master = `<div class="mus-vol"><div class="fila-et"><span class="mus-vt">${esc(T.volGrupo)}</span><span class="mus-vd"><span class="mus-vn">${esc(vivo ? (mudoG ? T.silenciado : `${vM} %`) : '–')}</span>${mudoBtn}</span></div><div class="desl mus-desl"><i style="width:${vivo ? vM : 0}%"></i><input type="range" min="0" max="100" step="1" value="${vM}" data-mus-vol="grupo" data-principal="${p}" aria-label="${esc(T.volGrupo)}"${dis}></div><div class="mus-ayuda">${esc(T.volGrupoAyuda)}</div></div>`;
  const filas = m.bocinas
    .map((d) => {
      const ent = d.entidad;
      const eb = estados[ent];
      const vivoB = vivoMus(eb);
      const dentro = todos.includes(ent);
      const principal = ent === g.principal && todos.length > 1;
      const v = vivoB ? volPct(eb) : null;
      const vb = arr && arr.clave === `boc:${ent}` ? arr.valor : v ?? 0;
      const nombre = d.nombre?.[idioma] || d.nombre?.es || ent;
      const mudoB = vivoB && eb.attributes?.is_volume_muted === true;
      const est = !vivoB ? T.noDisp : `${dentro ? (principal ? T.principal : T.enGrupo) : T.libre} · ${mudoB ? T.silenciada : v === null ? '–' : `${v} %`}`;
      const boton = dentro
        ? `<button class="mus-unir sel" data-separar="${esc(ent)}" aria-pressed="true" aria-label="${esc(T.sacarDe(nombre))}"${!vivoB || todos.length <= 1 ? ' disabled' : ''}>${esc(T.enGrupo)}</button>`
        : `<button class="mus-unir" data-unir="${esc(ent)}" data-principal="${p}" aria-pressed="false" aria-label="${esc(T.unirA(nombre))}"${!vivoB || !vivo ? ' disabled' : ''}>${esc(T.unir)}</button>`;
      const mute = `<button class="mus-mute${mudoB ? ' on' : ''}" data-mus-mute="${esc(ent)}" aria-pressed="${mudoB ? 'true' : 'false'}" aria-label="${esc(mudoB ? T.quitarSilencioB(nombre) : T.silenciarB(nombre))}"${vivoB ? '' : ' disabled'}>${svg(mudoB ? ICONOS.silencio : ICONOS.sonido, 18)}</button>`;
      const desl = `<div class="mus-bvol">${mute}<div class="desl mus-desl chico"><i style="width:${vivoB && v !== null ? vb : 0}%"></i><input type="range" min="0" max="100" step="1" value="${vb}" data-mus-vol="bocina" data-entidad="${esc(ent)}" aria-label="${esc(T.volDe(nombre))}"${vivoB && v !== null ? '' : ' disabled'}></div></div>`;
      const tvB = puedeAudioTV(eb) ? `<button class="mus-tv" data-audio-tv="${esc(ent)}" aria-label="${esc(T.audioTVDe(nombre))}">${svg(ICONOS.tv, 18)}<span>${esc(T.audioTV)}</span></button>` : '';
      return `<div class="mus-boc${dentro ? ' dentro' : ''}${vivoB ? '' : ' nodisp'}"><div class="mus-boc-cab"><div class="mus-boc-tx"><div class="mus-boc-nom">${esc(nombre)}</div><div class="mus-boc-est">${esc(est)}</div></div>${boton}</div>${desl}${tvB}</div>`;
    })
    .join('');
  const bocinas = `<div class="mus-card vidrio mus-bocinas${vista.volPorBocina ? ' abierto' : ''}"><div class="mus-cab"><span class="etiqueta">${esc(T.bocinasT)}</span><button class="mus-pill mus-vpb" data-vol-por-bocina="1" aria-pressed="${vista.volPorBocina ? 'true' : 'false'}">${esc(T.volPorBocina)}</button></div>${master}<div class="mus-sep"></div>${filas}</div>`;
  return `<div><div class="sobre">${esc(T.bocinasN(m.bocinas.length).toLocaleUpperCase(idioma === 'en' ? 'en' : 'es'))}</div><div class="titulo mus">${esc(T.musica)}</div></div>${zonas}<div class="mus-cols"><div class="mus-izq">${ahora}${bib}</div>${bocinas}</div>`;
}

// PANEL-17: el detalle de una playlist o un álbum (sus canciones) en lugar de la cuadrícula de «Tu música».
function htmlDetalle(det, seccion, g, estados, idioma, vista, vivo) {
  const T = TXT[idioma];
  const it = det.item || {};
  const malas = vista.tapasMalas || new Set();
  const https = vista.https === true;
  const ini = (s) => esc((Array.from(String(s || ''))[0] || '').toLocaleUpperCase());
  const img0 = imagenBiblioteca(it.imagen, https);
  const img = img0 && !malas.has(img0) ? img0 : null;
  const tapa = img ? `<img src="${esc(img)}" alt="" data-tapa="${esc(img)}">` : `<span class="mus-ini" style="background:${COLORES_TAPA[(Number(det.idx) || 0) % COLORES_TAPA.length]}">${ini(it.nombre)}</span>`;
  const canciones = Array.isArray(det.canciones) ? det.canciones : [];
  const n = canciones.length;
  const lista = !det.cargando && !det.error;
  const puede = vivo && !vista.poniendo;
  const eb = estados[g.principal];
  const actual = cancionSonando(eb, canciones);
  const tipoEt = (T.tipoItem[it.tipo] || '').toLocaleUpperCase(idioma === 'en' ? 'en' : 'es');
  const volver = `<button class="mus-volver" data-det-volver="1" aria-label="${esc(T.volverA(T.secciones[seccion]))}">${svg(ICONOS.izquierda, 18)}<span>${esc(T.secciones[seccion])}</span></button>`;
  const cab = `<div class="mus-det-cab"><span class="mus-det-tapa" aria-hidden="true">${tapa}</span><span class="mus-det-tx"><span class="etiqueta">${esc(tipoEt)}</span><span class="mus-det-nom">${esc(it.nombre || '')}</span>${it.sub ? `<span class="mus-det-sub">${esc(it.sub)}</span>` : ''}${lista ? `<span class="mus-det-n">${esc(T.nCanciones(n))}</span>` : ''}</span></div>`;
  const dis = puede ? '' : ' disabled';
  const bts = lista && n ? `<div class="mus-det-bts"><button class="mus-det-play" data-det-todo="1"${dis}>${svg(ICONOS.play, 16)}<span>${esc(T.reproducirTodo)}</span></button><button class="mus-det-alea" data-det-alea="1"${dis}>${svg(ICONOS.aleatorio, 18)}<span>${esc(T.aleatorio)}</span></button></div>` : '';
  const mostrar = Math.max(POR_PAGINA_DET, Number(det.mostrar) || POR_PAGINA_DET);
  const filas = lista
    ? canciones
        .slice(0, mostrar)
        .map((c, i) => {
          const on = i === actual;
          const marca = on ? `<span class="ecual ${eb.state === 'playing' ? 'sonando' : 'pausa'}" aria-hidden="true"><i></i><i></i><i></i></span>` : String(i + 1);
          const im0 = imagenBiblioteca(c.imagen, https);
          const im = im0 && !malas.has(im0) ? im0 : null;
          const t = im ? `<img src="${esc(im)}" alt="" loading="lazy" data-tapa="${esc(im)}">` : `<span class="mus-ini" style="background:${COLORES_TAPA[i % COLORES_TAPA.length]}">${ini(c.cancion)}</span>`;
          return `<button class="mus-can${on ? ' on' : ''}" data-det-can="${i}" aria-label="${esc(T.reproducirDesde(c.cancion))}"${on ? ' aria-current="true"' : ''}${dis}><span class="mus-can-n">${marca}</span><span class="mus-can-tapa" aria-hidden="true">${t}</span><span class="mus-can-tx"><span class="mus-can-nom">${esc(c.cancion)}</span>${c.artista ? `<span class="mus-can-art">${esc(c.artista)}</span>` : ''}</span></button>`;
        })
        .join('')
    : '';
  let estado = '';
  if (det.error) estado = `<button class="mus-vacio" data-det-reintentar="1">${esc(T.errorCanciones)}</button>`;
  else if (det.cargando) estado = `<div class="mus-vacio">${esc(T.cargando)}</div>`;
  else if (!n) estado = `<div class="mus-vacio">${esc(T.sinCanciones)}</div>`;
  const mas = lista && n > mostrar ? `<button class="mus-mas" data-det-mas="1">${esc(T.verMas)}</button>` : '';
  return `<div class="mus-card vidrio mus-bib mus-det">${volver}${cab}${bts}${filas ? `<div class="mus-lista">${filas}</div>` : ''}${estado}${mas}</div>`;
}

// La pregunta antes de unir una bocina que está en la TV.
function htmlConfirmarTV(c, modelo, estados, idioma) {
  const T = TXT[idioma];
  const nombre = nombreBocinaMus(c.entidad, modelo.musica, estados, idioma);
  return `<div class="fondo-hoja" data-tv-no="1"></div><div class="hoja confirmar" tabindex="-1" role="dialog" aria-modal="true" aria-label="${esc(T.tvTitulo)}"><div class="tit-hoja">${esc(T.tvTitulo)}</div><div class="sub-hoja">${esc(T.tvTexto(nombre))}</div><div class="pie-hoja"><button class="vidrio" data-tv-no="1">${esc(T.cancelar)}</button><button class="listo" data-tv-si="1">${esc(T.tvSi)}</button></div></div>`;
}

// PANEL-14: el engrane (candado cerrado) o la pastilla «Bloquear · m:ss» (abierto).
function htmlCandado(c, idioma) {
  const T = TXT[idioma];
  return c.abierto
    ? `<button class="candado vidrio" data-candado="bloquear" aria-label="${esc(T.bloquear)}">${svg(ICONOS.candado, 16)}<span>${esc(T.bloquearEn(c.restante))}</span></button>`
    : `<button class="eng vidrio" data-candado="abrir" aria-label="${esc(T.accesoAdmin)}">${svg(ICONOS.engrane, 18)}</button>`;
}

// PANEL-14: la hoja de la clave. Nunca lleva la clave: solo cuántos dígitos van (puntos).
function htmlClave(c, idioma) {
  const T = TXT[idioma];
  const n = Math.max(0, Math.min(CLAVE_MAX, Number(c.n) || 0));
  // PANEL-14b: un punto por dígito escrito; sin círculos vacíos (no revela el largo ni sugiere uno).
  const puntos = '<i></i>'.repeat(n);
  const espera = Number(c.espera) > 0;
  const sub = espera ? T.esperaClave(c.espera) : c.mal ? T.claveMal : T.escribeClave;
  const dis = espera ? ' disabled' : '';
  const teclas = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'borrar']
    .map((k) => (k === '' ? '<span></span>' : k === 'borrar' ? `<button class="tecla vidrio" data-tecla="borrar" aria-label="${esc(T.borrar)}"${dis}>${svg(ICONOS.borrar, 24)}</button>` : `<button class="tecla vidrio" data-tecla="${k}"${dis}>${k}</button>`))
    .join('');
  return `<div class="fondo-hoja" data-clave="cancelar"></div><div class="hoja confirmar clave${c.mal ? ' mal' : ''}" tabindex="-1" role="dialog" aria-modal="true" aria-label="${esc(T.accesoAdmin)}"><div class="tit-hoja">${esc(T.accesoAdmin)}</div><div class="sub-hoja${c.mal || espera ? ' alerta' : ''}" aria-live="polite">${esc(sub)}</div><div class="pin" aria-hidden="true">${puntos}</div><div class="teclado">${teclas}</div><div class="pie-hoja"><button class="vidrio" data-clave="cancelar">${esc(T.cancelar)}</button><button class="listo" data-clave="entrar"${espera || n < CLAVE_MIN ? ' disabled' : ''}>${esc(T.entrar)}</button></div></div>`;
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
      this._dial = null; // PANEL-16: el dedo que mueve el dial del aire ({ id, entidad }) y la espera del teclado.
      this._tDial = null;
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
      // PANEL-13: música. Mini modal de Casa, grupo elegido en la pestaña, biblioteca, volumen arrastrado,
      // la pregunta de la TV y el aviso con botón.
      this._popMusica = false;
      this._grupoMusica = null;
      this._bib = { seccion: 'playlist', busqueda: '', items: [], cargando: false, error: false, fin: false, cargada: false, pedido: 0 };
      this._arrMus = null;
      this._confirmarTV = null;
      this._avisoAccion = null;
      this._volPorBocina = false;
      this._tapasMalas = new Set();
      // PANEL-17: el detalle abierto de una playlist o un álbum ({ item, idx, canciones, cargando, error, mostrar,
      // pedido }) y dónde estaba el desplazamiento de la pestaña al abrirlo.
      this._detalle = null;
      this._scrollBib = 0;
      // PANEL-15: el MJPEG de la vista grande que se está vigilando ({ src }) y cuánto se le espera.
      this._vigilada = null;
      this._esperaFoto = ESPERA_FOTO_MS;
      // PANEL-13c: la música que espera «Poner aquí», si se está poniendo y cuánto esperar a Spotify.
      this._pendiente = null;
      this._poniendo = false;
      this._esperaSpotify = ESPERA_SPOTIFY;
      // PANEL-14: la hoja de la clave abierta ({ pin, mal }) o null. La clave escrita solo vive aquí.
      this._clave = null;
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
      // PANEL-16: el dial del aire (dedo o ratón) y sus flechas del teclado.
      r.addEventListener('pointerdown', (ev) => this._dialInicio(ev));
      r.addEventListener('pointermove', (ev) => this._dialMover(ev));
      r.addEventListener('pointerup', (ev) => this._dialFin(ev, true));
      r.addEventListener('pointercancel', (ev) => this._dialFin(ev, false));
      r.addEventListener('lostpointercapture', (ev) => this._dialFin(ev, true));
      r.addEventListener('keydown', (ev) => this._dialTecla(ev));
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
        // PANEL-13: volumen de música (grupo o bocina) y la búsqueda de «Tu música».
        if (i.matches && i.matches('input[data-mus-vol]')) {
          this._volMusica(i, false);
          return;
        }
        if (i.matches && i.matches('input[data-bib-buscar]')) {
          this._buscarBib(i.value);
          return;
        }
        const entidad = i.matches && i.matches('input[data-control]') ? i.dataset.entidad || this._ventana : null;
        if (!entidad) return;
        this._arrastre = { entidad, control: i.dataset.control, valor: Number(i.value), hasta: Date.now() + 60000 };
        this._render();
      });
      r.addEventListener('change', (ev) => {
        const i = ev.target;
        if (i.matches && i.matches('input[data-mus-vol]')) {
          this._volMusica(i, true);
          return;
        }
        if (i.matches && i.matches('input[data-bib-buscar]')) return;
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
          // PANEL-13: una portada de música que no carga se cambia por el cuadro de color (o la nota).
          if (img && img.localName === 'img' && img.dataset && img.dataset.tapa) {
            if (!this._tapasMalas.has(img.dataset.tapa)) {
              this._tapasMalas.add(img.dataset.tapa);
              this._render();
            }
            return;
          }
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
        if (this._confirmarTV) {
          this._confirmarTV = null;
          this._render();
        } else if (this._popMusica) {
          this._popMusica = false;
          this._render();
        } else if (enPantallaCompleta(this.shadowRoot)) salirDePantallaCompleta();
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
        clave: claveAdminValida(cfg.clave_admin),
      };
      if (cfg.clave_admin != null && cfg.clave_admin !== '' && !this._cfg.clave) console.warn('[vizions-panel] clave_admin no es válida (deben ser 64 caracteres hex): no hay acceso de administración');
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
      // PANEL-14: la cuenta de «Bloquear · m:ss» y la espera de la clave, cada segundo.
      this._tCandado = setInterval(() => this._tickCandado(), 1000);
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
      clearInterval(this._tCandado);
      document.removeEventListener('fullscreenchange', this._alPantalla);
      this._vivos.clear();
      clearTimeout(this._tRecarga);
      clearTimeout(this._tKiosko);
      clearTimeout(this._tBuscar);
      clearTimeout(this._tFoto);
      this._vigilada = null;
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
      // PANEL-14: con el candado abierto (clave correcta, 10 min) el kiosko se suspende.
      const quiere = this._pideKiosko() && !candadoAbierto();
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

    // ¿Este usuario y esta dirección piden kiosko? (sin contar el candado)
    _pideKiosko() {
      let busqueda = '';
      try {
        busqueda = window.location.search;
      } catch {
        busqueda = '';
      }
      return quiereKiosko({ esAdmin: !!(this._hass && this._hass.user && this._hass.user.is_admin), config: this._cfg.kiosko, busqueda });
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
      // PANEL-13: el volumen de música que el dedo dejó, la pestaña Música (carga la biblioteca la primera vez)
      // y el mini modal (se cierra solo si ya no hay nada sonando o se salió de Casa).
      if (this._arrMus && Date.now() > this._arrMus.hasta) this._arrMus = null;
      const mus = this._musicaActual();
      if (!mus) this._confirmarTV = null;
      if (!mus) this._detalle = null;
      if (this._popMusica && (!mus || !mus.sonando || !senalMusica(mus.sonando.grupo, this._hass.states, idioma))) this._popMusica = false;
      if (mus && this._pestana === MUSICA && !this._bib.cargada) Promise.resolve().then(() => this._cargarBib(true));
      if (this._camara && !(this._modeloActual.camaras || []).some((c) => c.entidad === this._camara)) this._camara = null;
      // PANEL-06/07: si el panel lateral ya no tiene nada (les quitaron la etiqueta), se cierra.
      if (this._lateral && !grupoLateral(this._modeloActual, this._lateral)) this._lateral = null;
      const ahora = Date.now();
      for (const [ent, hasta] of this._sinFoto) if (hasta <= ahora) this._sinFoto.delete(ent);
      // PANEL-14: la hoja de la clave solo vive en Casa (y con candado).
      if (this._clave && (!this._vistaCandado() || !esCasa(this._modeloActual, this._pestana))) this._clave = null;
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
              popMusica: this._popMusica,
              grupoMusica: this._grupoMusica,
              bib: this._bib,
              detalle: this._detalle,
              arrMus: this._arrMus,
              confirmarTV: this._confirmarTV,
              avisoAccion: this._avisoAccion && this._avisoAccion.texto === this._aviso ? this._avisoAccion.accion : null,
              volPorBocina: this._volPorBocina,
              tapasMalas: this._tapasMalas,
              poniendo: this._poniendo,
              cuartoTablet: mus ? mus.cuarto : null,
              https: typeof location !== 'undefined' && location.protocol === 'https:',
              candado: this._vistaCandado(),
              clave: this._vistaClave(),
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
      this._vigilarMjpeg();
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
      if (this._pestana === id && !this._lateral && !this._ventana && !this._camara && !this._popMusica && !this._confirmarTV) return;
      this._pestana = id;
      this._popMusica = false;
      this._confirmarTV = null;
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

    // PANEL-15: el MJPEG de la vista grande puede quedarse abierto sin mandar nada y sin error (Generic sin
    // foto fija). Si en _esperaFoto no hay imagen (naturalWidth 0), se marca «sin foto». Una dirección nueva
    // (el token cambia cada pocos minutos) vuelve a empezar la cuenta; redibujar con la misma, no.
    _vigilarMjpeg() {
      const img = this.shadowRoot ? this.shadowRoot.querySelector('img[data-mjpeg][data-foto]') : null;
      if (!img) {
        clearTimeout(this._tFoto);
        this._vigilada = null;
        return;
      }
      const src = img.getAttribute('src');
      if (this._vigilada && this._vigilada.src === src) return;
      clearTimeout(this._tFoto);
      this._vigilada = { src };
      this._tFoto = setTimeout(() => {
        const ahora = this.shadowRoot ? this.shadowRoot.querySelector('img[data-mjpeg][data-foto]') : null;
        if (!ahora || ahora.naturalWidth > 0) return;
        if (this._marcarSinFoto(ahora.dataset.foto)) this._render();
      }, this._esperaFoto);
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
      this._dial = null;
      this._render();
    }

    // PANEL-16: el aire de la ventana abierta y sus grados (rango entero y los de HA redondeados), o null.
    _dialCtx() {
      const d = this._ventana && this._hass ? this._dispositivo(this._ventana) : null;
      const e = d && d.tipo === 'clima' ? this._hass.states[d.entidad] : null;
      const rg = e ? rangoGrados(e.attributes) : null;
      const t = e ? num(e.attributes?.temperature) : null;
      if (!rg || t === null) return null;
      return { entidad: d.entidad, rg, real: Math.max(rg.min, Math.min(rg.max, Math.round(t))) };
    }

    _dialGrados(ev, ctx, previo) {
      const svgDial = this.shadowRoot.querySelector('[data-dial]');
      const b = svgDial && svgDial.getBoundingClientRect();
      if (!b || !b.width || !b.height) return previo;
      return gradosDeDial(((ev.clientX - b.left) / b.width) * DIAL.lado, ((ev.clientY - b.top) / b.height) * DIAL.lado, ctx.rg.min, ctx.rg.max, previo);
    }

    _dialInicio(ev) {
      const svgDial = ev.target && ev.target.closest ? ev.target.closest('[data-dial]') : null;
      if (!svgDial || ev.button > 0 || this._dial) return;
      const ctx = this._dialCtx();
      if (!ctx) return;
      const v = this._dialGrados(ev, ctx, null);
      if (v === null) return;
      ev.preventDefault();
      try {
        svgDial.setPointerCapture(ev.pointerId);
      } catch {
        /* sin captura: igual sigue con los eventos de la tarjeta */
      }
      clearTimeout(this._tDial);
      this._tDial = null;
      this._dial = { id: ev.pointerId, entidad: ctx.entidad };
      this._arrastre = { entidad: ctx.entidad, control: 'grados', valor: v, dedo: true, hasta: Date.now() + 60000 };
      this._render();
    }

    _dialMover(ev) {
      if (!this._dial || ev.pointerId !== this._dial.id) return;
      const ctx = this._dialCtx();
      if (!ctx || ctx.entidad !== this._dial.entidad) return;
      const previo = this._arrastre && this._arrastre.control === 'grados' ? this._arrastre.valor : ctx.real;
      const v = this._dialGrados(ev, ctx, previo);
      if (v === null || v === previo) return;
      this._arrastre = { entidad: ctx.entidad, control: 'grados', valor: v, dedo: true, hasta: Date.now() + 60000 };
      this._render();
    }

    // Al soltar se manda UNA orden con los grados del dedo (si no cambió, ordenControl no manda nada).
    _dialFin(ev, mandar) {
      if (!this._dial || ev.pointerId !== this._dial.id) return;
      const { entidad } = this._dial;
      this._dial = null;
      const arr = this._arrastre && this._arrastre.control === 'grados' && this._arrastre.entidad === entidad ? this._arrastre : null;
      if (!mandar || !arr) {
        this._arrastre = null;
        this._render();
        return;
      }
      this._dialMandar(entidad, arr.valor);
    }

    _dialMandar(entidad, valor) {
      this._arrastre = { entidad, control: 'grados', valor, hasta: Date.now() + 2500 };
      this._control('grados', String(valor), entidad);
      this._render();
      setTimeout(() => this._render(), 2600);
    }

    // Flechas sobre el dial: un grado por tecla; la orden sale 700 ms después de la última.
    _dialTecla(ev) {
      const svgDial = ev.target && ev.target.closest ? ev.target.closest('[data-dial]') : null;
      const dir = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 }[ev.key];
      if (!svgDial || !dir || this._dial) return;
      const ctx = this._dialCtx();
      if (!ctx) return;
      ev.preventDefault();
      // Se suma a lo último que se movió (aunque HA aún no lo confirme); si no hay, se parte de lo que dice HA.
      const arr = this._arrastre && Date.now() <= this._arrastre.hasta && this._arrastre.control === 'grados' && this._arrastre.entidad === ctx.entidad ? this._arrastre : null;
      const v = Math.max(ctx.rg.min, Math.min(ctx.rg.max, (arr ? arr.valor : ctx.real) + dir));
      this._arrastre = { entidad: ctx.entidad, control: 'grados', valor: v, hasta: Date.now() + 60000 };
      this._render();
      clearTimeout(this._tDial);
      this._tDial = setTimeout(() => {
        this._tDial = null;
        this._dialMandar(ctx.entidad, v);
      }, 700);
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
      // PANEL-14: engrane, «Bloquear» y la hoja de la clave.
      if (this._clicCandado(ev)) return;
      if (ev.target.closest('[data-cerrar]')) {
        this._cerrarVentana();
        return;
      }
      // PANEL-06/07: los paneles laterales (audio, aires, cámaras). El mismo chip abre y cierra.
      if (ev.target.closest('[data-cerrar-lateral]')) {
        this._cerrarLateral();
        return;
      }
      // PANEL-13: música (señal y mini modal de Casa, pestaña Música, pregunta de la TV, aviso con botón).
      if (this._clicMusica(ev)) return;
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
        this._popMusica = false;
        this._confirmarTV = null;
        this._detalle = null;
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

    // PANEL-13: lo de la música que se calcula igual en la pantalla y en los botones.
    _musicaActual() {
      const m = this._modeloActual && this._modeloActual.musica;
      const h = this._hass;
      if (!m || !h || !m.bocinas || !m.bocinas.length) return null;
      const grupos = gruposMusica(m.bocinas, h.states);
      const pedido = this._cuartoDeTablet();
      const cuarto = pedido ? cuartoDeParametro(this._modeloActual, pedido) : null;
      const sonando = elegirSonando(grupos, h.states, { cuarto, areas: m.areas });
      const sel = grupoSeleccionado(grupos, { sel: this._grupoMusica, sonando, cuarto, areas: m.areas });
      return { m, grupos, sonando, sel, cuarto };
    }

    // PANEL-13: los clics de música. Devuelve true si el clic era suyo.
    _clicMusica(ev) {
      const t = ev.target;
      // PANEL-17: «Audio de la TV» (mini modal, Bocinas o panel lateral de audio).
      const tvb = t.closest('[data-audio-tv]');
      if (tvb) {
        if (!tvb.disabled && this._hass) this._servicio(ordenAudioTV(tvb.dataset.audioTv));
        return true;
      }
      if (t.closest('[data-tv-no]')) {
        this._confirmarTV = null;
        this._render();
        return true;
      }
      if (t.closest('[data-tv-si]')) {
        const c = this._confirmarTV;
        this._confirmarTV = null;
        this._render();
        if (c) this._unir(c.entidad, c.principal, true);
        return true;
      }
      if (t.closest('[data-unir-sonando]')) {
        this._unirASonando();
        return true;
      }
      if (t.closest('[data-poner-aqui]')) {
        const p = this._pendiente;
        this._pendiente = null;
        this._quitarAviso();
        if (p) this._ponerMusica(p.principal, p.item, true);
        return true;
      }
      if (t.closest('[data-pop-cerrar]')) {
        this._popMusica = false;
        this._render();
        return true;
      }
      if (t.closest('[data-senal]')) {
        this._popMusica = !this._popMusica;
        this._lateral = null;
        this._render();
        return true;
      }
      if (t.closest('[data-ir-musica]')) {
        this._popMusica = false;
        this._irAPestana(MUSICA);
        return true;
      }
      const b = t.closest('[data-mus], [data-mus-mute], [data-zona], [data-bib-sec], [data-bib-item], [data-bib-mas], [data-bib-reintentar], [data-unir], [data-separar], [data-vol-por-bocina], [data-det-volver], [data-det-can], [data-det-todo], [data-det-alea], [data-det-mas], [data-det-reintentar]');
      if (!b) return false;
      if (b.disabled) return true;
      const d = b.dataset;
      if (d.mus) this._mus(d.mus, d.principal);
      else if (d.musMute) {
        if (this._hass) this._servicio(ordenSilencioBocina(d.musMute, this._hass.states));
      } else if (d.zona) {
        this._grupoMusica = d.zona;
        this._render();
      } else if (d.bibSec) {
        if (SECCIONES_BIB.includes(d.bibSec) && d.bibSec !== this._bib.seccion) {
          this._detalle = null;
          this._bib = { ...this._bib, seccion: d.bibSec };
          this._cargarBib(true);
        }
      } else if (d.detVolver) this._cerrarDetalle();
      else if (d.detCan !== undefined) this._reproducirLista(false, Number(d.detCan));
      else if (d.detTodo) this._reproducirLista(false, 0);
      else if (d.detAlea) this._reproducirLista(true, 0);
      else if (d.detMas) {
        if (this._detalle) {
          this._detalle = { ...this._detalle, mostrar: (this._detalle.mostrar || POR_PAGINA_DET) + POR_PAGINA_DET };
          this._render();
        }
      } else if (d.detReintentar) this._cargarDetalle();
      else if (d.bibItem !== undefined) this._reproducirItem(Number(d.bibItem));
      else if (d.bibMas) this._cargarBib(false);
      else if (d.bibReintentar) this._cargarBib(true);
      else if (d.unir) this._unir(d.unir, d.principal, false);
      else if (d.separar) this._servicio(ordenSeparar(d.separar));
      else if (d.volPorBocina) {
        this._volPorBocina = !this._volPorBocina;
        this._render();
      }
      return true;
    }

    _grupoPorPrincipal(principal) {
      const mus = this._musicaActual();
      return mus ? mus.grupos.find((g) => g.principal === principal) || null : null;
    }

    _mus(accion, principal) {
      const g = this._grupoPorPrincipal(principal);
      if (!g || !this._hass) return;
      const o = ordenMusica(accion, g, this._hass.states);
      if (o) this._servicio(o);
    }

    // Volumen de música: «input» mientras se arrastra (solo pinta), «change» al soltar (manda la orden).
    _volMusica(i, soltar) {
      const h = this._hass;
      if (!h) return;
      const grupo = i.dataset.musVol === 'grupo';
      const clave = grupo ? `grupo:${i.dataset.principal}` : `boc:${i.dataset.entidad}`;
      const valor = Math.max(0, Math.min(100, Math.round(Number(i.value) || 0)));
      this._arrMus = { clave, valor, hasta: Date.now() + (soltar ? 2500 : 60000) };
      this._render();
      if (!soltar) return;
      if (grupo) {
        const g = this._grupoPorPrincipal(i.dataset.principal);
        if (g) for (const o of ordenesVolumenGrupo(g, h.states, valor)) this._servicio(o);
      } else if (i.dataset.entidad) this._servicio(ordenVolumen(i.dataset.entidad, valor));
      setTimeout(() => this._render(), 2600);
    }

    _unir(entidad, principal, confirmado) {
      const h = this._hass;
      if (!h || !entidad || !principal || entidad === principal) return;
      if (!confirmado && enTV(h.states[entidad])) {
        this._confirmarTV = { entidad, principal };
        this._render();
        const hoja = this.shadowRoot.querySelector('.hoja.confirmar');
        if (hoja) hoja.focus({ preventScroll: true });
        return;
      }
      this._servicio(ordenUnir(principal, [entidad]));
    }

    _quitarAviso() {
      this._aviso = '';
      this._avisoAccion = null;
      clearTimeout(this._tAviso);
      this._render();
    }

    _avisar(texto, accion = null, ms = 4000) {
      this._aviso = texto;
      this._avisoAccion = accion ? { texto, accion } : null;
      this._render();
      clearTimeout(this._tAviso);
      if (ms) {
        this._tAviso = setTimeout(() => {
          this._aviso = '';
          this._avisoAccion = null;
          this._render();
        }, ms);
      }
    }

    // Tras el aviso del límite de Spotify: el grupo elegido se une al que ya suena.
    _unirASonando() {
      const mus = this._musicaActual();
      this._pendiente = null;
      this._aviso = '';
      this._avisoAccion = null;
      clearTimeout(this._tAviso);
      if (!mus || !mus.sel) {
        this._render();
        return;
      }
      const otro = elegirSonando(mus.grupos.filter((g) => g.principal !== mus.sel.principal), this._hass.states, { cuarto: mus.cuarto, areas: mus.m.areas });
      if (otro) {
        const ids = todasDelGrupo(mus.sel).filter((x) => x !== otro.grupo.principal);
        this._grupoMusica = otro.grupo.principal;
        this._servicio(ordenUnir(otro.grupo.principal, ids));
      }
      this._render();
    }

    _reproducirItem(i) {
      const item = this._bib.items[i];
      const mus = this._musicaActual();
      if (!item || !mus || !mus.sel || !mus.sel.disponible || this._poniendo) return;
      // PANEL-17: una playlist o un álbum abre su detalle (las canciones); lo demás se pone como antes.
      if (TIPOS_DETALLE.includes(item.tipo)) {
        this._abrirDetalle(i);
        return;
      }
      this._grupoMusica = mus.sel.principal;
      this._ponerMusica(mus.sel.principal, item, false);
    }

    // PANEL-17: abre el detalle de una playlist o un álbum de «Tu música» y pide sus canciones.
    _abrirDetalle(i) {
      const item = this._bib.items[i];
      if (!item || !TIPOS_DETALLE.includes(item.tipo)) return;
      const capa = this.shadowRoot && this.shadowRoot.querySelector('.capa');
      this._scrollBib = capa ? capa.scrollTop : 0;
      this._detalle = { item, idx: i, canciones: [], cargando: false, error: false, mostrar: POR_PAGINA_DET, pedido: 0 };
      this._cargarDetalle();
      const el = this.shadowRoot && this.shadowRoot.querySelector('.mus-det');
      if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'start' });
    }

    // PANEL-17: las canciones salen de media_player/browse_media de la bocina principal. Las respuestas viejas se ignoran.
    async _cargarDetalle() {
      const h = this._hass;
      const mus = this._musicaActual();
      const det = this._detalle;
      if (!h || !mus || !mus.sel || !det) return;
      const pedido = (det.pedido || 0) + 1;
      this._detalle = { ...det, pedido, cargando: true, error: false };
      this._render();
      try {
        const r = await h.callWS({ type: 'media_player/browse_media', entity_id: mus.sel.principal, media_content_type: det.item.tipo, media_content_id: det.item.uri });
        if (!this._detalle || this._detalle.pedido !== pedido) return;
        this._detalle = { ...this._detalle, cargando: false, canciones: cancionesDe(r) };
      } catch (e) {
        if (!this._detalle || this._detalle.pedido !== pedido) return;
        console.warn('[vizions-panel] canciones', e);
        this._detalle = { ...this._detalle, cargando: false, error: true };
      }
      this._render();
    }

    // PANEL-17: regresa a la cuadrícula, en el lugar del desplazamiento donde estaba.
    _cerrarDetalle() {
      this._detalle = null;
      this._render();
      const capa = this.shadowRoot && this.shadowRoot.querySelector('.capa');
      if (capa) capa.scrollTop = this._scrollBib || 0;
    }

    // PANEL-17: pone la lista desde la canción i (o toda, revuelta, con «Aleatorio»). En orden, si el aleatorio de
    // Music Assistant estaba prendido se apaga antes (si no, revolvería la lista).
    _reproducirLista(alea, i = 0) {
      const det = this._detalle;
      const mus = this._musicaActual();
      const h = this._hass;
      if (!det || !h || !mus || !mus.sel || !mus.sel.disponible || this._poniendo || det.cargando) return;
      const p = mus.sel.principal;
      const orden = ordenDesde(p, alea ? barajar(det.canciones) : det.canciones, alea ? 0 : i);
      if (!orden) return;
      const antes = alea ? [ordenAleatorio(p, true)] : h.states[p]?.attributes?.shuffle === true ? [ordenAleatorio(p, false)] : [];
      this._grupoMusica = p;
      this._ponerMusica(p, { orden, antes }, false);
    }

    // PANEL-13c: una orden de música sin el aviso de Home Assistant → 'ok', 'limite' o el error.
    async _intentar(o) {
      try {
        await this._hass.callService(o.dominio, o.servicio, o.datos, undefined, false);
        return 'ok';
      } catch (e) {
        console.warn('[vizions-panel] música', e);
        return esLimiteSpotify(e) ? 'limite' : 'error';
      }
    }

    _esperar() {
      return new Promise((r) => setTimeout(r, this._esperaSpotify));
    }

    // PANEL-13c: pone música en el grupo. Si Spotify está ocupado: con otra zona sonando de verdad, pregunta
    // («Unir a lo que suena» / «Poner aquí»); si no, reintenta, luego detiene todas las bocinas de Music
    // Assistant y reintenta una vez; si sigue, pide reiniciar Music Assistant. `aqui` = ya se eligió «Poner aquí».
    async _ponerMusica(principal, item, aqui) {
      const h = this._hass;
      if (!h || this._poniendo) return;
      const T = TXT[idiomaDe(h)];
      // PANEL-17: el detalle manda su orden ya armada (la lista desde una canción) y lo que va antes (aleatorio).
      const o = item && item.orden ? item.orden : ordenReproducir(principal, item);
      this._poniendo = true;
      this._render();
      try {
        if (aqui) {
          const mus = this._musicaActual();
          const otros = mus ? gruposOtrosSonando(mus.grupos, h.states, principal).flatMap((g) => todasDelGrupo(g)) : [];
          if (otros.length) {
            await this._intentar(ordenDetener(otros));
            await this._esperar();
          }
        }
        for (const x of (item && item.antes) || []) await this._intentar(x);
        let r = await this._intentar(o);
        if (r === 'ok') return;
        if (r === 'limite' && !aqui) {
          const mus = this._musicaActual();
          const otros = mus ? gruposOtrosSonando(mus.grupos, h.states, principal) : [];
          if (otros.length) {
            this._pendiente = { principal, item };
            this._avisar(T.limiteSpotify(etiquetaGrupo(otros[0], mus.m, h.states, idiomaDe(h))), 'limite', 12000);
            return;
          }
        }
        if (r === 'limite') {
          this._avisar(T.reintentando, null, 0);
          await this._esperar();
          r = await this._intentar(o);
          if (r === 'limite') {
            const mus = this._musicaActual();
            const todas = mus ? mus.m.bocinas.map((d) => d.entidad) : [];
            if (todas.length) await this._intentar(ordenDetener(todas));
            await this._esperar();
            r = await this._intentar(o);
          }
          if (r === 'ok') {
            this._quitarAviso();
            return;
          }
        }
        this._avisar(r === 'limite' ? T.spotifyAtorado : T.errorOrden, null, r === 'limite' ? 10000 : 4000);
      } finally {
        this._poniendo = false;
        this._render();
      }
    }

    _buscarBib(texto) {
      clearTimeout(this._tBuscar);
      this._tBuscar = setTimeout(() => {
        this._detalle = null;
        this._bib = { ...this._bib, busqueda: String(texto || '') };
        this._cargarBib(true);
      }, 450);
    }

    // Pide a Music Assistant (por Home Assistant) una página de la sección. Las respuestas viejas se ignoran.
    async _cargarBib(reiniciar) {
      const h = this._hass;
      const m = this._modeloActual && this._modeloActual.musica;
      if (!h || !m) return;
      const b = this._bib;
      if (!reiniciar && (b.cargando || b.fin)) return;
      const pedido = (b.pedido || 0) + 1;
      const offset = reiniciar ? 0 : b.items.length;
      this._bib = { ...b, pedido, cargando: true, error: false, cargada: true, ...(reiniciar ? { items: [], fin: false } : {}) };
      this._render();
      try {
        if (!m.entrada) throw new Error('Music Assistant sin config_entry_id');
        const r = await h.callWS({ type: 'call_service', domain: 'music_assistant', service: 'get_library', service_data: pedidoBiblioteca(m.entrada, this._bib.seccion, offset, this._bib.busqueda), return_response: true });
        if (this._bib.pedido !== pedido) return;
        const crudos = Array.isArray(r?.response?.items) ? r.response.items.length : 0;
        this._bib = { ...this._bib, cargando: false, items: [...this._bib.items, ...itemsBiblioteca(r && r.response)], fin: crudos < LIMITE_BIB };
      } catch (e) {
        if (this._bib.pedido !== pedido) return;
        console.warn('[vizions-panel] biblioteca', e);
        this._bib = { ...this._bib, cargando: false, error: true };
      }
      this._render();
    }

    // Manda una orden de música; si falla, avisa.
    async _servicio(o) {
      const h = this._hass;
      if (!h || !o) return false;
      // PANEL-13c: sin el aviso de Home Assistant (notifyOnError = false); el panel pone el suyo.
      try {
        await h.callService(o.dominio, o.servicio, o.datos, undefined, false);
        return true;
      } catch (e) {
        console.warn('[vizions-panel] música', e);
        this._avisar(TXT[idiomaDe(h)].errorOrden);
        return false;
      }
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
    // ------------------------------------------------------------ PANEL-14: candado
    // Lo que dibujar necesita del candado; null = sin engrane (sin clave o sin kiosko).
    _vistaCandado() {
      if (!this._hass || !this._cfg.clave || !this._pideKiosko()) return null;
      const e = estadoCandado(CANDADO, RELOJ_CANDADO.ahora());
      return { abierto: e.abierto, restante: e.abierto ? textoRestante(e.restanteMs) : '' };
    }

    _vistaClave() {
      if (!this._clave) return null;
      const e = estadoCandado(CANDADO, RELOJ_CANDADO.ahora());
      return { n: this._clave.pin.length, mal: this._clave.mal, espera: e.espera ? Math.ceil(e.esperaMs / 1000) : 0 };
    }

    _clicCandado(ev) {
      const b = ev.target.closest('[data-candado], [data-clave], [data-tecla]');
      if (!b) return false;
      if (b.disabled) return true;
      if (b.dataset.candado === 'abrir') {
        if (!this._vistaCandado()) return true;
        this._lateral = null;
        this._ventana = null;
        this._popMusica = false;
        this._clave = { pin: '', mal: 0 };
      } else if (b.dataset.candado === 'bloquear') {
        this._bloquear();
        return true;
      } else if (b.dataset.clave === 'cancelar') {
        this._clave = null;
      } else if (b.dataset.clave === 'entrar') {
        this._entrar();
        return true;
      } else if (b.dataset.tecla && this._clave) {
        if (estadoCandado(CANDADO, RELOJ_CANDADO.ahora()).espera) return true;
        const pin = this._clave.pin;
        const k = b.dataset.tecla;
        if (k === 'borrar') this._clave = { pin: pin.slice(0, -1), mal: 0 };
        else if (/^[0-9]$/.test(k) && pin.length < CLAVE_MAX) this._clave = { pin: pin + k, mal: 0 };
      }
      this._render();
      return true;
    }

    _entrar() {
      const c = this._clave;
      if (!c) return;
      const ahora = RELOJ_CANDADO.ahora();
      if (estadoCandado(CANDADO, ahora).espera || c.pin.length < CLAVE_MIN) return;
      if (this._cfg.clave && hashClave(c.pin) === this._cfg.clave) {
        this._desbloquear();
        return;
      }
      Object.assign(CANDADO, errorClave(CANDADO, ahora));
      // La sacudida se repite en cada error: al teclear se quitó la clase «mal» y aquí vuelve.
      this._clave = { pin: '', mal: 1 };
      this._render();
    }

    _desbloquear() {
      CANDADO.hasta = RELOJ_CANDADO.ahora() + DESBLOQUEO_MS;
      CANDADO.errores = 0;
      CANDADO.esperaHasta = 0;
      CANDADO.tarjeta = this;
      try {
        CANDADO.ruta = window.location.pathname + window.location.search;
      } catch {
        CANDADO.ruta = '';
      }
      clearTimeout(CANDADO.timer);
      CANDADO.timer = setTimeout(vencerCandado, DESBLOQUEO_MS);
      this._clave = null;
      this._kiosko();
      this._render();
    }

    _bloquear() {
      CANDADO.hasta = 0;
      clearTimeout(CANDADO.timer);
      CANDADO.timer = null;
      this._kiosko();
      this._render();
    }

    // Cada segundo: si el tiempo ya pasó (el temporizador se pudo atrasar con la pantalla dormida), se
    // vence; si está abierto o la hoja está abierta, se redibuja la cuenta.
    _tickCandado() {
      if (!this._hass) return;
      if (CANDADO.hasta && !candadoAbierto()) {
        vencerCandado();
        if (CANDADO.tarjeta !== this) {
          this._kiosko();
          this._render();
        }
        return;
      }
      if (CANDADO.hasta || this._clave) this._render();
    }

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

return { VERSION_PANEL, ETIQUETA_PANEL, ETIQUETA_INICIO, ETIQUETA_FAVORITO, MAX_VIVO, SIN_FOTO_MS, ESPERA_FOTO_MS, quiereKiosko, SAL_CLAVE, DESBLOQUEO_MS, INTENTOS_CLAVE, ESPERA_CLAVE_MS, CLAVE_MIN, CLAVE_MAX, sha256Hex, hashClave, claveAdminValida, estadoCandado, textoRestante, errorClave, RELOJ_CANDADO, CANDADO, candadoAbierto, vencerCandado, esCasa, KIOSKO_ID, CSS_KIOSKO, raicesKiosko, idiomaDe, esc, gradosEnteros, rangoGrados, urlSegura, capasFoto, camarasEtiquetadas, urlCamara, camaraConVideo, pasosVentilador, TIPOS_PANEL, ventiladoresEtiquetados, rutinasEtiquetadas, armarModelo, accionDeToque, fichaDe, ordenDe, TONOS, COLORES, capsDe, controlesDe, ordenControl, encabezadoCuarto, ANCHO_MOVIL, esMovil, CERRAR_DESLIZANDO, VOLVER_MS, cuartoDeParametro, normalizarBateria, DIAL, anguloDial, puntoDial, arcoDial, gradosDeDial, marcasDial, htmlDial, resumenAudio, resumenAires, resumenVentiladores, ordenPanelCamaras, dibujar, enPantallaCompleta, grupoLateral, grupoAudio, LIMITE_BIB, SECCIONES_BIB, volPct, gruposMusica, todasDelGrupo, volumenesDe, maestroVolumen, volumenesGrupo, ordenesVolumenGrupo, ordenVolumen, elegirSonando, grupoSeleccionado, senalMusica, portadaMusica, imagenBiblioteca, itemsBiblioteca, pedidoBiblioteca, ordenReproducir, ordenUnir, ordenSeparar, ordenMusica, esLimiteSpotify, ESPERA_SPOTIFY, gruposOtrosSonando, ordenDetener, ordenSilencioBocina, enTV, POR_PAGINA_DET, MAX_COLA, TIPOS_DETALLE, partirTitulo, cancionesDe, ordenDesde, barajar, ordenAleatorio, cancionSonando, puedeAudioTV, ordenAudioTV, progresoMusica, tiempoMusica, etiquetaGrupo, morph };
})();
export const VIZIONS_PANEL = __vp_tarjeta;
