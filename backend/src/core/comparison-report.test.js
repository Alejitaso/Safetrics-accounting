import test from 'node:test';
import assert from 'node:assert/strict';
import { createFinance } from '../../../shared/finance.mjs';
import { comparisonRows } from './comparison-report.js';

const day = (key) => new Date(`${key}T05:00:00.000Z`);

test('comparison export uses payment dates and prorated costs', () => {
  const finance = createFinance({
    sales: [
      { _id: 'a', estado: 'pagada', fecha: day('2026-09-28'), fechaPago: day('2026-10-02'), valorEsperado: 40000, valorReal: 40000, precioUnitario: 77900, cantidad: 1 },
      { _id: 'b', estado: 'en_espera', fecha: day('2026-10-05'), valorEsperado: 45000, precioUnitario: 97900, cantidad: 1 }
    ],
    charges: [{ _id: 'c', suscripcionId: 's', nombre: 'App', fecha: day('2026-09-16'), monto: 30000 }],
    subscriptions: [{ _id: 's', frecuencia: 'mensual' }]
  });
  const rows = comparisonRows(finance, { desde: '2026-10-01', hasta: '2026-10-31', hoy: '2026-10-31' });
  const find = (concepto, grupo = 'Totales') => rows.find((row) => row.grupo === grupo && row.concepto === concepto);

  assert.equal(find('Recibido de la plataforma').monto, 40000);
  assert.equal(find('Suscripciones (repartidas por día)').monto, 15000);
  assert.equal(find('Utilidad neta').monto, 25000);
  assert.equal(find('Por entregar a cliente de pedidos del periodo').monto, 45000);
});
