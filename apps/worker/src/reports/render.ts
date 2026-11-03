import { createRequire } from 'node:module';
import type { PlayerReportContent, PlayerReportTest } from '@sport-performance/contracts';
import { changeIsImprovement, relativeChangePct, type LocalDate } from '@sport-performance/domain';
import {
  PLACEHOLDER,
  formatLocalDate,
  formatUnit,
  isMessageKey,
  type Translator,
} from '@sport-performance/i18n';
import { CONTRAST, ensureContrast } from '@sport-performance/ui-tokens';
import PDFDocument from 'pdfkit';

/**
 * The PDF of a player report (B-602, ADR 0069), laid out with pdfkit from
 * the snapshot the API froze: A4, the club's colours and crest, Barlow
 * Condensed for titles and figures and Barlow for text (embedded, subset),
 * es-AR formats, a status always in words. Tables instead of charts: they
 * print well, read aloud and are the accessible form of every chart (CLAUDE.md).
 */

const require = createRequire(import.meta.url);

/** The fonts of the brand (OFL, from Fontsource): resolved once, embedded as subsets. */
export const REPORT_FONTS = {
  text: require.resolve('@fontsource/barlow/files/barlow-latin-400-normal.woff'),
  textBold: require.resolve('@fontsource/barlow/files/barlow-latin-600-normal.woff'),
  title:
    require.resolve('@fontsource/barlow-condensed/files/barlow-condensed-latin-700-normal.woff'),
  figure:
    require.resolve('@fontsource/barlow-condensed/files/barlow-condensed-latin-600-normal.woff'),
} as const;

/** Light, high-contrast palette for paper (the dark UI theme does not print). */
const INK = '#050505';
const MUTED = '#5F574F';
const LINE = '#D9D2C9';
const PANEL = '#F4F0EB';
const PAPER = '#FFFFFF';

/**
 * The club's colours as printed on white paper: each one darkened just enough
 * to reach the non-text contrast (3:1, WCAG 1.4.11), so a very light club
 * colour still draws visible stripes and rules.
 */
export function paperColors(club: { primaryColor: string; secondaryColor: string }): {
  primary: string;
  secondary: string;
} {
  return {
    primary: ensureContrast(club.primaryColor, PAPER, CONTRAST.nonText),
    secondary: ensureContrast(club.secondaryColor, PAPER, CONTRAST.nonText),
  };
}

const PAGE_MARGIN = 40;
const FOOTER_HEIGHT = 36;

export interface RenderOptions {
  readonly translator: Translator;
  /** The club's crest as PNG bytes, or `null` (no crest, or not a PNG). */
  readonly logoPng: Uint8Array | null;
  /** Creation date written in the PDF's metadata. */
  readonly now: Date;
}

interface Column {
  readonly header: string;
  readonly width: number;
  readonly align?: 'left' | 'right';
}

interface Cell {
  readonly text: string;
  /** A second, smaller and grey line (methods, the category's average). */
  readonly note?: string;
}

type Doc = PDFKit.PDFDocument;

export function metricLabel(
  t: Translator['t'],
  metricCode: string,
  exercise: string | null,
): string {
  const key = `player.metric.${metricCode}`;
  const metric = isMessageKey(key) ? t(key) : metricCode.replaceAll('_', ' ');
  return exercise === null
    ? metric
    : t('player.metric.withExercise', { metric, exercise: exercise.replaceAll('_', ' ') });
}

function testLabel(t: Translator['t'], testCode: string): string {
  const key = `test.${testCode}`;
  return isMessageKey(key) ? t(key) : testCode.replaceAll('_', ' ');
}

function windowLabel(
  t: Translator['t'],
  column: { seasonName: string | null; number: number | null; startsOn: LocalDate },
): string {
  return column.number === null || column.seasonName === null
    ? t('report.evolution.day', { date: formatLocalDate(column.startsOn) })
    : t('report.evolution.window', { number: column.number, season: column.seasonName });
}

function methodNames(t: Translator['t'], methods: readonly PlayerReportTest['methods'][number][]) {
  return methods.length === 0 ? PLACEHOLDER : methods.map((m) => t(`method.${m}`)).join(', ');
}

/** The change against the previous window, in the unit and in %, with its sense in words. */
export function changeText(t: Translator['t'], test: PlayerReportTest): string {
  if (test.previous === null) return PLACEHOLDER;
  const diff = test.value - test.previous.value;
  const improvement = changeIsImprovement(test.direction, test.value, test.previous.value);
  if (diff === 0) return t('report.change.same');
  const pct = relativeChangePct(test.value, test.previous.value);
  const change =
    pct === null
      ? formatUnit(diff, test.unit, { sign: 'always' })
      : `${formatUnit(diff, test.unit, { sign: 'always' })} (${formatUnit(pct, 'pct', { sign: 'always', decimals: 1 })})`;
  if (improvement === true) return t('report.change.better', { change });
  if (improvement === false) return t('report.change.worse', { change });
  return t('report.change.neutral', { change });
}

/** Renders the report; resolves the bytes of the PDF. */
export async function renderPlayerReport(
  content: PlayerReportContent,
  options: RenderOptions,
): Promise<Uint8Array> {
  const { t } = options.translator;
  const brand = paperColors(content.club);
  const playerName = `${content.player.firstName} ${content.player.lastName}`;
  const windowName = t('report.window', {
    season: content.window.seasonName,
    number: content.window.number,
  });
  const doc: Doc = new PDFDocument({
    size: 'A4',
    margins: {
      top: PAGE_MARGIN,
      bottom: PAGE_MARGIN + FOOTER_HEIGHT,
      left: PAGE_MARGIN,
      right: PAGE_MARGIN,
    },
    bufferPages: true,
    pdfVersion: '1.7',
    lang: content.locale,
    displayTitle: true,
    info: {
      Title: `${t('report.title')} · ${playerName} · ${windowName}`,
      Author: content.club.name,
      Subject: windowName,
      Creator: 'Sport Performance',
      Producer: 'Sport Performance',
      CreationDate: options.now,
    },
  });
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const finished = new Promise<Uint8Array>((resolve, reject) => {
    doc.on('end', () => {
      resolve(new Uint8Array(Buffer.concat(chunks)));
    });
    doc.on('error', reject);
  });

  doc.registerFont('text', REPORT_FONTS.text);
  doc.registerFont('textBold', REPORT_FONTS.textBold);
  doc.registerFont('title', REPORT_FONTS.title);
  doc.registerFont('figure', REPORT_FONTS.figure);

  const left = doc.page.margins.left;
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const bottom = () => doc.page.height - doc.page.margins.bottom;
  const ensure = (height: number) => {
    if (doc.y + height > bottom()) doc.addPage();
  };

  // ─── Header: stripes of the jersey, crest, title, player ─────────────────────────────
  const stripes = (y: number) => {
    const stripe = 3;
    for (let i = 0; i < 4; i += 1) {
      doc
        .rect(0, y + i * stripe, doc.page.width, stripe)
        .fill(i % 2 === 0 ? brand.primary : brand.secondary);
    }
  };
  stripes(0);
  doc.on('pageAdded', () => {
    stripes(0);
    doc.x = left;
    doc.y = PAGE_MARGIN;
  });

  let headerX = left;
  const top = PAGE_MARGIN;
  if (options.logoPng !== null) {
    try {
      doc.image(Buffer.from(options.logoPng), left, top, { fit: [56, 56] });
      headerX = left + 68;
    } catch {
      // A crest pdfkit cannot read: the report goes without it.
    }
  }
  doc
    .font('figure')
    .fontSize(11)
    .fillColor(MUTED)
    .text(content.club.name.toUpperCase(), headerX, top, { width: width - (headerX - left) });
  doc
    .font('title')
    .fontSize(24)
    .fillColor(INK)
    .text(t('report.title'), headerX, doc.y, { width: width - (headerX - left) });
  doc
    .font('figure')
    .fontSize(13)
    .fillColor(INK)
    .text(windowName, headerX, doc.y, { width: width - (headerX - left) });
  doc.y = Math.max(doc.y, top + 60) + 10;
  doc
    .moveTo(left, doc.y)
    .lineTo(left + width, doc.y)
    .lineWidth(2)
    .stroke(brand.primary);
  doc.y += 10;

  const boxTop = doc.y;
  doc
    .font('title')
    .fontSize(20)
    .fillColor(INK)
    .text(playerName, left + 10, boxTop + 8, {
      width: width - 20,
    });
  const detail = (text: string) =>
    doc
      .font('text')
      .fontSize(10)
      .fillColor(INK)
      .text(text, left + 10, doc.y + 1, {
        width: width - 20,
      });
  detail(
    t('report.player.birth', {
      date: formatLocalDate(content.player.birthDate),
      age: content.player.ageYears,
    }),
  );
  const sportKey = `sport.${content.player.sport}`;
  detail(
    [
      t('report.player.sport', {
        sport: isMessageKey(sportKey) ? t(sportKey) : content.player.sport,
      }),
      content.player.categories.length === 0
        ? null
        : t('report.player.categories', { categories: content.player.categories.join(', ') }),
    ]
      .filter((part): part is string => part !== null)
      .join(' · '),
  );
  detail(
    `${t('report.windowDates', {
      from: formatLocalDate(content.window.startsOn),
      to: formatLocalDate(content.window.endsOn),
    })} · ${t('report.generatedOn', { date: formatLocalDate(content.generatedOn) })}`,
  );
  const boxBottom = doc.y + 8;
  doc
    .save()
    .rect(left, boxTop, width, boxBottom - boxTop)
    .lineWidth(0.75)
    .stroke(LINE)
    .restore();
  doc.y = boxBottom + 12;

  if (!content.window.closed) {
    doc
      .font('text')
      .fontSize(9)
      .fillColor(MUTED)
      .text(t('report.windowOpen'), left, doc.y, { width });
    doc.y += 8;
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────────────
  const section = (title: string) => {
    ensure(60);
    doc.y += 6;
    doc.font('title').fontSize(15).fillColor(INK).text(title.toUpperCase(), left, doc.y, { width });
    doc
      .moveTo(left, doc.y + 1)
      .lineTo(left + 40, doc.y + 1)
      .lineWidth(2)
      .stroke(brand.primary);
    doc.y += 8;
  };
  const paragraph = (text: string, size = 9.5, color = INK) => {
    doc.font('text').fontSize(size);
    ensure(doc.heightOfString(text, { width }) + 4);
    doc.fillColor(color).text(text, left, doc.y, { width });
    doc.y += 3;
  };

  const cellHeight = (cell: Cell, columnWidth: number) => {
    doc.font('figure').fontSize(10.5);
    let height = doc.heightOfString(cell.text, { width: columnWidth - 8 });
    if (cell.note !== undefined) {
      doc.font('text').fontSize(8);
      height += doc.heightOfString(cell.note, { width: columnWidth - 8 }) + 1;
    }
    return height + 8;
  };
  const table = (columns: readonly Column[], rows: readonly (readonly Cell[])[]) => {
    const header = () => {
      doc.font('textBold').fontSize(8.5);
      const height =
        Math.max(...columns.map((c) => doc.heightOfString(c.header, { width: c.width - 8 }))) + 8;
      ensure(height + 24);
      const y = doc.y;
      doc.save().rect(left, y, width, height).fill(PANEL).restore();
      let x = left;
      for (const column of columns) {
        doc
          .font('textBold')
          .fontSize(8.5)
          .fillColor(MUTED)
          .text(column.header, x + 4, y + 4, {
            width: column.width - 8,
            align: column.align ?? 'left',
          });
        x += column.width;
      }
      doc.y = y + height;
    };
    header();
    for (const row of rows) {
      const height = Math.max(...row.map((cell, i) => cellHeight(cell, columns[i]?.width ?? 60)));
      if (doc.y + height > bottom()) {
        doc.addPage();
        header();
      }
      const y = doc.y;
      let x = left;
      row.forEach((cell, i) => {
        const column = columns[i];
        if (column === undefined) return;
        const options = { width: column.width - 8, align: column.align ?? 'left' } as const;
        doc
          .font(i === 0 ? 'textBold' : 'figure')
          .fontSize(i === 0 ? 9.5 : 10.5)
          .fillColor(INK)
          .text(cell.text, x + 4, y + 4, options);
        if (cell.note !== undefined) {
          doc
            .font('text')
            .fontSize(8)
            .fillColor(MUTED)
            .text(cell.note, x + 4, doc.y + 1, options);
        }
        x += column.width;
      });
      doc.y = y + height;
      doc
        .moveTo(left, doc.y)
        .lineTo(left + width, doc.y)
        .lineWidth(0.5)
        .stroke(LINE);
    }
    doc.x = left;
    doc.y += 6;
  };

  // ─── Tests of the window ─────────────────────────────────────────────────────────────
  section(t('report.tests.title'));
  if (content.tests.length === 0) {
    paragraph(t('report.tests.empty'), 10, MUTED);
  } else {
    const share = (fraction: number) => Math.floor(width * fraction);
    const columns: Column[] = [
      { header: t('report.tests.metric'), width: share(0.27) },
      { header: t('report.tests.value'), width: share(0.13), align: 'right' },
      { header: t('report.tests.previous'), width: share(0.16), align: 'right' },
      { header: t('report.tests.change'), width: share(0.18), align: 'right' },
      { header: t('report.tests.category'), width: share(0.14), align: 'right' },
    ];
    const used = columns.reduce((sum, c) => sum + c.width, 0);
    columns.push({ header: t('report.tests.firstTeam'), width: width - used, align: 'right' });
    table(
      columns,
      content.tests.map((test) => [
        {
          text: metricLabel(t, test.metricCode, test.exercise),
          note: t('report.tests.methods', {
            methods: methodNames(t, test.methods),
            version: test.protocolVersion,
          }),
        },
        { text: formatUnit(test.value, test.unit) },
        {
          text: test.previous === null ? PLACEHOLDER : formatUnit(test.previous.value, test.unit),
          ...(test.previous !== null && {
            note: t('report.tests.previousNote', {
              window: windowLabel(t, test.previous),
              methods: methodNames(t, test.previous.methods),
              version: test.previous.protocolVersion,
            }),
          }),
        },
        { text: changeText(t, test) },
        { text: formatUnit(test.categoryAverage, test.unit) },
        {
          text:
            test.firstTeam === null
              ? PLACEHOLDER
              : formatUnit(test.firstTeam.value, test.firstTeam.unit),
        },
      ]),
    );
    const warnings: string[] = [];
    for (const test of content.tests) {
      const metric = metricLabel(t, test.metricCode, test.exercise);
      for (const warning of test.warnings)
        warnings.push(t(`report.warning.${warning}`, { metric }));
      if (test.categoryMixedMethods) warnings.push(t('report.warning.categoryMethods', { metric }));
      if (test.categoryMixedProtocolVersions) {
        warnings.push(t('report.warning.categoryProtocols', { metric }));
      }
    }
    for (const warning of warnings) paragraph(warning, 8.5, MUTED);
  }

  if (content.notDone.length > 0) {
    section(t('report.notDone.title'));
    for (const item of content.notDone) {
      paragraph(
        t('report.notDone.item', {
          test: testLabel(t, item.testCode),
          date: formatLocalDate(item.measuredOn),
          reason: t(`report.notDone.reason.${item.reason}`),
        }),
      );
    }
  }

  // ─── Evolution by window ─────────────────────────────────────────────────────────────
  section(t('report.evolution.title'));
  if (content.evolution.metrics.length === 0) {
    paragraph(t('report.evolution.empty'), 10, MUTED);
  } else {
    paragraph(t('report.evolution.description'), 8.5, MUTED);
    const first = Math.floor(width * 0.28);
    const rest = content.evolution.columns.length;
    const each = Math.floor((width - first) / Math.max(rest, 1));
    const columns: Column[] = [
      { header: t('report.tests.metric'), width: first },
      ...content.evolution.columns.map((column) => ({
        header: windowLabel(t, column),
        width: each,
        align: 'right' as const,
      })),
    ];
    table(
      columns,
      content.evolution.metrics.map((metric) => [
        { text: metricLabel(t, metric.metricCode, metric.exercise) },
        ...content.evolution.columns.map((column): Cell => {
          const point = metric.points.find((p) => p.columnKey === column.key);
          if (point === undefined) return { text: PLACEHOLDER };
          return {
            text: formatUnit(point.value, metric.unit),
            ...(point.categoryAverage !== null && {
              note: formatUnit(point.categoryAverage, metric.unit),
            }),
          };
        }),
      ]),
    );
  }

  // ─── Growth and maturation ───────────────────────────────────────────────────────────
  section(t('report.maturation.title'));
  const maturation = content.maturation;
  if (maturation === null) {
    paragraph(t('report.maturation.empty'), 10, MUTED);
  } else {
    paragraph(
      t('report.maturation.measuredOn', { date: formatLocalDate(maturation.measuredOn) }),
      9,
      MUTED,
    );
    const offset =
      maturation.phvOffsetYears === null
        ? PLACEHOLDER
        : t('report.maturation.offsetValue', {
            value: formatUnit(maturation.phvOffsetYears, 'years', { sign: 'always' }),
            equation:
              maturation.maturityOffsetEquation === null
                ? PLACEHOLDER
                : t(`player.maturation.equation.${maturation.maturityOffsetEquation}`),
          });
    const rows: [string, string][] = [
      [t('report.maturation.height'), formatUnit(maturation.heightCm, 'cm')],
      [t('report.maturation.sittingHeight'), formatUnit(maturation.sittingHeightCm, 'cm')],
      [t('report.maturation.weight'), formatUnit(maturation.weightKg, 'kg')],
      [t('report.maturation.offset'), offset],
      [t('report.maturation.adultHeightPct'), formatUnit(maturation.adultHeightPct, 'pct')],
      [
        t('report.maturation.predictedAdultHeight'),
        formatUnit(maturation.predictedAdultHeightCm, 'cm'),
      ],
      [
        t('report.maturation.growthVelocity'),
        formatUnit(maturation.growthVelocityCmYear, 'cm_year'),
      ],
    ];
    const labelWidth = Math.floor(width * 0.5);
    for (const [label, value] of rows) {
      ensure(18);
      const y = doc.y;
      doc.font('text').fontSize(9.5).fillColor(MUTED).text(label, left, y, { width: labelWidth });
      doc
        .font('figure')
        .fontSize(11)
        .fillColor(INK)
        .text(value, left + labelWidth, y, { width: width - labelWidth });
      doc.y = Math.max(doc.y, y + 14) + 2;
      doc
        .moveTo(left, doc.y)
        .lineTo(left + width, doc.y)
        .lineWidth(0.5)
        .stroke(LINE);
      doc.y += 3;
    }
    if (maturation.inPeakZone === true) {
      doc.y += 4;
      paragraph(t('report.maturation.peakZone'), 9.5);
    }
  }

  // ─── How to read it ──────────────────────────────────────────────────────────────────
  section(t('report.notes.title'));
  paragraph(t('report.notes.method'), 8.5, MUTED);
  paragraph(t('report.notes.average'), 8.5, MUTED);
  paragraph(t('report.notes.firstTeam'), 8.5, MUTED);
  paragraph(t('report.notes.offset'), 8.5, MUTED);
  doc.y += 4;
  paragraph(t('report.legal'), 9, INK);

  // ─── Footer on every page ────────────────────────────────────────────────────────────
  const range = doc.bufferedPageRange();
  const footer = t('report.footer', {
    club: content.club.shortName ?? content.club.name,
    player: playerName,
    window: windowName,
  });
  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);
    // Writing in the bottom margin must not open a new page.
    const pageBottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const y = doc.page.height - PAGE_MARGIN - 14;
    doc
      .moveTo(left, y - 6)
      .lineTo(left + width, y - 6)
      .lineWidth(0.5)
      .stroke(LINE);
    doc
      .font('text')
      .fontSize(8)
      .fillColor(MUTED)
      .text(footer, left, y, {
        width: width - 90,
        lineBreak: false,
        ellipsis: true,
      });
    doc.text(
      t('report.page', { page: i - range.start + 1, pages: range.count }),
      left + width - 90,
      y,
      { width: 90, align: 'right', lineBreak: false },
    );
    doc.page.margins.bottom = pageBottom;
  }
  doc.end();
  return finished;
}
