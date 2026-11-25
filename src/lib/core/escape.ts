const entities: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeMarkup(value: string): string {
  return value.replace(/[&<>"']/g, (char) => entities[char]);
}
