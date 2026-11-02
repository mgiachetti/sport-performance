import type { z } from 'zod';

type Def = z.core.$ZodTypeDef & Record<string, unknown>;

function defOf(schema: unknown): Def {
  return (schema as z.core.$ZodType)._zod.def as Def;
}

/** Wrappers whose inner schema is in `innerType`. */
const WRAPPERS = new Set([
  'optional',
  'nullable',
  'default',
  'prefault',
  'nonoptional',
  'readonly',
  'catch',
  'success',
  'promise',
]);

/**
 * Paths (`body.session`, `query`) of the objects of `schema` that do not
 * reject unknown keys. Request schemas must be strict all the way down
 * (OWASP API3:2023, mass assignment): a key the contract does not describe
 * is a `400`, never silently stripped or passed through. `z.strictObject`
 * (catchall `never`) is the only accepted object form.
 */
export function nonStrictObjectPaths(schema: z.ZodType, root: string): string[] {
  const found: string[] = [];
  const seen = new Set<unknown>();

  const visit = (node: unknown, path: string): void => {
    if (seen.has(node)) return;
    seen.add(node);
    const def = defOf(node);
    switch (def.type) {
      case 'object': {
        const catchall = def.catchall;
        if (catchall === undefined || defOf(catchall).type !== 'never') found.push(path);
        const shape = (def as unknown as { shape: Record<string, unknown> }).shape;
        for (const [key, value] of Object.entries(shape)) visit(value, `${path}.${key}`);
        return;
      }
      case 'array':
        visit(def.element, `${path}[]`);
        return;
      case 'union':
        for (const option of def.options as unknown[]) visit(option, path);
        return;
      case 'intersection':
        visit(def.left, path);
        visit(def.right, path);
        return;
      case 'pipe':
        visit(def.in, path);
        return;
      case 'record':
        visit(def.valueType, `${path}{}`);
        return;
      case 'tuple':
        (def.items as unknown[]).forEach((item, index) => {
          visit(item, `${path}[${String(index)}]`);
        });
        if (def.rest !== null && def.rest !== undefined) visit(def.rest, `${path}[]`);
        return;
      case 'lazy':
        visit((def.getter as () => unknown)(), path);
        return;
      default:
        if (WRAPPERS.has(def.type)) visit(def.innerType, path);
    }
  };

  visit(schema, root);
  return found;
}
