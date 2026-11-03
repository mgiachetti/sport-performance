import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { NBSP } from '@sport-performance/i18n';
import { describe, expect, it } from 'vitest';
import { formatValue } from './format.js';
import * as core from './index.js';
import { STATUS_ICONS, isStatusLevel, statusLabel, statusLevels } from './status.js';
import { getDefaultTranslator } from './format.js';

describe('core', () => {
  it('has no React, React Native or DOM dependency (mobile reuses it)', () => {
    const dir = import.meta.dirname;
    for (const file of readdirSync(dir).filter(
      (name) => name.endsWith('.ts') && !name.endsWith('.test.ts'),
    )) {
      const source = readFileSync(join(dir, file), 'utf8');
      expect(source, file).not.toMatch(/from '(react|react-dom|react-native)[^']*'/);
      expect(source, file).not.toMatch(/\b(document|window)\.|\bHTMLElement\b/);
    }
  });

  it('exposes the layout of every chart type', () => {
    expect(typeof core.layoutLineChart).toBe('function');
    expect(typeof core.layoutBarChart).toBe('function');
    expect(typeof core.layoutSparkline).toBe('function');
    expect(typeof core.layoutHeatmap).toBe('function');
    expect(core.packageName).toBe('@sport-performance/charts');
  });
});

describe('formatValue', () => {
  it('writes es-AR numbers with the unit of the dictionary', () => {
    expect(formatValue(5.254, { unit: 's', decimals: 2 })).toBe(`5,25${NBSP}s`);
    expect(formatValue(1980, { unit: 'au' })).toBe(`1.980${NBSP}UA`);
    expect(formatValue(12.5, { unit: 'pct', decimals: 1 })).toBe(`12,5${NBSP}%`);
    expect(formatValue(1234.5)).toBe('1.234,5');
    expect(formatValue(null, { unit: 's' })).toBe('—');
  });
});

describe('status', () => {
  it('has a distinct glyph and a text label for every level', () => {
    const { t } = getDefaultTranslator();
    const shapes = statusLevels.map((level) => STATUS_ICONS[level].map((part) => part.d).join());
    expect(new Set(shapes).size).toBe(statusLevels.length);
    expect(statusLevels.map((level) => statusLabel(t, level))).toEqual([
      'Bien',
      'Atención',
      'Crítico',
    ]);
    expect(isStatusLevel('warning')).toBe(true);
    expect(isStatusLevel('red')).toBe(false);
  });
});
