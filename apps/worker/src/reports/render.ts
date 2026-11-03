import type { PlayerReportContent, PlayerReportTest } from '@sport-performance/contracts';
import { changeIsImprovement, relativeChangePct, type LocalDate } from '@sport-performance/domain';
import {
  PLACEHOLDER,
  formatLocalDate,
  formatUnit,
  isMessageKey,
  type Translator,
} from '@sport-performance/i18n';
import {
  INK,
  MUTED,
  createReportLayout,
  type Cell,
  type Column,
  type RenderOptions,
} from './layout.js';

/**
 * The PDF of a player report (B-602, ADR 0071), laid out on the report page
 * (`layout.ts`) from the snapshot the API froze: a status always in words,
 * tables instead of charts (they print well, read aloud and are the
 * accessible form of every chart, CLAUDE.md).
 */

export { REPORT_FONTS, paperColors, type RenderOptions } from './layout.js';

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

export function testLabel(t: Translator['t'], testCode: string): string {
  const key = `test.${testCode}`;
  return isMessageKey(key) ? t(key) : testCode.replaceAll('_', ' ');
}

export function windowLabel(
  t: Translator['t'],
  column: { seasonName: string | null; number: number | null; startsOn: LocalDate },
): string {
  return column.number === null || column.seasonName === null
    ? t('report.evolution.day', { date: formatLocalDate(column.startsOn) })
    : t('report.evolution.window', { number: column.number, season: column.seasonName });
}

export function methodNames(
  t: Translator['t'],
  methods: readonly PlayerReportTest['methods'][number][],
) {
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
  const playerName = `${content.player.firstName} ${content.player.lastName}`;
  const windowName = t('report.window', {
    season: content.window.seasonName,
    number: content.window.number,
  });
  const sportKey = `sport.${content.player.sport}`;
  const layout = createReportLayout(
    {
      locale: content.locale,
      club: content.club,
      title: t('report.title'),
      subtitle: windowName,
      name: playerName,
      details: [
        t('report.player.birth', {
          date: formatLocalDate(content.player.birthDate),
          age: content.player.ageYears,
        }),
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
        `${t('report.windowDates', {
          from: formatLocalDate(content.window.startsOn),
          to: formatLocalDate(content.window.endsOn),
        })} · ${t('report.generatedOn', { date: formatLocalDate(content.generatedOn) })}`,
      ],
      documentTitle: `${t('report.title')} · ${playerName} · ${windowName}`,
    },
    options,
  );
  const { doc, width, section, paragraph, table, facts } = layout;

  if (!content.window.closed) {
    paragraph(t('report.windowOpen'), 9, MUTED);
    doc.y += 5;
  }

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
    facts(rows);
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

  return layout.finish(
    t('report.footer', {
      club: content.club.shortName ?? content.club.name,
      player: playerName,
      window: windowName,
    }),
  );
}
