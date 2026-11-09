'use strict';
// El QR público ya no vincula preparaciones a pedidos del planificador: estas
// pruebas fijan la AUSENCIA de esa UI, de sus GET y de su POST, y conservan la
// cobertura de doble clic y de error en el registro de la preparación por cliente.
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
  return { ctx: sandbox, dom: crear, llamadas: llamadas, html: html };
}
function set(ctx, nombre, valor) { ctx.__v = valor; vm.runInContext(nombre + ' = __v;', ctx); }
const esperar = () => new Promise(function (r) { setTimeout(r, 0); });

const SACAS = [{ serie: '261105A1', descripcion: 'PCR30', fila: 2, kg: 1000, condicion: 'STD', mfi: 2.1 }];
const CLIENTES = [{ id: 'cli_1', nombre: 'RPCI' }];
function base(url) {
  if (url.indexOf('action=clientes') !== -1) return CLIENTES;
  if (url.indexOf('action=logo') !== -1) return { logo: '' };
  if (url.indexOf('action=stock') !== -1) return SACAS.slice();
  return { ok: true, mensaje: 'Preparación registrada (1.00 t). Fecha de despacho pendiente.', cantidad: 1 };
}
async function listo(respuestas) {
  const entorno = cargar(respuestas || base);
  set(entorno.ctx, 'TOKEN', '1234');
  entorno.ctx.cargarClientes();
  await esperar();
  entorno.dom('fecha').value = '2026-11-09';
  entorno.dom('responsable').value = 'Willians T.';
  entorno.dom('cliente').value = 'RPCI';
  set(entorno.ctx, 'seleccionadas', { '261105A1': SACAS[0] });
  return entorno;
}

test('no existe UI de vinculación ni selector de pedido en el documento', () => {
  const { html } = cargar(base);
  ['id="pedido-id"', 'id="vincular-prep"', 'id="vincular-pedido"', 'id="btn-vincular"', 'id="card-vincular"']
    .forEach(function (marca) { assert.strictEqual(html.indexOf(marca), -1, 'no debe quedar ' + marca); });
});

test('no se consultan pedidos ni preparaciones del planificador', async () => {
  const { llamadas, ctx } = await listo();
  ctx.cargarStock();
  await esperar();
  const prohibidas = llamadas.filter(function (l) {
    return l.url.indexOf('action=pedidos') !== -1 || l.url.indexOf('action=preparaciones') !== -1;
  });
  assert.deepStrictEqual(prohibidas, [], 'solo stock, logo y clientes');
  assert.ok(llamadas.some(function (l) { return l.url.indexOf('action=clientes') !== -1; }), 'sí consulta clientes');
});

test('cambiarModo("pedido") no reabre el pedido ni dispara consultas', async () => {
  const { ctx, llamadas } = await listo();
  const antes = llamadas.length;
  ctx.cambiarModo('pedido');
  await esperar();
  assert.strictEqual(ctx.esModoCliente(), true);
  assert.strictEqual(llamadas.length, antes, 'no dispara GET de pedidos');
});

test('el POST nunca lleva vincular_cliente ni pedidoId', async () => {
  const { ctx, llamadas } = await listo();
  ctx.enviar();
  await esperar();
  const post = llamadas.find(function (l) { return l.opts && l.opts.method === 'POST'; });
  assert.ok(post, 'hizo POST de preparación');
  const cuerpo = JSON.parse(post.opts.body);
  assert.strictEqual(cuerpo.modo, 'cliente');
  assert.strictEqual(cuerpo.pedidoId, undefined);
  assert.strictEqual(cuerpo.prepId, undefined, 'no vincula preparaciones');
  assert.ok(!JSON.stringify(cuerpo).includes('vincular_cliente'));
});

test('doble clic mientras el POST está en vuelo no duplica el registro', async () => {
  const { ctx, dom, llamadas } = await listo();
  // fetch controlado: la respuesta queda pendiente hasta que la resolvemos.
  let resolver = null;
  const real = ctx.fetch;
  ctx.fetch = function (url, opts) {
    const llamada = real(url, opts);
    return new Promise(function (r) { resolver = function () { r(llamada); }; });
  };
  ctx.enviar();
  ctx.enviar();
  ctx.enviar();
  const enVuelo = llamadas.filter(function (l) { return l.opts && l.opts.method === 'POST'; });
  assert.strictEqual(enVuelo.length, 1, 'tres clics seguidos = un solo POST');
  assert.strictEqual(vm.runInContext('enviando', ctx), true, 'el guard queda activo mientras espera');
  assert.strictEqual(dom('btn-enviar').disabled, true, 'actualizarContador respeta el envío en curso');
  ctx.actualizarContador();
  assert.strictEqual(dom('btn-enviar').disabled, true, 'ni un refresco rehabilita el botón');
  resolver();
  await esperar();
  await esperar();
  assert.strictEqual(vm.runInContext('enviando', ctx), false, 'el guard se libera al completar');
  assert.strictEqual(dom('btn-enviar').textContent, 'Preparar sacas');
});

test('un error de preparación no borra la selección y permite reintentar', async () => {
  const { ctx, dom, llamadas } = await listo(function (url) {
    if (url.indexOf('action=') !== -1) return base(url);
    return { ok: false, error: 'Saca no disponible para preparar: 261105A1' };
  });
  ctx.enviar();
  await esperar();
  assert.match(dom('mensaje').textContent, /No se registró: Saca no disponible para preparar/);
  assert.strictEqual(dom('mensaje').className, 'error');
  assert.ok(vm.runInContext("!!seleccionadas['261105A1']", ctx), 'conserva la selección');
  assert.strictEqual(vm.runInContext('enviando', ctx), false, 'libera el guard tras el error del servidor');
  const posts = llamadas.filter(function (l) { return l.opts && l.opts.method === 'POST'; });
  assert.strictEqual(posts.length, 1, 'un solo intento por clic');
});

test('fallo de red: resultado incierto, sin reintento automático', async () => {
  const { ctx, dom, llamadas } = await listo();
  ctx.fetch = function (url, opts) {
    if (opts && opts.method === 'POST') return Promise.reject(new Error('Failed to fetch'));
    return Promise.resolve({ json: function () { return Promise.resolve(base(url)); } });
  };
  ctx.enviar();
  await esperar();
  await esperar();
  assert.match(dom('mensaje').textContent, /No se pudo confirmar: Failed to fetch/);
  assert.match(dom('mensaje').textContent, /La selección se conserva/);
  assert.strictEqual(dom('mensaje').className, 'error');
  assert.strictEqual(vm.runInContext('enviando', ctx), false, 'libera el guard para que el operador decida');
  assert.ok(vm.runInContext("!!seleccionadas['261105A1']", ctx), 'conserva la selección');
  const posts = llamadas.filter(function (l) { return l.opts && l.opts.method === 'POST'; });
  assert.strictEqual(posts.length, 0, 'el fetch simulado rechazó: no hay reintento automático');
});
