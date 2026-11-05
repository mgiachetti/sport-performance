import { describe, expect, it } from 'vitest';
import { sniffImageType } from './club-logo.js';

describe('sniffImageType', () => {
  it('reads PNG and WebP from their signature, nothing else', () => {
    expect(
      sniffImageType(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])),
    ).toBe('image/png');
    const webp = new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 ');
    expect(sniffImageType(webp)).toBe('image/webp');
    expect(
      sniffImageType(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg">')),
    ).toBe(null);
    expect(sniffImageType(new Uint8Array())).toBe(null);
  });
});
