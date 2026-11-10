import fs from 'node:fs/promises';
import path from 'node:path';
import { Charge, Expense, LongExpense, Product, Sale, Setting, Subscription, catalogModels } from './models.js';

const collectionModels = {
  productos: Product,
  ventas: Sale,
  gastos: Expense,
  suscripciones: Subscription,
  suscripcion_cargos: Charge,
  gastos_prolongados: LongExpense,
  categorias: catalogModels.categorias,
  plataformas: catalogModels.plataformas,
  configuracion: Setting
};

export async function getBackupDirectory() {
  const setting = await Setting.findById('general').lean();
  const folder = setting?.respaldoAutomatico?.carpeta || 'data/respaldos';
  return path.resolve(process.cwd(), '..', folder);
}

export async function createBackup() {
  const setting = await Setting.findById('general');
  const colecciones = {};
  for (const [name, Model] of Object.entries(collectionModels)) colecciones[name] = await Model.find().lean();
  const directory = await getBackupDirectory();
  await fs.mkdir(directory, { recursive: true });
  const name = `safetrics_${new Date().toISOString().replace(/:/g, '').replace('T', '_').slice(0, 15)}.json`;
  await fs.writeFile(path.join(directory, name), JSON.stringify({ meta: { fecha: new Date(), versionEsquema: setting?.schemaVersion || 1 }, colecciones }, null, 2), 'utf8');
  const retention = setting?.respaldoAutomatico?.conservarUltimos || 8;
  const backups = (await fs.readdir(directory)).filter((file) => /^safetrics_\d{4}-\d{2}-\d{2}_\d{4}\.json$/.test(file)).sort().reverse();
  for (const oldFile of backups.slice(retention)) await fs.unlink(path.join(directory, oldFile));
  if (setting) {
    setting.respaldoAutomatico.ultimo = new Date();
    await setting.save();
  }
  return name;
}

export async function runAutomaticBackup() {
  const setting = await Setting.findById('general').lean();
  const schedule = setting?.respaldoAutomatico;
  if (!schedule?.activo) return null;
  const now = new Date();
  const last = schedule.ultimo ? new Date(schedule.ultimo) : null;
  const due = !last || (schedule.frecuencia === 'mensual'
    ? now.getUTCFullYear() * 12 + now.getUTCMonth() > last.getUTCFullYear() * 12 + last.getUTCMonth()
    : now.getTime() - last.getTime() >= 7 * 86400000);
  return due ? createBackup() : null;
}

