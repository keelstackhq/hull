// @vitest-environment happy-dom
import { render } from "preact";
import { expect, test } from "vite-plus/test";
import { Hello } from "./hello";

test("renders a button that starts at zero", () => {
  const root = document.createElement("div");
  document.body.append(root);
  render(<Hello />, root);
  expect(root.querySelector("button")?.textContent).toBe("Clicked 0 times");
});
