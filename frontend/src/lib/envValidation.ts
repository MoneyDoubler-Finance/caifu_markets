export function isValidHexAddress(value?: string | null): value is `0x${string}` {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value)
}

export function formatMissingAddressMessage(varNames: string[]): string {
  if (!varNames.length) return ''
  return `Missing contract address configuration${varNames.length > 1 ? 's' : ''}: ${varNames.join(', ')}`
}
