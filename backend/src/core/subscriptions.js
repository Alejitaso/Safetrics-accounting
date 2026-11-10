import { Charge, Subscription } from './models.js';
import { billingDates } from './calculations.js';

// Fechas de cobro vencidas que aún no se han generado: se compara contra el instante de la última revisión (generadoHasta).
export function pendingChargeDates(subscription, now = new Date()) {
  const activeFrom = subscription.activaDesde || subscription.fechaInicio;
  const generatedUntil = subscription.generadoHasta ? new Date(subscription.generadoHasta) : null;
  return billingDates(subscription.fechaInicio, now, subscription.frecuencia, activeFrom)
    .filter((date) => !generatedUntil || date > generatedUntil);
}

export async function generateDueCharges() {
  const subscriptions = await Subscription.find({ estado: 'activa' });
  const now = new Date();
  let created = 0;
  for (const subscription of subscriptions) {
    for (const fecha of pendingChargeDates(subscription, now)) {
      const result = await Charge.updateOne(
        { suscripcionId: subscription._id, fecha },
        { $setOnInsert: { suscripcionId: subscription._id, nombre: subscription.nombre, fecha, monto: subscription.valor, categoriaId: subscription.categoriaId, plataformaId: subscription.plataformaId, categoriaNombre: subscription.categoriaNombre, plataformaNombre: subscription.plataformaNombre } },
        { upsert: true }
      );
      if (result.upsertedCount) created += 1;
    }
    subscription.generadoHasta = now;
    await subscription.save();
  }
  return created;
}
