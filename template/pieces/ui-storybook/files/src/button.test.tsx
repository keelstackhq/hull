import { render } from "preact";
import { expect, test } from "vite-plus/test";
import { Button } from "./button";

test("renders a cascivo button with its label", () => {
  const root = document.createElement("div");
  document.body.append(root);
  render(<Button label="Save" />, root);
  expect(root.querySelector("button")?.textContent).toBe("Save");
});
