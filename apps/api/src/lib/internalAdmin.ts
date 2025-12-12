import type { FastifyInstance, FastifyRequest } from 'fastify'

const ADMIN_COOKIE_NAME = 'admin_token'
const INTERNAL_COOKIE_TTL_MS = 6 * 24 * 60 * 60 * 1000 // 6 days cushion (server issues new cookie every 7d)

let cachedAdminCookie: { value: string | null; expiresAt: number } = {
  value: null,
  expiresAt: 0,
}

async function getInternalAdminCookie(fastify: FastifyInstance): Promise<string> {
    const now = Date.now()
    if (cachedAdminCookie.value && cachedAdminCookie.expiresAt > now) {
      return cachedAdminCookie.value
    }

    const adminPassword = process.env.ADMIN_PASSWORD
    if (!adminPassword) {
      throw new Error('ADMIN_PASSWORD not configured; cannot create internal admin session')
    }

    const response = await fastify.inject({
      method: 'POST',
      url: '/api/admin/login',
      payload: JSON.stringify({ password: adminPassword }),
      headers: {
        'content-type': 'application/json',
      },
    })

    if (response.statusCode !== 200) {
      throw new Error(`Internal admin login failed with status ${response.statusCode}`)
    }

    const rawSetCookie = response.headers['set-cookie']
    const headerValue = Array.isArray(rawSetCookie) ? rawSetCookie[0] : rawSetCookie
    if (!headerValue) {
      throw new Error('Internal admin login missing Set-Cookie header')
    }

    const cookiePair = headerValue.split(';')[0]
    if (!cookiePair.startsWith(`${ADMIN_COOKIE_NAME}=`)) {
      throw new Error('Internal admin cookie mismatch')
    }

    cachedAdminCookie = {
      value: cookiePair,
      expiresAt: now + INTERNAL_COOKIE_TTL_MS,
    }

    return cookiePair
}

export async function resolveAdminCookie(
  fastify: FastifyInstance,
  request: FastifyRequest
): Promise<string> {
  const userCookie = request.cookies?.[ADMIN_COOKIE_NAME]
  if (userCookie) {
    return `${ADMIN_COOKIE_NAME}=${userCookie}`
  }

  return getInternalAdminCookie(fastify)
}

export function resetInternalAdminCookie() {
  cachedAdminCookie = { value: null, expiresAt: 0 }
}
