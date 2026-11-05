/** Initials of a name (or of an email's local part) for the avatar. */
export function initialsOf(nameOrEmail: string): string {
  const base = nameOrEmail.includes('@') ? (nameOrEmail.split('@')[0] ?? '') : nameOrEmail;
  const words = base
    .split(/[\s._-]+/)
    .map((word) => word.trim())
    .filter((word) => word !== '');
  const letters = words.length > 1 ? [words[0], words[words.length - 1]] : [words[0]];
  return letters
    .map((word) => (word ?? '').charAt(0))
    .join('')
    .toLocaleUpperCase('es-AR');
}
