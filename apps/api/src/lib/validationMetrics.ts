/**
 * Lightweight validation metrics
 * Tracks validation errors per route with rolling 5-minute window
 */

interface BucketEntry {
  count: number
  timestamp: number
}

interface RouteMetrics {
  total: number
  buckets: BucketEntry[] // Ring buffer of minute-level counts
}

// Module-level state
const metrics = new Map<string, RouteMetrics>()

// Constants
const BUCKET_DURATION_MS = 60_000 // 1 minute
const WINDOW_DURATION_MS = 5 * 60_000 // 5 minutes
const MAX_BUCKETS = 5

/**
 * Increment validation error counter for a route
 * @param routeKey - e.g., "POST /api/orders"
 */
export function inc(routeKey: string): void {
  const now = Date.now()
  const currentBucket = Math.floor(now / BUCKET_DURATION_MS)
  
  let routeMetric = metrics.get(routeKey)
  
  if (!routeMetric) {
    routeMetric = {
      total: 0,
      buckets: []
    }
    metrics.set(routeKey, routeMetric)
  }
  
  // Increment total
  routeMetric.total++
  
  // Find or create bucket for current minute
  let bucket = routeMetric.buckets.find(b => 
    Math.floor(b.timestamp / BUCKET_DURATION_MS) === currentBucket
  )
  
  if (!bucket) {
    // Create new bucket
    bucket = {
      count: 0,
      timestamp: now
    }
    routeMetric.buckets.push(bucket)
    
    // Trim old buckets (keep only last 5 minutes)
    const cutoff = now - WINDOW_DURATION_MS
    routeMetric.buckets = routeMetric.buckets.filter(b => b.timestamp >= cutoff)
    
    // Limit to MAX_BUCKETS
    if (routeMetric.buckets.length > MAX_BUCKETS) {
      routeMetric.buckets = routeMetric.buckets.slice(-MAX_BUCKETS)
    }
  }
  
  bucket.count++
}

/**
 * Get validation metrics snapshot
 * @returns Aggregated metrics with total and last 5 minutes
 */
export function snapshot(): { total: number; last5m: number; byRoute?: Record<string, number> } {
  const now = Date.now()
  const cutoff = now - WINDOW_DURATION_MS
  
  let total = 0
  let last5m = 0
  const byRoute: Record<string, number> = {}
  
  for (const [routeKey, routeMetric] of metrics.entries()) {
    total += routeMetric.total
    
    // Sum buckets within last 5 minutes
    const recentCount = routeMetric.buckets
      .filter(b => b.timestamp >= cutoff)
      .reduce((sum, b) => sum + b.count, 0)
    
    last5m += recentCount
    
    if (recentCount > 0) {
      byRoute[routeKey] = recentCount
    }
  }
  
  return {
    total,
    last5m,
    byRoute: Object.keys(byRoute).length > 0 ? byRoute : undefined
  }
}

/**
 * Reset all metrics (for testing)
 */
export function reset(): void {
  metrics.clear()
}

