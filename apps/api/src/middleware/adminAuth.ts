import { FastifyRequest, FastifyReply } from 'fastify'
import { getConfig } from '@caifu/config'

const config = getConfig()

export interface AdminRequest extends FastifyRequest {
  admin?: {
    authenticated: boolean
    timestamp: number
  }
}

/**
 * Middleware to verify admin authentication via HttpOnly cookie
 * Checks for admin_token cookie with valid JWT
 */
export async function verifyAdminAuth(
  request: AdminRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    // Get admin_token cookie
    const adminToken = request.cookies?.admin_token
    
    if (!adminToken) {
      return reply.status(401).send({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Admin authentication required'
        },
        timestamp: new Date().toISOString()
      })
    }

    // Verify JWT token
    const decoded = request.server.jwt.verify(adminToken)
    
    // Attach admin info to request
    request.admin = {
      authenticated: true,
      timestamp: (typeof decoded === 'object' && decoded !== null && 'iat' in decoded) ? Number(decoded.iat) : Date.now()
    }
    
  } catch (error) {
    // Clear invalid cookie
    reply.clearCookie('admin_token', {
      path: '/',
      httpOnly: true,
      secure: config.isProduction,
      sameSite: config.isProduction ? 'none' : 'lax'
    })
    
    return reply.status(401).send({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Invalid admin token'
      },
      timestamp: new Date().toISOString()
    })
  }
}

/**
 * Login handler - validates password and sets HttpOnly cookie
 */
export async function handleAdminLogin(
  request: FastifyRequest<{
    Body: { password: string }
  }>,
  reply: FastifyReply
): Promise<void> {
  // Guard env vars
  if (!config.env.ADMIN_PASSWORD) {
    return reply.status(500).send({
      error: {
        code: 'SERVER_MISCONFIGURED',
        message: 'ADMIN_PASSWORD not configured'
      },
      timestamp: new Date().toISOString()
    })
  }
  
  if (!config.env.ADMIN_JWT_SECRET) {
    return reply.status(500).send({
      error: {
        code: 'SERVER_MISCONFIGURED',
        message: 'ADMIN_JWT_SECRET not configured'
      },
      timestamp: new Date().toISOString()
    })
  }
  
  // Parse body defensively
  const { password } = request.body || {}
  
  if (!password) {
    return reply.status(400).send({
      error: {
        code: 'MISSING_PASSWORD',
        message: 'Password is required'
      },
      timestamp: new Date().toISOString()
    })
  }
  
  // Compare password
  if (password !== config.env.ADMIN_PASSWORD) {
    return reply.status(401).send({
      error: {
        code: 'INVALID_PASSWORD',
        message: 'Invalid admin password'
      },
      timestamp: new Date().toISOString()
    })
  }
  
  // Generate JWT token (7 days)
  const token = request.server.jwt.sign(
    { 
      admin: true,
      iat: Math.floor(Date.now() / 1000)
    },
    { 
      expiresIn: '7d'
    }
  )
  
  // Set HttpOnly cookie with secure settings for cross-origin
  reply.setCookie('admin_token', token, {
    path: '/',
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    maxAge: 60 * 60 * 24 * 7 // 7 days in seconds
  })
  
  return reply.send({
    success: true,
    message: 'Admin login successful',
    expiresIn: '7d'
  })
}
