import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { isMoneyAmount, splitAcrossDays, sumSaleMetrics, billingDate, billingDates } from './calculations.js';
import { Product, Sale } from './models.js';
import { pendingChargeDates } from './subscriptions.js';

test('accepts monetary values with at most two decimal places', () => {
  assert.equal(isMoneyAmount(10.01), true);
  assert.equal(isMoneyAmount(10), true);
  assert.equal(isMoneyAmount(10.001), false);
  assert.equal(isMoneyAmount(-0.01), false);
});

test('Mongoose accepts decimal amounts and nullable realized sale values', () => {
  const product = new Product({ nombre: 'Test', precio: 10.25 });
  const promo = new Product({ nombre: 'Test x2', precio: 19.9, productoBaseId: new mongoose.Types.ObjectId(), unidadesPorVenta: 2 });
  const sale = new Sale({
    nombre: 'Test',
    productoId: new mongoose.Types.ObjectId(),
    productoNombre: 'Test',
    precioUnitario: 10.25,
    cantidad: 1,
    fecha: new Date(),
    valorEsperado: 10.25,
    valorReal: null
  });
  const invalidProduct = new Product({ nombre: 'Test', precio: 10.256 });

  assert.equal(product.validateSync(), undefined);
  assert.equal(promo.validateSync(), undefined);
  assert.equal(product.unidadesPorVenta, 1);
  assert.equal(promo.unidadesPorVenta, 2);
  assert.equal(sale.validateSync(), undefined);
  assert.ok(invalidProduct.validateSync()?.errors.precio);
});

test('distributes a long expense and puts rounding remainder on the last day', () => {
  assert.deepEqual(splitAcrossDays(100000, '2026-10-01', '2026-10-03'), [33333, 33333, 33334]);
});

test('distributes decimal long expenses exactly to the cent', () => {
  const distribution = splitAcrossDays(10.01, '2026-10-01', '2026-10-03');
  assert.deepEqual(distribution, [3.33, 3.33, 3.35]);
  assert.equal(distribution.reduce((sum, amount) => sum + amount, 0), 10.01);
});

test('calculates sale totals by state without losing registered expectation', () => {
  const totals = sumSaleMetrics([
    { estado: 'pagada', valorEsperado: 100, valorReal: 100 },
    { estado: 'pagada', valorEsperado: 25, valorReal: null },
    { estado: 'pagada', valorEsperado: 10, valorReal: 0 },
    { estado: 'en_espera', valorEsperado: 50 },
    { estado: 'devuelta', valorEsperado: 20, costoFlete: 5 },
    { estado: 'cancelada', valorEsperado: 10 }
  ]);
  assert.equal(totals.esperadoRegistrado, 215);
  assert.equal(totals.real, 125);
  assert.equal(totals.porCobrar, 50);
  assert.equal(totals.fletes, 5);
});

test('keeps monthly subscription dates anchored to the original day', () => {
  const anchor = new Date('2026-01-31T05:00:00.000Z');
  assert.equal(billingDate(anchor, 1, 'mensual').toISOString().slice(0, 10), '2026-02-28');
  assert.equal(billingDate(anchor, 2, 'mensual').toISOString().slice(0, 10), '2026-03-31');
});

test('generates the charge of the day after the last automatic run', () => {
  const monthly = { fechaInicio: new Date('2026-10-05T05:00:00Z'), activaDesde: new Date('2026-10-05T05:00:00Z'), frecuencia: 'mensual' };
  const dates = (generadoHasta, now) => pendingChargeDates({ ...monthly, generadoHasta }, new Date(now)).map((date) => date.toISOString().slice(0, 10));
  assert.deepEqual(dates('2026-11-04T19:05:00Z', '2026-11-06T14:00:00Z'), ['2026-11-05']);
  assert.deepEqual(dates('2026-11-06T14:05:00Z', '2026-11-06T15:00:00Z'), []);
  assert.deepEqual(dates(null, '2026-11-06T14:00:00Z'), ['2026-10-05', '2026-11-05']);
});

test('resumes subscription charges from the active period only', () => {
  const dates = billingDates(
    new Date('2026-10-01T05:00:00.000Z'),
    new Date('2026-10-31T05:00:00.000Z'),
    'quincenal',
    new Date('2026-10-16T05:00:00.000Z')
  );
  assert.deepEqual(dates.map((date) => date.toISOString().slice(0, 10)), ['2026-10-16', '2026-10-31']);
});
