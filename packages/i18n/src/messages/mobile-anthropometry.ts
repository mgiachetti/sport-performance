/**
 * Messages only the field anthropometry sheet of the mobile app uses (B-508): picking the
 * category, the squad kept on the phone, the state of each saved measurement in the offline
 * queue and its corrections. Fields, gaps, plausibility and errors are the shared ones of
 * `anthropometry.ts`. Merged into the `es-AR` source catalog; same rules as `es-AR.ts`.
 */
export const mobileAnthropometryMessagesEsAR = {
  'anthropometry.field.open': 'Antropometría en cancha',
  'anthropometry.field.subtitle':
    'Talla, talla sentado, peso y, en M17/M19, pliegues. Lo que guardás queda en el teléfono y se sube solo cuando hay señal.',
  'anthropometry.field.pickCategory': 'Elegí la categoría que vas a medir.',
  'anthropometry.field.noCategories': 'No tenés categorías asignadas para medir.',
  'anthropometry.field.noContext':
    'Sin conexión y sin datos guardados en este teléfono. Abrí esta pantalla una vez con señal para bajar tus categorías y planteles.',
  'anthropometry.field.noSquad':
    'Este plantel no está guardado en el teléfono. Abrilo una vez con señal para poder medir sin conexión.',
  'anthropometry.field.loadFailed': 'No pudimos bajar los datos. {reason}',
  'anthropometry.field.offline':
    'Sin conexión: usás lo guardado en el teléfono. Las mediciones se suben al volver la señal.',
  'anthropometry.field.squadSavedOn': 'Plantel guardado el {date}.',
  'anthropometry.field.refreshing': 'Actualizando el plantel…',
  'anthropometry.field.changeCategory': 'Cambiar de categoría',
  'anthropometry.field.sheetTitle': '{category} · {date}',
  'anthropometry.field.stageUnknown':
    'No sabemos su etapa de hoy: sin pliegues hasta que abras el plantel con señal.',
  'anthropometry.field.save': 'Guardar medición',
  'anthropometry.field.saveA11y': 'Guardar la medición de {player}',
  'anthropometry.field.saveFailed': 'No se guardó en el teléfono. Probá de nuevo.',
  'anthropometry.field.state.queued': 'Sin enviar: medición guardada en el teléfono',
  'anthropometry.field.state.pending': 'Sin enviar: corrección guardada en el teléfono',
  'anthropometry.field.maturation.later':
    'La maduración se calcula cuando la medición llega al servidor.',
  'anthropometry.field.maturation.computing': 'Calculando la maduración…',
  'anthropometry.field.maturation.offset': 'Offset de PHV: {value} años ({equation}).',
  'anthropometry.field.maturation.adultHeight': '% de talla adulta: {pct} de {predicted} cm.',
  'anthropometry.field.maturation.none': 'Sin offset de PHV ni % de talla adulta con estos datos.',
  'anthropometry.field.value': '{field}: {value}',
  'anthropometry.field.correct': 'Corregir',
  'anthropometry.field.correctA11y': 'Corregir la medición de {player}',
  'anthropometry.field.reason': 'Motivo de la corrección',
  'anthropometry.field.reasonHint': 'Queda en el historial de cambios.',
  'anthropometry.field.reasonRequired': 'Escribí el motivo de la corrección.',
  'anthropometry.field.saveCorrection': 'Guardar corrección',
  'anthropometry.field.nothingChanged': 'No cambiaste ningún valor.',
  'anthropometry.field.useSuggestion': 'Usar {value}',
} as const;
