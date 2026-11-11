export function selectedNamespaces(value?: string): string[] {
  if (!value) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      Array.isArray(parsed) &&
      parsed.every((item) => typeof item === 'string')
    ) {
      return parsed;
    }
  } catch {
    // Existing single-namespace URLs remain supported.
  }
  return [value];
}
export function toggleNamespace(value: string, next: string): string {
  if (!next) {
    return '';
  }
  const selected = selectedNamespaces(value);
  const values = selected.includes(next)
    ? selected.filter((item) => item !== next)
    : [...selected, next];
  return values.length ? JSON.stringify(values) : '';
}
export function namespaceMatches(
  value: string | undefined,
  namespace: string | undefined,
) {
  const selected = selectedNamespaces(value);
  return !selected.length || selected.includes(namespace ?? 'unknown');
}
