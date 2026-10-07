/** Short client-safe id for builder-only objects (endings, hidden fields). */
export function nanoid(): string {
  return Math.random().toString(36).slice(2, 10);
}
