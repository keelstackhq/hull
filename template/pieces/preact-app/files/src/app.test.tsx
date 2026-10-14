import { render } from "preact";
import { expect, test } from "vite-plus/test";
import { App } from "./app";

test("renders a cascivo button that counts clicks", () => {
  const root = document.createElement("div");
  document.body.append(root);
  render(<App />, root);
  const button = root.querySelector("button");
  expect(button?.textContent).toBe("Clicked 0 times");
});
