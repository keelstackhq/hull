import { expect, test } from "vite-plus/test";
import { hello } from "./index";

test("hello", () => {
  expect(hello("hull")).toBe("Hello, hull!");
});
