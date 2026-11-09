'use strict';
// El backend v34 ya no bloquea: responde ok:true con excepciones[]. El QR debe
// mostrar el registro como EXITOSO, listar el motivo en lenguaje de planta y no
// borrar la saca por la excepción (queda a la vista para conciliar).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const FUENTE = path.join(__dirname, '..', 'index.html');

function cargar(respuestas) {
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
    const cuerpo = opts && opts.body ? JSON.parse(opts.body) : null;
    return Promise.resolve({ json: function () { return Promise.resolve(respuestas(url, cuerpo)); } });
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
    navigator: {}, Html5Qrcode: undefined,
  };
  vm.createContext(sandbox);
  const html = fs.readFileSync(FUENTE, 'utf8');
  const bloques = html.match(/<script>[\s\S]*?<\/script>/g) || [];
  const codigo = bloques[bloques.length - 1].replace(/^<script>/, '').replace(/<\/script>$/, '');
  vm.runInContext(codigo, sandbox, { filename: 'index.html' });
  return { ctx: sandbox, dom: crear, llamadas: llamadas, html: html };
}
function set(ctx, nombre, valor) { ctx.__v = valor; vm.runInContext(nombre + ' = __v;', ctx); }
function leer(ctx, expr) { return vm.runInContext(expr, ctx); }
const esperar = () => new Promise(function (r) { setTimeout(r, 0); });

const SACAS = [
  { serie: '261105A1', descripcion: 'PCR30', fila: 2, kg: 1000, condicion: 'STD', mfi: 2.1 },
  { serie: '261105A2', descripcion: 'PCR30', fila: 3, kg: 1150, condicion: 'STD', mfi: 2.3 },
];
const CLIENTES = [{ id: 'cli_1', nombre: 'RPCI' }, { id: 'cli_2', nombre: 'MALUPLAST' }];

function base(url) {
  if (url.indexOf('action=clientes') !== -1) return CLIENTES;
  if (url.indexOf('action=logo') !== -1) return { logo: '' };
  if (url.indexOf('action=stock') !== -1) return SACAS.slice();
  return { ok: true, mensaje: 'Preparación registrada (2.15 t). Entrega pendiente.', cantidad: 2 };
}

function preparar(respuestaPost) {
  const c = cargar(function (url) {
    if (url.indexOf('action=') !== -1) return base(url);
    return respuestaPost;
  });
  set(c.ctx, 'TOKEN', '1234');
  c.ctx.cargarClientes();
  c.dom('fecha').value = '2026-11-09';
  c.dom('responsable').value = 'Willians T.';
  c.dom('cliente').value = 'RPCI';
  set(c.ctx, 'seleccionadas', { '261105A1': SACAS[0], '261105A2': SACAS[1] });
  return c;
}

test('excepciones: el registro se muestra como EXITOSO con el motivo en lenguaje de planta', async () => {
  const { ctx, dom } = preparar({
    ok: true,
    cantidad: 2,
    mensaje: 'Preparación registrada (2.15 t). Entrega pendiente.',
    excepciones: [
      { serie: '261105A1', motivo: 'no_en_stock', detalle: 'no figura en stock', detectado_en: '2026-11-09T10:00:00Z' },
      { serie: '261105A2', motivo: 'ya_despachada', detalle: '', detectado_en: '2026-11-09T10:00:00Z' },
    ],
  });
  await esperar();
  ctx.enviar();
  await esperar();

  const msg = dom('mensaje');
  assert.strictEqual(msg.className, 'ok', 'no es un error');
  assert.match(msg.textContent, /RPCI/, 'nombra al cliente');
  assert.match(msg.textContent, /sacas preparadas|Preparación registrada/, 'mantiene la confirmación');
  assert.match(msg.textContent, /Entrega pendiente/, 'mantiene Entrega pendiente');
  assert.match(msg.textContent, /261105A1: no figura en el sistema, se registró igual/);
  assert.match(msg.textContent, /261105A2: figura ya despachada, se registró igual/);
  assert.strictEqual(dom('btn-enviar').disabled, false, 'el botón vuelve a habilitarse');
  assert.strictEqual(dom('btn-enviar').textContent, 'Preparar sacas');
});

test('excepciones: aviso visible de registrada sin reserva para conciliar', async () => {
  const { ctx, dom } = preparar({
    ok: true, cantidad: 2,
    excepciones: [{ serie: '261105A1', motivo: 'sin_peso', detalle: '', detectado_en: '2026-11-09T10:00:00Z' }],
  });
  await esperar();
  ctx.enviar();
  await esperar();

  const aviso = dom('aviso-excepciones');
  assert.strictEqual(aviso.style.display, 'block', 'el aviso queda a la vista');
  assert.match(aviso.textContent, /SIN reserva en el sistema/);
  assert.match(aviso.textContent, /conciliaci/i);
  assert.match(aviso.textContent, /261105A1/);
});

test('excepciones: no borra la saca por la excepción y no bloquea el envío', async () => {
  const { ctx, dom, llamadas } = preparar({
    ok: true, cantidad: 2,
    excepciones: [{ serie: '261105A1', motivo: 'contaminada', detalle: 'humedad', detectado_en: '2026-11-09T10:00:00Z' }],
  });
  await esperar();
  ctx.enviar();
  await esperar();

  assert.ok(leer(ctx, "!!seleccionadas['261105A1']"), 'la saca con excepción sigue seleccionada');
  assert.strictEqual(leer(ctx, "!!seleccionadas['261105A2']"), false, 'la saca registrada normal se limpia');
  assert.match(dom('mensaje').textContent, /261105A1: está marcada como contaminada, se registró igual/);
  const posts = llamadas.filter(function (l) { return l.opts && l.opts.method === 'POST'; });
  assert.strictEqual(posts.length, 1, 'no bloquea: hizo el POST y no lo repitió');
  assert.strictEqual(dom('mensaje').className, 'ok', 'una excepción nunca se muestra como error');
});

test('sin excepciones: todo igual que antes', async () => {
  const { ctx, dom } = preparar({ ok: true, cantidad: 2, mensaje: 'Preparación registrada (2.15 t). Entrega pendiente.' });
  await esperar();
  ctx.enviar();
  await esperar();

  assert.strictEqual(dom('mensaje').className, 'ok');
  assert.strictEqual(dom('mensaje').textContent, 'RPCI: Preparación registrada (2.15 t). Entrega pendiente.');
  assert.strictEqual(leer(ctx, 'Object.keys(seleccionadas).length'), 0, 'limpia la selección como antes');
  assert.notStrictEqual(dom('aviso-excepciones').style.display, 'block', 'sin excepciones no hay aviso');
});

test('excepciones vacías: se comporta como una respuesta sin excepciones', async () => {
  const { ctx, dom } = preparar({ ok: true, cantidad: 2, mensaje: 'Preparación registrada (2.15 t). Entrega pendiente.', excepciones: [] });
  await esperar();
  ctx.enviar();
  await esperar();

  assert.strictEqual(dom('mensaje').className, 'ok');
  assert.match(dom('mensaje').textContent, /Entrega pendiente/);
  assert.strictEqual(dom('mensaje').textContent.indexOf('Con excepciones'), -1);
  assert.strictEqual(leer(ctx, 'Object.keys(seleccionadas).length'), 0);
});
