// Account login, quota, daily check-in and usage.
//
// Split out of the former `server/host.ts` `createHarnessPortFromHost`. These
// capabilities are backed by the assembly's OAuth core, quota and check-in
// clients rather than the harness `cliService`; they wire into the same runtime
// capability group.
import type { WebuiHarnessPort } from "../port.js";
import type { WebuiRuntimeHostHandle } from "./host-contract.js";
import { requireCliService, requireHostSlot } from "./requirements.js";

export function createAccountAdapter(
  host: WebuiRuntimeHostHandle,
): Pick<WebuiHarnessPort, "getUsageQuota" | "getSigninPanel" | "claimSignin" | "beginAccountLogin" | "getAccountLoginStatus" | "cancelAccountLogin" | "signOutAccount" | "getAccountStatus" | "getSessionUsage"> {
  return {
    async getUsageQuota(request) {
      const getUsageQuota = requireHostSlot(
        host.getUsageQuota,
        "the usage quota client",
      );
      return getUsageQuota.call(host, request ?? {});
    },

    async getSigninPanel() {
      const getSigninPanel = requireHostSlot(
        host.getSigninPanel,
        "the daily check-in client",
      );
      return getSigninPanel.call(host);
    },

    async claimSignin() {
      const claimSignin = requireHostSlot(
        host.claimSignin,
        "the daily check-in client",
      );
      return claimSignin.call(host);
    },

    async beginAccountLogin() {
      const beginAccountLogin = requireHostSlot(host.beginAccountLogin, "account login");
      return beginAccountLogin.call(host);
    },

    async getAccountLoginStatus() {
      const getAccountLoginStatus = requireHostSlot(
        host.getAccountLoginStatus,
        "account login",
      );
      return getAccountLoginStatus.call(host);
    },

    async cancelAccountLogin() {
      const cancelAccountLogin = requireHostSlot(
        host.cancelAccountLogin,
        "account login",
      );
      await cancelAccountLogin.call(host);
      return { ok: true as const };
    },

    async signOutAccount() {
      const signOutAccount = requireHostSlot(host.signOutAccount, "account sign-out");
      return signOutAccount.call(host);
    },

    async getAccountStatus(request) {
      return requireCliService(host).getAccountStatus(request);
    },

    async getSessionUsage(request) {
      return requireCliService(host).getSessionUsage(request);
    },
  };
}
