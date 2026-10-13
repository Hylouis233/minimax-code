// The transcript's session fence and its handover (plan §5.6's `transcript` row;
// ticket #69): "Transcript history/request ownership remains session-fenced; a late
// page after a session switch is discarded, and live-to-history handover renders a
// completed turn once."
//
// Both behaviours were already covered elsewhere — the fence by
// `webui-application-commands.test.ts`'s two cases, the handover by
// `transcript-shape.test.ts`'s "updates matching history identities in place" and
// the shell's "canonical page wins over the initial render seed" — but no test is
// *named* for the acceptance, so an edit that removed either would fail a case
// whose name does not say which promise broke. These four do.

import { describe, expect, it, vi } from "vitest";

import { createWebuiSessionStore } from "../../src/client/application/session-store.js";
import { createWebuiTranscriptHistoryOwner } from "../../src/client/application/transcript/transcript-history.js";
import { projectWebuiTranscriptMessages } from "../../src/client/projection/transcript/transcript-projection.js";
import type { WebuiClientMessagePage } from "../../src/client/contracts/transcript/message-view.js";

const page = (...msgIds: string[]): WebuiClientMessagePage => ({
  messages: msgIds.map((msgId) => ({ msgId, role: "user", msgContent: `text-${msgId}` })),
  hasMore: false,
});

describe("a late page after a session switch is discarded", () => {
  it("discards it without writing anything for the session that left", async () => {
    let releaseA: (page: WebuiClientMessagePage) => void = () => undefined;
    const store = createWebuiSessionStore();
    const owner = createWebuiTranscriptHistoryOwner({
      store,
      loadMessages: ({ id }) =>
        id === "A"
          ? new Promise<WebuiClientMessagePage>((resolve) => { releaseA = resolve; })
          : Promise.resolve(page("B-1")),
    });
    const loadA = owner.loadPage("A");
    await expect(owner.loadPage("B")).resolves.toMatchObject({ status: "applied" });
    releaseA(page("A-late"));
    await expect(loadA).resolves.toEqual({ status: "stale" });
    // The fence is the whole promise: the late page is not merely ignored at
    // render time, it never reaches the store.
    expect(store.readSession("A").transcript.page.messages).toBeUndefined();
    expect(store.readSession("B").transcript.page.messages?.map((m) => m.msgId)).toEqual(["B-1"]);
  });

  it("discards an older response that loses to a newer request for the same session", async () => {
    const releases: Array<(page: WebuiClientMessagePage) => void> = [];
    const store = createWebuiSessionStore();
    const owner = createWebuiTranscriptHistoryOwner({
      store,
      loadMessages: () => new Promise<WebuiClientMessagePage>((resolve) => releases.push(resolve)),
    });
    const first = owner.loadPage("S");
    const second = owner.loadPage("S");
    releases[1]!(page("newer"));
    await expect(second).resolves.toMatchObject({ status: "applied" });
    releases[0]!(page("older"));
    await expect(first).resolves.toEqual({ status: "stale" });
    expect(store.readSession("S").transcript.page.messages?.map((m) => m.msgId)).toEqual(["newer"]);
  });
});

describe("live-to-history handover renders a completed turn once", () => {
  it("updates the history identity in place instead of adding a second row", () => {
    const history = page("turn-1");
    const live = [{ id: "turn-1", role: "user", answer: "text-turn-1", thinking: "" }];
    // In flight, the stream wins the fields; when the turn completes, history
    // supplies the persisted ones. Either way the identity appears once.
    for (const preferStream of [true, false]) {
      const merged = projectWebuiTranscriptMessages(history, live as never, preferStream);
      expect(merged.map((message) => message.msgId)).toEqual(["turn-1"]);
    }
  });

  it("does not let the live seed replace a page the owner already holds", () => {
    const store = createWebuiSessionStore();
    const owner = createWebuiTranscriptHistoryOwner({ store });
    owner.selectSession("S");
    owner.seed("S", page("from-history"));
    // The second seed — the same turn arriving from the live path — is refused,
    // which is what keeps one completed turn to one row.
    owner.seed("S", page("from-live"));
    expect(store.readSession("S").transcript.page.messages?.map((m) => m.msgId)).toEqual([
      "from-history",
    ]);
  });
});
