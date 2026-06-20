export function parseApplyFlag(value: unknown, defaultValue = true): boolean {
  if (typeof value === 'boolean') return value
  return defaultValue
}

export function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}
