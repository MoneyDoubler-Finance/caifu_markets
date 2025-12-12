// This file configures the initialization of Sentry on the client.
// The added config here will be used whenever a users loads a page in their browser.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";

const isProd = process.env.NODE_ENV === 'production';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN || '',
  tracesSampleRate: isProd ? 0.2 : 1.0,

  // Session Replay
  replaysSessionSampleRate: isProd ? 0.1 : 0.5,
  replaysOnErrorSampleRate: 1.0,

  ignoreErrors: [
    // extension/ad-blocker noise
    'Blocked by client',
    'ResizeObserver loop limit exceeded',
    'Non-Error promise rejection captured',
  ],
  denyUrls: [
    /extensions\//i,
    /^chrome:\/\//i,
    /coinbase\.com\/(amp|metrics)/i,
    /walletconnect/i,
  ],

  beforeSend(event) {
    // Remove sensitive headers if present
    if (event.request?.headers) {
      delete event.request.headers['cookie'];
      delete event.request.headers['authorization'];
      delete event.request.headers['Authentication'];
    }
    // Redact token-like query params
    if (event.request?.url) {
      try {
        const u = new URL(event.request.url);
        if (u.searchParams.has('token')) {
          u.searchParams.set('token', '[REDACTED]');
          event.request.url = u.toString();
        }
      } catch {}
    }
    return event;
  },

  integrations: [
    Sentry.replayIntegration({
      maskAllText: true,
      blockAllMedia: true,
    }),
  ],

  // Enable logs to be sent to Sentry
  enableLogs: true,

  // Enable sending user PII (Personally Identifiable Information)
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/options/#sendDefaultPii
  sendDefaultPii: true,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;