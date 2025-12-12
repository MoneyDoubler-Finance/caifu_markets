This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, install dependencies and start the development server:

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font).

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deployment

### Docker

The production image is built with `ops/Dockerfile.frontend` from the repository root and expects the pnpm workspace layout. Build with:

```bash
docker build -f ops/Dockerfile.frontend -t caifu/frontend .
```

Provide runtime configuration via environment variables (see `env.local.example`).

### Sentry Environment Variables

- Local development:

```bash
# frontend/.env.local
NEXT_PUBLIC_SENTRY_DSN=your_dsn
```

- Vercel Project → Settings → Environment Variables:
  - `NEXT_PUBLIC_SENTRY_DSN`
  - `SENTRY_AUTH_TOKEN`
  - `SENTRY_ORG`
  - `SENTRY_PROJECT`

Vercel automatically provides `VERCEL_GIT_COMMIT_SHA` which is used for release tagging.
