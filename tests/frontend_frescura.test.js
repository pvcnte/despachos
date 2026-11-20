'use strict';
// El lector QR mostraba el stock sin decir cuán viejo era: si alguien cambiaba la
// hoja de Sheets, el operador no tenía cómo saber si lo que veía era de hace un
// minuto o de hace una hora. Se consulta action=frescura tras cada carga de stock
// y se muestra "Stock actualizado hace X min (HH:MM)". Si el backend no responde
// ok, se avisa sin romper la lista ya pintada.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const FUENTE = path.join(__dirname, '..', 'index.html');
const STOCK = [{ serie: 'S1', descripcion: 'PCR20', condicion: 'STD', kg: 100 }];

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
  const fetch = function (url) {
    llamadas.push(String(url));
    if (String(url).indexOf('action=frescura') !== -1) {
      const respuesta = typeof op.frescura === 'function' ? op.frescura() : op.frescura;
      return Promise.resolve({ json: function () { return Promise.resolve(respuesta); } });
    }
    if (String(url).indexOf('action=stock') !== -1) {
      return Promise.resolve({ json: function () { return Promise.resolve(STOCK); } });
    }
    return Promise.resolve({ json: function () { return Promise.resolve([]); } });
  };
  const intervalos = [];
  const almacen = {
    datos: {},
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(this.datos, k) ? this.datos[k] : null; },
    setItem: function (k, v) { this.datos[k] = String(v); },
  };

  const sandbox = {
    console: console,
    document: {
      getElementById: crear,
      querySelectorAll: function () { return []; },
      addEventListener: function () { },
      createElement: function () { return crear('nuevo_' + Math.random()); },
    },
    window: {},
    setInterval: function (fn, ms) { intervalos.push(ms); return intervalos.length; },
    setTimeout: function () { return 0; },
    fetch: fetch,
    Option: function (t, v) { this.text = t; this.value = v; },
    navigator: {},
    localStorage: almacen,
  };
  vm.createContext(sandbox);
  const html = fs.readFileSync(FUENTE, 'utf8');
  const bloques = html.match(/<script>[\s\S]*?<\/script>/g) || [];
  const codigo = bloques[bloques.length - 1].replace(/^<script>/, '').replace(/<\/script>$/, '');
  vm.runInContext(codigo, sandbox, { filename: 'index.html' });
  return { ctx: sandbox, dom: crear, llamadas: llamadas, intervalos: intervalos };
}
function leer(ctx, expr) { return vm.runInContext(expr, ctx); }
const esperar = () => new Promise(function (r) { setTimeout(r, 0); });
async function asentar() { for (let i = 0; i < 6; i++) await esperar(); }

test('frescura con at de hace 5 min: muestra "hace 5 min" y el stock se pinta igual', async () => {
  const at = new Date(Date.now() - 5 * 60000);
  const c = cargar({
    frescura: { ok: true, at: at.toISOString(), display_at: 'x', ahora: new Date().toISOString() },
  });
  c.ctx.cargarStock();
  await asentar();

  const texto = c.dom('frescura-stock').textContent;
  assert.match(texto, /Stock actualizado hace 5 min \(\d\d:\d\d\)/, 'texto de frescura: ' + texto);
  assert.ok(c.llamadas.some(function (u) { return u.indexOf('action=frescura') !== -1; }),
    'consultó action=frescura tras cargar el stock');
  assert.match(c.dom('lista-series').innerHTML, /S1/, 'el stock se pintó igual');
});

test('frescura ok:false: avisa que no está disponible sin romper el stock', async () => {
  const c = cargar({ frescura: { ok: false, error: 'sin dato' } });
  c.ctx.cargarStock();
  await asentar();

  assert.strictEqual(c.dom('frescura-stock').textContent, 'Hora de actualización no disponible');
  assert.match(c.dom('lista-series').innerHTML, /S1/, 'el stock se pintó igual');
});

test('frescura sin red: mismo aviso y el stock queda visible', async () => {
  const c = cargar({ frescura: function () { throw new Error('sin red'); } });
  c.ctx.cargarStock();
  await asentar();

  assert.strictEqual(c.dom('frescura-stock').textContent, 'Hora de actualización no disponible');
  assert.match(c.dom('lista-series').innerHTML, /S1/);
});

test('el stock se refresca cada 2 min y los minutos se recalculan cada 30 s', async () => {
  const c = cargar({ frescura: { ok: true, at: new Date().toISOString(), display_at: 'x', ahora: '' } });
  c.ctx.iniciarApp();
  await asentar();

  assert.ok(c.intervalos.indexOf(120000) !== -1, 'refresco de stock cada 120000 ms');
  assert.ok(c.intervalos.indexOf(600000) === -1, 'ya no cada 10 min');
  assert.ok(c.intervalos.indexOf(30000) !== -1, 'recálculo del texto cada 30000 ms');
});

test('pintarFrescura recalcula los minutos sin volver a consultar', async () => {
  const c = cargar({ frescura: { ok: true, at: new Date().toISOString(), display_at: 'x', ahora: '' } });
  c.ctx.cargarStock();
  await asentar();
  assert.match(c.dom('frescura-stock').textContent, /hace menos de 1 min/);

  const consultas = c.llamadas.filter(function (u) { return u.indexOf('action=frescura') !== -1; }).length;
  leer(c.ctx, 'frescuraAt = frescuraAt - 3 * 60000; pintarFrescura();');
  assert.match(c.dom('frescura-stock').textContent, /hace 3 min/);
  assert.strictEqual(
    c.llamadas.filter(function (u) { return u.indexOf('action=frescura') !== -1; }).length,
    consultas, 'no consultó de nuevo');
});
