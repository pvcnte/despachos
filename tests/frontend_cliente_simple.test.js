'use strict';
// QR simplificado: preparación por cliente con desplegable del maestro y sin
// pedido del planificador. No cubre entrega: el QR solo prepara/reserva.
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
  return { ok: true, mensaje: 'Preparación registrada (1.00 t). Fecha de despacho pendiente.', cantidad: 1 };
}

test('sin pedido del planificador: no queda UI ni llamada de pedidos', () => {
  const { html } = cargar(base);
  assert.strictEqual(html.indexOf('action=pedidos'), -1, 'no consulta pedidos');
  assert.strictEqual(html.indexOf('id="pedido-id"'), -1, 'no hay selector de pedido');
  assert.strictEqual(html.indexOf('id="btn-vincular"'), -1, 'no hay vinculación');
  assert.strictEqual(html.indexOf('id="clientes-maestro"'), -1, 'el datalist se reemplazó por select');
});

test('el cliente es un desplegable del maestro con opción inicial vacía', async () => {
  const { ctx, dom } = cargar(base);
  set(ctx, 'TOKEN', '1234');
  ctx.cargarClientes();
  await esperar();
  const sel = dom('cliente');
  assert.strictEqual(sel.children[0].value, '', 'opción inicial sin cliente');
  assert.match(String(sel.children[0].text), /Seleccionar cliente/i);
  const valores = sel.children.slice(1, -1).map(function (o) { return o.value; });
  assert.deepStrictEqual(valores, ['RPCI', 'MALUPLAST']);
  assert.match(dom('clientes-estado').textContent, /2 clientes/);
});

test('sin cliente válido no se registra y no hay POST', async () => {
  const { ctx, dom, llamadas } = cargar(base);
  set(ctx, 'TOKEN', '1234');
  ctx.cargarClientes();
  await esperar();
  dom('fecha').value = '2026-11-09';
  dom('responsable').value = 'Willians T.';
  dom('cliente').value = '';
  set(ctx, 'seleccionadas', { '261105A1': SACAS[0] });
  ctx.enviar();
  await esperar();
  assert.match(dom('mensaje').textContent, /Selecciona el cliente de la lista/);
  assert.ok(!llamadas.some(function (l) { return l.opts && l.opts.method === 'POST'; }), 'no envió nada');
});

test('un cliente escrito fuera del maestro no sirve', async () => {
  const { ctx, dom, llamadas } = cargar(base);
  set(ctx, 'TOKEN', '1234');
  ctx.cargarClientes();
  await esperar();
  dom('fecha').value = '2026-11-09';
  dom('responsable').value = 'Willians T.';
  dom('cliente').value = 'CLIENTE INVENTADO';
  set(ctx, 'seleccionadas', { '261105A1': SACAS[0] });
  ctx.enviar();
  await esperar();
  assert.match(dom('mensaje').textContent, /Selecciona el cliente de la lista/);
  assert.ok(!llamadas.some(function (l) { return l.opts && l.opts.method === 'POST'; }));
});

test('registra modo=cliente sin pedidoId y nombra al cliente en la confirmación', async () => {
  const { ctx, dom, llamadas } = cargar(base);
  set(ctx, 'TOKEN', '1234');
  ctx.cargarClientes();
  await esperar();
  dom('fecha').value = '2026-11-09';
  dom('responsable').value = 'Willians T.';
  dom('cliente').value = 'RPCI';
  set(ctx, 'seleccionadas', { '261105A1': SACAS[0], '261105A2': SACAS[1] });
  ctx.enviar();
  await esperar();
  const post = llamadas.find(function (l) { return l.opts && l.opts.method === 'POST'; });
  assert.ok(post, 'hizo POST');
  const cuerpo = JSON.parse(post.opts.body);
  assert.strictEqual(cuerpo.modo, 'cliente');
  assert.strictEqual(cuerpo.pedidoId, undefined, 'no inventa pedido');
  assert.strictEqual(cuerpo.cliente, 'RPCI');
  assert.deepStrictEqual(cuerpo.series.map(function (s) { return s.serie; }), ['261105A1', '261105A2']);
  assert.strictEqual(cuerpo.token, '1234');
  assert.match(dom('mensaje').textContent, /RPCI/);
});

test('error del servidor: mensaje visible, selección y botón conservados', async () => {
  const { ctx, dom } = cargar(function (url) {
    if (url.indexOf('action=') !== -1) return base(url);
    return { ok: false, error: 'Saca ya reservada por pc_otra. Actualice el stock.' };
  });
  set(ctx, 'TOKEN', '1234');
  ctx.cargarClientes();
  await esperar();
  dom('fecha').value = '2026-11-09';
  dom('responsable').value = 'Willians T.';
  dom('cliente').value = 'RPCI';
  set(ctx, 'seleccionadas', { '261105A1': SACAS[0] });
  ctx.enviar();
  await esperar();
  assert.match(dom('mensaje').textContent, /No se registró: Saca ya reservada/);
  assert.strictEqual(dom('mensaje').className, 'error');
  assert.ok(leer(ctx, "!!seleccionadas['261105A1']"), 'conserva la saca para reintentar');
  assert.strictEqual(dom('btn-enviar').textContent, 'Preparar sacas');
});

test('si el maestro no carga, no se habilita el registro', async () => {
  const { ctx, dom } = cargar(function (url) {
    if (url.indexOf('action=clientes') !== -1) return { ok: false, error: 'sin permisos' };
    return base(url);
  });
  set(ctx, 'TOKEN', '1234');
  ctx.cargarClientes();
  await esperar();
  assert.match(dom('clientes-estado').textContent, /No se pudo cargar la lista de clientes/);
  assert.strictEqual(leer(ctx, 'clientesMaestro.length'), 0);
  assert.strictEqual(leer(ctx, 'clienteSeleccionado()'), '');
  assert.strictEqual(dom('btn-enviar').disabled, true);
});

test('Otro cliente…: con texto envía ese nombre recortado; vacío no es válido; la lista sigue igual', async () => {
  const { ctx, dom, llamadas, html } = cargar(base);
  set(ctx, 'TOKEN', '1234');
  ctx.cargarClientes();
  await esperar();
  assert.match(html, /id="cliente-otro"[^>]*maxlength="60"/);
  const sel = dom('cliente');
  assert.strictEqual(sel.children[sel.children.length - 1].text, 'Otro cliente…');
  // cliente de la lista
  sel.value = 'RPCI';
  assert.strictEqual(ctx.clienteSeleccionado(), 'RPCI');
  // Otro cliente… vacío = inválido
  sel.value = sel.children[sel.children.length - 1].value;
  dom('cliente-otro').value = '   ';
  assert.strictEqual(ctx.clienteSeleccionado(), '');
  // Otro cliente… con texto
  dom('cliente-otro').value = '  Plásticos Nuevos SpA ';
  assert.strictEqual(ctx.clienteSeleccionado(), 'Plásticos Nuevos SpA');
  dom('fecha').value = '2026-11-09';
  dom('responsable').value = 'Willians T.';
  set(ctx, 'seleccionadas', { '261105A1': SACAS[0] });
  ctx.enviar();
  await esperar();
  const post = llamadas.find(function (l) { return l.opts && l.opts.method === 'POST'; });
  assert.ok(post, 'hizo POST');
  const cuerpo = JSON.parse(post.opts.body);
  assert.strictEqual(cuerpo.modo, 'cliente');
  assert.strictEqual(cuerpo.cliente, 'Plásticos Nuevos SpA');
});
