// The interaction owner for one session, read from the application (T05).
//
// Permissions and the questionnaire are the session's, and so is the fence that
// orders their reads against their replies. The owner is the application's now,
// keyed by session, and this binding is how a surface reads the one it belongs
// to — the same arrangement as the goal owner and the version cells.
//
// The fallback exists for a composer mounted without an application (unit tests, a
// standalone surface): a per-mount registry, so the surface keeps working rather
// than silently reading through a second fence.

import { useEffect, useMemo, useRef } from "react";

import type { WebuiInteractionCoordinator } from "../application/interaction-coordinator.js";
import { createWebuiInteractionSessionOwners } from "../application/interaction-session-owners.js";
import { createWebuiInteractionPhaseIntents } from "../../turn/contracts/interaction-phase-intents.js";
import { WEBUI_HOME_SESSION_KEY } from "../../../application/state.js";
import { useWebuiApplicationOptional, useWebuiSessionStoreContext } from "../../../bindings/application-context.js";

/** The record key a session-less surface works under: the home slot. */
export function webuiInteractionRecordKey(sessionId: string | undefined): string {
  return sessionId ?? WEBUI_HOME_SESSION_KEY;
}

export function useWebuiInteractionOwner(
  sessionId: string | undefined,
): WebuiInteractionCoordinator {
  const application = useWebuiApplicationOptional();
  const store = useWebuiSessionStoreContext();
  const fallback = useMemo(
    () =>
      createWebuiInteractionSessionOwners({
        store,
        readPhaseIntents: (sessionId) =>
          createWebuiInteractionPhaseIntents({
            setStream: store.createSessionWriter({ kind: "session", sessionId }).setStream,
          }),
      }),
    [store],
  );
  const owners = application?.interactions ?? fallback;
  return owners.owner(webuiInteractionRecordKey(sessionId));
}

/**
 * Installs the fallback requester name the owners compose with. The session list
 * the surface renders is loaded after the application exists, so the reader is
 * installed rather than passed — and it is read when a request is composed, so a
 * later-loaded list stays authoritative.
 */
export function useWebuiInteractionAgentNameReader(agentName: string | undefined): void {
  const application = useWebuiApplicationOptional();
  const latest = useRef(agentName);
  latest.current = agentName;
  useEffect(() => {
    application?.interactions.setAgentNameReader(() => latest.current ?? "main");
  }, [application]);
}
