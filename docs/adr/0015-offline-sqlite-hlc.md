# 0015. Offline en mobile: SQLite, cola de mutaciones y resolución por campo con HLC

- Estado: Aceptado
- Fecha: 2026-11-01
- Issue: #16 (B-103)

## Contexto

En la cancha no siempre hay señal. El staff tiene que poder cargar un día de test completo sin conexión, a veces con dos o tres evaluadores en celulares distintos sobre el mismo plantel, y el jugador carga bienestar y RPE donde esté. Después todo se sincroniza, y pueden aparecer conflictos: dos personas editaron el mismo jugador, o el mismo registro se editó offline y en la web.

Los relojes de los celulares no son confiables (pueden estar adelantados o atrasados minutos u horas), así que "gana el timestamp más nuevo" con la hora del dispositivo no alcanza.

## Decisión

- **Base local SQLite** con `expo-sqlite` y Drizzle (ADR 0004). La app lee siempre de la base local; la red solo sincroniza.
- **Cola de mutaciones local.** Cada cambio se guarda como una mutación con un `client_uuid` generado en el dispositivo. El push al servidor es **idempotente**: reenviar la misma mutación no la aplica dos veces.
- **Timestamps HLC (hybrid logical clock).** Cada mutación lleva un HLC: hora física, contador lógico e id de nodo. El HLC avanza con la hora local y con cada HLC recibido del servidor, así que es monótono y da un orden total aunque el reloj del dispositivo esté mal.
- **Resolución por campo, gana el último.** El servidor guarda el HLC de cada campo editable. Una mutación aplica solo los campos cuyo HLC es mayor que el guardado. Dos personas que editan campos distintos del mismo registro no se pisan.
- **Los intentos de test son solo de agregado.** Un intento (por ejemplo, un sprint o un salto) nunca se edita ni se sobrescribe: se agrega, y corregirlo es anularlo con otro registro. Así, dos evaluadores offline nunca entran en conflicto sobre los intentos, y el "mejor de 3" se calcula sobre todos.
- **Pull incremental por cursor.** El cliente pide los cambios desde su último cursor; los borrados viajan como marcas (tombstones).
- El servidor valida cada mutación con los mismos contratos (ADR 0009) y la misma RLS (ADR 0006) que un request online; una mutación rechazada vuelve al cliente con su motivo y no bloquea la cola.

## Alternativas descartadas

- **Gana el último por registro completo.** Pierde ediciones de campos distintos hechas por personas distintas.
- **Timestamps del reloj del dispositivo.** Un celular con la hora mal gana o pierde siempre.
- **CRDT genéricos o motores de sync de terceros (por ejemplo, ElectricSQL, PowerSync, Replicache).** Más potentes, pero agregan un servicio o un modelo de datos propio entre la base y la API, y la RLS y la auditoría de salud tendrían que reimplementarse ahí. El dominio necesita poco: registros con campos editables y eventos que solo se agregan.

## Consecuencias

- Cada tabla sincronizable lleva columnas de sincronización (`client_uuid`, HLC por campo o un mapa de HLC, marca de borrado) y tests de conflictos y reintentos (B-323).
- Las reglas de dominio que dependen del orden (por ejemplo, el mejor intento) se calculan en el servidor y en el worker sobre los datos ya fusionados.
- Los datos de `medical` (ADR 0008) solo se sincronizan al dispositivo del rol `medical`, y se borran del dispositivo al cerrar sesión.
