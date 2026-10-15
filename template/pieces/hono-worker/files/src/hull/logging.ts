import type { Context, MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { reportError } from "./sentry";

type Level = "info" | "warn" | "error";

const RANK: Record<Level, number> = { info: 0, warn: 1, error: 2 };
const minLevel = (c: Context): Level => {
  const v = (c.env as { LOG_LEVEL?: string } | undefined)?.LOG_LEVEL;
  return v === "warn" || v === "error" ? v : "info";
};

// Error messages can quote request data (JSON.parse errors quote the body), so they are never
// logged: only the error name and the stack frames without the message.
const framesOf = (err: Error): string => {
  const head = `${err.name}: ${err.message}`;
  const stack = err.stack ?? "";
  return stack.startsWith(head) ? stack.slice(head.length).replace(/^\n/, "") : "";
};

// Contexts whose failure was already logged by onErrorHandler: the request line is skipped for
// them so a thrown error produces exactly one log line.
const failed = new WeakSet<object>();

const requestIdOf = (c: Context): string => String(c.get("requestId") ?? "");

// Only method, path (never the query string), status and Cloudflare colo/country are logged.
// Never add headers, query or body: logs must stay free of secrets and PII.
const where = (c: Context) => {
  const cf = (c.req.raw as { cf?: { colo?: string; country?: string } }).cf;
  return {
    requestId: requestIdOf(c),
    method: c.req.method,
    path: c.req.path,
    ...(cf?.colo ? { colo: cf.colo } : {}),
    ...(cf?.country ? { country: cf.country } : {}),
  };
};

const levelFor = (status: number): Level =>
  status >= 500 ? "error" : status >= 400 ? "warn" : "info";

/** Use after Hono's `requestId()`. Writes one JSON line per request. */
export function jsonLogger(): MiddlewareHandler {
  return async (c, next) => {
    const start = Date.now();
    await next();
    if (failed.has(c)) return;
    const status = c.res.status;
    const level = levelFor(status);
    if (RANK[level] < RANK[minLevel(c)]) return;
    console.log(
      JSON.stringify({
        level,
        msg: "request",
        ...where(c),
        status,
        durationMs: Date.now() - start,
      }),
    );
  };
}

/** Use with `app.onError`. Logs one error line and answers 500 JSON with the same requestId. */
export function onErrorHandler(err: Error, c: Context): Response {
  // Deliberate HTTP errors (401, 404, ...) are not failures: jsonLogger logs them as usual.
  if (err instanceof HTTPException) return err.getResponse();
  failed.add(c);
  const requestId = requestIdOf(c);
  console.log(
    JSON.stringify({
      level: "error",
      msg: err.name,
      ...where(c),
      status: 500,
      stack: framesOf(err),
    }),
  );
  reportError(err);
  return c.json({ error: "internal", requestId }, 500);
}
