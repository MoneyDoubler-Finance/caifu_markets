/**
 * Mute noisy Coinbase Wallet SDK COOP warnings in development
 * 
 * The Coinbase SDK logs a harmless warning about Cross-Origin-Opener-Policy headers
 * when they're not present. This is expected in development and doesn't affect functionality.
 */
export function muteCoinbaseDevWarning() {
  if (typeof window === 'undefined') return

  const flag = '__caifuCoinbaseWarningPatched__'
  if ((window as any)[flag]) {
    return
  }

  try {
    const originalError = console.error
    console.error = (...args: unknown[]) => {
      if (typeof args[0] === 'string' && args[0].includes('Cross-Origin-Opener-Policy')) {
        return // ignore noisy dev warning
      }
      originalError(...args)
    }
    Object.assign(console.error, { originalError })
    ;(window as any)[flag] = true
  } catch (err) {
    // Silently ignore – better to keep console intact than crash hydration
    console.warn('[muteCoinbaseDevWarning] failed to patch console', err)
  }
}
