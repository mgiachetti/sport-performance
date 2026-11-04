/**
 * Messages of the pain report of the wellness in the app (B-609, ADR 0078): "¿te duele algo?"
 * with a body map. Merged into the `es-AR` source catalog; same rules as `es-AR.ts`. The body
 * regions and sides are shared with the web (`body.*` in `es-AR.ts`).
 */
export const mobilePainMessagesEsAR = {
  'pain.title': '¿Te duele algo?',
  'pain.privacy': 'Lo que marques acá lo ve solo el staff médico del club. Tu entrenador no lo ve.',
  'pain.answer.no': 'No, nada',
  'pain.answer.yes': 'Sí, me duele algo',
  'pain.map.title': 'Tocá dónde te duele',
  'pain.map.hint': 'Podés marcar varias zonas. Si no la encontrás, contalo en el comentario.',
  'pain.map.front': 'De frente',
  'pain.map.back': 'De espaldas',
  'pain.map.views': 'Vista del cuerpo',
  'pain.map.area.selected': '{area}, marcada',
  'pain.map.area.select': 'Marcar {area}',
  'pain.areas.title': 'Zonas marcadas',
  'pain.areas.none': 'Todavía no marcaste ninguna zona.',
  'pain.areas.remove': 'Quitar {area}',
  'pain.areas.max': 'Llegaste al máximo de {max} zonas. Contá el resto en el comentario.',
  'pain.intensity.label': '¿Cuánto te duele? (1 a 10)',
  'pain.intensity.value': '{value} de 10',
  'pain.intensity.pick': 'Elegí cuánto te duele en {area}.',
  'pain.intensity.mild': 'Leve',
  'pain.intensity.moderate': 'Moderado',
  'pain.intensity.severe': 'Fuerte',
  'pain.comment.label': 'Comentario (opcional)',
  'pain.comment.hint':
    '¿Desde cuándo? ¿Te pasó en un partido o entrenando? Hasta {max} caracteres.',
  'pain.comment.tooLong': 'Es muy largo: hasta {max} caracteres.',
  'pain.submit': 'Enviar al staff médico',
  'pain.sent.no': 'Listo. Gracias por avisar.',
  'pain.sent.yes': 'Listo. El staff médico lo va a ver.',
  'pain.sent.queued': 'Se envía cuando haya conexión.',
  'pain.sent.reviewed': 'El staff médico ya lo revisó.',
  'pain.sent.again': 'Responder de nuevo',
  'pain.unavailable.module_off': 'Tu club no pregunta por dolor en el bienestar.',
  'pain.unavailable.missing_consent':
    'Para contar si te duele algo hace falta el consentimiento de salud firmado. Lo firma tu familia (o vos, si sos mayor de edad) desde Cuenta.',
  'pain.needsConnection':
    'La primera vez necesitamos conexión para saber si tu club pregunta por dolor. Probá de nuevo con señal.',
  'pain.error.queue': 'No pudimos guardar tu respuesta en el teléfono. Probá de nuevo.',
  'pain.notMedical':
    'Esto no es una consulta médica. Si el dolor es fuerte o te pasó algo en un golpe, avisale al staff ahora.',
} as const;
