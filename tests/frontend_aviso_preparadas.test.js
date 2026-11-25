'use strict';
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
      children: [], src: '', options: [], listeners: {},
      classList: { toggle: function () { }, add: function () { }, remove: function () { } },
      setAttribute: function () { }, getAttribute: function () { return null; },
      querySelector: function () { return { checked: false }; },
      addEventListener: function (ev, fn) { this.listeners[ev] = fn; },
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
const esperar = () => new Promise(function (r) { setTimeout(r, 0); });
async function asentar() { for (let i = 0; i < 4; i++) await esperar(); }

const STOCK = [
  { serie: '261120A1', descripcion: 'PCR30', fila: 2, kg: 1000, condicion: 'STD', mfi: 2.1 },
];
const PREPARADAS = [
  { serie: '261116A1', cliente: 'ANGELPLAST', fecha_preparacion: '2026-11-16', producto: 'PCR30', kg: 1000, condicion: 'STD' },
];

test('buscador: muestra al final las sacas preparadas no despachadas con cliente y fecha', async () => {
  const { ctx, dom } = cargar(function (url) {
    if (url.indexOf('action=stock') !== -1) return STOCK;
    if (url.indexOf('action=preparadas_pendientes') !== -1) return PREPARADAS;
    return { ok: true };
  });
  ctx.cargarStock();
  await asentar();

  // Sin texto de búsqueda: solo aparecen disponibles.
  assert.strictEqual(dom('lista-series').innerHTML.indexOf('ANGELPLAST'), -1);

  // Buscando prefijo común: disponibles arriba, preparadas al final.
  ctx.buscar('2611');
  const html = dom('lista-series').innerHTML;
  const idxDisp = html.indexOf('261120A1');
  const idxSep = html.indexOf('Ya preparadas (no despachadas)');
  const idxPrep = html.indexOf('261116A1');
  assert.ok(idxDisp !== -1 && idxSep !== -1 && idxPrep !== -1);
  assert.ok(idxDisp < idxSep && idxSep < idxPrep, 'las preparadas van al final');
  assert.match(html, /ANGELPLAST/);
  assert.match(html, /16-11-2026/);

  // Buscando solo la saca preparada (0 disponibles): la muestra igual sin vaciar la lista.
  ctx.buscar('261116A1');
  assert.match(dom('lista-series').innerHTML, /261116A1/);
  assert.match(dom('lista-series').innerHTML, /ANGELPLAST/);

  // seleccionarVisibles nunca incluye sacas ya preparadas.
  ctx.seleccionarVisibles();
  assert.deepStrictEqual(Object.keys(vm.runInContext('seleccionadas', ctx)), []);
});


test('escanear saca no disponible: avisa fecha y cliente de la preparación o retiro físico', async () => {
  const { ctx, dom } = cargar(function (url) {
    if (url.indexOf('action=stock') !== -1) return STOCK;
    if (url.indexOf('action=preparadas_pendientes') !== -1) return PREPARADAS;
    if (url.indexOf('action=estado_serie') !== -1 && url.indexOf('261116A1') !== -1) {
      return { ok: true, serie: '261116A1', estado: 'preparada', cliente: 'ANGELPLAST', fecha_preparacion: '2026-11-16' };
    }
    if (url.indexOf('action=estado_serie') !== -1 && url.indexOf('261116A2') !== -1) {
      return {
        ok: true, serie: '261116A2', estado: 'retirada_conteo',
        cliente: 'ANGELPLAST', fecha_preparacion: '2026-11-16', conciliacion: 'conteo_fisico_20261123',
      };
    }
    return { ok: true };
  });

  set(ctx, 'todoStock', STOCK);
  ctx.procesarSerieEscaneada('261116A1');
  await asentar();
  assert.match(dom('serie-escaneada').textContent, /16-11-2026/);
  assert.match(dom('serie-escaneada').textContent, /ANGELPLAST/);
  assert.match(dom('scan-feedback').textContent, /ya preparada/);

  ctx.procesarSerieEscaneada('261116A2');
  await asentar();
  assert.match(dom('serie-escaneada').textContent, /ANGELPLAST/);
  assert.match(dom('serie-escaneada').textContent, /16-11-2026/);
  assert.match(dom('serie-escaneada').textContent, /conteo físico/i);
});


test('escanear saca ya preparada: abre pantalla "SACA YA INGRESADA" con cliente, fecha y líder', async () => {
  const { ctx, dom } = cargar(function (url) {
    if (url.indexOf('action=stock') !== -1) return STOCK;
    if (url.indexOf('action=preparadas_pendientes') !== -1) return [];
    if (url.indexOf('action=estado_serie') !== -1) {
      return { ok: true, serie: '261112B1', estado: 'preparada', cliente: 'PLASTISERVI', fecha_preparacion: '2026-11-20', lider: 'Willians T.' };
    }
    return { ok: true };
  });
  set(ctx, 'todoStock', STOCK);
  ctx.procesarSerieEscaneada('261112B1');
  await asentar();
  assert.strictEqual(dom('modal-saca-ingresada').className, 'visible');
  assert.strictEqual(dom('msi-serie').textContent, '261112B1');
  const datos = dom('msi-datos').innerHTML;
  assert.match(datos, /PLASTISERVI/);
  assert.match(datos, /20-11-2026/);
  assert.match(datos, /Willians T\./);
  assert.match(dom('serie-escaneada').textContent, /líder de turno Willians T\./);
  ctx.cerrarModalSacaIngresada();
  assert.strictEqual(dom('modal-saca-ingresada').className, '');
});

test('saca no en stock sin historial: no abre la pantalla de saca ingresada', async () => {
  const { ctx, dom } = cargar(function (url) {
    if (url.indexOf('action=stock') !== -1) return STOCK;
    if (url.indexOf('action=estado_serie') !== -1) return { ok: true, serie: '269999Z9', estado: 'no_en_stock' };
    return [];
  });
  set(ctx, 'todoStock', STOCK);
  ctx.procesarSerieEscaneada('269999Z9');
  await asentar();
  assert.notStrictEqual(dom('modal-saca-ingresada').className, 'visible');
});
