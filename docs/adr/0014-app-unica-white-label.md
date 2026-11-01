# 0014. Una sola app white-label para todos los clubes

- Estado: Aceptado
- Fecha: 2026-11-01
- Issue: #16 (B-103)

## Contexto

El producto es white-label: cada club quiere ver su logo y sus colores. La forma tradicional de hacerlo es publicar una app por club ("ORC Performance", "Club X Performance") desde la misma base de código. La guía 4.2.6 de App Review de Apple rechaza las apps creadas desde una plantilla o un servicio de generación comercial, salvo que las publique directamente el dueño del contenido, y recomienda consolidarlas en una sola app que agrupe a los clientes. Publicar decenas de apps casi iguales desde nuestra cuenta es justo el caso que esa guía rechaza, y además multiplica builds, revisiones y fichas de tienda.

## Decisión

- **Una sola app en cada tienda y una sola web** para todos los clubes, publicadas por nosotros.
- **La marca se aplica en runtime** según el club activo: logo, colores y nombre salen de la configuración del club y se aplican con los tokens de `packages/ui-tokens` (tema por club). Ningún club tiene código, build ni bundle propio.
- El club activo lo determina la membresía (ADR 0007): al entrar con el OTP, el usuario ve su club; con varias membresías, elige.
- La paleta del primer tenant (ORC) es la configuración de un club más, no el tema por defecto del código. El tema por defecto es neutro.
- Lo que cambia por club (reglas de alerta, batería de tests, calendario, umbrales) es configuración en la base, nunca ramas de código por club.

## Consecuencias

- El nombre y el ícono de la app en la tienda son de la plataforma, no de un club; la marca del club aparece adentro, después del login.
- Un club nuevo se da de alta con datos (ADR 0007, B-411), sin publicar nada.
- Los assets de cada club (`assets/clubs/<club>/`) se suben al storage y se cargan en runtime; los que están en el repo son solo para desarrollo y seeds.
- Si un club grande exige su propia app en la tienda, tendría que publicarla desde su propia cuenta de desarrollador (el caso que la 4.2.6 permite); eso sería un ADR nuevo.
