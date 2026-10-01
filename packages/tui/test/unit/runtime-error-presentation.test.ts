import { describe, expect, it } from "vitest";
import { resolveTuiRuntimeFailure } from "../../src/tui/controller/runtime/runtime-error-presentation.js";

describe("structured runtime failure presentation", () => {
  it.each([
    "rate limit code 1039",
    "HTTP 429: too many requests",
    "usage limit exceeded",
  ])("keeps content rejection authoritative over diagnostic %s", (message) => {
    const result = resolveTuiRuntimeFailure(message, 50201, {
      retryable: true,
    });
    expect(result.content).toContain(
      "The response was stopped by content safety checks.",
    );
    expect(result.content).toContain(
      "Revise the message before sending it again.",
    );
    expect(result.content).not.toContain("/retry");
    expect(result.retryable).toBe(false);
  });

  it("preserves ordinary rate-limit guidance", () => {
    const result = resolveTuiRuntimeFailure("provider detail", 50111);
    expect(result.content).toContain(
      "The model provider is rate limiting requests.",
    );
    expect(result.content).toContain("/retry");
    expect(result.retryable).toBe(true);
  });

  it("preserves explicit authentication rejection over rate-limit text", () => {
    const result = resolveTuiRuntimeFailure(
      "HTTP 429: too many requests",
      50112,
    );
    expect(result.content).toContain(
      "The service rejected request authentication.",
    );
    expect(result.content).not.toContain("/retry");
    expect(result.retryable).toBe(false);
  });
});
