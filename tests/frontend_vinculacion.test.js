'use strict';
// Vincular una preparación por cliente ya registrada a un pedido del planificador
// desde la pantalla de preparación: selector, detalle real y un solo POST.
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
const esperar = () => new Promise(function (r) { setTimeout(r, 0); });

const PREPS = [{
  id: 'pc_1', cliente_id: 'cli_rpci', nombre: 'RPCI', fecha_preparacion: '2026-11-05', fecha_despacho: null,
  pedido_id: null, estado: 'preparada', tons: 1.98, sacas: 2,
  series: [{ serie: '261105A1', kg: 1000, condicion: 'STD' }, { serie: '261105A3', kg: 980, condicion: 'COLOR' }],
}];
const PEDIDOS = [
  { id: 'c_rpci', cliente: 'RPCI - OC 8692', fecha: '2026-11-07', producto: 'PCR30', condicion: 'STD', tons: 4, preparado: 0, saldoPreparacion: 4 },
  { id: 'c_otro', cliente: 'MALUPLAST', fecha: '2026-11-07', producto: 'PCR30', condicion: 'STD', tons: 3, preparado: 0, saldoPreparacion: 3 },
];
function base(url) {
  if (url.indexOf('action=preparaciones') !== -1) return PREPS;
  if (url.indexOf('action=pedidos') !== -1) return PEDIDOS;
  if (url.indexOf('action=clientes') !== -1) return [{ id: 'cli_rpci', nombre: 'RPCI' }];
  if (url.indexOf('action=stock') !== -1) return [];
  if (url.indexOf('action=logo') !== -1) return { logo: '' };
  return { ok: true, tons: 1.98, estado: 'vinculada', mensaje: 'Preparación vinculada al pedido: 2 sacas (1.98 t reales).' };
}
async function conPreparacion(respuestas) {
  const entorno = cargar(respuestas || base);
  set(entorno.ctx, 'TOKEN', '1234');
  set(entorno.ctx, 'pedidosPreparacion', PEDIDOS.slice());
  entorno.ctx.cargarPreparacionesCliente();
  await esperar();
  return entorno;
}

test('vinculación: lista la preparación y solo los pedidos del mismo cliente, con serie, kg y condición', async () => {
  const { ctx, dom } = await conPreparacion();
  assert.match(dom('vincular-prep').innerHTML, /RPCI/);
  assert.strictEqual(dom('btn-vincular').disabled, true, 'sin preparación elegida no se puede vincular');
  dom('vincular-prep').value = 'pc_1';
  ctx.renderVinculacion();
  assert.match(dom('vincular-pedido').innerHTML, /c_rpci/);
  assert.doesNotMatch(dom('vincular-pedido').innerHTML, /c_otro/, 'no ofrece pedidos de otro cliente');
  const detalle = dom('vincular-detalle').innerHTML;
  assert.match(detalle, /261105A1/);
  assert.match(detalle, /1\.000 kg/);
  assert.match(detalle, /Color/);
  assert.match(detalle, /Estándar/);
  assert.match(detalle, /Fecha de despacho: pendiente/);
  assert.strictEqual(dom('btn-vincular').disabled, true, 'sin pedido elegido no se puede vincular');
});

test('vinculación: un solo POST con prepId y pedidoId, y muestra el resultado', async () => {
  const { ctx, dom, llamadas } = await conPreparacion();
  dom('vincular-prep').value = 'pc_1';
  ctx.renderVinculacion();
  dom('vincular-pedido').value = 'c_rpci';
  dom('responsable').value = 'Willians T.';
  ctx.vincularPreparacion();
  await esperar();
  const posts = llamadas.filter((l) => l.opts && l.opts.method === 'POST');
  assert.strictEqual(posts.length, 1);
  const cuerpo = JSON.parse(posts[0].opts.body);
  assert.strictEqual(cuerpo.modo, 'vincular_cliente');
  assert.strictEqual(cuerpo.prepId, 'pc_1');
  assert.strictEqual(cuerpo.pedidoId, 'c_rpci');
  assert.strictEqual(cuerpo.fecha_despacho, undefined, 'no inventa fecha de despacho');
  assert.match(dom('mensaje').textContent, /vinculada/i);
  assert.strictEqual(dom('mensaje').className, 'ok');
});

test('vinculación: doble clic no envía dos veces', async () => {
  const { ctx, dom, llamadas } = await conPreparacion();
  dom('vincular-prep').value = 'pc_1';
  ctx.renderVinculacion();
  dom('vincular-pedido').value = 'c_rpci';
  dom('responsable').value = 'Willians T.';
  ctx.vincularPreparacion();
  ctx.vincularPreparacion();
  await esperar();
  assert.strictEqual(llamadas.filter((l) => l.opts && l.opts.method === 'POST').length, 1);
});

test('vinculación: el error del servidor se muestra y no borra la selección', async () => {
  const { ctx, dom } = await conPreparacion(function (url) {
    if (url.indexOf('action=') !== -1) return base(url);
    return { ok: false, error: 'Sacas que no corresponden al pedido PCR20 STD: 261105A1' };
  });
  dom('vincular-prep').value = 'pc_1';
  ctx.renderVinculacion();
  dom('vincular-pedido').value = 'c_rpci';
  dom('responsable').value = 'Willians T.';
  ctx.vincularPreparacion();
  await esperar();
  assert.match(dom('mensaje').textContent, /No se vinculó: Sacas que no corresponden/);
  assert.strictEqual(dom('mensaje').className, 'error');
  assert.strictEqual(dom('vincular-prep').value, 'pc_1', 'conserva la preparación elegida');
});

test('vinculación: sin responsable no envía nada', async () => {
  const { ctx, dom, llamadas } = await conPreparacion();
  dom('vincular-prep').value = 'pc_1';
  ctx.renderVinculacion();
  dom('vincular-pedido').value = 'c_rpci';
  dom('responsable').value = '';
  ctx.vincularPreparacion();
  await esperar();
  assert.strictEqual(llamadas.filter((l) => l.opts && l.opts.method === 'POST').length, 0);
  assert.match(dom('mensaje').textContent, /responsable/);
});
