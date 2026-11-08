/**
 * Messages of the family area of the web (B-413, ADR 0065): what a parent or guardian sees of
 * their children (summarised profile), their consents and the parents' heights. Merged into the
 * `es-AR` source catalog; same rules as `es-AR.ts`. Every key starts with `guardian.`.
 */
export const webGuardianMessagesEsAR = {
  // Navigation
  'guardian.nav.children': 'Mis hijos/as',

  // Children list (/family)
  'guardian.children.title': 'Mis hijos/as',
  'guardian.children.subtitle': 'En {clubName}',
  'guardian.children.intro':
    'Acá ves la ficha de tus hijos/as en el club, firmás sus consentimientos e informás tu altura y la del otro padre o madre.',
  'guardian.children.noneTitle': 'Sin hijos/as vinculados',
  'guardian.children.none':
    'Todavía no tenés hijos/as vinculados en el club. Pedile a la administración que te vincule.',
  'guardian.children.open': 'Ver la ficha de {name}',
  'guardian.children.age': '{age, plural, one {# año} other {# años}}',
  'guardian.children.noCategory': 'Sin categoría asignada',
  'guardian.children.hasAccount': 'Tiene su propia cuenta',
  'guardian.children.noAccount': 'Todavía no tiene cuenta propia',
  'guardian.children.adultHidden':
    'Ya es mayor de edad y decidió no compartir sus datos con vos. Solo ves que siguen vinculados.',
  'guardian.children.adultShared':
    'Es mayor de edad y decidió seguir compartiendo sus datos con vos.',

  // Relationship of the guardian with the child
  'guardian.relationship.mother': 'Madre',
  'guardian.relationship.father': 'Padre',
  'guardian.relationship.legal_guardian': 'Tutor/a legal',
  'guardian.relationship.other': 'Responsable',
  'guardian.relationship.label': 'Tu vínculo: {relationship}',

  // Child profile (/family/$playerId)
  'guardian.child.back': 'Volver a Mis hijos/as',
  'guardian.child.notFound':
    'No encontramos a ese jugador/a entre tus hijos/as. Puede que el vínculo haya terminado.',
  'guardian.child.adultHiddenTitle': 'Sus datos ya no se comparten',
  'guardian.child.readOnly':
    'Como ya es mayor de edad, ves su ficha y sus consentimientos, pero las firmas y las cargas las hace él o ella.',
  'guardian.summary.title': 'Ficha',
  'guardian.summary.birthDate': 'Fecha de nacimiento',
  'guardian.summary.age': 'Edad',
  'guardian.summary.sport': 'Deporte',
  'guardian.summary.categories': 'Categoría',
  'guardian.summary.joinedOn': 'En el club desde',
  'guardian.summary.account': 'Cuenta propia',
  'guardian.summary.accountYes': 'Sí',
  'guardian.summary.accountNo': 'Todavía no',
  'guardian.summary.notMedical':
    'Acá no se muestran datos de salud. Si tenés una consulta médica, hablá con el staff médico del club.',

  // Consents
  'guardian.consents.title': 'Consentimientos',
  'guardian.consents.intro':
    'Sin un consentimiento vigente de cada tipo, el club no puede cargar esos datos de {name} (Ley 25.326).',
  'guardian.consents.type.data': 'Datos personales y de entrenamiento',
  'guardian.consents.type.image': 'Imágenes y videos',
  'guardian.consents.type.health': 'Datos de salud',
  'guardian.consents.type.menstrual_cycle': 'Seguimiento del ciclo menstrual',
  'guardian.consents.type.location': 'Ubicación con el pod',
  'guardian.consents.typeHelp.data':
    'Tests físicos, bienestar, carga de entrenamiento y medidas. Sin este no se carga nada.',
  'guardian.consents.typeHelp.image': 'Videos del salto (CMJ) y fotos para analizar la técnica.',
  'guardian.consents.typeHelp.health': 'Lesiones y altas, que gestiona el staff médico.',
  'guardian.consents.typeHelp.menstrual_cycle':
    'Opcional, solo para jugadoras: lo activa ella si quiere y lo ve solo a quien ella elija. Quien firma no ve sus registros.',
  'guardian.consents.typeHelp.location':
    'Trazas de posición y mapas de calor del pod GPS durante las sesiones del club. Sin este no recibe pod. Las ven el jugador o la jugadora, los entrenadores y preparadores físicos de su categoría y la administración del club; vos, el staff médico y el soporte no ven la ubicación.',
  'guardian.consents.state.granted': 'Vigente',
  'guardian.consents.state.outdated': 'Vigente sobre un texto anterior',
  'guardian.consents.state.adult_signature_required': 'Falta la firma del jugador/a',
  'guardian.consents.state.lapsed': 'Vencido',
  'guardian.consents.state.revoked': 'Revocado',
  'guardian.consents.state.missing': 'Sin firmar',
  'guardian.consents.stateHelp.outdated':
    'El club publicó una versión nueva del texto. Lo firmado sigue valiendo, pero conviene firmar la nueva.',
  'guardian.consents.stateHelp.adult_signature_required':
    'Ya es mayor de edad: tu firma vale hasta el {date} y después tiene que firmar él o ella.',
  'guardian.consents.state.outdatedGrantedOnly': 'No vale: hay un texto nuevo',
  'guardian.consents.stateHelp.outdatedLocation':
    'El club publicó una versión nueva del texto. Para la ubicación lo firmado antes ya no vale: hasta que se firme la nueva, no recibe pod.',
  'guardian.consents.stateHelp.adultLocation':
    'Ya es mayor de edad: para la ubicación tu firma ya no vale y la tiene que firmar él o ella.',
  'guardian.consents.signedBy':
    '{signer, select, guardian {Firmado por un tutor/a} other {Firmado por el jugador/a}} el {date} (versión {version}).',
  'guardian.consents.noDocument':
    'El club todavía no publicó el texto de este consentimiento: no se puede firmar.',
  'guardian.consents.read': 'Leer y firmar',
  'guardian.consents.readNew': 'Leer y firmar la versión nueva',
  'guardian.consents.documentVersion': 'Versión {version}, publicada el {date}',
  'guardian.consents.accept': 'Leí el texto y doy mi consentimiento como {relationship} de {name}.',
  'guardian.consents.mustAccept': 'Marcá que leíste el texto antes de firmar.',
  'guardian.consents.sign': 'Firmar',
  'guardian.consents.signing': 'Firmando…',
  'guardian.consents.signed': 'Listo: quedó firmado.',
  'guardian.consents.revoke': 'Revocar',
  'guardian.consents.revokeConfirm':
    'Si lo revocás, desde ahora el club no puede cargar {type, select, data {datos personales ni de entrenamiento} image {imágenes ni videos} other {datos de salud}} de {name}. Lo cargado antes queda en su historia. ¿Lo revocás?',
  'guardian.consents.revokeConfirmLocation':
    'Si lo revocás, {name} no recibe más pod y se borran sus trazas de posición y los registros del pod. Las métricas que no son ubicación (distancia, velocidad, aceleraciones) quedan. El borrado no se deshace. ¿Lo revocás?',
  'guardian.consents.revokeConfirmAction': 'Sí, revocar',
  'guardian.consents.revoking': 'Revocando…',
  'guardian.consents.revoked': 'Listo: quedó revocado.',
  'guardian.consents.revokedLocation':
    'Listo: quedó revocado. El club está borrando sus trazas de posición.',
  'guardian.consents.history.title': 'Historial de firmas',
  'guardian.consents.history.none': 'Todavía no hay firmas.',
  'guardian.consents.history.item':
    '{type}: versión {version}, {signer, select, guardian {firmado por un tutor/a} other {firmado por el jugador/a}} el {date}',
  'guardian.consents.history.revokedOn': 'Revocado el {date}',
  'guardian.consents.history.notRevoked': 'Sin revocar',

  // Parents' heights (Khamis-Roche)
  'guardian.heights.title': 'Altura de los padres',
  'guardian.heights.intro':
    'Con la altura de la madre y del padre biológicos el club estima la talla adulta de {name} y en qué momento del crecimiento está, para adaptar el entrenamiento.',
  'guardian.heights.parent.mother': 'Madre',
  'guardian.heights.parent.father': 'Padre',
  'guardian.heights.missing': 'Sin cargar',
  'guardian.heights.source.measured': 'Medida por el staff',
  'guardian.heights.source.reported': 'Informada',
  'guardian.heights.updatedOn': 'Actualizada el {date}',
  'guardian.heights.report': 'Informar',
  'guardian.heights.edit': 'Corregir',
  'guardian.heights.input.label':
    'Altura de {parent, select, mother {la madre} other {el padre}} (cm)',
  'guardian.heights.input.help':
    'En centímetros, por ejemplo 165 o 165,5. Si no la sabés con exactitud, poné la mejor estimación.',
  'guardian.heights.input.invalid': 'Escribí la altura en centímetros, por ejemplo 165 o 165,5.',
  'guardian.heights.input.outOfRange': 'Tiene que estar entre {min} y {max} cm.',
  'guardian.heights.saving': 'Guardando…',
  'guardian.heights.saved': 'Listo: quedó guardada.',
  'guardian.heights.measuredLocked':
    'La midió el staff del club: si hay un error, avisale al preparador físico.',
  'guardian.heights.needsDataConsent':
    'Para informar las alturas primero tiene que estar firmado el consentimiento de datos personales.',
  'guardian.heights.conflict':
    'La altura cambió mientras la editabas (o la midió el staff). Ya mostramos el valor actual: revisalo antes de volver a guardar.',
} as const;
