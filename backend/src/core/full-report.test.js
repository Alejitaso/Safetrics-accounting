import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { buildFullReport, createFinance, periodKind, previousPeriod } from './full-report.js';
import { createFullReportExcel, createFullReportPdf } from './full-report-export.js';

const day = (key) => new Date(`${key}T05:00:00.000Z`);
const products = [
  { _id: 'base', nombre: 'Crema dental', precio: 77900, unidadesPorVenta: 1 },
  { _id: 'x2', nombre: 'Crema dental x2', precio: 97900, productoBaseId: 'base', unidadesPorVenta: 2 }
];
const sales = [
  { _id: 's1', nombre: 'Ana', productoId: 'base', productoNombre: 'Crema dental', precioUnitario: 77900, cantidad: 1, unidadesPorVenta: 1, fecha: day('2026-10-27'), estado: 'en_espera', valorEsperado: 39366 },
  { _id: 's2', nombre: 'Luis', productoId: 'x2', productoNombre: 'Crema dental x2', precioUnitario: 97900, cantidad: 1, unidadesPorVenta: 2, fecha: day('2026-10-27'), estado: 'en_espera', valorEsperado: 45046 },
  { _id: 's3', nombre: 'Eva', productoId: 'x2', productoNombre: 'Crema dental x2', precioUnitario: 97900, cantidad: 1, unidadesPorVenta: 2, fecha: day('2026-10-22'), estado: 'pagada', valorEsperado: 49085, valorReal: 49085, fechaPago: day('2026-10-27') },
  { _id: 's4', nombre: 'Juan', productoId: 'base', productoNombre: 'Crema dental', precioUnitario: 77900, cantidad: 1, fecha: day('2026-10-20'), estado: 'devuelta', valorEsperado: 39366, costoFlete: 12000, historialEstados: [{ estado: 'en_espera', en: new Date('2026-10-20T15:00:00Z') }, { estado: 'devuelta', en: new Date('2026-10-27T15:00:00Z') }] },
  { _id: 's5', nombre: 'Rosa', productoId: 'base', productoNombre: 'Crema dental', precioUnitario: 77900, cantidad: 1, fecha: day('2026-10-26'), estado: 'pagada', valorEsperado: 40000, valorReal: 40000, fechaPago: day('2026-10-26') }
];
const subscriptions = [{ _id: 'sub', nombre: 'Software A', valor: 62000, frecuencia: 'mensual', estado: 'activa' }];
const charges = [{ _id: 'c1', suscripcionId: 'sub', nombre: 'Software A', fecha: day('2026-10-05'), monto: 62000 }];
const longExpenses = [{ _id: 'l1', detalle: 'Anuncios A', categoriaNombre: 'Publicidad', fechaInicio: day('2026-10-26'), fechaFin: day('2026-10-27'), monto: 100000 }];
const input = { products, sales, subscriptions, charges, longExpenses, expenses: [], hoy: '2026-10-27' };

test('daily report counts money on the day it moved', () => {
  const report = buildFullReport({ ...input, desde: '2026-10-27', hasta: '2026-10-27' });

  assert.equal(report.tipo, 'diario');
  assert.equal(report.actual.vendidos.pedidos, 2);
  assert.equal(report.actual.vendidos.unidades, 3);
  assert.equal(report.actual.vendidos.ventaBruta, 175800);
  assert.equal(report.actual.vendidos.utilidadEsperada, 84412);
  assert.equal(report.actual.recibido.monto, 49085);
  assert.equal(report.pagos[0].fechaVenta, '2026-10-22');
  assert.equal(report.pagos[0].diasEnLlegar, 5);
  assert.equal(report.actual.devoluciones.cantidad, 1);
  assert.equal(report.actual.gastos.fletes, 12000);
  assert.equal(report.actual.gastos.suscripciones, 2000);
  assert.equal(report.actual.gastos.otros, 50000);
  assert.equal(report.actual.neto, 49085 - 2000 - 50000 - 12000);
  assert.equal(report.porLlegar.pedidos, 2);
  assert.equal(report.porLlegar.monto, 84412);
  assert.equal(report.evolucion.granularidad, null);
});

test('groups variants under their base product', () => {
  const report = buildFullReport({ ...input, desde: '2026-10-20', hasta: '2026-10-27' });
  const [cream] = report.productos;

  assert.equal(report.productos.length, 1);
  assert.equal(cream.producto, 'Crema dental');
  assert.equal(cream.pedidos, 5);
  assert.equal(cream.unidades, 7);
  assert.deepEqual(cream.variantes.map((variant) => [variant.producto, variant.pedidos, variant.unidades]), [
    ['Crema dental', 3, 3], ['Crema dental x2', 2, 4]
  ]);
});

test('month-to-date sidebar and comparison with the previous day', () => {
  const report = buildFullReport({ ...input, desde: '2026-10-27', hasta: '2026-10-27' });

  assert.equal(report.mes.desde, '2026-10-01');
  assert.equal(report.mes.recibido.monto, 89085);
  assert.equal(report.mes.gastos.suscripciones, 46000);
  assert.equal(report.anterior.desde, '2026-10-26');
  const received = report.comparacion.find((row) => row.indicador === 'Recibido de la plataforma');
  assert.equal(received.anterior, 40000);
  assert.equal(received.diferencia, 9085);
});

test('detects period kinds and their previous periods', () => {
  assert.equal(periodKind('2026-10-26', '2026-10-27'), 'semanal');
  assert.equal(periodKind('2026-10-01', '2026-10-27'), 'mensual');
  assert.equal(periodKind('2026-01-01', '2026-10-27'), 'anual');
  assert.equal(periodKind('2026-10-10', '2026-10-27'), 'personalizado');
  assert.deepEqual(previousPeriod('2026-03-01', '2026-03-31').hasta, '2026-02-28');
  assert.equal(previousPeriod('2026-10-10', '2026-10-19').desde, '2026-09-30');
  const monthly = buildFullReport({ ...input, desde: '2026-10-01', hasta: '2026-10-27' });
  assert.equal(monthly.evolucion.granularidad, 'diaria');
  assert.equal(monthly.evolucion.filas.length, 27);
});

test('exports readable PDF and Excel files', async () => {
  const report = buildFullReport({ ...input, desde: '2026-10-27', hasta: '2026-10-27' });
  const pdf = await createFullReportPdf(report);
  assert.ok(pdf.subarray(0, 5).toString() === '%PDF-');

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await createFullReportExcel(report));
  assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), [
    'Informe', 'Ventas por producto', 'Pagos recibidos', 'Devoluciones', 'Gastos', 'Por entregar a cliente', 'Pedidos'
  ]);
  const sheet = workbook.getWorksheet('Informe');
  assert.equal(sheet.getCell('B6').value, report.actual.ventas.ganancia);
  assert.equal(sheet.getCell('B7').value, 49085);
  const side = {};
  sheet.eachRow((row) => { if (row.getCell(6).value) side[String(row.getCell(6).value)] = row.getCell(7).value; });
  assert.equal(side['Venta neta'], report.mes.ventas.ventaNeta);
  assert.equal(side['Costo producto'], report.mes.ventas.ventaNeta - report.mes.ventas.ganancia);
  assert.equal(side['Costo total'], side['Costo producto'] + side['Gastos totales']);
  assert.equal(side['Ganancia esperada'], side['Venta neta'] - side['Costo total']);
  assert.equal(side['Utilidad neta del mes'], side['Recibido de la plataforma'] - side['Gastos totales']);
  assert.equal(workbook.getWorksheet('Ventas por producto').getCell('A6').value, 'Crema dental');
});

test('report never runs past today and comparison periods stop at today', async () => {
  const { comparisonPeriods } = await import('../../../shared/finance.mjs');
  const report = buildFullReport({ ...input, desde: '2026-10-01', hasta: '2026-10-31' });
  assert.equal(report.hasta, '2026-10-27');

  const months = comparisonPeriods({ desde: '2026-09-01', hasta: '2026-12-31', agrupar: 'Mes', hoy: '2026-10-27' });
  assert.deepEqual(months.map((period) => [period.clave, period.calculoHasta]), [
    ['2026-09', '2026-09-30'], ['2026-10', '2026-10-27'], ['2026-11', '2026-10-31'], ['2026-12', '2026-11-30']
  ]);
  const quarters = comparisonPeriods({ meses: ['2026-01', '2026-03'], agrupar: 'Trimestre', hoy: '2026-10-27' });
  assert.deepEqual(quarters.map((period) => [period.desde, period.hasta]), [['2026-01-01', '2026-01-31'], ['2026-03-01', '2026-03-31']]);
});

test('subscription helpers follow the billing frequency', async () => {
  const { monthlyEquivalent, nextBillingKey, chargeCoverageEnd } = await import('../../../shared/finance.mjs');
  assert.equal(monthlyEquivalent(1200, 'anual'), 100);
  assert.equal(monthlyEquivalent(100, 'semanal'), 433.33);
  assert.equal(nextBillingKey({ fechaInicio: day('2026-09-29'), frecuencia: 'mensual' }, '2026-10-27'), '2026-10-29');
  assert.equal(nextBillingKey({ fechaInicio: day('2026-01-10'), frecuencia: 'trimestral' }, '2026-10-27'), '2027-01-10');
  assert.equal(chargeCoverageEnd('2026-09-29', 'mensual'), '2026-10-28');
});

test('filters the engine by sale state for comparisons', () => {
  const report = buildFullReport({ ...input, desde: '2026-10-20', hasta: '2026-10-27' });
  assert.equal(report.actual.estados.pagada.pedidos, 2);
  assert.equal(report.actual.estados.en_espera.utilidadEsperada, 84412);
});

test('a registered return date wins over the day it was marked', () => {
  const returned = { ...sales[3], fechaDevolucion: day('2026-10-25') };
  const data = { ...input, sales: [...sales.slice(0, 3), returned, sales[4]] };
  assert.equal(buildFullReport({ ...data, desde: '2026-10-27', hasta: '2026-10-27' }).actual.devoluciones.cantidad, 0);
  const report = buildFullReport({ ...data, desde: '2026-10-25', hasta: '2026-10-25' });
  assert.equal(report.actual.gastos.fletes, 12000);
  assert.equal(report.devoluciones.lista[0].fechaDevolucion, '2026-10-25');
});

test('net sales and projected profit follow the business story', () => {
  const report = buildFullReport({ ...input, desde: '2026-10-20', hasta: '2026-10-27' });
  const sales = report.actual.ventas;
  assert.equal(sales.pedidos, 5);
  assert.equal(sales.pedidosNetos, 4);
  assert.equal(sales.ventaBruta, 77900 * 3 + 97900 * 2);
  assert.equal(sales.devoluciones, 77900);
  assert.equal(sales.ventaNeta, 77900 * 2 + 97900 * 2);
  assert.equal(sales.ganancia, 39366 + 45046 + 49085 + 40000);
  assert.equal(sales.costoProducto, sales.ventaNeta - sales.ganancia);
  assert.equal(sales.porCobrar, 39366 + 45046);
  assert.equal(report.actual.esperada, sales.ganancia - report.actual.gastos.total);
  assert.equal(report.actual.recibidoNeto, report.actual.recibido.monto - report.actual.gastos.fletes);
  const [cream] = report.productos;
  assert.equal(cream.ventaNeta, sales.ventaNeta);
  assert.equal(cream.ganancia, sales.ganancia);
  assert.equal(report.comparacion.at(-1).indicador, 'Ganancia esperada');
  const { vendidos } = createFinance(input).metrics('2026-10-20', '2026-10-27');
  assert.equal(vendidos.costoProducto, sales.costoProducto);
  assert.equal(vendidos.ventaNeta - vendidos.esperadoNeto, vendidos.costoProducto);
  assert.equal(report.comparacion.find((row) => row.indicador === 'Costo producto').actual, sales.costoProducto);
  assert.equal(cream.ventaNeta - cream.ganancia, sales.costoProducto);
});
