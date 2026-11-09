# Preparación de sacas por QR

Pantalla: <https://pvcnte.github.io/despachos/>.

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

## Pruebas

```sh
node --test tests/*.test.js
```

La suite cubre cliente válido, maestro vacío/caído, ausencia de llamadas a pedidos
y vinculación, payload, guard de envío único, conservación de selección y error
de red. No ejecuta preparaciones reales. Las pruebas puras históricas de peso,
condición y compatibilidad permanecen, sin activar un flujo por pedido en la UI.

## Publicación y arquitectura

El HTML público previo coincidía con el respaldo del commit `a8d8187` al revisar.
El cambio se publicó en `main` con autorización expresa de Jorge; GitHub Pages sirve
desde `main` en `/`. La comprobación hecha es de commit y de contenido servido
comparado con el `index.html` local, no una validación visual en navegador. El HTML
anterior queda respaldado en la rama `backup/qr-antes-simple-20261109`. Las pruebas
se versionan como código, pero no entran en el paquete Apps Script. No publicar
copias de datos ni secretos.

[Mapa canónico y contratos](https://github.com/jorgehonores-debug/planta-sb-herramientas/blob/main/hermes/skills_sbjh/sbjh-ecosistema-programas/references/ecosistema-mrp-qr-stock.md). La revisión del 09-11 está actualizada en el workspace compartido y pendiente de sincronizar en GitHub.
