import { Hono } from "hono";
import { requestId } from "hono/request-id";
import { jsonLogger, onErrorHandler } from "./hull/logging";
import { withOptionalSentry } from "./hull/sentry";

type Bindings = { LOG_LEVEL?: string; SENTRY_DSN?: string };

const app = new Hono<{ Bindings: Bindings }>();

app.use(requestId());
app.use(jsonLogger());
app.onError(onErrorHandler);

app.get("/", (c) => c.json({ ok: true }));

export default withOptionalSentry(app);
export { app };
