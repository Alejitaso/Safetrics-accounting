export { isMoneyAmount, roundMoney, splitAcrossDays, billingDate, billingDates } from '../../../shared/finance.mjs';

export function sumSaleMetrics(sales) {
  return sales.reduce((totals, sale) => {
    totals.esperadoRegistrado += sale.valorEsperado || 0;
    totals.pedidos += 1;
    if (sale.estado === 'en_espera') totals.porCobrar += sale.valorEsperado || 0;
    if (sale.estado === 'pagada') {
      totals.real += sale.valorReal ?? sale.valorEsperado ?? 0;
      totals.concretados += 1;
    }
    if (sale.estado === 'devuelta') {
      totals.devuelto += sale.valorEsperado || 0;
      totals.fletes += sale.costoFlete || 0;
    }
    if (sale.estado === 'cancelada') totals.cancelado += sale.valorEsperado || 0;
    return totals;
  }, { esperadoRegistrado: 0, porCobrar: 0, real: 0, devuelto: 0, cancelado: 0, fletes: 0, pedidos: 0, concretados: 0 });
}
