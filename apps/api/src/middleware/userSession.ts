import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import {
  SESSION_COOKIE_NAME,
  clearSessionCookie,
  setSessionCookie,
  validateSessionToken,
} from '../services/auth'

export const registerUserSession = async (app: FastifyInstance) => {
  app.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    const req = request as FastifyRequest & { user: any; session: any }
    req.user = null
    req.session = null
    const token = request.cookies?.[SESSION_COOKIE_NAME]
    if (!token) {
      return
    }

    try {
      const result = await validateSessionToken(app.prisma, token)
      if (!result) {
        clearSessionCookie(reply)
        req.user = null
        req.session = null
        return
      }

      req.user = result.user
      req.session = result.session

      if (result.refreshToken && result.rawSessionToken) {
        setSessionCookie(reply, result.rawSessionToken, result.expiresAt)
      }
    } catch (error) {
      app.log.warn({ err: error }, 'failed to validate session token')
      req.user = null
      req.session = null
      clearSessionCookie(reply)
    }
  })
}
