# Política de seguridad

## Reportar una vulnerabilidad

No abras un issue público. Escribí al mantenedor del repositorio (perfil de GitHub de [@mgiachetti](https://github.com/mgiachetti)) con:

- qué encontraste y dónde (archivo, endpoint, pantalla);
- cómo reproducirlo;
- el impacto que ves (por ejemplo, acceso a datos de otro club o a datos médicos).

Vas a recibir respuesta en un plazo de 5 días hábiles. Mientras se arregla, pedimos no divulgarlo.

La app maneja datos de menores y datos de salud: cualquier fuga entre clubes (multi-tenant) o acceso indebido al esquema `medical` se trata como crítico.

## Versiones soportadas

Solo la rama `main` (lo que está desplegado en producción).

## Cómo se protege el repo

Ver [`docs/security.md`](../docs/security.md).
