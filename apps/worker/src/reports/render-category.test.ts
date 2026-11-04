import { writeFile } from 'node:fs/promises';
import { categoryReportContentSchema } from '@sport-performance/contracts';
import { createTranslator } from '@sport-performance/i18n';
import { describe, expect, it } from 'vitest';
import { pdfText } from '../testing/pdf-text.js';
import { sampleCategoryReportContent } from '../testing/report-fixture.js';
import { categoryReportFileName } from './job.js';
import { rateText, renderCategoryReport } from './render-category.js';

const translator = createTranslator({ locale: 'es-AR' });
const NOW = new Date('2026-05-04T15:00:00Z');
const plain = (text: string) => text.replaceAll(' ', ' ');

describe('category report PDF (B-603)', () => {
  it('lays out the snapshot in es-AR, with its sections and every status in words', async () => {
    const content = categoryReportContentSchema.parse(sampleCategoryReportContent());
    const bytes = await renderCategoryReport(content, { translator, logoPng: null, now: NOW });
    if (process.env.REPORT_PDF_OUT !== undefined) {
      await writeFile(process.env.REPORT_PDF_OUT, bytes);
    }
    expect(Buffer.from(bytes.subarray(0, 5)).toString('latin1')).toBe('%PDF-');
    const text = plain((await pdfText(bytes)).join(' '));
    for (const expected of [
      'OLIVOS RUGBY CLUB',
      'Informe de categoría',
      'Temporada 2026 · Ventana V2',
      'M15',
      'Rugby · Masculino',
      '24 jugadores en la categoría',
      'Formación (M13 / M14): 4',
      'Desarrollo (M15 / M16): 20',
      'Del 01/04/2026 al 30/04/2026',
      'Generado el 04/05/2026',
      'CUMPLIMIENTO DE LA BATERÍA',
      'Esperados',
      'Sprint 10/20/40 m 24 20 83 %',
      'No disponibles',
      'Total de la batería 48 42 88 %',
      'EVOLUCIÓN DEL GRUPO',
      'V1 Temporada 2026',
      '34,2 cm',
      '36,1 cm',
      '22 jug.',
      '52,0 cm',
      // A column that mixes methods says so (principle 4).
      'mezcla métodos de medición (Manual, Video)',
      'CAMBIO CONTRA LA VENTANA ANTERIOR',
      '14 mejoraron, 4 empeoraron, 2 igual, de 20',
      'TASA DE RESPUESTA',
      'Del 01/03/2026 al 30/04/2026',
      '6 días con sesión',
      '20/04/2026',
      '85 % (51 de 60)',
      '80 % (96 de 120)',
      '70 % (70 de 100)',
      'nunca nombres ni resultados de un jugador',
      'No diagnostica ni reemplaza al staff médico.',
      'ORC · M15 · Temporada 2026 · Ventana V2',
      'Página 1 de',
    ]) {
      expect(text, expected).toContain(expected);
    }
    // The cause of an unavailability never reaches the PDF.
    expect(text.toLowerCase()).not.toMatch(/lesi[oó]n|injur/);
  });

  it('says when there is nothing to show and when the window was still open', async () => {
    const base = sampleCategoryReportContent();
    const content = sampleCategoryReportContent({
      battery: [],
      evolution: { columns: [], metrics: [] },
      responses: {
        ...base.responses,
        sessionDays: 0,
        wellness: { expected: 0, answered: 0 },
        rpe: { expected: 0, answered: 0 },
        weeks: [],
      },
      window: { ...base.window, closed: false },
    });
    const text = plain(
      (
        await pdfText(await renderCategoryReport(content, { translator, logoPng: null, now: NOW }))
      ).join(' '),
    );
    expect(text).toContain('La batería no programa tests para esta ventana.');
    expect(text).toContain('Todavía no hay resultados del grupo para comparar.');
    expect(text).toContain('No hubo sesiones de la categoría en el período.');
    expect(text).toContain('La ventana todavía no había terminado');
    expect(text).not.toContain('CAMBIO CONTRA LA VENTANA ANTERIOR');
    expect(text).not.toContain('no ve hoy a todos los jugadores');
  });

  it('warns when the requester did not see every player the report counts', async () => {
    const content = sampleCategoryReportContent({ scope: { complete: false } });
    const text = plain(
      (
        await pdfText(await renderCategoryReport(content, { translator, logoPng: null, now: NOW }))
      ).join(' '),
    );
    expect(text).toContain('no ve hoy a todos los jugadores');
    expect(text).toContain('pedíselo a la administración del club');
  });

  it('writes a rate with its counts, and nothing when nothing was expected', () => {
    expect(plain(rateText(translator.t, { expected: 3, answered: 2 }))).toBe('67 % (2 de 3)');
    expect(rateText(translator.t, { expected: 0, answered: 0 })).toBe('Sin datos');
  });

  it('names the download after the category and the window', () => {
    expect(categoryReportFileName(sampleCategoryReportContent(), translator)).toBe(
      'Informe M15 Temporada 2026 V2.pdf',
    );
    const slashed = sampleCategoryReportContent({
      category: { ...sampleCategoryReportContent().category, name: 'M15/M16' },
    });
    expect(categoryReportFileName(slashed, translator)).toBe(
      'Informe M15-M16 Temporada 2026 V2.pdf',
    );
  });
});
