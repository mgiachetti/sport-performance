/**
 * The scenes of the gallery, by name, and what the capture presses before the
 * screenshot (buttons by accessible name), so a step after a tap is captured
 * too. `scenes.tsx` renders each one; `capture.ts` walks this list.
 */
export interface SceneSpec {
  readonly name: string;
  /** Accessible names of buttons or radios to press, in order. */
  readonly press?: readonly string[];
}

export const SCENES: readonly SceneSpec[] = [
  { name: 'sign-in' },
  { name: 'verify-code' },
  { name: 'player-access' },
  { name: 'select-club' },
  { name: 'player-today-faces' },
  {
    name: 'player-today-faces-filled',
    press: ['Sueño: Bien', 'Fatiga: Normal', 'RPE 7: Muy duro'],
  },
  { name: 'player-today-scale' },
  { name: 'player-today-done' },
  { name: 'player-today-done-open', press: ['Bienestar cargado. Promedio 3,6 de 5'] },
  { name: 'player-today-rpe-pending' },
  { name: 'player-today-offline' },
  { name: 'player-tests' },
  { name: 'player-tests-m13' },
  { name: 'player-consents' },
  { name: 'staff-home' },
  { name: 'staff-board' },
  { name: 'staff-board-cached' },
  { name: 'staff-alert' },
  { name: 'kiosk-setup' },
  { name: 'kiosk-pick' },
  { name: 'kiosk-turn-confirm' },
  { name: 'kiosk-turn-wellness', press: ['Sí, soy yo'] },
  { name: 'kiosk-exit' },
  { name: 'account' },
  { name: 'account-offline' },
  { name: 'select-club-none' },
];
