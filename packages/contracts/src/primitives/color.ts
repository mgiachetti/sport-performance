import { z } from 'zod';

/** Pattern for a 6-digit hex color, case-insensitive. */
export const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

/** sRGB color as `#RRGGBB`. No alpha and no shorthand: tokens derive variants. */
export const hexColorSchema = z
  .string()
  .regex(HEX_COLOR_PATTERN)
  .meta({
    description: 'Color sRGB `#RRGGBB` (sin alfa ni forma corta).',
    examples: ['#F1882A'],
  });
