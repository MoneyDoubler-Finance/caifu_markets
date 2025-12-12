import { formatDistanceToNow, format } from 'date-fns'

export const formatCurrency = (value: string | number, decimals: number = 2): string => {
  const num = typeof value === 'string' ? parseFloat(value) : value
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(num)
}

export const formatNumber = (value: string | number, decimals: number = 2): string => {
  const num = typeof value === 'string' ? parseFloat(value) : value
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(num)
}

export const formatCompactNumber = (value: string | number): string => {
  const num = typeof value === 'string' ? parseFloat(value) : value
  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
    compactDisplay: 'short',
  }).format(num)
}

export const formatPercentage = (value: string | number, decimals: number = 2): string => {
  const num = typeof value === 'string' ? parseFloat(value) : value
  return `${num >= 0 ? '+' : ''}${num.toFixed(decimals)}%`
}

export const formatUSDF = (value: string | number): string => {
  const num = typeof value === 'string' ? parseFloat(value) : value
  if (!Number.isFinite(num)) return '$0'

  const abs = Math.abs(num)
  const formatWithSuffix = (divisor: number, suffix: string) =>
    `$${(num / divisor).toFixed(1)}${suffix}`

  if (abs >= 1_000_000_000) {
    return formatWithSuffix(1_000_000_000, 'b')
  }
  if (abs >= 1_000_000) {
    return formatWithSuffix(1_000_000, 'm')
  }
  if (abs >= 1_000) {
    return formatWithSuffix(1_000, 'k')
  }

  return `$${num.toFixed(num < 1 ? 2 : 0)}`
}

export const formatPct = (value: number, decimals = 1): string => {
  if (!Number.isFinite(value)) return '0%'
  return `${(value * 100).toFixed(decimals)}%`
}

export const formatTimeRemaining = (endDate: Date): string => {
  return formatDistanceToNow(endDate, { addSuffix: true })
}

export const formatDate = (date: Date): string => {
  return format(date, 'MMM dd, yyyy')
}

export const formatDateTime = (date: Date): string => {
  return format(date, 'MMM dd, yyyy HH:mm')
}

export const truncateAddress = (address: string, chars: number = 4): string => {
  if (!address) return ''
  return `${address.slice(0, chars + 2)}...${address.slice(-chars)}`
}

export const formatTokenAmount = (amount: string, decimals: number = 18): string => {
  const num = parseFloat(amount) / Math.pow(10, decimals)
  return formatNumber(num, 4)
}

export const calculatePercentage = (part: number, total: number): number => {
  if (total === 0) return 0
  return (part / total) * 100
}

export const formatPrice = (price: number): string => {
  if (price < 0.01) {
    return price.toFixed(4)
  } else if (price < 1) {
    return price.toFixed(3)
  } else {
    return price.toFixed(2)
  }
}
