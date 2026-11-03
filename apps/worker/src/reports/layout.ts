import { createRequire } from 'node:module';
import type { Translator } from '@sport-performance/i18n';
import { CONTRAST, ensureContrast } from '@sport-performance/ui-tokens';
import PDFDocument from 'pdfkit';

/**
 * The page of every PDF report (player B-602, ADR 0071; category B-603, ADR
 * 0073), laid out with pdfkit: A4, the club's colours and crest, Barlow
 * Condensed for titles and figures and Barlow for text (embedded, subset),
 * sections, paragraphs and tables with a header repeated on each page, and a
 * footer with "Página n de m". Each report draws its own sections on it.
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
export const INK = '#050505';
export const MUTED = '#5F574F';
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

export interface Column {
  readonly header: string;
  readonly width: number;
  readonly align?: 'left' | 'right';
}

export interface Cell {
  readonly text: string;
  /** A second, smaller and grey line (methods, the category's average). */
  readonly note?: string;
}

type Doc = PDFKit.PDFDocument;

export interface ReportHeader {
  readonly locale: string;
  readonly club: {
    readonly name: string;
    readonly primaryColor: string;
    readonly secondaryColor: string;
  };
  /** The report's kind ("Informe de rendimiento"), under the club's name. */
  readonly title: string;
  /** The window ("Temporada 2026 · Ventana V2"), under the title. */
  readonly subtitle: string;
  /** The subject of the report, big in the box (the player, the category). */
  readonly name: string;
  /** Lines under the name. */
  readonly details: readonly string[];
  /** The PDF's title metadata. */
  readonly documentTitle: string;
}

export interface ReportLayout {
  readonly doc: Doc;
  readonly left: number;
  readonly width: number;
  /** Opens a new page unless `height` points still fit. */
  readonly ensure: (height: number) => void;
  readonly section: (title: string) => void;
  readonly paragraph: (text: string, size?: number, color?: string) => void;
  readonly table: (columns: readonly Column[], rows: readonly (readonly Cell[])[]) => void;
  /** Label and value rows (the maturation of the player report). */
  readonly facts: (rows: readonly (readonly [string, string])[]) => void;
  /** Writes the footer on every page and resolves the bytes of the PDF. */
  readonly finish: (footer: string) => Promise<Uint8Array>;
}

/** A new A4 report with its header drawn, ready for its sections. */
export function createReportLayout(header: ReportHeader, options: RenderOptions): ReportLayout {
  const { t } = options.translator;
  const brand = paperColors(header.club);
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
    lang: header.locale,
    displayTitle: true,
    info: {
      Title: header.documentTitle,
      Author: header.club.name,
      Subject: header.subtitle,
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

  // ─── Header: stripes of the jersey, crest, title, subject ────────────────────────────
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
    .text(header.club.name.toUpperCase(), headerX, top, { width: width - (headerX - left) });
  doc
    .font('title')
    .fontSize(24)
    .fillColor(INK)
    .text(header.title, headerX, doc.y, { width: width - (headerX - left) });
  doc
    .font('figure')
    .fontSize(13)
    .fillColor(INK)
    .text(header.subtitle, headerX, doc.y, { width: width - (headerX - left) });
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
    .text(header.name, left + 10, boxTop + 8, { width: width - 20 });
  for (const line of header.details) {
    doc
      .font('text')
      .fontSize(10)
      .fillColor(INK)
      .text(line, left + 10, doc.y + 1, { width: width - 20 });
  }
  const boxBottom = doc.y + 8;
  doc
    .save()
    .rect(left, boxTop, width, boxBottom - boxTop)
    .lineWidth(0.75)
    .stroke(LINE)
    .restore();
  doc.y = boxBottom + 12;

  // ─── Building blocks ─────────────────────────────────────────────────────────────────
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
    const head = () => {
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
    head();
    for (const row of rows) {
      const height = Math.max(...row.map((cell, i) => cellHeight(cell, columns[i]?.width ?? 60)));
      if (doc.y + height > bottom()) {
        doc.addPage();
        head();
      }
      const y = doc.y;
      let x = left;
      row.forEach((cell, i) => {
        const column = columns[i];
        if (column === undefined) return;
        const textOptions = { width: column.width - 8, align: column.align ?? 'left' } as const;
        doc
          .font(i === 0 ? 'textBold' : 'figure')
          .fontSize(i === 0 ? 9.5 : 10.5)
          .fillColor(INK)
          .text(cell.text, x + 4, y + 4, textOptions);
        if (cell.note !== undefined) {
          doc
            .font('text')
            .fontSize(8)
            .fillColor(MUTED)
            .text(cell.note, x + 4, doc.y + 1, textOptions);
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

  const facts = (rows: readonly (readonly [string, string])[]) => {
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
  };

  // ─── Footer on every page ────────────────────────────────────────────────────────────
  const finish = (footer: string) => {
    const range = doc.bufferedPageRange();
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
  };

  return { doc, left, width, ensure, section, paragraph, table, facts, finish };
}
