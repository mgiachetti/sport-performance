# @sport-performance/mobile

App mobile para jugadores y staff: Expo (React Native) con dev builds, offline con SQLite y cola de mutaciones.

> Esqueleto del monorepo (B-101). El framework se agrega en su propio issue.

## Versiones (B-324, ADR 0045)

`src/version` tiene la versión nativa (`NATIVE_APP_VERSION`, fuente única de `expo.version`), la política de `runtimeVersion` (`appVersion`), los headers de versión para el cliente tipado, el chequeo de compatibilidad con caché para usar sin conexión y el modelo de la pantalla "Actualizá la app". Cada release a las tiendas sube `NATIVE_APP_VERSION`.
