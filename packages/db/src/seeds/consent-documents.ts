import { CONSENT_TYPES, type ConsentType } from '@sport-performance/domain';

/**
 * Default consent texts of a club (B-312, ADR 0043), in es-AR, one per
 * consent type. `bootstrapClub` publishes them for a club that has no text
 * of that type yet; from then on the club publishes new versions through the
 * API (`POST /v1/consent-documents`) and these are never rewritten.
 *
 * They are a starting point written for Ley 25.326 (datos personales) and
 * must be reviewed by the club's lawyer before production use: the club is
 * the data controller (responsable de la base de datos), the platform
 * processes the data on its behalf.
 */

/** Version tag of the seeded texts. A new default text is a new version, never an edit. */
export const DEFAULT_CONSENT_DOCUMENT_VERSION = '2026-11';
export const DEFAULT_CONSENT_DOCUMENT_LOCALE = 'es-AR';

export interface ConsentDocumentSeed {
  readonly type: ConsentType;
  readonly version: string;
  readonly locale: string;
  readonly title: string;
  readonly body: string;
}

function rights(clubName: string): string {
  return [
    `Podés pedir en cualquier momento acceder a estos datos, rectificarlos o suprimirlos (Ley 25.326, artículos 14 a 16), escribiéndole a ${clubName} o desde la app. El acceso es gratuito a intervalos no inferiores a seis meses, salvo un interés legítimo.`,
    'La Agencia de Acceso a la Información Pública, órgano de control de la Ley 25.326, atiende las denuncias y reclamos de quienes resulten afectados en sus derechos por incumplimiento de las normas vigentes en materia de protección de datos personales.',
    'Este consentimiento se puede revocar en cualquier momento desde la app. La revocación no tiene efecto retroactivo: desde ese momento no se cargan datos nuevos de este tipo.',
  ].join('\n\n');
}

function signerClause(): string {
  return 'Lo firma el jugador o la jugadora si es mayor de edad, o su madre, padre o tutor/a mientras sea menor de edad.';
}

const BODIES: Readonly<Record<ConsentType, (clubName: string) => { title: string; body: string }>> =
  {
    data: (clubName) => ({
      title: 'Consentimiento para el tratamiento de datos personales',
      body: [
        `${clubName} es responsable de la base de datos del programa de rendimiento deportivo y la administra con una plataforma que trata los datos por cuenta del club.`,
        'Se registran datos personales del jugador o la jugadora: identificación, fecha de nacimiento, categoría, posición, mediciones antropométricas (talla, talla sentado, peso) y la altura de sus padres, resultados de tests físicos, carga de entrenamiento, minutos jugados, bienestar y esfuerzo percibido.',
        'La finalidad es planificar y seguir el entrenamiento y el desarrollo deportivo con las mismas métricas que la primera del club. Los datos los ve solo el personal del club que lo necesita para esa tarea; los rankings con nombres no se muestran a otros jugadores de M13 a M16. No se ceden a terceros ni se usan con fines comerciales.',
        'Dar los datos es voluntario. Sin este consentimiento no se cargan datos del jugador o la jugadora en la plataforma, aunque puede seguir entrenando con el club.',
        signerClause(),
        rights(clubName),
      ].join('\n\n'),
    }),
    image: (clubName) => ({
      title: 'Consentimiento para el uso de imágenes',
      body: [
        `${clubName} puede filmar o fotografiar al jugador o la jugadora durante tests y entrenamientos, por ejemplo el video del salto con contramovimiento (CMJ) con el que se mide la altura del salto.`,
        'Las imágenes se usan solo para medir y analizar la técnica, las ve solo el personal del club que lo necesita para esa tarea y no se publican ni se usan con fines de difusión o comerciales.',
        'Sin este consentimiento no se suben ni se muestran imágenes del jugador o la jugadora: los tests se registran con otro método.',
        signerClause(),
        rights(clubName),
      ].join('\n\n'),
    }),
    health: (clubName) => ({
      title: 'Consentimiento para el tratamiento de datos de salud',
      body: [
        `Los datos de salud son datos sensibles (Ley 25.326, artículo 2). ${clubName} registra lesiones, conmociones, altas y restricciones del jugador o la jugadora solo para cuidar su salud y organizar su vuelta a la actividad.`,
        'Los carga y los lee solo el personal médico del club asignado; cada acceso queda registrado. El resto del staff ve únicamente si el jugador o la jugadora está disponible, nunca el diagnóstico.',
        'La plataforma no es un dispositivo médico: monitorea la carga y no diagnostica. La conmoción la gestiona el personal médico con su protocolo.',
        'Sin este consentimiento no se cargan datos de salud en la plataforma. El personal médico puede igualmente indicar que el jugador o la jugadora no está disponible, para protegerlo.',
        signerClause(),
        rights(clubName),
      ].join('\n\n'),
    }),
  };

/** The default texts for a club, with its name as the data controller. */
export function consentDocumentSeeds(clubName: string): ConsentDocumentSeed[] {
  return CONSENT_TYPES.map((type) => ({
    type,
    version: DEFAULT_CONSENT_DOCUMENT_VERSION,
    locale: DEFAULT_CONSENT_DOCUMENT_LOCALE,
    ...BODIES[type](clubName),
  }));
}
