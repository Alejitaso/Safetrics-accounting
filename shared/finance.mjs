// Motor de cálculo único de Safetrics. Lo usan el backend (exportaciones) y la interfaz
// (Resumen, Gastos, Comparativas), para que todas las ventanas entreguen las mismas cifras.
// Criterio de caja:
// - lo recibido cuenta el día en que la plataforma pagó (fechaPago),
// - una devolución cuenta el día en que el pedido pasó a "devuelta" y resta su flete,
// - cada cobro de suscripción se reparte por día hasta el siguiente cobro,
// - los gastos prolongados se reparten por día dentro de su rango,
// - lo vendido (pedidos, unidades, venta bruta y neto por entregar) cuenta en la fecha del pedido.

const TIME_ZONE = 'America/Bogota';
const DAY_MS = 86400000;
const stateLabels = { pagada: 'Pagada', en_espera: 'En espera', devuelta: 'Devuelta', cancelada: 'Cancelada' };
const dayFormatter = new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });

export function isMoneyAmount(value) {
  return Number.isFinite(value) && value >= 0
    && Math.abs(value * 100 - Math.round(value * 100)) < 1e-7;
}

export function roundMoney(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function splitAcrossDays(amount, start, end) {
  const from = new Date(start);
  const to = new Date(end);
  from.setUTCHours(0, 0, 0, 0);
  to.setUTCHours(0, 0, 0, 0);
  const days = Math.floor((to - from) / DAY_MS) + 1;
  if (!isMoneyAmount(amount) || days < 1) throw new Error('Rango o monto inválido');
  if (Number.isInteger(amount)) {
    const daily = Math.floor(amount / days);
    return Array.from({ length: days }, (_, index) => daily + (index === days - 1 ? amount - daily * days : 0));
  }
  const totalCents = Math.round(amount * 100);
  const dailyCents = Math.floor(totalCents / days);
  return Array.from({ length: days }, (_, index) => (
    (dailyCents + (index === days - 1 ? totalCents - dailyCents * days : 0)) / 100
  ));
}

export function billingDate(anchor, index, frequency) {
  const date = new Date(anchor);
  if (frequency === 'semanal' || frequency === 'quincenal') {
    date.setUTCDate(date.getUTCDate() + index * (frequency === 'semanal' ? 7 : 15));
    return date;
  }
  const monthStep = { mensual: 1, bimestral: 2, trimestral: 3, semestral: 6, anual: 12 }[frequency];
  if (!monthStep) throw new Error('Frecuencia de suscripción inválida');
  const targetMonth = date.getUTCMonth() + index * monthStep;
  const targetYear = date.getUTCFullYear() + Math.floor(targetMonth / 12);
  const month = targetMonth % 12;
  const targetDay = Math.min(date.getUTCDate(), new Date(Date.UTC(targetYear, month + 1, 0)).getUTCDate());
  date.setUTCFullYear(targetYear, month, targetDay);
  return date;
}

export function billingDates(anchor, throughDate, frequency, activeFrom = anchor) {
  const dates = [];
  let index = 0;
  while (billingDate(anchor, index, frequency) < activeFrom && index < 10000) index += 1;
  while (index < 10000) {
    const date = billingDate(anchor, index, frequency);
    if (date > throughDate) break;
    if (date >= activeFrom) dates.push(date);
    index += 1;
  }
  return dates;
}

const chargesPerYear = { semanal: 52, quincenal: 365 / 15, mensual: 12, bimestral: 6, trimestral: 4, semestral: 2, anual: 1 };
export const monthlyEquivalent = (value, frequency) => roundMoney(Number(value || 0) * (chargesPerYear[frequency] || 12) / 12);

export function dayKey(value) {
  if (!value) return null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = Object.fromEntries(dayFormatter.formatToParts(date).map(({ type, value: part }) => [type, part]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export const keyToDate = (key) => new Date(`${key}T12:00:00.000Z`);
export const shiftDays = (key, days) => {
  const date = keyToDate(key);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};
export const daysBetween = (from, to) => Math.round((keyToDate(to) - keyToDate(from)) / DAY_MS) + 1;
const lastDayOfMonth = (year, month) => new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
const sum = (items, get) => roundMoney(items.reduce((total, item) => total + Number(get(item) || 0), 0));

export function nextBillingKey(subscription, today = dayKey(new Date())) {
  const anchorKey = dayKey(subscription.fechaInicio);
  if (!anchorKey) return null;
  const activeFrom = dayKey(subscription.activaDesde) || anchorKey;
  const start = activeFrom > today ? activeFrom : today;
  for (let index = 0; index < 10000; index += 1) {
    const key = dayKey(billingDate(keyToDate(anchorKey), index, subscription.frecuencia || 'mensual'));
    if (key >= start) return key;
  }
  return null;
}

const formatShort = (key) => keyToDate(key).toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
const formatDayMonth = (key) => keyToDate(key).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', timeZone: 'UTC' }).replace('.', '');
const formatLong = (key) => {
  const text = keyToDate(key).toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  return text.charAt(0).toUpperCase() + text.slice(1);
};
const monthName = (key) => {
  const text = keyToDate(key).toLocaleDateString('es-CO', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  return text.charAt(0).toUpperCase() + text.slice(1);
};
const rangeText = (from, to) => (from === to ? formatShort(from) : `${formatShort(from)} – ${formatShort(to)}`);
export const reportDates = { formatShort, formatLong, formatDayMonth, monthName };

export function periodKind(from, to) {
  const days = daysBetween(from, to);
  if (days === 1) return 'diario';
  if (days <= 7 && keyToDate(from).getUTCDay() === 1) return 'semanal';
  if (from.slice(8) === '01' && from.slice(0, 7) === to.slice(0, 7)) return 'mensual';
  if (from.slice(5) === '01-01' && from.slice(0, 4) === to.slice(0, 4)) return 'anual';
  return 'personalizado';
}

export function previousPeriod(from, to) {
  const kind = periodKind(from, to);
  const days = daysBetween(from, to);
  if (kind === 'diario') {
    const day = shiftDays(from, -1);
    return { desde: day, hasta: day, etiqueta: `Día anterior · ${formatShort(day)}` };
  }
  if (kind === 'semanal') {
    const desde = shiftDays(from, -7);
    const hasta = shiftDays(to, -7);
    return { desde, hasta, etiqueta: `Semana anterior · ${rangeText(desde, hasta)}` };
  }
  if (kind === 'mensual') {
    const start = keyToDate(from);
    const year = start.getUTCMonth() === 0 ? start.getUTCFullYear() - 1 : start.getUTCFullYear();
    const month = (start.getUTCMonth() + 11) % 12;
    const lastDay = Math.min(Number(to.slice(8)), lastDayOfMonth(year, month));
    const prefix = `${year}-${String(month + 1).padStart(2, '0')}`;
    const desde = `${prefix}-01`;
    const hasta = `${prefix}-${String(lastDay).padStart(2, '0')}`;
    return { desde, hasta, etiqueta: `Mismos días del mes anterior · ${rangeText(desde, hasta)}` };
  }
  if (kind === 'anual') {
    const year = Number(from.slice(0, 4)) - 1;
    const month = Number(to.slice(5, 7)) - 1;
    const day = Math.min(Number(to.slice(8)), lastDayOfMonth(year, month));
    const desde = `${year}-01-01`;
    const hasta = `${year}-${to.slice(5, 7)}-${String(day).padStart(2, '0')}`;
    return { desde, hasta, etiqueta: `Mismo tramo del año anterior · ${rangeText(desde, hasta)}` };
  }
  const hasta = shiftDays(from, -1);
  const desde = shiftDays(hasta, -(days - 1));
  return { desde, hasta, etiqueta: `${days} días anteriores · ${rangeText(desde, hasta)}` };
}

// Periodos de Comparativas: agrupa los días seleccionados (un rango o varios meses completos).
// calculoHasta recorta en hoy, porque los días futuros todavía no tienen movimientos.
export function comparisonPeriods({ desde, hasta, meses = [], agrupar = 'Mes', hoy = dayKey(new Date()) }) {
  const ranges = meses.length
    ? meses.map((month) => [`${month}-01`, `${month}-${String(lastDayOfMonth(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1)).padStart(2, '0')}`])
    : desde && hasta && desde <= hasta ? [[desde, hasta]] : [];
  const days = [];
  for (const [start, end] of ranges) for (let key = start; key <= end && days.length < 4000; key = shiftDays(key, 1)) days.push(key);
  const groupOf = (key, index) => {
    if (agrupar === 'Día') return [key, formatShort(key), formatShort(key).slice(0, 5)];
    if (agrupar === 'Semana') {
      const monday = shiftDays(key, -((keyToDate(key).getUTCDay() + 6) % 7));
      return [monday, null, null];
    }
    if (agrupar === 'Trimestre') {
      const quarter = Math.floor((Number(key.slice(5, 7)) - 1) / 3) + 1;
      return [`${key.slice(0, 4)}-T${quarter}`, `${quarter}.º trimestre ${key.slice(0, 4)}`, `T${quarter} ${key.slice(2, 4)}`];
    }
    if (agrupar === 'Periodo A/B') {
      const first = meses.length ? key.slice(0, 7) === meses[0] : index < Math.ceil(days.length / 2);
      return first ? ['A', 'Periodo A', 'Periodo A'] : ['B', 'Periodo B', 'Periodo B'];
    }
    const short = keyToDate(key).toLocaleDateString('es-CO', { month: 'short', year: '2-digit', timeZone: 'UTC' }).replace('.', '');
    return [key.slice(0, 7), monthName(key), short];
  };
  const groups = new Map();
  days.forEach((key, index) => {
    const [groupKey, etiqueta, corta] = groupOf(key, index);
    const clave = meses.length && agrupar !== 'Periodo A/B' ? `${key.slice(0, 7)}|${groupKey}` : groupKey;
    const group = groups.get(clave) || { clave, etiqueta, corta, desde: key, hasta: key };
    group.hasta = key;
    groups.set(clave, group);
  });
  return [...groups.values()].map((group) => {
    const label = group.etiqueta || `${formatDayMonth(group.desde)} – ${formatDayMonth(group.hasta)}`;
    const withRange = agrupar === 'Periodo A/B' ? `${label} · ${rangeText(group.desde, group.hasta)}` : label;
    return {
      ...group,
      etiqueta: withRange,
      corta: group.corta || label,
      calculoHasta: group.hasta > hoy ? (group.desde > hoy ? shiftDays(group.desde, -1) : hoy) : group.hasta
    };
  });
}

// Reparte cada gasto en los días que le corresponden. Los ids coinciden con los registros de origen:
// gasto-<id> (pago único), prolongado-<id> (gasto prolongado) y cargo-<id> (cobro de suscripción).
export function buildCostLedger({ expenses = [], longExpenses = [], charges = [], subscriptions = [] }) {
  const days = new Map();
  const add = (key, entry) => {
    if (!days.has(key)) days.set(key, []);
    days.get(key).push(entry);
  };
  for (const expense of expenses) {
    const key = dayKey(expense.fecha);
    if (!key) continue;
    add(key, {
      id: `gasto-${expense._id}`, sourceId: String(expense._id), tipo: 'otros', grupo: 'Gasto del día', concepto: expense.detalle,
      categoria: expense.categoriaNombre || 'Sin categoría', total: Number(expense.monto || 0),
      desde: key, hasta: key, monto: Number(expense.monto || 0)
    });
  }
  for (const expense of longExpenses) {
    const from = dayKey(expense.fechaInicio);
    const to = dayKey(expense.fechaFin);
    if (!from || !to || to < from) continue;
    splitAcrossDays(Number(expense.monto), keyToDate(from), keyToDate(to)).forEach((amount, index) => add(shiftDays(from, index), {
      id: `prolongado-${expense._id}`, sourceId: String(expense._id), tipo: 'otros', grupo: 'Gasto repartido', concepto: expense.detalle,
      categoria: expense.categoriaNombre || 'Sin categoría', total: Number(expense.monto || 0),
      desde: from, hasta: to, monto: amount
    }));
  }
  const subscriptionById = new Map(subscriptions.map((subscription) => [String(subscription._id), subscription]));
  for (const charge of charges) {
    const from = dayKey(charge.fecha);
    if (!from) continue;
    const subscription = subscriptionById.get(String(charge.suscripcionId));
    const to = chargeCoverageEnd(from, subscription?.frecuencia);
    splitAcrossDays(Number(charge.monto), keyToDate(from), keyToDate(to)).forEach((amount, index) => add(shiftDays(from, index), {
      id: `cargo-${charge._id}`, sourceId: String(charge._id), tipo: 'suscripcion', grupo: 'Suscripción', concepto: charge.nombre || charge.detalle,
      categoria: charge.categoriaNombre || subscription?.categoriaNombre || 'Suscripciones', total: Number(charge.monto || 0),
      desde: from, hasta: to, monto: amount
    }));
  }
  return days;
}

// Un cobro cubre desde su fecha hasta el día anterior al siguiente cobro.
export const chargeCoverageEnd = (chargeKey, frequency = 'mensual') => shiftDays(dayKey(billingDate(keyToDate(chargeKey), 1, frequency || 'mensual')), -1);

export function costsInRange(ledger, from, to) {
  const items = new Map();
  for (let key = from; key <= to; key = shiftDays(key, 1)) {
    for (const entry of ledger.get(key) || []) {
      const current = items.get(entry.id) || { ...entry, monto: 0 };
      current.monto += entry.monto;
      items.set(entry.id, current);
    }
  }
  const list = [...items.values()]
    .map((item) => ({ ...item, monto: roundMoney(item.monto) }))
    .sort((a, b) => (a.tipo === b.tipo ? b.monto - a.monto : a.tipo === 'suscripcion' ? -1 : 1));
  return {
    suscripciones: sum(list.filter((item) => item.tipo === 'suscripcion'), (item) => item.monto),
    otros: sum(list.filter((item) => item.tipo === 'otros'), (item) => item.monto),
    items: list
  };
}

export function createFinance({ sales = [], products = [], expenses = [], longExpenses = [], charges = [], subscriptions = [] }) {
  const productById = new Map(products.map((product) => [String(product._id), product]));
  const ledger = buildCostLedger({ expenses, longExpenses, charges, subscriptions });
  const productOf = (sale) => productById.get(String(sale.productoId));
  const unitsPerOrder = (sale) => Number(sale.unidadesPorVenta || productOf(sale)?.unidadesPorVenta || 1);
  const unitsOf = (sale) => Number(sale.cantidad || 1) * unitsPerOrder(sale);
  const grossOf = (sale) => Number(sale.precioUnitario || 0) * Number(sale.cantidad || 1);
  const receivedOf = (sale) => Number(sale.valorReal ?? sale.valorEsperado ?? 0);
  const saleDay = (sale) => dayKey(sale.fecha);
  const paymentDay = (sale) => dayKey(sale.fechaPago) || saleDay(sale);
  const returnDay = (sale) => {
    if (sale.fechaDevolucion) return dayKey(sale.fechaDevolucion);
    const change = [...(sale.historialEstados || [])].reverse().find((entry) => entry.estado === 'devuelta');
    return dayKey(change?.en) || saleDay(sale);
  };

  const metrics = (start, end, saleFilter = () => true) => {
    const inRange = (key) => key && key >= start && key <= end;
    const scoped = sales.filter(saleFilter);
    const created = scoped.filter((sale) => inRange(saleDay(sale)));
    const sold = created.filter((sale) => sale.estado !== 'cancelada');
    const paid = scoped.filter((sale) => sale.estado === 'pagada' && inRange(paymentDay(sale)));
    const returned = scoped.filter((sale) => sale.estado === 'devuelta' && inRange(returnDay(sale)));
    const costs = costsInRange(ledger, start, end);
    const recibido = sum(paid, receivedOf);
    const fletes = sum(returned, (sale) => sale.costoFlete);
    const gastosTotal = roundMoney(costs.suscripciones + costs.otros + fletes);
    const byState = (state) => created.filter((sale) => sale.estado === state);
    const live = created.filter((sale) => sale.estado === 'pagada' || sale.estado === 'en_espera');
    const ventaNeta = sum(live, grossOf);
    const esperadoNeto = sum(live, (sale) => sale.valorEsperado);
    return {
      desde: start,
      hasta: end,
      dias: daysBetween(start, end),
      vendidos: {
        pedidos: sold.length,
        unidades: sold.reduce((total, sale) => total + unitsOf(sale), 0),
        ventaBruta: sum(sold, grossOf),
        utilidadEsperada: sum(sold, (sale) => sale.valorEsperado),
        ventaNeta,
        esperadoNeto,
        costoProducto: roundMoney(ventaNeta - esperadoNeto),
        cancelados: byState('cancelada').length
      },
      estados: Object.fromEntries(Object.keys(stateLabels).map((state) => [state, {
        pedidos: byState(state).length,
        utilidadEsperada: sum(byState(state), (sale) => sale.valorEsperado)
      }])),
      recibido: { monto: recibido, pagos: paid.length },
      devoluciones: { cantidad: returned.length, fletes, utilidadPerdida: sum(returned, (sale) => sale.valorEsperado) },
      gastos: { suscripciones: costs.suscripciones, otros: costs.otros, fletes, total: gastosTotal },
      neto: roundMoney(recibido - gastosTotal),
      registros: { created, sold, paid, returned, costs: costs.items }
    };
  };

  return { metrics, ledger, productById, productOf, unitsPerOrder, unitsOf, grossOf, receivedOf, saleDay, paymentDay, returnDay };
}

export function buildFullReport({
  desde, hasta, hoy = dayKey(new Date()), sales = [], products = [], expenses = [], longExpenses = [],
  charges = [], subscriptions = [], diasAlerta = 15
}) {
  const from = dayKey(desde);
  let to = dayKey(hasta);
  if (!from || !to || from > to) throw new Error('Rango de fechas inválido.');
  if (to > hoy && from <= hoy) to = hoy;
  const finance = createFinance({ sales, products, expenses, longExpenses, charges, subscriptions });
  const { metrics, productById, productOf, unitsPerOrder, unitsOf, grossOf, receivedOf, saleDay, paymentDay, returnDay } = finance;
  const daysFrom = (start, end) => Math.max(0, daysBetween(start, end) - 1);
  const describe = (sale) => ({
    id: String(sale._id ?? ''),
    cliente: sale.nombre,
    producto: sale.productoNombre,
    unidades: unitsOf(sale),
    ventaBruta: grossOf(sale),
    utilidadEsperada: Number(sale.valorEsperado || 0),
    estado: stateLabels[sale.estado] || sale.estado,
    fechaVenta: saleDay(sale)
  });

  const salesView = (start, end) => {
    const created = sales.filter((sale) => saleDay(sale) && saleDay(sale) >= start && saleDay(sale) <= end);
    const group = (state) => {
      const list = created.filter((sale) => sale.estado === state);
      return {
        pedidos: list.length,
        unidades: list.reduce((total, sale) => total + unitsOf(sale), 0),
        ventaBruta: sum(list, grossOf),
        ganancia: sum(list, (sale) => sale.valorEsperado)
      };
    };
    const [pagada, enEspera, devuelta, cancelada] = ['pagada', 'en_espera', 'devuelta', 'cancelada'].map(group);
    const ventaNeta = roundMoney(pagada.ventaBruta + enEspera.ventaBruta);
    const ganancia = roundMoney(pagada.ganancia + enEspera.ganancia);
    return {
      pedidos: pagada.pedidos + enEspera.pedidos + devuelta.pedidos,
      pedidosNetos: pagada.pedidos + enEspera.pedidos,
      unidades: pagada.unidades + enEspera.unidades,
      ventaBruta: roundMoney(ventaNeta + devuelta.ventaBruta),
      devoluciones: devuelta.ventaBruta,
      ventaNeta,
      costoProducto: roundMoney(ventaNeta - ganancia),
      ganancia,
      cobrado: pagada.ganancia,
      porCobrar: enEspera.ganancia,
      estados: { pagada, en_espera: enEspera, devuelta, cancelada }
    };
  };
  const strip = ({ registros, ...rest }) => rest;
  const withProjection = (period) => {
    const ventas = salesView(period.desde, period.hasta);
    return { ...strip(period), ventas,
      recibidoNeto: roundMoney(period.recibido.monto - period.gastos.fletes),
      costoTotal: roundMoney(ventas.costoProducto + period.gastos.total), esperada: roundMoney(ventas.ganancia - period.gastos.total) };
  };

  const current = metrics(from, to);
  const previousRange = previousPeriod(from, to);
  const previous = metrics(previousRange.desde, previousRange.hasta);
  const monthStart = `${to.slice(0, 7)}-01`;
  const month = metrics(monthStart, to);

  const change = (label, now, before, kind, betterWhenUp = true) => ({
    indicador: label, actual: now, anterior: before, tipo: kind, mejorSiSube: betterWhenUp,
    diferencia: roundMoney(now - before),
    porcentaje: before ? (now - before) / Math.abs(before) : null
  });
  const actual = withProjection(current);
  const anterior = withProjection(previous);
  const comparacion = [
    change('Pedidos vendidos', actual.ventas.pedidosNetos, anterior.ventas.pedidosNetos, 'number'),
    change('Venta neta', actual.ventas.ventaNeta, anterior.ventas.ventaNeta, 'money'),
    change('Costo producto', actual.ventas.costoProducto, anterior.ventas.costoProducto, 'money', false),
    change('Recibido de la plataforma', current.recibido.monto, previous.recibido.monto, 'money'),
    change('Gastos totales', current.gastos.total, previous.gastos.total, 'money', false),
    change('Utilidad neta', current.neto, previous.neto, 'money'),
    change('Ganancia esperada', actual.esperada, anterior.esperada, 'money')
  ];

  const pendingSales = sales
    .filter((sale) => sale.estado === 'en_espera' && saleDay(sale) && saleDay(sale) <= hoy)
    .sort((a, b) => saleDay(a).localeCompare(saleDay(b)));
  const pendingList = pendingSales.map((sale) => ({ ...describe(sale), diasEsperando: daysFrom(saleDay(sale), hoy) }));
  const pendingFromPeriod = pendingSales.filter((sale) => saleDay(sale) >= from && saleDay(sale) <= to);
  const porLlegar = {
    fecha: hoy,
    monto: sum(pendingSales, (sale) => sale.valorEsperado),
    pedidos: pendingSales.length,
    masAntiguoDias: pendingList[0]?.diasEsperando ?? 0,
    vencidos: pendingList.filter((item) => item.diasEsperando > diasAlerta).length,
    delPeriodo: { pedidos: pendingFromPeriod.length, monto: sum(pendingFromPeriod, (sale) => sale.valorEsperado) },
    lista: pendingList
  };

  const productGroups = new Map();
  for (const sale of current.registros.sold) {
    const product = productOf(sale);
    const base = product?.productoBaseId ? productById.get(String(product.productoBaseId)) || product : product;
    const baseKey = String(base?._id ?? sale.productoNombre);
    const group = productGroups.get(baseKey) || { producto: base?.nombre || sale.productoNombre, pedidos: 0, unidades: 0, ventaBruta: 0, ventaNeta: 0, ganancia: 0, devueltos: 0, utilidadEsperada: 0, variantes: new Map() };
    const variantKey = String(sale.productoId ?? sale.productoNombre);
    const variant = group.variantes.get(variantKey) || {
      producto: sale.productoNombre, unidadesPorPedido: unitsPerOrder(sale), precio: Number(sale.precioUnitario || 0),
      pedidos: 0, unidades: 0, ventaBruta: 0, ventaNeta: 0, ganancia: 0, devueltos: 0, utilidadEsperada: 0
    };
    for (const target of [group, variant]) {
      target.pedidos += 1;
      target.unidades += unitsOf(sale);
      target.ventaBruta = roundMoney(target.ventaBruta + grossOf(sale));
      target.utilidadEsperada = roundMoney(target.utilidadEsperada + Number(sale.valorEsperado || 0));
      if (sale.estado === 'devuelta') target.devueltos += 1;
      else {
        target.ventaNeta = roundMoney(target.ventaNeta + grossOf(sale));
        target.ganancia = roundMoney(target.ganancia + Number(sale.valorEsperado || 0));
      }
    }
    group.variantes.set(variantKey, variant);
    productGroups.set(baseKey, group);
  }
  const productos = [...productGroups.values()]
    .map((group) => ({ ...group, variantes: [...group.variantes.values()].sort((a, b) => a.unidadesPorPedido - b.unidadesPorPedido) }))
    .sort((a, b) => b.ventaBruta - a.ventaBruta);

  const pagos = current.registros.paid
    .map((sale) => ({ ...describe(sale), fechaPago: paymentDay(sale), diasEnLlegar: daysFrom(saleDay(sale), paymentDay(sale)), recibido: receivedOf(sale) }))
    .sort((a, b) => a.fechaPago.localeCompare(b.fechaPago) || a.fechaVenta.localeCompare(b.fechaVenta));
  const devoluciones = current.registros.returned
    .map((sale) => ({ ...describe(sale), fechaDevolucion: returnDay(sale), flete: Number(sale.costoFlete || 0) }))
    .sort((a, b) => a.fechaDevolucion.localeCompare(b.fechaDevolucion));
  const closedOrders = current.recibido.pagos + current.devoluciones.cantidad;
  const pedidos = current.registros.created.map(describe).sort((a, b) => a.fechaVenta.localeCompare(b.fechaVenta));

  const totalDays = current.dias;
  const granularity = totalDays <= 1 ? null : totalDays <= 31 ? 'diaria' : totalDays <= 120 ? 'semanal' : 'mensual';
  const evolucion = [];
  if (granularity) {
    let start = from;
    while (start <= to) {
      let end = start;
      if (granularity === 'semanal') end = shiftDays(start, 6 - ((keyToDate(start).getUTCDay() + 6) % 7));
      if (granularity === 'mensual') end = `${start.slice(0, 7)}-${String(lastDayOfMonth(Number(start.slice(0, 4)), Number(start.slice(5, 7)) - 1)).padStart(2, '0')}`;
      if (end > to) end = to;
      const bucket = metrics(start, end);
      const bucketSales = salesView(start, end);
      evolucion.push({
        periodo: granularity === 'diaria' ? formatShort(start) : granularity === 'mensual' ? monthName(start) : `${formatDayMonth(start)} – ${formatDayMonth(end)}`,
        pedidos: bucket.vendidos.pedidos,
        ventaNeta: bucketSales.ventaNeta,
        esperada: roundMoney(bucketSales.ganancia - bucket.gastos.total),
        utilidadEsperada: bucketSales.ganancia,
        recibido: bucket.recibido.monto,
        gastos: bucket.gastos.total,
        neto: bucket.neto
      });
      start = shiftDays(end, 1);
    }
  }

  const gastosPorCategoria = [...current.registros.costs.reduce((totals, item) => {
    totals.set(item.categoria, roundMoney((totals.get(item.categoria) || 0) + item.monto));
    return totals;
  }, new Map())].map(([categoria, monto]) => ({ categoria, monto })).sort((a, b) => b.monto - a.monto);

  const kind = periodKind(from, to);
  const titles = { diario: 'Reporte diario', semanal: 'Reporte semanal', mensual: 'Reporte mensual', anual: 'Reporte anual', personalizado: 'Reporte personalizado' };
  const periodLabel = kind === 'diario' ? formatLong(from)
    : kind === 'mensual' ? `${monthName(from)} · del ${Number(from.slice(8))} al ${Number(to.slice(8))}`
      : kind === 'anual' ? `Año ${from.slice(0, 4)} · ${rangeText(from, to)}`
        : rangeText(from, to);
  return {
    tipo: kind,
    titulo: titles[kind],
    periodoTexto: periodLabel,
    desde: from,
    hasta: to,
    hoy,
    diasAlerta,
    actual,
    anterior: { ...anterior, etiqueta: previousRange.etiqueta },
    comparacion,
    mes: { ...withProjection(month), etiqueta: monthName(monthStart), rango: `Del 1 al ${Number(to.slice(8))} de ${keyToDate(to).toLocaleDateString('es-CO', { month: 'long', timeZone: 'UTC' })}` },
    porLlegar,
    productos,
    pagos,
    devoluciones: { lista: devoluciones, tasa: closedOrders ? current.devoluciones.cantidad / closedOrders : 0 },
    gastos: current.registros.costs,
    gastosPorCategoria,
    evolucion: { granularidad: granularity, filas: evolucion },
    pedidos
  };
}
