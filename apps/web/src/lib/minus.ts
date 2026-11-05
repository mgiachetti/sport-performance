/**
 * The minus sign of negative figures as the typographic U+2212 ("−2,2"), not the hyphen the
 * number formatter writes: it reads as a minus at a glance and screen readers say "menos".
 * Only a hyphen right before a digit and not after a letter or digit (never "M-15").
 */
export function typographicMinus(text: string): string {
  return text.replace(/(^|[^\p{L}\p{N}])-(?=\p{N})/gu, '$1−');
}
