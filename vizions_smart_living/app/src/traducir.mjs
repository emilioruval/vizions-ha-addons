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

export function traducirNombre(nombre, { tipo } = {}) {
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
