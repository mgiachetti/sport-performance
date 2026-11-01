# 0017. Deporte y sexo en el modelo desde el día uno

- Estado: Aceptado
- Fecha: 2026-11-01
- Issue: #16 (B-103)

## Contexto

El primer club arranca con rugby masculino y hockey femenino, pero lo específico de hockey y de la rama femenina se implementa al final (M8). Las fórmulas ya dependen del sexo desde el primer día: Mirwald 2002 y Moore 2015 tienen ecuaciones distintas para varones y mujeres, Khamis-Roche tiene coeficientes por edad y sexo, y los percentiles y referencias se comparan dentro del mismo sexo. Las métricas de cancha y la batería de tests dependen del deporte (`scrums_n` es de rugby; la referencia de primera es del plantel del mismo deporte y rama). Agregar estas dimensiones después obliga a migrar datos históricos y a revisar cada consulta y cada comparación.

## Decisión

- **`sport` y `sex` existen en el modelo desde las primeras migraciones**, aunque al principio solo se usen rugby y masculino:
  - `sex` en el jugador (sexo para fórmulas de maduración y referencias, no identidad de género), obligatorio para calcular maduración.
  - `sport` y rama en la categoría o equipo; un club puede tener varias.
  - `sport` en las definiciones de métricas, baterías de tests, protocolos, reglas de alerta y referencias de primera, cuando aplica (puede ser "todos").
- Las fórmulas de `packages/domain` reciben el sexo como parámetro explícito; no hay valor por defecto "masculino".
- Las comparaciones (percentiles, promedio de la categoría, referencia de primera) se hacen siempre dentro del mismo deporte y sexo.
- Los valores son enumeraciones cerradas y extensibles por migración, no texto libre.

## Consecuencias

- M8 (hockey y femenino) suma datos, protocolos y pantallas, pero no cambia el modelo ni migra históricos.
- Los tests de dominio cubren las variantes por sexo de cada fórmula desde el primer día.
- `sex` es un dato personal de menores: tiene las mismas restricciones de visibilidad que el resto de la ficha.
