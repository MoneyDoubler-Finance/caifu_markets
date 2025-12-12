/**
 * WebSocket health monitoring
 * Tracks live WS stats in-memory with zero external dependencies
 */

export interface EndpointStats {
  connections: number;               // current open sockets
  totalConnections: number;          // cumulative since start
  lastPingAt?: number;               // ms epoch; last server→client ping
  lastPongAt?: number;               // ms epoch; last client→server pong
  missedHeartbeats: number;          // cumulative missed heartbeats
  droppedForIdle: number;            // cumulative idle timeouts
}

export interface WsHealth {
  startedAt: number;                 // ms epoch
  connections: number;               // current open sockets (all endpoints)
  totalConnections: number;          // since start (all endpoints)
  reconnects: number;                // heuristic: on "open" after close
  lastHeartbeatAt?: number;          // ms epoch; server→client ping or client pong
  lastTradeEventAt?: number;         // set by on-chain watcher publish
  lastMessageAt?: number;            // any inbound client message
  lastPingAt?: number;               // ms epoch; last server→client ping
  lastPongAt?: number;               // ms epoch; last client→server pong
  missedHeartbeats: number;          // cumulative missed heartbeats (terminated clients)
  droppedForIdle: number;            // cumulative idle timeouts
  byEndpoint: Record<string, EndpointStats>; // per-endpoint breakdown
}

export interface WsAlerts {
  hasWarnedNoClients: boolean;
  hasWarnedNoTrades: boolean;
  lastClientActiveAt: number;
  lastTradeEventAt: number;
}

class WsHealthTracker {
  private state: WsHealth
  private previouslyHadConnections = false
  private firstConnectionLogged = false
  private firstTradeEventLogged = false
  
  // Alert state
  private lastClientActiveAt: number
  private lastTradeEventAt: number
  private hasWarnedNoClients = false
  private hasWarnedNoTrades = false

  constructor() {
    this.state = {
      startedAt: Date.now(),
      connections: 0,
      totalConnections: 0,
      reconnects: 0,
      missedHeartbeats: 0,
      droppedForIdle: 0,
      byEndpoint: {},
    }
    
    // Initialize alert timestamps
    this.lastClientActiveAt = Date.now()
    this.lastTradeEventAt = Date.now()
    
    // Start background alert checker
    this.startAlertChecker()
  }
  
  /**
   * Normalize endpoint path (strip :marketId params)
   */
  private normalizeEndpoint(endpoint: string): string {
    return endpoint
  }
  
  /**
   * Touch an endpoint to ensure it exists in the map
   */
  private touchEndpoint(endpoint: string): EndpointStats {
    const normalized = this.normalizeEndpoint(endpoint)
    
    if (!this.state.byEndpoint[normalized]) {
      this.state.byEndpoint[normalized] = {
        connections: 0,
        totalConnections: 0,
        missedHeartbeats: 0,
        droppedForIdle: 0,
      }
    }
    
    return this.state.byEndpoint[normalized]
  }
  
  /**
   * Increment a counter for a specific endpoint
   */
  private incEndpoint(
    endpoint: string,
    counter: 'missedHeartbeats' | 'droppedForIdle' | 'connections' | 'totalConnections',
    value: number = 1
  ): void {
    const stats = this.touchEndpoint(endpoint)
    stats[counter] = (stats[counter] || 0) + value
  }
  
  /**
   * Decrement a counter for a specific endpoint (floor at 0)
   */
  private decEndpoint(
    endpoint: string,
    counter: 'connections'
  ): void {
    const stats = this.touchEndpoint(endpoint)
    stats[counter] = Math.max(0, (stats[counter] || 0) - 1)
  }
  
  /**
   * Set a timestamp for a specific endpoint
   */
  private setTimeEndpoint(
    endpoint: string,
    field: 'lastPingAt' | 'lastPongAt',
    timestamp: number
  ): void {
    const stats = this.touchEndpoint(endpoint)
    stats[field] = timestamp
  }
  
  /**
   * Background timer to check for inactivity and emit warnings
   */
  private startAlertChecker() {
    // Use setTimeout to delay and avoid potential circular dependencies
    setTimeout(() => {
      const { getRuntimeFlags } = require('./runtimeFlags')
      const flags = getRuntimeFlags()

      const normalize = (value?: string | null) => (value ?? '').trim().toLowerCase()
      const alertsOverride = normalize(process.env.WS_ALERTS_ENABLED)
      const alertsEnabledOverride = alertsOverride !== '' ? ['1','true','yes','on'].includes(alertsOverride) : undefined
      const reconWsSetting = normalize(process.env.RECON_USE_WS)
      const rpcWsUrl = normalize(process.env.RPC_WS_URL)

      const alertsEnabled = alertsEnabledOverride !== undefined
        ? alertsEnabledOverride
        : !['0','false','no','off'].includes(reconWsSetting) && rpcWsUrl !== ''

      if (!alertsEnabled) {
        return
      }

      setInterval(() => {
        const now = Date.now()
        
        // Check for no active clients
        const noClients = this.state.connections === 0
        const clientInactiveDuration = now - this.lastClientActiveAt
        
        if (noClients && clientInactiveDuration > flags.WS_ALERT_NO_CLIENTS_MS && !this.hasWarnedNoClients) {
          console.warn(`[WS Alert] No active WebSocket clients for >${Math.round(flags.WS_ALERT_NO_CLIENTS_MS / 60000)}m`)
          this.hasWarnedNoClients = true
        }
        
        // Check for no trade events
        const noTrades = now - this.lastTradeEventAt > flags.WS_ALERT_NO_TRADES_MS
        
        if (noTrades && !this.hasWarnedNoTrades) {
          console.warn(`[WS Alert] No Trade events for >${Math.round(flags.WS_ALERT_NO_TRADES_MS / 60000)}m`)
          this.hasWarnedNoTrades = true
        }
        
        // Reset warnings when conditions resolve
        if (!noClients) {
          this.hasWarnedNoClients = false
        }
        
        if (!noTrades) {
          this.hasWarnedNoTrades = false
        }
      }, flags.WS_ALERT_CHECK_MS)
    }, 100)
  }

  /**
   * Called when a new WebSocket connection is opened
   */
  onOpen(endpoint?: string): void {
    this.state.connections++
    this.state.totalConnections++
    
    // Track per-endpoint
    if (endpoint) {
      this.incEndpoint(endpoint, 'connections')
      this.incEndpoint(endpoint, 'totalConnections')
    }
    
    // Update client activity timestamp
    this.lastClientActiveAt = Date.now()

    // Track reconnects (heuristic: connection after we've had connections before)
    if (this.previouslyHadConnections && this.state.connections === 1) {
      this.state.reconnects++
    }

    this.previouslyHadConnections = true

    // Log first connection only
    if (!this.firstConnectionLogged) {
      console.log('[WS Health] First connection established', {
        totalConnections: this.state.totalConnections,
        connections: this.state.connections,
        endpoint: endpoint || 'unknown',
      })
      this.firstConnectionLogged = true
    }
  }

  /**
   * Called when a WebSocket connection is closed
   */
  onClose(endpoint?: string): void {
    this.state.connections = Math.max(0, this.state.connections - 1)
    
    // Track per-endpoint
    if (endpoint) {
      this.decEndpoint(endpoint, 'connections')
    }
  }

  /**
   * Called when server sends ping or receives pong (heartbeat mechanism)
   */
  onHeartbeat(): void {
    this.state.lastHeartbeatAt = Date.now()
  }

  /**
   * Called when any inbound client message is received
   */
  onClientMsg(): void {
    this.state.lastMessageAt = Date.now()
    // Update client activity timestamp
    this.lastClientActiveAt = Date.now()
  }

  /**
   * Called when a Trade event is processed/broadcast
   */
  onTradeEvent(): void {
    const now = Date.now()
    this.state.lastTradeEventAt = now
    // Update trade event timestamp for alerts
    this.lastTradeEventAt = now

    // Log first trade event only
    if (!this.firstTradeEventLogged) {
      console.log('[WS Health] First Trade event processed', {
        connections: this.state.connections,
        totalConnections: this.state.totalConnections,
      })
      this.firstTradeEventLogged = true
    }
  }

  /**
   * Called at the start of each ping cycle
   */
  onPingCycle(now: number, endpoint?: string): void {
    this.state.lastPingAt = now
    
    // Track per-endpoint
    if (endpoint) {
      this.setTimeEndpoint(endpoint, 'lastPingAt', now)
    }
  }

  /**
   * Called when a client responds with a pong
   */
  onPong(now: number, endpoint?: string): void {
    this.state.lastPongAt = now
    this.state.lastHeartbeatAt = now
    
    // Track per-endpoint
    if (endpoint) {
      this.setTimeEndpoint(endpoint, 'lastPongAt', now)
    }
    
    // Update client activity timestamp
    this.lastClientActiveAt = now
  }

  /**
   * Called when a client fails to respond to ping (missed heartbeat)
   */
  onMissedHeartbeat(endpoint?: string): void {
    this.state.missedHeartbeats++
    
    // Track per-endpoint
    if (endpoint) {
      this.incEndpoint(endpoint, 'missedHeartbeats')
    }
  }

  /**
   * Called when a client is dropped due to idle timeout
   */
  onIdleDrop(endpoint?: string): void {
    this.state.droppedForIdle++
    
    // Track per-endpoint
    if (endpoint) {
      this.incEndpoint(endpoint, 'droppedForIdle')
    }
  }

  /**
   * Get a snapshot of current health state
   */
  snapshot(): WsHealth {
    return { ...this.state }
  }

  /**
   * Get health snapshot with uptime
   */
  snapshotWithUptime(): WsHealth & { uptimeMs: number } {
    return {
      ...this.state,
      uptimeMs: Date.now() - this.state.startedAt,
    }
  }
  
  /**
   * Get alert status
   */
  getAlerts(): WsAlerts {
    return {
      hasWarnedNoClients: this.hasWarnedNoClients,
      hasWarnedNoTrades: this.hasWarnedNoTrades,
      lastClientActiveAt: this.lastClientActiveAt,
      lastTradeEventAt: this.lastTradeEventAt,
    }
  }
  
  /**
   * Get full health snapshot with alerts
   */
  snapshotWithAlerts(): WsHealth & { uptimeMs: number; alerts: WsAlerts } {
    return {
      ...this.snapshotWithUptime(),
      alerts: this.getAlerts(),
    }
  }
}

// Singleton instance
export const wsHealth = new WsHealthTracker()
