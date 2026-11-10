import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowRight, Bell, CalendarDays, Check, Database,
  Filter, Plus, ShieldCheck, TrendingDown, TrendingUp, Wallet, X
} from 'lucide-react';
import { modules, pageTitles } from './modules/index.js';
import { dateLabel, money, percent, todayInput, shortId, counted } from './core/format.js';
import { buildFullReport, comparisonPeriods, costsInRange, createFinance, dayKey, daysBetween, monthlyEquivalent, nextBillingKey, roundMoney, shiftDays } from '../../shared/finance.mjs';
import { Button, Card, CompleteReportButton, ExportButton, Kpi, Modal, PageHeading, Pagination, ProgressRow, Status, Table, Toolbar, usePagination } from './shared/ui.jsx';

const normalizeExpense = (item) => ({
  ...item,
  origen: ({ unico: 'Pago único', suscripcion: 'Suscripción', prolongado: 'Prolongado' })[item.origen] || item.origen || 'Pago único'
});
const uniqueCatalogOptions = (items) => {
  const seen = new Set();
  return items.filter((item) => {
    const key = String(item.nombre || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleLowerCase('es');
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};
const apiPath = {
  productos: '/productos', ventas: '/ventas', gastos: '/gastos',
  suscripciones: '/suscripciones', 'gastos-prolongados': '/gastos-prolongados'
};
function periodRange(label) {
  if (label === 'Octubre 2026') return { desde: '2026-10-01', hasta: '2026-10-31' };
  const today = todayInput();
  if (label === 'Este año') {
    const year = today.slice(0, 4);
    return { desde: `${year}-01-01`, hasta: `${year}-12-31` };
  }
  if (label === 'Hoy') return { desde: today, hasta: today };
  const date = new Date(`${today}T12:00:00Z`);
  if (label === 'Ayer') {
    date.setUTCDate(date.getUTCDate() - 1);
    const yesterday = date.toISOString().slice(0, 10);
    return { desde: yesterday, hasta: yesterday };
  }
  if (label === 'Esta semana') {
    const day = (date.getUTCDay() + 6) % 7;
    const start = new Date(date);
    start.setUTCDate(start.getUTCDate() - day);
    return { desde: start.toISOString().slice(0, 10), hasta: today };
  }
  if (label === 'Este mes') return { desde: `${today.slice(0, 7)}-01`, hasta: today };
  if (label === 'Este trimestre') {
    const quarterStart = Math.floor((date.getUTCMonth()) / 3) * 3;
    const start = new Date(Date.UTC(date.getUTCFullYear(), quarterStart, 1));
    return { desde: start.toISOString().slice(0, 10), hasta: today };
  }
  return {};
}

async function request(path, options = {}) {
  const response = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  const body = response.headers.get('content-type')?.includes('application/json') ? await response.json() : response;
  if (!response.ok) throw new Error(body?.error || `Error ${response.status}`);
  return body;
}

function App() {
  const [active, setActive] = useState(() => modules.find(({ id }) => `/${id}` === window.location.pathname)?.id || 'resumen');
  const [periodFilters, setPeriodFilters] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const page = modules.find(({ id }) => `/${id}` === window.location.pathname)?.id || 'resumen';
    const prefix = `${page}_`;
    return {
      [page]: {
        period: params.get(`${prefix}periodo`) || params.get('periodo') || 'Este año',
        customRange: {
          desde: params.get(`${prefix}desde`) || params.get('desde') || '',
          hasta: params.get(`${prefix}hasta`) || params.get('hasta') || ''
        }
      }
    };
  });
  const [health, setHealth] = useState(false);
  const [connectionError, setConnectionError] = useState('');
  const [data, setData] = useState({ productos: [], ventas: [], gastos: [], suscripciones: [], 'gastos-prolongados': [], categorias: [], plataformas: [] });
  const [queries, setQueries] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const page = modules.find(({ id }) => `/${id}` === window.location.pathname)?.id || 'resumen';
    return { [page]: params.get(`${page}_texto`) || params.get('texto') || '' };
  });
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const notificationsRef = useRef(null);
  const [modal, setModal] = useState(null);
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);
  const [settings, setSettings] = useState({ nombreNegocio: 'Safetrics', diasAlertaEnEspera: 15, formatoFecha: 'dd/MM/yyyy', respaldoAutomatico: { activo: true, frecuencia: 'semanal', carpeta: 'data/respaldos', conservarUltimos: 8 } });
  const [gastosTab, setGastosTab] = useState('Todos');
  const [catalogTab, setCatalogTab] = useState('Categorías');
  const [statusFilter, setStatusFilter] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const page = modules.find(({ id }) => `/${id}` === window.location.pathname)?.id || 'resumen';
    return params.get(`${page}_estado`) || params.get('estado') || 'Todos';
  });
  const query = queries[active] || '';
  const activePeriodFilter = periodFilters[active] || { period: 'Este año', customRange: { desde: '', hasta: '' } };
  const filterPeriod = activePeriodFilter.period;
  const customRange = activePeriodFilter.customRange;
  const [selectedSale, setSelectedSale] = useState(null);

  const notify = useCallback((message, tone = 'success') => {
    window.clearTimeout(toastTimer.current);
    setToast({ message, tone });
    toastTimer.current = window.setTimeout(() => setToast(null), 3600);
  }, []);
  const formatDate = useCallback((value) => dateLabel(value, settings.formatoFecha), [settings.formatoFecha]);
  useEffect(() => () => window.clearTimeout(toastTimer.current), []);
  const updateUrlFilter = useCallback((key, value) => {
    const url = new URL(window.location.href);
    const scopedKey = `${active}_${key}`;
    if (value && value !== 'Todos') url.searchParams.set(scopedKey, value);
    else url.searchParams.delete(scopedKey);
    window.history.replaceState({}, '', url);
  }, [active]);

  const navigate = useCallback((id) => {
    const nextUrl = new URL(`/${id}`, window.location.origin);
    const params = new URLSearchParams(window.location.search);
    params.forEach((value, key) => nextUrl.searchParams.set(key, value));
    window.history.pushState({}, '', nextUrl);
    setActive(id);
    setStatusFilter(params.get(`${id}_estado`) || 'Todos');
  }, []);

  const selectPeriod = (period) => {
    let nextRange = customRange;
    if (period === 'Personalizado') {
      const today = todayInput();
      const startOfMonth = `${today.slice(0, 7)}-01`;
      const desde = customRange.desde || startOfMonth;
      const hasta = customRange.hasta || today;
      nextRange = { desde, hasta: desde > hasta ? desde : hasta };
    }
    setPeriodFilters((current) => ({ ...current, [active]: { period, customRange: nextRange } }));
    const url = new URL(window.location.href);
    url.searchParams.set(`${active}_periodo`, period);
    if (period === 'Personalizado') {
      url.searchParams.set(`${active}_desde`, nextRange.desde);
      url.searchParams.set(`${active}_hasta`, nextRange.hasta);
    } else {
      const range = periodRange(period);
      url.searchParams.delete(`${active}_desde`);
      url.searchParams.delete(`${active}_hasta`);
      Object.entries(range).forEach(([key, value]) => url.searchParams.set(`${active}_${key}`, value));
    }
    url.searchParams.delete('periodo');
    url.searchParams.delete('desde');
    url.searchParams.delete('hasta');
    window.history.replaceState({}, '', url);
  };

  const updateCustomRange = (key, value) => {
    const current = { ...customRange, [key]: value };
    if (current.desde && current.hasta && current.desde > current.hasta) {
      if (key === 'desde') current.hasta = value;
      else current.desde = value;
    }
    setPeriodFilters((previous) => ({ ...previous, [active]: { period: 'Personalizado', customRange: current } }));
    const url = new URL(window.location.href);
    url.searchParams.set(`${active}_periodo`, 'Personalizado');
    if (current.desde) url.searchParams.set(`${active}_desde`, current.desde);
    else url.searchParams.delete(`${active}_desde`);
    if (current.hasta) url.searchParams.set(`${active}_hasta`, current.hasta);
    else url.searchParams.delete(`${active}_hasta`);
    window.history.replaceState({}, '', url);
  };

  const setDateRange = (desde, hasta) => {
    const range = { desde, hasta };
    setPeriodFilters((current) => ({ ...current, [active]: { period: 'Personalizado', customRange: range } }));
    const url = new URL(window.location.href);
    url.searchParams.set(`${active}_periodo`, 'Personalizado');
    url.searchParams.set(`${active}_desde`, desde);
    url.searchParams.set(`${active}_hasta`, hasta);
    window.history.replaceState({}, '', url);
  };

  const updateQuery = useCallback((value) => {
    setQueries((current) => ({ ...current, [active]: value }));
    const url = new URL(window.location.href);
    if (value) url.searchParams.set(`${active}_texto`, value);
    else url.searchParams.delete(`${active}_texto`);
    window.history.replaceState({}, '', url);
  }, [active]);

  const loadData = useCallback(async () => {
    try {
      const [healthResult, ...responses] = await Promise.all([
        request('/salud'),
        ...Object.entries(apiPath).map(([key, path]) => request(`${path}?todos=1`).then((result) => [key, result.items || []])),
        request('/catalogos/categorias').then((result) => ['categorias', result.items || []]),
        request('/catalogos/plataformas').then((result) => ['plataformas', result.items || []])
      ]);
      setHealth(Boolean(healthResult.ok && healthResult.database));
      setConnectionError('');
      const fetched = Object.fromEntries(responses);
      fetched.gastos = (fetched.gastos || []).map(normalizeExpense);
      setData(fetched);
      try { setSettings(await request('/configuracion')); } catch { /* configuracion may not have been loaded yet */ }
    } catch (error) {
      setHealth(false);
      setConnectionError(error instanceof Error ? error.message : 'No se pudo conectar con el backend local.');
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);
  useEffect(() => {
    const periodFilter = periodFilters[active];
    if (!periodFilter) {
      const params = new URLSearchParams(window.location.search);
      const prefix = `${active}_`;
      const period = params.get(`${prefix}periodo`) || 'Este año';
      setPeriodFilters((current) => ({
        ...current,
        [active]: {
          period,
          customRange: {
            desde: params.get(`${prefix}desde`) || '',
            hasta: params.get(`${prefix}hasta`) || ''
          }
        }
      }));
      return;
    }
    const range = periodFilter.period === 'Personalizado' ? periodFilter.customRange : periodRange(periodFilter.period);
    const url = new URL(window.location.href);
    url.searchParams.set(`${active}_periodo`, periodFilter.period);
    if (range.desde) url.searchParams.set(`${active}_desde`, range.desde);
    else url.searchParams.delete(`${active}_desde`);
    if (range.hasta) url.searchParams.set(`${active}_hasta`, range.hasta);
    else url.searchParams.delete(`${active}_hasta`);
    window.history.replaceState({}, '', url);
  }, [active, periodFilters]);
  useEffect(() => {
    const syncRoute = () => {
      const params = new URLSearchParams(window.location.search);
      const page = modules.find(({ id }) => `/${id}` === window.location.pathname)?.id || 'resumen';
      setActive(page);
      setPeriodFilters((current) => ({
        ...current,
        [page]: {
          period: params.get(`${page}_periodo`) || 'Este año',
          customRange: {
            desde: params.get(`${page}_desde`) || '',
            hasta: params.get(`${page}_hasta`) || ''
          }
        }
      }));
      setQueries((current) => ({ ...current, [page]: params.get(`${page}_texto`) || '' }));
      setStatusFilter(params.get(`${page}_estado`) || 'Todos');
    };
    window.addEventListener('popstate', syncRoute);
    return () => window.removeEventListener('popstate', syncRoute);
  }, []);
  useEffect(() => {
    const handleShortcut = (event) => {
      if (event.key.toLowerCase() === 'n' && !['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName) && active === 'ventas' && !modal) {
        setModal({ type: 'sale' });
      }
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, [active, modal]);

  const sales = data.ventas || [];
  const products = data.productos || [];
  const expenses = data.gastos || [];
  const subscriptions = data.suscripciones || [];
  const longExpenses = data['gastos-prolongados'] || [];
  const pendingCount = sales.filter((item) => item.estado === 'en_espera').length;
  const periodParams = new URLSearchParams(window.location.search);
  const defaultRange = periodRange(filterPeriod);
  const fromDate = filterPeriod === 'Personalizado' ? customRange.desde : periodParams.get(`${active}_desde`) || defaultRange.desde || '';
  const throughDate = filterPeriod === 'Personalizado' ? customRange.hasta : periodParams.get(`${active}_hasta`) || defaultRange.hasta || '';
  const isInPeriod = (value) => {
    const date = dayKey(value) || '';
    return (!fromDate || date >= fromDate) && (!throughDate || date <= throughDate);
  };
  const periodSales = sales.filter((sale) => isInPeriod(sale.fecha));
  const periodLongExpenses = longExpenses.flatMap((item) => {
    const originalStart = String(item.fechaInicio).slice(0, 10);
    const originalEnd = String(item.fechaFin).slice(0, 10);
    const visibleStart = !fromDate || originalStart >= fromDate ? originalStart : fromDate;
    const visibleEnd = !throughDate || originalEnd <= throughDate ? originalEnd : throughDate;
    if (visibleStart > visibleEnd) return [];
    const dailyValues = splitExpenseDays(item.monto, originalStart, originalEnd);
    const amount = dailyValues.reduce((sum, dailyAmount, index) => {
      const date = new Date(`${originalStart}T12:00:00Z`);
      date.setUTCDate(date.getUTCDate() + index);
      const day = date.toISOString().slice(0, 10);
      return day >= visibleStart && day <= visibleEnd ? sum + dailyAmount : sum;
    }, 0);
    return amount ? [{
      ...item,
      monto: amount,
      fechaInicio: visibleStart,
      fechaFin: visibleEnd,
      montoTotalOriginal: item.monto,
      fechaInicioOriginal: originalStart,
      fechaFinOriginal: originalEnd
    }] : [];
  });
  const finance = useMemo(() => createFinance({
    sales, products, longExpenses, subscriptions,
    expenses: expenses.filter((item) => item.origen === 'Pago único'),
    charges: expenses.filter((item) => item.origen === 'Suscripción')
  }), [sales, products, expenses, longExpenses, subscriptions]);
  const today = todayInput();
  const ledgerDays = useMemo(() => [...finance.ledger.keys()].sort(), [finance]);
  const periodCosts = useMemo(() => {
    if (!fromDate && !throughDate) return null;
    const start = fromDate || ledgerDays[0];
    const end = throughDate || ledgerDays.at(-1);
    return start && end && start <= end ? costsInRange(finance.ledger, start, end) : { items: [] };
  }, [finance, ledgerDays, fromDate, throughDate]);
  const ledgerPrefix = { 'Pago único': 'gasto', Suscripción: 'cargo', Prolongado: 'prolongado' };
  const assignedById = periodCosts && new Map(periodCosts.items.map((item) => [item.id, item]));
  const periodExpenses = expenses.flatMap((item) => {
    const original = {
      montoTotalOriginal: item.montoTotalOriginal ?? item.monto,
      fechaInicioOriginal: item.origen === 'Prolongado' ? dayKey(item.fechaInicio) : undefined,
      fechaFinOriginal: item.origen === 'Prolongado' ? dayKey(item.fechaFin) : undefined
    };
    if (!assignedById) return [{ ...item, ...original }];
    const assigned = assignedById.get(`${ledgerPrefix[item.origen]}-${item._id}`);
    return assigned?.monto ? [{ ...item, ...original, monto: assigned.monto, coberturaDesde: assigned.desde, coberturaHasta: assigned.hasta }] : [];
  });
  const elapsedEnd = throughDate && throughDate < today ? throughDate : today;
  const elapsedStart = fromDate || ledgerDays[0] || elapsedEnd;
  const elapsedCosts = elapsedStart <= elapsedEnd ? costsInRange(finance.ledger, elapsedStart, elapsedEnd) : { suscripciones: 0, otros: 0 };
  const expenseDailyAverage = elapsedStart <= elapsedEnd ? (elapsedCosts.suscripciones + elapsedCosts.otros) / daysBetween(elapsedStart, elapsedEnd) : 0;
  const reportTo = throughDate || today;
  const summaryReport = useMemo(() => {
    const from = fromDate || [...sales.map((sale) => dayKey(sale.fecha)), ledgerDays[0]].filter(Boolean).sort()[0] || today;
    if (from > reportTo) return null;
    return buildFullReport({
      desde: from, hasta: reportTo, hoy: today, sales, products, longExpenses, subscriptions,
      expenses: expenses.filter((item) => item.origen === 'Pago único'),
      charges: expenses.filter((item) => item.origen === 'Suscripción'),
      diasAlerta: Number(settings.diasAlertaEnEspera || 15)
    });
  }, [fromDate, reportTo, today, sales, products, expenses, longExpenses, subscriptions, ledgerDays, settings.diasAlertaEnEspera]);
  const searchable = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('es');
    if (!normalized) return null;
    return (items, keys) => items.filter((item) => keys.some((key) => String(item[key] || '').toLocaleLowerCase('es').includes(normalized)));
  }, [query]);
  const saveEntity = async (module, item, existingId) => {
    const path = apiPath[module];
    const result = await request(existingId ? `${path}/${existingId}` : path, { method: existingId ? 'PUT' : 'POST', body: JSON.stringify(item) });
    const normalized = module === 'gastos' ? normalizeExpense(result) : result;
    if (module === 'gastos-prolongados' || module === 'suscripciones') {
      const consolidated = await request('/gastos?todos=1');
      setData((current) => ({
        ...current,
        [module]: existingId
          ? current[module].map((row) => row._id === existingId ? normalized : row)
          : [normalized, ...current[module]],
        gastos: (consolidated.items || []).map(normalizeExpense)
      }));
    } else {
      setData((current) => ({
        ...current,
        [module]: existingId
          ? current[module].map((row) => row._id === existingId && (module !== 'gastos' || row.origen === 'Pago único') ? normalized : row)
          : [normalized, ...current[module]]
      }));
    }
    setModal(null);
    notify(existingId ? 'Cambios guardados' : 'Registro creado');
  };

  const removeItem = async (module, item) => {
    await request(`${apiPath[module]}/${item._id}`, { method: 'DELETE' });
    setData((current) => ({
      ...current,
      [module]: current[module].filter((row) => row._id !== item._id),
      ...(module === 'gastos-prolongados'
        ? { gastos: current.gastos.filter((row) => !(row._id === item._id && row.origen === 'Prolongado')) }
        : {})
    }));
    notify('Registro eliminado');
  };

  const removeExpenseItem = async (item) => {
    const routes = {
      'Pago único': `/gastos/${item._id}`,
      Suscripción: `/suscripciones/cobros/${item._id}`,
      Prolongado: `/gastos-prolongados/${item._id}`
    };
    const route = routes[item.origen];
    if (!route) throw new Error('No se reconoce el origen de este gasto.');
    await request(route, { method: 'DELETE' });
    if (item.origen === 'Prolongado') {
      setData((current) => ({
        ...current,
        'gastos-prolongados': current['gastos-prolongados'].filter((row) => row._id !== item._id),
        gastos: current.gastos.filter((row) => !(row._id === item._id && row.origen === 'Prolongado'))
      }));
    } else if (item.origen === 'Suscripción') {
      setData((current) => ({ ...current, gastos: current.gastos.filter((row) => !(row._id === item._id && row.origen === 'Suscripción')) }));
    } else {
      setData((current) => ({ ...current, gastos: current.gastos.filter((row) => !(row._id === item._id && row.origen === 'Pago único')) }));
    }
    notify('Gasto eliminado');
  };

  const changeSaleStatus = async (sale, estado, extra = {}) => {
    const updated = await request(`/ventas/${sale._id}/estado`, { method: 'PATCH', body: JSON.stringify({ estado, ...extra }) });
    setData((current) => ({ ...current, ventas: current.ventas.map((row) => row._id === sale._id ? updated : row) }));
    setSelectedSale(null);
    setModal(null);
    notify('Estado de la venta actualizado');
  };

  const onExport = (module) => window.open(`/api/exportacion/${module}?formato=xlsx`, '_blank', 'noopener');
  const overdueSales = sales.filter((sale) => sale.estado === 'en_espera'
    && Math.floor((Date.now() - new Date(sale.fecha).getTime()) / 86400000) >= Number(settings.diasAlertaEnEspera || 15))
    .sort((a, b) => new Date(a.fecha) - new Date(b.fecha));
  const openOverdueSales = () => {
    navigate('ventas');
    setStatusFilter('en_espera');
    const url = new URL(window.location.href);
    url.searchParams.set('ventas_estado', 'en_espera');
    window.history.replaceState({}, '', url);
    setNotificationsOpen(false);
  };
  useEffect(() => {
    const closeHeaderPopovers = (event) => {
      if (!notificationsRef.current?.contains(event.target)) setNotificationsOpen(false);
    };
    document.addEventListener('pointerdown', closeHeaderPopovers);
    return () => document.removeEventListener('pointerdown', closeHeaderPopovers);
  }, []);
  const categoryOptions = uniqueCatalogOptions(data.categorias || []);
  const platformOptions = uniqueCatalogOptions(data.plataformas || []);

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand-lockup"><img className="brand-logo" src="/logo.svg" alt="" /><div><strong>Safetrics</strong><small>Control de negocio</small></div></div>
        <div className="header-context"><span className="header-label">ESPACIO DE TRABAJO</span><span className="context-name">Operación principal <ChevronDownIcon /></span></div>
        <div className="header-tools">
          <div className="notifications-wrap" ref={notificationsRef}>
            <button className="header-icon" aria-label={`Notificaciones${overdueSales.length ? `, ${overdueSales.length} vencidas` : ''}`} aria-expanded={notificationsOpen} onClick={() => setNotificationsOpen((current) => !current)}><Bell size={17} />{overdueSales.length > 0 && <i />}</button>
            {notificationsOpen && <div className="notifications-popover"><div className="notifications-heading"><strong>Notificaciones</strong><span>{overdueSales.length}</span></div>{overdueSales.length ? <><p>Ventas en espera por encima del plazo de {settings.diasAlertaEnEspera || 15} días.</p><div className="notifications-list">{overdueSales.slice(0, 6).map((sale) => <button type="button" key={sale._id} onClick={openOverdueSales}><strong>{sale.nombre}</strong><span>{sale.productoNombre} · {Math.floor((Date.now() - new Date(sale.fecha).getTime()) / 86400000)} días</span></button>)}</div><button className="notifications-action" type="button" onClick={openOverdueSales}>Revisar ventas pendientes <ArrowRight size={14} /></button></> : <p className="notifications-empty">No hay ventas vencidas. Los avisos aparecerán cuando un pedido supere el plazo configurado.</p>}</div>}
          </div>
          <span className={`server-status ${health ? 'is-online' : 'is-offline'}`}><i />{health ? 'Local · conectado' : 'Sin conexión'}</span>
        </div>
      </header>

      <nav className="top-navigation" aria-label="Navegación principal">
        <div className="nav-scroll">{modules.map(({ id, label, icon: Icon }) => (
          <button key={id} className={`nav-link ${active === id ? 'active' : ''}`} onClick={() => navigate(id)}>
            <Icon size={16} strokeWidth={1.8} /><span>{label}</span>{id === 'ventas' && pendingCount > 0 && <b>{pendingCount}</b>}
          </button>
        ))}</div>
      </nav>

      <main className="main-content">
        <div className="page-topline"><span><span className="crumb-home">Safetrics</span><span className="crumb-divider">/</span>{pageTitles[active]}</span><div className="period-tools"><DropdownSelect className="period-control" value={filterPeriod} options={['Este año', 'Octubre 2026', 'Hoy', 'Ayer', 'Esta semana', 'Este mes', 'Este trimestre', 'Personalizado'].map((option) => [option, option])} onChange={selectPeriod} ariaLabel={`Periodo de análisis de ${pageTitles[active]}`} leadingIcon={CalendarDays} />{filterPeriod === 'Personalizado' && <div className="custom-date-range"><label>Desde <input aria-label="Fecha inicial" type="date" value={customRange.desde} max={customRange.hasta || undefined} onChange={(event) => updateCustomRange('desde', event.target.value)} /></label><span aria-hidden="true">—</span><label>Hasta <input aria-label="Fecha final" type="date" value={customRange.hasta} min={customRange.desde || undefined} onChange={(event) => updateCustomRange('hasta', event.target.value)} /></label></div>}<CompleteReportButton /></div></div>
        {!health && <div className="connection-notice" role="status"><Database size={16} /><span><strong>Backend o MongoDB sin conexión.</strong> Inicia MongoDB y ejecuta <code>npm run dev</code> desde la carpeta del proyecto. {connectionError && <small>{connectionError}</small>}</span></div>}
        <Screen
          key={active}
          active={active} health={health} data={data} sales={periodSales} allSales={sales} products={products} expenses={periodExpenses}
          allExpenses={expenses} subscriptions={subscriptions} longExpenses={periodLongExpenses} allLongExpenses={longExpenses} query={query} setQuery={updateQuery}
          searchable={searchable} modal={modal} setModal={setModal} saveEntity={saveEntity}
          removeItem={removeItem} removeExpenseItem={removeExpenseItem} changeSaleStatus={changeSaleStatus} selectedSale={selectedSale}
          setSelectedSale={setSelectedSale} notify={notify}
          categoryOptions={categoryOptions} platformOptions={platformOptions} settings={settings} formatDate={formatDate}
          setSettings={setSettings} setData={setData} loadData={loadData}
          gastosTab={gastosTab} setGastosTab={setGastosTab}
          catalogTab={catalogTab} setCatalogTab={setCatalogTab}
          statusFilter={statusFilter} setStatusFilter={setStatusFilter}
          updateUrlFilter={updateUrlFilter}
          navigate={navigate}
          filterPeriod={filterPeriod}
          fromDate={fromDate}
          throughDate={throughDate}
          setDateRange={setDateRange}
          onExport={onExport}
          finance={finance}
          summaryReport={summaryReport}
          expenseDailyAverage={expenseDailyAverage}
          today={today}
        />
      </main>
      <footer className="app-footer"><span>© 2026 Safetrics</span><span><ShieldCheck size={13} /> Datos locales · America/Bogota · COP</span><a href="http://127.0.0.1:4000/api/salud" target="_blank" rel="noreferrer">API local <ArrowRight size={12} /></a></footer>
      <FormModal
        modal={modal} setModal={setModal} saveEntity={saveEntity} products={products}
        categoryOptions={categoryOptions} platformOptions={platformOptions}
        notify={notify} selectedSale={selectedSale}
        changeSaleStatus={changeSaleStatus} removeItem={removeItem} setData={setData}
      />
      {toast && <div className={`toast ${toast.tone === 'error' ? 'toast-error' : ''}`} role={toast.tone === 'error' ? 'alert' : 'status'} aria-live={toast.tone === 'error' ? 'assertive' : 'polite'}>{toast.tone === 'error' ? <X size={16} /> : <Check size={16} />}<span>{toast.message}</span></div>}
    </div>
  );
}

function ChevronDownIcon({ className }) {
  return <svg className={className} width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="m3 4.5 3 3 3-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function DropdownSelect({ value, options, onChange, ariaLabel, className = '', leadingIcon: LeadingIcon, required = false }) {
  const [open, setOpen] = useState(false);
  const [openUp, setOpenUp] = useState(false);
  const [menuStyle, setMenuStyle] = useState({});
  const wrapperRef = useRef(null);
  const menuRef = useRef(null);
  const triggerRef = useRef(null);
  const selectedIndex = options.findIndex(([optionValue]) => optionValue === value);
  const updateMenuPosition = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    if (rect.bottom < 0 || rect.top > window.innerHeight) {
      setOpen(false);
      return;
    }
    const margin = 8;
    const maxHeight = Math.min(options.length * 38 + 12, window.innerHeight * .65, 340);
    const below = window.innerHeight - rect.bottom - margin;
    const above = rect.top - margin;
    const shouldOpenUp = below < maxHeight && above > below;
    const available = shouldOpenUp ? above : below;
    const width = Math.min(Math.max(rect.width, className.includes('period-control') ? 178 : 0), window.innerWidth - margin * 2);
    setOpenUp(shouldOpenUp);
    setMenuStyle({
      left: Math.min(Math.max(margin, rect.left), window.innerWidth - width - margin),
      top: shouldOpenUp ? Math.max(margin, rect.top - Math.min(maxHeight, available) - 5) : rect.bottom + 5,
      width,
      maxHeight: Math.max(80, Math.min(maxHeight, available - 5))
    });
  }, [className, options.length]);

  useEffect(() => {
    if (!open) return undefined;
    const closeOutside = (event) => {
      if (!wrapperRef.current?.contains(event.target) && !menuRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    window.addEventListener('resize', updateMenuPosition);
    window.addEventListener('scroll', updateMenuPosition, true);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      window.removeEventListener('resize', updateMenuPosition);
      window.removeEventListener('scroll', updateMenuPosition, true);
    };
  }, [open, updateMenuPosition]);

  const handleKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) {
        updateMenuPosition();
        setOpen(true);
        window.requestAnimationFrame(() => menuRef.current?.querySelectorAll('[role="option"]')[Math.max(selectedIndex, 0)]?.focus());
        return;
      }
      const optionsElements = Array.from(menuRef.current?.querySelectorAll('[role="option"]') || []);
      const currentIndex = optionsElements.indexOf(document.activeElement);
      if (optionsElements.length) {
        const nextIndex = event.key === 'ArrowDown'
          ? (currentIndex + 1 + optionsElements.length) % optionsElements.length
          : (currentIndex - 1 + optionsElements.length) % optionsElements.length;
        optionsElements[nextIndex]?.focus();
      }
    }
  };

  const selectedOption = options.find(([optionValue]) => optionValue === value) || options[0];
  const toggleMenu = () => {
    if (open) {
      setOpen(false);
      return;
    }
    updateMenuPosition();
    setOpen(true);
  };
  const choose = (optionValue) => {
    onChange(optionValue);
    setOpen(false);
    triggerRef.current?.focus();
  };

  return (
    <div
      className={`dropdown-select ${className}`}
      data-open={open}
      data-open-up={openUp}
      ref={wrapperRef}
      onKeyDown={handleKeyDown}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget) && !menuRef.current?.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <button ref={triggerRef} type="button" className="dropdown-select-trigger" aria-label={ariaLabel} aria-haspopup="listbox" aria-expanded={open} aria-required={required || undefined} onClick={toggleMenu}>
        {LeadingIcon && <LeadingIcon size={14} aria-hidden="true" />}
        <span>{selectedOption?.[1] || ''}</span>
        <ChevronDownIcon className="dropdown-chevron" />
      </button>
      {open && createPortal(<div ref={menuRef} className={`dropdown-select-list ${openUp ? 'open-up' : ''}`} style={menuStyle} role="listbox" aria-label={ariaLabel}>{options.map(([optionValue, label]) => <button key={optionValue} type="button" role="option" aria-selected={value === optionValue} className={`dropdown-select-option ${value === optionValue ? 'selected' : ''}`} onClick={() => choose(optionValue)}>{label}</button>)}</div>, document.body)}
    </div>
  );
}

function Screen(props) {
  const screens = {
    resumen: <SummaryScreen {...props} />,
    ventas: <SalesScreen {...props} />,
    productos: <ProductsScreen {...props} />,
    gastos: <ExpensesScreen {...props} />,
    suscripciones: <SubscriptionsScreen {...props} />,
    'gastos-prolongados': <LongExpensesScreen {...props} />,
    comparativas: <ComparisonsScreen {...props} />,
    catalogos: <CatalogScreen {...props} />,
    respaldo: <BackupScreen {...props} />,
    configuracion: <SettingsScreen {...props} />
  };
  return <div className="screen-content">{screens[props.active] || screens.resumen}</div>;
}

function SummaryScreen({ summaryReport: report, subscriptions, navigate }) {
  const activeSubscriptions = subscriptions.filter((item) => item.estado === 'activa');
  const subscriptionsMonthly = activeSubscriptions.reduce((sum, item) => sum + monthlyEquivalent(item.valor, item.frecuencia), 0);
  if (!report) {
    return <div className="page-stack">
      <PageHeading title="Resumen" description="Vista general del rendimiento de tu negocio." />
      <Card><p className="empty-chart-note">El periodo seleccionado todavía no ha empezado.</p></Card>
    </div>;
  }
  const { actual, mes, porLlegar } = report;
  const operatingCosts = actual.gastos.suscripciones + actual.gastos.otros;
  const primaryMetrics = [
    ['Vendido (neto por entregar)', money(actual.ventas.ganancia), 'slate', `${actual.ventas.pedidosNetos} pedidos · ${actual.ventas.unidades} unidades · sin devueltos`, Wallet],
    ['Recibido de la plataforma', money(actual.recibido.monto), 'green', `${actual.recibido.pagos} pagos con fecha en el periodo`, TrendingUp],
    ['Recibido neto', money(actual.recibidoNeto), actual.recibidoNeto < 0 ? 'red' : 'green', `Recibido de la plataforma − devoluciones (${money(actual.gastos.fletes)})`, actual.recibidoNeto < 0 ? TrendingDown : TrendingUp],
    ['Por entregar a cliente', money(porLlegar.monto), 'amber', `${porLlegar.pedidos} pedidos en espera hoy${porLlegar.vencidos ? ` · ${porLlegar.vencidos} con más de ${report.diasAlerta} días` : ''}`, CalendarDays],
    ['Utilidad neta', money(actual.neto), actual.neto < 0 ? 'red' : 'blue', 'Recibido − suscripciones − otros − fletes', actual.neto < 0 ? TrendingDown : TrendingUp]
  ];
  const closed = actual.recibido.pagos + actual.devoluciones.cantidad;
  const secondaryMetrics = [
    ['Venta neta', money(actual.ventas.ventaNeta), 'slate', `Venta bruta ${money(actual.ventas.ventaBruta)} − devueltos ${money(actual.ventas.devoluciones)}`, Wallet],
    ['Costo producto', money(actual.ventas.costoProducto), 'orange', 'Venta neta − neto por entregar', TrendingDown],
    ['Ticket promedio recibido', money(actual.recibido.pagos ? actual.recibido.monto / actual.recibido.pagos : 0), 'green', 'Recibido ÷ pagos', TrendingUp],
    ['Tasa de devolución', percent(closed ? actual.devoluciones.cantidad / closed : 0), 'red', 'Devueltos ÷ (pagados + devueltos)', TrendingDown],
    ['Ganancia esperada', money(actual.esperada), actual.esperada < 0 ? 'red' : 'blue', 'Lo que dejan los pedidos del periodo − gastos', actual.esperada < 0 ? TrendingDown : TrendingUp]
  ];
  const states = [['pagada', 'Pagadas', 'green'], ['en_espera', 'En espera', 'amber'], ['devuelta', 'Devueltas', 'red'], ['cancelada', 'Canceladas', 'slate']];
  const createdOrders = states.reduce((sum, [state]) => sum + actual.estados[state].pedidos, 0);
  const changeLabel = (row) => {
    if (!row.diferencia) return ['Sin cambio', 'muted'];
    const up = row.diferencia > 0;
    const amount = row.tipo === 'money' ? money(Math.abs(row.diferencia)) : Math.abs(row.diferencia);
    return [`${up ? 'Subió' : 'Bajó'} ${amount}${row.porcentaje == null ? '' : ` (${percent(Math.abs(row.porcentaje))})`}`, up === row.mejorSiSube ? 'amount-green' : 'amount-red'];
  };
  return <div className="page-stack">
    <PageHeading title="Resumen" description={`${report.titulo} · ${report.periodoTexto}`} action={<div className="heading-actions"><ExportButton module="resumen" filters={{ desde: report.desde, hasta: report.hasta }} /></div>} />
    <section className="kpi-grid kpi-grid-five summary-primary-grid" aria-label="Indicadores principales">{primaryMetrics.map(([label, value, tone, detail, icon]) => <Kpi key={label} label={label} value={value} tone={tone} detail={detail} icon={icon} />)}</section>
    <div className="dashboard-grid">
      <Card className="dashboard-card">
        <div className="section-heading"><div><h2>Resultado del periodo</h2><p>Lo recibido de la plataforma menos los costos de operación</p></div><span className="reconcile-icon"><Check size={17} /></span></div>
        <div className="commitment-row"><span>(+) Recibido de la plataforma</span><strong className="money amount-green">{money(actual.recibido.monto)}</strong></div>
        <div className="commitment-row"><span>(−) Suscripciones repartidas por día</span><strong className="money amount-red">{money(actual.gastos.suscripciones)}</strong></div>
        <div className="commitment-row"><span>(−) Publicidad y otros gastos</span><strong className="money amount-red">{money(actual.gastos.otros)}</strong></div>
        <div className="commitment-row"><span>(−) Fletes de devoluciones</span><strong className="money amount-red">{money(actual.gastos.fletes)}</strong></div>
        <div className="commitment-row"><span><strong>(=) Utilidad neta</strong></span><strong className={`money ${actual.neto < 0 ? 'amount-red' : 'amount-blue'}`}>{money(actual.neto)}</strong></div>
      </Card>
      <Card className="dashboard-card subscription-summary">
        <div className="section-heading"><div><h2>Acumulado del mes</h2><p>{mes.etiqueta} · {mes.rango}</p></div><div className="subscription-icon"><CalendarDays size={17} /></div></div>
        <div className={`commitment-value money ${mes.neto < 0 ? 'amount-red' : 'amount-blue'}`}>{money(mes.neto)}<small> utilidad neta</small></div>
        <div className="commitment-row"><span>Venta neta</span><strong className="money">{money(mes.ventas.ventaNeta)}</strong></div>
        <div className="commitment-row"><span>Costo producto</span><strong className="money">{money(mes.ventas.costoProducto)}</strong></div>
        <div className="commitment-row"><span>Gasto en suscripciones</span><strong className="money">{money(mes.gastos.suscripciones)}</strong></div>
        <div className="commitment-row"><span>Publicidad y otros gastos</span><strong className="money">{money(mes.gastos.otros)}</strong></div>
        <div className="commitment-row"><span>Fletes de devoluciones</span><strong className="money">{money(mes.gastos.fletes)}</strong></div>
        <div className="commitment-row"><span>Gastos totales</span><strong className="money amount-red">{money(mes.gastos.total)}</strong></div>
        <div className="commitment-row"><span>Costo total</span><strong className="money amount-red">{money(mes.costoTotal)}</strong></div>
        <div className="commitment-row"><span><strong>Ganancia esperada</strong></span><strong className={`money ${mes.esperada < 0 ? 'amount-red' : 'amount-blue'}`}>{money(mes.esperada)}</strong></div>
        <div className="commitment-row"><span>Recibido de la plataforma</span><strong className="money amount-green">{money(mes.recibido.monto)}</strong></div>
      </Card>
      <Card className="dashboard-card">
        <div className="section-heading"><div><h2>Ventas por producto</h2><p>Pedidos creados en el periodo, sin cancelados</p></div><button className="text-link" onClick={() => navigate('productos')}>Ver productos <ArrowRight size={13} /></button></div>
        {report.productos.map((group) => <div key={group.producto}>
          <div className="commitment-row"><span><strong>{group.producto}</strong></span><strong>{group.pedidos} pedidos · {group.unidades} und.</strong></div>
          {group.variantes.map((variant) => <div className="commitment-row" key={variant.producto}><span>· {variant.producto} ({variant.unidadesPorPedido} und. · {money(variant.precio)})</span><span>{variant.pedidos} · <b className="money">{money(variant.ventaBruta)}</b></span></div>)}
        </div>)}
        {!report.productos.length && <p className="empty-chart-note">No se crearon pedidos en este periodo.</p>}
      </Card>
      <Card className="dashboard-card">
        <div className="section-heading"><div><h2>Pedidos del periodo</h2><p>Estado actual de los pedidos creados</p></div><span className="inline-total">{createdOrders} pedidos</span></div>
        <div className="segmented-bar" role="img" aria-label={`Pedidos por estado: ${states.map(([state, label]) => `${actual.estados[state].pedidos} ${label.toLowerCase()}`).join(', ')}`}>{states.map(([state, label], index) => <i key={state} className={`segment segment-${index}`} style={{ width: `${createdOrders ? actual.estados[state].pedidos / createdOrders * 100 : 0}%` }} title={`${label}: ${actual.estados[state].pedidos} pedidos`} />)}</div>
        <div className="legend-grid">{states.map(([state, label, tone]) => <div key={state} className="legend-item"><i className={`dot dot-${tone}`} />{label}<strong>{actual.estados[state].pedidos}</strong></div>)}</div>
        <div className="commitment-row"><span>Devoluciones marcadas en el periodo</span><strong>{actual.devoluciones.cantidad} · <span className="money amount-red">{money(actual.devoluciones.fletes)}</span></strong></div>
      </Card>
      <Card className="dashboard-card">
        <div className="section-heading"><div><h2>Comparado con el periodo anterior</h2><p>{report.anterior.etiqueta}</p></div></div>
        {report.comparacion.map((row) => {
          const [label, tone] = changeLabel(row);
          return <div className="commitment-row" key={row.indicador}><span>{row.indicador}</span><strong className={tone}>{label}</strong></div>;
        })}
      </Card>
      <Card className="dashboard-card">
        <div className="section-heading"><div><h2>Gastos por categoría</h2><p>Asignados a los días del periodo</p></div><button className="text-link" onClick={() => navigate('gastos')}>Ver gastos <ArrowRight size={13} /></button></div>
        {report.gastosPorCategoria.slice(0, 5).map(({ categoria, monto }, index) => <ProgressRow key={categoria} label={categoria} amount={monto} total={operatingCosts} tone={index % 2 ? 'blue' : 'orange'} />)}
        {!report.gastosPorCategoria.length && <p className="empty-chart-note">No hay gastos en este periodo.</p>}
      </Card>
      <Card className="dashboard-card subscription-summary">
        <div className="section-heading"><div><h2>Compromisos activos</h2><p>Costo recurrente equivalente</p></div><div className="subscription-icon"><RefreshIcon /></div></div>
        <div className="commitment-value money">{money(subscriptionsMonthly)}<small> / mes</small></div>
        <div className="commitment-row"><span>Promedio diario</span><strong className="money">{money(subscriptionsMonthly * 12 / 365)}</strong></div>
        <div className="commitment-row"><span>Proyección anual</span><strong className="money">{money(subscriptionsMonthly * 12)}</strong></div>
        <div className="commitment-row"><span>Suscripciones activas</span><strong>{activeSubscriptions.length}</strong></div>
        <button className="text-link" onClick={() => navigate('suscripciones')}>Revisar suscripciones <ArrowRight size={13} /></button>
      </Card>
    </div>
    <section className="kpi-grid summary-secondary-grid" aria-label="Otros indicadores">{secondaryMetrics.map(([label, value, tone, detail, icon]) => <Kpi key={label} className="kpi-secondary" label={label} value={value} tone={tone} detail={detail} icon={icon} />)}</section>
    <div className="bottom-note"><ShieldCheck size={15} /><span>Lo vendido cuenta en la fecha del pedido; lo recibido, en la fecha de pago; cada devolución, el día en que se marcó. Las suscripciones y los gastos prolongados se reparten por día. Son las mismas cifras del reporte PDF y Excel.</span></div>
  </div>;
}

function SalesScreen({ sales, products, query, setQuery, searchable, setModal, setSelectedSale, statusFilter, setStatusFilter, updateUrlFilter, formatDate, finance, settings, today }) {
  const [productFilter, setProductFilter] = useState(() => new URLSearchParams(window.location.search).get('ventas_producto') || '');
  const filtered = (searchable ? searchable(sales, ['nombre', 'productoNombre', '_id']) : sales).filter((sale) => (statusFilter === 'Todos' || sale.estado === statusFilter) && (!productFilter || sale.productoId === productFilter));
  const { pageRows: salePage, pager: salePager } = usePagination(filtered, [query, statusFilter, productFilter, sales.length].join('|'));
  const sumBy = (predicate, get) => filtered.filter(predicate).reduce((sum, item) => sum + Number(get(item) || 0), 0);
  const isLiveSale = (item) => item.estado === 'pagada' || item.estado === 'en_espera';
  const liveSales = sales.filter(isLiveSale);
  const saleNetRevenue = liveSales.reduce((sum, item) => sum + finance.grossOf(item), 0);
  const saleNetCost = saleNetRevenue - liveSales.reduce((sum, item) => sum + Number(item.valorEsperado || 0), 0);
  const alertDays = Number(settings.diasAlertaEnEspera || 15);
  const waitingDays = (sale) => Math.max(0, daysBetween(dayKey(sale.fecha), today) - 1);
  const columns = [
    { key: 'code', label: 'Código', render: (sale) => <span className="mono-id">{shortId(sale)}</span> },
    { key: 'fecha', label: 'Fecha', render: (sale) => formatDate(sale.fecha) },
    { key: 'nombre', label: 'Cliente / referencia', render: (sale) => <strong className="cell-main">{sale.nombre}</strong> },
    { key: 'productoNombre', label: 'Producto' },
    { key: 'cantidad', label: 'Pedidos', align: 'right' },
    { key: 'unidadesPorVenta', label: 'Unidades', align: 'right', render: (sale) => finance.unitsOf(sale) },
    { key: 'precioUnitario', label: 'Venta bruta', align: 'right', render: (sale) => <span className="money">{money(finance.grossOf(sale))}</span> },
    { key: 'valorEsperado', label: 'Utilidad estimada', align: 'right', render: (sale) => <span className="money">{money(sale.valorEsperado)}</span> },
    { key: 'estado', label: 'Estado', render: (sale) => <button className="status-trigger" onClick={(event) => { event.stopPropagation(); setSelectedSale(sale); setModal({ type: 'status', sale }); }}><Status value={sale.estado} /><ChevronDownIcon /></button> },
    { key: 'valorReal', label: 'Utilidad recibida', align: 'right', render: (sale) => <span className="money">{sale.valorReal != null ? money(sale.valorReal) : '—'}</span> },
    { key: 'fechaPago', label: 'Fecha pago', render: (sale) => formatDate(sale.fechaPago) },
    { key: 'costoFlete', label: 'Flete', align: 'right', render: (sale) => <span className={sale.costoFlete ? 'amount-red money' : 'money'}>{sale.costoFlete ? money(sale.costoFlete) : '—'}{sale.estado === 'devuelta' && <small className="cell-subtitle">Devuelta el {formatDate(sale.fechaDevolucion || finance.returnDay(sale))}</small>}</span> },
    { key: 'cuenta', label: 'Valor que cuenta', align: 'right', render: (sale) => <strong className={`money ${sale.estado === 'devuelta' ? 'amount-red' : sale.estado === 'pagada' ? 'amount-green' : sale.estado === 'en_espera' ? 'amount-amber' : 'muted'}`}>{money(counted(sale))}</strong> },
    { key: 'dias', label: 'Días en espera', align: 'right', render: (sale) => sale.estado === 'en_espera' ? <span className={waitingDays(sale) > alertDays ? 'overdue' : 'muted'}>{waitingDays(sale)} días</span> : '—' },
    { key: 'actions', label: '', render: (sale) => <button className="more-button" aria-label={`Editar venta de ${sale.nombre}`} onClick={(event) => { event.stopPropagation(); setModal({ type: 'sale-edit', item: sale }); }}>•••</button> }
  ];
  return <div className="page-stack">
    <PageHeading title="Ventas" description="Registra pedidos de la plataforma; la utilidad estimada es el monto neto después de producto y envío." action={<><Button onClick={() => setModal({ type: 'sale', item: null })}><Plus size={15} /> Nueva venta</Button><ExportButton module="ventas" filters={{ estado: statusFilter, producto: productFilter, texto: query }} /></>} />
    <div className="kpi-grid kpi-grid-five">
      <Kpi label="Pedidos generados" value={sales.length} tone="slate" detail={`${sales.reduce((sum, item) => sum + finance.unitsOf(item), 0)} unidades · venta bruta ${money(sales.reduce((sum, item) => sum + finance.grossOf(item), 0))}`} icon={Wallet} />
      <Kpi label="Costo producto" value={money(saleNetCost)} tone="orange" detail={`Venta neta ${money(saleNetRevenue)} − neto por entregar`} icon={TrendingDown} />
      <Kpi label="Utilidad estimada" value={money(sales.filter((item) => item.estado !== 'cancelada').reduce((sum, item) => sum + item.valorEsperado, 0))} tone="blue" detail="Neto por entregar de los pedidos, sin cancelados" icon={TrendingUp} />
      <Kpi label="Por cobrar" value={money(sales.filter((item) => item.estado === 'en_espera').reduce((sum, item) => sum + item.valorEsperado, 0))} tone="amber" detail="Pedidos del periodo en espera" icon={CalendarDays} />
      <Kpi label="Utilidad confirmada" value={money(sales.filter((item) => item.estado === 'pagada').reduce((sum, item) => sum + finance.receivedOf(item), 0))} tone="green" detail="Pedidos del periodo ya pagados" icon={Wallet} />
    </div>
    <Card className="table-card">
      <Toolbar search={query} onSearch={setQuery}>
        <DropdownSelect className="filter-select" value={statusFilter} options={ [['Todos', 'Todos'], ['pagada', 'Pagada'], ['en_espera', 'En espera'], ['devuelta', 'Devuelta'], ['cancelada', 'Cancelada']] } onChange={(value) => { setStatusFilter(value); updateUrlFilter('estado', value); }} ariaLabel="Filtrar ventas por estado" leadingIcon={Filter} />
        <DropdownSelect className="compact-select" value={productFilter} options={[['', 'Todos los productos'], ...products.map((product) => [product._id, product.nombre])]} onChange={(value) => { setProductFilter(value); updateUrlFilter('producto', value); }} ariaLabel="Filtrar ventas por producto" />
        <span className="table-count">{filtered.length} pedidos</span>
      </Toolbar>
      <Table columns={columns} rows={salePage} empty="Aún no hay ventas para estos filtros. Registra tu primera venta." />
      <Pagination {...salePager} label="pedidos" />
      <div className="sticky-summary"><strong>Totales del filtro</strong><span>Costo producto <b className="money amount-red">{money(sumBy(isLiveSale, finance.grossOf) - sumBy(isLiveSale, (item) => item.valorEsperado))}</b></span><span>Esperado <b className="money">{money(sumBy(() => true, (item) => item.valorEsperado))}</b></span><span>Por cobrar <b className="money amount-amber">{money(sumBy((item) => item.estado === 'en_espera', (item) => item.valorEsperado))}</b></span><span>Real <b className="money amount-green">{money(sumBy((item) => item.estado === 'pagada', finance.receivedOf))}</b></span><span>Fletes <b className="money amount-red">{money(sumBy((item) => item.estado === 'devuelta', (item) => item.costoFlete || 0))}</b></span></div>
    </Card>
    <div className="pending-strip"><div><span className="pending-dot" /><strong>En espera</strong><span>Prioriza el seguimiento de tus pedidos pendientes</span></div><div className="pending-chips">{sales.filter((item) => item.estado === 'en_espera').sort((a, b) => new Date(a.fecha) - new Date(b.fecha)).slice(0, 4).map((sale) => <span key={sale._id}>{sale.nombre} <b>{waitingDays(sale)} d</b></span>)}</div></div>
  </div>;
}

function ProductsScreen({ products, sales, query, setQuery, searchable, setModal, removeItem, notify, updateUrlFilter, finance }) {
  const [filter, setFilter] = useState(() => new URLSearchParams(window.location.search).get('productos_estado') || 'Todos');
  const rows = (searchable ? searchable(products, ['nombre']) : products).filter((product) => filter === 'Todos' || product.estado === filter).map((product) => {
    const productSales = sales.filter((sale) => sale.productoId === product._id && sale.estado !== 'cancelada');
    const familySales = product.productoBaseId ? [] : sales.filter((sale) => sale.estado !== 'cancelada' && finance.productOf(sale)?.productoBaseId === product._id);
    return {
      ...product,
      ventas: productSales.length,
      unidadesVendidas: productSales.reduce((sum, sale) => sum + finance.unitsOf(sale), 0),
      unidadesFamilia: familySales.length ? [...productSales, ...familySales].reduce((sum, sale) => sum + finance.unitsOf(sale), 0) : null
    };
  });
  const { pageRows: productPage, pager: productPager } = usePagination(rows, [query, filter, products.length].join('|'));
  const columns = [
    { key: 'nombre', label: 'Producto / paquete', render: (row) => <strong className="cell-main">{row.nombre}{row.productoBaseId ? <small className="cell-subtitle">Paquete de {products.find((item) => item._id === row.productoBaseId)?.nombre || 'producto base'} · {row.unidadesPorVenta || 1} unidades</small> : row.unidadesFamilia != null && <small className="cell-subtitle">Total con paquetes: {row.unidadesFamilia} unidades</small>}</strong> },
    { key: 'precio', label: 'Precio por pedido', align: 'right', render: (row) => <strong className="money">{money(row.precio)}</strong> },
    { key: 'unidadesPorVenta', label: 'Unidades / pedido', align: 'right', render: (row) => row.unidadesPorVenta || 1 },
    { key: 'ventas', label: 'Pedidos', align: 'right' },
    { key: 'unidadesVendidas', label: 'Unidades vendidas', align: 'right' },
    { key: 'estado', label: 'Estado', render: (row) => <Status value={row.estado} /> },
    { key: 'actions', label: 'Acciones', render: (row) => <div className="row-actions"><button onClick={() => setModal({ type: 'product', item: row })}>Editar</button><button onClick={async () => {
      if (row.ventas) return setModal({ type: 'product-toggle', item: row });
      try { await removeItem('productos', row); } catch (error) { notify(error.message, 'error'); }
    }}>{row.ventas ? (row.estado === 'activo' ? 'Desactivar' : 'Activar') : 'Eliminar'}</button></div> }
  ];
  return <div className="page-stack">
    <PageHeading title="Productos" description="Organiza productos base y paquetes promocionales; el precio es el cobrado al cliente, separado de la utilidad neta de la plataforma." action={<><Button onClick={() => setModal({ type: 'product' })}><Plus size={15} /> Nuevo producto</Button><ExportButton module="productos" filters={{ estado: filter, texto: query }} /></>} />
    <div className="catalog-layout"><Card className="table-card">
      <Toolbar search={query} onSearch={setQuery}><DropdownSelect className="compact-select" value={filter} options={ [['Todos', 'Todos'], ['activo', 'Activos'], ['desactivado', 'Desactivados']] } onChange={(value) => { setFilter(value); updateUrlFilter('estado', value); }} ariaLabel="Filtrar productos por estado" /><span className="table-count">{rows.length} productos</span></Toolbar>
      <Table columns={columns} rows={productPage} empty="Todavía no tienes productos. Agrega el primero para registrar ventas." />
      <Pagination {...productPager} label="productos" />
    </Card><div className="side-stack"><Card><div className="section-heading"><div><h2>Resumen de catálogo</h2><p>Estado de tus productos</p></div><PackageIcon /></div><div className="side-stat"><span>Productos activos</span><strong>{products.filter((item) => item.estado === 'activo').length}</strong></div><div className="side-stat"><span>Desactivados</span><strong>{products.filter((item) => item.estado !== 'activo').length}</strong></div><div className="info-note">Los productos desactivados ya no se pueden seleccionar en ventas nuevas. Su historial permanece intacto.</div></Card><Card className="blue-note"><h3>Precios fáciles de actualizar</h3><p>Las ventas registradas conservan una copia del nombre y el precio del producto.</p></Card></div></div>
  </div>;
}

function ExpensesScreen({ expenses, query, setQuery, searchable, setModal, removeExpenseItem, notify, gastosTab, setGastosTab, categoryOptions, platformOptions, updateUrlFilter, formatDate, expenseDailyAverage }) {
  const tabs = ['Todos', 'Pagos únicos', 'Suscripciones', 'Prolongados'];
  const [categoryFilter, setCategoryFilter] = useState(() => new URLSearchParams(window.location.search).get('gastos_categoria') || '');
  const [platformFilter, setPlatformFilter] = useState(() => new URLSearchParams(window.location.search).get('gastos_plataforma') || '');
  const tabOrigins = { 'Pagos únicos': 'Pago único', Suscripciones: 'Suscripción', Prolongados: 'Prolongado' };
  const filtered = (searchable ? searchable(expenses, ['detalle', 'categoriaNombre', 'plataformaNombre']) : expenses).filter((item) =>
    (gastosTab === 'Todos' || item.origen === tabOrigins[gastosTab]) &&
    (!categoryFilter || item.categoriaId === categoryFilter) &&
    (!platformFilter || item.plataformaId === platformFilter)
  );
  const total = filtered.reduce((sum, item) => sum + item.monto, 0);
  const columns = [
    { key: 'fecha', label: 'Fecha / periodo', render: (row) => row.origen === 'Prolongado'
      ? `${formatDate(row.fechaInicioOriginal || row.fechaInicio)} — ${formatDate(row.fechaFinOriginal || row.fechaFin)}`
      : formatDate(row.fecha) },
    { key: 'detalle', label: 'Detalle', render: (row) => <strong className="cell-main">{row.detalle}</strong> },
    { key: 'categoriaNombre', label: 'Categoría' },
    { key: 'plataformaNombre', label: 'Plataforma' },
    { key: 'origen', label: 'Origen', render: (row) => <span className="origin-tag">{row.origen || 'Pago único'}</span> },
    { key: 'monto', label: 'Asignado al periodo', align: 'right', render: (row) => <div><strong className="money">{money(row.monto)}</strong>{row.origen === 'Prolongado' && <small className="cell-secondary">Total original: {money(row.montoTotalOriginal ?? row.monto)}</small>}{row.origen === 'Suscripción' && <small className="cell-secondary">Cobro de {money(row.montoTotalOriginal ?? row.monto)}{row.coberturaHasta ? ` · cubre hasta ${formatDate(row.coberturaHasta)}` : ''}</small>}</div> },
    { key: 'actions', label: 'Acciones', render: (row) => <div className="row-actions"><button onClick={() => setModal({
      type: row.origen === 'Prolongado' ? 'long-edit' : row.origen === 'Suscripción' ? 'charge-edit' : 'expense-edit',
      item: row.origen === 'Prolongado'
        ? { ...row, monto: row.montoTotalOriginal ?? row.monto, fechaInicio: row.fechaInicioOriginal || row.fechaInicio, fechaFin: row.fechaFinOriginal || row.fechaFin }
        : { ...row, monto: row.montoTotalOriginal ?? row.monto }
    })}>Editar</button><button onClick={async () => {
      if (!window.confirm(`¿Seguro que quieres eliminar "${row.detalle}"? Esta acción no se puede deshacer.`)) return;
      try { await removeExpenseItem(row); } catch (error) { notify(error.message, 'error'); }
    }}>Eliminar</button></div> }
  ];
  return <div className="page-stack">
    <PageHeading title="Gastos" description="Consulta tus egresos y revisa en qué se distribuyen." action={<><Button onClick={() => setModal({ type: 'expense' })}><Plus size={15} /> Nuevo gasto</Button><ExportButton module="gastos" filters={{ texto: query, categoria: categoryFilter, plataforma: platformFilter, origen: gastosTab === 'Todos' ? '' : { 'Pagos únicos': 'unico', Suscripciones: 'suscripcion', Prolongados: 'prolongado' }[gastosTab] }} /></>} />
    <section className="kpi-grid kpi-grid-three"><Kpi label="Gastos del periodo" value={money(total)} tone="orange" detail={`${filtered.length} registros`} icon={ReceiptIcon} /><Kpi label="Pago único" value={money(filtered.filter((item) => item.origen === 'Pago único').reduce((sum, item) => sum + item.monto, 0))} tone="blue" detail="Gastos registrados manualmente" icon={Wallet} /><Kpi label="Gasto diario promedio" value={money(expenseDailyAverage)} tone="slate" detail="Todos los gastos ÷ días transcurridos del periodo" icon={CalendarDays} /></section>
    <Card className="table-card">
      <div className="tab-strip">{tabs.map((tab) => <button key={tab} className={gastosTab === tab ? 'selected' : ''} onClick={() => setGastosTab(tab)}>{tab}<small>{tab === 'Todos' ? expenses.length : expenses.filter((item) => item.origen === tabOrigins[tab]).length}</small></button>)}</div>
      <Toolbar search={query} onSearch={setQuery}>
        <DropdownSelect className="compact-select" value={categoryFilter} options={[['', 'Todas las categorías'], ...categoryOptions.filter((item) => item.estado === 'activo').map((item) => [item._id, item.nombre])]} onChange={(value) => { setCategoryFilter(value); updateUrlFilter('categoria', value); }} ariaLabel="Filtrar gastos por categoría" />
        <DropdownSelect className="compact-select" value={platformFilter} options={[['', 'Todas las plataformas'], ...platformOptions.filter((item) => item.estado === 'activo').map((item) => [item._id, item.nombre])]} onChange={(value) => { setPlatformFilter(value); updateUrlFilter('plataforma', value); }} ariaLabel="Filtrar gastos por plataforma" />
        <span className="table-count">{filtered.length} filas</span>
      </Toolbar>
      <Table columns={columns} rows={filtered} empty="No hay gastos en este periodo." />
      <div className="sticky-summary"><strong>Total del filtro</strong><span>{filtered.length} registros</span><b className="money amount-orange">{money(total)}</b></div>
    </Card>
    <div className="two-column"><Card><div className="section-heading"><div><h2>Gasto por origen</h2><p>Distribución según tipo de registro</p></div></div>{['Pago único', 'Suscripción', 'Prolongado'].map((origin) => <ProgressRow key={origin} label={origin} amount={expenses.filter((item) => item.origen === origin).reduce((sum, item) => sum + item.monto, 0)} total={expenses.reduce((sum, item) => sum + item.monto, 0)} tone="orange" />)}</Card><Card><div className="section-heading"><div><h2>Control del gasto</h2><p>Resumen de movimientos visibles</p></div><ShieldCheck size={18} /></div><p className="body-copy">Los gastos prolongados se distribuyen por día para mantener los totales correctos al cambiar de semana o mes.</p><Button onClick={() => setModal({ type: 'long' })}><CalendarDays size={15} /> Registrar gasto prolongado</Button></Card></div>
  </div>;
}

function SubscriptionsScreen({ subscriptions, setModal, notify, loadData, formatDate, today }) {
  const active = subscriptions.filter((item) => item.estado === 'activa');
  const monthly = active.reduce((sum, item) => sum + monthlyEquivalent(item.valor, item.frecuencia), 0);
  const yearly = monthly * 12;
  const nextCharge = (item) => (item.estado === 'activa' ? nextBillingKey(item, today) : null);
  const weekLimit = shiftDays(today, 7);
  const upcoming = active.filter((item) => { const next = nextCharge(item); return next && next <= weekLimit; });
  const [generatingCharges, setGeneratingCharges] = useState(false);
  const showUpcoming = () => document.getElementById('subscriptions-table')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  return <div className="page-stack">
    <PageHeading title="Suscripciones" description="Controla los pagos recurrentes y su impacto en el presupuesto." action={<><Button onClick={() => setModal({ type: 'subscription' })}><Plus size={15} /> Nueva suscripción</Button><ExportButton module="suscripciones" /></>} />
    <div className="kpi-grid kpi-grid-three"><Kpi label="Compromiso mensual" value={money(monthly)} tone="orange" detail="Equivalente mensual de las activas" icon={RefreshIcon} /><Kpi label="Compromiso anual" value={money(yearly)} tone="blue" detail="Proyección de los próximos 12 meses" icon={CalendarDays} /><Kpi label="Próximos 7 días" value={money(upcoming.reduce((sum, item) => sum + Number(item.valor || 0), 0))} tone="amber" detail={upcoming.length ? upcoming.map((item) => `${item.nombre} (${formatDate(nextCharge(item))})`).join(' · ') : 'Ningún cobro en los próximos 7 días'} icon={Bell} /></div>
    <div className="notice notice-blue"><CalendarDays size={17} /><div><strong>Próximos cobros</strong><span>Revisa los cargos programados para los siguientes 7 días y mantén tus costos al día.</span></div><button className="text-link" onClick={showUpcoming}>Ver suscripciones <ArrowRight size={13} /></button></div>
    <Card className="table-card" id="subscriptions-table"><div className="section-heading card-section-heading"><div><h2>Suscripciones registradas</h2><p>Valores por cobro y fechas previstas</p></div><Button disabled={generatingCharges} onClick={async () => {
      setGeneratingCharges(true);
      try {
        const preview = await request('/suscripciones/generar-faltantes?vistaPrevia=true', { method: 'POST' });
        const description = preview.suscripciones.filter((item) => item.cantidad).map((item) => `${item.nombre}: ${item.cantidad}`).join('\n');
        if (!preview.cantidad) return notify('No hay cobros faltantes para generar');
        if (!window.confirm(`Se crearán ${preview.cantidad} cobros:\n${description}\n\nEste proceso puede volver a crear cobros que borraste dentro del periodo activo. ¿Deseas continuar?`)) return;
        const result = await request('/suscripciones/generar-faltantes', { method: 'POST' });
        await loadData();
        notify(`Se generaron ${result.cantidad} cobros`);
      } catch (error) { notify(error.message, 'error'); }
      finally { setGeneratingCharges(false); }
    }}>{generatingCharges ? 'Actualizando…' : 'Generar cobros faltantes'}</Button></div>
      <Table columns={[
        { key: 'nombre', label: 'Suscripción', render: (row) => <strong className="cell-main">{row.nombre}</strong> },
        { key: 'plataformaNombre', label: 'Plataforma' }, { key: 'categoriaNombre', label: 'Categoría' },
        { key: 'valor', label: 'Valor', align: 'right', render: (row) => <strong className="money">{money(row.valor)}</strong> },
        { key: 'frecuencia', label: 'Frecuencia', render: (row) => capitalize(row.frecuencia) },
        { key: 'fechaInicio', label: 'Próximo cobro', render: (row) => (row.estado === 'activa' ? formatDate(nextCharge(row)) : 'Pausada') },
        { key: 'estado', label: 'Estado', render: (row) => <Status value={row.estado} /> },
        { key: 'actions', label: '', render: (row) => <button className="row-link" onClick={() => setModal({ type: 'subscription-edit', item: row })}>Ver detalle</button> }
      ]} rows={subscriptions} empty="Aún no hay suscripciones registradas." />
    </Card>
    <div className="two-column"><Card><div className="section-heading"><div><h2>Recurrentes mensuales</h2><p>Equivalencia de costos activos</p></div><RefreshIcon /></div><div className="commitment-value money">{money(monthly)}<small> / mes</small></div><div className="commitment-row"><span>Estimado anual</span><strong className="money">{money(yearly)}</strong></div></Card><Card className="soft-note"><h3>Los cobros conservan su historial</h3><p>Al pausar una suscripción, no se generan nuevos cobros. Al reactivarla, se retoma desde la fecha de reactivación.</p></Card></div>
  </div>;
}

function LongExpensesScreen({ longExpenses, query, setQuery, searchable, setModal, removeItem, notify, onExport, filterPeriod, fromDate, throughDate, setDateRange, formatDate }) {
  const rows = searchable ? searchable(longExpenses, ['detalle', 'categoriaNombre', 'plataformaNombre']) : longExpenses;
  const total = rows.reduce((sum, item) => sum + item.monto, 0);
  const originalStart = (item) => item.fechaInicioOriginal || item.fechaInicio;
  const originalEnd = (item) => item.fechaFinOriginal || item.fechaFin;
  const today = todayInput();
  const rangeEnd = throughDate && throughDate < today ? throughDate : today;
  const relevantEnd = rows.reduce((latest, item) => {
    const itemEnd = String(item.fechaFinOriginal || item.fechaFin).slice(0, 10);
    const itemStart = String(item.fechaInicioOriginal || item.fechaInicio).slice(0, 10);
    if (itemStart > rangeEnd || (fromDate && itemEnd < fromDate)) return latest;
    const visibleEnd = itemEnd > rangeEnd ? rangeEnd : itemEnd;
    return visibleEnd > latest ? visibleEnd : latest;
  }, '');
  const chartEnd = relevantEnd || rangeEnd || today;
  const relevantStart = rows.reduce((earliest, item) => {
    const itemStart = String(item.fechaInicioOriginal || item.fechaInicio).slice(0, 10);
    const itemEnd = String(item.fechaFinOriginal || item.fechaFin).slice(0, 10);
    if (itemStart > rangeEnd || (fromDate && itemEnd < fromDate)) return earliest;
    const visibleStart = fromDate && itemStart < fromDate ? fromDate : itemStart;
    return !earliest || visibleStart < earliest ? visibleStart : earliest;
  }, '');
  const availableStart = relevantStart || fromDate || chartEnd;
  const endDate = new Date(`${chartEnd}T12:00:00Z`);
  const startDate = new Date(`${availableStart}T12:00:00Z`);
  if ((endDate - startDate) / 86400000 > 30) {
    startDate.setTime(endDate.getTime());
    startDate.setUTCDate(startDate.getUTCDate() - 30);
  }
  const calendarDays = Array.from({ length: Math.max(1, Math.floor((endDate - startDate) / 86400000) + 1) }, (_, index) => {
    const date = new Date(startDate);
    date.setUTCDate(date.getUTCDate() + index);
    const key = date.toISOString().slice(0, 10);
    const amount = rows.reduce((sum, item) => {
      const sourceStart = String(item.fechaInicioOriginal || item.fechaInicio).slice(0, 10);
      const sourceEnd = String(item.fechaFinOriginal || item.fechaFin).slice(0, 10);
      const sourceAmount = item.montoTotalOriginal ?? item.monto;
      const distribution = splitExpenseDays(sourceAmount, sourceStart, sourceEnd);
      const dayIndex = Math.round((new Date(`${key}T12:00:00Z`) - new Date(`${sourceStart}T12:00:00Z`)) / 86400000);
      return sum + (dayIndex >= 0 && dayIndex < distribution.length ? distribution[dayIndex] : 0);
    }, 0);
    return { key, amount };
  });
  const maxDailyAmount = Math.max(1, ...calendarDays.map(({ amount }) => amount));
  return <div className="page-stack">
    <PageHeading title="Gastos prolongados" description="Registra gastos medidos durante varios días y distribúyelos por fecha." action={<><Button onClick={() => setModal({ type: 'long' })}><Plus size={15} /> Registrar periodo</Button><ExportButton module="gastos-prolongados" filters={{ texto: query }} /></>} />
    <div className="kpi-grid kpi-grid-three"><Kpi label="Asignado al periodo" value={money(total)} tone="orange" detail={`${rows.length} periodos visibles`} icon={Wallet} /><Kpi label="Días cubiertos" value={rows.reduce((sum, item) => sum + inclusiveDays(item.fechaInicio, item.fechaFin), 0)} tone="blue" detail="En los periodos visibles" icon={CalendarDays} /><Kpi label="Promedio diario" value={money(rows.reduce((sum, item) => sum + item.monto / inclusiveDays(item.fechaInicio, item.fechaFin), 0))} tone="slate" detail="Distribución por día" icon={TrendingUp} /></div>
    <Card className="table-card"><Toolbar search={query} onSearch={setQuery}><span className="period-filter-label"><CalendarDays size={14} /> Periodo: {filterPeriod}</span><span className="table-count">{rows.length} periodos</span></Toolbar>
      <Table columns={[
        { key: 'detalle', label: 'Detalle', render: (row) => <strong className="cell-main">{row.detalle}</strong> },
        { key: 'rango', label: 'Periodo original', render: (row) => `${formatDate(originalStart(row))} — ${formatDate(originalEnd(row))}` },
        { key: 'dias', label: 'Días', align: 'right', render: (row) => inclusiveDays(originalStart(row), originalEnd(row)) },
        { key: 'categoriaNombre', label: 'Categoría' }, { key: 'plataformaNombre', label: 'Plataforma' },
        { key: 'diario', label: 'Valor / día', align: 'right', render: (row) => <span className="money">{money((row.montoTotalOriginal ?? row.monto) / inclusiveDays(originalStart(row), originalEnd(row)))}</span> },
        { key: 'montoTotalOriginal', label: 'Monto total', align: 'right', render: (row) => <strong className="money">{money(row.montoTotalOriginal ?? row.monto)}</strong> },
        { key: 'monto', label: 'Asignado al periodo', align: 'right', render: (row) => <strong className="money amount-orange">{money(row.monto)}</strong> },
        { key: 'actions', label: 'Acciones', render: (row) => <div className="row-actions"><button onClick={() => setModal({ type: 'long-edit', item: { ...row, monto: row.montoTotalOriginal ?? row.monto, fechaInicio: originalStart(row), fechaFin: originalEnd(row) } })}>Editar</button><button onClick={async () => {
          if (!window.confirm(`¿Seguro que quieres eliminar "${row.detalle}"? Esta acción no se puede deshacer.`)) return;
          try { await removeItem('gastos-prolongados', row); } catch (error) { notify(error.message, 'error'); }
        }}>Eliminar</button></div> }
      ]} rows={rows} empty="No hay gastos prolongados para el periodo." />
      <div className="sticky-summary"><strong>Reparto diario</strong><span>El excedente de redondeo se asigna al último día</span><b className="money amount-orange">{money(total)}</b></div>
    </Card>
    <div className="two-column"><Card><div className="section-heading"><div><h2>Vista de reparto</h2><p>Distribución diaria del rango con gastos activos · selecciona un día para filtrar</p></div></div><div className="calendar-strip" style={{ gridTemplateColumns: `repeat(${calendarDays.length}, minmax(0, 1fr))` }}>{calendarDays.map(({ key, amount }) => <button type="button" key={key} className={`calendar-day ${amount ? amount >= maxDailyAmount * .65 ? 'day-cost-high' : 'day-cost-low' : ''}`} style={{ opacity: amount ? .45 + amount / maxDailyAmount * .55 : .28 }} onClick={() => setDateRange(key, key)} title={`${formatDate(key)} · ${money(amount)}`} aria-label={`${formatDate(key)}: ${money(amount)}. Filtrar este día`} />)}</div><div className="calendar-legend"><span><i className="dot dot-blue" />Gasto distribuido por día</span><span>{calendarDays.length} días visibles</span>{calendarDays.some(({ amount }) => amount > 0) && <span>Total diario visible: {money(calendarDays.reduce((sum, day) => sum + day.amount, 0))}</span>}</div></Card><Card className="notice-card"><h3>Evita registrar el mismo periodo dos veces</h3><p>Al guardar un rango para la misma plataforma y categoría, Safetrics te avisará si las fechas se cruzan.</p><span className="text-link">Los gastos se ingresan manualmente</span></Card></div>
  </div>;
}

function ComparisonsScreen({ allSales, allExpenses, allLongExpenses, finance, today }) {
  const [stateFilter, setStateFilter] = useState('Todos');
  const [groupMode, setGroupMode] = useState('Mes');
  const thisYear = Number(today.slice(0, 4));
  const currentMonth = Number(today.slice(5, 7));
  const [rangeMode, setRangeMode] = useState('Año completo');
  const [comparisonYear, setComparisonYear] = useState(String(thisYear));
  const [monthA, setMonthA] = useState('01');
  const [monthB, setMonthB] = useState(String(currentMonth).padStart(2, '0'));
  const [customDates, setCustomDates] = useState({ desde: `${thisYear}-01-01`, hasta: `${thisYear}-12-31` });
  const monthOptions = Array.from({ length: 12 }, (_, index) => {
    const value = String(index + 1).padStart(2, '0');
    const label = new Intl.DateTimeFormat('es-CO', { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, index, 1)));
    return [value, capitalize(label)];
  });
  const yearsInData = [...allSales, ...allExpenses, ...allLongExpenses].flatMap((item) =>
    [item.fecha, item.fechaInicio, item.fechaFin].filter(Boolean).map((date) => Number(String(date).slice(0, 4)))
  );
  const years = [...new Set([...Array.from({ length: 12 }, (_, index) => thisYear - 10 + index), ...yearsInData, Number(comparisonYear)])]
    .filter((year) => Number.isFinite(year))
    .sort((a, b) => b - a);
  const monthKeyA = `${comparisonYear}-${monthA}`;
  const monthKeyB = `${comparisonYear}-${monthB}`;
  const selectedMonths = [...new Set([monthKeyA, monthKeyB])].sort();
  const monthDateRange = selectedMonths.map((month) => {
    const start = `${month}-01`;
    const end = new Date(`${month}-01T12:00:00Z`);
    end.setUTCMonth(end.getUTCMonth() + 1, 0);
    return { start, end: end.toISOString().slice(0, 10) };
  });
  const comparisonFrom = rangeMode === 'Comparar meses'
    ? monthDateRange[0].start
    : rangeMode === 'Rango personalizado' ? customDates.desde : `${comparisonYear}-01-01`;
  const comparisonThrough = rangeMode === 'Comparar meses'
    ? monthDateRange[monthDateRange.length - 1].end
    : rangeMode === 'Rango personalizado' ? customDates.hasta : `${comparisonYear}-12-31`;
  const validDateRange = Boolean(comparisonFrom && comparisonThrough && comparisonFrom <= comparisonThrough);
  const monthNames = new Map(monthOptions);
  const comparisonLabel = rangeMode === 'Año completo'
    ? `Año completo · ${comparisonYear}`
    : rangeMode === 'Comparar meses'
      ? `${monthNames.get(monthA)} vs ${monthNames.get(monthB)} · ${comparisonYear}`
      : `Rango personalizado · ${comparisonFrom || '—'} a ${comparisonThrough || '—'}`;
  const saleFilter = stateFilter === 'Todos' ? undefined : (sale) => sale.estado === stateFilter;
  const periods = validDateRange ? comparisonPeriods({
    desde: comparisonFrom, hasta: comparisonThrough, meses: rangeMode === 'Comparar meses' ? selectedMonths : [], agrupar: groupMode, hoy: today
  }) : [];
  const allValues = periods.map((period) => {
    const result = finance.metrics(period.desde, period.calculoHasta, saleFilter);
    return {
      name: period.clave, displayName: period.corta, desde: period.desde, hasta: period.hasta,
      esperado: result.vendidos.utilidadEsperada, ventaNeta: result.vendidos.ventaNeta, costoProducto: result.vendidos.costoProducto, real: result.recibido.monto, pagos: result.recibido.pagos,
      gastos: roundMoney(result.gastos.suscripciones + result.gastos.otros), fletes: result.gastos.fletes,
      costos: result.gastos.total, utilidad: result.neto, espera: result.estados.en_espera.utilidadEsperada,
      cantidad: result.vendidos.pedidos + result.vendidos.cancelados, concretados: result.estados.pagada.pedidos, estados: result.estados
    };
  });
  const sumValues = (get) => roundMoney(allValues.reduce((sum, item) => sum + get(item), 0));
  const actual = sumValues((item) => item.real);
  const pending = sumValues((item) => item.espera);
  const returnFreight = sumValues((item) => item.fletes);
  const expenseTotal = sumValues((item) => item.gastos);
  const totalCosts = roundMoney(expenseTotal + returnFreight);
  const netProfit = roundMoney(actual - totalCosts);
  const projectedProfit = roundMoney(netProfit + pending);
  const netRevenue = sumValues((item) => item.ventaNeta);
  const productCost = sumValues((item) => item.costoProducto);
  const payments = sumValues((item) => item.pagos);
  const averageTicket = payments ? actual / payments : 0;
  const createdOrders = sumValues((item) => item.cantidad);
  const stateTotal = (state) => sumValues((item) => item.estados[state].pedidos);
  const values = allValues.slice(-120);
  const maxFlow = Math.max(1, ...values.flatMap((item) => [item.real, item.costos]));
  const maxExpected = Math.max(1, ...values.flatMap((item) => [item.esperado, item.real]));
  const maxProfit = Math.max(1, ...values.map((item) => Math.abs(item.utilidad)));
  const conversionRate = createdOrders ? stateTotal('pagada') / createdOrders : 0;
  const returnRate = createdOrders ? stateTotal('devuelta') / createdOrders : 0;
  const statusCounts = [
    { key: 'pagada', label: 'Pagadas', count: stateTotal('pagada'), color: '#2f7a61' },
    { key: 'en_espera', label: 'En espera', count: stateTotal('en_espera'), color: '#d29a3c' },
    { key: 'devuelta', label: 'Devueltas', count: stateTotal('devuelta'), color: '#bf6b43' },
    { key: 'cancelada', label: 'Canceladas', count: stateTotal('cancelada'), color: '#8797a8' }
  ];
  const statusTotal = statusCounts.reduce((sum, item) => sum + item.count, 0);
  let statusOffset = 0;
  const statusGradient = statusTotal ? statusCounts.map((item) => {
    const start = statusOffset;
    statusOffset += item.count / statusTotal * 100;
    return `${item.color} ${start}% ${statusOffset}%`;
  }).join(', ') : '#e8edf2 0% 100%';
  const choosePeriod = (desde, hasta) => {
    setRangeMode('Rango personalizado');
    setCustomDates({ desde, hasta });
  };
  const comparisonExportFilters = {
    desde: comparisonFrom,
    hasta: comparisonThrough,
    estado: stateFilter,
    meses: rangeMode === 'Comparar meses' ? selectedMonths.join(',') : ''
  };
  return <div className="page-stack">
    <PageHeading title="Comparativas" description="Revisa juntas las tendencias de cobros, gastos, utilidad y pedidos." action={<ExportButton module="comparativas" filters={comparisonExportFilters} />} />
    <Card className="comparison-card">
      <div className="comparison-filters">
        <label>Periodo <DropdownSelect ariaLabel="Periodo de comparativas" className="compact-select" value={rangeMode} options={['Año completo', 'Comparar meses', 'Rango personalizado'].map((mode) => [mode, mode])} onChange={setRangeMode} /></label>
        {rangeMode !== 'Rango personalizado' && <label>Año <DropdownSelect ariaLabel="Año de comparativas" className="compact-select" value={comparisonYear} options={years.map((year) => [String(year), String(year)])} onChange={(value) => setComparisonYear(value)} /></label>}
        {rangeMode === 'Comparar meses' && <>
          <label>Mes A <DropdownSelect ariaLabel="Primer mes a comparar" className="compact-select" value={monthA} options={monthOptions} onChange={setMonthA} /></label>
          <span className="comparison-vs">vs</span>
          <label>Mes B <DropdownSelect ariaLabel="Segundo mes a comparar" className="compact-select" value={monthB} options={monthOptions} onChange={setMonthB} /></label>
        </>}
        {rangeMode === 'Rango personalizado' && <div className="comparison-date-range">
          <label>Desde <input aria-label="Inicio de comparativas" type="date" value={customDates.desde} max={customDates.hasta || undefined} onChange={(event) => setCustomDates((current) => ({ ...current, desde: event.target.value }))} /></label>
          <span aria-hidden="true">—</span>
          <label>Hasta <input aria-label="Fin de comparativas" type="date" value={customDates.hasta} min={customDates.desde || undefined} onChange={(event) => setCustomDates((current) => ({ ...current, hasta: event.target.value }))} /></label>
        </div>}
        <span className="comparison-period"><CalendarDays size={14} />{comparisonLabel}</span>
        <label className="comparison-group-control">Agrupar <DropdownSelect ariaLabel="Agrupar comparación" className="compact-select" value={groupMode} options={['Día', 'Semana', 'Mes', 'Trimestre', 'Periodo A/B'].map((mode) => [mode, mode])} onChange={setGroupMode} /></label>
        <label>Estado <DropdownSelect ariaLabel="Filtrar ventas comparadas" className="compact-select" value={stateFilter} options={ [['Todos', 'Todos'], ['pagada', 'Pagada'], ['en_espera', 'En espera'], ['devuelta', 'Devuelta'], ['cancelada', 'Cancelada']] } onChange={setStateFilter} /></label>
      </div>
      <div className="comparison-summary">
        <div><small>Venta neta</small><strong className="money">{money(netRevenue)}</strong></div>
        <div><small>Costo producto</small><strong className="money amount-orange">{money(productCost)}</strong></div>
        <div><small>Ganancia real cobrada</small><strong className="money amount-green">{money(actual)}</strong></div>
        <div><small>Gastos y fletes</small><strong className="money amount-orange">{money(totalCosts)}</strong></div>
        <div><small>Utilidad (excedente)</small><strong className={`money ${netProfit < 0 ? 'amount-red' : 'amount-blue'}`}>{money(netProfit)}</strong></div>
        <div><small>Utilidad proyectada</small><strong className={`money ${projectedProfit < 0 ? 'amount-red' : 'amount-blue'}`}>{money(projectedProfit)}</strong></div>
        <div><small>Margen neto sobre cobros</small><strong className={netProfit < 0 ? 'amount-red' : 'amount-blue'}>{percent(actual ? netProfit / actual : 0)}</strong></div>
        <div><small>Gastos / ganancia real</small><strong>{percent(actual ? expenseTotal / actual : 0)}</strong></div>
        <div><small>Tasa de pedidos pagados</small><strong>{percent(conversionRate)}</strong></div>
        <div><small>Ticket promedio pagado</small><strong className="money">{money(averageTicket)}</strong></div>
        <div><small>Por cobrar</small><strong className="money amount-amber">{money(pending)}</strong></div>
        <div><small>Tasa de devoluciones</small><strong>{percent(returnRate)}</strong></div>
      </div>
      <div className="comparison-charts">
        <section className="comparison-chart-panel comparison-chart-wide" aria-label="Ganancia cobrada frente a gastos y utilidad">
          <div className="chart-heading"><div><h2>Ganancia cobrada vs gastos</h2><p>La utilidad es el excedente: cobros recibidos menos gastos y fletes de devolución.</p></div></div>
          <div className="chart-legend"><span><i className="dot dot-green" />Ganancia cobrada</span><span><i className="dot dot-orange" />Gastos + fletes</span><span><i className="dot dot-blue" />Utilidad (excedente)</span></div>
          {values.length ? <div className="comparison-chart-scroll"><div className="financial-bars" style={{ minWidth: `${Math.max(560, values.length * 64)}px` }}>{values.map((value) => <div className="financial-month" key={value.name}>
            <div className="financial-bar-pair">
              <button type="button" className="financial-bar bar-income" style={{ height: `${Math.max(value.real / maxFlow * 100, 1)}%` }} title={`${value.displayName} · Ganancia cobrada: ${money(value.real)}`} aria-label={`${value.displayName}: ganancia cobrada ${money(value.real)}; seleccionar periodo`} onClick={() => choosePeriod(value.desde, value.hasta)} />
              <button type="button" className="financial-bar bar-outflow" style={{ height: `${Math.max(value.costos / maxFlow * 100, 1)}%` }} title={`${value.displayName} · Gastos y fletes: ${money(value.costos)}`} aria-label={`${value.displayName}: gastos y fletes ${money(value.costos)}; seleccionar periodo`} onClick={() => choosePeriod(value.desde, value.hasta)} />
            </div>
            <span className="financial-month-label">{value.displayName}</span>
            <strong className={`financial-profit-label ${value.utilidad < 0 ? 'amount-red' : 'amount-blue'}`} title="Utilidad = ganancia cobrada − gastos − fletes">{money(value.utilidad)}</strong>
          </div>)}</div></div> : <p className="empty-chart-note">No hay datos para comparar en este periodo.</p>}
        </section>
        <section className="comparison-chart-panel" aria-label="Tendencia de utilidad mensual">
          <div className="chart-heading"><div><h2>Utilidad por periodo</h2><p>Excedente o déficit después de gastos y fletes.</p></div></div>
          {values.length ? <div className="profit-chart">{values.map((value) => <div className="profit-month" key={value.name}>
            <div className="profit-plot"><i className="profit-zero-line" /><button type="button" className={`profit-bar ${value.utilidad < 0 ? 'is-negative' : ''}`} style={{ height: `${Math.max(Math.abs(value.utilidad) / maxProfit * 45, 1)}%` }} title={`${value.displayName} · Utilidad: ${money(value.utilidad)}`} aria-label={`${value.displayName}: utilidad ${money(value.utilidad)}; seleccionar periodo`} onClick={() => choosePeriod(value.desde, value.hasta)} /></div>
            <span>{value.displayName}</span><small className={value.utilidad < 0 ? 'amount-red' : 'amount-blue'}>{money(value.utilidad)}</small>
          </div>)}</div> : <p className="empty-chart-note">No hay datos de utilidad para mostrar.</p>}
        </section>
        <section className="comparison-chart-panel" aria-label="Esperado frente a cobrado">
          <div className="chart-heading"><div><h2>Esperado vs cobrado</h2><p>Importe registrado frente al dinero efectivamente recibido.</p></div></div>
          <div className="chart-legend"><span><i className="dot dot-slate" />Esperado</span><span><i className="dot dot-blue" />Cobrado</span></div>
          {values.length ? <div className="comparison-chart-scroll"><div className="financial-bars expected-bars" style={{ minWidth: `${Math.max(560, values.length * 64)}px` }}>{values.map((value) => <div className="financial-month" key={value.name}>
            <div className="financial-bar-pair">
              <button type="button" className="financial-bar bar-expected" style={{ height: `${Math.max(value.esperado / maxExpected * 100, 1)}%` }} title={`${value.displayName} · Esperado: ${money(value.esperado)}`} aria-label={`${value.displayName}: esperado ${money(value.esperado)}; seleccionar periodo`} onClick={() => choosePeriod(value.desde, value.hasta)} />
              <button type="button" className="financial-bar bar-paid" style={{ height: `${Math.max(value.real / maxExpected * 100, 1)}%` }} title={`${value.displayName} · Cobrado: ${money(value.real)}`} aria-label={`${value.displayName}: cobrado ${money(value.real)}; seleccionar periodo`} onClick={() => choosePeriod(value.desde, value.hasta)} />
            </div><span className="financial-month-label">{value.displayName}</span>
          </div>)}</div></div> : <p className="empty-chart-note">No hay ventas para comparar en este periodo.</p>}
        </section>
        <section className="comparison-chart-panel status-chart-panel" aria-label="Distribución de pedidos por estado">
          <div className="chart-heading"><div><h2>Pedidos por estado</h2><p>Distribución de ventas en el periodo seleccionado.</p></div></div>
          <div className="status-chart-content"><div className="status-donut" style={{ background: `conic-gradient(${statusGradient})` }} role="img" aria-label={`Distribución de ${statusTotal} pedidos por estado`}><div><strong>{statusTotal}</strong><span>pedidos</span></div></div>
            <div className="status-legend">{statusCounts.map((item) => <div key={item.key}><i style={{ backgroundColor: item.color }} /><span>{item.label}</span><strong>{item.count}</strong><small>{percent(statusTotal ? item.count / statusTotal : 0)}</small></div>)}</div>
          </div>
        </section>
      </div>
      <div className="comparison-table"><h3>Detalle por periodo</h3><Table columns={[
        { key: 'periodo', label: 'Periodo', render: (row) => <strong>{row.displayName}</strong> },
        { key: 'esperado', label: 'Esperado', align: 'right', render: (row) => money(row.esperado) },
        { key: 'real', label: 'Ganancia real', align: 'right', render: (row) => <span className="money amount-green">{money(row.real)}</span> },
        { key: 'gastos', label: 'Gastos', align: 'right', render: (row) => <span className="money amount-orange">{money(row.gastos)}</span> },
        { key: 'fletes', label: 'Fletes devolución', align: 'right', render: (row) => money(row.fletes) },
        { key: 'utilidad', label: 'Utilidad neta', align: 'right', render: (row) => <strong className={`money ${row.utilidad < 0 ? 'amount-red' : 'amount-blue'}`}>{money(row.utilidad)}</strong> },
        { key: 'espera', label: 'Por cobrar', align: 'right', render: (row) => money(row.espera) },
        { key: 'cantidad', label: 'Pedidos', align: 'right' },
        { key: 'concretados', label: 'Pagados', align: 'right' }
      ]} rows={values} empty="No hay datos para el periodo seleccionado." />
      </div>
      <div className="comparison-footnote"><ShieldCheck size={15} /><span>Utilidad = lo recibido de la plataforma − suscripciones (repartidas por día) − publicidad y otros gastos − fletes de devoluciones. La plataforma ya descuenta el costo del producto y el envío de lo que paga. Son las mismas cifras de Resumen y de los reportes.</span></div>
    </Card>
    <div className="bottom-note"><ShieldCheck size={15} /><span>Los gráficos se actualizan con el año, rango y estado seleccionados. El esperado es el neto de los pedidos creados en cada periodo (sin cancelados); lo cobrado cuenta en la fecha de pago. Los días futuros aún no suman movimientos.</span></div>
  </div>;
}

function CatalogScreen({ data, catalogTab, setCatalogTab, setModal, notify, setData }) {
  const catalog = catalogTab === 'Categorías' ? data.categorias : data.plataformas;
  const entity = catalogTab === 'Categorías' ? 'categorias' : 'plataformas';
  return <div className="page-stack">
    <PageHeading title="Catálogos" description="Organiza las categorías y plataformas usadas en tus gastos." action={<Button onClick={() => setModal({ type: 'catalog', entity })}><Plus size={15} /> Añadir {catalogTab === 'Categorías' ? 'categoría' : 'plataforma'}</Button>} />
    <Card className="table-card"><div className="tab-strip">{['Categorías', 'Plataformas'].map((tab) => <button key={tab} className={catalogTab === tab ? 'selected' : ''} onClick={() => setCatalogTab(tab)}>{tab}<small>{(tab === 'Categorías' ? data.categorias : data.plataformas).length}</small></button>)}</div>
      <Table columns={[
        { key: 'nombre', label: 'Nombre', render: (row) => <strong className="cell-main">{row.nombre}</strong> },
        { key: 'uso', label: 'Uso', render: () => 'Gastos y análisis' },
        { key: 'estado', label: 'Estado', render: (row) => <Status value={row.estado} /> },
        { key: 'actions', label: 'Acciones', render: (row) => <div className="row-actions catalog-actions"><button onClick={() => setModal({ type: 'catalog-edit', entity, item: row })}>Renombrar</button><button onClick={async () => {
          const updated = { ...row, estado: row.estado === 'activo' ? 'desactivado' : 'activo' };
          try {
            const saved = await request(`/catalogos/${entity}/${row._id}`, { method: 'PUT', body: JSON.stringify({ estado: updated.estado }) });
            setData((current) => ({ ...current, [entity]: current[entity].map((item) => item._id === row._id ? saved : item) }));
            notify(`Catálogo ${saved.estado === 'activo' ? 'activado' : 'desactivado'}`);
          } catch (error) {
            notify(error.message, 'error');
          }
        }}>{row.estado === 'activo' ? 'Desactivar' : 'Activar'}</button></div> }
      ]} rows={catalog || []} empty="Este catálogo todavía no tiene elementos." />
    </Card>
    <div className="notice notice-blue"><FolderIcon /><div><strong>El historial conserva la referencia</strong><span>Renombrar una categoría o plataforma actualiza su nombre en las vistas, sin alterar los registros.</span></div></div>
  </div>;
}

function BackupScreen({ notify, health, navigate }) {
  const [backups, setBackups] = useState([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    request('/respaldo').then(setBackups).catch((error) => notify(`No se pudo cargar el historial de respaldos: ${error.message}`, 'error'));
  }, [notify]);
  const makeBackup = async () => {
    setBusy(true);
    try { const result = await request('/respaldo', { method: 'POST' }); setBackups((items) => [{ nombre: result.nombre }, ...items]); notify(`Respaldo creado: ${result.nombre}`); }
    catch (error) { notify(error.message, 'error'); }
    finally { setBusy(false); }
  };
  return <div className="page-stack">
    <PageHeading title="Respaldo" description="Crea y consulta copias de seguridad de tus datos locales." action={<Button variant="primary" onClick={makeBackup} disabled={busy || !health}><Database size={15} />{busy ? 'Creando…' : 'Respaldar ahora'}</Button>} />
    <div className="backup-grid"><Card className="backup-status"><div className="backup-status-icon"><ShieldCheck size={22} /></div><div className="eyebrow">ESTADO DEL RESPALDO</div><h2>{health ? 'Base de datos disponible' : 'Backend sin conexión'}</h2><p>{health ? 'Los datos se guardan localmente en tu equipo.' : 'Inicia el backend y MongoDB para administrar respaldos.'}</p><div className="backup-meta"><span><i className={health ? 'green-indicator' : 'red-indicator'} />{health ? 'MongoDB local' : 'Sin conexión'}</span><span>{backups.length} archivos</span></div></Card><Card><div className="section-heading"><div><h2>Respaldo automático</h2><p>Configuración vigente</p></div><span className="status status-paid"><i />Activo</span></div><div className="backup-setting-row"><span>Frecuencia</span><strong>Semanal</strong></div><div className="backup-setting-row"><span>Conservar</span><strong>8 respaldos</strong></div><div className="backup-setting-row"><span>Ubicación</span><strong className="mono-path">data/respaldos</strong></div><Button onClick={() => navigate('configuracion')}>Administrar configuración</Button></Card></div>
    <Card className="table-card"><div className="section-heading card-section-heading"><div><h2>Historial de respaldos</h2><p>Archivos disponibles en este equipo</p></div><Button onClick={() => notify('Carpeta del backend: data/respaldos. Abre esa ruta desde el explorador de archivos del equipo.')}>Ver ruta local</Button></div>
      <Table columns={[
        { key: 'nombre', label: 'Archivo', render: (row) => <span className="backup-file"><Database size={15} /><strong>{row.nombre}</strong></span> },
        { key: 'created', label: 'Fecha', render: (row) => row.nombre?.replace('safetrics_', '').replace('.json', '').replace('_', ' ') || '—' },
        { key: 'size', label: 'Formato', render: () => <span className="origin-tag">JSON</span> },
        { key: 'actions', label: 'Acciones', render: (row) => <button className="row-link" onClick={async () => {
          if (!window.confirm(`Restaurar ${row.nombre} reemplazará los registros actuales. Esta acción no se puede deshacer. ¿Continuar?`)) return;
          try {
            await request('/respaldo/restaurar', { method: 'POST', body: JSON.stringify({ nombre: row.nombre }) });
            notify('Respaldo restaurado. Recargando datos.');
            window.location.reload();
          } catch (error) { notify(error.message, 'error'); }
        }}>Restaurar</button> }
      ]} rows={backups} empty="Todavía no hay respaldos. Crea el primero para proteger tu información." />
    </Card>
    <div className="notice notice-amber"><ShieldCheck size={17} /><div><strong>La restauración reemplaza la información actual</strong><span>Antes de restaurar, crea una copia de seguridad reciente.</span></div></div>
  </div>;
}

function SettingsScreen({ settings, setSettings, notify, health }) {
  const [form, setForm] = useState(settings);
  const [saving, setSaving] = useState(false);
  useEffect(() => setForm(settings), [settings]);
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const save = async (event) => {
    event.preventDefault();
    if (!health) { setSettings(form); notify('Preferencias guardadas en esta vista'); return; }
    if (saving) return;
    setSaving(true);
    try {
      const saved = await request('/configuracion', { method: 'PUT', body: JSON.stringify({ ...form, diasAlertaEnEspera: Number(form.diasAlertaEnEspera), respaldoAutomatico: { ...form.respaldoAutomatico, conservarUltimos: Number(form.respaldoAutomatico.conservarUltimos) } }) });
      setSettings(saved); notify('Configuración guardada');
    } catch (error) { notify(error.message, 'error'); }
    finally { setSaving(false); }
  };
  return <div className="page-stack">
    <PageHeading title="Configuración" description="Ajusta las preferencias generales y las copias de seguridad." />
    <form className="settings-layout" onSubmit={save}>
      <div className="settings-main">
        <Card><div className="section-heading"><div><h2>Preferencias generales</h2><p>Datos y formato de la aplicación</p></div><SettingsIcon /></div><div className="form-grid">
          <label className="field full"><span>Nombre del negocio</span><input value={form.nombreNegocio || 'Safetrics'} onChange={(event) => update('nombreNegocio', event.target.value)} /></label>
          <label className="field"><span>Días para alerta de venta en espera</span><input type="number" min="1" max="365" value={form.diasAlertaEnEspera || 15} onChange={(event) => update('diasAlertaEnEspera', event.target.value)} /></label>
          <label className="field"><span>Formato de fecha</span><DropdownSelect ariaLabel="Formato de fecha" className="field-select" value={form.formatoFecha || 'dd/MM/yyyy'} options={['dd/MM/yyyy', 'yyyy-MM-dd'].map((option) => [option, option])} onChange={(value) => update('formatoFecha', value)} /></label>
          <label className="field"><span>Moneda</span><input value="Peso colombiano · COP" disabled /></label>
          <label className="field"><span>Zona horaria</span><input value="America/Bogota" disabled /></label>
        </div></Card>
        <Card><div className="section-heading"><div><h2>Respaldo automático</h2><p>Programa una copia de seguridad local</p></div><Database size={18} /></div><div className="form-grid">
          <label className="field full toggle-field"><span><strong>Activar respaldo automático</strong><small>Las copias se crean en el equipo donde se ejecuta el backend.</small></span><input type="checkbox" checked={Boolean(form.respaldoAutomatico?.activo)} onChange={(event) => update('respaldoAutomatico', { ...form.respaldoAutomatico, activo: event.target.checked })} /></label>
          <label className="field"><span>Frecuencia</span><DropdownSelect ariaLabel="Frecuencia de respaldo" className="field-select" value={form.respaldoAutomatico?.frecuencia || 'semanal'} options={ [['semanal', 'Semanal'], ['mensual', 'Mensual']] } onChange={(value) => update('respaldoAutomatico', { ...form.respaldoAutomatico, frecuencia: value })} /></label>
          <label className="field"><span>Conservar últimos</span><input type="number" min="1" max="100" value={form.respaldoAutomatico?.conservarUltimos || 8} onChange={(event) => update('respaldoAutomatico', { ...form.respaldoAutomatico, conservarUltimos: event.target.value })} /></label>
          <label className="field full"><span>Carpeta de respaldo</span><input value={form.respaldoAutomatico?.carpeta || 'data/respaldos'} onChange={(event) => update('respaldoAutomatico', { ...form.respaldoAutomatico, carpeta: event.target.value })} /></label>
        </div></Card>
        <div className="settings-submit"><span>Los cambios se aplican a esta instalación local.</span><Button type="submit" variant="primary" disabled={saving}><Check size={15} />{saving ? 'Guardando…' : 'Guardar cambios'}</Button></div>
      </div>
      <aside className="side-stack"><Card className="settings-aside"><div className="aside-icon"><ShieldCheck size={18} /></div><h3>Tus datos permanecen locales</h3><p>Safetrics no envía información a servicios externos ni activa telemetría.</p><span className="aside-link"><i /> {health ? 'API local disponible' : 'API local desconectada'}</span></Card><Card><div className="section-heading"><div><h2>Acerca de</h2><p>Versión y entorno</p></div></div><div className="backup-setting-row"><span>Versión</span><strong>0.10</strong></div><div className="backup-setting-row"><span>Entorno</span><strong>Local</strong></div><div className="backup-setting-row"><span>Moneda</span><strong>COP</strong></div></Card></aside>
    </form>
  </div>;
}

function FormModal(props) {
  const { modal, setModal, saveEntity, products, categoryOptions, platformOptions, notify, selectedSale, changeSaleStatus, removeItem, setData } = props;
  const [values, setValues] = useState({});
  const [statusPending, setStatusPending] = useState(false);
  useEffect(() => {
    if (!modal) return;
    const item = modal.item || {};
    const defaultProduct = products.find((product) => product.estado === 'activo');
    setValues({
      ...item,
      fecha: item.fecha ? String(item.fecha).slice(0, 10) : todayInput(),
      fechaInicio: item.fechaInicio ? String(item.fechaInicio).slice(0, 10) : todayInput(),
      fechaFin: item.fechaFin ? String(item.fechaFin).slice(0, 10) : todayInput(),
      cantidad: item.cantidad || 1,
      estado: item.estado || (modal.type.startsWith('product') ? 'activo' : 'en_espera'),
      frecuencia: item.frecuencia || 'mensual',
      productoId: item.productoId || (modal.type === 'sale' ? defaultProduct?._id : ''),
      productoBaseId: item.productoBaseId || '',
      unidadesPorVenta: item.unidadesPorVenta || 1,
      valorEsperado: item.valorEsperado ?? '',
      monto: item.monto ?? '',
      precio: item.precio ?? '',
      valor: item.valor ?? '',
      fechaPago: item.fechaPago ? String(item.fechaPago).slice(0, 10) : todayInput(),
      fechaDevolucion: item.fechaDevolucion ? String(item.fechaDevolucion).slice(0, 10) : dayKey([...(item.historialEstados || [])].reverse().find((entry) => entry.estado === 'devuelta')?.en) || todayInput()
    });
  }, [modal, products]);
  if (!modal) return null;
  const set = (key, value) => setValues((current) => {
    const updated = { ...current, [key]: value };
    return updated;
  });
  const close = () => setModal(null);
  if (modal.type === 'status') return <Modal title="Actualizar estado" description={`Venta de ${modal.sale.nombre} · ${money(modal.sale.valorEsperado)}`} onClose={close} onSubmit={(event) => { event.preventDefault(); close(); }} submitLabel="Listo">
    <div className="status-options">{['pagada', 'en_espera', 'devuelta', 'cancelada'].map((state) => <button key={state} type="button" className="status-option" disabled={statusPending} onClick={async () => {
      if (state === 'pagada') setModal({ type: 'status-paid', sale: modal.sale });
      else if (state === 'devuelta') setModal({ type: modal.sale.estado === 'pagada' ? 'status-returned-confirm' : 'status-returned', sale: modal.sale });
      else if (modal.sale.estado === 'pagada') setModal({ type: 'status-confirm', sale: modal.sale, next: state });
      else {
        setStatusPending(true);
        try {
          await changeSaleStatus(modal.sale, state);
        } catch (error) {
          notify(error instanceof Error ? error.message : 'No se pudo actualizar el estado.', 'error');
        } finally {
          setStatusPending(false);
        }
      }
    }}><Status value={state} /><ArrowRight size={15} /></button>)}</div>
    <div className="info-note" role={statusPending ? 'status' : undefined}>{statusPending ? 'Actualizando estado…' : 'Cambiar una venta pagada retira su valor real de los totales.'}</div>
  </Modal>;
  if (['status-paid', 'status-returned', 'status-returned-confirm', 'status-confirm'].includes(modal.type)) {
    const confirm = modal.type === 'status-confirm' || modal.type === 'status-returned-confirm';
    return <Modal title={confirm ? 'Confirmar cambio de estado' : modal.type === 'status-paid' ? 'Registrar pago' : 'Registrar devolución'} description={confirm ? 'El valor real dejará de contar como ganancia.' : modal.type === 'status-paid' ? 'Confirma la fecha en la que recibiste el pago.' : 'Registra la fecha de la devolución y el costo del flete, si aplica.'} onClose={close} onSubmit={async (event) => {
      event.preventDefault();
      if (modal.type === 'status-returned-confirm') await changeSaleStatus(modal.sale, 'devuelta', { costoFlete: Number(values.costoFlete || 0), fechaDevolucion: values.fechaDevolucion || todayInput() });
      else if (confirm) await changeSaleStatus(modal.sale, modal.next);
      else if (modal.type === 'status-paid') await changeSaleStatus(modal.sale, 'pagada', { fechaPago: values.fechaPago });
      else await changeSaleStatus(modal.sale, 'devuelta', { costoFlete: Number(values.costoFlete || 0), fechaDevolucion: values.fechaDevolucion || todayInput() });
    }} submitLabel={confirm ? 'Confirmar cambio' : 'Guardar estado'} danger={confirm}>
      {modal.type === 'status-paid' ? <Field label="Fecha de pago" type="date" value={values.fechaPago || todayInput()} onChange={(value) => set('fechaPago', value)} /> : modal.type === 'status-returned-confirm' ? <><div className="confirm-warning"><ShieldCheck size={20} /><span>El valor real saldrá de la ganancia. Registra también el flete de devolución.</span></div><Field label="Fecha de devolución" type="date" value={values.fechaDevolucion || todayInput()} onChange={(value) => set('fechaDevolucion', value)} /><Field label="Costo de flete" type="number" min="0" value={values.costoFlete || ''} onChange={(value) => set('costoFlete', value)} hint="Escribe 0 si no hubo costo." /></> : confirm ? <div className="confirm-warning"><ShieldCheck size={20} /><span>Se actualizarán los totales de ventas y del resumen.</span></div> : <><Field label="Fecha de devolución" type="date" value={values.fechaDevolucion || todayInput()} onChange={(value) => set('fechaDevolucion', value)} /><Field label="Costo de flete" type="number" min="0" value={values.costoFlete || ''} onChange={(value) => set('costoFlete', value)} hint="Escribe 0 si no hubo costo." /></>}
    </Modal>;
  }
  if (modal.type === 'product-toggle') return <Modal title={modal.item.estado === 'activo' ? 'Desactivar producto' : 'Activar producto'} description={modal.item.nombre} onClose={close} onSubmit={async (event) => {
    event.preventDefault();
    const updatedState = modal.item.estado === 'activo' ? 'desactivado' : 'activo';
    const updated = await request(`/productos/${modal.item._id}`, { method: 'PUT', body: JSON.stringify({ estado: updatedState }) });
    setData((current) => ({ ...current, productos: current.productos.map((item) => item._id === modal.item._id ? updated : item) }));
    close();
    notify('Estado del producto actualizado');
  }} submitLabel="Confirmar"><p className="body-copy">El historial de ventas se conserva y el producto {modal.item.estado === 'activo' ? 'dejará de aparecer en ventas nuevas' : 'volverá a aparecer en ventas nuevas'}.</p></Modal>;
  if (modal.type === 'charge-edit') return <Modal title="Editar cobro de suscripción" description={modal.item.detalle} onClose={close} onSubmit={async (event) => {
    event.preventDefault();
    const updated = await request(`/suscripciones/cobros/${modal.item._id}`, { method: 'PUT', body: JSON.stringify({ fecha: values.fecha, monto: Number(values.monto) }) });
    setData((current) => ({ ...current, gastos: current.gastos.map((row) => row._id === updated._id && row.origen === 'Suscripción' ? normalizeExpense({ ...row, ...updated, montoTotalOriginal: updated.monto, detalle: updated.nombre, origen: 'suscripcion' }) : row) }));
    close();
    notify('Cobro actualizado');
  }} submitLabel="Guardar cambios">
    <div className="form-grid"><Field label="Fecha del cobro" type="date" required value={values.fecha || todayInput()} onChange={(value) => set('fecha', value)} /><Field label="Monto (COP)" type="number" min="0" step="0.01" required value={values.monto} onChange={(value) => set('monto', value)} /></div>
  </Modal>;
  if (modal.type === 'catalog' || modal.type === 'catalog-edit') return <Modal title={modal.type === 'catalog' ? 'Añadir al catálogo' : 'Renombrar elemento'} onClose={close} onSubmit={async (event) => {
    event.preventDefault();
    const result = await request(`/catalogos/${modal.entity}${modal.item ? `/${modal.item._id}` : ''}`, { method: modal.item ? 'PUT' : 'POST', body: JSON.stringify({ nombre: values.nombre }) });
    setData((previous) => ({ ...previous, [modal.entity]: modal.item ? previous[modal.entity].map((row) => row._id === modal.item._id ? result : row) : [result, ...previous[modal.entity]] }));
    close(); notify('Catálogo actualizado');
  }}><Field label="Nombre" value={values.nombre || ''} onChange={(value) => set('nombre', value)} required /></Modal>;
  const type = modal.type.startsWith('sale') ? 'sale' : modal.type.startsWith('product') ? 'product' : modal.type.startsWith('expense') ? 'expense' : modal.type.startsWith('subscription') ? 'subscription' : 'long';
  const title = { sale: modal.item ? 'Editar venta' : 'Nueva venta', product: modal.item ? 'Editar producto' : 'Nuevo producto', expense: modal.item ? 'Editar gasto' : 'Nuevo gasto', subscription: 'Nueva suscripción', long: modal.item ? 'Editar gasto prolongado' : 'Nuevo gasto prolongado' }[type];
  const module = { sale: 'ventas', product: 'productos', expense: 'gastos', subscription: 'suscripciones', long: 'gastos-prolongados' }[type];
  const handleSubmit = async (event) => {
    event.preventDefault();
    if (type === 'sale') {
      const product = products.find((item) => item._id === values.productoId) || products[0];
      if (!product) return notify('Agrega primero un producto activo.');
      const sale = { nombre: values.nombre, productoId: product._id, productoNombre: product.nombre, precioUnitario: product.precio, cantidad: Number(values.cantidad), unidadesPorVenta: product.unidadesPorVenta || 1, fecha: values.fecha, valorEsperado: Number(values.valorEsperado), notas: values.notas || '' };
      if (!modal.item) Object.assign(sale, { estado: 'en_espera', costoFlete: 0 });
      else if (modal.item.estado === 'devuelta') sale.fechaDevolucion = values.fechaDevolucion || todayInput();
      await saveEntity(module, sale, modal.item?._id);
      return;
    }
    if (type === 'product') {
      await saveEntity(module, { nombre: values.nombre, precio: Number(values.precio), productoBaseId: values.productoBaseId || null, unidadesPorVenta: values.productoBaseId ? Number(values.unidadesPorVenta || 1) : 1, estado: values.estado || 'activo' }, modal.item?._id);
      return;
    }
    const category = categoryOptions.find((item) => item._id === values.categoriaId) || categoryOptions[0];
    const platform = platformOptions.find((item) => item._id === values.plataformaId) || platformOptions[0];
    if (type === 'expense') await saveEntity(module, { fecha: values.fecha, monto: Number(values.monto), categoriaId: category?._id || '', plataformaId: platform?._id || '', categoriaNombre: category?.nombre || 'Otros', plataformaNombre: platform?.nombre || 'Otros', detalle: values.detalle }, modal.item?._id);
    else if (type === 'subscription') await saveEntity(module, { nombre: values.nombre, valor: Number(values.valor), frecuencia: values.frecuencia, fechaInicio: values.fechaInicio, estado: 'activa', categoriaId: category?._id || '', plataformaId: platform?._id || '', categoriaNombre: category?.nombre || 'Otros', plataformaNombre: platform?.nombre || 'Otros' }, modal.item?._id);
    else await saveEntity(module, { fechaInicio: values.fechaInicio, fechaFin: values.fechaFin, monto: Number(values.monto), categoriaId: category?._id || '', plataformaId: platform?._id || '', categoriaNombre: category?.nombre || 'Otros', plataformaNombre: platform?.nombre || 'Otros', detalle: values.detalle }, modal.item?._id);
  };
  const activeProducts = products.filter((item) => item.estado === 'activo');
  return <Modal title={title} description={type === 'sale' ? 'Los campos marcados con * son obligatorios.' : 'Registra la información para mantener tu contabilidad al día.'} onClose={close} onSubmit={handleSubmit} submitLabel={modal.item ? 'Guardar cambios' : 'Guardar'}>
    <div className="form-grid">
      {type === 'sale' && <>
        <Field label="Cliente / referencia" required value={values.nombre || ''} onChange={(value) => set('nombre', value)} />
        <SelectField label="Producto" required value={values.productoId || activeProducts[0]?._id || ''} options={activeProducts.map((item) => [item._id, item.nombre])} onChange={(value) => set('productoId', value)} />
        <Field label="Pedidos" type="number" min="1" step="1" required value={values.cantidad || 1} onChange={(value) => set('cantidad', value)} hint="Normalmente 1. Las unidades salen del producto o paquete elegido (por ejemplo, x2 = 2 unidades)." />
        <div className="info-note full">Precio bruto del producto/paquete: <strong className="money">{money((activeProducts.find((item) => item._id === values.productoId)?.precio || 0) * Number(values.cantidad || 1))}</strong>. Se guarda separado de la utilidad neta esperada de la plataforma.</div>
        <Field label="Fecha de venta" type="date" required value={values.fecha || todayInput()} onChange={(value) => set('fecha', value)} />
        <Field label="Utilidad estimada de la plataforma (COP)" type="number" min="0" step="0.01" required value={values.valorEsperado} onChange={(value) => set('valorEsperado', value)} hint="Registra el monto que la plataforma indica que ganarás cuando el pedido sea entregado, después de producto y flete. No es el precio de venta." />
        {modal.item?.estado === 'devuelta' && <Field label="Fecha de devolución" type="date" required value={values.fechaDevolucion || todayInput()} onChange={(value) => set('fechaDevolucion', value)} hint="El flete de la devolución se resta en esta fecha." />}
        <Field label="Notas" value={values.notas || ''} onChange={(value) => set('notas', value)} />
      </>}
      {type === 'product' && <><Field label="Nombre del producto o paquete" required value={values.nombre || ''} onChange={(value) => set('nombre', value)} /><Field label="Precio total por pedido (COP)" required type="number" min="0" step="0.01" value={values.precio} onChange={(value) => set('precio', value)} /><SelectField label="Producto base" value={values.productoBaseId || ''} options={[['', 'Producto base (unidad individual)'], ...activeProducts.filter((item) => !item.productoBaseId && item._id !== modal.item?._id).map((item) => [item._id, item.nombre])]} onChange={(value) => set('productoBaseId', value)} />{values.productoBaseId && <Field label="Unidades del producto base por pedido" type="number" min="1" step="1" required value={values.unidadesPorVenta || 1} onChange={(value) => set('unidadesPorVenta', value)} hint="Ejemplo: paquete promocional de 2 unidades = 2." />}<SelectField label="Estado" value={values.estado || 'activo'} options={[['activo', 'Activo'], ['desactivado', 'Desactivado']]} onChange={(value) => set('estado', value)} /></>}
      {type === 'expense' && <><Field label="Detalle" required value={values.detalle || ''} onChange={(value) => set('detalle', value)} /><Field label="Fecha" type="date" required value={values.fecha || todayInput()} onChange={(value) => set('fecha', value)} /><Field label="Monto (COP)" type="number" min="0" step="0.01" required value={values.monto} onChange={(value) => set('monto', value)} /><SelectField label="Categoría" value={values.categoriaId || categoryOptions[0]?._id} options={categoryOptions.filter((item) => item.estado === 'activo').map((item) => [item._id, item.nombre])} onChange={(value) => set('categoriaId', value)} /><SelectField label="Plataforma" value={values.plataformaId || platformOptions[0]?._id} options={platformOptions.filter((item) => item.estado === 'activo').map((item) => [item._id, item.nombre])} onChange={(value) => set('plataformaId', value)} /></>}
      {type === 'subscription' && <><Field label="Nombre" required value={values.nombre || ''} onChange={(value) => set('nombre', value)} /><Field label="Valor por cobro (COP)" required type="number" min="0" step="0.01" value={values.valor} onChange={(value) => set('valor', value)} /><SelectField label="Frecuencia" value={values.frecuencia || 'mensual'} options={['semanal', 'quincenal', 'mensual', 'bimestral', 'trimestral', 'semestral', 'anual'].map((value) => [value, capitalize(value)])} onChange={(value) => set('frecuencia', value)} /><Field label="Fecha de inicio" type="date" value={values.fechaInicio || todayInput()} onChange={(value) => set('fechaInicio', value)} /><SelectField label="Categoría" value={values.categoriaId || categoryOptions[0]?._id} options={categoryOptions.map((item) => [item._id, item.nombre])} onChange={(value) => set('categoriaId', value)} /><SelectField label="Plataforma" value={values.plataformaId || platformOptions[0]?._id} options={platformOptions.map((item) => [item._id, item.nombre])} onChange={(value) => set('plataformaId', value)} /></>}
      {type === 'long' && <><Field label="Detalle" required value={values.detalle || ''} onChange={(value) => set('detalle', value)} /><div className="field full"><span>Atajos de fechas</span><div className="date-shortcuts">{[['Hoy', 0], ['Ayer', -1], ['Últimos 7 días', -6]].map(([label, offset]) => <button type="button" key={label} onClick={() => { const date = new Date(); date.setDate(date.getDate() + offset); const formatted = date.toLocaleDateString('en-CA'); set('fechaInicio', formatted); set('fechaFin', todayInput()); }}>{label}</button>)}</div></div><Field label="Fecha inicio" type="date" value={values.fechaInicio || todayInput()} onChange={(value) => set('fechaInicio', value)} /><Field label="Fecha fin" type="date" value={values.fechaFin || todayInput()} onChange={(value) => set('fechaFin', value)} /><Field label="Monto total (COP)" type="number" min="0" step="0.01" value={values.monto} onChange={(value) => set('monto', value)} /><SelectField label="Categoría" value={values.categoriaId || categoryOptions[0]?._id} options={categoryOptions.map((item) => [item._id, item.nombre])} onChange={(value) => set('categoriaId', value)} /><SelectField label="Plataforma" value={values.plataformaId || platformOptions[0]?._id} options={platformOptions.map((item) => [item._id, item.nombre])} onChange={(value) => set('plataformaId', value)} /><div className="split-preview full"><CalendarDays size={16} /><span>Vista previa del reparto</span><strong>{inclusiveDays(values.fechaInicio, values.fechaFin)} días · {money(Number(values.monto || 0) / inclusiveDays(values.fechaInicio, values.fechaFin))} / día</strong></div></>}
      {type === 'sale' && modal.item && <div className="field full"><button type="button" className="delete-link" onClick={async () => {
        if (!window.confirm('Eliminar esta venta reduce el esperado registrado. ¿Confirmas que fue un error de registro?')) return;
        try { await removeItem('ventas', modal.item); close(); } catch (error) { notify(error.message, 'error'); }
      }}>Eliminar registro de venta</button></div>}
    </div>
  </Modal>;
}

function Field({ label, value, onChange, type = 'text', required = false, hint, ...props }) {
  const step = props.step ?? (type === 'number' ? '0.01' : undefined);
  return <label className="field"><span>{label}{required && <b> *</b>}</span><input type={type} value={value ?? ''} onChange={(event) => onChange(event.target.value)} required={required} {...props} step={step} />{hint && <small>{hint}</small>}</label>;
}
function SelectField({ label, value, options, onChange, required = false }) {
  return <label className="field"><span>{label}{required && <b> *</b>}</span><DropdownSelect ariaLabel={label} className="field-select" value={value || ''} options={options} onChange={onChange} required={required} /></label>;
}

function inclusiveDays(start, end) {
  if (!start || !end) return 1;
  return Math.max(1, Math.floor((new Date(end) - new Date(start)) / 86400000) + 1);
}
function splitExpenseDays(amount, start, end) {
  const days = inclusiveDays(start, end);
  if (Number.isInteger(Number(amount))) {
    const daily = Math.floor(Number(amount) / days);
    return Array.from({ length: days }, (_, index) => daily + (index === days - 1 ? Number(amount) - daily * days : 0));
  }
  const totalCents = Math.round(Number(amount) * 100);
  const dailyCents = Math.floor(totalCents / days);
  return Array.from({ length: days }, (_, index) => (
    (dailyCents + (index === days - 1 ? totalCents - dailyCents * days : 0)) / 100
  ));
}
function capitalize(value = '') { return value.charAt(0).toLocaleUpperCase('es') + value.slice(1); }

function ReceiptIcon() { return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 3h14v18l-3-2-4 2-4-2-3 2V3Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /><path d="M9 8h6M9 12h6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>; }
function PackageIcon() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m12 3 9 5-9 5-9-5 9-5Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /><path d="M3 8v9l9 5 9-5V8M12 13v9" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /></svg>; }
function RefreshIcon() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /><path d="M6.1 9a6 6 0 0 1 10-2l3.9 5M4 12l3.9 5a6 6 0 0 0 10-2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>; }
function FolderIcon() { return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H10l2 2h7.5A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5v-11Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /></svg>; }
function SettingsIcon() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z" stroke="currentColor" strokeWidth="1.7" /><path d="m19.4 15 .1.1a1.7 1.7 0 0 1-2.4 2.4l-.1-.1a1.7 1.7 0 0 0-2.9 1.2v.2a1.7 1.7 0 0 1-3.4 0v-.2a1.7 1.7 0 0 0-2.9-1.2l-.1.1a1.7 1.7 0 0 1-2.4-2.4l.1-.1a1.7 1.7 0 0 0-1.2-2.9H4a1.7 1.7 0 0 1 0-3.4h.2a1.7 1.7 0 0 0 1.2-2.9l-.1-.1a1.7 1.7 0 0 1 2.4-2.4l.1.1a1.7 1.7 0 0 0 2.9-1.2V2a1.7 1.7 0 0 1 3.4 0v.2a1.7 1.7 0 0 0 2.9 1.2l.1-.1a1.7 1.7 0 0 1 2.4 2.4l-.1.1a1.7 1.7 0 0 0 1.2 2.9h.2a1.7 1.7 0 0 1 0 3.4h-.2a1.7 1.7 0 0 0-1.2 2.9Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" /></svg>; }

export default App;
