// The server-side projections the operation handlers still perform.
//
// `getMessages` enriches its response with the session context snapshot and the
// turn usage, so those two are what this file covers. The session-stream
// projection that used to be tested here is gone — it attached a per-session
// permission/compaction snapshot to every stream frame and nothing on the
// client read it. The shared event corpus it consumed is now covered against
// the live client reducer in `webui-event-corpus.test.ts`.
import { describe, expect, it } from "vitest";
import {
  projectContextSnapshot,
  projectUsage,
} from "../../src/server/projections/index.js";
import { isTurnCompactionMessage } from "../../src/server/projections/usage.js";

describe("WebUI server projections", () => {
  it("projects usage from completed message fixtures, not a wire event", () => {
    const messages = [
      {
        role: "assistant",
        turnId: "t1",
        kind: "compaction",
        usage: { totalTokens: 100 },
      },
      {
        role: "assistant",
        turnId: "t1",
        usage: { totalTokens: 20, inputTokens: 10 },
      },
    ];
    expect(
      isTurnCompactionMessage(
        { role: "assistant", kind: "compaction", turnId: "t1" },
        "t1",
      ),
    ).toBe(true);
    expect(projectUsage(messages, "t1")).toEqual({
      totalTokens: 20,
      inputTokens: 10,
    });
  });

  it("projects the latest context usage and compaction state", () => {
    // The message shape is the runtime protocol's, not a shape invented here:
    // `usage: { total_tokens, context_window }`. This test used to write
    // `contextUsage: { contextWindowTokens, usedTokens }`, which pinned a shape
    // no message in the database has ever had — so it passed green while the
    // composer's context readout rendered nowhere.
    expect(
      projectContextSnapshot({
        active: false,
        messages: [
          { kind: "compaction_start", timestamp: 1 },
          { kind: "compaction", timestamp: 2 },
          {
            rawJson: JSON.stringify({
              usage: { context_window: 100, total_tokens: 40 },
            }),
          },
        ],
      }),
    ).toMatchObject({
      status: "live",
      window: 100,
      usedTokens: 40,
      compaction: { state: "completed" },
    });
  });

  it("reads the snake_case protocol fields, not camelCase lookalikes", () => {
    // A guard with teeth: an implementation that accepted only
    // `usedTokens` / `contextWindowTokens` would still pass the test above if
    // the fixture carried both spellings, so the fixture carries only the ones
    // the wire actually has.
    expect(
      projectContextSnapshot({
        active: false,
        messages: [
          { rawJson: JSON.stringify({ usage: { total_tokens: 7, context_window: 70 } }) },
        ],
      }),
    ).toMatchObject({ status: "live", window: 70, usedTokens: 7 });
  });

  it("reports empty rather than a fabricated zero for a turn that reported no usage", () => {
    // The failure mode this whole change is about: a shape mismatch must
    // surface as "no data", never as 0% — a zero would look like a real
    // reading of an untouched context.
    expect(
      projectContextSnapshot({
        active: false,
        messages: [{ rawJson: JSON.stringify({ finish_reason: "stop" }) }],
      }),
    ).toMatchObject({ status: "empty" });
  });
});
