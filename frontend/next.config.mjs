import { withSentryConfig } from '@sentry/nextjs'

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@metamask/sdk'],
  // Next 16: configure lint and TS via standalone commands; keep build unblocked
  typescript: { ignoreBuildErrors: true },
  experimental: {
    // Dev FS cache works on stable 16; build FS cache requires canary
    turbopackFileSystemCacheForDev: true,
  },
  env: {
    SENTRY_RELEASE: process.env.VERCEL_GIT_COMMIT_SHA || process.env.SENTRY_RELEASE || 'local-dev',
  },
  async rewrites() {
    return [
      {
        source: '/api/:path*',
          destination: 'https://api.example.com/api/:path*',
      },
    ]
  },
}

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG || 'caifu',
  project: process.env.SENTRY_PROJECT || 'caifu-sentry',
  release: { name: process.env.VERCEL_GIT_COMMIT_SHA || process.env.SENTRY_RELEASE },
  silent: !process.env.CI,
  widenClientFileUpload: true,
  tunnelRoute: '/monitoring',
  disableLogger: true,
  automaticVercelMonitors: true,
})
