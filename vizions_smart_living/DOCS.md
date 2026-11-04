# Vizions Smart Living

Conecta la domótica de esta casa con Vizions OS: el huésped la controla desde la TV y
desde su celular durante su estancia. El complemento abre una conexión **saliente** hacia
Vizions; no hay que abrir puertos en el router y el token de Home Assistant nunca sale de la casa.

## Qué puede controlar el huésped: la etiqueta «Vizions»

Solo lo que tenga la etiqueta **Vizions** en Home Assistant. Nada más llega a la TV.

1. **Crear la etiqueta** (una vez): Ajustes → Áreas, etiquetas y zonas → Etiquetas → Crear etiqueta → «Vizions».
2. **Marcar** focos y apagadores: Ajustes → Dispositivos y servicios → Dispositivos (o Entidades) →
   seleccionar → Agregar etiqueta → Vizions. O desde el engrane de una entidad → Etiquetas.
   **Escenas y scripts**: Ajustes → Automatizaciones y escenas → Escenas (o Scripts) → seleccionar →
   Agregar etiqueta → Vizions.
3. **Revisar**: en esas listas, filtra por la etiqueta Vizions.

- Con la etiqueta en una **entidad**, esa entidad entra.
- Con la etiqueta en un **dispositivo**, entran sus luces y apagadores normales; no los de
  configuración o diagnóstico (bloqueo infantil, luz del indicador…) ni los ocultos.
- Entran:
  - luces `light` (con brillo si el foco lo permite) y apagadores `switch` (encender y apagar);
  - escenas `scene` y scripts `script`, que el huésped ve como botones para activar;
  - persianas `cover` (subir, detener y bajar);
  - aires `climate` (encender y apagar, temperatura dentro del rango del aire y velocidad del ventilador;
    el modo frío/calor se queda como lo dejó el anfitrión). Si el aparato del aire tiene un interruptor
    de **pantalla** (AC Freedom: «Display»), se amarra al aire como un botón «Pantalla»;
  - bocinas `media_player` (Sonos y similares: reproducir y pausar, silencio y volumen; el huésped ve
    la canción y el artista, pero la música se pone desde la app de la bocina).
- Las escenas y scripts entran solo con la etiqueta puesta en ellos (no por la etiqueta de un dispositivo).
- Los demás interruptores de un aparato que tiene un aire (Sleep, Health, Eco…) o una bocina (Loudness,
  Crossfade…) nunca entran como luces, aunque el aparato tenga la etiqueta.
- El nombre es el de Home Assistant y el inglés se traduce solo («Luz de la sala» → «Living room light»).
- Poner o quitar la etiqueta se refleja en la TV y el celular en segundos, sin reiniciar nada.

## Vizions Panel: la tablet del dueño

El complemento instala solo el **Vizions Panel** (el tablero para una tablet en la pared):
copia la tarjeta, la registra en Ajustes → Paneles → Recursos y crea el tablero **Vizions Panel**
(`/vizions-panel`). Cada vez que arranca revisa que todo siga ahí y lo pone al día con la
versión nueva; nunca toca un tablero que ya armaste a tu gusto. Para eso el complemento pide
acceso a la API de Home Assistant y a su carpeta de configuración (se ve en la ficha del
complemento); el token de Vizions sigue sin ser administrador.

- En el panel aparece solo lo que tenga la etiqueta **Vizions Panel** (aparte de «Vizions», que
  es la del huésped). Lo que tenga **Vizions Panel Inicio** sale como acceso rápido en Casa.
- **La primera vez** puede que el registro diga «Reinicia Home Assistant una vez»: HA solo sirve
  la carpeta `www` si ya existía cuando arrancó. Ajustes → Sistema → Reiniciar, y listo.
- **La tablet**: crea un usuario **sin** permisos de administrador (ej. «Tablet»), inicia sesión
  con él en la tablet y abre `http://<ip-de-la-casa>:8123/vizions-panel`. Con ese usuario el panel
  ocupa toda la pantalla (sin la barra de Home Assistant). Con tu usuario de administrador lo ves
  dentro de Home Assistant normal, para poder editar. Para ver la barra en la tablet:
  agrega `?kiosko=0` a la dirección.

## Opciones

- **propiedad**: el nombre de la casa en Vizions (lo da Vizions, ej. `casadelrey-p1`).
- **llave**: la llave de la propiedad (la da Vizions). Se guarda oculta.
- **puerta**: déjala como está (`wss://casas.vizionsnetworks.com/agente`).
- **ha_url**: dónde está Home Assistant. Normalmente `http://homeassistant:8123`;
  si le cambiaste el puerto, usa la IP de la casa (ej. `http://<ip-de-la-casa>`).
- **ha_token**: un token de larga duración de un usuario **sin permisos de administrador**
  creado solo para Vizions. Se guarda oculto.
- **etiqueta**: `Vizions`. Vacía = no se descubre nada; solo cuenta la lista de abajo.
- **panel**: instalar y mantener el Vizions Panel (encendido). Apágalo si esta casa no lleva tablet
  o si prefieres instalarlo a mano; apagarlo no quita lo ya instalado.
- **dispositivos** (opcional): para escribir uno a mano, por ejemplo si quieres otro nombre en inglés.
  Si la misma entidad también tiene la etiqueta, manda lo escrito aquí.

```yaml
- id: luz-escritorio
  tipo: luz
  entidad: switch.escritorio_interruptor_1
  nombre_es: Luz del escritorio
  nombre_en: Desk light
```

## Actualizar

Las versiones nuevas llegan por el repositorio de Vizions (`github.com/emilioruval/vizions-ha-addons`):
Ajustes → Complementos → Vizions Smart Living → **Actualizar**. Las Opciones se conservan.

## Registro

Cada orden, cada conexión, cada cambio de la lista y la instalación del panel (`"evento":"panel"`)
quedan en el registro del complemento.
Nunca aparecen la llave ni el token. Si las Opciones están mal, el complemento se detiene y dice qué corregir.
