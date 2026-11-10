import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { reportDates } from './full-report.js';


const colors = {
  navy: '#183b60', blue: '#2d669d', ink: '#102a43', muted: '#334e68', line: '#9fb3c8',
  soft: '#e8f1fa', zebra: '#f3f7fb', green: '#16692f', red: '#a8201a', amber: '#8a5300'
};
const argb = (hex) => `FF${hex.slice(1).toUpperCase()}`;
const { formatShort } = reportDates;

export const money = (value) => {
  const amount = Math.round(Number(value || 0));
  return `${amount < 0 ? '-' : ''}$ ${Math.abs(amount).toLocaleString('es-CO')}`;
};
const roundCost = (value) => Math.round(value * 100) / 100;
const count = (value) => Number(value || 0).toLocaleString('es-CO');
const percentText = (value) => `${(Number(value || 0) * 100).toLocaleString('es-CO', { maximumFractionDigits: 1 })} %`;
const plural = (value, one, many) => `${count(value)} ${Number(value) === 1 ? one : many}`;

function changeText(row) {
  if (row.diferencia === 0) return { text: 'Sin cambio', tone: 'muted' };
  const up = row.diferencia > 0;
  const good = up === row.mejorSiSube;
  const usePercent = row.tipo === 'money' && row.porcentaje != null && Math.abs(row.anterior) >= 1000 && Math.abs(row.porcentaje) <= 10;
  const amount = usePercent ? percentText(Math.abs(row.porcentaje)) : row.tipo === 'money' ? money(Math.abs(row.diferencia)) : count(Math.abs(row.diferencia));
  return { text: `${up ? 'Subió' : 'Bajó'} ${amount}`, tone: good ? 'green' : 'red' };
}

function detailSections(report) {
  const productRows = [];
  for (const group of report.productos) {
    productRows.push({ _style: 'group', producto: group.producto, pedidos: group.pedidos, unidades: group.unidades, ventaBruta: group.ventaBruta, ventaNeta: group.ventaNeta, costoProducto: roundCost(group.ventaNeta - group.ganancia), ganancia: group.ganancia });
    for (const variant of group.variantes) {
      productRows.push({
        producto: `   ${variant.producto} · ${plural(variant.unidadesPorPedido, 'unidad', 'unidades')} · ${money(variant.precio)}`,
        pedidos: variant.pedidos, unidades: variant.unidades, ventaBruta: variant.ventaBruta, ventaNeta: variant.ventaNeta, costoProducto: roundCost(variant.ventaNeta - variant.ganancia), ganancia: variant.ganancia
      });
    }
  }
  const productTotal = report.actual.vendidos;
  const netSales = report.actual.ventas;
  if (productRows.length) productRows.push({ _style: 'total', producto: 'Total vendido', pedidos: productTotal.pedidos, unidades: productTotal.unidades, ventaBruta: productTotal.ventaBruta, ventaNeta: netSales.ventaNeta, costoProducto: netSales.costoProducto, ganancia: netSales.ganancia });

  const devolutions = report.devoluciones.lista;
  const sections = [
    {
      id: 'productos', sheet: 'Ventas por producto', title: 'Ventas por producto',
      note: 'Pedidos creados en el periodo (sin cancelados). Venta bruta = suma de los precios; venta neta, costo producto y utilidad esperada no cuentan los devueltos. Costo producto = venta neta - utilidad esperada (lo que la plataforma descuenta por producto y envío).',
      columns: [
        { key: 'producto', label: 'Producto / presentación', width: 150 },
        { key: 'pedidos', label: 'Pedidos', width: 64, kind: 'number' },
        { key: 'unidades', label: 'Unidades', width: 76, kind: 'number' },
        { key: 'ventaBruta', label: 'Venta bruta', width: 80, kind: 'money' },
        { key: 'ventaNeta', label: 'Venta neta', width: 80, kind: 'money' },
        { key: 'costoProducto', label: 'Costo producto', width: 80, kind: 'money' },
        { key: 'ganancia', label: 'Utilidad esperada', width: 80, kind: 'money' }
      ],
      rows: productRows,
      empty: 'No se crearon pedidos en este periodo.'
    },
    {
      id: 'pagos', sheet: 'Pagos recibidos', title: 'Pagos recibidos de la plataforma',
      note: `${plural(report.actual.recibido.pagos, 'pago', 'pagos')} por ${money(report.actual.recibido.monto)}. Cada fila indica de qué pedido viene el pago y cuántos días tardó.`,
      columns: [
        { key: 'fechaPago', label: 'Pagado el', width: 72, kind: 'date' },
        { key: 'fechaVenta', label: 'Pedido del', width: 72, kind: 'date' },
        { key: 'cliente', label: 'Cliente', width: 132 },
        { key: 'producto', label: 'Producto', width: 118 },
        { key: 'diasEnLlegar', label: 'Días', width: 50, kind: 'number' },
        { key: 'recibido', label: 'Recibido', width: 88, kind: 'money' }
      ],
      rows: report.pagos.length ? [...report.pagos, { _style: 'total', cliente: 'Total recibido', recibido: report.actual.recibido.monto }] : [],
      empty: 'No llegaron pagos de la plataforma en este periodo.'
    },
    {
      id: 'devoluciones', sheet: 'Devoluciones', title: 'Devoluciones',
      note: devolutions.length
        ? `${plural(devolutions.length, 'devolución', 'devoluciones')} · fletes cobrados ${money(report.actual.devoluciones.fletes)} · ${percentText(report.devoluciones.tasa)} de los pedidos cerrados en el periodo (pagados + devueltos).`
        : '',
      columns: [
        { key: 'fechaDevolucion', label: 'Devuelto el', width: 72, kind: 'date' },
        { key: 'fechaVenta', label: 'Pedido del', width: 72, kind: 'date' },
        { key: 'cliente', label: 'Cliente', width: 126 },
        { key: 'producto', label: 'Producto', width: 110 },
        { key: 'utilidadEsperada', label: 'Utilidad que no llegó', width: 76, kind: 'money' },
        { key: 'flete', label: 'Flete cobrado', width: 76, kind: 'money' }
      ],
      rows: devolutions.length ? [...devolutions, { _style: 'total', cliente: 'Total devoluciones', utilidadEsperada: report.actual.devoluciones.utilidadPerdida, flete: report.actual.devoluciones.fletes }] : [],
      empty: 'No hubo devoluciones en este periodo.'
    },
    {
      id: 'gastos', sheet: 'Gastos', title: 'Gastos del periodo',
      note: 'Las suscripciones se reparten por día entre un cobro y el siguiente; los gastos de varios días se reparten en su rango. "Asignado" es la parte que corresponde a este periodo.',
      columns: [
        { key: 'grupo', label: 'Tipo', width: 92 },
        { key: 'concepto', label: 'Concepto', width: 150 },
        { key: 'categoria', label: 'Categoría', width: 104 },
        { key: 'monto', label: 'Asignado', width: 90, kind: 'money' },
        { key: 'total', label: 'Valor total', width: 96, kind: 'money' }
      ],
      rows: report.gastos.length ? [
        ...report.gastos,
        { _style: 'total', concepto: 'Suscripciones', monto: report.actual.gastos.suscripciones },
        { _style: 'total', concepto: 'Publicidad y otros', monto: report.actual.gastos.otros }
      ] : [],
      empty: 'No hay gastos asignados a este periodo.'
    },
    {
      id: 'porLlegar', sheet: 'Por entregar a cliente', title: `Pendiente por entregar a cliente al ${formatShort(report.porLlegar.fecha)}`,
      note: `${plural(report.porLlegar.pedidos, 'pedido', 'pedidos')} en espera por ${money(report.porLlegar.monto)}. ${report.porLlegar.vencidos ? `${plural(report.porLlegar.vencidos, 'pedido supera', 'pedidos superan')} ${report.diasAlerta} días: revisar.` : `Ninguno supera ${report.diasAlerta} días.`}`,
      columns: [
        { key: 'fechaVenta', label: 'Pedido del', width: 76, kind: 'date' },
        { key: 'cliente', label: 'Cliente', width: 150 },
        { key: 'producto', label: 'Producto', width: 128 },
        { key: 'diasEsperando', label: 'Días esperando', width: 76, kind: 'number', alert: report.diasAlerta },
        { key: 'utilidadEsperada', label: 'Utilidad esperada', width: 102, kind: 'money' }
      ],
      rows: report.porLlegar.lista.length ? [...report.porLlegar.lista, { _style: 'total', cliente: 'Total por entregar a cliente', utilidadEsperada: report.porLlegar.monto }] : [],
      empty: 'No hay pedidos en espera.'
    }
  ];
  if (report.evolucion.granularidad) {
    sections.push({
      id: 'evolucion', sheet: 'Evolución', title: `Evolución ${report.evolucion.granularidad}`,
      note: 'Cómo se movió cada indicador dentro del periodo. Neto = recibido - gastos (suscripciones, otros y fletes).',
      columns: [
        { key: 'periodo', label: 'Periodo', width: 112 },
        { key: 'pedidos', label: 'Pedidos', width: 60, kind: 'number' },
        { key: 'utilidadEsperada', label: 'Utilidad esperada', width: 90, kind: 'money' },
        { key: 'recibido', label: 'Recibido', width: 90, kind: 'money' },
        { key: 'gastos', label: 'Gastos', width: 90, kind: 'money' },
        { key: 'neto', label: 'Neto', width: 90, kind: 'money', signed: true }
      ],
      rows: report.evolucion.filas,
      empty: ''
    });
  }
  sections.push({
    id: 'pedidos', sheet: 'Pedidos', title: 'Detalle de pedidos del periodo',
    note: 'Todos los pedidos creados en el periodo con su estado actual.',
    columns: [
      { key: 'fechaVenta', label: 'Fecha', width: 66, kind: 'date' },
      { key: 'cliente', label: 'Cliente', width: 112 },
      { key: 'producto', label: 'Producto', width: 108 },
      { key: 'unidades', label: 'Und.', width: 36, kind: 'number' },
      { key: 'ventaBruta', label: 'Venta bruta', width: 74, kind: 'money' },
      { key: 'utilidadEsperada', label: 'Utilidad esp.', width: 74, kind: 'money' },
      { key: 'estado', label: 'Estado', width: 62 }
    ],
    rows: report.pedidos,
    empty: 'No se crearon pedidos en este periodo.'
  });
  return sections;
}

const cellText = (column, value) => {
  if (value == null || value === '') return '';
  if (column.kind === 'money') return money(value);
  if (column.kind === 'number') return count(value);
  if (column.kind === 'date') return formatShort(value);
  return String(value);
};

const resultLines = (period) => [
  ['Recibido de la plataforma', period.recibido.monto, '+'],
  ['Suscripciones (repartidas por día)', period.gastos.suscripciones, '-'],
  ['Publicidad y otros gastos', period.gastos.otros, '-'],
  ['Fletes de devoluciones', period.gastos.fletes, '-']
];

const headlineCards = (report) => {
  const sold = report.actual.ventas;
  const received = report.actual.recibido;
  const pending = report.porLlegar;
  return [
    {
      label: 'Vendido (neto por entregar)', value: money(sold.ganancia), tone: 'blue',
      detail: `${plural(sold.pedidosNetos, 'pedido', 'pedidos')} · ${plural(sold.unidades, 'unidad', 'unidades')} · venta neta ${money(sold.ventaNeta)} - costo producto ${money(sold.costoProducto)}${sold.estados.devuelta.pedidos ? ` · ${plural(sold.estados.devuelta.pedidos, 'devuelto no cuenta', 'devueltos no cuentan')}` : ''}`
    },
    {
      label: 'Recibido de la plataforma', value: money(received.monto), tone: 'green',
      detail: received.pagos
        ? `${plural(received.pagos, 'pago', 'pagos')} de pedidos del ${[...new Set(report.pagos.map((item) => formatShort(item.fechaVenta).slice(0, 5)))].join(', ')}`
        : 'No llegaron pagos en este periodo'
    },
    {
      label: `Por entregar a cliente (al ${formatShort(pending.fecha)})`, value: money(pending.monto), tone: 'amber',
      detail: `${plural(pending.pedidos, 'pedido', 'pedidos')} en espera${pending.pedidos ? ` · el más antiguo lleva ${plural(pending.masAntiguoDias, 'día', 'días')}` : ''}${pending.vencidos ? ` · ${count(pending.vencidos)} con más de ${report.diasAlerta} días` : ''}`
    }
  ];
};

const sidebarLines = (month) => [
  ['Venta neta', month.ventas.ventaNeta, 'navy'],
  ['Costo producto', month.ventas.costoProducto, 'red'],
  ['Gasto en suscripciones', month.gastos.suscripciones, 'red'],
  ['Publicidad y otros gastos', month.gastos.otros, 'red'],
  ['Fletes de devoluciones', month.gastos.fletes, 'red'],
  ['Gastos totales', month.gastos.total, 'red'],
  ['Costo total', month.costoTotal, 'red'],
  ['Ganancia esperada', month.esperada, month.esperada < 0 ? 'red' : 'blue', true],
  ['Recibido de la plataforma', month.recibido.monto, 'green']
];

export function createFullReportPdf(report) {
  const doc = new PDFDocument({ size: 'LETTER', layout: 'portrait', margin: 40, bufferPages: true, info: { Title: `Safetrics · ${report.titulo}`, Author: 'Safetrics' } });
  const chunks = [];
  const output = new Promise((resolve, reject) => {
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  const margin = 40;
  const pageWidth = doc.page.width;
  const contentWidth = pageWidth - margin * 2;
  const bottom = doc.page.height - margin - 26;
  const tone = (name) => colors[name] || colors.ink;
  let y = 0;

  const pageHeader = (first) => {
    const height = first ? 70 : 40;
    doc.rect(margin, margin - 12, contentWidth, height).fill(colors.navy);
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(first ? 20 : 13)
      .text(`Safetrics · ${report.titulo}`, margin + 14, margin - 12 + (first ? 12 : 13), { width: contentWidth - 28, lineBreak: false });
    if (first) doc.font('Helvetica').fontSize(13).text(report.periodoTexto, margin + 14, margin + 24, { width: contentWidth - 28, lineBreak: false });
    else doc.font('Helvetica').fontSize(11).text(report.periodoTexto, margin + 14, margin + 1, { width: contentWidth - 28, align: 'right', lineBreak: false });
    y = margin - 12 + height + 16;
  };
  const newPage = () => { doc.addPage(); pageHeader(false); };
  const ensure = (height) => { if (y + height > bottom) newPage(); };

  const table = (x, width, columns, rows, { fontSize = 11, rowPad = 9, minRow = 22 } = {}) => {
    const textTop = Math.round(rowPad / 2) + 1;
    const scale = width / columns.reduce((total, column) => total + column.width, 0);
    const widths = columns.map((column) => column.width * scale);
    const pad = 5;
    const drawHead = () => {
      doc.font('Helvetica-Bold').fontSize(fontSize - 0.5);
      const height = Math.max(24, ...columns.map((column, index) => doc.heightOfString(column.label, { width: widths[index] - pad * 2 }) + 10));
      doc.rect(x, y, width, height).fill(colors.blue);
      let cx = x;
      columns.forEach((column, index) => {
        doc.fillColor('#ffffff').text(column.label, cx + pad, y + 5, { width: widths[index] - pad * 2, align: column.kind && column.kind !== 'date' ? 'right' : 'left' });
        cx += widths[index];
      });
      y += height;
    };
    drawHead();
    rows.forEach((row, rowIndex) => {
      const strong = row._style === 'group' || row._style === 'total';
      doc.font(strong ? 'Helvetica-Bold' : 'Helvetica').fontSize(fontSize);
      const texts = columns.map((column) => (row._text?.[column.key] ?? cellText(column, row[column.key])));
      const height = Math.max(minRow, ...texts.map((text, index) => doc.heightOfString(text, { width: widths[index] - pad * 2 }) + rowPad));
      if (y + height > bottom) { newPage(); drawHead(); doc.font(strong ? 'Helvetica-Bold' : 'Helvetica').fontSize(fontSize); }
      if (row._style === 'group') doc.rect(x, y, width, height).fill(colors.soft);
      else if (rowIndex % 2 === 1 && row._style !== 'total') doc.rect(x, y, width, height).fill(colors.zebra);
      if (row._style === 'total') doc.moveTo(x, y).lineTo(x + width, y).lineWidth(1.2).strokeColor(colors.navy).stroke();
      let cx = x;
      columns.forEach((column, index) => {
        let color = colors.ink;
        if (row._tone?.[column.key]) color = tone(row._tone[column.key]);
        else if (column.signed && Number(row[column.key]) < 0) color = colors.red;
        else if (column.alert != null && Number(row[column.key]) > column.alert) color = colors.red;
        doc.fillColor(color).text(texts[index], cx + pad, y + textTop, { width: widths[index] - pad * 2, align: column.kind && column.kind !== 'date' ? 'right' : 'left' });
        cx += widths[index];
      });
      y += height;
    });
    doc.moveTo(x, y).lineTo(x + width, y).lineWidth(0.6).strokeColor(colors.line).stroke();
  };

  pageHeader(true);
  const top = y;
  const sideWidth = 168;
  const gap = 16;
  const mainWidth = contentWidth - sideWidth - gap;
  const sideX = margin + mainWidth + gap;

  for (const card of headlineCards(report)) {
    doc.font('Helvetica').fontSize(11);
    const detailHeight = doc.heightOfString(card.detail, { width: mainWidth - 28 });
    const height = 64 + detailHeight;
    doc.rect(margin, y, mainWidth, height).fill(colors.zebra);
    doc.rect(margin, y, 6, height).fill(tone(card.tone));
    doc.fillColor(colors.muted).font('Helvetica-Bold').fontSize(11).text(card.label.toUpperCase(), margin + 18, y + 10, { width: mainWidth - 28, lineBreak: false });
    doc.fillColor(tone(card.tone)).font('Helvetica-Bold').fontSize(26).text(card.value, margin + 18, y + 26, { width: mainWidth - 28, lineBreak: false });
    doc.fillColor(colors.ink).font('Helvetica').fontSize(11).text(card.detail, margin + 18, y + 57, { width: mainWidth - 28 });
    y += height + 8;
  }

  y += 2;
  doc.fillColor(colors.navy).font('Helvetica-Bold').fontSize(14).text('Resultado del periodo', margin, y);
  y += 22;
  for (const [label, amount, sign] of resultLines(report.actual)) {
    doc.fillColor(colors.ink).font('Helvetica').fontSize(12).text(`${sign === '+' ? '(+)' : '(-)'}  ${label}`, margin, y, { width: mainWidth - 120, lineBreak: false });
    doc.fillColor(sign === '+' ? colors.green : colors.red).font('Helvetica-Bold').text(money(amount), margin + mainWidth - 130, y, { width: 130, align: 'right', lineBreak: false });
    y += 20;
  }
  doc.moveTo(margin, y + 2).lineTo(margin + mainWidth, y + 2).lineWidth(1.5).strokeColor(colors.navy).stroke();
  y += 9;
  const netColor = report.actual.neto < 0 ? colors.red : colors.green;
  doc.fillColor(colors.ink).font('Helvetica-Bold').fontSize(15).text('(=)  Utilidad neta', margin, y + 3, { lineBreak: false });
  doc.fillColor(netColor).fontSize(20).text(money(report.actual.neto), margin + mainWidth - 200, y, { width: 200, align: 'right', lineBreak: false });
  y += 32;

  doc.fillColor(colors.navy).font('Helvetica-Bold').fontSize(14).text('Comparado con el periodo anterior', margin, y);
  y += 18;
  doc.fillColor(colors.muted).font('Helvetica').fontSize(11).text(report.anterior.etiqueta, margin, y, { width: mainWidth });
  y += 16;
  table(margin, mainWidth, [
    { key: 'indicador', label: 'Indicador', width: 114 },
    { key: 'actual', label: 'Este periodo', width: 76, kind: 'text' },
    { key: 'anterior', label: 'Anterior', width: 70, kind: 'text' },
    { key: 'cambio', label: 'Cambio', width: 108 }
  ], report.comparacion.map((row) => {
    const delta = changeText(row);
    const format = row.tipo === 'money' ? money : count;
    return { indicador: row.indicador, _text: { actual: format(row.actual), anterior: format(row.anterior), cambio: delta.text }, _tone: { cambio: delta.tone } };
  }), { fontSize: 10.5, rowPad: 6, minRow: 19 });
  const mainBottom = y;

  y = top;
  const sideTop = top;
  let sy = sideTop + 12;
  const sidePad = 12;
  const sideInner = sideWidth - sidePad * 2;
  const sideOps = [];
  const sideTitle = sy;
  sideOps.push(() => doc.fillColor(colors.navy).font('Helvetica-Bold').fontSize(12).text('ACUMULADO DEL MES', sideX + sidePad, sideTitle, { width: sideInner }));
  sy += 18;
  const monthTitle = sy;
  sideOps.push(() => doc.fillColor(colors.ink).font('Helvetica-Bold').fontSize(14).text(report.mes.etiqueta, sideX + sidePad, monthTitle, { width: sideInner }));
  sy += 19;
  const monthRange = sy;
  sideOps.push(() => doc.fillColor(colors.muted).font('Helvetica').fontSize(11).text(report.mes.rango, sideX + sidePad, monthRange, { width: sideInner }));
  sy += 24;
  for (const [label, amount, lineTone, strong] of sidebarLines(report.mes)) {
    if (strong) {
      const lineY = sy - 4;
      sideOps.push(() => doc.moveTo(sideX + sidePad, lineY).lineTo(sideX + sideWidth - sidePad, lineY).lineWidth(1.2).strokeColor(colors.navy).stroke());
      sy += 4;
    }
    const labelY = sy;
    sideOps.push(() => {
      doc.fillColor(strong ? colors.ink : colors.muted).font(strong ? 'Helvetica-Bold' : 'Helvetica').fontSize(11).text(label, sideX + sidePad, labelY, { width: sideInner });
      doc.fillColor(tone(lineTone)).font('Helvetica-Bold').fontSize(16).text(money(amount), sideX + sidePad, labelY + 14, { width: sideInner, lineBreak: false });
    });
    sy += 38;
  }
  const dividerY = sy;
  sideOps.push(() => doc.moveTo(sideX + sidePad, dividerY).lineTo(sideX + sideWidth - sidePad, dividerY).lineWidth(1.2).strokeColor(colors.navy).stroke());
  sy += 10;
  const netY = sy;
  sideOps.push(() => {
    doc.fillColor(colors.ink).font('Helvetica-Bold').fontSize(12).text('Utilidad neta del mes', sideX + sidePad, netY, { width: sideInner });
    doc.fillColor(report.mes.neto < 0 ? colors.red : colors.green).fontSize(20).text(money(report.mes.neto), sideX + sidePad, netY + 16, { width: sideInner, lineBreak: false });
  });
  sy += 50;
  for (const [label, value] of [
    ['Pedidos vendidos', `${count(report.mes.ventas.pedidosNetos)} · ${plural(report.mes.ventas.unidades, 'unidad', 'unidades')}`],
    ['Devoluciones', count(report.mes.devoluciones.cantidad)]
  ]) {
    const lineY = sy;
    sideOps.push(() => {
      doc.fillColor(colors.muted).font('Helvetica').fontSize(11).text(label, sideX + sidePad, lineY, { width: sideInner });
      doc.fillColor(colors.ink).font('Helvetica-Bold').fontSize(12).text(value, sideX + sidePad, lineY + 13, { width: sideInner, lineBreak: false });
    });
    sy += 33;
  }
  sy += 4;
  const pagesAfterMain = doc.bufferedPageRange().count;
  const mainFitsFirstPage = pagesAfterMain === 1;
  doc.switchToPage(0);
  doc.rect(sideX, sideTop, sideWidth, (mainFitsFirstPage ? Math.max(sy, mainBottom) : sy) - sideTop).fill(colors.soft);
  doc.rect(sideX, sideTop, sideWidth, 4).fill(colors.navy);
  sideOps.forEach((draw) => draw());
  doc.switchToPage(pagesAfterMain - 1);
  y = (mainFitsFirstPage ? Math.max(sy, mainBottom) : mainBottom) + 20;

  for (const section of detailSections(report)) {
    doc.font('Helvetica').fontSize(11);
    const noteHeight = section.note ? doc.heightOfString(section.note, { width: contentWidth }) : 0;
    ensure(30 + noteHeight + 24 + 44);
    doc.fillColor(colors.navy).font('Helvetica-Bold').fontSize(15).text(section.title, margin, y, { width: contentWidth });
    y += 22;
    if (section.note) {
      doc.fillColor(colors.muted).font('Helvetica').fontSize(11).text(section.note, margin, y, { width: contentWidth });
      y += noteHeight + 8;
    }
    if (section.rows.length) table(margin, contentWidth, section.columns, section.rows);
    else if (section.empty) {
      doc.fillColor(colors.ink).font('Helvetica-Oblique').fontSize(11.5).text(section.empty, margin, y);
      y += 18;
    }
    y += 22;
  }

  const range = doc.bufferedPageRange();
  const generated = new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' });
  for (let index = range.start; index < range.start + range.count; index += 1) {
    doc.switchToPage(index);
    const lineY = doc.page.height - margin - 18;
    doc.moveTo(margin, lineY).lineTo(pageWidth - margin, lineY).lineWidth(0.6).strokeColor(colors.line).stroke();
    doc.fillColor(colors.muted).font('Helvetica').fontSize(9.5)
      .text(`Generado ${generated}`, margin, lineY + 6, { width: contentWidth / 2, lineBreak: false })
      .text(`Página ${index + 1} de ${range.count}`, margin + contentWidth / 2, lineY + 6, { width: contentWidth / 2, align: 'right', lineBreak: false });
  }
  doc.end();
  return output;
}

const excelFormats = { money: '"$"#,##0;[Red]-"$"#,##0', number: '#,##0', date: 'dd/mm/yyyy' };
const solid = (hex) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb: argb(hex) } });
const excelDate = (key) => (key ? new Date(`${key}T00:00:00.000Z`) : null);
const printSetup = { paperSize: 1, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } };

function writeTitle(sheet, lastColumn, title, subtitle) {
  sheet.mergeCells(1, 1, 1, lastColumn);
  Object.assign(sheet.getCell(1, 1), { value: title, font: { size: 18, bold: true, color: { argb: 'FFFFFFFF' } }, fill: solid(colors.navy), alignment: { vertical: 'middle', indent: 1 } });
  sheet.getRow(1).height = 34;
  sheet.mergeCells(2, 1, 2, lastColumn);
  Object.assign(sheet.getCell(2, 1), { value: subtitle, font: { size: 13, color: { argb: argb(colors.ink) } }, alignment: { indent: 1 } });
  sheet.getRow(2).height = 22;
}

function writeSectionSheet(workbook, report, section) {
  const sheet = workbook.addWorksheet(section.sheet, { pageSetup: printSetup, properties: { defaultRowHeight: 20 } });
  const last = section.columns.length;
  writeTitle(sheet, last, section.title, `${report.titulo} · ${report.periodoTexto}`);
  sheet.mergeCells(3, 1, 3, last);
  Object.assign(sheet.getCell(3, 1), { value: section.note || '', font: { size: 11, color: { argb: argb(colors.muted) } }, alignment: { wrapText: true, vertical: 'top', indent: 1 } });
  sheet.getRow(3).height = section.note && section.note.length > 110 ? 46 : 24;
  const header = sheet.getRow(5);
  section.columns.forEach((column, index) => {
    const cell = header.getCell(index + 1);
    cell.value = column.label;
    cell.font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
    cell.fill = solid(colors.blue);
    cell.alignment = { vertical: 'middle', wrapText: true, horizontal: column.kind && column.kind !== 'date' ? 'right' : 'left' };
    sheet.getColumn(index + 1).width = Math.max(11, Math.round(column.width / 5.2));
  });
  header.height = 28;
  sheet.views = [{ state: 'frozen', ySplit: 5 }];
  sheet.pageSetup.printTitlesRow = '5:5';
  if (!section.rows.length) {
    sheet.mergeCells(6, 1, 6, last);
    Object.assign(sheet.getCell(6, 1), { value: section.empty || 'Sin datos.', font: { italic: true, size: 12 } });
    return;
  }
  section.rows.forEach((row, rowIndex) => {
    const excelRow = sheet.getRow(6 + rowIndex);
    const strong = row._style === 'group' || row._style === 'total';
    section.columns.forEach((column, index) => {
      const cell = excelRow.getCell(index + 1);
      const value = row[column.key];
      cell.value = value == null || value === '' ? null : column.kind === 'date' ? excelDate(value) : column.kind ? Number(value) : String(value).trim();
      if (column.kind) cell.numFmt = excelFormats[column.kind];
      const alert = column.alert != null && Number(value) > column.alert;
      cell.font = { size: 12, bold: strong, color: { argb: argb(alert ? colors.red : colors.ink) } };
      cell.alignment = { vertical: 'middle', wrapText: column.kind == null, horizontal: column.kind && column.kind !== 'date' ? 'right' : 'left', indent: row._style == null && index === 0 && section.id === 'productos' ? 2 : 0 };
      if (row._style === 'group') cell.fill = solid(colors.soft);
      else if (row._style === 'total') cell.border = { top: { style: 'medium', color: { argb: argb(colors.navy) } } };
      else if (rowIndex % 2 === 1) cell.fill = solid(colors.zebra);
    });
    excelRow.height = 22;
  });
  if (section.id !== 'productos' && section.id !== 'evolucion') {
    const dataRows = section.rows.filter((row) => !row._style).length;
    if (dataRows) sheet.autoFilter = { from: { row: 5, column: 1 }, to: { row: 5 + dataRows, column: last } };
  }
}

export async function createFullReportExcel(report) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Safetrics';
  workbook.created = new Date();
  workbook.title = `Safetrics · ${report.titulo}`;
  const sheet = workbook.addWorksheet('Informe', { pageSetup: { ...printSetup, fitToHeight: 1 }, properties: { defaultRowHeight: 20 } });
  [34, 20, 20, 30, 3, 30, 18].forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
  writeTitle(sheet, 7, `Safetrics · ${report.titulo}`, report.periodoTexto);
  sheet.getCell(3, 1).value = `Generado ${new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' })}`;
  sheet.getCell(3, 1).font = { size: 10, color: { argb: argb(colors.muted) } };

  const sectionHeader = (row, from, to, text) => {
    sheet.mergeCells(row, from, row, to);
    Object.assign(sheet.getCell(row, from), { value: text, font: { bold: true, size: 13, color: { argb: 'FFFFFFFF' } }, fill: solid(colors.blue), alignment: { vertical: 'middle', indent: 1 } });
    sheet.getRow(row).height = 24;
  };
  const moneyCell = (cell, value, hex, size = 13) => {
    Object.assign(cell, { value: Number(value || 0), numFmt: excelFormats.money, font: { bold: true, size, color: { argb: argb(hex) } }, alignment: { horizontal: 'right', vertical: 'middle' } });
  };

  let row = 5;
  sectionHeader(row, 1, 4, 'LO MÁS IMPORTANTE');
  for (const card of headlineCards(report)) {
    row += 1;
    Object.assign(sheet.getCell(row, 1), { value: card.label, font: { bold: true, size: 13, color: { argb: argb(colors.ink) } }, alignment: { vertical: 'middle', indent: 1 } });
    const amount = card.tone === 'blue' ? report.actual.ventas.ganancia : card.tone === 'green' ? report.actual.recibido.monto : report.porLlegar.monto;
    moneyCell(sheet.getCell(row, 2), amount, colors[card.tone], 16);
    sheet.mergeCells(row, 3, row, 4);
    Object.assign(sheet.getCell(row, 3), { value: card.detail, font: { size: 11, color: { argb: argb(colors.ink) } }, alignment: { wrapText: true, vertical: 'middle' } });
    for (let column = 1; column <= 4; column += 1) sheet.getCell(row, column).fill = solid(colors.zebra);
    sheet.getRow(row).height = 46;
  }

  row += 2;
  sectionHeader(row, 1, 4, 'RESULTADO DEL PERIODO');
  for (const [label, amount, sign] of resultLines(report.actual)) {
    row += 1;
    Object.assign(sheet.getCell(row, 1), { value: `${sign === '+' ? '(+)' : '(-)'}  ${label}`, font: { size: 12 }, alignment: { indent: 1 } });
    moneyCell(sheet.getCell(row, 2), amount, sign === '+' ? colors.green : colors.red, 12);
  }
  row += 1;
  Object.assign(sheet.getCell(row, 1), { value: '(=)  Utilidad neta', font: { bold: true, size: 14 }, alignment: { indent: 1 }, border: { top: { style: 'medium', color: { argb: argb(colors.navy) } } } });
  moneyCell(sheet.getCell(row, 2), report.actual.neto, report.actual.neto < 0 ? colors.red : colors.green, 15);
  sheet.getCell(row, 2).border = { top: { style: 'medium', color: { argb: argb(colors.navy) } } };
  sheet.getRow(row).height = 26;

  row += 2;
  sectionHeader(row, 1, 4, 'COMPARADO CON EL PERIODO ANTERIOR');
  row += 1;
  sheet.mergeCells(row, 1, row, 4);
  Object.assign(sheet.getCell(row, 1), { value: report.anterior.etiqueta, font: { size: 11, color: { argb: argb(colors.muted) } }, alignment: { indent: 1 } });
  row += 1;
  ['Indicador', 'Este periodo', 'Anterior', 'Cambio'].forEach((label, index) => {
    Object.assign(sheet.getCell(row, index + 1), { value: label, font: { bold: true, size: 12 }, fill: solid(colors.soft), alignment: { horizontal: index === 0 || index === 3 ? 'left' : 'right', indent: index === 0 ? 1 : 0 } });
  });
  for (const item of report.comparacion) {
    row += 1;
    const delta = changeText(item);
    const format = item.tipo === 'money' ? excelFormats.money : excelFormats.number;
    Object.assign(sheet.getCell(row, 1), { value: item.indicador, font: { size: 12 }, alignment: { indent: 1 } });
    Object.assign(sheet.getCell(row, 2), { value: item.actual, numFmt: format, font: { size: 12, bold: true } });
    Object.assign(sheet.getCell(row, 3), { value: item.anterior, numFmt: format, font: { size: 12 } });
    Object.assign(sheet.getCell(row, 4), { value: delta.text, font: { size: 12, bold: true, color: { argb: argb(colors[delta.tone] || colors.ink) } } });
  }

  let side = 5;
  sectionHeader(side, 6, 7, 'ACUMULADO DEL MES');
  side += 1;
  sheet.mergeCells(side, 6, side, 7);
  Object.assign(sheet.getCell(side, 6), { value: `${report.mes.etiqueta} · ${report.mes.rango}`, font: { bold: true, size: 12 }, alignment: { indent: 1, wrapText: true } });
  for (const [label, amount, lineTone, strong] of sidebarLines(report.mes)) {
    side += 1;
    Object.assign(sheet.getCell(side, 6), { value: label, font: { size: 12, bold: Boolean(strong) }, alignment: { indent: 1 } });
    moneyCell(sheet.getCell(side, 7), amount, colors[lineTone], 13);
    if (strong) for (const column of [6, 7]) sheet.getCell(side, column).border = { top: { style: 'medium', color: { argb: argb(colors.navy) } } };
  }
  side += 1;
  Object.assign(sheet.getCell(side, 6), { value: 'Utilidad neta del mes', font: { bold: true, size: 13 }, alignment: { indent: 1 }, border: { top: { style: 'medium', color: { argb: argb(colors.navy) } } } });
  moneyCell(sheet.getCell(side, 7), report.mes.neto, report.mes.neto < 0 ? colors.red : colors.green, 15);
  sheet.getCell(side, 7).border = { top: { style: 'medium', color: { argb: argb(colors.navy) } } };
  for (const [label, value, format] of [
    ['Pedidos vendidos', report.mes.ventas.pedidosNetos, excelFormats.number],
    ['Unidades vendidas', report.mes.ventas.unidades, excelFormats.number],
    ['Devoluciones', report.mes.devoluciones.cantidad, excelFormats.number]
  ]) {
    side += 1;
    Object.assign(sheet.getCell(side, 6), { value: label, font: { size: 11, color: { argb: argb(colors.muted) } }, alignment: { indent: 1 } });
    Object.assign(sheet.getCell(side, 7), { value, numFmt: format, font: { size: 12 }, alignment: { horizontal: 'right' } });
  }
  for (let line = 6; line <= side; line += 1) {
    for (const column of [6, 7]) if (!sheet.getCell(line, column).fill) sheet.getCell(line, column).fill = solid(colors.soft);
  }

  for (const section of detailSections(report)) writeSectionSheet(workbook, report, section);
  return workbook.xlsx.writeBuffer();
}
