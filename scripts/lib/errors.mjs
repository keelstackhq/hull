export class UsageError extends Error {
  exitCode = 2;
  constructor(message) {
    super(message);
    this.name = "UsageError";
  }
}

export class TemplateError extends Error {
  exitCode = 3;
  constructor(message) {
    super(message);
    this.name = "TemplateError";
  }
}
