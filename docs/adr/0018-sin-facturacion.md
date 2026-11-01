# 0018. Sin facturación por ahora

- Estado: Aceptado
- Fecha: 2026-11-01
- Issue: #16 (B-103)

## Contexto

El primer tenant es un club piloto y el objetivo de esta etapa es validar el producto con él. Cobrar implicaría elegir un modelo comercial (por club, por jugador, por funcionalidad), integrar un procesador de pagos, emitir facturas en Argentina y, si se cobra dentro de la app, cumplir las reglas de compras dentro de la app de las tiendas.

## Decisión

- **No se cobra la app por ahora.** No hay planes, límites por plan, pagos, suscripciones ni compras dentro de la app.
- El modelo no incluye tablas ni banderas de facturación "por las dudas". Lo que se configura por club (marca, batería, reglas) es configuración de producto, no de plan.

## Consecuencias

- No hay que integrar pagos ni cumplir reglas de compras dentro de la app en las tiendas.
- Cuando se decida cobrar, se escribe un ADR nuevo con el modelo comercial; el cobro sería por club y fuera de la app, y no debería requerir cambiar el modelo multi-tenant (ADR 0006).
