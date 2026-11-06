# 0101. Tamaño del binario de Android por variante: R8 en todo release, APK de staging solo arm64

- Estado: Aceptado
- Fecha: 2026-11-06
- Issue: #255 (B-501)

## Contexto

El APK de staging medía 155 MB. El código nativo de las cuatro arquitecturas (`arm64-v8a`, `armeabi-v7a`, `x86`, `x86_64`) eran 137 MB; cada teléfono usa una sola, y `x86`/`x86_64` solo sirven para emuladores. El código Java/Kotlin no se achicaba (R8 apagado) y las bibliotecas nativas iban sin comprimir. Ese APK se instala a mano en los teléfonos de quienes prueban, así que se descarga entero.

## Decisión

`buildExpoConfig` agrega `expo-build-properties` con la configuración de Android de cada variante (`androidBuildProperties`):

- **Todo build de release** achica el código y los recursos con R8 (`enableMinifyInReleaseBuilds`, `enableShrinkResourcesInReleaseBuilds`). Las bibliotecas traen sus reglas de ProGuard; un APK con R8 se probó en el emulador: ingreso con la sesión guardada, base cifrada, sincronización, navegación y pantallas de cámara.
- **Staging** (APK interno): solo `arm64-v8a`, la arquitectura de todos los teléfonos actuales, con las bibliotecas nativas comprimidas (`useLegacyPackaging`) para que la descarga sea chica. El emulador `x86_64` de Android 11 o más nuevo lo corre por traducción de ARM, más lento pero alcanza para revisar pantallas.
- **Producción** va a la tienda como AAB con todas las arquitecturas: la tienda le manda a cada teléfono solo la suya, sin comprimir, que es lo que instala más rápido.
- **Development** queda con los valores por defecto: builds de depuración para los emuladores `x86_64`.

## Consecuencias

- El APK de staging pasa de 155 MB a 28 MB.
- Si una biblioteca nueva usa reflexión sin traer sus reglas, R8 puede romperla en release y no en desarrollo. Una dependencia nativa nueva se prueba en un APK de staging antes de darla por buena.
- Un teléfono de 32 bits (`armeabi-v7a`) no puede instalar el APK de staging, aunque sí la app de la tienda.
