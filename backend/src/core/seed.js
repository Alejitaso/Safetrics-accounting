import { Category, Platform, Setting } from './models.js';

export async function seedDefaults() {
  const categories = ['Suscripciones', 'API', 'Publicidad', 'Herramientas / Software', 'Diseño y contenido', 'Comisiones y pasarelas', 'Logística y empaques', 'Otros'];
  const platforms = ['Plataforma de anuncios A', 'Plataforma de anuncios B', 'Tienda en línea', 'Proveedor logístico', 'Herramienta de diseño', 'Asistente de IA', 'Hosting', 'Mensajería', 'Banco / Pasarela', 'Otros'];
  for (const nombre of categories) await Category.updateOne({ nombre }, { $setOnInsert: { nombre, estado: 'activo' } }, { upsert: true, collation: { locale: 'es', strength: 1 } });
  for (const nombre of platforms) await Platform.updateOne({ nombre }, { $setOnInsert: { nombre, estado: 'activo' } }, { upsert: true, collation: { locale: 'es', strength: 1 } });
  await Setting.updateOne({ _id: 'general' }, { $setOnInsert: { _id: 'general' } }, { upsert: true });
}
