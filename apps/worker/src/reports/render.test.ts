import { writeFile } from 'node:fs/promises';
import { playerReportContentSchema } from '@sport-performance/contracts';
import { createTranslator } from '@sport-performance/i18n';
import { describe, expect, it } from 'vitest';
import { pdfText } from '../testing/pdf-text.js';
import { sampleReportContent } from '../testing/report-fixture.js';
import { contrastRatio } from '@sport-performance/ui-tokens';
import { changeText as change, paperColors, renderPlayerReport } from './render.js';

const translator = createTranslator({ locale: 'es-AR' });
const NOW = new Date('2026-05-04T15:00:00Z');

describe('player report PDF (B-602)', () => {
  it('lays out the snapshot in es-AR, with its sections and status in words', async () => {
    const content = playerReportContentSchema.parse(sampleReportContent());
    const bytes = await renderPlayerReport(content, { translator, logoPng: null, now: NOW });
    if (process.env.REPORT_PDF_OUT !== undefined)
      await writeFile(process.env.REPORT_PDF_OUT, bytes);
    expect(Buffer.from(bytes.subarray(0, 5)).toString('latin1')).toBe('%PDF-');
    const text = (await pdfText(bytes)).join(' ');
    for (const expected of [
      'OLIVOS RUGBY CLUB',
      'Informe de rendimiento',
      'Temporada 2026 · Ventana V2',
      'Martín Núñez',
      'Nacimiento: 01/05/2011',
      '14 años',
      'Categoría: M15',
      'Del 01/04/2026 al 30/04/2026',
      'Generado el 04/05/2026',
      'CMJ',
      '42,5 cm',
      '40,0 cm',
      'V1 Temporada 2026',
      '+2,5 cm',
      'mejor',
      '36,3 cm',
      '52,0 cm',
      // Method and protocol version of each result and of the previous one (principle 4).
      'Medido con: Video · protocolo v2.',
      'V1 Temporada 2026 · Manual · protocolo v1',
      'Medido con: Fotocélula · protocolo v1.',
      'Sprint 40 m',
      '5,84 s',
      '505 (cambio de dirección) (12/04/2026): no disponible',
      'EVOLUCIÓN POR VENTANA',
      'CRECIMIENTO Y MADURACIÓN',
      '168,4 cm',
      '+0,1 años (Moore 2015)',
      '92,4',
      'Está en la etapa de mayor crecimiento',
      'No diagnostica ni reemplaza al staff médico.',
      'ORC · Martín Núñez',
      'Página 1 de',
    ]) {
      expect(text, expected).toContain(expected);
    }
    // The cause of an unavailability never reaches the PDF.
    expect(text.toLowerCase()).not.toMatch(/lesi[oó]n|injur/);
  });

  it('says when there is nothing to show and when the window was still open', async () => {
    const content = sampleReportContent({
      tests: [],
      notDone: [],
      evolution: { columns: [], metrics: [] },
      maturation: null,
      window: { ...sampleReportContent().window, closed: false },
    });
    const text = (
      await pdfText(await renderPlayerReport(content, { translator, logoPng: null, now: NOW }))
    ).join(' ');
    expect(text).toContain('No tiene resultados de tests en esta ventana.');
    expect(text).toContain('Todavía no tiene resultados para comparar.');
    expect(text).toContain('No hay mediciones hasta el cierre de la ventana.');
    expect(text).toContain('La ventana todavía no había terminado');
    expect(text).not.toContain('TESTS NO REALIZADOS');
  });

  it('breaks long reports into numbered pages, the footer on each', async () => {
    const base = sampleReportContent();
    const first = base.tests[0];
    if (first === undefined) throw new Error('fixture');
    const tests = Array.from({ length: 40 }, (_, i) => ({
      ...first,
      metricCode: i % 2 === 0 ? 'cmj_height_cm' : 'vift_kmh',
      value: 30 + i,
    }));
    const pages = await pdfText(
      await renderPlayerReport({ ...base, tests }, { translator, logoPng: null, now: NOW }),
    );
    expect(pages.length).toBeGreaterThan(1);
    pages.forEach((page, i) => {
      expect(page).toContain(`Página ${String(i + 1)} de ${String(pages.length)}`);
      expect(page).toContain('ORC · Martín Núñez');
    });
    // The table header repeats on the next page.
    expect(pages[1]).toContain('Resultado');
  });

  it('writes the change with its sense in words, never by colour alone', () => {
    const changeText = (...args: Parameters<typeof change>) =>
      change(...args).replaceAll('\u00a0', ' ');
    const [cmj, sprint] = sampleReportContent().tests;
    if (cmj === undefined || sprint === undefined) throw new Error('fixture');
    expect(changeText(translator.t, cmj)).toBe('+2,5 cm (+6,3 %) · mejor');
    expect(changeText(translator.t, { ...cmj, value: 38 })).toBe('-2,0 cm (-5,0 %) · peor');
    expect(changeText(translator.t, { ...cmj, value: 40 })).toBe('Igual');
    expect(changeText(translator.t, sprint)).toBe('—');
    expect(
      changeText(translator.t, {
        ...sprint,
        value: 5.7,
        previous: {
          seasonName: null,
          number: null,
          startsOn: sprint.measuredOn,
          value: 5.9,
          methods: [],
          protocolVersion: 1,
        },
      }),
    ).toBe('-0,20 s (-3,4 %) · mejor');
  });

  it('darkens a club colour too light for white paper, keeps one that reads', () => {
    const light = paperColors({ primaryColor: '#fff6cc', secondaryColor: '#ffffff' });
    expect(contrastRatio(light.primary, '#ffffff')).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(light.secondary, '#ffffff')).toBeGreaterThanOrEqual(3);
    expect(paperColors({ primaryColor: '#050505', secondaryColor: '#c0392b' })).toEqual({
      primary: '#050505',
      secondary: '#c0392b',
    });
  });
});
