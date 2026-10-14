import { expect, test } from "vite-plus/test";
import { app } from "./index";

test("GET / answers ok", async () => {
  const res = await app.request("/");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });
});
