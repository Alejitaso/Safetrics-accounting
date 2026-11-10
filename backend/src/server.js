import 'dotenv/config';
import mongoose from 'mongoose';
import app from './app.js';
import { seedDefaults } from './core/seed.js';
import { runAutomaticBackup } from './core/backup.js';
import { generateDueCharges } from './core/subscriptions.js';

const port = Number(process.env.BACKEND_PORT || 4000);
const mongoUri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/safetrics';

try {
  await mongoose.connect(mongoUri);
  await seedDefaults();
  const generatedCharges = await generateDueCharges();
  if (generatedCharges) console.log(`[Safetrics] Se generaron ${generatedCharges} cobros de suscripción.`);
  try {
    const backup = await runAutomaticBackup();
    if (backup) console.log(`[Safetrics] Respaldo automático creado: ${backup}`);
  } catch (error) {
    console.error('[Safetrics] No se pudo crear el respaldo automático:', error.message);
  }
  const dailyTasks = setInterval(async () => {
    try {
      const count = await generateDueCharges();
      if (count) console.log(`[Safetrics] Se generaron ${count} cobros de suscripción.`);
      const backup = await runAutomaticBackup();
      if (backup) console.log(`[Safetrics] Respaldo automático creado: ${backup}`);
    } catch (error) {
      console.error('[Safetrics] Falló una tarea programada:', error.message);
    }
  }, 60 * 60 * 1000);
  dailyTasks.unref();
  app.listen(port, '127.0.0.1', () => {
    console.log(`[Safetrics] API disponible en http://127.0.0.1:${port}/api`);
  });
} catch (error) {
  console.error('[Safetrics] No fue posible iniciar el backend:', error.message);
  process.exitCode = 1;
}
