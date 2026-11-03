import type {
  CategoryReportContent,
  CategoryReportResponseCount,
} from '@sport-performance/contracts';
import { CATEGORY_REPORT_MIN_PLAYERS, responseRatePct } from '@sport-performance/domain';
import {
  PLACEHOLDER,
  formatLocalDate,
  formatUnit,
  isMessageKey,
  type Translator,
} from '@sport-performance/i18n';
import { INK, MUTED, createReportLayout, type Cell, type Column } from './layout.js';
import type { RenderOptions } from './layout.js';
import { methodNames, metricLabel, testLabel, windowLabel } from './render.js';

/**
 * The PDF of a category report (B-603, ADR 0073), laid out on the report
 * page (`layout.ts`) from the snapshot the API froze: the roster, the battery
 * done, the group's evolution and the response rate. Aggregates only, every
 * status in words, tables instead of charts.
 */

/** "75 % (30 de 40)", or "Sin datos" when nothing was expected. */
export function rateText(t: Translator['t'], count: CategoryReportResponseCount): string {
  const rate = responseRatePct(count.answered, count.expected);
  if (rate === null) return t('categoryReport.responses.none');
  return t('categoryReport.responses.rate', {
    rate: formatUnit(rate, 'pct', { decimals: 0 }),
    answered: count.answered,
    expected: count.expected,
  });
}

const label = (t: Translator['t'], key: string, fallback: string) =>
  isMessageKey(key) ? t(key) : fallback;

/** Renders the report; resolves the bytes of the PDF. */
export async function renderCategoryReport(
  content: CategoryReportContent,
  options: RenderOptions,
): Promise<Uint8Array> {
  const { t } = options.translator;
  const windowName = t('report.window', {
    season: content.window.seasonName,
    number: content.window.number,
  });
  const { roster } = content;
  const layout = createReportLayout(
    {
      locale: content.locale,
      club: content.club,
      title: t('categoryReport.title'),
      subtitle: windowName,
      name: content.category.name,
      details: [
        t('categoryReport.category.detail', {
          sport: label(t, `sport.${content.category.sport}`, content.category.sport),
          sex: label(t, `sex.${content.category.sex}`, content.category.sex),
        }),
        t('categoryReport.roster', { players: roster.players }),
        ...(roster.byStage.length === 0
          ? []
          : [
              t('categoryReport.roster.byStage', {
                stages: roster.byStage
                  .map((s) =>
                    t('categoryReport.roster.stage', {
                      stage: label(t, `categoryReport.stage.${s.stage}`, s.stage),
                      players: s.players,
                    }),
                  )
                  .join(' · '),
              }),
            ]),
        `${t('report.windowDates', {
          from: formatLocalDate(content.window.startsOn),
          to: formatLocalDate(content.window.endsOn),
        })} · ${t('report.generatedOn', { date: formatLocalDate(content.generatedOn) })}`,
      ],
      documentTitle: `${t('categoryReport.title')} · ${content.category.name} · ${windowName}`,
    },
    options,
  );
  const { doc, width, section, paragraph, table } = layout;
  const share = (fraction: number) => Math.floor(width * fraction);

  if (!content.window.closed) {
    paragraph(t('categoryReport.windowOpen'), 9, MUTED);
    doc.y += 5;
  }
  // Read with the requester's RLS: never hand over partial numbers as if they were the whole.
  if (!content.scope.complete) {
    paragraph(t('categoryReport.partialScope'), 9.5, INK);
    doc.y += 5;
  }

  // ─── Battery of the window ───────────────────────────────────────────────────────────
  section(t('categoryReport.battery.title'));
  if (content.battery.length === 0) {
    paragraph(t('categoryReport.battery.empty'), 10, MUTED);
  } else {
    paragraph(t('categoryReport.battery.description'), 8.5, MUTED);
    const first = share(0.22);
    const expected = share(0.11);
    const done = share(0.12);
    const each = Math.floor((width - first - expected - done) / 5);
    const columns: Column[] = [
      { header: t('categoryReport.battery.test'), width: first },
      { header: t('categoryReport.battery.expected'), width: expected, align: 'right' },
      { header: t('categoryReport.battery.done'), width: done, align: 'right' },
      { header: t('categoryReport.battery.absent'), width: each, align: 'right' },
      { header: t('categoryReport.battery.unavailable'), width: each, align: 'right' },
      { header: t('categoryReport.battery.notApplicable'), width: each, align: 'right' },
      { header: t('categoryReport.battery.other'), width: each, align: 'right' },
      { header: t('categoryReport.battery.noRecord'), width: each, align: 'right' },
    ];
    const total = content.battery.reduce(
      (sum, test) => ({
        expected: sum.expected + test.expected,
        done: sum.done + test.done,
        absent: sum.absent + test.notDone.absent,
        unavailable: sum.unavailable + test.notDone.unavailable,
        notApplicableToStage: sum.notApplicableToStage + test.notDone.notApplicableToStage,
        other: sum.other + test.notDone.other,
        noRecord: sum.noRecord + test.noRecord,
      }),
      {
        expected: 0,
        done: 0,
        absent: 0,
        unavailable: 0,
        notApplicableToStage: 0,
        other: 0,
        noRecord: 0,
      },
    );
    const row = (
      name: string,
      counts: {
        expected: number;
        done: number;
        absent: number;
        unavailable: number;
        notApplicableToStage: number;
        other: number;
        noRecord: number;
      },
    ): Cell[] => {
      const pct = counts.expected === 0 ? null : (counts.done / counts.expected) * 100;
      return [
        { text: name },
        { text: String(counts.expected) },
        { text: String(counts.done), note: formatUnit(pct, 'pct', { decimals: 0 }) },
        { text: String(counts.absent) },
        { text: String(counts.unavailable) },
        { text: String(counts.notApplicableToStage) },
        { text: String(counts.other) },
        { text: String(counts.noRecord) },
      ];
    };
    table(columns, [
      ...content.battery.map((test) =>
        row(testLabel(t, test.testCode), {
          expected: test.expected,
          done: test.done,
          ...test.notDone,
          noRecord: test.noRecord,
        }),
      ),
      row(t('categoryReport.battery.total'), total),
    ]);
  }

  // ─── Evolution of the group ──────────────────────────────────────────────────────────
  section(t('categoryReport.evolution.title'));
  const { columns: windows, metrics } = content.evolution;
  if (metrics.length === 0) {
    paragraph(t('categoryReport.evolution.empty'), 10, MUTED);
  } else {
    paragraph(
      t('categoryReport.evolution.description', { min: CATEGORY_REPORT_MIN_PLAYERS }),
      8.5,
      MUTED,
    );
    const first = share(0.26);
    const reference = share(0.12);
    const each = Math.floor((width - first - reference) / Math.max(windows.length, 1));
    const columns: Column[] = [
      { header: t('categoryReport.evolution.metric'), width: first },
      ...windows.map((column) => ({
        header: windowLabel(t, column),
        width: each,
        align: 'right' as const,
      })),
      { header: t('categoryReport.evolution.firstTeam'), width: reference, align: 'right' },
    ];
    table(
      columns,
      metrics.map((metric) => [
        { text: metricLabel(t, metric.metricCode, metric.exercise) },
        ...windows.map((column): Cell => {
          const point = metric.points.find((p) => p.columnKey === column.key);
          if (point === undefined || point.average === null || point.players === null) {
            return { text: PLACEHOLDER };
          }
          return {
            text: formatUnit(point.average, metric.unit),
            note: t('categoryReport.evolution.players', { players: point.players }),
          };
        }),
        {
          text:
            metric.firstTeam === null
              ? PLACEHOLDER
              : formatUnit(metric.firstTeam.value, metric.firstTeam.unit),
        },
      ]),
    );
    const windowOf = new Map(windows.map((column) => [column.key, column]));
    for (const metric of metrics) {
      const name = metricLabel(t, metric.metricCode, metric.exercise);
      for (const point of metric.points) {
        const column = windowOf.get(point.columnKey);
        if (column === undefined || point.average === null) continue;
        if (point.methods.length > 1) {
          paragraph(
            t('categoryReport.warning.mixedMethods', {
              metric: name,
              window: windowLabel(t, column),
              methods: methodNames(t, point.methods),
            }),
            8.5,
            MUTED,
          );
        }
        if (point.protocolVersions.length > 1) {
          paragraph(
            t('categoryReport.warning.mixedProtocols', {
              metric: name,
              window: windowLabel(t, column),
            }),
            8.5,
            MUTED,
          );
        }
      }
    }

    section(t('categoryReport.change.title'));
    paragraph(t('categoryReport.change.description'), 8.5, MUTED);
    const changes = metrics.filter((metric) => metric.change !== null);
    if (changes.length === 0) paragraph(t('categoryReport.change.empty'), 10, MUTED);
    for (const metric of changes) {
      const { change } = metric;
      if (change === null) continue;
      const from = windowOf.get(change.fromColumnKey);
      paragraph(
        t('categoryReport.change.item', {
          metric: metricLabel(t, metric.metricCode, metric.exercise),
          window: from === undefined ? PLACEHOLDER : windowLabel(t, from),
          improved: change.improved,
          worsened: change.worsened,
          unchanged: change.unchanged,
          paired: change.paired,
        }),
      );
    }
  }

  // ─── Response rate ───────────────────────────────────────────────────────────────────
  section(t('categoryReport.responses.title'));
  const { responses } = content;
  paragraph(
    t('categoryReport.responses.description', {
      from: formatLocalDate(responses.from),
      to: formatLocalDate(responses.to),
    }),
    8.5,
    MUTED,
  );
  if (responses.sessionDays === 0) {
    paragraph(t('categoryReport.responses.empty'), 10, MUTED);
  } else {
    paragraph(t('categoryReport.responses.sessionDays', { days: responses.sessionDays }), 9.5);
    const first = share(0.3);
    const half = Math.floor((width - first) / 2);
    table(
      [
        { header: t('categoryReport.responses.week'), width: first },
        { header: t('categoryReport.responses.wellness'), width: half, align: 'right' },
        { header: t('categoryReport.responses.rpe'), width: width - first - half, align: 'right' },
      ],
      [
        ...responses.weeks.map((week) => [
          { text: formatLocalDate(week.weekStart) },
          { text: rateText(t, week.wellness) },
          { text: rateText(t, week.rpe) },
        ]),
        [
          { text: t('categoryReport.responses.total') },
          { text: rateText(t, responses.wellness) },
          { text: rateText(t, responses.rpe) },
        ],
      ],
    );
  }

  // ─── How to read it ──────────────────────────────────────────────────────────────────
  section(t('categoryReport.notes.title'));
  paragraph(t('categoryReport.notes.aggregates', { min: CATEGORY_REPORT_MIN_PLAYERS }), 8.5, MUTED);
  paragraph(t('categoryReport.notes.method'), 8.5, MUTED);
  paragraph(t('categoryReport.notes.unavailable'), 8.5, MUTED);
  paragraph(t('categoryReport.notes.firstTeam'), 8.5, MUTED);
  doc.y += 4;
  paragraph(t('report.legal'), 9, INK);

  return layout.finish(
    t('categoryReport.footer', {
      club: content.club.shortName ?? content.club.name,
      category: content.category.name,
      window: windowName,
    }),
  );
}
