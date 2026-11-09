/**
 * Live effort signals of the pod (B-906, ADR 0110): `podLive.signal.<kind>` and its
 * `.suggestion`, the keys the domain's `evaluateLiveSignals` returns. Arguments are the keys of
 * `LiveSignal.values`, formatted before being passed (`metric` is the label of the metric). They
 * suggest a look, never a diagnosis; the severity is shown apart with `status.*` and an icon. The
 * live screen is approximate and says so (`podLive.approximate`): the report uses the pod's log.
 */
export const podLiveMessagesEsAR = {
  'podLive.approximate': 'Datos en vivo aproximados: el informe usa el registro completo del pod.',
  'podLive.insufficientHistory':
    'Historia insuficiente: hacen falta {count, plural, one {# partido} other {# partidos}} con el pod para comparar.',
  'podLive.signal.pace_drop':
    'Metros por minuto de los últimos 5 minutos: {paceMMin} m/min, {pctOfPeak} % de su pico de la sesión ({peakMMin} m/min).',
  'podLive.signal.pace_drop.suggestion':
    'Sugiere revisar cómo está: puede ser el momento del partido o cansancio.',
  'podLive.signal.match_average_high':
    '{metric} va al {pctOfAverage} % de su promedio por partido para los minutos jugados.',
  'podLive.signal.match_average_high.suggestion':
    'Sugiere revisar la carga que lleva antes de sumarle más minutos de alta intensidad.',
  'podLive.signal.speed_near_vmax':
    'Velocidad máxima reciente {speedMs} m/s: {pctOfVmax} % de su Vmax de referencia ({vmaxMs} m/s).',
  'podLive.signal.speed_near_vmax.suggestion':
    'Está corriendo cerca de su máximo; si lo supera, revisá el dato o su Vmax de referencia.',
  'podLive.signal.repeated_high_intensity':
    '{bouts, plural, one {# bloque} other {# bloques}} de esfuerzos repetidos de alta intensidad en los últimos {windowMin} minutos.',
  'podLive.signal.repeated_high_intensity.suggestion':
    'Sugiere revisar la recuperación entre esfuerzos en los próximos minutos.',
} as const;
