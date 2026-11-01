import type { Linter } from 'eslint';

export interface ConfigOptions {
  /** Directory that contains the package's `tsconfig.json` (use `import.meta.dirname`). */
  tsconfigRootDir: string;
  /** Use browser globals instead of Node globals. */
  browser?: boolean;
}

export declare function createConfig(options: ConfigOptions): Linter.Config[];
