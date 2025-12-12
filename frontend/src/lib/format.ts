import { formatUnits } from 'viem'
import { USDF_CONFIG } from './web3'

/**
 * Format USDF amount for display
 * @param amount Raw amount in wei
 * @param decimals Number of decimal places to show (default: 2)
 * @returns Formatted string with USDF symbol
 */
export function formatUSDF(amount: bigint | string | number, decimals: number = 2): string {
  const numAmount = typeof amount === 'bigint' ? amount : BigInt(amount)
  const formatted = formatUnits(numAmount, USDF_CONFIG.decimals)
  const parsed = parseFloat(formatted)

  if (parsed === 0) return '0 USDF'
  if (parsed < 0.01 && parsed > 0) return '<0.01 USDF'

  return `${parsed.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  })} USDF`
}

/**
 * Format USDF amount without symbol
 * @param amount Raw amount in wei
 * @param decimals Number of decimal places to show (default: 2)
 * @returns Formatted string
 */
export function formatUSDFValue(amount: bigint | string | number, decimals: number = 2): string {
  const numAmount = typeof amount === 'bigint' ? amount : BigInt(amount)
  const formatted = formatUnits(numAmount, USDF_CONFIG.decimals)
  const parsed = parseFloat(formatted)

  if (parsed === 0) return '0'
  if (parsed < 0.01 && parsed > 0) return '<0.01'

  return parsed.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  })
}

/**
 * Parse USDF amount from string to wei
 * @param amount String amount (e.g., "100.50")
 * @returns BigInt amount in wei
 */
export function parseUSDF(amount: string): bigint {
  const parsed = parseFloat(amount)
  if (isNaN(parsed)) throw new Error('Invalid USDF amount')

  return BigInt(Math.floor(parsed * 10 ** USDF_CONFIG.decimals))
}

/**
 * Format large numbers with appropriate suffixes
 * @param num Number to format
 * @returns Formatted string
 */
export function formatNumber(num: number): string {
  if (num >= 1e9) {
    return (num / 1e9).toFixed(1) + 'B'
  } else if (num >= 1e6) {
    return (num / 1e6).toFixed(1) + 'M'
  } else if (num >= 1e3) {
    return (num / 1e3).toFixed(1) + 'K'
  } else {
    return num.toFixed(2)
  }
}

/**
 * Format percentage
 * @param value Value between 0 and 1
 * @param decimals Number of decimal places
 * @returns Formatted percentage string
 */
export function formatPercentage(value: number, decimals: number = 1): string {
  return `${(value * 100).toFixed(decimals)}%`
}
