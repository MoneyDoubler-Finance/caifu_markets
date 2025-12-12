import Fastify from 'fastify'
import multipart from '@fastify/multipart'
import cookie from '@fastify/cookie'
import jwt from '@fastify/jwt'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { uploadPaths, ensureUploadDirectories } from '../lib/uploads'
import { profileRoutes } from '../routes/profile'
import { marketRoutes } from '../routes/markets'
import { adminRoutes } from '../routes/admin'

jest.mock('@google-cloud/vision', () => {
  const safeSearchDetection = jest.fn()
  return {
    ImageAnnotatorClient: jest.fn(() => ({
      safeSearchDetection,
    })),
    __visionSafeSearchMock: safeSearchDetection,
  }
})

// eslint-disable-next-line @typescript-eslint/no-var-requires
const safeSearchMock = (require('@google-cloud/vision') as any).__visionSafeSearchMock as jest.Mock

type SafeAnnotation = {
  adult?: string | null
  violence?: string | null
  racy?: string | null
}

const setSafeSearch = (annotation: SafeAnnotation) => {
  safeSearchMock.mockResolvedValue([{ safeSearchAnnotation: annotation }])
}

const prismaMock = {
  user: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  marketTileBackground: {
    upsert: jest.fn(async ({ normalizedTag, tag, imageUrl }: any) => ({
      id: 'bg-1',
      tag,
      normalizedTag,
      imageUrl,
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
    findMany: jest.fn(async () => []),
  },
  market: {
    findFirst: jest.fn(),
  },
}

function buildMultipartBody(options: {
  fieldName: string
  filename: string
  contentType: string
  content: Buffer
  extraFields?: Record<string, string>
}) {
  const boundary = '----jestboundary'
  const chunks: Buffer[] = []

  if (options.extraFields) {
    for (const [key, value] of Object.entries(options.extraFields)) {
      chunks.push(
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`
        )
      )
    }
  }

  chunks.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${options.fieldName}"; filename="${options.filename}"\r\nContent-Type: ${options.contentType}\r\n\r\n`
    )
  )
  chunks.push(options.content)
  chunks.push(Buffer.from(`\r\n--${boundary}--\r\n`))

  return {
    payload: Buffer.concat(chunks),
    contentType: `multipart/form-data; boundary=${boundary}`,
  }
}

async function buildApp() {
  const app = Fastify({ logger: false })

  app.decorate('prisma', prismaMock as any)
  app.decorate('publicClient', {} as any)
  app.decorate('redis', null)
  app.decorate('wsClient', null)
  app.decorate('sdk', {} as any)

  await app.register(cookie)
  await app.register(jwt, { secret: process.env.ADMIN_JWT_SECRET || 'x'.repeat(32) })
  await app.register(multipart, { attachFieldsToBody: false })

  app.addHook('preHandler', (req, _reply, done) => {
    ;(req as any).user = { id: 'user-1' }
    done()
  })

  await app.register(profileRoutes, { prefix: '/api' })
  await app.register(marketRoutes, { prefix: '/api' })
  await app.register(adminRoutes, { prefix: '/api/admin' })

  await app.ready()
  return app
}

const listFiles = async (dir: string) => {
  try {
    return await fs.readdir(dir)
  } catch {
    return []
  }
}

beforeEach(async () => {
  safeSearchMock.mockReset()
  prismaMock.marketTileBackground.upsert.mockClear()
  await fs.rm(uploadPaths.root, { recursive: true, force: true })
  await ensureUploadDirectories()
})

describe('image safety enforcement', () => {
  it('rejects avatar upload when adult is VERY_LIKELY and does not write a file', async () => {
    setSafeSearch({ adult: 'VERY_LIKELY', violence: 'UNLIKELY', racy: 'VERY_UNLIKELY' })
    const app = await buildApp()

    const { payload, contentType } = buildMultipartBody({
      fieldName: 'avatar',
      filename: 'avatar.png',
      contentType: 'image/png',
      content: Buffer.from('avatar-bytes'),
    })

    const response = await app.inject({
      method: 'POST',
      url: '/api/profile/avatar',
      payload,
      headers: { 'content-type': contentType },
    })

    expect(response.statusCode).toBe(422)
    expect(await listFiles(uploadPaths.avatars)).toHaveLength(0)
    await app.close()
  })

  it('rejects market hero upload when violence is VERY_LIKELY', async () => {
    setSafeSearch({ adult: 'UNLIKELY', violence: 'VERY_LIKELY', racy: 'POSSIBLE' })
    const app = await buildApp()

    const { payload, contentType } = buildMultipartBody({
      fieldName: 'file',
      filename: 'hero.png',
      contentType: 'image/png',
      content: Buffer.from('hero-bytes'),
    })

    const response = await app.inject({
      method: 'POST',
      url: '/api/market-hero/upload',
      payload,
      headers: { 'content-type': contentType },
    })

    expect(response.statusCode).toBe(422)
    expect(await listFiles(uploadPaths.marketHeroes)).toHaveLength(0)
    await app.close()
  })

  it('allows upload when only racy is VERY_LIKELY and writes the file', async () => {
    setSafeSearch({ adult: 'LIKELY', violence: 'VERY_UNLIKELY', racy: 'VERY_LIKELY' })
    const app = await buildApp()

    const login = await app.inject({
      method: 'POST',
      url: '/api/admin/login',
      payload: { password: process.env.ADMIN_PASSWORD },
      headers: { 'content-type': 'application/json' },
    })

    const cookieHeader =
      login.cookies?.map((c) => `${c.name}=${c.value}`).join('; ') ||
      (Array.isArray(login.headers['set-cookie'])
        ? (login.headers['set-cookie'] as string[])[0]?.split(';')[0]
        : '')

    const { payload, contentType } = buildMultipartBody({
      fieldName: 'file',
      filename: 'bg.png',
      contentType: 'image/png',
      content: Buffer.from('bg-bytes'),
      extraFields: { tag: 'Summer' },
    })

    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/tile-backgrounds/upload',
      payload,
      headers: {
        'content-type': contentType,
        cookie: cookieHeader,
      },
    })

    expect(response.statusCode).toBe(200)
    expect(await listFiles(uploadPaths.tileBackgrounds)).toHaveLength(1)
    expect(prismaMock.marketTileBackground.upsert).toHaveBeenCalledTimes(1)
    await app.close()
  })
})
