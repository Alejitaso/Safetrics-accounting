import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { Product, Sale, Expense, Subscription, Charge, LongExpense, Setting, catalogModels } from './core/models.js';
import { isMoneyAmount, roundMoney, sumSaleMetrics, splitAcrossDays, billingDates } from './core/calculations.js';
import { createExcelReport, createPdfReport } from './core/export.js';
import { buildFullReport } from './core/full-report.js';
import { buildCostLedger, chargeCoverageEnd, costsInRange, createFinance, dayKey } from '../../shared/finance.mjs';
import { comparisonRows } from './core/comparison-report.js';
import { createFullReportExcel, createFullReportPdf } from './core/full-report-export.js';
import { createBackup, getBackupDirectory } from './core/backup.js';

const app = express();
app.use(cors({ origin: ['http://localhost:5173', 'http://127.0.0.1:5173'] }));
app.use(express.json({ limit: '2mb' }));

const api = express.Router();
const idSchema = z.string().regex(/^[a-f\d]{24}$/i, 'Identificador inválido');
const dateRange = (query) => {
  const filter = {};
  if (query.desde || query.hasta) {
    filter.$gte = query.desde ? new Date(`${query.desde}T00:00:00.000Z`) : new Date('1970-01-01');
    filter.$lte = query.hasta ? new Date(`${query.hasta}T23:59:59.999Z`) : new Date('2999-12-31');
  }
  return filter;
};
const toDate = (value) => new Date(`${String(value).slice(0, 10)}T05:00:00.000Z`);
const dateInput = z.union([
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/).transform(toDate),
  z.coerce.date()
]);
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
async function createDueCharges(subscription, fromDate, throughDate = new Date()) {
  const anchor = subscription.fechaInicio;
  const activeFrom = subscription.activaDesde || anchor;
  const dates = billingDates(anchor, throughDate, subscription.frecuencia, activeFrom)
    .filter((date) => date >= fromDate);
  for (const fecha of dates) {
    await Charge.updateOne(
      { suscripcionId: subscription._id, fecha },
      { $setOnInsert: { suscripcionId: subscription._id, nombre: subscription.nombre, fecha, monto: subscription.valor, categoriaId: subscription.categoriaId, plataformaId: subscription.plataformaId, categoriaNombre: subscription.categoriaNombre, plataformaNombre: subscription.plataformaNombre } },
      { upsert: true }
    );
  }
  return dates;
}
const list = (Model) => wrap(async (req, res) => {
  const page = Math.max(1, Number(req.query.page || 1));
  const limit = Math.min(500, Math.max(1, Number(req.query.limit || 100)));
  const filter = {};
  if (req.query.estado && Model !== Expense && Model !== LongExpense && Model !== Charge) filter.estado = req.query.estado;
  if (req.query.texto) filter.$or = ['nombre', 'detalle', 'productoNombre'].map((key) => ({ [key]: { $regex: String(req.query.texto).slice(0, 80), $options: 'i' } }));
  if (req.query.desde || req.query.hasta) {
    if (Model === LongExpense) {
      if (req.query.desde) filter.fechaFin = { $gte: toDate(req.query.desde) };
      if (req.query.hasta) filter.fechaInicio = { $lte: toDate(req.query.hasta) };
    } else {
      const dateKey = Model === Subscription ? 'fechaInicio' : 'fecha';
      filter[dateKey] = dateRange(req.query);
    }
  }
  const all = req.query.todos === '1';
  const query = Model.find(filter).sort({ fecha: -1, createdAt: -1 });
  const [items, total] = await Promise.all([
    (all ? query : query.skip((page - 1) * limit).limit(limit)).lean(),
    Model.countDocuments(filter)
  ]);
  res.json({ items, total, page: all ? 1 : page, pages: all ? 1 : Math.ceil(total / limit) });
});
async function loadFinanceData() {
  const [sales, products, expenses, longExpenses, charges, subscriptions] = await Promise.all([
    Sale.find().lean(), Product.find().lean(), Expense.find().lean(), LongExpense.find().lean(),
    Charge.find().lean(), Subscription.find().lean()
  ]);
  return { sales, products, expenses, longExpenses, charges, subscriptions };
}
async function getConsolidatedExpenses(query) {
  const filter = {};
  if (query.desde || query.hasta) filter.fecha = dateRange(query);
  if (query.categoria) filter.categoriaId = String(query.categoria);
  if (query.plataforma) filter.plataformaId = String(query.plataforma);
  const { fecha: _dateFilter, ...chargeFilter } = filter;
  const [single, charges, longRecords, subscriptions] = await Promise.all([
    Expense.find(filter).lean(),
    Charge.find(chargeFilter).lean(),
    LongExpense.find(query.categoria || query.plataforma ? {
      ...(query.categoria ? { categoriaId: String(query.categoria) } : {}),
      ...(query.plataforma ? { plataformaId: String(query.plataforma) } : {})
    } : {}).lean(),
    Subscription.find().lean()
  ]);
  const frequencyById = new Map(subscriptions.map((item) => [String(item._id), item.frecuencia]));
  const rows = single.map((item) => ({ ...item, origen: 'unico' }));
  const ledger = buildCostLedger({ charges, subscriptions });
  const rangeStart = query.desde ? String(query.desde).slice(0, 10) : null;
  const rangeEnd = query.hasta ? String(query.hasta).slice(0, 10) : null;
  const assigned = rangeStart || rangeEnd
    ? new Map(costsInRange(ledger, rangeStart || '1970-01-01', rangeEnd || '2999-12-31').items.map((item) => [item.sourceId, item.monto]))
    : null;
  for (const item of charges) {
    const amount = assigned ? assigned.get(String(item._id)) : item.monto;
    if (!amount) continue;
    const start = dayKey(item.fecha);
    rows.push({
      ...item, detalle: item.nombre, origen: 'suscripcion', monto: amount, montoTotalOriginal: item.monto,
      coberturaDesde: start, coberturaHasta: chargeCoverageEnd(start, frequencyById.get(String(item.suscripcionId)))
    });
  }
  for (const item of longRecords) {
    const days = splitAcrossDays(item.monto, item.fechaInicio, item.fechaFin);
    const from = query.desde ? toDate(query.desde) : item.fechaInicio;
    const until = query.hasta ? toDate(query.hasta) : item.fechaFin;
    let amount = 0;
    for (let index = 0; index < days.length; index += 1) {
      const date = new Date(item.fechaInicio);
      date.setUTCDate(date.getUTCDate() + index);
      if (date >= from && date <= until) amount += days[index];
    }
    if (!amount) continue;
    rows.push({
      ...item,
      fecha: item.fechaInicio,
      monto: roundMoney(amount),
      montoTotalOriginal: item.monto,
      origen: 'prolongado'
    });
  }
  const text = String(query.texto || '').trim().toLocaleLowerCase('es');
  const filtered = rows.filter((item) => {
    const matchesText = !text || [item.detalle, item.nombre, item.categoriaNombre, item.plataformaNombre].some((value) => String(value || '').toLocaleLowerCase('es').includes(text));
    const amount = Number(item.monto || 0);
    return matchesText && (!query.montoMin || amount >= Number(query.montoMin)) && (!query.montoMax || amount <= Number(query.montoMax)) && (!query.origen || query.origen === item.origen);
  }).sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
  return filtered;
}

const create = (Model, schema) => wrap(async (req, res) => {
  const input = schema.parse(req.body);
  res.status(201).json(await Model.create(input));
});
const update = (Model, schema) => wrap(async (req, res) => {
  idSchema.parse(req.params.id);
  const input = schema.partial().parse(req.body);
  const item = await Model.findByIdAndUpdate(req.params.id, input, { new: true, runValidators: true });
  if (!item) return res.status(404).json({ error: 'Registro no encontrado' });
  res.json(item);
});
const remove = (Model) => wrap(async (req, res) => {
  idSchema.parse(req.params.id);
  const item = await Model.findByIdAndDelete(req.params.id);
  if (!item) return res.status(404).json({ error: 'Registro no encontrado' });
  res.json({ ok: true });
});

const moneyInput = z.number().nonnegative().refine(isMoneyAmount, 'El monto admite máximo dos decimales.');
const productInput = z.object({
  nombre: z.string().trim().min(1).max(100),
  precio: moneyInput,
  productoBaseId: z.string().nullable().optional(),
  unidadesPorVenta: z.number().int().positive().max(100).optional(),
  estado: z.enum(['activo', 'desactivado']).optional()
});
const saleInput = z.object({
  nombre: z.string().trim().min(1).max(100), productoId: z.string(), productoNombre: z.string(), precioUnitario: moneyInput,
  cantidad: z.number().int().positive(), unidadesPorVenta: z.number().int().positive().max(100).optional(), fecha: dateInput, estado: z.enum(['en_espera', 'pagada', 'devuelta', 'cancelada']).optional(),
  valorEsperado: moneyInput, valorReal: moneyInput.nullable().optional(), fechaPago: dateInput.nullable().optional(),
  costoFlete: moneyInput.optional(), fechaDevolucion: dateInput.nullable().optional(), notas: z.string().max(500).optional()
});
const expenseInput = z.object({ fecha: dateInput, monto: moneyInput, categoriaId: z.string(), plataformaId: z.string(), categoriaNombre: z.string().optional(), plataformaNombre: z.string().optional(), detalle: z.string().trim().min(1).max(200), notas: z.string().max(500).optional() });
const subInput = z.object({ nombre: z.string().trim().min(1), categoriaId: z.string(), plataformaId: z.string(), categoriaNombre: z.string().optional(), plataformaNombre: z.string().optional(), valor: moneyInput, frecuencia: z.enum(['semanal', 'quincenal', 'mensual', 'bimestral', 'trimestral', 'semestral', 'anual']), fechaInicio: dateInput, estado: z.enum(['activa', 'inactiva']).optional(), notas: z.string().optional() });
const longFields = z.object({ fechaInicio: dateInput, fechaFin: dateInput, monto: moneyInput, categoriaId: z.string(), plataformaId: z.string(), categoriaNombre: z.string().optional(), plataformaNombre: z.string().optional(), detalle: z.string().trim().min(1).max(200), notas: z.string().optional() });
const longInput = longFields.refine((data) => data.fechaFin >= data.fechaInicio, { path: ['fechaFin'], message: 'La fecha fin debe ser igual o posterior al inicio.' });

api.get('/salud', (_req, res) => res.json({ ok: true, database: mongoose.connection.readyState === 1, address: '127.0.0.1:4000' }));
api.get('/productos', list(Product));
api.post('/productos', wrap(async (req, res) => {
  const input = productInput.parse(req.body);
  if (input.productoBaseId) {
    const base = await Product.findById(input.productoBaseId).lean();
    if (!base || base.productoBaseId) return res.status(400).json({ error: 'Selecciona un producto base válido, no otra variante.' });
  }
  res.status(201).json(await Product.create(input));
}));
api.put('/productos/:id', wrap(async (req, res) => {
  idSchema.parse(req.params.id);
  const input = productInput.parse(req.body);
  if (input.productoBaseId && await Product.exists({ productoBaseId: req.params.id })) {
    return res.status(409).json({ error: 'Una ficha base que ya tiene paquetes no puede convertirse en una variante.' });
  }
  if (input.productoBaseId) {
    if (input.productoBaseId === req.params.id) return res.status(400).json({ error: 'Un producto no puede ser variante de sí mismo.' });
    const base = await Product.findById(input.productoBaseId).lean();
    if (!base || base.productoBaseId) return res.status(400).json({ error: 'Selecciona un producto base válido, no otra variante.' });
  }
  const product = await Product.findByIdAndUpdate(req.params.id, input, { new: true, runValidators: true });
  if (!product) return res.status(404).json({ error: 'Registro no encontrado' });
  res.json(product);
}));
api.delete('/productos/:id', wrap(async (req, res) => {
  idSchema.parse(req.params.id);
  if (await Sale.exists({ productoId: req.params.id })) return res.status(409).json({ error: 'El producto tiene ventas; desactívalo en lugar de borrarlo.' });
  if (await Product.exists({ productoBaseId: req.params.id })) return res.status(409).json({ error: 'El producto tiene paquetes promocionales; desactívalo en lugar de borrarlo.' });
  await Product.findByIdAndDelete(req.params.id);
  res.json({ ok: true });
}));

api.get('/ventas', list(Sale));
api.post('/ventas', wrap(async (req, res) => {
  const input = saleInput.parse(req.body);
  const product = await Product.findById(input.productoId);
  if (!product || product.estado !== 'activo') return res.status(400).json({ error: 'Selecciona un producto activo.' });
  if (product.productoBaseId) {
    const base = await Product.findById(product.productoBaseId);
    if (!base || base.productoBaseId) return res.status(400).json({ error: 'El producto está asociado a una ficha base inválida.' });
  }
  input.productoNombre = product.nombre;
  input.precioUnitario = product.precio;
  input.unidadesPorVenta = product.unidadesPorVenta || 1;
  input.valorEsperado = input.valorEsperado ?? product.precio * input.cantidad;
  input.historialEstados = [{ estado: input.estado || 'en_espera', en: new Date() }];
  res.status(201).json(await Sale.create(input));
}));
api.put('/ventas/:id', update(Sale, saleInput));
api.delete('/ventas/:id', remove(Sale));
api.patch('/ventas/:id/estado', wrap(async (req, res) => {
  idSchema.parse(req.params.id);
  const body = z.object({ estado: z.enum(['en_espera', 'pagada', 'devuelta', 'cancelada']), fechaPago: dateInput.optional(), costoFlete: moneyInput.optional(), fechaDevolucion: dateInput.optional() }).parse(req.body);
  const sale = await Sale.findById(req.params.id);
  if (!sale) return res.status(404).json({ error: 'Venta no encontrada' });
  sale.estado = body.estado;
  sale.fechaDevolucion = null;
  if (body.estado === 'pagada') { sale.valorReal = sale.valorEsperado; sale.fechaPago = body.fechaPago || new Date(); }
  else if (body.estado === 'devuelta') { sale.valorReal = null; sale.fechaPago = null; sale.costoFlete = body.costoFlete || 0; sale.fechaDevolucion = body.fechaDevolucion || new Date(); }
  else { sale.valorReal = null; sale.fechaPago = null; }
  sale.historialEstados.push({ estado: body.estado, en: new Date() });
  await sale.save();
  res.json(sale);
}));

api.get('/gastos', wrap(async (req, res) => {
  const page = Math.max(1, Number(req.query.page || 1));
  const limit = Math.min(500, Math.max(1, Number(req.query.limit || 100)));
  const rows = await getConsolidatedExpenses(req.query);
  if (req.query.todos === '1') return res.json({ items: rows, total: rows.length, page: 1, pages: 1 });
  res.json({ items: rows.slice((page - 1) * limit, page * limit), total: rows.length, page, pages: Math.ceil(rows.length / limit) });
}));
api.get('/gastos/totales', wrap(async (req, res) => {
  const rows = await getConsolidatedExpenses(req.query);
  const total = rows.reduce((sum, item) => sum + item.monto, 0);
  const group = (key) => Object.values(rows.reduce((result, item) => {
    const label = item[key] || 'Sin clasificar';
    result[label] = result[label] || { nombre: label, monto: 0 };
    result[label].monto += item.monto;
    return result;
  }, {}));
  res.json({ total, porCategoria: group('categoriaNombre'), porPlataforma: group('plataformaNombre'), porOrigen: group('origen') });
}));
api.post('/gastos', create(Expense, expenseInput));
api.put('/gastos/:id', update(Expense, expenseInput));
api.delete('/gastos/:id', remove(Expense));
api.get('/gastos-prolongados', list(LongExpense));
api.post('/gastos-prolongados', create(LongExpense, longInput));
api.put('/gastos-prolongados/:id', wrap(async (req, res) => {
  idSchema.parse(req.params.id);
  const input = longFields.partial().parse(req.body);
  const current = await LongExpense.findById(req.params.id);
  if (!current) return res.status(404).json({ error: 'Registro no encontrado' });
  const start = input.fechaInicio || current.fechaInicio;
  const end = input.fechaFin || current.fechaFin;
  if (end < start) return res.status(400).json({ error: 'La fecha fin debe ser igual o posterior al inicio.' });
  res.json(await LongExpense.findByIdAndUpdate(req.params.id, input, { new: true, runValidators: true }));
}));
api.delete('/gastos-prolongados/:id', remove(LongExpense));
api.get('/gastos-prolongados/cruces', wrap(async (req, res) => {
  const query = z.object({ fechaInicio: z.coerce.date(), fechaFin: z.coerce.date(), categoriaId: z.string(), plataformaId: z.string() }).parse(req.query);
  res.json(await LongExpense.find({ categoriaId: query.categoriaId, plataformaId: query.plataformaId, fechaInicio: { $lte: query.fechaFin }, fechaFin: { $gte: query.fechaInicio } }).lean());
}));

api.get('/suscripciones', list(Subscription));
api.post('/suscripciones', wrap(async (req, res) => {
  const input = subInput.parse(req.body);
  input.activaDesde = input.fechaInicio;
  input.generadoHasta = null;
  const subscription = await Subscription.create(input);
  const created = subscription.estado === 'activa'
    ? await createDueCharges(subscription, subscription.fechaInicio)
    : [];
  if (subscription.estado === 'activa') {
    subscription.generadoHasta = new Date();
    await subscription.save();
  }
  res.status(201).json({ ...subscription.toObject(), cobrosGenerados: created.length });
}));
api.put('/suscripciones/:id', update(Subscription, subInput));
api.delete('/suscripciones/:id', wrap(async (req, res) => {
  idSchema.parse(req.params.id);
  if (await Charge.exists({ suscripcionId: req.params.id })) return res.status(409).json({ error: 'La suscripción tiene cobros; desactívala.' });
  await Subscription.findByIdAndDelete(req.params.id);
  res.json({ ok: true });
}));
api.patch('/suscripciones/:id/estado', wrap(async (req, res) => {
  idSchema.parse(req.params.id);
  const estado = z.enum(['activa', 'inactiva']).parse(req.body.estado);
  const sub = await Subscription.findById(req.params.id);
  if (!sub) return res.status(404).json({ error: 'Suscripción no encontrada' });
  if (estado === 'activa' && sub.estado === 'inactiva') { sub.activaDesde = toDate(new Date().toISOString()); sub.generadoHasta = sub.activaDesde; }
  sub.estado = estado;
  await sub.save();
  res.json(sub);
}));
api.get('/suscripciones/:id/cobros', wrap(async (req, res) => {
  idSchema.parse(req.params.id);
  res.json(await Charge.find({ suscripcionId: req.params.id }).sort({ fecha: -1 }).lean());
}));
api.put('/suscripciones/cobros/:cobroId', wrap(async (req, res) => {
  idSchema.parse(req.params.cobroId);
  const data = z.object({ fecha: dateInput.optional(), monto: moneyInput.optional(), notas: z.string().optional() }).parse(req.body);
  const charge = await Charge.findByIdAndUpdate(req.params.cobroId, { ...data, editado: true }, { new: true, runValidators: true });
  if (!charge) return res.status(404).json({ error: 'Cobro no encontrado' });
  res.json(charge);
}));
api.delete('/suscripciones/cobros/:cobroId', wrap(async (req, res) => {
  idSchema.parse(req.params.cobroId);
  const charge = await Charge.findByIdAndDelete(req.params.cobroId);
  if (!charge) return res.status(404).json({ error: 'Cobro no encontrado' });
  res.json({ ok: true });
}));
api.post('/suscripciones/:id/generar-faltantes', wrap(async (req, res) => {
  idSchema.parse(req.params.id);
  const sub = await Subscription.findById(req.params.id);
  if (!sub || sub.estado !== 'activa') return res.status(400).json({ error: 'Solo se generan cobros para suscripciones activas.' });
  const preview = req.query.vistaPrevia === 'true';
  const start = sub.activaDesde || sub.fechaInicio;
  const now = new Date();
  const dueDates = billingDates(sub.fechaInicio, now, sub.frecuencia, start);
  const existing = dueDates.length ? await Charge.find({ suscripcionId: sub._id, fecha: { $in: dueDates } }).select('fecha').lean() : [];
  const existingDates = new Set(existing.map((charge) => new Date(charge.fecha).getTime()));
  const dates = dueDates.filter((date) => !existingDates.has(date.getTime()));
  if (!preview) {
    await createDueCharges(sub, start, now);
    sub.generadoHasta = now;
    await sub.save();
  }
  res.json({ cantidad: dates.length, fechas: dates, vistaPrevia: preview });
}));
api.post('/suscripciones/generar-faltantes', wrap(async (req, res) => {
  const preview = req.query.vistaPrevia === 'true';
  const now = new Date();
  const active = await Subscription.find({ estado: 'activa' });
  const previews = [];
  for (const subscription of active) {
    const start = subscription.activaDesde || subscription.fechaInicio;
    const dueDates = billingDates(subscription.fechaInicio, now, subscription.frecuencia, start);
    const existing = dueDates.length ? await Charge.find({ suscripcionId: subscription._id, fecha: { $in: dueDates } }).select('fecha').lean() : [];
    const existingDates = new Set(existing.map((charge) => new Date(charge.fecha).getTime()));
    const dates = dueDates.filter((date) => !existingDates.has(date.getTime()));
    previews.push({ suscripcionId: subscription._id, nombre: subscription.nombre, cantidad: dates.length, fechas: dates });
    if (!preview && dates.length) {
      await createDueCharges(subscription, start, now);
      subscription.generadoHasta = now;
      await subscription.save();
    }
  }
  res.json({ vistaPrevia: preview, suscripciones: previews, cantidad: previews.reduce((sum, item) => sum + item.cantidad, 0) });
}));

api.get('/catalogos/:lista', wrap(async (req, res) => {
  const Model = catalogModels[req.params.lista];
  if (!Model) return res.status(404).json({ error: 'Catálogo no encontrado' });
  res.json({ items: await Model.find().sort({ nombre: 1 }).lean() });
}));
api.post('/catalogos/:lista', wrap(async (req, res) => {
  const Model = catalogModels[req.params.lista];
  if (!Model) return res.status(404).json({ error: 'Catálogo no encontrado' });
  const body = z.object({ nombre: z.string().trim().min(1).max(60) }).parse(req.body);
  res.status(201).json(await Model.create(body));
}));
api.put('/catalogos/:lista/:id', wrap(async (req, res) => {
  const Model = catalogModels[req.params.lista];
  if (!Model) return res.status(404).json({ error: 'Catálogo no encontrado' });
  idSchema.parse(req.params.id);
  const body = z.object({ nombre: z.string().trim().min(1).max(60).optional(), estado: z.enum(['activo', 'desactivado']).optional() }).parse(req.body);
  const item = await Model.findByIdAndUpdate(req.params.id, body, { new: true, runValidators: true });
  if (!item) return res.status(404).json({ error: 'Elemento no encontrado' });
  if (body.nombre) {
    const field = req.params.lista === 'categorias' ? ['categoriaId', 'categoriaNombre'] : ['plataformaId', 'plataformaNombre'];
    for (const ReferenceModel of [Expense, Subscription, Charge, LongExpense]) {
      await ReferenceModel.updateMany({ [field[0]]: req.params.id }, { $set: { [field[1]]: body.nombre } });
    }
  }
  res.json(item);
}));

api.get('/configuracion', wrap(async (_req, res) => res.json(await Setting.findById('general').lean())));
api.put('/configuracion', wrap(async (req, res) => {
  const body = z.object({
    nombreNegocio: z.string().trim().min(1).max(100), diasAlertaEnEspera: z.number().int().min(1).max(365),
    formatoFecha: z.string(), respaldoAutomatico: z.object({ activo: z.boolean(), frecuencia: z.enum(['semanal', 'mensual']), carpeta: z.string(), conservarUltimos: z.number().int().min(1).max(100) })
  }).parse(req.body);
  res.json(await Setting.findByIdAndUpdate('general', body, { new: true, runValidators: true }));
}));

api.get('/resumen', wrap(async (req, res) => {
  const today = dayKey(new Date());
  const desde = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.desde)) ? String(req.query.desde) : `${today.slice(0, 7)}-01`;
  const hasta = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.hasta)) ? String(req.query.hasta) : today;
  if (desde > hasta) return res.status(400).json({ error: 'Selecciona un rango de fechas válido.' });
  const [data, setting] = await Promise.all([loadFinanceData(), Setting.findById('general').lean()]);
  res.json(buildFullReport({ desde, hasta, ...data, diasAlerta: setting?.diasAlertaEnEspera || 15 }));
}));
api.get('/comparativas/:tipo', wrap(async (req, res) => {
  const sales = await Sale.find().lean();
  const totals = sumSaleMetrics(sales);
  res.json({ tipo: req.params.tipo, esperadoRegistrado: totals.esperadoRegistrado, real: totals.real, porCobrar: totals.porCobrar, devuelto: totals.devuelto, cancelado: totals.cancelado });
}));

api.get('/respaldo', wrap(async (_req, res) => {
  const dir = await getBackupDirectory();
  await fs.mkdir(dir, { recursive: true });
  const files = (await fs.readdir(dir)).filter((name) => name.endsWith('.json'));
  res.json(files.map((name) => ({ nombre: name })));
}));
api.post('/respaldo/restaurar', wrap(async (req, res) => {
  const { nombre } = z.object({ nombre: z.string().min(1).max(120) }).parse(req.body);
  if (path.basename(nombre) !== nombre || !nombre.endsWith('.json')) return res.status(400).json({ error: 'Nombre de respaldo no válido.' });
  const dir = await getBackupDirectory();
  const parsed = JSON.parse(await fs.readFile(path.join(dir, nombre), 'utf8'));
  if (!parsed?.colecciones || typeof parsed.colecciones !== 'object') return res.status(400).json({ error: 'El archivo no contiene un respaldo compatible.' });
  const models = { productos: Product, ventas: Sale, gastos: Expense, suscripciones: Subscription, suscripcion_cargos: Charge, gastos_prolongados: LongExpense, categorias: catalogModels.categorias, plataformas: catalogModels.plataformas, configuracion: Setting };
  for (const [collection, Model] of Object.entries(models)) {
    const records = parsed.colecciones[collection];
    if (!Array.isArray(records)) continue;
    await Model.deleteMany({});
    if (records.length) await Model.insertMany(records, { ordered: true });
  }
  res.json({ ok: true, nombre });
}));
api.post('/respaldo', wrap(async (_req, res) => {
  const name = await createBackup();
  res.status(201).json({ nombre: name });
}));

api.get('/exportacion/:modulo', wrap(async (req, res) => {
  const moduleName = String(req.params.modulo);
  let reportFilters = req.query;
  if (moduleName === 'completo' || moduleName === 'resumen') {
    const desde = String(req.query.desde || '');
    const hasta = String(req.query.hasta || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(desde) || !/^\d{4}-\d{2}-\d{2}$/.test(hasta) || desde > hasta) {
      return res.status(400).json({ error: 'Selecciona un rango de fechas válido.' });
    }
    const [data, setting] = await Promise.all([loadFinanceData(), Setting.findById('general').lean()]);
    const report = buildFullReport({ desde, hasta, ...data, diasAlerta: setting?.diasAlertaEnEspera || 15 });
    const fileName = `Safetrics_${report.titulo.replace(/\s+/g, '_')}_${desde}${desde === hasta ? '' : `_${hasta}`}`;
    if (req.query.formato === 'xlsx') {
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename=${fileName}.xlsx`);
      return res.send(Buffer.from(await createFullReportExcel(report)));
    }
    if (req.query.formato === 'pdf') {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename=${fileName}.pdf`);
      return res.send(await createFullReportPdf(report));
    }
    return res.status(400).json({ error: 'Formato no válido; usa pdf o xlsx.' });
  }
  const Models = { productos: Product, ventas: Sale, gastos: Expense, suscripciones: Subscription, 'gastos-prolongados': LongExpense };
  const Model = Models[moduleName];
  let rows;
  if (moduleName === 'gastos') rows = await getConsolidatedExpenses(req.query);
  else if (Model) {
    const filter = {};
    if (moduleName === 'ventas') {
      if (req.query.desde || req.query.hasta) filter.fecha = dateRange(req.query);
      if (req.query.estado) filter.estado = String(req.query.estado);
      if (req.query.producto) filter.productoId = String(req.query.producto);
      if (req.query.texto) {
        const text = String(req.query.texto).slice(0, 80);
        filter.$or = ['nombre', 'productoNombre', 'estado'].map((key) => ({ [key]: { $regex: text, $options: 'i' } }));
      }
    } else if (moduleName === 'productos') {
      if (req.query.estado) filter.estado = String(req.query.estado);
      if (req.query.texto) filter.nombre = { $regex: String(req.query.texto).slice(0, 80), $options: 'i' };
    } else if (moduleName === 'suscripciones') {
      if (req.query.estado && req.query.estado !== 'Todos') filter.estado = String(req.query.estado);
      if (req.query.desde || req.query.hasta) filter.fechaInicio = dateRange(req.query);
      if (req.query.texto) filter.nombre = { $regex: String(req.query.texto).slice(0, 80), $options: 'i' };
    } else if (moduleName === 'gastos-prolongados') {
      if (req.query.desde) filter.fechaFin = { $gte: toDate(req.query.desde) };
      if (req.query.hasta) filter.fechaInicio = { $lte: toDate(req.query.hasta) };
      if (req.query.texto) filter.detalle = { $regex: String(req.query.texto).slice(0, 80), $options: 'i' };
    }
    rows = await Model.find(filter).lean();
    if (moduleName === 'ventas') {
      rows = rows.map((sale) => ({
        ...sale,
        unidadesVendidas: Number(sale.cantidad || 0) * Number(sale.unidadesPorVenta || 1),
        valorVentaBruto: Number(sale.precioUnitario || 0) * Number(sale.cantidad || 0)
      }));
    }
    if (moduleName === 'productos') {
      const salesFilter = Object.keys(dateRange(req.query)).length ? { fecha: dateRange(req.query) } : {};
      const sales = await Sale.find(salesFilter).lean();
      const salesByProduct = sales.reduce((totals, sale) => {
        const key = String(sale.productoId);
        const current = totals.get(key) || { orders: 0, units: 0 };
        current.orders += 1;
        current.units += Number(sale.cantidad || 0) * Number(sale.unidadesPorVenta || 1);
        totals.set(key, current);
        return totals;
      }, new Map());
      const products = await Product.find().lean();
      const productById = new Map(products.map((product) => [String(product._id), product]));
      rows = rows.map((product) => {
        const totals = salesByProduct.get(String(product._id)) || { orders: 0, units: 0 };
        return {
          ...product,
          productoBaseNombre: product.productoBaseId ? productById.get(String(product.productoBaseId))?.nombre || 'Producto base no disponible' : '',
          pedidosGenerados: totals.orders,
          unidadesVendidas: totals.units
        };
      });
    }
  }
  else if (moduleName === 'comparativas') {
    const requestedMonths = req.query.meses ? String(req.query.meses).split(',') : [];
    if (requestedMonths.length > 24 || requestedMonths.some((month) => !/^\d{4}-(0[1-9]|1[0-2])$/.test(month))) {
      return res.status(400).json({ error: 'La selección de meses no es válida.' });
    }
    const desde = String(req.query.desde || '').slice(0, 10);
    const hasta = String(req.query.hasta || '').slice(0, 10);
    if (!requestedMonths.length && (!desde || !hasta || desde > hasta)) return res.status(400).json({ error: 'Selecciona un rango de fechas válido.' });
    rows = comparisonRows(createFinance(await loadFinanceData()), {
      desde, hasta, meses: [...new Set(requestedMonths)].sort(), estado: req.query.estado, hoy: dayKey(new Date())
    });
  } else return res.status(400).json({ error: 'Módulo de exportación no válido' });
  const format = req.query.formato;
  const safe = moduleName.replace(/[^a-z-]/g, '');
  if (format === 'xlsx') {
    const workbook = await createExcelReport(moduleName, rows, reportFilters);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=Safetrics_${safe}.xlsx`);
    return res.send(Buffer.from(workbook));
  }
  if (format === 'pdf') {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=Safetrics_${safe}.pdf`);
    return res.send(await createPdfReport(moduleName, rows, reportFilters));
  }
  res.status(400).json({ error: 'Formato no válido; usa pdf o xlsx.' });
}));

app.use('/api', api);
app.use((error, _req, res, _next) => {
  if (error instanceof z.ZodError) return res.status(400).json({ error: 'Datos no válidos', detalles: error.issues });
  if (error?.code === 11000) return res.status(409).json({ error: 'Ya existe un registro con esos datos.' });
  if (error?.name === 'CastError') return res.status(400).json({ error: 'Identificador o valor no válido.' });
  console.error('[API]', error);
  res.status(500).json({ error: 'Error interno del servidor', detalles: error.message });
});

export default app;
