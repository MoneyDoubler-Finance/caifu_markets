import { promises as fs } from 'node:fs'
import path from 'node:path'

import { FastifyBaseLogger, FastifyPluginAsync } from 'fastify'

import { uploadPaths } from '../lib/uploads'

type SerializableBackground = {
  id: string
  tag: string
  normalizedTag: string
  imageUrl: string
  createdAt: string
  updatedAt: string
}

const serializeBackground = (record: any): SerializableBackground => ({
  id: record.id,
  tag: record.tag,
  normalizedTag: record.normalizedTag,
  imageUrl: record.imageUrl,
  createdAt: record.createdAt instanceof Date ? record.createdAt.toISOString() : record.createdAt,
  updatedAt: record.updatedAt instanceof Date ? record.updatedAt.toISOString() : record.updatedAt,
})

const allowedExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif'])

const normalizeTag = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const humanize = (value: string) =>
  value
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')

const buildTagFromFilename = (fileName: string) => {
  const parsed = path.parse(fileName)
  const nameParts = parsed.name.split('-')

  if (nameParts.length > 1 && /^\d+$/.test(nameParts[nameParts.length - 1] ?? '')) {
    nameParts.pop()
  }

  const raw = nameParts.join(' ').trim() || parsed.name
  const normalized = normalizeTag(raw) || normalizeTag(parsed.name)
  const tag = humanize(normalized || raw)

  return { tag, normalizedTag: normalized || raw.toLowerCase() }
}

async function readFilesystemBackgrounds(logger: FastifyBaseLogger): Promise<SerializableBackground[]> {
  try {
    const directory = uploadPaths.tileBackgrounds
    const entries = await fs.readdir(directory)
    const files = entries.filter((file) => allowedExtensions.has(path.extname(file).toLowerCase()))

    const backgrounds = await Promise.all(
      files.map(async (file) => {
        const location = path.join(directory, file)
        const stats = await fs.stat(location)
        const { tag, normalizedTag } = buildTagFromFilename(file)

        return {
          id: `file:${file}`,
          tag,
          normalizedTag,
          imageUrl: `/static/tile-backgrounds/${file}`,
          createdAt: stats.birthtime.toISOString(),
          updatedAt: stats.mtime.toISOString(),
        }
      })
    )

    return backgrounds.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  } catch (error) {
    logger.error({ err: error }, 'tileBackgrounds: failed to read uploads directory')
    return []
  }
}

export const tileBackgroundRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/tile-backgrounds', async (_request, reply) => {
    const dbBackgrounds = await fastify.prisma.marketTileBackground.findMany({
      orderBy: [{ updatedAt: 'desc' }],
    })

    let backgrounds = dbBackgrounds.map(serializeBackground)

    const filesystemBackgrounds = await readFilesystemBackgrounds(fastify.log)
    const seen = new Set(backgrounds.map((entry) => entry.normalizedTag))

    for (const background of filesystemBackgrounds) {
      if (!seen.has(background.normalizedTag)) {
        backgrounds.push(background)
      }
    }

    backgrounds.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))

    reply.header('Cache-Control', 'public, max-age=60, stale-while-revalidate=300')

    return reply.send({
      backgrounds,
    })
  })
}
