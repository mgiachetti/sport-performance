/**
 * OpenAPI generation. Separate entry point so web and mobile bundles never
 * include the generator; the API serves the document and the build commits it.
 */
export * from './document.js';
