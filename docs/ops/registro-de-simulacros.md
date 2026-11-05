# Registro de simulacros y restauraciones

B-702 · [ADR 0094](../adr/0094-backups-pitr-y-simulacros-de-restauracion.md) · procedimiento en [backups-y-recuperacion.md](backups-y-recuperacion.md).

Una entrada por simulacro (`drill`) o restauración real (`incident`), la más nueva arriba. Solo nombres de tablas, conteos, horarios e ids de marcadores: **nunca filas, nombres ni datos de salud**.

Cadencia: trimestral en `production`; en `staging` antes de cada migración riesgosa y después de cambiar la imagen o la configuración de Postgres.

| Fecha | Ambiente | Tipo | Objetivo T (UTC) | Resultado | RTO | Responsable |
|---|---|---|---|---|---|---|
| — | — | — | — | Todavía no se hizo el primer simulacro: requiere el proyecto de Railway (B-701) | — | — |

## Plantilla

Copiá este bloque arriba de las entradas anteriores y completalo.

```markdown
### AAAA-MM-DD · <staging|production> · <drill|incident>

- Responsable:
- Servicio de origen / restaurado: postgres / postgres-simulacro-AAAAMMDD
- `pitr status` antes: ventana desde … hasta …, archivador sano (sí/no)
- Marcador antes: <id> (createdAt …)
- Objetivo T: AAAA-MM-DDTHH:MM:SSZ
- Marcador después: <id> (createdAt …)
- Restauración pedida a las: HH:MM · copia promovida a las: HH:MM · verificación correcta a las: HH:MM
- RTO (pedido → verificación correcta): … min
- Informe de `verify`:
  - ok: true/false
  - recovery_finished / migrations / job_queue / connection_roles / row_level_security / triggers / drill_markers / recovery_point: pass/warn/fail
  - Avisos:
  - Última escritura: … (… s antes de T)
  - Tamaño de la base: … MB
- Copia borrada (servicio y volumen): sí, a las HH:MM
- Problemas y acciones (issues):
```
