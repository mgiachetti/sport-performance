# 0065. Área de familia en la web: el tutor ve la ficha resumida de sus hijos/as, firma consentimientos e informa la altura de los padres

- Estado: Aceptado
- Fecha: 2026-11-03
- Issue: #76 (B-413)

## Contexto

El ADR 0057 decidió que la web es del staff: una membresía `player` o `parent` ve "la web es para el staff, usá la app" y la web no pide datos del club con ella, con la salvedad de revisar la decisión si algún día hacían falta pantallas para ellos. B-413 las pide para madres, padres y tutores: la ficha resumida de su hijo/a, los consentimientos (Ley 25.326) y la carga de la altura de los padres, que necesita Khamis-Roche para la talla adulta predicha. Es lo que más se hace desde una computadora (leer un texto legal largo antes de firmarlo, buscar la altura en un documento), lo hace gente que muchas veces no instaló la app y lo pide el club al inscribir a un menor.

La API ya tiene todo, con la matriz de permisos (ADR 0025) y la RLS: `GET /v1/me/children` (ADR 0042, ADR 0048), la ficha por `player_summary` (`GET /v1/players/{id}`, ADR 0035), los consentimientos con las acciones que puede hacer quien pregunta (ADR 0043) y la altura de los padres con su origen (ADR 0035). Lo único que falta es el nombre de las categorías del hijo/a: el tutor no tiene `category.read`.

## Decisión

- **Esto reemplaza el punto "La web es del staff" del ADR 0057** solo para el rol `parent`: el tutor entra a la web y ve un **área de familia** (`/family`). El jugador sigue yendo a la app (sus cargas son de 20 segundos en el teléfono, CLAUDE.md principio 5); el resto del ADR 0057 sigue vigente.
- **Ruteo por rol antes de pedir datos.** El `beforeLoad` del layout del club ya sabe el rol (`GET /v1/me`): un `parent` en una ruta que no es de familia va a `/family`, y cualquier otro rol en `/family` va al inicio. Así los `loader` de las pantallas del staff nunca corren con una membresía de tutor y viceversa, sin que cada pantalla nueva tenga que acordarse. El tutor no pide categorías ni asignaciones.
- **Sujeto de la matriz del tutor:** el layout carga `GET /v1/me/children` (todas las páginas) y arma `guardianships` con la confirmación del hijo/a mayor (B-311); `categories` y `assignments` quedan vacíos. Las acciones se deciden con `can()` del dominio sobre los hechos del hijo/a (deporte y categorías de la ficha, mayoría de edad y tipos de consentimiento vigentes) y, para firmar y revocar, con las `actions` que ya devuelve la API por tipo. La API decide igual.
- **Shell:** el mismo `AppShell` del club (marca, rayas, estado de conexión, cuenta y cambio de club) con su propia navegación (`GUARDIAN_NAV_ITEMS`) y sin selector de deporte y categoría.
- **Pantallas:** "Mis hijos/as" (`/family`) y la ficha de cada uno (`/family/$playerId`). Un `playerId` que no está entre los hijos/as del tutor no genera pedidos: se dice que no está. De un hijo/a mayor que no mantuvo el acceso solo se muestra el nombre y por qué ya no se ven sus datos, sin pedir nada más. Uno que lo mantuvo se ve en modo lectura.
- **Ficha resumida:** datos del plantel (nombre, nacimiento y edad, deporte, categorías, alta, cuenta propia). Nunca datos médicos, disponibilidad con causa, resultados comparados ni rankings: la disponibilidad llega con el módulo médico (#73) y se agrega acá como "disponible / no disponible", nunca el motivo.
- **Consentimientos:** estado por tipo con ícono y texto; para firmar se lee el texto vigente completo y se marca "Leí y acepto" (la firma lleva `clientUuid`, ADR 0032); revocar pide confirmación y dice la consecuencia; historial de firmas.
- **Altura de los padres:** el tutor de un menor con consentimiento de datos vigente la informa (`source: reported`) con entrada es-AR, validada contra el rango del contrato antes de llamar, y `expectedVersion` al reemplazarla. Una altura medida por el staff no se reemplaza desde la familia (la API responde `409`; la web no ofrece el botón).
- **Categorías del hijo/a en `GET /v1/me/children`:** cada hijo/a trae `categories` (`id`, `name`, `sport`) vigentes en el día del club, para la ficha resumida, sin abrirle al tutor el catálogo de categorías. Vacío para el hijo/a mayor que no mantuvo el acceso (además de lo que ya filtra la RLS). Es un campo nuevo de la respuesta: compatible con los clientes existentes.
- **Textos** en `packages/i18n/src/messages/web-guardian.ts` (claves `guardian.*`).

## Consecuencias

- Un tutor puede hacer desde la web lo que el club le pide al inscribir a un menor, sin instalar la app; la app (B-503) va a ofrecer lo mismo con los mismos endpoints.
- Una pantalla del staff no necesita protegerse del tutor: el ruteo por rol la deja afuera antes del `loader`. Una pantalla nueva para la familia es hija de la ruta `/family`.
- La web sigue sin pantallas para el jugador; si se necesitan, se revisa con otro ADR.
- Invitar al hijo/a o generarle un código de ingreso, exportar sus datos y pedir el borrado quedan para la app o para otro issue; la API ya los tiene.
