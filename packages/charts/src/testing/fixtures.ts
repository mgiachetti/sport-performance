import type { BarChartSpec } from '../core/bar.js';
import type { HeatmapSpec } from '../core/heatmap.js';
import type { LineChartSpec } from '../core/line.js';
import type { SparklineSpec } from '../core/sparkline.js';

const WINDOWS = ['V1 25', 'V2 25', 'V3 25', 'V4 25', 'V1 26'];

/** Sprint 40 m of a player across test windows, with the M17 average and the first team. */
export const sprintSpec: LineChartSpec = {
  title: 'Sprint 40 m',
  format: { unit: 's', decimals: 2 },
  categories: WINDOWS.map((label) => ({ key: label, label })),
  series: [
    {
      id: 'avg',
      role: 'categoryAverage',
      label: 'Promedio M17',
      values: [5.68, 5.61, 5.55, 5.52, 5.49],
    },
    {
      id: 'player',
      role: 'player',
      label: 'Tomás Pérez',
      values: [5.62, 5.55, null, 5.41, 5.31],
      statuses: [null, null, null, 'warning', 'ok'],
    },
  ],
  reference: { value: 5.25 },
};

/** Weekly team load with the chronic EWMA over it. */
export const weeklyLoadSpec: BarChartSpec = {
  title: 'Carga semanal',
  format: { unit: 'au' },
  valueLabel: 'Carga',
  bars: [
    { key: 'S41', label: 'S41', name: 'Semana 41', value: 1480 },
    { key: 'S42', label: 'S42', name: 'Semana 42', value: 1720 },
    { key: 'S43', label: 'S43', name: 'Semana 43', value: null },
    { key: 'S44', label: 'S44', name: 'Semana 44', value: 1980, status: 'critical' },
  ],
  overlay: { label: 'Crónica', values: [1550, 1600, 1600, 1710] },
};

/** Distance per player of one session, forwards and backs in two tones. */
export const sessionSpec: BarChartSpec = {
  title: 'Distancia por jugador',
  format: { unit: 'm' },
  tones: { brand: 'Backs', neutral: 'Delanteros' },
  directLabel: 'max',
  bars: [
    { key: 'p1', label: '1', name: 'Juan', value: 4820, tone: 'neutral' },
    { key: 'p9', label: '9', name: 'Lucas', value: 6010, tone: 'brand' },
    { key: 'p15', label: '15', name: 'Bruno', value: 5750, tone: 'brand' },
  ],
  reference: { value: 5800, label: 'Primera' },
};

/** Wellness per player and day, with a missing answer. */
export const wellnessSpec: HeatmapSpec = {
  title: 'Bienestar de la semana',
  format: { decimals: 1 },
  domain: [1, 5],
  rows: [
    { key: 'p1', label: 'Juan' },
    { key: 'p2', label: 'Lucas' },
  ],
  columns: [
    { key: 'mon', label: 'Lun' },
    { key: 'tue', label: 'Mar' },
    { key: 'wed', label: 'Mié' },
  ],
  values: [
    [4.2, 3.1, null],
    [2.6, 4.8, 3.6],
  ],
};

export const cmjSparkSpec: SparklineSpec = {
  title: 'CMJ',
  format: { unit: 'cm', decimals: 1 },
  categories: WINDOWS.map((label) => ({ key: label, label })),
  values: [38.2, 39.5, 40.1, null, 41.7],
  reference: { value: 45 },
};
