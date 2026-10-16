// React subscription to the account business's own owner.
//
// The account lifetime — login, status, check-in and sign-out — is
// `createWebuiAccountWorkflows`'s, created once by the composition root. This
// binding is the only React edge to it: a surface reads the snapshot and
// invokes the owner's named commands, and never receives the owner object or a
// transport method for the account operations.
//
// The account pair lives here rather than in the shared `client/bindings/use-query-state.tsx`,
// which holds one provider hook pair per owner. This business's contracts, projections and UI are
// here too, while the other owners' pairs stay in that file.
//
// The context is deliberately non-throwing: an SSR render or a unit test that
// mounts a panel without the provider reads the initial snapshot and submits
// no-ops, which is the correct behaviour with no runtime attached.

import {
  createContext,
  useContext,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import {
  initialWebuiAccountWorkflowsState,
  type WebuiAccountWorkflows,
  type WebuiAccountWorkflowsState,
} from "../application/account-workflows.js";

const WebuiAccountWorkflowsContext = createContext<WebuiAccountWorkflows | undefined>(
  undefined,
);

export function WebuiAccountWorkflowsProvider({
  workflows,
  children,
}: {
  readonly workflows: WebuiAccountWorkflows;
  readonly children: ReactNode;
}): JSX.Element {
  return (
    <WebuiAccountWorkflowsContext.Provider value={workflows}>
      {children}
    </WebuiAccountWorkflowsContext.Provider>
  );
}

export function useWebuiAccountWorkflows(): WebuiAccountWorkflows | undefined {
  return useContext(WebuiAccountWorkflowsContext);
}

export function useWebuiAccountWorkflowsState(): WebuiAccountWorkflowsState {
  const workflows = useContext(WebuiAccountWorkflowsContext);
  return useSyncExternalStore(
    workflows ? workflows.subscribe : noopSubscribe,
    workflows ? workflows.getSnapshot : accountInitialSnapshot,
    workflows ? workflows.getSnapshot : accountInitialSnapshot,
  );
}

function noopSubscribe(): () => void {
  return () => undefined;
}

function accountInitialSnapshot(): WebuiAccountWorkflowsState {
  return initialWebuiAccountWorkflowsState;
}
