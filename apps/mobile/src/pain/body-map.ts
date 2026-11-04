import {
  painAreaKey,
  painSidesForRegion,
  type PainBodyRegion,
  type PainSide,
} from '@sport-performance/domain';

/**
 * The body map of the pain report (B-609, ADR 0078): where each area of the
 * domain vocabulary is drawn, in a front and a back view. Coordinates are
 * percentages of a box twice as tall as wide-ish (100 × 220 units), so the
 * screen scales it to any width.
 *
 * On the front view the player faces us: their right side is on the left of
 * the screen. On the back view, their right is on the right. A region in
 * both views (a shoulder, the neck) is the same area: marking it in one view
 * marks it in the other.
 */

export const BODY_MAP_VIEWS = ['front', 'back'] as const;
export type BodyMapView = (typeof BODY_MAP_VIEWS)[number];

/** Width and height of the map, in its own units. */
export const BODY_MAP_WIDTH = 100;
export const BODY_MAP_HEIGHT = 220;

interface Box {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface BodyMapPlace extends Box {
  readonly region: PainBodyRegion;
  readonly side: PainSide;
  /** `region:side`, the identity of the area (`painAreaKey`). */
  readonly key: string;
}

/** Midline areas, by view. */
const CENTRAL: Readonly<Record<BodyMapView, readonly [PainBodyRegion, Box][]>> = {
  front: [
    ['head_face', { x: 40, y: 2, w: 20, h: 22 }],
    ['neck', { x: 44, y: 25, w: 12, h: 9 }],
    ['chest', { x: 33, y: 36, w: 34, h: 26 }],
    ['abdomen', { x: 34, y: 64, w: 32, h: 34 }],
  ],
  back: [
    ['neck', { x: 44, y: 25, w: 12, h: 9 }],
    ['thoracic_spine', { x: 40, y: 36, w: 20, h: 30 }],
    ['lumbar_spine', { x: 40, y: 68, w: 20, h: 30 }],
  ],
};

/** Lateral areas, drawn on the left half of the screen (mirrored for the other side). */
const LATERAL: Readonly<Record<BodyMapView, readonly [PainBodyRegion, Box][]>> = {
  front: [
    ['shoulder', { x: 18, y: 36, w: 14, h: 13 }],
    ['upper_arm', { x: 13, y: 51, w: 12, h: 23 }],
    ['elbow', { x: 10, y: 76, w: 12, h: 10 }],
    ['forearm', { x: 7, y: 88, w: 12, h: 20 }],
    ['wrist_hand', { x: 2, y: 110, w: 15, h: 16 }],
    ['pelvis_hip_groin', { x: 32, y: 100, w: 17, h: 16 }],
    ['thigh_anterior', { x: 31, y: 118, w: 17, h: 30 }],
    ['knee', { x: 32, y: 150, w: 15, h: 12 }],
    ['lower_leg', { x: 33, y: 164, w: 13, h: 28 }],
    ['ankle', { x: 34, y: 194, w: 11, h: 8 }],
    ['foot', { x: 30, y: 204, w: 16, h: 12 }],
  ],
  back: [
    ['shoulder', { x: 18, y: 36, w: 14, h: 13 }],
    ['upper_arm', { x: 13, y: 51, w: 12, h: 23 }],
    ['elbow', { x: 10, y: 76, w: 12, h: 10 }],
    ['pelvis_hip_groin', { x: 32, y: 100, w: 17, h: 16 }],
    ['thigh_posterior', { x: 31, y: 118, w: 17, h: 30 }],
    ['knee', { x: 32, y: 150, w: 15, h: 12 }],
    ['lower_leg', { x: 33, y: 164, w: 13, h: 28 }],
    ['ankle', { x: 34, y: 194, w: 11, h: 8 }],
  ],
};

const mirrored = (box: Box): Box => ({ ...box, x: BODY_MAP_WIDTH - box.x - box.w });

/** The side drawn on the left half of the screen in a view. */
function sideOnScreenLeft(view: BodyMapView): PainSide {
  return view === 'front' ? 'right' : 'left';
}

/**
 * The places of a view, in reading order (top to bottom, then left to right
 * on the screen): what a screen reader goes through.
 */
export function bodyMapPlaces(view: BodyMapView): readonly BodyMapPlace[] {
  const left = sideOnScreenLeft(view);
  const right: PainSide = left === 'left' ? 'right' : 'left';
  const places: BodyMapPlace[] = [
    ...CENTRAL[view].map(([region, box]) => ({
      region,
      side: 'central' as const,
      key: painAreaKey({ region, side: 'central' }),
      ...box,
    })),
    ...LATERAL[view].flatMap(([region, box]) => [
      { region, side: left, key: painAreaKey({ region, side: left }), ...box },
      { region, side: right, key: painAreaKey({ region, side: right }), ...mirrored(box) },
    ]),
  ];
  return places.sort((a, b) => a.y - b.y || a.x - b.x);
}

/** Every area the map can mark, with the views it is drawn in. */
export function bodyMapAreas(): ReadonlyMap<string, readonly BodyMapView[]> {
  const views = new Map<string, BodyMapView[]>();
  for (const view of BODY_MAP_VIEWS) {
    for (const place of bodyMapPlaces(view)) {
      views.set(place.key, [...(views.get(place.key) ?? []), view]);
    }
  }
  return views;
}

/** Whether a side is one the region takes (the map never draws another). */
export function isPlaceOfRegion(region: PainBodyRegion, side: PainSide): boolean {
  return painSidesForRegion(region).includes(side);
}
