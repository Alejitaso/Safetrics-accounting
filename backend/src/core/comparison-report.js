import { comparisonPeriods, roundMoney } from '../../../shared/finance.mjs';

// Filas del exporte de Comparativas: totales de la selección y detalle por mes, con las mismas
// fórmulas que la pantalla (shared/finance.mjs).
export function comparisonRows(finance, { desde, hasta, meses = [], estado, hoy }) {
  const saleFilter = estado && estado !== 'Todos' ? (sale) => sale.estado === estado : undefined;
  const periods = comparisonPeriods({ desde, hasta, meses, agrupar: 'Mes', hoy })
    .map((period) => ({ ...period, values: finance.metrics(period.desde, period.calculoHasta, saleFilter) }));
  const total = (get) => roundMoney(periods.reduce((sum, period) => sum + get(period.values), 0));
  const rows = [];
  const add = (grupo, periodo, concepto, monto, porcentaje, cantidad) => rows.push({ grupo, periodo, concepto, monto, porcentaje, cantidad });

  const received = total((item) => item.recibido.monto);
  const payments = total((item) => item.recibido.pagos);
  const operating = total((item) => item.gastos.suscripciones + item.gastos.otros);
  const freight = total((item) => item.gastos.fletes);
  const net = total((item) => item.neto);
  const pending = total((item) => item.estados.en_espera.utilidadEsperada);
  const orders = total((item) => item.vendidos.pedidos + item.vendidos.cancelados);
  const paidOrders = total((item) => item.estados.pagada.pedidos);
  const returnedOrders = total((item) => item.estados.devuelta.pedidos);
  add('Totales', '', 'Venta neta', total((item) => item.vendidos.ventaNeta), null, null);
  add('Totales', '', 'Costo producto', total((item) => item.vendidos.costoProducto), null, null);
  add('Totales', '', 'Neto por entregar vendido', total((item) => item.vendidos.utilidadEsperada), null, total((item) => item.vendidos.pedidos));
  add('Totales', '', 'Recibido de la plataforma', received, null, payments);
  add('Totales', '', 'Suscripciones (repartidas por día)', total((item) => item.gastos.suscripciones), null, null);
  add('Totales', '', 'Publicidad y otros gastos', total((item) => item.gastos.otros), null, null);
  add('Totales', '', 'Fletes de devoluciones', freight, null, total((item) => item.devoluciones.cantidad));
  add('Totales', '', 'Utilidad neta', net, received ? net / received : null, null);
  add('Totales', '', 'Utilidad proyectada (incluye por entregar a cliente)', roundMoney(net + pending), null, null);
  add('Totales', '', 'Por entregar a cliente de pedidos del periodo', pending, null, total((item) => item.estados.en_espera.pedidos));
  add('Totales', '', 'Gastos sobre lo recibido', null, received ? (operating + freight) / received : null, null);
  add('Totales', '', 'Pedidos pagados (de los creados)', null, orders ? paidOrders / orders : null, paidOrders);
  add('Totales', '', 'Pedidos devueltos (de los creados)', null, orders ? returnedOrders / orders : null, returnedOrders);
  add('Totales', '', 'Ticket promedio recibido', payments ? received / payments : 0, null, payments);

  for (const { etiqueta, values } of periods) {
    add('Por mes', etiqueta, 'Venta neta', values.vendidos.ventaNeta, null, null);
    add('Por mes', etiqueta, 'Costo producto', values.vendidos.costoProducto, null, null);
    add('Por mes', etiqueta, 'Neto por entregar vendido', values.vendidos.utilidadEsperada, null, values.vendidos.pedidos);
    add('Por mes', etiqueta, 'Recibido de la plataforma', values.recibido.monto, null, values.recibido.pagos);
    add('Por mes', etiqueta, 'Gastos (suscripciones, otros y fletes)', values.gastos.total, null, null);
    add('Por mes', etiqueta, 'Utilidad neta', values.neto, values.recibido.monto ? values.neto / values.recibido.monto : null, null);
  }
  return rows;
}
