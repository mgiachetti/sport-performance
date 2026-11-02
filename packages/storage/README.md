# @sport-performance/storage

Archivos subidos en el bucket S3-compatible (B-325, [ADR 0044](../../docs/adr/0044-archivos-urls-firmadas-y-retencion.md)): URLs firmadas para los clientes, verificación y borrado para la API, y el job de retención para el worker. Funciona con cualquier proveedor S3 (buckets de Railway, S3, R2, MinIO) por el AWS SDK v3.

## Uso

```ts
import { createS3Storage, purgeExpiredFiles, storageConfigOf, storageEnvShape } from '@sport-performance/storage';

// En el esquema de entorno del servicio (la API ya lo hace en src/config/env.ts):
const env = z.object({ ...storageEnvShape }).parse(process.env);
const config = storageConfigOf(env); // null si no hay bucket configurado
const storage = createS3Storage(config!);

// Subida directa: el bucket rechaza otro tipo, otro tamaño u otro SHA-256.
const upload = await storage.presignUpload({ key, contentType: 'video/mp4', sizeBytes, checksumSha256, expiresInS: 900 });
// Bajada de vida corta con los headers de la respuesta fijados.
const download = await storage.presignDownload({ key, expiresInS: 300, contentType: 'video/mp4', contentDisposition: 'inline' });
await storage.stat(key); // { sizeBytes, contentType, checksumSha256 } | null
await storage.remove(key); // idempotente

// Worker (#57): una vez por club, en una transacción con app.club_id y el rol del worker.
const report = await purgeExpiredFiles(db, storage, { now: new Date() }); // { purged, failed, more }
```

- `storageEnvShape`, `storageEnvProblems(env, production)`, `storageConfigOf(env)`: variables `STORAGE_*` (todas o ninguna; en producción todas, `https` y un secreto real). Nunca se loguean los valores.
- `contentDisposition(disposition, fileName)`: `Content-Disposition` con nombre ASCII de respaldo y el UTF-8 (RFC 5987).
- `purgeExpiredFiles`: borra del bucket y marca `deleted` + `purged_at` cada archivo del club con `expires_at` vencido (retención de su tipo, subidas no confirmadas en 24 h, borrados pedidos), nunca el escudo en uso. Objeto primero, fila después y `FOR UPDATE SKIP LOCKED`: reintentar es seguro.
- `@sport-performance/storage/testing`: `createTestBucket(url)` crea y borra un bucket descartable para los tests de integración.

| Variable | Qué es |
|---|---|
| `STORAGE_ENDPOINT` | URL del servicio S3 (`https://storage.railway.app`, `http://localhost:9000`). En Railway: `${{Bucket.ENDPOINT}}`. |
| `STORAGE_REGION` | Región de la firma; `auto` por defecto (Railway, R2). |
| `STORAGE_BUCKET` | Nombre del bucket. En Railway: `${{Bucket.BUCKET}}`. |
| `STORAGE_ACCESS_KEY_ID` / `STORAGE_SECRET_ACCESS_KEY` | Credenciales. En Railway: `${{Bucket.ACCESS_KEY_ID}}` / `${{Bucket.SECRET_ACCESS_KEY}}`. Nunca en el repo. |
| `STORAGE_FORCE_PATH_STYLE` | `true` para MinIO (bucket en la ruta en vez del host). |

## Tests

```sh
docker run -d --rm --name minio-dev -e MINIO_ROOT_USER=minioadmin -e MINIO_ROOT_PASSWORD=minioadmin123 -p 9000:9000 pgsty/minio:RELEASE.2026-08-04T00-00-00Z server /data
STORAGE_TEST_URL=http://minioadmin:minioadmin123@localhost:9000 pnpm --filter @sport-performance/storage test
```

La imagen oficial `minio/minio` dejó de publicarse; `pgsty/minio` es el fork comunitario. Sin `STORAGE_TEST_URL` los tests contra el bucket se saltean localmente; en CI (`CI` definido) fallan. Cubren que la firma de subida rechace otro contenido, otro tamaño y otro tipo, que la bajada fije sus headers y no sirva con la URL alterada, el borrado idempotente y la validación del entorno. El job de retención se prueba de punta a punta en `apps/api` (`files.pg.test.ts`) con el rol del worker.
