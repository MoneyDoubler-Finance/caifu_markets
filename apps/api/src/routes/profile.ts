import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import { serializeUser } from '../services/auth'
import { formatZodIssues } from '../lib/zod'
import { uploadPaths } from '../lib/uploads'
import { assertImageSafe } from '../lib/imageSafety'

type AuthenticatedRequest = FastifyRequest & { user?: { id: string } | null }

const relativeAvatarRegex = /^\/static\/avatars\/[a-zA-Z0-9._-]+$/

const UpdateProfileSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(2, 'Display name must be at least 2 characters')
    .max(64, 'Display name must be at most 64 characters')
    .optional(),
  avatarUrl: z
    .union([
      z
        .string()
        .trim()
        .url('Avatar must be a valid URL')
        .max(2048, 'Avatar URL is too long'),
      z
        .string()
        .trim()
        .regex(relativeAvatarRegex, 'Avatar path must use /static/avatars/...'),
      z.literal(''),
      z.null(),
    ])
    .optional(),
})

function requireUser(request: AuthenticatedRequest, reply: FastifyReply) {
  const user = request.user
  if (!user) {
    reply.status(401).send({
      ok: false,
      error: 'Authentication required',
      timestamp: new Date().toISOString(),
    })
    return null
  }
  return user
}

const profileRoutes: FastifyPluginAsync = async (fastify) => {
  const { prisma } = fastify

  fastify.get('/profile', async (request, reply) => {
    const user = requireUser(request as AuthenticatedRequest, reply)
    if (!user) return

    const existing = await prisma.user.findUnique({
      where: { id: user.id },
    })

    if (!existing) {
      return reply.status(404).send({
        ok: false,
        error: 'User not found',
        timestamp: new Date().toISOString(),
      })
    }

    return reply.send({
      ok: true,
      user: serializeUser(existing),
    })
  })

  fastify.patch('/profile', async (request, reply) => {
    const authUser = requireUser(request as AuthenticatedRequest, reply)
    if (!authUser) return

    const parsed = UpdateProfileSchema.safeParse(request.body ?? {})
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: {
          code: 'INVALID_BODY',
          message: 'Invalid profile payload',
          details: formatZodIssues(parsed.error.issues),
        },
        timestamp: new Date().toISOString(),
      })
    }

    const { displayName, avatarUrl } = parsed.data
    if (displayName === undefined && avatarUrl === undefined) {
      return reply.status(400).send({
        ok: false,
        error: {
          code: 'NO_CHANGES',
          message: 'No changes were submitted',
        },
        timestamp: new Date().toISOString(),
      })
    }

    const updates: { displayName?: string | null; avatarUrl?: string | null } = {}

    if (displayName !== undefined) {
      updates.displayName = displayName.trim()
    }

    if (avatarUrl !== undefined) {
      updates.avatarUrl = avatarUrl && avatarUrl !== '' ? avatarUrl : null
    }

    if (Object.keys(updates).length === 0) {
      return reply.status(400).send({
        ok: false,
        error: {
          code: 'NO_CHANGES',
          message: 'No profile changes detected',
        },
        timestamp: new Date().toISOString(),
      })
    }

    const updated = await prisma.user.update({
      where: { id: authUser.id },
      data: updates,
    })

    const serialized = serializeUser(updated)
    ;(request as AuthenticatedRequest).user = serialized

    return reply.send({
      ok: true,
      user: serialized,
    })
  })

  fastify.post('/profile/avatar', async (request, reply) => {
    const authUser = requireUser(request as AuthenticatedRequest, reply)
    if (!authUser) return

    const parts = request.parts()
    let uploadedFile: { buffer: Buffer; mimetype: string; filename?: string; size: number } | null = null

    for await (const part of parts) {
      if (part.type === 'file' && part.fieldname === 'avatar') {
        const chunks: Buffer[] = []
        let total = 0
        for await (const chunk of part.file) {
          const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
          total += buf.length
          if (total > 5 * 1024 * 1024) {
            return reply.status(400).send({
              ok: false,
              error: {
                code: 'FILE_TOO_LARGE',
                message: 'Avatar must be 5MB or smaller',
              },
              timestamp: new Date().toISOString(),
            })
          }
          chunks.push(buf)
        }
        uploadedFile = {
          buffer: Buffer.concat(chunks),
          mimetype: part.mimetype,
          filename: part.filename,
          size: total,
        }
      } else if (part.type === 'file') {
        part.file.resume()
      }
    }

    if (!uploadedFile) {
      return reply.status(400).send({
        ok: false,
        error: {
          code: 'FILE_REQUIRED',
          message: 'An avatar image is required',
        },
        timestamp: new Date().toISOString(),
      })
    }

    const mimeToExt: Record<string, string> = {
      'image/png': '.png',
      'image/jpeg': '.jpg',
      'image/jpg': '.jpg',
      'image/webp': '.webp',
      'image/gif': '.gif',
    }

    const extension = mimeToExt[uploadedFile.mimetype]
    if (!extension) {
      return reply.status(400).send({
        ok: false,
        error: {
          code: 'UNSUPPORTED_TYPE',
          message: 'Only PNG, JPEG, WEBP, or GIF images are allowed',
        },
        timestamp: new Date().toISOString(),
      })
    }

    try {
      await assertImageSafe(uploadedFile.buffer, request.log)
    } catch (error) {
      request.log.warn({ error }, 'avatar_upload_safety_rejected')
      return reply.status(422).send({
        ok: false,
        error: {
          code: 'IMAGE_REJECTED',
          message: 'Image failed safety checks',
        },
        timestamp: new Date().toISOString(),
      })
    }

    const safeNameFragment =
      uploadedFile.filename?.replace(/[^a-zA-Z0-9-_]+/g, '').slice(0, 32) || 'avatar'
    const fileName = `${safeNameFragment}-${Date.now().toString(36)}${Math.random()
      .toString(16)
      .slice(2)}${extension}`
    const destination = path.join(uploadPaths.avatars, fileName)

    try {
      await fs.writeFile(destination, uploadedFile.buffer)
    } catch (error) {
      request.log.error({ error, destination }, 'avatar_upload_failed')
      return reply.status(500).send({
        ok: false,
        error: {
          code: 'UPLOAD_FAILED',
          message: 'Failed to save avatar file',
        },
        timestamp: new Date().toISOString(),
      })
    }

    const publicUrl = `/static/avatars/${fileName}`

    return reply.send({
      ok: true,
      avatarUrl: publicUrl,
    })
  })
}

export { profileRoutes }
