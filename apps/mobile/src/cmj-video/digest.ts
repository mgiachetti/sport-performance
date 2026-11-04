const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * Base64 of a hexadecimal digest: `expo-file-system` computes the SHA-256 of
 * a video natively (hex) and the upload declares it in base64 (ADR 0044).
 */
export function hexToBase64(hex: string): string {
  if (hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex)) {
    throw new Error('Not a hexadecimal digest');
  }
  const bytes: number[] = [];
  for (let i = 0; i < hex.length; i += 2) bytes.push(parseInt(hex.slice(i, i + 2), 16));
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const [a = 0, b = 0, c = 0] = [bytes[i], bytes[i + 1], bytes[i + 2]];
    const triple = (a << 16) | (b << 8) | c;
    out += BASE64.charAt((triple >> 18) & 63) + BASE64.charAt((triple >> 12) & 63);
    out += i + 1 < bytes.length ? BASE64.charAt((triple >> 6) & 63) : '=';
    out += i + 2 < bytes.length ? BASE64.charAt(triple & 63) : '=';
  }
  return out;
}
