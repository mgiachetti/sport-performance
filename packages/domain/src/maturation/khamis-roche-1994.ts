import type { KhamisRocheRow, KhamisRocheTable } from './khamis-roche.js';

/**
 * Khamis-Roche 1994 coefficients for white American children (Fels
 * Longitudinal Study), ages 4.0 to 17.5 in half years, in the paper's units:
 *
 *   adult stature (in) = β0 + β1 · stature (in) + β2 · weight (lb) + β3 · midparent stature (in)
 *
 * Weight coefficients are the corrected ones from the erratum (Pediatrics
 * 1995;95(3):457): the 1994 printing has them one decimal place too small.
 *
 * Status: `cross_checked_secondary_sources`. The original article and the
 * erratum could not be retrieved (publisher paywall). TODO(B-203): compare every
 * value with the article and the erratum before production and record it in the
 * README checklist; then set `verification` to `verified_against_publication`.
 *
 * Sources compared value by value (all rows agree unless noted):
 * - vildaclinic/vilda-calc `vilda_khamis_roche.js` (erratum values).
 * - 2nk1/performance-monitor `src/lib/growth/khamis-roche.ts` (erratum values).
 * - DadosGPS/Ulisses-Dashboard `web/lib/khamis-roche.ts` (boys only, erratum values).
 * - CRAN matuR `data/table.rda`: same β0, β1 and β3; weight column as printed in
 *   1994 (one tenth of the erratum), except three slips for boys (+0.006478 at
 *   5.0 years; erratum-scale values at 7.5 and 9.0). Consistent with the erratum
 *   being a ×10 correction of that column.
 * Girls 5.0 years β0: -5.13582 in matuR and 2nk1, -5.13583 in vilda-calc.
 */
const MALE: readonly KhamisRocheRow[] = rows([
  [4.0, -10.2567, 1.23812, -0.087235, 0.50286],
  [4.5, -10.719, 1.15964, -0.074454, 0.52887],
  [5.0, -11.0213, 1.10674, -0.064778, 0.53919],
  [5.5, -11.1556, 1.0748, -0.05776, 0.53691],
  [6.0, -11.1138, 1.05923, -0.052947, 0.52513],
  [6.5, -11.0221, 1.05542, -0.049892, 0.50692],
  [7.0, -10.9984, 1.05877, -0.048144, 0.48538],
  [7.5, -11.0214, 1.06467, -0.047256, 0.46361],
  [8.0, -11.0696, 1.06853, -0.046778, 0.44469],
  [8.5, -11.122, 1.06572, -0.046261, 0.43171],
  [9.0, -11.1571, 1.05166, -0.045254, 0.42776],
  [9.5, -11.1405, 1.02174, -0.043311, 0.43593],
  [10.0, -11.038, 0.97135, -0.039981, 0.45932],
  [10.5, -10.8286, 0.89589, -0.034814, 0.50101],
  [11.0, -10.4917, 0.81239, -0.02905, 0.54781],
  [11.5, -10.0065, 0.74134, -0.024167, 0.58409],
  [12.0, -9.3522, 0.68325, -0.020076, 0.60927],
  [12.5, -8.6055, 0.63869, -0.016681, 0.62279],
  [13.0, -7.8632, 0.60818, -0.013895, 0.62407],
  [13.5, -7.1348, 0.59228, -0.011624, 0.61253],
  [14.0, -6.4299, 0.59151, -0.009776, 0.58762],
  [14.5, -5.7578, 0.60643, -0.008261, 0.54875],
  [15.0, -5.1282, 0.63757, -0.006988, 0.49536],
  [15.5, -4.5092, 0.68548, -0.005863, 0.42687],
  [16.0, -3.9292, 0.75069, -0.004795, 0.34271],
  [16.5, -3.4873, 0.83375, -0.003695, 0.24231],
  [17.0, -3.283, 0.9352, -0.00247, 0.1251],
  [17.5, -3.4156, 1.05558, -0.001027, -0.0095],
]);

const FEMALE: readonly KhamisRocheRow[] = rows([
  [4.0, -8.1325, 1.24768, -0.19435, 0.44774],
  [4.5, -6.47656, 1.22177, -0.18519, 0.41381],
  [5.0, -5.13582, 1.19932, -0.1753, 0.38467],
  [5.5, -4.13791, 1.1788, -0.16484, 0.36039],
  [6.0, -3.51039, 1.15866, -0.154, 0.34105],
  [6.5, -3.14322, 1.13737, -0.14294, 0.32672],
  [7.0, -2.87645, 1.11342, -0.13184, 0.31748],
  [7.5, -2.66291, 1.08525, -0.12086, 0.3134],
  [8.0, -2.45559, 1.05135, -0.11019, 0.31457],
  [8.5, -2.20728, 1.01018, -0.09999, 0.32105],
  [9.0, -1.87098, 0.9602, -0.09044, 0.33291],
  [9.5, -1.0633, 0.89989, -0.08171, 0.35025],
  [10.0, 0.33468, 0.82771, -0.07397, 0.37312],
  [10.5, 1.97366, 0.74213, -0.06739, 0.40161],
  [11.0, 3.50436, 0.67173, -0.06136, 0.42042],
  [11.5, 4.57747, 0.6415, -0.05518, 0.41686],
  [12.0, 4.84365, 0.64452, -0.04894, 0.3949],
  [12.5, 4.27869, 0.67386, -0.04272, 0.3585],
  [13.0, 3.21417, 0.7226, -0.03661, 0.31163],
  [13.5, 1.83456, 0.78383, -0.03067, 0.25826],
  [14.0, 0.32425, 0.85062, -0.025, 0.20235],
  [14.5, -1.13224, 0.91605, -0.01967, 0.14787],
  [15.0, -2.35055, 0.97319, -0.01477, 0.0988],
  [15.5, -3.10326, 1.01514, -0.01037, 0.05909],
  [16.0, -3.17885, 1.03496, -0.00655, 0.03272],
  [16.5, -2.41657, 1.02573, -0.0034, 0.02364],
  [17.0, -0.65579, 0.98054, -0.001, 0.03584],
  [17.5, 2.26429, 0.89246, 0.00057, 0.07327],
]);

/** Default Khamis-Roche table. Seed source for B-306; clubs may not edit it. */
export const KHAMIS_ROCHE_1994_TABLE: KhamisRocheTable = {
  code: 'khamis_roche_1994',
  provenance: {
    citation:
      'Khamis HJ, Roche AF. Predicting adult stature without using skeletal age: the Khamis-Roche method. Pediatrics. 1994;94(4 Pt 1):504-507.',
    doi: null,
    errata: ['Pediatrics. 1995;95(3):457 (weight coefficients).'],
    verification: 'cross_checked_secondary_sources',
    verificationNotes:
      'Values agree across vilda-calc, 2nk1/performance-monitor, DadosGPS/Ulisses-Dashboard (boys) and CRAN matuR ' +
      '(1994 printing of the weight column). Girls 5.0 yr intercept: -5.13582 (2 sources) vs -5.13583 (1 source). ' +
      'TODO: compare with the original article and erratum before production.',
  },
  rows: { male: MALE, female: FEMALE },
};

type RawRow = readonly [
  ageYears: number,
  interceptIn: number,
  heightInCoef: number,
  weightLbCoef: number,
  midparentHeightInCoef: number,
];

function rows(raw: readonly RawRow[]): readonly KhamisRocheRow[] {
  return raw.map(([ageYears, interceptIn, heightInCoef, weightLbCoef, midparentHeightInCoef]) => ({
    ageYears,
    interceptIn,
    heightInCoef,
    weightLbCoef,
    midparentHeightInCoef,
  }));
}
