'use strict';
// Contrato del QR público: preparación por cliente con desplegable del maestro.
// No hay pedido del planificador: el cliente sale de la lista y no se escribe a mano.
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
      src: '', children: [],
      classList: { add: function () { }, remove: function () { }, toggle: function () { } },
      setAttribute: function () { }, getAttribute: function () { return null; },
      querySelector: function () { return { checked: false }; },
      addEventListener: function () { }, focus: function () { },
      append: function (c) { this.children.push(c); },
      replaceChildren: function () { this.children = Array.prototype.slice.call(arguments); },
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
    fetch: fetch, Option: function (t, v) { this.text = t; this.value = v; },
    navigator: {}, Html5Qrcode: undefined,
  };
  vm.createContext(sandbox);
  const html = fs.readFileSync(FUENTE, 'utf8');
  const bloques = html.match(/<script>([\s\S]*?)<\/script>/g) || [];
  const codigo = bloques[bloques.length - 1].replace(/^<script>/, '').replace(/<\/script>$/, '');
  vm.runInContext(codigo, sandbox, { filename: 'index.html' });
  return { ctx: sandbox, dom: crear, llamadas: llamadas };
}
function set(ctx, nombre, valor) { ctx.__v = valor; vm.runInContext(nombre + ' = __v;', ctx); }
function leer(ctx, expr) { return vm.runInContext(expr, ctx); }
const esperar = () => new Promise(function (r) { setTimeout(r, 0); });

const SACAS = [
  { serie: '261105A1', descripcion: 'PCR30', fila: 2, kg: 1000, condicion: 'STD', mfi: 2.1 },
  { serie: '261105A3', descripcion: 'PCR30COLOR', fila: 4, kg: 980, condicion: 'COLOR', mfi: 1.8 },
];
const CLIENTES = [{ id: 'cli_1', nombre: 'RPCI' }, { id: 'cli_2', nombre: 'MALUPLAST' }];

function base(url) {
  if (url.indexOf('action=clientes') !== -1) return CLIENTES;
  if (url.indexOf('action=logo') !== -1) return { logo: '' };
  if (url.indexOf('action=stock') !== -1) return SACAS.slice();
  return { ok: true, mensaje: 'Preparación registrada (1.00 t). Fecha de despacho pendiente.', cantidad: 1 };
}
async function conClientes(respuestas) {
  const entorno = cargar(respuestas || base);
  set(entorno.ctx, 'TOKEN', '1234');
  entorno.ctx.cargarClientes();
  await esperar();
  return entorno;
}

test('el cliente es un desplegable del maestro con opción inicial vacía', async () => {
  const { dom, ctx } = await conClientes();
  const sel = dom('cliente');
  assert.strictEqual(sel.children[0].value, '', 'opción inicial sin cliente');
  assert.match(String(sel.children[0].text), /Seleccionar cliente/i);
  assert.deepStrictEqual(sel.children.slice(1).map(function (o) { return o.value; }), ['RPCI', 'MALUPLAST']);
  assert.match(dom('clientes-estado').textContent, /2 clientes/);
  assert.strictEqual(leer(ctx, 'clienteSeleccionado()'), '', 'sin elegir no hay cliente válido');
  assert.strictEqual(dom('btn-enviar').disabled, true, 'sin sacas y sin cliente no se registra');
});

test('el modo es único: cambiarModo("pedido") no reabre el pedido del planificador', async () => {
  const { ctx, dom } = await conClientes();
  ctx.cambiarModo('pedido');
  assert.strictEqual(ctx.esModoCliente(), true, 'sigue en modo cliente');
  assert.strictEqual(dom('pedido-id').value, '', 'no hay pedido seleccionable');
  assert.strictEqual(dom('cliente').children[0].value, '', 'el desplegable de clientes se conserva');
});

test('envía modo=cliente sin pedidoId y toma los kilos de la saca', async () => {
  const { ctx, dom, llamadas } = await conClientes();
  dom('fecha').value = '2026-11-09';
  dom('responsable').value = 'Willians T.';
  dom('cliente').value = 'RPCI';
  set(ctx, 'seleccionadas', { '261105A1': SACAS[0] });
  ctx.enviar();
  await esperar();
  const post = llamadas.find(function (l) { return l.opts && l.opts.method === 'POST'; });
  assert.ok(post, 'hizo POST');
  const cuerpo = JSON.parse(post.opts.body);
  assert.strictEqual(cuerpo.modo, 'cliente');
  assert.strictEqual(cuerpo.pedidoId, undefined, 'no inventa pedido');
  assert.strictEqual(cuerpo.cliente, 'RPCI');
  assert.deepStrictEqual(cuerpo.series.map(function (s) { return s.serie; }), ['261105A1']);
  assert.strictEqual(cuerpo.token, '1234');
  assert.match(dom('mensaje').textContent, /RPCI/);
  assert.match(dom('mensaje').textContent, /fecha de despacho/i);
});

test('el error del servidor se muestra sin borrar la selección ni el botón', async () => {
  const { ctx, dom } = await conClientes(function (url) {
    if (url.indexOf('action=') !== -1) return base(url);
    return { ok: false, error: 'Saca ya reservada por pc_otra. Actualice el stock.' };
  });
  dom('fecha').value = '2026-11-09';
  dom('responsable').value = 'Willians T.';
  dom('cliente').value = 'RPCI';
  set(ctx, 'seleccionadas', { '261105A1': SACAS[0] });
  ctx.enviar();
  await esperar();
  assert.match(dom('mensaje').textContent, /No se registró: Saca ya reservada por pc_otra/);
  assert.strictEqual(dom('mensaje').className, 'error');
  assert.ok(leer(ctx, "!!seleccionadas['261105A1']"), 'conserva la saca para reintentar');
  assert.strictEqual(dom('btn-enviar').textContent, 'Preparar sacas');
});

test('un cliente fuera del maestro no sirve y no se envía nada', async () => {
  const { ctx, dom, llamadas } = await conClientes();
  dom('fecha').value = '2026-11-09';
  dom('responsable').value = 'Willians T.';
  dom('cliente').value = 'CLIENTE INVENTADO';
  set(ctx, 'seleccionadas', { '261105A1': SACAS[0] });
  ctx.enviar();
  await esperar();
  assert.match(dom('mensaje').textContent, /Selecciona el cliente de la lista/);
  assert.ok(!llamadas.some(function (l) { return l.opts && l.opts.method === 'POST'; }));
});

test('sin maestro disponible el registro queda bloqueado', async () => {
  const { ctx, dom } = await conClientes(function (url) {
    if (url.indexOf('action=clientes') !== -1) return { ok: false, error: 'sin permisos' };
    return base(url);
  });
  assert.match(dom('clientes-estado').textContent, /No se pudo cargar la lista de clientes/);
  assert.strictEqual(leer(ctx, 'clientesMaestro.length'), 0);
  assert.strictEqual(leer(ctx, 'clienteSeleccionado()'), '');
  assert.strictEqual(dom('btn-enviar').disabled, true);
});
