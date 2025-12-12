import { FastifyInstance } from 'fastify'

export async function registerAdminPing(app: FastifyInstance) {
  // Shared handler for both POST and GET
  const pingHandler = async (req: any, reply: any) => {
    // Reuse the same auth logic the admin route uses
    try {
      await req.jwtVerify()
      
      // Extract subject from JWT payload
      const user = req.user || {}
      const sub = user.sub || 'unknown'
      const mode = 'jwt' // We verified via JWT
      
      // Store auth info on request for potential use
      req.adminSub = sub
      req.adminAuthMode = mode
      
      return { ok: true, sub, mode }
    } catch (err) {
      return reply.code(401).send({ 
        error: 'Admin authentication required',
        message: err instanceof Error ? err.message : 'JWT verification failed'
      })
    }
  }

  // Accept both POST and GET
  app.post('/api/admin/ping', pingHandler)
  app.get('/api/admin/ping', pingHandler)
}

