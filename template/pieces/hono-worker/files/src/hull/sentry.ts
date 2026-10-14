import type { ErrorEvent } from "@sentry/cloudflare";
import type { Hono } from "hono";

type Reporter = (err: Error) => void;
let reporter: Reporter | undefined;

/** Registers (or clears) the function `onErrorHandler` calls for unexpected errors. */
export function setErrorReporter(fn: Reporter | undefined): void {
  reporter = fn;
}

/** No-op unless Sentry is active (a reporter was registered). */
export function reportError(err: Error): void {
  reporter?.(err);
}

// Request data never leaves the worker: strip query strings, headers, cookies and bodies.
export function scrubEvent(event: ErrorEvent): ErrorEvent {
  const r = event.request as Record<string, unknown> | undefined;
  if (r) {
    delete r.query_string;
    delete r.headers;
    delete r.cookies;
    delete r.data;
    if (typeof r.url === "string") r.url = r.url.split("?")[0];
  }
  // captureException sends err.message, which can quote the request body.
  for (const v of event.exception?.values ?? []) v.value = "";
  // Breadcrumbs carry URLs with query strings.
  delete event.breadcrumbs;
  return event;
}

/**
 * Wraps the app with `@sentry/cloudflare` only when `env.SENTRY_DSN` is non-empty. The Sentry
 * package is imported dynamically (built once per isolate), so with an empty DSN it is never
 * evaluated.
 */
export function withOptionalSentry<E extends { SENTRY_DSN?: string }>(
  app: Hono<{ Bindings: E }>,
): ExportedHandler<E> {
  let wrapped: Promise<ExportedHandler<E>> | undefined;
  return {
    async fetch(request, env, ctx) {
      if (!env.SENTRY_DSN) return app.fetch(request as unknown as Request, env, ctx);
      wrapped ??= import("@sentry/cloudflare").then(({ withSentry, captureException }) => {
        setErrorReporter((err) => captureException(err));
        return withSentry((e: E) => ({ dsn: e.SENTRY_DSN, beforeSend: scrubEvent }), {
          fetch: (req, e, c) => app.fetch(req as unknown as Request, e, c),
        } as ExportedHandler<E>) as ExportedHandler<E>;
      });
      return (await wrapped).fetch!(request, env, ctx);
    },
  };
}
