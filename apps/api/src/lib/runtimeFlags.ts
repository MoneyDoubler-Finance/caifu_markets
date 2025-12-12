/**
 * Runtime feature flags
 * Centralizes environment variable parsing with sane defaults
 */

/**
 * Parse boolean from environment variable
 */
function envBool(key: string, defaultValue: boolean): boolean {
  const val = process.env[key]
  if (val === undefined) return defaultValue
  return val === 'true' || val === '1'
}

/**
 * Parse integer from environment variable with optional clamping
 */
function envInt(key: string, defaultValue: number, min?: number, max?: number): number {
  const val = process.env[key]
  if (val === undefined) return defaultValue
  
  const parsed = parseInt(val, 10)
  if (isNaN(parsed)) {
    console.warn(`[RuntimeFlags] Invalid integer for ${key}=${val}, using default ${defaultValue}`)
    return defaultValue
  }
  
  // Apply clamping if specified
  if (min !== undefined && parsed < min) {
    console.warn(`[RuntimeFlags] ${key}=${parsed} below minimum ${min}, clamping`)
    return min
  }
  if (max !== undefined && parsed > max) {
    console.warn(`[RuntimeFlags] ${key}=${parsed} above maximum ${max}, clamping`)
    return max
  }
  
  return parsed
}

/**
 * Parse JSON from environment variable
 */
function envJson<T = any>(key: string, defaultValue: T): T {
  const val = process.env[key]
  if (val === undefined || val === '') return defaultValue
  
  try {
    return JSON.parse(val) as T
  } catch (error) {
    console.warn(`[RuntimeFlags] Invalid JSON for ${key}, using default:`, error instanceof Error ? error.message : String(error))
    return defaultValue
  }
}

/**
 * Get all runtime flags with defaults
 */
export function getRuntimeFlags() {
  return {
    // Logging
    LOG_PRETTY: envBool('LOG_PRETTY', true),
    LOG_FILTERS: envJson('LOG_FILTERS', []),
    LOG_SAMPLING: envJson('LOG_SAMPLING', []),
    
    // WebSocket keepalive
    WS_PING_MS: envInt('WS_PING_MS', 15000, 1000, 300000),           // 15s (1s-5m range)
    WS_IDLE_DROP_MS: envInt('WS_IDLE_DROP_MS', 45000, 5000, 600000), // 45s (5s-10m range)
    
    // WS inactivity alerts
    WS_ALERT_NO_CLIENTS_MS: envInt('WS_ALERT_NO_CLIENTS_MS', 300000, 10000),  // 5m (min 10s)
    WS_ALERT_NO_TRADES_MS: envInt('WS_ALERT_NO_TRADES_MS', 900000, 10000),    // 15m (min 10s)
    WS_ALERT_CHECK_MS: envInt('WS_ALERT_CHECK_MS', 60000, 5000, 300000),      // 1m (5s-5m range)
  } as const
}

/**
 * Get compact flags summary for /health endpoint
 */
export function getCompactFlags() {
  const flags = getRuntimeFlags()
  return {
    pretty: flags.LOG_PRETTY,
    wsPing: flags.WS_PING_MS,
    idleDrop: flags.WS_IDLE_DROP_MS,
    alertClients: flags.WS_ALERT_NO_CLIENTS_MS,
    alertTrades: flags.WS_ALERT_NO_TRADES_MS,
  }
}

/**
 * Pretty print flags for CLI
 */
export function formatFlags(): string {
  const flags = getRuntimeFlags()
  const lines: string[] = []
  
  lines.push('Runtime Flags:')
  lines.push('')
  lines.push('Logging:')
  lines.push(`  LOG_PRETTY: ${flags.LOG_PRETTY}`)
  lines.push(`  LOG_FILTERS: ${JSON.stringify(flags.LOG_FILTERS)}`)
  lines.push(`  LOG_SAMPLING: ${JSON.stringify(flags.LOG_SAMPLING)}`)
  lines.push('')
  lines.push('WebSocket:')
  lines.push(`  WS_PING_MS: ${flags.WS_PING_MS}ms (${Math.round(flags.WS_PING_MS / 1000)}s)`)
  lines.push(`  WS_IDLE_DROP_MS: ${flags.WS_IDLE_DROP_MS}ms (${Math.round(flags.WS_IDLE_DROP_MS / 1000)}s)`)
  lines.push('')
  lines.push('Alerts:')
  lines.push(`  WS_ALERT_NO_CLIENTS_MS: ${flags.WS_ALERT_NO_CLIENTS_MS}ms (${Math.round(flags.WS_ALERT_NO_CLIENTS_MS / 60000)}m)`)
  lines.push(`  WS_ALERT_NO_TRADES_MS: ${flags.WS_ALERT_NO_TRADES_MS}ms (${Math.round(flags.WS_ALERT_NO_TRADES_MS / 60000)}m)`)
  lines.push(`  WS_ALERT_CHECK_MS: ${flags.WS_ALERT_CHECK_MS}ms (${Math.round(flags.WS_ALERT_CHECK_MS / 1000)}s)`)
  
  return lines.join('\n')
}

