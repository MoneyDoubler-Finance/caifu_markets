/**
 * JSON Schema definitions for API validation
 * Used by Fastify's built-in validation (Ajv)
 */

// ──────────────────────────────────────────────────────────────
// Admin Routes
// ──────────────────────────────────────────────────────────────

export const AdminCreateMarketBodySchema = {
  $id: 'AdminCreateMarketBody',
  type: 'object',
  required: ['question'],
  additionalProperties: false,
  properties: {
    question: {
      type: 'string',
      minLength: 3,
      maxLength: 200
    },
    outcomes: {
      type: 'array',
      items: { type: 'string', minLength: 1, maxLength: 50 },
      minItems: 2,
      maxItems: 256,
      default: ['Yes', 'No']
    },
    resolutionUnix: {
      type: ['integer', 'null'],
      nullable: true
    },
    lpFeeBps: {
      type: 'integer',
      minimum: 0,
      maximum: 10000,
      default: 200
    },
    initialPriceBps: {
      type: 'integer',
      minimum: 0,
      maximum: 10000,
      default: 5000
    }
  }
} as const

export const AdminTileBackgroundBodySchema = {
  $id: 'AdminTileBackgroundBody',
  type: 'object',
  required: ['tag', 'imageUrl'],
  additionalProperties: false,
  properties: {
    tag: {
      type: 'string',
      minLength: 2,
      maxLength: 120,
    },
    imageUrl: {
      type: 'string',
      minLength: 6,
      maxLength: 2048,
      pattern: '^(https?:)?//.+',
    },
  },
} as const

// ──────────────────────────────────────────────────────────────
// Market Routes
// ──────────────────────────────────────────────────────────────

export const GetMarketsQuerySchema = {
  $id: 'GetMarketsQuery',
  type: 'object',
  additionalProperties: false,
  properties: {
    limit: {
      type: 'integer',
      minimum: 1,
      maximum: 100,
      default: 20
    },
    cursor: {
      type: 'string'
    },
    search: {
      type: 'string',
      maxLength: 64
    },
    status: {
      type: 'string',
      enum: ['active', 'resolved', 'cancelled']
    },
    includeDeleted: {
      type: 'string',
      enum: ['0', '1'],
      nullable: true
    }
  }
} as const

// ──────────────────────────────────────────────────────────────
// Error Formatter
// ──────────────────────────────────────────────────────────────

export interface ValidationErrorResponse {
  code: string
  field?: string
  message?: string
  timestamp: string
}

/**
 * Format Fastify/Ajv validation errors into a clean response
 */
export function formatValidationError(error: any): ValidationErrorResponse {
  // Fastify attaches validation errors in error.validation
  const validation = error.validation || []
  
  if (validation.length > 0) {
    const first = validation[0]
    
    // Extract field from instancePath or params
    let field: string | undefined
    if (first.instancePath) {
      field = first.instancePath.replace(/^\//, '') // Remove leading slash
    } else if (first.params?.missingProperty) {
      field = first.params.missingProperty
    }
    
    return {
      code: 'VALIDATION_ERROR',
      field,
      message: first.message || 'Validation failed',
      timestamp: new Date().toISOString()
    }
  }
  
  // Fallback for non-Ajv errors
  return {
    code: 'VALIDATION_ERROR',
    message: error.message || 'Invalid request',
    timestamp: new Date().toISOString()
  }
}

// ──────────────────────────────────────────────────────────────
// Type Helpers
// ──────────────────────────────────────────────────────────────

export interface AdminCreateMarketBody {
  question: string
  outcomes?: string[]
  resolutionUnix?: number | null
  lpFeeBps?: number
  initialPriceBps?: number
}

export interface AdminTileBackgroundBody {
  tag: string
  imageUrl: string
}

export interface GetMarketsQuery {
  limit?: number
  cursor?: string
  search?: string
  status?: 'active' | 'resolved' | 'cancelled'
   includeDeleted?: '0' | '1'
}
