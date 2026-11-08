import { CONSENT_SIGNERS, CONSENT_STATES, CONSENT_TYPES } from '@sport-performance/domain';
import { z } from 'zod';
import { defineEndpoint } from '../endpoint.js';
import { clientUuidSchema, sortQuerySchema } from '../primitives/conventions.js';
import { dateTimeSchema, localDateSchema } from '../primitives/dates.js';
import { idOf, playerIdSchema, userIdSchema } from '../primitives/ids.js';
import { pageOf, pageQuerySchema } from '../primitives/pagination.js';
import { localeSchema } from './clubs.js';

/**
 * Consents (B-312, Ley 25.326, ADR 0043): the club publishes versioned texts
 * of each type (`data`, `image`, `health`); the guardian of a minor, or the
 * player once of age, signs the current version and may revoke it. Without a
 * current consent of a type, the API refuses to store data of that type
 * (`consent_required`).
 */

/** Longest version tag of a consent text (the `consent_document_version_format` check). */
export const CONSENT_DOCUMENT_VERSION_MAX_LENGTH = 40;
export const CONSENT_DOCUMENT_TITLE_MAX_LENGTH = 200;
export const CONSENT_DOCUMENT_BODY_MAX_LENGTH = 50_000;

export const consentTypeSchema = z.enum(CONSENT_TYPES).meta({
  id: 'ConsentType',
  description:
    'Tipo de consentimiento: `data` (datos personales), `image` (videos del CMJ, fotos), `health` (datos de salud), `menstrual_cycle` (seguimiento del ciclo menstrual, ADR 0092) o `location` (ubicación del pod: trazas de posición; vale solo `granted` y revocarlo borra las trazas, ADR 0106).',
});

export const consentSignerSchema = z.enum(CONSENT_SIGNERS).meta({
  id: 'ConsentSigner',
  description:
    'Quién firma: `guardian` (madre, padre o tutor/a de un menor) o `player` (mayor de edad).',
});

export const consentStateSchema = z.enum(CONSENT_STATES).meta({
  id: 'ConsentState',
  description:
    '`granted`: vigente sobre el texto actual. `outdated`: vigente, pero sobre una versión anterior del texto (sigue valiendo hasta que se revoque; conviene firmar la actual). `adult_signature_required`: el jugador/a ya es mayor y solo vale la firma de su tutor, que sigue valiendo hasta `guardianSignaturesLapseOn`; tiene que firmar el propio jugador/a (B-311). `lapsed`: solo queda la firma del tutor y ya pasó ese día: no vale. `revoked`: revocado. `missing`: nunca firmado. Para `location` solo vale `granted`: ni `outdated` ni `adult_signature_required` dejan asignar un pod (B-913).',
});

export const consentDocumentIdSchema = idOf('texto de consentimiento');
export const consentIdSchema = idOf('consentimiento');

export const consentDocumentVersionSchema = z
  .string()
  .min(1)
  .max(CONSENT_DOCUMENT_VERSION_MAX_LENGTH)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/)
  .meta({
    description: 'Versión del texto: letras, dígitos, `.`, `_` y `-`. Única por club y tipo.',
    examples: ['2026-11'],
  });

const trimmed = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((value) => value === value.trim(), { message: 'No leading or trailing whitespace' });

export const consentDocumentSummarySchema = z
  .object({
    id: consentDocumentIdSchema,
    type: consentTypeSchema,
    version: consentDocumentVersionSchema,
    locale: localeSchema,
    title: z.string().min(1),
    bodySha256: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .meta({ description: 'SHA-256 del cuerpo (UTF-8, hexadecimal), calculado por la base.' }),
    publishedAt: dateTimeSchema,
    current: z
      .boolean()
      .meta({ description: 'Si es la versión vigente de su tipo (la última publicada).' }),
  })
  .meta({ id: 'ConsentDocumentSummary' });

export const consentDocumentSchema = consentDocumentSummarySchema
  .extend({
    body: z
      .string()
      .min(1)
      .meta({ description: 'Texto completo; párrafos separados por una línea en blanco.' }),
  })
  .meta({ id: 'ConsentDocument' });

export const consentSchema = z
  .object({
    id: consentIdSchema,
    playerId: playerIdSchema,
    type: consentTypeSchema,
    documentId: consentDocumentIdSchema
      .nullable()
      .meta({ description: 'Texto firmado; `null` en firmas anteriores a los textos guardados.' }),
    documentVersion: z.string().min(1),
    signerKind: consentSignerSchema,
    signedBy: userIdSchema,
    signedAt: dateTimeSchema,
    revokedAt: dateTimeSchema.nullable(),
    revokedBy: userIdSchema.nullable(),
  })
  .meta({ id: 'Consent' });

export const CONSENT_ACTIONS = ['sign', 'revoke'] as const;

export const consentTypeStatusSchema = z
  .object({
    type: consentTypeSchema,
    state: consentStateSchema,
    consent: consentSchema.nullable().meta({
      description:
        'El consentimiento que vale: el propio del jugador/a mayor si lo firmó, si no el vigente más reciente. `null` si ninguno vale.',
    }),
    currentDocument: consentDocumentSummarySchema
      .nullable()
      .meta({ description: 'Texto vigente del tipo; `null` si el club no publicó ninguno.' }),
    actions: z.array(z.enum(CONSENT_ACTIONS)).meta({
      description:
        'Lo que quien pregunta puede hacer con este tipo según la matriz de permisos (no mira el estado: firmar algo ya vigente es `conflict`).',
    }),
  })
  .meta({ id: 'ConsentTypeStatus' });

export const playerConsentsSchema = z
  .object({
    playerId: playerIdSchema,
    playerOfAge: z.boolean().meta({ description: 'Mayor de edad en el día del club.' }),
    requiredSigner: consentSignerSchema.meta({
      description: 'Quién tiene que firmar hoy: el tutor si es menor, el jugador si es mayor.',
    }),
    guardianSignaturesLapseOn: localDateSchema.meta({
      description:
        'Día del club desde el que las firmas del tutor dejan de valer: 30 días después de cumplir 18 (B-311). Antes de ese día el jugador/a mayor tiene que firmar las propias.',
    }),
    types: z
      .array(consentTypeStatusSchema)
      .meta({ description: 'Un elemento por tipo, en orden: `data`, `image`, `health`.' }),
  })
  .meta({ id: 'PlayerConsents' });

export type ConsentDocumentSummary = z.output<typeof consentDocumentSummarySchema>;
export type ConsentDocument = z.output<typeof consentDocumentSchema>;
export type Consent = z.output<typeof consentSchema>;
export type ConsentTypeStatus = z.output<typeof consentTypeStatusSchema>;
export type PlayerConsents = z.output<typeof playerConsentsSchema>;

const playerParams = z.strictObject({ playerId: playerIdSchema });

export const listConsentDocuments = defineEndpoint({
  method: 'GET',
  path: '/v1/consent-documents',
  summary: 'Textos de consentimiento del club',
  description:
    'Todo miembro del club. `status=current` deja solo la versión vigente de cada tipo. Sin el cuerpo: `GET /v1/consent-documents/{documentId}`.',
  tags: ['consents'],
  auth: 'club',
  query: pageQuerySchema.extend({
    type: consentTypeSchema.optional(),
    status: z.enum(['current', 'all']).default('all').meta({
      description: '`all` (por defecto): todas las versiones; `current`: la vigente de cada tipo.',
    }),
    sort: sortQuerySchema(['publishedAt'], '-publishedAt'),
  }),
  response: {
    status: 200,
    description: 'Página de textos.',
    schema: pageOf(consentDocumentSummarySchema).meta({ id: 'ConsentDocumentPage' }),
  },
  errors: ['bad_request'],
});

export const getConsentDocument = defineEndpoint({
  method: 'GET',
  path: '/v1/consent-documents/{documentId}',
  summary: 'Un texto de consentimiento',
  description: 'Todo miembro del club. Texto completo de una versión. De otro club: `not_found`.',
  tags: ['consents'],
  auth: 'club',
  params: z.strictObject({ documentId: consentDocumentIdSchema }),
  response: { status: 200, description: 'El texto.', schema: consentDocumentSchema },
  errors: ['not_found'],
});

export const publishConsentDocument = defineEndpoint({
  method: 'POST',
  path: '/v1/consent-documents',
  summary: 'Publicar una versión de un texto de consentimiento',
  description:
    'Solo la administración. Pasa a ser la versión vigente de su tipo; las firmas anteriores siguen valiendo (`outdated`) hasta que se revoquen. Un texto publicado no se edita ni se borra. Versión repetida en el tipo: `conflict`. Idempotente por `clientUuid`.',
  tags: ['consents'],
  auth: 'club',
  body: z.strictObject({
    clientUuid: clientUuidSchema.optional(),
    type: consentTypeSchema,
    version: consentDocumentVersionSchema,
    locale: localeSchema.default('es-AR'),
    title: trimmed(CONSENT_DOCUMENT_TITLE_MAX_LENGTH),
    body: z
      .string()
      .min(1)
      .max(CONSENT_DOCUMENT_BODY_MAX_LENGTH)
      .refine((value) => value.trim() !== '', { message: 'The body cannot be blank' }),
  }),
  response: { status: 201, description: 'Texto publicado.', schema: consentDocumentSchema },
  errors: ['conflict'],
});

export const getPlayerConsents = defineEndpoint({
  method: 'GET',
  path: '/v1/players/{playerId}/consents',
  summary: 'Estado de los consentimientos de un jugador',
  description:
    'El jugador, su tutor, el staff asignado y la administración. Por tipo: estado, consentimiento vigente, texto vigente y acciones permitidas. Jugador de otro club o fuera del alcance: `not_found`.',
  tags: ['consents'],
  auth: 'club',
  params: playerParams,
  response: { status: 200, description: 'Estado por tipo.', schema: playerConsentsSchema },
  errors: ['not_found'],
});

export const listPlayerConsentHistory = defineEndpoint({
  method: 'GET',
  path: '/v1/players/{playerId}/consents/history',
  summary: 'Historial de consentimientos de un jugador',
  description: 'Mismo alcance que el estado. Todas las firmas, vigentes y revocadas.',
  tags: ['consents'],
  auth: 'club',
  params: playerParams,
  query: pageQuerySchema.extend({
    type: consentTypeSchema.optional(),
    sort: sortQuerySchema(['signedAt'], '-signedAt'),
  }),
  response: {
    status: 200,
    description: 'Página de consentimientos.',
    schema: pageOf(consentSchema).meta({ id: 'ConsentPage' }),
  },
  errors: ['bad_request', 'not_found'],
});

export const signConsent = defineEndpoint({
  method: 'POST',
  path: '/v1/players/{playerId}/consents',
  summary: 'Firmar un consentimiento',
  description:
    'El tutor de un menor o el jugador mayor de edad, como sí mismo: el tipo y la versión salen del texto, que tiene que ser el vigente de su tipo (si no: `conflict`). El mismo texto ya firmado y vigente: `conflict`. Idempotente por `clientUuid`.',
  tags: ['consents'],
  auth: 'club',
  params: playerParams,
  body: z.strictObject({
    clientUuid: clientUuidSchema.optional(),
    documentId: consentDocumentIdSchema,
  }),
  response: { status: 201, description: 'Consentimiento firmado.', schema: consentSchema },
  errors: ['not_found', 'conflict'],
});

export const revokeConsent = defineEndpoint({
  method: 'POST',
  path: '/v1/players/{playerId}/consents/{type}/revoke',
  summary: 'Revocar un consentimiento',
  description:
    'El tutor de un menor o el jugador mayor de edad. Revoca todo consentimiento vigente del tipo (también uno que firmó otro tutor); desde ahí no se cargan datos de ese tipo. Idempotente: sin nada vigente, devuelve el estado.',
  tags: ['consents'],
  auth: 'club',
  params: z.strictObject({ playerId: playerIdSchema, type: consentTypeSchema }),
  response: { status: 200, description: 'Estado del tipo.', schema: consentTypeStatusSchema },
  errors: ['not_found'],
});
