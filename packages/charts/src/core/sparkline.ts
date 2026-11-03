import { REFERENCE_DASH, checkLength, checkSize, seriesSummary, translatorOf } from './common.js';
import { formatValue } from './format.js';
import { linePath, type Point } from './geometry.js';
import { extent, linearScale } from './scale.js';
import type {
  ChartCategory,
  ChartReference,
  ChartSize,
  ChartSpecBase,
  ChartTable,
  LayoutOptions,
} from './types.js';

/** Mini chart for tiles and lists: one series in the brand color, no axes. */
export interface SparklineSpec extends ChartSpecBase {
  readonly categories: readonly ChartCategory[];
  readonly values: readonly (number | null)[];
  /** Name of the series in the summary and table. Defaults to the title. */
  readonly label?: string | undefined;
  readonly reference?: ChartReference | undefined;
}

export interface SparklineLayout {
  readonly width: number;
  readonly height: number;
  readonly empty: boolean;
  readonly path: string;
  /** The latest value, drawn as the end dot. */
  readonly last?: Point | undefined;
  /** Dashed reference line (no label: it would not fit; the summary and table name it). */
  readonly reference?: { readonly y: number; readonly dash: readonly [number, number] } | undefined;
}

/** Room for the end dot (r 4 + 2 px ring). */
const PAD_PX = 6;

export function layoutSparkline(spec: SparklineSpec, size: ChartSize): SparklineLayout {
  checkSize(size.width, size.height);
  checkLength('sparkline', spec.values.length, spec.categories.length);
  const { width, height } = size;
  const range = extent([...spec.values, spec.reference?.value]);
  const hasValue = spec.values.some((value) => value !== null && Number.isFinite(value));
  if (range === null || !hasValue) return { width, height, empty: true, path: '' };

  const y = linearScale(range, [height - PAD_PX, PAD_PX]);
  const n = spec.values.length;
  const x = (index: number): number =>
    n === 1 ? width / 2 : PAD_PX + (index * (width - 2 * PAD_PX)) / (n - 1);
  const points = spec.values.map((value, index) =>
    value === null || !Number.isFinite(value) ? null : { x: x(index), y: y(value) },
  );
  const last = [...points].reverse().find((point): point is Point => point !== null);
  return {
    width,
    height,
    empty: false,
    path: linePath(points),
    last,
    reference:
      spec.reference === undefined
        ? undefined
        : { y: y(spec.reference.value), dash: REFERENCE_DASH },
  };
}

export function sparklineSummary(spec: SparklineSpec, options?: LayoutOptions): string {
  const { t } = translatorOf(options);
  if (!spec.values.some((value) => value !== null && Number.isFinite(value))) {
    return t('chart.summary.empty', { title: spec.title });
  }
  const parts = [
    spec.title + '.',
    seriesSummary(t, spec.label ?? spec.title, spec.values, spec.categories, spec.format),
  ];
  if (spec.reference !== undefined) {
    parts.push(
      t('chart.summary.reference', {
        label: spec.reference.label ?? t('chart.reference.firstTeam'),
        value: formatValue(spec.reference.value, spec.format),
      }),
    );
  }
  return parts.join(' ');
}

export function sparklineTable(spec: SparklineSpec, options?: LayoutOptions): ChartTable {
  const { t } = translatorOf(options);
  return {
    caption: t('chart.table.caption', { title: spec.title }),
    rowHeader: t('chart.table.item'),
    columns: [
      { key: 'value', label: spec.label ?? t('chart.table.value'), numeric: true },
      ...(spec.reference === undefined
        ? []
        : [
            {
              key: 'reference',
              label: spec.reference.label ?? t('chart.reference.firstTeam'),
              numeric: true,
            },
          ]),
    ],
    rows: spec.categories.map((category, index) => ({
      key: category.key,
      header: category.label,
      cells: [
        { text: formatValue(spec.values[index], spec.format) },
        ...(spec.reference === undefined
          ? []
          : [{ text: formatValue(spec.reference.value, spec.format) }]),
      ],
    })),
  };
}
