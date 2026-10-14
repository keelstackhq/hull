import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { requestId } from "hono/request-id";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { jsonLogger, onErrorHandler } from "./logging";
import { scrubEvent, setErrorReporter, withOptionalSentry } from "./sentry";

const app = new Hono<{ Bindings: { SENTRY_DSN?: string } }>();
app.use(requestId());
app.use(jsonLogger());
app.onError(onErrorHandler);
app.get("/hello", (c) => c.text("hi"));
app.get("/cb", (c) => c.text("cb"));
app.get("/teapot", (c) => c.text("no", 500));
app.get("/leak", () => {
  throw new SyntaxError('Unexpected token, "{"token":"abc"}" is not valid JSON');
});
app.get("/denied", () => {
  throw new HTTPException(401, { message: "nope" });
});
app.get("/boom", () => {
  throw new Error("kaput");
});

let spy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  spy = vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  spy.mockRestore();
  setErrorReporter(undefined);
  vi.doUnmock("@sentry/cloudflare");
});

const raw = () => spy.mock.calls.map((a: unknown[]) => String(a[0])).join("\n");
const lines = (): Record<string, unknown>[] =>
  spy.mock.calls.map((a: unknown[]) => JSON.parse(String(a[0])));

it("logs one JSON line per request", async () => {
  await app.request("/hello");
  expect(lines()).toHaveLength(1);
  expect(lines()[0]).toMatchObject({
    level: "info",
    msg: "request",
    method: "GET",
    path: "/hello",
    status: 200,
  });
  expect(typeof lines()[0]?.requestId).toBe("string");
  expect(typeof lines()[0]?.durationMs).toBe("number");
});

it("drops the query string", async () => {
  await app.request("/cb?token=abc");
  expect(raw()).not.toContain("abc");
  expect(lines()[0]?.path).toBe("/cb");
});

it("never logs headers", async () => {
  await app.request("/hello", { headers: { authorization: "Bearer s3cret" } });
  expect(raw()).not.toContain("s3cret");
});

it("warn for 404, error for 500", async () => {
  await app.request("/missing");
  await app.request("/teapot");
  expect(lines().map((l) => [l.status, l.level])).toEqual([
    [404, "warn"],
    [500, "error"],
  ]);
});

it("thrown error gives one error line and 500 with the same requestId", async () => {
  const res = await app.request("/boom?token=abc");
  const body = (await res.json()) as { error: string; requestId: string };
  expect(res.status).toBe(500);
  expect(body).toEqual({ error: "internal", requestId: expect.any(String) });
  expect(lines()).toHaveLength(1);
  expect(lines().filter((l) => l.level === "error")).toHaveLength(1);
  expect(lines().every((l) => l.requestId === body.requestId)).toBe(true);
  expect(raw()).not.toContain("abc");
});

it("echoes x-request-id", async () => {
  const res = await app.request("/hello", { headers: { "x-request-id": "req-1234" } });
  expect(res.headers.get("x-request-id")).toBe("req-1234");
  expect(lines()[0]?.requestId).toBe("req-1234");
});

it("withOptionalSentry serves requests without loading Sentry when SENTRY_DSN is empty", async () => {
  const sentryLoaded = vi.fn();
  vi.doMock("@sentry/cloudflare", () => {
    sentryLoaded();
    return { withSentry: () => ({}) };
  });
  const handler = withOptionalSentry(app);
  for (const env of [{ SENTRY_DSN: "" }, {}]) {
    const res = await handler.fetch!(new Request("http://x/hello"), env, {} as ExecutionContext);
    expect(res.status).toBe(200);
  }
  expect(sentryLoaded).not.toHaveBeenCalled();
});

it("never logs the error message, which can quote the request body", async () => {
  const res = await app.request("/leak");
  expect(res.status).toBe(500);
  expect(raw()).not.toContain("abc");
  expect(lines()).toHaveLength(1);
  expect(lines()[0]).toMatchObject({ level: "error", msg: "SyntaxError" });
});

it("HTTPException answers its own response with one normal warn line", async () => {
  const res = await app.request("/denied");
  expect(res.status).toBe(401);
  expect(lines()).toHaveLength(1);
  expect(lines()[0]).toMatchObject({ level: "warn", msg: "request", path: "/denied", status: 401 });
});

it("reports unexpected errors to the registered reporter only", async () => {
  await app.request("/boom");
  const reporter = vi.fn();
  setErrorReporter(reporter);
  await app.request("/boom");
  await app.request("/denied");
  expect(reporter).toHaveBeenCalledTimes(1);
  expect(reporter.mock.calls[0]?.[0]).toBeInstanceOf(Error);
});

it("honours LOG_LEVEL", async () => {
  await app.request("/hello", {}, { LOG_LEVEL: "warn" });
  expect(lines()).toHaveLength(0);
  await app.request("/missing", {}, { LOG_LEVEL: "warn" });
  expect(lines()).toHaveLength(1);
  await app.request("/missing", {}, { LOG_LEVEL: "error" });
  expect(lines()).toHaveLength(1);
  await app.request("/teapot", {}, { LOG_LEVEL: "error" });
  expect(lines()).toHaveLength(2);
});

it("scrubEvent removes query, headers, cookies and body from Sentry events", () => {
  const event = {
    request: {
      url: "https://x/cb?token=abc",
      query_string: "token=abc",
      headers: { authorization: "Bearer abc" },
      cookies: { session: "abc" },
      data: { token: "abc" },
      method: "GET",
    },
  } as unknown as Parameters<typeof scrubEvent>[0];
  const out = scrubEvent(event);
  expect(JSON.stringify(out)).not.toContain("abc");
  expect(out.request).toEqual({ url: "https://x/cb", method: "GET" });
});

it("scrubEvent blanks exception messages and drops breadcrumbs", () => {
  const event = {
    exception: { values: [{ type: "SyntaxError", value: 'bad {"token":"abc"}', stacktrace: {} }] },
    breadcrumbs: [
      { message: "GET https://x/cb?token=abc", data: { url: "https://x/cb?token=abc" } },
    ],
  } as unknown as Parameters<typeof scrubEvent>[0];
  const out = scrubEvent(event);
  expect(JSON.stringify(out)).not.toContain("abc");
  expect(out.exception?.values?.[0]).toMatchObject({ type: "SyntaxError", value: "" });
  expect(out.breadcrumbs).toBeUndefined();
});

it("scrubEvent copes with no request and with a url without query", () => {
  const bare = {} as Parameters<typeof scrubEvent>[0];
  expect(scrubEvent(bare)).toEqual({});
  const plain = { request: { url: "https://x/cb" } } as Parameters<typeof scrubEvent>[0];
  expect(scrubEvent(plain).request?.url).toBe("https://x/cb");
});

it("a thrown error is still logged once when LOG_LEVEL is error", async () => {
  await app.request("/boom", {}, { LOG_LEVEL: "error" });
  expect(lines().filter((l) => l.level === "error")).toHaveLength(1);
});
