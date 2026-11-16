'use strict';
// El escáner abría la cámara frontal. Causa comprobada en html5-qrcode 2.3.8
// (línea `var a = c ? s.videoConstraints : h.createVideoConstraints(t)`): cuando
// el config trae videoConstraints, la librería usa ESAS constraints y descarta el
// primer argumento de start() (facingMode o deviceId). El lector pedía
// {facingMode:"environment"} en el primer argumento y width/height/focusMode en
// videoConstraints, así que getUserMedia nunca recibía facingMode y el navegador
// abría su cámara por defecto, la frontal en el celular de planta. El deviceId del
// desplegable viajaba por el mismo camino ignorado: cambiar de cámara no tenía
// efecto. La cámara pedida debe ir DENTRO de videoConstraints.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const FUENTE = path.join(__dirname, '..', 'index.html');

const CAMARAS = [
  { id: 'id-frontal', label: 'camera2 1, facing front' },
  { id: 'id-trasera', label: 'camera2 0, facing back' },
];

function cargar(opciones) {
  const op = opciones || {};
  const mapa = {};
  function crear(id) {
    if (mapa[id]) return mapa[id];
    const el = {
      id: id, value: '', textContent: '', innerHTML: '', className: '', style: {}, disabled: false,
      children: [], src: '', options: [],
      classList: { toggle: function () { }, add: function () { }, remove: function () { } },
      setAttribute: function () { }, getAttribute: function () { return null; },
      querySelector: function () { return { checked: false }; },
      addEventListener: function () { },
      append: function (c) { this.children.push(c); },
      replaceChildren: function () { this.children = Array.prototype.slice.call(arguments); },
      focus: function () { },
    };
    mapa[id] = el;
    return el;
  }
  const llamadas = [];
  const fetch = function (url, opts) {
    llamadas.push({ url: url, opts: opts || null });
    return Promise.resolve({ json: function () { return Promise.resolve([]); } });
  };
  const almacen = {
    datos: {},
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(this.datos, k) ? this.datos[k] : null; },
    setItem: function (k, v) { this.datos[k] = String(v); },
  };
  if (op.guardada) almacen.datos.camaraDespachos = op.guardada;

  const arranques = [];
  function FakeQr(id, opcionesQr) {
    this.elemento = id;
    this.opciones = opcionesQr;
    this.camara = null;
    this.config = null;
  }
  FakeQr.prototype.start = function (camara, config) {
    this.camara = camara;
    this.config = config;
    arranques.push(this);
    if (op.fallarFacingMode && typeof camara === 'object' && !camara.deviceId) {
      return Promise.reject(new Error('OverconstrainedError'));
    }
    return Promise.resolve(null);
  };
  FakeQr.prototype.stop = function () { return Promise.resolve(); };
  FakeQr.prototype.clear = function () { };
  FakeQr.prototype.getRunningTrackCameraCapabilities = function () {
    return {
      torchFeature: function () {
        return { isSupported: function () { return false; }, apply: function () { return Promise.resolve(); } };
      },
    };
  };
  FakeQr.getCameras = function () {
    return Promise.resolve(Object.prototype.hasOwnProperty.call(op, 'camaras') ? op.camaras : CAMARAS);
  };

  const sandbox = {
    console: console,
    document: {
      getElementById: crear,
      querySelectorAll: function () { return []; },
      addEventListener: function () { },
      createElement: function () { return crear('nuevo_' + Math.random()); },
    },
    window: {}, setInterval: function () { return 0; }, setTimeout: function () { return 0; },
    fetch: fetch,
    Option: function (t, v) { this.text = t; this.value = v; },
    navigator: {},
    localStorage: almacen,
    Html5Qrcode: FakeQr,
    Html5QrcodeSupportedFormats: { QR_CODE: 'QR_CODE' },
  };
  vm.createContext(sandbox);
  const html = fs.readFileSync(FUENTE, 'utf8');
  const bloques = html.match(/<script>[\s\S]*?<\/script>/g) || [];
  const codigo = bloques[bloques.length - 1].replace(/^<script>/, '').replace(/<\/script>$/, '');
  vm.runInContext(codigo, sandbox, { filename: 'index.html' });
  return { ctx: sandbox, dom: crear, llamadas: llamadas, arranques: arranques, almacen: almacen };
}
function leer(ctx, expr) { return vm.runInContext(expr, ctx); }
const esperar = () => new Promise(function (r) { setTimeout(r, 0); });
async function asentar() { for (let i = 0; i < 5; i++) await esperar(); }

test('arranque: la cámara trasera viaja dentro de videoConstraints', async () => {
  const c = cargar();
  c.ctx.iniciarEscaneo();
  await asentar();

  const qr = c.arranques[0];
  assert.ok(qr, 'arrancó el lector sobre #reader');
  assert.strictEqual(qr.elemento, 'reader');
  // Los objetos vienen del contexto vm: se comparan campo por campo.
  assert.strictEqual(qr.camara.facingMode, 'environment');
  assert.deepStrictEqual(Object.keys(qr.camara), ['facingMode']);
  const vc = qr.config.videoConstraints;
  assert.strictEqual(vc.facingMode, 'environment',
    'con videoConstraints presente la librería ignora el primer argumento: la trasera debe ir acá');
  assert.strictEqual(vc.deviceId, undefined, 'sin cámara elegida no se fija deviceId');
  assert.strictEqual(vc.width.ideal, 1280);
  assert.strictEqual(vc.height.ideal, 720);
  assert.strictEqual(qr.config.fps, 15);
  assert.strictEqual(typeof qr.config.qrbox, 'function', 'el visor sigue proporcional');
});

test('desplegable: lista las cámaras, marca la trasera y no restaura una frontal guardada', async () => {
  const c = cargar({ guardada: 'id-frontal' });
  c.ctx.iniciarEscaneo();
  await asentar();

  const select = c.dom('cam-select');
  assert.strictEqual(select.style.display, 'block');
  assert.match(select.innerHTML, /facing back/);
  assert.match(select.innerHTML, /id-trasera/);
  assert.strictEqual(select.value, 'id-trasera', 'una elección frontal guardada no vuelve sola');
});

test('una sola cámara: no muestra el desplegable ni falla', async () => {
  const c = cargar({ camaras: [{ id: 'unica', label: 'camera2 0, facing back' }] });
  c.ctx.iniciarEscaneo();
  await asentar();
  assert.notStrictEqual(c.dom('cam-select').style.display, 'block');
});

test('cambio de cámara: el deviceId llega a videoConstraints y queda guardado', async () => {
  const c = cargar();
  c.ctx.iniciarEscaneo();
  await asentar();

  c.dom('cam-select').value = 'id-frontal';
  c.ctx.cambiarCamara();
  await asentar();

  const qr = c.arranques[c.arranques.length - 1];
  assert.strictEqual(c.arranques.length, 2, 'reinició el lector una vez');
  assert.strictEqual(qr.camara, 'id-frontal');
  assert.strictEqual(qr.config.videoConstraints.deviceId, 'id-frontal',
    'el deviceId ignorado en el primer argumento es el que no cambiaba la cámara');
  assert.strictEqual(c.almacen.getItem('camaraDespachos'), 'id-frontal');
});

test('reintento: cae en la trasera del listado, no en la última cámara', async () => {
  const c = cargar({
    fallarFacingMode: true,
    camaras: [
      { id: 'id-trasera', label: 'camera2 0, facing back' },
      { id: 'id-frontal', label: 'camera2 1, facing front' },
    ],
  });
  c.ctx.iniciarEscaneo();
  await asentar();

  assert.strictEqual(c.arranques.length, 2, 'reintentó una vez');
  assert.strictEqual(c.arranques[0].config.videoConstraints.facingMode, 'environment');
  assert.strictEqual(c.arranques[1].config.videoConstraints.deviceId, 'id-trasera',
    'la última del listado era la frontal');
});

test('sin etiquetas: no descarta cámaras y tolera listas sin trasera declarada', () => {
  const c = cargar();
  assert.strictEqual(leer(c.ctx, 'mejorCamaraTrasera([{id:"a"},{id:"b"}]).id'), 'b');
  assert.strictEqual(leer(c.ctx, 'mejorCamaraTrasera([{id:"solo",label:"camera2 1, facing front"}]).id'), 'solo');
  assert.strictEqual(leer(c.ctx, 'mejorCamaraTrasera([])'), null);
  assert.strictEqual(leer(c.ctx, 'esCamaraFrontal({label:"camera2 1, facing front"})'), true);
  assert.strictEqual(leer(c.ctx, 'esCamaraFrontal({label:"camera2 0, facing back"})'), false);
  assert.strictEqual(leer(c.ctx, 'esCamaraFrontal({})'), false, 'sin etiqueta no se descarta');
});
