# @sport-performance/email

Envío de correo compartido por la API y el worker (ADR 0010, [ADR 0054](../../docs/adr/0054-notificaciones-push-y-email.md)): la interfaz `EmailTransport` con Resend (`ResendEmailTransport`), memoria (tests) y log (desarrollo sin `RESEND_API_KEY`), el layout de React Email y las plantillas que usan los dos (`NotificationEmail`). Los textos llegan ya traducidos desde `packages/i18n`.

```ts
import { NotificationEmail, ResendEmailTransport, renderEmail } from '@sport-performance/email';

const { html, text } = await renderEmail(<NotificationEmail {...props} />);
await transport.send({ to, subject, html, text, kind: 'notification' });
```

Los errores del proveedor conservan el nombre y el estado, nunca el destinatario.
