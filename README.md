# Lector de códigos QR — preparación de sacas

Pantalla: <https://pvcnte.github.io/despachos/>.

**Qué es:** el lector de códigos QR del ecosistema Planificador / Stock / MRP de Planta San
Bernardo. Prepara reservas de sacas por escaneo, no despacha.

**Espejo privado:** `jorgehonores-debug/despachos` (privado) es la copia de respaldo con la
historia completa, incluida la rama `backup/qr-antes-simple-20261109`. El repo original es
`pvcnte/despachos`, que es público y se mantiene como fuente de publicación de GitHub Pages.
Al cambiar algo: commit y push a los dos (`origin` = espejo privado, `pvcnte` = original).

Mapa del ecosistema:
`planta-sb-herramientas/hermes/skills_sbjh/sbjh-ecosistema-programas/references/ecosistema-mrp-qr-stock.md`.

## Cambio del 09-11-2026

Flujo único: PIN → fecha/responsable → cliente del desplegable → escanear o
seleccionar entre 1 y 30 sacas → confirmar preparación.

- El cliente sale del catálogo que entrega el backend, sin texto libre.
- No se consulta ni selecciona un pedido del planificador, ni se vincula después
  desde esta pantalla. No crea un compromiso MRP.
- POST conserva `modo=cliente`, `cliente`, `fecha`, `responsable`, `series` y el
  token ingresado mediante PIN. No envía `pedidoId` ni `prepId`.
- El botón no permite otro envío mientras espera. Un fallo de red deja resultado
  incierto, conserva la selección y no reintenta automáticamente.
- **Preparar reserva, no despacha.** No marca la salida en Muestreo, ni inventa
  fecha de despacho. Confirmar la entrega física es una operación distinta.

El backend publicado, versión 34, se releyó por Apps Script API el 09-11 y ya
contiene el contrato por cliente. No requiere una publicación del backend para
este cambio de interfaz. El maestro puede derivarse del histórico MRP si está
vacío y el peso puede usar un nominal del plan: retirar el cruce con pedidos no
significa retirar esas dependencias internas.

## Cambio del 16-11-2026

El escáner abría la cámara frontal del celular. Causa comprobada en la librería
`html5-qrcode` 2.3.8 (`var a = c ? s.videoConstraints : h.createVideoConstraints(t)`):
si el config trae `videoConstraints`, la librería usa **esas** constraints y descarta
el primer argumento de `start()` (`facingMode` o `deviceId`). El lector pedía
`{facingMode:"environment"}` en el primer argumento y `width/height/focusMode` en
`videoConstraints`, así que `getUserMedia` nunca recibía `facingMode` y el navegador
abría su cámara por defecto, la frontal en el celular de planta. Por el mismo camino
ignorado viajaba el `deviceId` del desplegable de cámaras: elegir otra cámara no
cambiaba nada.

- La cámara pedida se escribe ahora **dentro de `videoConstraints`** (`facingMode`
  o `deviceId`), que es lo que la librería respeta. El desplegable sí cambia de cámara.
- Reintento cuando el celular rechaza `facingMode`: se elige la trasera por etiqueta
  (`camera2 0, facing back`), no la última del listado, que podía ser la frontal.
- El desplegable marca la cámara que está emitiendo y no restaura sola una elección
  frontal guardada en `localStorage`.
- Sin cambios de interfaz ni de payload. El backend no cambia: no requiere publicación.
- Pruebas nuevas en `tests/frontend_camara.test.js`, verificadas contra el HTML previo
  (6 de 6 fallan antes, 36 de 36 pasan después).

## Pruebas

```sh
node --test tests/*.test.js
```

La suite cubre cliente válido, maestro vacío/caído, ausencia de llamadas a pedidos
y vinculación, payload, guard de envío único, conservación de selección, error de
red y la cámara con la que abre el escáner. No ejecuta preparaciones reales. Las
pruebas puras históricas de peso, condición y compatibilidad permanecen, sin activar
un flujo por pedido en la UI.

## Publicación y arquitectura

El HTML público previo coincidía con el respaldo del commit `a8d8187` al revisar.
El cambio se publicó en `main` con autorización expresa de Jorge; GitHub Pages sirve
desde `main` en `/`. La comprobación hecha es de commit y de contenido servido
comparado con el `index.html` local, no una validación visual en navegador. El HTML
anterior queda respaldado en la rama `backup/qr-antes-simple-20261109`. Las pruebas
se versionan como código, pero no entran en el paquete Apps Script. No publicar
copias de datos ni secretos.

[Mapa canónico y contratos](https://github.com/jorgehonores-debug/planta-sb-herramientas/blob/main/hermes/skills_sbjh/sbjh-ecosistema-programas/references/ecosistema-mrp-qr-stock.md). La revisión del 09-11 está actualizada en el workspace compartido y pendiente de sincronizar en GitHub.
