import mongoose from 'mongoose';
import { isMoneyAmount } from './calculations.js';

const { Schema } = mongoose;
const options = { timestamps: true, strict: true };
const moneyAmount = { type: Number, min: 0, validate: isMoneyAmount };

const productSchema = new Schema({
  nombre: { type: String, required: true, trim: true, maxlength: 100 },
  precio: { ...moneyAmount, required: true },
  productoBaseId: { type: Schema.Types.ObjectId, ref: 'Product', default: null },
  unidadesPorVenta: { type: Number, min: 1, default: 1, validate: Number.isInteger },
  estado: { type: String, enum: ['activo', 'desactivado'], default: 'activo' }
}, options);

const saleSchema = new Schema({
  nombre: { type: String, required: true, trim: true, maxlength: 100 },
  productoId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
  productoNombre: { type: String, required: true },
  precioUnitario: { ...moneyAmount, required: true },
  cantidad: { type: Number, required: true, min: 1, validate: Number.isInteger },
  unidadesPorVenta: { type: Number, min: 1, default: 1, validate: Number.isInteger },
  fecha: { type: Date, required: true },
  estado: { type: String, enum: ['en_espera', 'pagada', 'devuelta', 'cancelada'], default: 'en_espera' },
  valorEsperado: { ...moneyAmount, required: true },
  valorReal: { ...moneyAmount, default: null, validate: (value) => value === null || isMoneyAmount(value) },
  fechaPago: { type: Date, default: null },
  costoFlete: { ...moneyAmount, default: 0 },
  fechaDevolucion: { type: Date, default: null },
  historialEstados: [{ estado: String, en: Date }],
  notas: { type: String, default: '', maxlength: 500 }
}, options);

const expenseSchema = new Schema({
  fecha: { type: Date, required: true },
  monto: { ...moneyAmount, required: true },
  categoriaId: { type: String, required: true },
  plataformaId: { type: String, required: true },
  categoriaNombre: { type: String, default: 'Otros' },
  plataformaNombre: { type: String, default: 'Otros' },
  detalle: { type: String, required: true, trim: true, maxlength: 200 },
  notas: { type: String, default: '', maxlength: 500 }
}, options);

const subscriptionSchema = new Schema({
  nombre: { type: String, required: true, trim: true },
  categoriaId: { type: String, required: true },
  plataformaId: { type: String, required: true },
  categoriaNombre: { type: String, default: 'Otros' },
  plataformaNombre: { type: String, default: 'Otros' },
  valor: { ...moneyAmount, required: true },
  frecuencia: { type: String, enum: ['semanal', 'quincenal', 'mensual', 'bimestral', 'trimestral', 'semestral', 'anual'], default: 'mensual' },
  fechaInicio: { type: Date, required: true },
  estado: { type: String, enum: ['activa', 'inactiva'], default: 'activa' },
  activaDesde: { type: Date, default: null },
  generadoHasta: { type: Date, default: null },
  notas: { type: String, default: '' }
}, options);

const chargeSchema = new Schema({
  suscripcionId: { type: Schema.Types.ObjectId, ref: 'Subscription', required: true },
  nombre: { type: String, required: true },
  fecha: { type: Date, required: true },
  monto: { ...moneyAmount, required: true },
  categoriaId: String,
  plataformaId: String,
  categoriaNombre: String,
  plataformaNombre: String,
  editado: { type: Boolean, default: false },
  notas: { type: String, default: '' }
}, options);
chargeSchema.index({ suscripcionId: 1, fecha: 1 }, { unique: true });

const longExpenseSchema = new Schema({
  fechaInicio: { type: Date, required: true },
  fechaFin: { type: Date, required: true },
  monto: { ...moneyAmount, required: true },
  categoriaId: String,
  plataformaId: String,
  categoriaNombre: { type: String, default: 'Otros' },
  plataformaNombre: { type: String, default: 'Otros' },
  detalle: { type: String, required: true, trim: true, maxlength: 200 },
  notas: { type: String, default: '' }
}, options);

const catalogSchema = new Schema({
  nombre: { type: String, required: true, trim: true, maxlength: 60 },
  estado: { type: String, enum: ['activo', 'desactivado'], default: 'activo' }
}, options);
catalogSchema.index({ nombre: 1 }, { unique: true, collation: { locale: 'es', strength: 1 } });

const settingSchema = new Schema({
  _id: { type: String, default: 'general' },
  nombreNegocio: { type: String, default: 'Safetrics' },
  moneda: { type: String, default: 'COP' },
  zonaHoraria: { type: String, default: 'America/Bogota' },
  diasAlertaEnEspera: { type: Number, default: 15, min: 1 },
  formatoFecha: { type: String, default: 'dd/MM/yyyy' },
  respaldoAutomatico: {
    activo: { type: Boolean, default: true },
    frecuencia: { type: String, enum: ['semanal', 'mensual'], default: 'semanal' },
    carpeta: { type: String, default: 'data/respaldos' },
    conservarUltimos: { type: Number, default: 8, min: 1 },
    ultimo: { type: Date, default: null }
  }
}, options);

export const Product = mongoose.model('Product', productSchema, 'productos');
export const Sale = mongoose.model('Sale', saleSchema, 'ventas');
export const Expense = mongoose.model('Expense', expenseSchema, 'gastos');
export const Subscription = mongoose.model('Subscription', subscriptionSchema, 'suscripciones');
export const Charge = mongoose.model('Charge', chargeSchema, 'suscripcion_cargos');
export const LongExpense = mongoose.model('LongExpense', longExpenseSchema, 'gastos_prolongados');
export const Category = mongoose.model('Category', catalogSchema, 'categorias');
export const Platform = mongoose.model('Platform', catalogSchema, 'plataformas');
export const Setting = mongoose.model('Setting', settingSchema, 'configuracion');

export const catalogModels = { categorias: Category, plataformas: Platform };
