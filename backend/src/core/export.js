import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';

const moneyFormat = '"$"#,##0.00;[Red]-"$"#,##0.00';
const reportDefinitions = {
  productos: {
    title: 'Catálogo de productos',
    columns: [
      ['nombre', 'Producto / paquete'], ['productoBaseNombre', 'Producto base'],
      ['unidadesPorVenta', 'Unidades por pedido', 'number'], ['precio', 'Precio por pedido', 'money'],
      ['pedidosGenerados', 'Pedidos generados', 'number'], ['unidadesVendidas', 'Unidades vendidas', 'number'],
      ['estado', 'Estado']
    ]
  },
  ventas: {
    title: 'Registro de ventas',
    columns: [
      ['fecha', 'Fecha', 'date'], ['nombre', 'Cliente / referencia'], ['productoNombre', 'Producto'],
      ['cantidad', 'Pedidos', 'number'], ['unidadesVendidas', 'Unidades', 'number'],
      ['valorVentaBruto', 'Venta bruta', 'money'], ['valorEsperado', 'Utilidad estimada', 'money'],
      ['valorReal', 'Utilidad recibida', 'money'], ['estado', 'Estado'], ['fechaPago', 'Fecha de pago', 'date'],
      ['costoFlete', 'Costo de flete', 'money'], ['fechaDevolucion', 'Fecha de devolución', 'date']
    ]
  },
  gastos: {
    title: 'Registro de gastos',
    columns: [
      ['fecha', 'Fecha', 'date'], ['fechaInicio', 'Inicio del periodo', 'date'],
      ['fechaFin', 'Fin del periodo', 'date'], ['detalle', 'Detalle'], ['categoriaNombre', 'Categoría'],
      ['plataformaNombre', 'Plataforma'], ['origen', 'Origen'], ['monto', 'Asignado al periodo', 'money'],
      ['montoTotalOriginal', 'Monto total original', 'money']
    ],
    totalKey: 'monto'
  },
  suscripciones: {
    title: 'Suscripciones',
    columns: [
      ['nombre', 'Suscripción'], ['valor', 'Valor por cobro', 'money'], ['frecuencia', 'Frecuencia'],
      ['fechaInicio', 'Fecha de inicio', 'date'], ['estado', 'Estado'],
      ['categoriaNombre', 'Categoría'], ['plataformaNombre', 'Plataforma']
    ]
  },
  'gastos-prolongados': {
    title: 'Gastos prolongados',
    columns: [
      ['detalle', 'Detalle'], ['fechaInicio', 'Fecha de inicio', 'date'], ['fechaFin', 'Fecha de fin', 'date'],
      ['categoriaNombre', 'Categoría'], ['plataformaNombre', 'Plataforma'], ['monto', 'Monto total', 'money']
    ],
    totalKey: 'monto'
  },
  resumen: {
    title: 'Resumen financiero',
    columns: [
      ['grupo', 'Sección'], ['periodo', 'Periodo'], ['concepto', 'Indicador'],
      ['monto', 'Valor', 'money'], ['porcentaje', 'Porcentaje', 'percent'], ['cantidad', 'Cantidad', 'number']
    ]
  },
  comparativas: {
    title: 'Reporte de comparativas',
    columns: [
      ['grupo', 'Sección'], ['periodo', 'Periodo'], ['concepto', 'Indicador'],
      ['monto', 'Valor', 'money'], ['porcentaje', 'Porcentaje', 'percent'], ['cantidad', 'Cantidad', 'number']
    ]
  }
};

const formatDate = (value) => {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString('es-CO', { timeZone: 'UTC' });
};

const formatPeriod = (filters = {}) => {
  const { desde, hasta } = filters;
  if (desde && hasta) return `Periodo: ${formatDate(`${desde}T12:00:00Z`)} – ${formatDate(`${hasta}T12:00:00Z`)}`;
  if (desde) return `Desde: ${formatDate(`${desde}T12:00:00Z`)}`;
  if (hasta) return `Hasta: ${formatDate(`${hasta}T12:00:00Z`)}`;
  if (filters.meses) return `Meses: ${String(filters.meses).split(',').join(', ')}`;
  return 'Periodo: todos los registros disponibles';
};

const filterDescription = (filters = {}) => {
  const labels = [
    ['estado', 'Estado'], ['categoria', 'Categoría'], ['plataforma', 'Plataforma'],
    ['producto', 'Producto'], ['origen', 'Origen'], ['texto', 'Búsqueda']
  ];
  return labels
    .filter(([key]) => filters[key] && filters[key] !== 'Todos')
    .map(([key, label]) => `${label}: ${filters[key]}`)
    .join(' · ');
};

function exportRows(moduleName, rows) {
  const definition = reportDefinitions[moduleName];
  return rows.map((row) => definition.columns.map(([key, , kind]) => {
    const value = row[key];
    if (value == null) return '';
    if (kind === 'date') return formatDate(value);
    if (kind === 'percent') return Number(value);
    if (kind === 'money' || kind === 'number') return Number(value);
    if (typeof value === 'object') return String(value);
    return value;
  }));
}

function summaryText(moduleName, rows) {
  const definition = reportDefinitions[moduleName];
  const currency = (amount) => amount.toLocaleString('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 2 });
  if (moduleName === 'resumen') return 'Indicadores financieros y desglose operativo del periodo';
  if (moduleName === 'ventas') {
    const expected = rows.reduce((sum, row) => sum + Number(row.valorEsperado || 0), 0);
    const collected = rows.reduce((sum, row) => sum + (row.estado === 'pagada' ? Number(row.valorReal ?? row.valorEsperado ?? 0) : 0), 0);
    return `Registros: ${rows.length}   ·   Esperado: ${currency(expected)}   ·   Cobrado: ${currency(collected)}`;
  }
  if (moduleName === 'gastos' && rows.some((row) => row.montoTotalOriginal != null)) {
    const assigned = rows.reduce((sum, row) => sum + Number(row.monto || 0), 0);
    const original = rows.reduce((sum, row) => sum + Number(row.montoTotalOriginal ?? row.monto ?? 0), 0);
    return `Registros: ${rows.length}   ·   Asignado al periodo: ${currency(assigned)}   ·   Total original: ${currency(original)}`;
  }
  const total = definition.totalKey
    ? rows.reduce((sum, row) => sum + Number(row[definition.totalKey] || 0), 0)
    : null;
  return total == null
    ? `Registros: ${rows.length}`
    : `Registros: ${rows.length}   ·   Total del reporte: ${currency(total)}`;
}

export async function createExcelReport(moduleName, rows, filters = {}, targetWorkbook = null, worksheetName = 'Reporte') {
  const definition = reportDefinitions[moduleName];
  if (!definition) throw new Error('Módulo de exportación no válido.');

  const ownsWorkbook = !targetWorkbook;
  const workbook = targetWorkbook || new ExcelJS.Workbook();
  workbook.creator = 'Safetrics';
  workbook.created = new Date();
  workbook.subject = definition.title;
  workbook.title = definition.title;
  const sheet = workbook.addWorksheet(worksheetName, {
    views: [{ state: 'frozen', ySplit: 5 }],
    pageSetup: { orientation: definition.columns.length > 6 ? 'landscape' : 'portrait', fitToPage: true, fitToWidth: 1 }
  });
  const { columns } = definition;
  const lastColumn = columns.length;
  const lastLetter = sheet.getColumn(lastColumn).letter;
  sheet.mergeCells(`A1:${lastLetter}1`);
  sheet.getCell('A1').value = definition.title;
  sheet.getCell('A1').font = { name: 'Aptos Display', size: 18, bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF183B60' } };
  sheet.getRow(1).height = 32;
  sheet.mergeCells(`A2:${lastLetter}2`);
  sheet.getCell('A2').value = formatPeriod(filters);
  sheet.getCell('A2').font = { size: 10, color: { argb: 'FF49647E' } };
  sheet.mergeCells(`A3:${lastLetter}3`);
  sheet.getCell('A3').value = [`Generado: ${new Date().toLocaleString('es-CO')}`, filterDescription(filters)].filter(Boolean).join('   ·   ');
  sheet.getCell('A3').font = { size: 9, color: { argb: 'FF718096' } };
  sheet.mergeCells(`A4:${lastLetter}4`);
  sheet.getCell('A4').value = summaryText(moduleName, rows);
  sheet.getCell('A4').font = { size: 10, bold: true, color: { argb: 'FF214F7C' } };
  sheet.addRow(columns.map(([, label]) => label));
  const header = sheet.getRow(5);
  header.height = 24;
  header.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2D669D' } };
  header.alignment = { vertical: 'middle', wrapText: true };

  const dataRows = exportRows(moduleName, rows);
  dataRows.forEach((values, index) => {
    const row = sheet.addRow(values);
    row.height = 20;
    row.alignment = { vertical: 'middle' };
    if (index % 2 === 1) {
      row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F7FC' } };
    }
    columns.forEach(([, , kind], columnIndex) => {
      const cell = row.getCell(columnIndex + 1);
      if (kind === 'money') cell.numFmt = moneyFormat;
      else if (kind === 'percent') cell.numFmt = '0.0%';
      else if (kind === 'number') cell.numFmt = '#,##0.##';
    });
  });
  sheet.autoFilter = { from: { row: 5, column: 1 }, to: { row: Math.max(5, sheet.rowCount), column: lastColumn } };
  columns.forEach(([key, label, kind], index) => {
    const column = sheet.getColumn(index + 1);
    const contentWidth = Math.max(label.length, ...rows.slice(0, 100).map((row) => String(row[key] ?? '').length));
    column.width = kind === 'money' ? 19 : Math.min(34, Math.max(13, contentWidth + 2));
    if (kind === 'money' || kind === 'number' || kind === 'percent') column.alignment = { horizontal: 'right', vertical: 'middle' };
  });
  return ownsWorkbook ? workbook.xlsx.writeBuffer() : null;
}

export function createPdfReport(moduleName, rows, filters = {}) {
  const definition = reportDefinitions[moduleName];
  if (!definition) throw new Error('Módulo de exportación no válido.');

  const landscape = definition.columns.length > 6;
  const doc = new PDFDocument({ size: 'LETTER', layout: landscape ? 'landscape' : 'portrait', margin: 36, bufferPages: true, compress: false, info: { Title: definition.title, Author: 'Safetrics' } });
  const chunks = [];
  const output = new Promise((resolve, reject) => {
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const margin = 36;
  const pageWidth = landscape ? 792 : 612;
  const tableWidth = pageWidth - margin * 2;
  const columnWidth = tableWidth / definition.columns.length;
  const padding = 5;
  const lineHeight = 9;
  const drawHeading = () => {
    doc.rect(margin, 28, tableWidth, 44).fill('#183b60');
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(16).text('Safetrics', margin + 12, 37);
    doc.font('Helvetica').fontSize(9).text(definition.title, margin + 12, 57);
    doc.fillColor('#243b53').fontSize(9).text(formatPeriod(filters), margin, 82, { width: tableWidth });
    const filtersText = filterDescription(filters);
    if (filtersText) doc.fillColor('#64748b').fontSize(8).text(filtersText, margin, 96, { width: tableWidth });
    const summaryY = filtersText ? 111 : 98;
    doc.fillColor('#214f7c').font('Helvetica-Bold').fontSize(9).text(summaryText(moduleName, rows), margin, summaryY);
    return summaryY + 17;
  };
  const drawTableHeader = (y) => {
    doc.rect(margin, y, tableWidth, 21).fill('#2d669d');
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(7.5);
    definition.columns.forEach(([, label], index) => {
      doc.text(label, margin + index * columnWidth + padding, y + 6, { width: columnWidth - padding * 2, height: 11, ellipsis: true });
    });
    return y + 21;
  };
  let y = drawTableHeader(drawHeading());
  const tableRows = exportRows(moduleName, rows);
  if (!tableRows.length) {
    doc.fillColor('#64748b').font('Helvetica').fontSize(10).text('No hay registros para los filtros seleccionados.', margin, y + 12);
    y += 40;
  } else {
    tableRows.forEach((values, rowIndex) => {
      const cellTexts = values.map((value, index) => {
        const kind = definition.columns[index][2];
        if (kind === 'money') return Number(value).toLocaleString('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 2 });
        if (kind === 'percent') return `${(Number(value) * 100).toLocaleString('es-CO', { maximumFractionDigits: 1 })} %`;
        if (kind === 'number') return Number(value).toLocaleString('es-CO');
        return String(value ?? '');
      });
      const heights = cellTexts.map((text, index) => doc.heightOfString(text, {
        width: columnWidth - padding * 2,
        font: 'Helvetica',
        fontSize: 7,
        lineGap: 1
      }));
      const rowHeight = Math.max(19, ...heights.map((height) => height + 8));
      if (y + rowHeight > doc.page.height - margin - 20) {
        doc.addPage();
        y = drawHeading();
        y = drawTableHeader(y);
      }
      if (rowIndex % 2 === 1) doc.rect(margin, y, tableWidth, rowHeight).fill('#f2f7fc');
      doc.fillColor('#243b53').font('Helvetica').fontSize(7);
      cellTexts.forEach((text, index) => {
        doc.text(text, margin + index * columnWidth + padding, y + 4, {
          width: columnWidth - padding * 2,
          height: rowHeight - 6,
          ellipsis: true,
          lineGap: 1
        });
      });
      y += rowHeight;
    });
  }

  const range = doc.bufferedPageRange();
  for (let index = range.start; index < range.start + range.count; index += 1) {
    doc.switchToPage(index);
    const footerLineY = doc.page.height - margin - 18;
    const footerTextY = doc.page.height - margin - 12;
    doc.moveTo(margin, footerLineY).lineTo(doc.page.width - margin, footerLineY).strokeColor('#d9e2ec').stroke();
    doc.fillColor('#718096').font('Helvetica').fontSize(7)
      .text(`Generado ${new Date().toLocaleString('es-CO')} · Página ${index + 1} de ${range.count}`, margin, footerTextY, { width: tableWidth, align: 'right', lineBreak: false });
  }
  doc.end();
  return output;
}
