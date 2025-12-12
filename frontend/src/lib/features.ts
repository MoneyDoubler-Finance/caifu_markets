const parseBooleanFeature = (value: string | undefined, defaultValue: boolean): boolean => {
  if (typeof value !== 'string') return defaultValue

  switch (value.trim().toLowerCase()) {
    case '1':
    case 'true':
    case 'yes':
    case 'on':
      return true
    case '0':
    case 'false':
    case 'no':
    case 'off':
      return false
    default:
      return defaultValue
  }
}

export const FEATURE_ORDERBOOK = parseBooleanFeature(
  process.env.NEXT_PUBLIC_FEATURE_ORDERBOOK,
  false
)

export const FEATURE_FLAGS = {
  orderbook: FEATURE_ORDERBOOK,
} as const

export type FeatureName = keyof typeof FEATURE_FLAGS

export const isFeatureEnabled = (feature: FeatureName): boolean => FEATURE_FLAGS[feature]
