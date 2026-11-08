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
    menstrual_cycle: (clubName) => ({
      title: 'Consentimiento para el seguimiento del ciclo menstrual',
      body: [
        `${clubName} ofrece a sus jugadoras un registro opcional del ciclo menstrual: los días de sangrado, los síntomas que ella marque y una nota. Es un dato de salud y un dato sensible (Ley 25.326, artículo 2), aparte del consentimiento de salud general.`,
        'Es voluntario y lo activa la jugadora en la app, solo si quiere: este consentimiento lo permite, no lo activa. Puede desactivarlo cuando quiera, y desde ese momento no se carga nada nuevo.',
        'Lo ve solo la jugadora y las personas del staff médico o de preparación física asignadas a ella que ella misma elija, una por una; puede sacarles el acceso en cualquier momento. Nunca lo ven los entrenadores, la administración del club ni otras jugadoras, nunca aparece en rankings ni en informes, y cada acceso queda registrado. Quien firma este consentimiento por una jugadora menor de edad no ve sus registros.',
        'La plataforma no es un dispositivo médico: no estima fases del ciclo ni predice la próxima menstruación, y no diagnostica. Ante cualquier duda de salud, la jugadora consulta al personal médico.',
        signerClause(),
        rights(clubName),
      ].join('\n\n'),
    }),
    location: (clubName) => ({
      title: 'Consentimiento para registrar la ubicación con el pod',
      body: [
        `${clubName} usa un pod (un dispositivo con GPS y sensores de movimiento que va en el chaleco) para medir la carga en la cancha: distancia, velocidad, aceleraciones y, con este consentimiento, la ubicación del jugador o la jugadora durante la sesión (trazas de posición y mapas de calor).`,
        'El pod graba cuando está puesto y en movimiento, en cualquier lugar. Pero solo se vuelve dato lo que cae dentro de una sesión del staff (un entrenamiento o un partido) y de la asignación del pod a ese jugador o jugadora. Lo grabado fuera de una sesión no se sube y se borra del pod a los pocos días; lo subido se recorta a la sesión y se borra el resto.',
        `Las trazas y la ubicación en vivo las ven solo: el jugador o la jugadora (las suyas), los entrenadores y preparadores físicos del club asignados a su categoría, para planificar el entrenamiento, y la administración de ${clubName}. Nunca las ven la madre, el padre o el tutor/a, el personal médico, el soporte de la plataforma ni otros jugadores, y no se ceden a terceros ni se usan con fines comerciales.`,
        'Este consentimiento es aparte del de datos personales. Sin él no se le asigna un pod ni se muestra su ubicación en vivo. Si el club publica una versión nueva de este texto, hay que volver a firmarla: hasta entonces no recibe pod.',
        'Lo firma el jugador o la jugadora si es mayor de edad, o su madre, padre o tutor/a mientras sea menor de edad. Al cumplir 18 años, la firma del tutor/a deja de valer para la ubicación: la firma él o ella.',
        `Podés pedir en cualquier momento acceder a estos datos, rectificarlos o suprimirlos (Ley 25.326, artículos 14 a 16), escribiéndole a ${clubName} o desde la app. El acceso es gratuito a intervalos no inferiores a seis meses, salvo un interés legítimo.`,
        'La Agencia de Acceso a la Información Pública, órgano de control de la Ley 25.326, atiende las denuncias y reclamos de quienes resulten afectados en sus derechos por incumplimiento de las normas vigentes en materia de protección de datos personales.',
        'Este consentimiento se puede revocar en cualquier momento desde la app. A diferencia de los otros, revocarlo borra las trazas de posición y los registros del pod de este jugador o jugadora; las métricas que no son ubicación (distancia total, velocidad, aceleraciones) siguen la regla del consentimiento de datos. Queda constancia de que se borraron, sin los datos.',
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
