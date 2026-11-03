import { describe, expect, it } from 'vitest';
import {
  EmailDeliveryError,
  LogEmailTransport,
  MemoryEmailTransport,
  NotificationEmail,
  renderEmail,
} from './index.js';

describe('notification email', () => {
  it('renders the text, the button and the link, in HTML and plain text', async () => {
    const { html, text } = await renderEmail(
      <NotificationEmail
        preview="Hay una alerta crítica nueva en M17."
        heading="Alerta crítica en M17"
        body="Hay una alerta crítica nueva en M17. Revisala en el panel."
        cta="Abrir en la web"
        url="https://app.example.com/alerts"
        preferences="Elegí qué avisos te llegan."
        footer="Este correo lo mandó Sport Performance."
      />,
    );
    expect(html).toMatch(/^<!DOCTYPE html/);
    expect(html).toContain('lang="es-AR"');
    expect(html).toContain('href="https://app.example.com/alerts"');
    expect(text).toContain('ALERTA CRÍTICA EN M17');
    expect(text).toContain('Elegí qué avisos te llegan.');
    expect(text).not.toContain('<');
  });
});

describe('transports', () => {
  const message = {
    to: 'ana@example.com',
    subject: 'Hola',
    html: '<p>Hola</p>',
    text: 'Hola',
    kind: 'notification' as const,
  };

  it('keeps messages in memory and can fail on demand', async () => {
    const transport = new MemoryEmailTransport();
    await transport.send(message);
    expect(transport.lastTo('ANA@example.com')).toEqual(message);
    transport.failing = true;
    await expect(transport.send(message)).rejects.toBeInstanceOf(EmailDeliveryError);
  });

  it('logs instead of sending, with any logger', async () => {
    const lines: { object: Record<string, unknown>; message: string }[] = [];
    const transport = new LogEmailTransport({
      warn: (object, text) => lines.push({ object, message: text }),
    });
    await transport.send(message);
    expect(lines[0]?.object).toEqual({
      devEmail: { kind: 'notification', recipient: 'ana@example.com', subject: 'Hola' },
    });
    expect(lines[0]?.message).toContain('Hola');
  });
});
