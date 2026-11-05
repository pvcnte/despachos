'use strict';
// Modo "preparar por cliente (sin pedido)" del QR: maestro de clientes, envío
// modo=cliente y errores seguros (no borran la selección).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const FUENTE = path.join(__dirname, '..', 'index.html');

function cargar(respuestas) {
  const mapa = {};
  const crear = function (id) {
    return mapa[id] || (mapa[id] = {
      id: id, value: '', textContent: '', innerHTML: '', className: '', style: {}, disabled: false,
      classList: { activo: false, toggle: function (c, v) { if (c === 'activo') this.activo = v === undefined ? !this.activo : !!v; } },
      setAttribute: function (k, v) { this[k] = v; },
      querySelector: function () { return { checked: false }; },
      addEventListener: function () { }, append: function () { }, replaceChildren: function () { }, focus: function () { },
    });
  };
  const llamadas = [];
  const fetch = function (url, opts) {
    llamadas.push({ url: url, opts: opts || null });
    const cuerpo = opts && opts.body ? JSON.parse(opts.body) : null;
    const handler = respuestas(url, cuerpo);
    return Promise.resolve({ json: function () { return Promise.resolve(handler); } });
  };
  const sandbox = {
    console,
    document: {
      getElementById: crear,
      querySelectorAll: function () { return []; },
      addEventListener: function () { },
      createElement: function () { return crear('nuevo_' + Math.random()); },
    },
    window: {}, setInterval: function () { return 0; }, setTimeout: function () { return 0; },
    fetch: fetch, Option: function (t, v) { this.text = t; this.value = v; }, navigator: {}, Html5Qrcode: undefined,
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
  if (url.indexOf('action=pedidos') !== -1) return [];
  if (url.indexOf('action=logo') !== -1) return { logo: '' };
  if (url.indexOf('action=stock') !== -1) return SACAS.slice();
  return { ok: true, mensaje: 'Preparación registrada (1.00 t). Fecha de despacho pendiente.', cantidad: 1 };
}

test('modo cliente: oculta el pedido y ofrece el maestro histórico sin exigir selección', async () => {
  const { ctx, dom, llamadas } = cargar(base);
  set(ctx, 'TOKEN', '1234');
  set(ctx, 'todoStock', SACAS.slice());
  ctx.cambiarModo('cliente');
  await esperar();
  assert.strictEqual(dom('pedido-id').style.display, 'none');
  assert.strictEqual(ctx.esModoCliente(), true);
  assert.match(dom('clientes-maestro').innerHTML, /RPCI/);
  assert.match(dom('clientes-maestro').innerHTML, /MALUPLAST/);
  assert.match(dom('clientes-estado').textContent, /2 clientes/);
  assert.ok(llamadas.some((l) => l.url.indexOf('action=clientes') !== -1 && !l.opts), 'solo consulta GET del maestro');
  assert.strictEqual(dom('btn-enviar').disabled, true, 'sin sacas no se puede registrar');
});

test('modo cliente: envía modo=cliente sin pedidoId y toma los kilos de la saca', async () => {
  const { ctx, dom, llamadas } = cargar(base);
  set(ctx, 'TOKEN', '1234');
  set(ctx, 'todoStock', SACAS.slice());
  ctx.cambiarModo('cliente');
  dom('fecha').value = '2026-11-05';
  dom('responsable').value = 'Willians T.';
  dom('cliente').value = 'RPCI';
  set(ctx, 'seleccionadas', { '261105A1': SACAS[0] });
  ctx.enviar();
  await esperar();
  const post = llamadas.find((l) => l.opts && l.opts.method === 'POST');
  assert.ok(post, 'hizo POST');
  const cuerpo = JSON.parse(post.opts.body);
  assert.strictEqual(cuerpo.modo, 'cliente');
  assert.strictEqual(cuerpo.pedidoId, undefined, 'no inventa pedido');
  assert.strictEqual(cuerpo.cliente, 'RPCI');
  assert.deepStrictEqual(cuerpo.series.map((s) => s.serie), ['261105A1']);
  assert.match(dom('mensaje').textContent, /fecha de despacho/i);
});

test('modo cliente: el error del servidor se muestra sin borrar la selección', async () => {
  const { ctx, dom } = cargar(function (url) {
    if (url.indexOf('action=') !== -1) return base(url);
    return { ok: false, error: 'Saca ya reservada por pc_otra. Actualice el stock.' };
  });
  set(ctx, 'TOKEN', '1234');
  set(ctx, 'todoStock', SACAS.slice());
  ctx.cambiarModo('cliente');
  dom('fecha').value = '2026-11-05';
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

test('modo cliente: al volver a "Con pedido" reaparece el selector y exige pedido', async () => {
  const { ctx, dom } = cargar(base);
  set(ctx, 'TOKEN', '1234');
  set(ctx, 'todoStock', SACAS.slice());
  ctx.cambiarModo('cliente');
  await esperar();
  ctx.cambiarModo('pedido');
  assert.strictEqual(dom('pedido-id').style.display, '');
  assert.strictEqual(ctx.esModoCliente(), false);
  dom('fecha').value = '2026-11-05';
  dom('responsable').value = 'Willians T.';
  dom('cliente').value = 'RPCI';
  set(ctx, 'seleccionadas', { '261105A1': SACAS[0] });
  ctx.enviar();
  await esperar();
  assert.match(dom('mensaje').textContent, /Completa todos los campos/);
});
