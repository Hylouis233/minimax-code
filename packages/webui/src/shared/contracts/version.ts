// Wire contract record (plan section 7.1 / 7.5): every exported
// declaration below records its wire purpose, its producer and its
// consumers, verified against the tree. Documentation only.
//
// | Declaration | Wire purpose | Producer | Consumers |
// | --- | --- | --- | --- |
// | `WebuiVersionInfo` | The handshake fact: version, protocolVersion, dataDir. | Runtime `createHarnessPortFromHost` version const (`runtime/harness/adapter.ts`). | `client/application/settings/settings-workflows.ts`; `client/contracts/settings/settings-port.ts`; `client/infrastructure/transport.ts`; `client/components/account/UserMenu.tsx`; `client/components/settings/SettingsModal.tsx`; `client/components/shell/WebuiClientFoundationApp.tsx`. |
export interface WebuiVersionInfo {
  readonly version: string;
  readonly protocolVersion: number;
  readonly dataDir?: string;
}
