import type { Meta, StoryObj } from "@storybook/preact-vite";
import { Button } from "./button";

const meta = {
  title: "Button",
  component: Button,
  args: { label: "Click me" },
} satisfies Meta<typeof Button>;

export default meta;

export const Primary: StoryObj<typeof meta> = {};
