import { expect, test } from "vite-plus/test";
import { greet } from "./index";

test("greet", () => {
  expect(greet("hull")).toBe("Hello, hull!");
});
