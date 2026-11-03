import { isSex, type Sex } from '@sport-performance/domain';

/** Sections of the configuration screen, in the order of its tabs. */
export const CONFIGURATION_SECTIONS = [
  'battery',
  'speed-zones',
  'alert-rules',
  'references',
] as const;
export type ConfigurationSection = (typeof CONFIGURATION_SECTIONS)[number];

export interface ConfigurationSearch {
  readonly section?: ConfigurationSection | undefined;
  readonly sex?: Sex | undefined;
}

function isSection(value: unknown): value is ConfigurationSection {
  return (CONFIGURATION_SECTIONS as readonly unknown[]).includes(value);
}

/** `validateSearch` of `/configuration`: drops anything malformed. */
export function parseConfigurationSearch(
  search: Readonly<Record<string, unknown>>,
): ConfigurationSearch {
  return {
    ...(isSection(search.section) ? { section: search.section } : {}),
    ...(isSex(search.sex) ? { sex: search.sex } : {}),
  };
}
