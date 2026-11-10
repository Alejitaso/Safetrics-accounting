export const money = (value = 0) => {
  const amount = Number(value) || 0;
  return `${amount < 0 ? '−' : ''}$${Math.abs(amount).toLocaleString('es-CO', { maximumFractionDigits: 2 })}`;
};

export const percent = (value = 0) => `${(Number(value || 0) * 100).toLocaleString('es-CO', { maximumFractionDigits: 1 })} %`;

export const dateLabel = (value, format = 'dd/MM/yyyy') => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC'
  }).formatToParts(date).map(({ type, value: part }) => [type, part]));
  return format === 'yyyy-MM-dd'
    ? `${parts.year}-${parts.month}-${parts.day}`
    : `${parts.day}/${parts.month}/${parts.year}`;
};

export const todayInput = () => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'America/Bogota'
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
};

export const shortId = (item) => String(item?._id || item?.id || 'a1e001').slice(-6);

export const counted = (sale) => {
  if (sale.estado === 'pagada') return sale.valorReal ?? sale.valorEsperado ?? 0;
  if (sale.estado === 'en_espera') return sale.valorEsperado || 0;
  if (sale.estado === 'devuelta') return -(sale.costoFlete || 0);
  return 0;
};
