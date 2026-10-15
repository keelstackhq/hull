import { Button, Card } from "@cascivo/react";
import { useState } from "preact/hooks";

export function App() {
  const [count, setCount] = useState(0);
  return (
    <Card>
      <h1>Hello</h1>
      <Button onClick={() => setCount(count + 1)}>Clicked {count} times</Button>
    </Card>
  );
}
