import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { createWriteStream } from 'node:fs';
import {
  CLUB_DATA_EXPORT_BATCH_ROWS,
  CLUB_DATA_EXPORT_DICTIONARY_FILE,
  CLUB_DATA_EXPORT_FILE_NAMES,
  CLUB_DATA_EXPORT_FORMAT,
  CLUB_DATA_EXPORT_FORMAT_VERSION,
  CLUB_DATA_EXPORT_MANIFEST_FILE,
  isDatedClubDataExportDataset,
  isUnitCode,
  type ClubDataExportDataset,
  type LocalDate,
  type TimeZone,
} from '@sport-performance/domain';
import { unitLabelEsAr } from '@sport-performance/i18n';
import { Zip, ZipDeflate } from 'fflate';
import type pg from 'pg';
import {
  csvHeader,
  csvLine,
  csvRow,
  formatCsvCell,
  type CsvColumn,
  type CsvColumnType,
} from './csv.js';
import { DATASETS, DATASET_ARGS } from './datasets.js';

/** What the worker knows of an export when it writes it. */
export interface ExportSpec {
  readonly id: string;
  readonly datasets: readonly ClubDataExportDataset[];
  readonly fromDate: LocalDate | null;
  readonly toDate: LocalDate | null;
  readonly requestedOn: LocalDate;
  readonly playerIds: readonly string[];
  readonly excludedPlayersN: number;
  readonly availability: Readonly<Record<string, unknown>> | null;
  readonly requesterRole: string;
  readonly requesterName: string | null;
  readonly club: {
    readonly id: string;
    readonly name: string;
    readonly timeZone: TimeZone;
  };
  readonly generatedAt: Date;
}

export interface WrittenExport {
  readonly sizeBytes: number;
  /** Base64 SHA-256 of the ZIP, as the bucket checks it. */
  readonly checksumSha256: string;
  readonly rowCounts: Readonly<Partial<Record<ClubDataExportDataset, number>>>;
}

/** The ZIP outgrew the largest `data_export` file: the export fails as `too_large`. */
export class ExportTooLargeError extends Error {
  override readonly name = 'ExportTooLargeError';
}

const TYPE_LABELS: Readonly<Record<CsvColumnType, string>> = {
  text: 'texto',
  code: 'codigo',
  integer: 'entero',
  decimal: 'decimal (coma)',
  date: 'fecha dd/mm/aaaa',
  datetime: 'fecha y hora dd/mm/aaaa HH:mm (hora del club)',
  boolean: 'si / no',
  list: 'lista separada por comas',
  json: 'JSON',
};

const TEXT: CsvColumn = { key: 'v', header: 'v', type: 'text', description: '' };

const encoder = new TextEncoder();

/**
 * Writes the ZIP of an export to `path`: each dataset streamed from the
 * database with a cursor in batches (memory stays flat whatever the size of
 * the club), then the column dictionary and the manifest. Runs on `client`,
 * which must be in a `REPEATABLE READ` transaction with the club's context:
 * every CSV comes from the same snapshot. Returns the size, the SHA-256 and
 * the rows per dataset.
 */
export async function writeExportZip(
  client: pg.ClientBase,
  spec: ExportSpec,
  path: string,
  maxSizeBytes: number,
): Promise<WrittenExport> {
  const out = createWriteStream(path);
  const hash = createHash('sha256');
  let sizeBytes = 0;
  const state: { zipError: Error | null } = { zipError: null };
  const closed = new Promise<void>((resolve, reject) => {
    out.on('finish', resolve);
    out.on('error', reject);
  });
  // Errors after the caller gave up would be unhandled otherwise.
  closed.catch(() => undefined);
  const zip = new Zip((error, chunk, final) => {
    if (error !== null) {
      state.zipError = error;
      return;
    }
    hash.update(chunk);
    sizeBytes += chunk.length;
    out.write(chunk);
    if (final) out.end();
  });

  const flush = async () => {
    if (state.zipError !== null) throw state.zipError;
    if (sizeBytes > maxSizeBytes) {
      throw new ExportTooLargeError(`The export exceeds ${String(maxSizeBytes)} bytes`);
    }
    if (out.writableNeedDrain) await once(out, 'drain');
  };

  const entry = (name: string) => {
    const file = new ZipDeflate(name, { level: 6 });
    zip.add(file);
    return {
      push: (text: string) => {
        file.push(encoder.encode(text));
      },
      end: () => {
        file.push(new Uint8Array(0), true);
      },
    };
  };

  try {
    const params = [
      [...spec.playerIds],
      spec.fromDate,
      spec.toDate,
      spec.requestedOn,
      JSON.stringify(spec.availability ?? {}),
    ];
    const rowCounts: Partial<Record<ClubDataExportDataset, number>> = {};
    for (const dataset of spec.datasets) {
      const definition = DATASETS[dataset];
      const file = entry(CLUB_DATA_EXPORT_FILE_NAMES[dataset]);
      file.push(csvHeader(definition.columns));
      let rows = 0;
      await client.query(
        `declare club_data_export_rows no scroll cursor for ${DATASET_ARGS} ${definition.query}`,
        params,
      );
      for (;;) {
        const batch = await client.query<Record<string, unknown>>(
          `fetch ${String(CLUB_DATA_EXPORT_BATCH_ROWS)} from club_data_export_rows`,
        );
        if (batch.rows.length === 0) break;
        let text = '';
        for (const row of batch.rows) text += csvRow(row, definition.columns, spec.club.timeZone);
        file.push(text);
        rows += batch.rows.length;
        await flush();
      }
      await client.query('close club_data_export_rows');
      file.end();
      rowCounts[dataset] = rows;
      await flush();
    }

    const dictionary = entry(CLUB_DATA_EXPORT_DICTIONARY_FILE);
    dictionary.push(dictionaryText(spec.datasets));
    dictionary.end();
    const manifest = entry(CLUB_DATA_EXPORT_MANIFEST_FILE);
    manifest.push(manifestText(spec, rowCounts));
    manifest.end();
    zip.end();
    await flush();
    await closed;
    if (state.zipError !== null) throw state.zipError;
    if (sizeBytes > maxSizeBytes) {
      throw new ExportTooLargeError(`The export exceeds ${String(maxSizeBytes)} bytes`);
    }
    return { sizeBytes, checksumSha256: hash.digest('base64'), rowCounts };
  } catch (error) {
    zip.terminate();
    out.destroy();
    throw error;
  }
}

/** `diccionario.csv`: every column of every CSV of the export, with its type and unit. */
export function dictionaryText(datasets: readonly ClubDataExportDataset[]): string {
  const columns: CsvColumn[] = [
    { key: 'file', header: 'archivo', type: 'text', description: '' },
    { key: 'column', header: 'columna', type: 'text', description: '' },
    { key: 'type', header: 'tipo', type: 'text', description: '' },
    { key: 'unit', header: 'unidad', type: 'text', description: '' },
    { key: 'description', header: 'descripcion', type: 'text', description: '' },
  ];
  let text = csvHeader(columns);
  for (const dataset of datasets) {
    for (const column of DATASETS[dataset].columns) {
      const unit = column.unit ?? null;
      text += csvLine([
        CLUB_DATA_EXPORT_FILE_NAMES[dataset],
        column.header,
        TYPE_LABELS[column.type],
        unit === null ? '' : isUnitCode(unit) ? unitLabelEsAr(unit) : unit,
        column.description,
      ]);
    }
  }
  return text;
}

/** `manifiesto.csv`: what the ZIP is, for whom it was made, and the rows of each CSV. */
export function manifestText(
  spec: ExportSpec,
  rowCounts: Readonly<Partial<Record<ClubDataExportDataset, number>>>,
): string {
  const zone = spec.club.timeZone;
  const text = (value: string | null) => formatCsvCell(value, TEXT, zone);
  const date = (value: LocalDate | null) => formatCsvCell(value, { ...TEXT, type: 'date' }, zone);
  const lines: [string, string][] = [
    ['formato', CLUB_DATA_EXPORT_FORMAT],
    ['version_formato', String(CLUB_DATA_EXPORT_FORMAT_VERSION)],
    ['exportacion_id', spec.id],
    ['club', text(spec.club.name)],
    ['club_id', spec.club.id],
    ['zona_horaria', spec.club.timeZone],
    ['generado', formatCsvCell(spec.generatedAt, { ...TEXT, type: 'datetime' }, zone)],
    ['dia_del_pedido', date(spec.requestedOn)],
    ['pedido_por', text(spec.requesterName)],
    ['rol', spec.requesterRole],
    ['desde', date(spec.fromDate)],
    ['hasta', date(spec.toDate)],
    ['jugadores_incluidos', String(spec.playerIds.length)],
    ['jugadores_sin_consentimiento_de_datos', String(spec.excludedPlayersN)],
  ];
  for (const dataset of spec.datasets) {
    const scope = isDatedClubDataExportDataset(dataset) ? '' : ' (sin filtro de fechas)';
    lines.push([
      `filas ${CLUB_DATA_EXPORT_FILE_NAMES[dataset]}${scope}`,
      String(rowCounts[dataset] ?? 0),
    ]);
  }
  return (
    csvHeader([
      { key: 'k', header: 'clave', type: 'text', description: '' },
      { key: 'v', header: 'valor', type: 'text', description: '' },
    ]) + lines.map((line) => csvLine(line)).join('')
  );
}
