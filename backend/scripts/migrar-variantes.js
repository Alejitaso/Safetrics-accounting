// Convierte los productos "Nombre xN" en variantes de su producto base y corrige sus ventas:
// cada venta es un pedido (cantidad = 1) y las unidades salen de la variante.
// Uso: node scripts/migrar-variantes.js            → solo muestra los cambios
//      node scripts/migrar-variantes.js --aplicar  → crea un respaldo y aplica los cambios
import 'dotenv/config';
import mongoose from 'mongoose';
import { Product, Sale } from '../src/core/models.js';
import { createBackup } from '../src/core/backup.js';

const apply = process.argv.includes('--aplicar');
await mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/safetrics');

const products = await Product.find().lean();
const byName = new Map(products.map((product) => [product.nombre.trim().toLowerCase(), product]));
const productChanges = [];
for (const product of products) {
  const match = product.nombre.trim().match(/^(.*\S)\s+x(\d+)$/i);
  const base = match && byName.get(match[1].toLowerCase());
  if (!base || base._id.equals(product._id) || product.productoBaseId) continue;
  productChanges.push({ product, base, units: Number(match[2]) });
}
const unitsByProduct = new Map(products.map((product) => [String(product._id), product.unidadesPorVenta || 1]));
for (const { product, units } of productChanges) unitsByProduct.set(String(product._id), units);

const sales = await Sale.find().lean();
const saleChanges = [];
for (const sale of sales) {
  const units = unitsByProduct.get(String(sale.productoId)) || 1;
  const update = {};
  if (units > 1 && sale.cantidad === units && (sale.unidadesPorVenta || 1) === 1) update.cantidad = 1;
  if ((sale.unidadesPorVenta || 1) !== units || sale.unidadesPorVenta == null) update.unidadesPorVenta = units;
  if (Object.keys(update).length) saleChanges.push({ sale, update });
}
const legacyFields = products.filter((product) => product.precioPromocionalDosUnidades != null);

console.log(`Productos a convertir en variante: ${productChanges.length}`);
for (const { product, base, units } of productChanges) console.log(`  · "${product.nombre}" → variante de "${base.nombre}" con ${units} unidades por pedido`);
console.log(`Ventas a corregir: ${saleChanges.length}`);
const summary = saleChanges.reduce((totals, { sale, update }) => {
  const key = `${sale.productoNombre}: cantidad ${sale.cantidad} → ${update.cantidad ?? sale.cantidad}, unidades por pedido → ${update.unidadesPorVenta ?? sale.unidadesPorVenta}`;
  totals.set(key, (totals.get(key) || 0) + 1);
  return totals;
}, new Map());
for (const [line, total] of summary) console.log(`  · ${total} × ${line}`);
console.log(`Campos antiguos a limpiar (precioPromocionalDosUnidades): ${legacyFields.length}`);

if (!apply) {
  console.log('\nVista previa: no se modificó nada. Ejecuta con --aplicar para guardar los cambios.');
} else {
  const backup = await createBackup();
  console.log(`\nRespaldo creado: ${backup}`);
  for (const { product, base, units } of productChanges) {
    await Product.updateOne({ _id: product._id }, { $set: { productoBaseId: base._id, unidadesPorVenta: units } });
  }
  for (const { sale, update } of saleChanges) await Sale.updateOne({ _id: sale._id }, { $set: update });
  if (legacyFields.length) await Product.collection.updateMany({}, { $unset: { precioPromocionalDosUnidades: '' } });
  console.log('Cambios aplicados.');
}
await mongoose.disconnect();
