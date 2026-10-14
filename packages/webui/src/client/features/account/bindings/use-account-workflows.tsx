// React subscription to the account business's own owner.
//
// The account lifetime — login, status, check-in and sign-out — is
// `createWebuiAccountWorkflows`'s, created once by the composition root. This
// binding is the only React edge to it: a surface reads the snapshot and
// invokes the owner's named commands, and never receives the owner object or a
// transport method for the account operations (plan §5.1).
//
// It sat in the shared `client/bindings/use-query-state.tsx`, which held one
// provider hook pair per owner. T09 moved the account pair into the account
// business's own home, which is where its contracts, projections and UI already
// are; the other owners' pairs stay in that file until their own tickets move
// them.
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
