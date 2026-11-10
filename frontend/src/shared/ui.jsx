import React, { useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, ChevronDown, Search, X } from 'lucide-react';
import { money, percent, todayInput } from '../core/format.js';

export function Button({ children, variant = 'secondary', className = '', ...props }) {
  return <button className={`button button-${variant} ${className}`} {...props}>{children}</button>;
}

export function PageHeading({ eyebrow = 'SAFETRICS', title, description, action }) {
  return (
    <div className="page-heading">
      <div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1>{description && <p>{description}</p>}</div>
      {action && <div className="heading-actions">{action}</div>}
    </div>
  );
}

export function Card({ children, className = '', ...props }) {
  return <section className={`card ${className}`} {...props}>{children}</section>;
}

export function Kpi({ label, value, tone = 'blue', detail, icon: Icon, className = '' }) {
  return (
    <Card className={`kpi kpi-${tone} ${className}`}>
      <div className="kpi-top"><span>{label}</span>{Icon && <span className="kpi-icon"><Icon size={17} /></span>}</div>
      <strong className="money">{value}</strong>
      {detail && <small>{detail}</small>}
    </Card>
  );
}

const statusMap = {
  en_espera: ['status-wait', 'En espera'],
  pagada: ['status-paid', 'Pagada'],
  devuelta: ['status-returned', 'Devuelta'],
  cancelada: ['status-cancelled', 'Cancelada'],
  activa: ['status-paid', 'Activa'],
  inactiva: ['status-cancelled', 'Inactiva'],
  activo: ['status-paid', 'Activo'],
  desactivado: ['status-cancelled', 'Desactivado']
};

export function Status({ value }) {
  const [klass, label] = statusMap[value] || ['status-neutral', value || '—'];
  return <span className={`status ${klass}`}><i />{label}</span>;
}

export function Toolbar({ search, onSearch, children }) {
  return (
    <div className="toolbar">
      {onSearch && <label className="search-field"><Search size={15} /><input value={search || ''} onChange={(event) => onSearch(event.target.value)} placeholder="Buscar en esta pantalla" /></label>}
      {children}
    </div>
  );
}

export function Table({ columns, rows, empty = 'No hay registros para mostrar', onRowClick }) {
  return (
    <div className="table-scroll">
      <table>
        <thead><tr>{columns.map((column) => <th key={column.key} className={column.align === 'right' ? 'align-right' : ''}>{column.label}</th>)}</tr></thead>
        <tbody>
          {rows.length ? rows.map((row, index) => (
            <tr key={row._id || row.id || index} onClick={onRowClick ? () => onRowClick(row) : undefined} className={onRowClick ? 'clickable' : ''}>
              {columns.map((column) => <td key={column.key} className={`${column.align === 'right' ? 'align-right' : ''} ${column.className || ''}`}>{column.render ? column.render(row) : row[column.key] ?? '—'}</td>)}
            </tr>
          )) : <tr><td colSpan={columns.length} className="empty-cell">{empty}</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

export function usePagination(rows, resetKey, pageSize = 20) {
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [resetKey]);
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const current = Math.min(page, pages);
  const start = (current - 1) * pageSize;
  return { pageRows: rows.slice(start, start + pageSize), pager: { page: current, pages, start, end: Math.min(start + pageSize, rows.length), total: rows.length, setPage } };
}

export function Pagination({ page, pages, start, end, total, setPage, label = 'registros' }) {
  if (pages <= 1) return null;
  const numbers = [...new Set([1, page - 1, page, page + 1, pages])].filter((item) => item >= 1 && item <= pages).sort((a, b) => a - b);
  return (
    <nav className="pagination" aria-label={`Secciones de ${label}`}>
      <span className="pagination-info">{start + 1}–{end} de {total} {label}</span>
      <div className="pagination-buttons">
        <button type="button" disabled={page === 1} onClick={() => setPage(page - 1)}>Anterior</button>
        {numbers.map((item, index) => <React.Fragment key={item}>
          {index > 0 && item - numbers[index - 1] > 1 && <span className="pagination-gap">…</span>}
          <button type="button" className={item === page ? 'active' : ''} aria-current={item === page ? 'page' : undefined} onClick={() => setPage(item)}>{item}</button>
        </React.Fragment>)}
        <button type="button" disabled={page === pages} onClick={() => setPage(page + 1)}>Siguiente</button>
      </div>
    </nav>
  );
}

export function Modal({ title, description, children, onClose, onSubmit, submitLabel = 'Guardar', danger = false }) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [isClosing, setIsClosing] = useState(false);
  const closeTimer = useRef(null);
  const dialogRef = useRef(null);
  const previousFocus = useRef(null);

  useEffect(() => () => window.clearTimeout(closeTimer.current), []);

  useEffect(() => {
    previousFocus.current = document.activeElement;
    return () => {
      if (previousFocus.current instanceof HTMLElement && previousFocus.current.isConnected) previousFocus.current.focus();
    };
  }, []);

  useEffect(() => {
    const initialFocus = dialogRef.current?.querySelector('form input:not([disabled]), form select:not([disabled]), form textarea:not([disabled]), form button:not([disabled])')
      || dialogRef.current?.querySelector('button:not([disabled])');
    initialFocus?.focus();
    setIsClosing(false);
    setSubmitError('');
  }, [title]);

  const close = () => {
    if (isClosing || isSubmitting) return;
    setIsClosing(true);
    closeTimer.current = window.setTimeout(onClose, 180);
  };

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
        return;
      }
      if (event.key === 'Tab') {
        const focusable = Array.from(dialogRef.current?.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])') || []);
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const focusIsOutside = !dialogRef.current?.contains(document.activeElement);
        if (event.shiftKey && (document.activeElement === first || focusIsOutside)) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && (document.activeElement === last || focusIsOutside)) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });

  const submit = async (event) => {
    event.preventDefault();
    if (isSubmitting) return;
    setSubmitError('');
    setIsSubmitting(true);
    try {
      await onSubmit(event);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'No se pudo completar la operación.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className={`modal-backdrop ${isClosing ? 'closing' : ''}`} role="presentation" onMouseDown={(event) => event.target === event.currentTarget && close()}>
      <section ref={dialogRef} className={`modal ${isClosing ? 'closing' : ''}`} role="dialog" aria-modal="true" aria-label={title} aria-busy={isSubmitting}>
        <div className="modal-heading"><div><h2>{title}</h2>{description && <p>{description}</p>}</div><button type="button" className="icon-button" aria-label="Cerrar" onClick={close} disabled={isSubmitting}><X size={18} /></button></div>
        <form onSubmit={submit}>
          <div className="modal-body">{children}</div>
          {submitError && <p className="form-error" role="alert">{submitError}</p>}
          <div className="modal-actions"><Button type="button" onClick={close} disabled={isSubmitting}>Cancelar <span className="shortcut">Esc</span></Button><Button variant={danger ? 'danger' : 'primary'} type="submit" disabled={isSubmitting}>{isSubmitting ? 'Procesando…' : submitLabel}{!isSubmitting && <span className="shortcut">Enter</span>}</Button></div>
        </form>
      </section>
    </div>
  );
}

export function ExportButton({ module, disabled = false, filters = {} }) {
  const [open, setOpen] = useState(false);
  const exportRef = useRef(null);
  const exportUrl = (format) => {
    const currentParams = new URLSearchParams(window.location.search);
    const params = new URLSearchParams();
    ['desde', 'hasta'].forEach((key) => {
      const scopedKey = `${module}_${key}`;
      if (currentParams.has(scopedKey)) params.set(key, currentParams.get(scopedKey));
      else if (currentParams.has(key)) params.set(key, currentParams.get(key));
    });
    params.set('formato', format);
    Object.entries(filters).forEach(([key, value]) => {
      if (value && value !== 'Todos') params.set(key, value);
      else params.delete(key);
    });
    return `/api/exportacion/${module}?${params.toString()}`;
  };
  useEffect(() => {
    if (!open) return undefined;
    const closeOnOutsideClick = (event) => {
      if (!exportRef.current?.contains(event.target)) setOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);
  return <div className="export-wrap" ref={exportRef}>
    <Button
      type="button"
      disabled={disabled}
      aria-haspopup="menu"
      aria-expanded={open}
      onClick={() => setOpen((current) => !current)}
    ><ArrowDownToLine size={15} /> Exportar <ChevronDown size={14} /></Button>
    {open && <div className="export-popover" role="menu">
      <a role="menuitem" href={exportUrl('pdf')} onClick={() => setOpen(false)}>Descargar PDF</a>
      <a role="menuitem" href={exportUrl('xlsx')} onClick={() => setOpen(false)}>Descargar Excel</a>
    </div>}
  </div>;
}

export function CompleteReportButton() {
  const [open, setOpen] = useState(false);
  const [period, setPeriod] = useState('Hoy');
  const [dates, setDates] = useState({ desde: todayInput(), hasta: todayInput() });
  const reportRef = useRef(null);
  const today = todayInput();
  const selectedDate = new Date(`${today}T12:00:00.000Z`);
  const range = (() => {
    if (period === 'Día específico') return { desde: dates.desde, hasta: dates.desde };
    if (period === 'Personalizado') return dates;
    if (period === 'Esta semana') {
      const start = new Date(selectedDate);
      start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
      return { desde: start.toISOString().slice(0, 10), hasta: today };
    }
    if (period === 'Este mes') return { desde: `${today.slice(0, 7)}-01`, hasta: today };
    if (period === 'Este año') return { desde: `${today.slice(0, 4)}-01-01`, hasta: today };
    if (period === 'Ayer') {
      selectedDate.setUTCDate(selectedDate.getUTCDate() - 1);
      const yesterday = selectedDate.toISOString().slice(0, 10);
      return { desde: yesterday, hasta: yesterday };
    }
    return { desde: today, hasta: today };
  })();
  const validRange = range.desde && range.hasta && range.desde <= range.hasta;
  const close = () => setOpen(false);
  const reportUrl = (format) => {
    const params = new URLSearchParams({ desde: range.desde, hasta: range.hasta, formato: format });
    return `/api/exportacion/completo?${params.toString()}`;
  };
  useEffect(() => {
    if (!open) return undefined;
    const closeOnOutsideClick = (event) => {
      if (!reportRef.current?.contains(event.target)) setOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);
  return <div className="export-wrap" ref={reportRef}>
    <Button type="button" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
      <ArrowDownToLine size={15} /> Reporte completo
    </Button>
    {open && <div className="export-popover report-popover" role="dialog" aria-label="Exportar reporte financiero completo">
      <label className="field"><span>Periodo independiente</span><select value={period} onChange={(event) => setPeriod(event.target.value)}>
        {['Hoy', 'Ayer', 'Día específico', 'Esta semana', 'Este mes', 'Este año', 'Personalizado'].map((option) => <option key={option}>{option}</option>)}
      </select></label>
      {(period === 'Día específico' || period === 'Personalizado') && <div className="report-date-fields">
        <label className="field"><span>{period === 'Día específico' ? 'Fecha' : 'Desde'}</span><input type="date" value={dates.desde} max={period === 'Personalizado' ? dates.hasta || undefined : undefined} onChange={(event) => setDates((value) => ({ ...value, desde: event.target.value, ...(period === 'Día específico' ? { hasta: event.target.value } : {}) }))} /></label>
        {period === 'Personalizado' && <label className="field"><span>Hasta</span><input type="date" value={dates.hasta} min={dates.desde || undefined} onChange={(event) => setDates((value) => ({ ...value, hasta: event.target.value }))} /></label>}
      </div>}
      <div className="report-downloads">
        {validRange ? <><a role="menuitem" href={reportUrl('pdf')} onClick={close}>Descargar PDF · listo para imprimir</a><a role="menuitem" href={reportUrl('xlsx')} onClick={close}>Descargar Excel · una hoja por sección</a></> : <span className="report-invalid-range">Selecciona un rango de fechas válido.</span>}
      </div>
      <small>Este periodo no modifica los filtros ni la vista de la pantalla actual.</small>
    </div>}
  </div>;
}

export function ProgressRow({ label, amount, total, tone = 'blue' }) {
  const pct = total ? Math.min(100, Math.round(amount / total * 100)) : 0;
  return <div className="progress-row">
    <div><span>{label}</span><strong className="money">{money(amount)}</strong></div>
    <div className="progress-track" role="img" aria-label={`${label}: ${money(amount)}, ${percent(total ? amount / total : 0)} del total`} title={`${label}: ${money(amount)} · ${percent(total ? amount / total : 0)}`}>
      <i className={`progress-${tone}`} style={{ width: `${pct}%` }} />
    </div>
    <small>{percent(total ? amount / total : 0)}</small>
  </div>;
}
