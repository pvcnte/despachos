'use strict';
// Pruebas del frontend del QR (index.html de pvcnte/despachos).
// Extrae el script embebido y lo ejecuta en un contexto con DOM simulado.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const FUENTE = path.join(__dirname, '..', 'index.html');

function elementos() {
  const mapa = {};
  const crear = function (id) {
    return mapa[id] || (mapa[id] = {
      id: id, value: '', textContent: '', innerHTML: '', className: '', style: {}, disabled: false,
      classList: { add: function () { }, remove: function () { }, toggle: function () { } },
      querySelector: function () { return { checked: false }; },
      addEventListener: function () { }, append: function () { }, replaceChildren: function () { }, focus: function () { },
    });
  };
  return { mapa, crear };
}
function cargar() {
  const dom = elementos();
  const sandbox = {
    console,
    document: {
      getElementById: dom.crear,
      querySelectorAll: function () { return []; },
      addEventListener: function () { },
      createElement: function () { return dom.crear('nuevo_' + Math.random()); },
    },
    window: {},
    setInterval: function () { return 0; },
    setTimeout: function () { return 0; },
    fetch: function () { return Promise.resolve({ json: function () { return Promise.resolve([]); } }); },
    Option: function (texto, valor) { this.text = texto; this.value = valor; },
    navigator: {},
    Html5Qrcode: undefined,
  };
  vm.createContext(sandbox);
  const html = fs.readFileSync(FUENTE, 'utf8');
  const bloques = html.match(/<script>([\s\S]*?)<\/script>/g) || [];
  assert.ok(bloques.length, 'index.html debe traer su script embebido');
  const codigo = bloques[bloques.length - 1].replace(/^<script>/, '').replace(/<\/script>$/, '');
  vm.runInContext(codigo, sandbox, { filename: 'index.html' });
  sandbox.document.getElementById = dom.crear;
  return { ctx: sandbox, dom };
}
function set(ctx, nombre, valor) { ctx.__v = valor; vm.runInContext(nombre + ' = __v;', ctx); }

const SACAS = [
  { serie: '261105A1', descripcion: 'PCR30', fila: 2, kg: 1000, condicion: 'STD', mfi: 2.1 },
  { serie: '261105A3', descripcion: 'PCR30COLOR', fila: 4, kg: 980, condicion: 'COLOR', mfi: 1.8 },
];
const PEDIDO = { id: 'c_1', cliente: 'RPCI', producto: 'PCR30', condicion: 'STD', tons: 2, preparado: 0, saldoPreparacion: 2, modoExceso: 'aviso', sustituto: '', mfiMin: '', mfiMax: '' };

function conPedido(extra) {
  const { ctx, dom } = cargar();
  set(ctx, 'todoStock', SACAS.slice());
  set(ctx, 'pedidosPreparacion', [Object.assign({}, PEDIDO, extra || {})]);
  dom.crear('pedido-id').value = 'c_1';
  return { ctx, dom };
}

test('lista: muestra la condición y el peso de cada saca', () => {
  const { ctx, dom } = conPedido();
  ctx.render();
  const html = dom.crear('lista-series').innerHTML;
  assert.match(html, /261105A1/);
  assert.match(html, /serie-cond std">Estándar/);
  assert.match(html, /serie-cond color">Color/);
  assert.match(html, /1000 kg/);
});

test('lista: la saca que no calza se marca pero no se oculta', () => {
  const { ctx, dom } = conPedido();
  ctx.render();
  const html = dom.crear('lista-series').innerHTML;
  assert.match(html, /261105A1/);
  assert.match(html, /261105A3/, 'la saca Color sigue visible');
  assert.match(html, /no-calza[\s\S]*261105A3/);
  assert.match(html, /No calza con el pedido PCR30 Estándar/);
});

test('evaluarSeleccion: saldo, exceso y sacas sobrantes', () => {
  const pedido = Object.assign({}, PEDIDO, { tons: 1.5, saldoPreparacion: 1.5 });
  const { ctx } = conPedido({ tons: 1.5, saldoPreparacion: 1.5 });
  const sel = { '261105A1': SACAS[0], '261105A3': Object.assign({}, SACAS[1], { condicion: 'STD', descripcion: 'PCR30' }) };
  const ev = ctx.evaluarSeleccion(pedido, sel);
  assert.strictEqual(ev.total, 1.98);
  assert.ok(Math.abs(ev.exceso - 0.48) < 1e-8);
  assert.strictEqual(ev.sobran, 1);
  assert.strictEqual(ev.incompatibles.length, 0);
});

test('compatibilidad: misma condición y producto, o sustituto dentro del rango MFI', () => {
  const { ctx } = conPedido({ producto: 'PCR20', sustituto: 'PCR30', mfiMin: 1.5, mfiMax: 2.2 });
  assert.strictEqual(ctx.sacaCompatiblePedido(SACAS[0], Object.assign({}, PEDIDO, { producto: 'PCR20', sustituto: 'PCR30', mfiMin: 1.5, mfiMax: 2.2 })), true);
  assert.strictEqual(ctx.sacaCompatiblePedido(SACAS[0], Object.assign({}, PEDIDO, { producto: 'PCR20', sustituto: 'PCR30', mfiMin: 2.5, mfiMax: 3 })), false);
  assert.strictEqual(ctx.sacaCompatiblePedido(SACAS[1], PEDIDO), false, 'Color no calza con pedido STD');
});

test('botón: bloquea con sacas incompatibles y con exceso en modo bloqueo', () => {
  let { ctx, dom } = conPedido({ tons: 1, saldoPreparacion: 1 });
  set(ctx, 'seleccionadas', { '261105A3': SACAS[1] });
  ctx.actualizarContador();
  assert.strictEqual(dom.crear('btn-enviar').disabled, true, 'Color contra pedido STD bloquea');
  assert.match(dom.crear('aviso-pedido').textContent, /no calzan con este pedido/);

  ({ ctx, dom } = conPedido({ tons: 1, saldoPreparacion: 1, modoExceso: 'aviso' }));
  set(ctx, 'seleccionadas', { '261105A1': SACAS[0], '261105A3': Object.assign({}, SACAS[1], { condicion: 'STD', descripcion: 'PCR30' }) });
  ctx.actualizarContador();
  assert.strictEqual(dom.crear('btn-enviar').disabled, false, 'modo aviso no bloquea');
  assert.match(dom.crear('aviso-pedido').textContent, /sobran 1 saca/, 'pero muestra el exceso');

  ({ ctx, dom } = conPedido({ tons: 1, saldoPreparacion: 1, modoExceso: 'bloqueo' }));
  set(ctx, 'seleccionadas', { '261105A1': SACAS[0], '261105A3': Object.assign({}, SACAS[1], { condicion: 'STD', descripcion: 'PCR30' }) });
  ctx.actualizarContador();
  assert.strictEqual(dom.crear('btn-enviar').disabled, true, 'modo bloqueo rechaza el exceso');
});
