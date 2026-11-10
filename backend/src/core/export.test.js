import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { createExcelReport, createPdfReport } from './export.js';

test('creates a formatted Excel expense report with localized columns and totals', async () => {
  const buffer = await createExcelReport('gastos', [{
    fecha: new Date('2026-10-22T05:00:00.000Z'),
    fechaInicio: new Date('2026-10-21T05:00:00.000Z'),
    fechaFin: new Date('2026-10-22T05:00:00.000Z'),
    detalle: 'Internet',
    categoriaNombre: 'Servicios',
    plataformaNombre: 'Banco',
    origen: 'Prolongado',
    monto: 12.34,
    montoTotalOriginal: 24.68
  }], { desde: '2026-10-22', hasta: '2026-10-22' });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.getWorksheet('Reporte');

  assert.equal(sheet.getCell('A1').value, 'Registro de gastos');
  assert.equal(sheet.getCell('A2').value, 'Periodo: 22/10/2026 – 22/10/2026');
  assert.equal(sheet.getCell('H5').value, 'Asignado al periodo');
  assert.equal(sheet.getCell('H6').value, 12.34);
  assert.equal(sheet.getCell('H6').numFmt, '"$"#,##0.00;[Red]-"$"#,##0.00');
  assert.equal(sheet.getCell('I6').value, 24.68);
  assert.equal(sheet.autoFilter, 'A5:I6');
});

test('creates a readable PDF report, including a no-results state', async () => {
  const buffer = await createPdfReport('ventas', [], { desde: '2026-10-01', hasta: '2026-10-31', estado: 'pagada' });
  const content = buffer.toString('latin1');

  assert.ok(content.startsWith('%PDF-'));
  assert.ok(content.includes('Registro de ventas'));
  const decodedText = [...content.matchAll(/<([a-f\d]+)>/gi)]
    .map(([, hex]) => Buffer.from(hex, 'hex').toString('latin1'))
    .join('');
  assert.ok(decodedText.includes('No hay registros para los filtros seleccionados.'));
  assert.ok(decodedText.includes('Estado: pagada'));
  assert.equal([...content.matchAll(/\/Type \/Page\b/g)].length, 1);
});

test('exports the summary breakdown in both Excel and PDF formats', async () => {
  const rows = [{
    grupo: 'Totales del periodo',
    periodo: '',
    concepto: 'Utilidad neta',
    monto: 69,
    porcentaje: 0.5,
    cantidad: 3
  }];
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await createExcelReport('resumen', rows, { desde: '2026-10-22', hasta: '2026-10-22' }));
  const sheet = workbook.getWorksheet('Reporte');
  const pdf = await createPdfReport('resumen', rows, { desde: '2026-10-22', hasta: '2026-10-22' });
  const decodedPdf = [...pdf.toString('latin1').matchAll(/<([a-f\d]+)>/gi)]
    .map(([, hex]) => Buffer.from(hex, 'hex').toString('latin1'))
    .join('');

  assert.equal(sheet.getCell('A5').value, 'Sección');
  assert.equal(sheet.getCell('C6').value, 'Utilidad neta');
  assert.equal(sheet.getCell('D6').value, 69);
  assert.equal(sheet.getCell('E6').value, 0.5);
  assert.ok(decodedPdf.includes('Utilidad neta'));
  assert.ok(decodedPdf.includes('69'));
});
