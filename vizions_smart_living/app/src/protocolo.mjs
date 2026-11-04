// Lo que comparten la puerta y el agente.

// Versión del protocolo entre agente y puerta. Si cambia el formato de los
// mensajes, se sube y la puerta rechaza a los agentes viejos con «VERSION».
export const VERSION_PROTOCOLO = 1;

// Identificadores de propiedades y dispositivos.
export const ID_VALIDO = /^[a-z0-9][a-z0-9-]{0,62}$/;
