import type { CSSProperties } from 'react';

export function namespaceColor(namespace: string): string {
  let hash = 0;
  for (const char of namespace) {
    hash = (hash * 31 + char.charCodeAt(0)) | 0;
  }
  return `hsl(${Math.abs(hash) % 360} 58% 45%)`;
}
export function NamespaceBadge({ name }: { name: string }) {
  return (
    <span
      className="cd-namespace"
      style={{ '--namespace-color': namespaceColor(name) } as CSSProperties}
      title={name}
    >
      {name}
    </span>
  );
}
