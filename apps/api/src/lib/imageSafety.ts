import type { FastifyBaseLogger } from 'fastify'
import vision from '@google-cloud/vision'

type Likelihood =
  | 'VERY_UNLIKELY'
  | 'UNLIKELY'
  | 'POSSIBLE'
  | 'LIKELY'
  | 'VERY_LIKELY'

const client = new vision.ImageAnnotatorClient()

const isVeryLikely = (value?: Likelihood | null): boolean => value === 'VERY_LIKELY'

export class ImageSafetyError extends Error {}

export async function assertImageSafe(
  buffer: Buffer,
  logger?: Pick<FastifyBaseLogger, 'info' | 'warn' | 'error'>
): Promise<void> {
  if (!buffer || buffer.length === 0) {
    throw new ImageSafetyError('Image failed safety checks')
  }

  try {
    const [result] = await client.safeSearchDetection({ image: { content: buffer } })
    const annotation = result?.safeSearchAnnotation

    if (!annotation) {
      logger?.warn?.({ reason: 'missing_annotation' }, 'image_safety_check_failed')
      throw new ImageSafetyError('Image failed safety checks')
    }

    const adult = annotation.adult as Likelihood | null | undefined
    const violence = annotation.violence as Likelihood | null | undefined

    const blockedAdult = isVeryLikely(adult)
    const blockedViolence = isVeryLikely(violence)

    if (blockedAdult || blockedViolence) {
      logger?.info?.({ adult, violence }, 'image_safety_blocked')
      const rejection = new ImageSafetyError('Image rejected by safety filter')
      rejection.name = 'ImageSafetyRejected'
      throw rejection
    }

    logger?.info?.({ adult, violence }, 'image_safety_allowed')
  } catch (error) {
    if (error instanceof ImageSafetyError) {
      throw error
    }

    logger?.error?.({ err: error }, 'image_safety_unavailable')
    throw new ImageSafetyError('Image failed safety checks')
  }
}

export { isVeryLikely }
