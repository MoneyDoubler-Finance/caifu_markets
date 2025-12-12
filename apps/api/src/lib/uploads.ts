import path from 'node:path'
import { promises as fs, existsSync } from 'node:fs'

const defaultRoot = path.join(process.cwd(), 'uploads')
const repoUploads = path.resolve(process.cwd(), '..', '..', 'uploads')
const envRoot = process.env.CAIFU_UPLOADS_ROOT

const uploadsRoot =
  (envRoot && envRoot.trim().length > 0 && envRoot) ||
  (existsSync(repoUploads) ? repoUploads : null) ||
  (existsSync(defaultRoot) ? defaultRoot : null) ||
  defaultRoot
const tileBackgroundDir = path.join(uploadsRoot, 'tile-backgrounds')
const marketHeroDir = path.join(uploadsRoot, 'market-heroes')
const avatarDir = path.join(uploadsRoot, 'avatars')

export const uploadPaths = {
  root: uploadsRoot,
  tileBackgrounds: tileBackgroundDir,
  marketHeroes: marketHeroDir,
  avatars: avatarDir,
}

export async function ensureUploadDirectories() {
  await Promise.all([
    fs.mkdir(uploadsRoot, { recursive: true }),
    fs.mkdir(tileBackgroundDir, { recursive: true }),
    fs.mkdir(marketHeroDir, { recursive: true }),
    fs.mkdir(avatarDir, { recursive: true }),
  ])
}
