import { z } from 'zod'

export const MIN_INITIAL_LIQUIDITY_USDF = 0

const coerceInitialLiquidity = (value: unknown): number => {
  if (value === null || value === undefined) {
    return Number.NaN
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : Number.NaN
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) {
      return Number.NaN
    }
    const parsed = Number(trimmed)
    return Number.isFinite(parsed) ? parsed : Number.NaN
  }
  return Number.NaN
}

const InitialLiquiditySchema = z
  .union([z.string(), z.number(), z.null(), z.undefined()])
  .transform((value) => {
    if (value === '') {
      return Number.NaN
    }
    return coerceInitialLiquidity(value)
  })
  .refine((value) => Number.isFinite(value), {
    message: 'Initial liquidity must be a valid number',
  })

// Base types
export type Address = `0x${string}`
export type HexString = `0x${string}`
export type BigIntString = string

// Market status enum
export enum MarketStatus {
  ACTIVE = 'active',
  RESOLVED = 'resolved',
  CANCELLED = 'cancelled'
}

// Database models
export interface Market {
  id: string
  conditionId: HexString | null
  fpmmAddress?: HexString | null
  title: string
  outcomes: string[]
  status: MarketStatus
  createdAt: Date
  resolvedAt?: Date
  resolutionData?: {
    payoutNumerators: number[]
  }
}

export interface Trade {
  id: string
  marketId: string
  takerAddress: Address
  makerAddress: Address
  price: BigIntString
  size: BigIntString
  txHash?: HexString
  createdAt: Date
}

export interface Position {
  id: string
  userAddress: Address
  marketId: string
  outcome: number
  quantity: BigIntString
  updatedAt: Date
}

// API request/response schemas
export const CreateMarketRequestSchema = z.object({
  title: z.string().min(1).max(200),
  outcomes: z.array(z.string().min(1).max(50)).min(2).max(256),
  oracleAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid Ethereum address'),
  questionId: z.string().regex(/^0x[a-fA-F0-9]{64}$/, 'Invalid question ID format'),
  initialLiquidity: InitialLiquiditySchema,
})

const OutcomeOptionSchema = z.string().trim().min(1, 'Outcome cannot be empty').max(64, 'Outcome is too long')

const TagOptionSchema = z.string().trim().min(2, 'Tag must be at least 2 characters').max(64, 'Tag is too long')

const TagsArraySchema = z
  .array(TagOptionSchema)
  .max(12, 'Provide at most 12 tags')
  .optional()
  .transform((value) => {
    if (!value) return []
    const seen = new Map<string, string>()
    value.forEach((tag) => {
      const normalized = tag.toLowerCase()
      if (!seen.has(normalized)) {
        seen.set(normalized, tag)
      }
    })
    return Array.from(seen.values())
  })

const HeroImageUrlSchema = z
  .union([
    z
      .string()
      .trim()
      .max(512, 'Hero image path is too long')
      .regex(/^\/static\/market-heroes\/[A-Za-z0-9._-]+$/, 'Hero image must be uploaded via the market uploader'),
    z.literal(''),
    z.null(),
    z.undefined(),
  ])
  .transform((value) => {
    if (typeof value !== 'string') {
      return null
    }
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
  })

const AddressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid address')

const BaseCreateMarketInputSchema = z.object({
  question: z.string().trim().min(1, 'Question is required').max(200, 'Question is too long'),
  outcomes: z
    .array(OutcomeOptionSchema)
    .min(2, 'Provide at least two outcomes')
    .max(2, 'Binary markets support exactly two outcomes')
    .superRefine((values, ctx) => {
      const seen = new Map<string, number>()
      values.forEach((value, index) => {
        const key = value.toLowerCase()
        if (seen.has(key)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Outcomes must be unique',
            path: [index],
          })
        } else {
          seen.set(key, index)
        }
      })
    }),
  category: z
    .string()
    .trim()
    .min(2, 'Category must be at least 2 characters')
    .max(120, 'Category must be at most 120 characters')
    .optional(),
  tags: TagsArraySchema,
  resolution: z
    .string({ required_error: 'Resolution / expiry is required' })
    .trim()
    .min(1, 'Resolution / expiry is required')
    .superRefine((value, ctx) => {
      const timestamp = Date.parse(value)
      if (Number.isNaN(timestamp)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Resolution must be a valid ISO 8601 date/time',
          path: [],
        })
      }
    }),
  heroImageUrl: HeroImageUrlSchema,
  slug: z
    .union([z.string(), z.null(), z.undefined()])
    .transform((value) => {
      if (typeof value !== 'string') return null
      const trimmed = value.trim()
      return trimmed.length ? trimmed : null
    }),
  creatorAddress: AddressSchema,
  initialLiquidity: InitialLiquiditySchema,
})

export const CreateMarketInputSchema = BaseCreateMarketInputSchema.extend({
  feeBps: z.coerce
    .number()
    .int()
    .min(0, 'Fee must be between 0 and 10,000')
    .max(10_000, 'Fee must be between 0 and 10,000'),
  initialPriceBps: z.coerce
    .number()
    .int()
    .min(1, 'Initial price must be between 1 and 9,999')
    .max(9_999, 'Initial price must be between 1 and 9,999'),
})

export const PublicCreateMarketInputSchema = BaseCreateMarketInputSchema.extend({
  feeBps: z.coerce
    .number()
    .int()
    .min(0, 'Fee must be between 0 and 10,000')
    .max(10_000, 'Fee must be between 0 and 10,000')
    .default(269),
  initialPriceBps: z.coerce
    .number()
    .int()
    .min(1, 'Initial price must be between 1 and 9,999')
    .max(9_999, 'Initial price must be between 1 and 9,999')
    .default(5_000),
})

export const ResolveMarketRequestSchema = z.object({
  marketId: z.string(),
  payoutNumerators: z.array(z.number().int().min(0).max(100)).min(2)
})

export type CreateMarketInput = z.infer<typeof CreateMarketInputSchema>
export type PublicCreateMarketInput = z.infer<typeof PublicCreateMarketInputSchema>

export const validateCreateMarketInput = (data: unknown): CreateMarketInput => {
  return CreateMarketInputSchema.parse(data)
}

export const validatePublicCreateMarketInput = (data: unknown): PublicCreateMarketInput => {
  return PublicCreateMarketInputSchema.parse(data)
}

// Response schemas
export const MarketResponseSchema = z.object({
  id: z.string(),
  conditionId: z.string().nullable(),
  fpmmAddress: z.string().nullable().optional(),
  slug: z.string().nullable().optional(),
  title: z.string(),
  outcomes: z.array(z.string()),
  status: z.nativeEnum(MarketStatus),
  category: z.string().nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
  tags: z.array(z.string()).optional(),
  heroImageUrl: z.string().nullable().optional(),
  createdAt: z.string().datetime(),
  resolvedAt: z.string().datetime().optional(),
  resolutionData: z.object({
    payoutNumerators: z.array(z.number())
  }).optional(),
  yesPrice: z.number().optional()
})

export const TradeResponseSchema = z.object({
  id: z.string(),
  marketId: z.string(),
  takerAddress: z.string(),
  makerAddress: z.string(),
  price: z.string(),
  size: z.string(),
  txHash: z.string().optional(),
  createdAt: z.string().datetime()
})

export const PositionResponseSchema = z.object({
  id: z.string(),
  userAddress: z.string(),
  marketId: z.string(),
  outcome: z.number(),
  quantity: z.string(),
  updatedAt: z.string().datetime()
})

export const TradeUpdateSchema = z.object({
  type: z.literal('trade_update'),
  trade: TradeResponseSchema
})

export const MarketUpdateSchema = z.object({
  type: z.literal('market_update'),
  market: MarketResponseSchema
})

// Utility types
export type CreateMarketRequest = z.infer<typeof CreateMarketRequestSchema>
export type ResolveMarketRequest = z.infer<typeof ResolveMarketRequestSchema>
export type MarketResponse = z.infer<typeof MarketResponseSchema>
export type TradeResponse = z.infer<typeof TradeResponseSchema>
export type PositionResponse = z.infer<typeof PositionResponseSchema>
export type TradeUpdate = z.infer<typeof TradeUpdateSchema>
export type MarketUpdate = z.infer<typeof MarketUpdateSchema>

// Validation helpers
export const validateMarket = (data: unknown): CreateMarketRequest => {
  return CreateMarketRequestSchema.parse(data)
}

export const validateMarketResolution = (data: unknown): ResolveMarketRequest => {
  return ResolveMarketRequestSchema.parse(data)
}

// Type guards
export const isMarketStatus = (value: string): value is MarketStatus => {
  return Object.values(MarketStatus).includes(value as MarketStatus)
}

// Error types
export class ValidationError extends Error {
  constructor(message: string, public readonly errors: z.ZodError) {
    super(message)
    this.name = 'ValidationError'
  }
}

export class NotFoundError extends Error {
  constructor(resource: string, id: string) {
    super(`${resource} with id ${id} not found`)
    this.name = 'NotFoundError'
  }
}

export class ConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConflictError'
  }
}

// API error response schema
export const ErrorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.any().optional()
  }),
  timestamp: z.string().datetime()
})

export type ErrorResponse = z.infer<typeof ErrorResponseSchema>
