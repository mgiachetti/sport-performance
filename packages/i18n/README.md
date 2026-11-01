# @sport-performance/i18n

Mensajes ICU compartidos por web y mobile (español rioplatense) y formateo es-AR de números, fechas y unidades (B-105).

## Unidades

`packages/domain` solo guarda el símbolo internacional de cada unidad (`m/s`, `km/h`, `N`, `%`) o `null` cuando no hay uno. Lo que se muestra al lado de un valor es texto de UI y vive acá: una clave `unit.<UnitCode>` por unidad (`UNIT_MESSAGES_ES_AR`, `unitLabelEsAr`). Las unidades sin símbolo internacional llevan su texto es-AR (`años`, `cm/año`, `lpm`, `UA`); las cantidades y los puntajes no llevan etiqueta. Si se agrega una unidad al dominio, este paquete no compila hasta que tenga su clave.
