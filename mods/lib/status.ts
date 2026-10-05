// A plugin has one status line, so each mod owns a slot in it, joined in a
// fixed order.
export const STATUS_SLOTS = ['orders', 'usage'] as const
export type StatusSlot = (typeof STATUS_SLOTS)[number]

export function joinStatus(current: Partial<Record<StatusSlot, string>>): string | undefined {
  const text = STATUS_SLOTS.map(slot => current[slot] ?? '').filter(part => part.length > 0).join(' · ')
  return text.length > 0 ? text : undefined
}
