import { CLUB_MODULES, type ClubModule } from '@sport-performance/domain';
import { z } from 'zod';
import { defineEndpoint } from '../endpoint.js';
import { expectedVersionSchema, resourceVersionSchema } from '../primitives/conventions.js';

/**
 * Active modules of the club (B-322): feature switches the web and the app
 * read to show or hide whole areas. The set and the defaults are the
 * domain's (`CLUB_MODULES`, `DEFAULT_CLUB_MODULES`).
 */

const MODULE_DESCRIPTIONS: Readonly<Record<ClubModule, string>> = {
  wellness: 'Bienestar antes de entrenar.',
  gym: 'Rutinas y series de gimnasio.',
  gps: 'Métricas de cancha por GPS (importaciones de Catapult, pods).',
  maturation: 'Maduración y crecimiento (PHV, % de talla adulta, velocidad de crecimiento).',
  pain_report: 'Reporte de dolor con mapa del cuerpo (requiere consentimiento de salud).',
  menstrual_cycle: 'Seguimiento del ciclo menstrual (opt-in, con consentimiento propio).',
};

function moduleShape<T extends z.ZodType>(
  value: (description: string) => T,
): Record<ClubModule, T> {
  return Object.fromEntries(
    CLUB_MODULES.map((module) => [module, value(MODULE_DESCRIPTIONS[module])]),
  ) as Record<ClubModule, T>;
}

export const clubModulesSchema = z
  .strictObject(moduleShape((description) => z.boolean().meta({ description })))
  .meta({ id: 'ClubModules', description: 'Cada módulo, prendido (`true`) o apagado.' });

export const clubModuleSettingsSchema = z
  .object({
    modules: clubModulesSchema,
    version: resourceVersionSchema.meta({
      description: 'Versión del club: cambia también con su perfil y su marca.',
    }),
  })
  .meta({ id: 'ClubModuleSettings' });

export type ClubModuleSettings = z.output<typeof clubModuleSettingsSchema>;

export const getClubModules = defineEndpoint({
  method: 'GET',
  path: '/v1/configuration/modules',
  summary: 'Módulos activos del club',
  description:
    'Todo miembro del club: la web y la app muestran u ocultan áreas enteras según esto. Los módulos que el club nunca tocó tienen su valor por defecto.',
  tags: ['configuration'],
  auth: 'club',
  response: { status: 200, description: 'Los módulos.', schema: clubModuleSettingsSchema },
  errors: [],
});

export const updateClubModules = defineEndpoint({
  method: 'PATCH',
  path: '/v1/configuration/modules',
  summary: 'Prender o apagar módulos',
  description:
    'Solo la administración (`admin` o superadmin en soporte), como el perfil del club. Se mandan solo los módulos que cambian. Apagar un módulo no borra datos: deja de mostrarse y de pedirse. `version` desactualizada: `conflict`.',
  tags: ['configuration'],
  auth: 'club',
  body: z.strictObject({
    version: expectedVersionSchema,
    modules: z
      .strictObject(moduleShape((description) => z.boolean().optional().meta({ description })))
      .meta({ description: 'Los módulos que cambian.' }),
  }),
  response: {
    status: 200,
    description: 'Los módulos actualizados.',
    schema: clubModuleSettingsSchema,
  },
  errors: ['conflict'],
});
