# 0013. Mobile con Expo, dev builds, EAS Build y EAS Update (no PWA)

- Estado: Aceptado
- Fecha: 2026-11-01
- Issue: #16 (B-103)

## Contexto

La app la usan los jugadores (bienestar y RPE en menos de 20 segundos, todos los días) y el staff en la cancha (un día de test completo sin conexión). Por delante vienen funciones que dependen del hardware del teléfono: grabación a alta velocidad para el CMJ por video (B-604), bandas de frecuencia cardíaca y fotocélulas por Bluetooth Low Energy (Fase 2) y la descarga de los pods (Fase 3). La mayoría de los jugadores y padres usa iPhone o Android en proporciones parecidas.

La alternativa natural era una **PWA**, que evita las tiendas y se actualiza al instante.

## Decisión

- **Expo (React Native)** para una sola app iOS y Android, con **dev builds** (no Expo Go), para poder sumar módulos nativos (BLE, cámara, SQLite) cuando haga falta.
- **EAS Build** para los binarios de tienda y **EAS Update** para publicar cambios de JavaScript y assets sin pasar por la revisión de la tienda, con canales por ambiente (`staging`, `production`) y `runtimeVersion` para no mandar un update a un binario incompatible.
- Una sola app para todos los clubes (ADR 0014).

## Por qué no PWA

- **Bluetooth.** Web Bluetooth no está disponible en Safari para iOS, y las bandas de FC, fotocélulas y pods (Fases 2 y 3) son BLE. Una PWA dejaría afuera a todos los iPhone.
- **Cámara.** El CMJ por video necesita grabar a alta frecuencia de cuadros y marcar cuadro a cuadro; en web el control de la cámara es limitado y varía por navegador.
- **Offline confiable.** El staff carga un día entero sin conexión. En iOS el almacenamiento de una web puede ser purgado por el sistema; SQLite nativo (ADR 0015) no.
- **Notificaciones y presencia.** Los recordatorios de bienestar son clave para la adherencia; en iOS las notificaciones web solo funcionan si el usuario instala la PWA en la pantalla de inicio, un paso que la mayoría no hace.
- **La ventaja de la PWA (actualizar sin tienda) la cubre EAS Update** para todo lo que no sea nativo.

## Consecuencias

- Hay que mantener cuentas de desarrollador de Apple y Google (B-012) y pasar revisión de tienda para cada cambio nativo.
- Los updates OTA se limitan a cambios que no alteran el propósito de la app, como piden las reglas de las tiendas; los cambios nativos van por un build nuevo.
- La app comparte tipos y lógica con la web y la API a través de `packages/domain`, `packages/contracts`, `packages/i18n` y `packages/ui-tokens`.
