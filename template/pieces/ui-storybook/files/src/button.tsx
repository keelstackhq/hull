import { Button as CascivoButton } from "@cascivo/react";
import type { ComponentChildren } from "preact";

export interface ButtonProps {
  label: string;
  onClick?: () => void;
  children?: ComponentChildren;
}

export function Button({ label, onClick, children }: ButtonProps) {
  return <CascivoButton onClick={onClick}>{children ?? label}</CascivoButton>;
}
