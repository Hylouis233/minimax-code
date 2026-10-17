// Session queries, mutations, history, diff and rewind.
//
// Split out of the former `server/host.ts` `createHarnessPortFromHost`; the
// bodies are unchanged, only the module boundary moved.
import type { WebuiHarnessPort } from "../port.js";
import type { WebuiRuntimeHostHandle } from "./host-contract.js";
import { requireCliService, requireHostSlot } from "./requirements.js";
import {
  toWebuiSessionDiff,
  toWebuiTurnDiff,
  toWebuiRevertResult,
  toWebuiReapplyResult,
  toWebuiEditMessageResult,
  toWebuiMessagesResult,
  toWebuiRecord,
  toWebuiSessionPage,
  toWebuiSessionTreePage,
  toRuntimeAttachmentRequest,
} from "./result-conversion.js";

export function createSessionsAdapter(
  host: WebuiRuntimeHostHandle,
): Pick<
  WebuiHarnessPort,
  | "listSessions"
  | "listVisibleProjects"
  | "getSessionTree"
  | "archiveSession"
  | "deleteSession"
  | "updateSession"
  | "getSessionForkOptions"
  | "forkSession"
  | "createSession"
  | "getSession"
  | "getMessages"
  | "exportSessionTransfer"
  | "importSessionTransfer"
  | "getSessionDiff"
  | "getTurnDiff"
  | "revertTurnDiff"
  | "reapplyTurnDiff"
  | "getSessionRewindPreview"
  | "rewindSession"
  | "editSessionMessage"
> {
  return {
    async listSessions(request) {
      // Converted: the runtime sends `sessionType` as a number and the wire
      // carries its name. The numbering is the runtime's business and a
      // migration can renumber it; translating here is what lets a client branch
      // on "is this a root session" without copying that numbering into a UI.
      return toWebuiSessionPage(
        await requireCliService(host).listSessions(request, {}),
      );
    },

    async listVisibleProjects(request) {
      const service = requireCliService(host);
      const listVisibleProjects = requireHostSlot(
        service.listVisibleProjects,
        "project listing",
      );
      return listVisibleProjects.call(service, request.limit ?? 100);
    },

    async getSessionTree(request) {
      return toWebuiSessionTreePage(
        await requireCliService(host).getSessionTree(request, {}),
      );
    },

    async archiveSession(request) {
      return requireCliService(host).archiveSession(request, {});
    },

    async deleteSession(request) {
      return requireCliService(host).deleteSession(request, {});
    },

    async updateSession(request) {
      return toWebuiRecord(
        await requireCliService(host).updateSession(request, {}),
      );
    },

    async getSessionForkOptions(request) {
      return requireCliService(host).getSessionForkOptions(request, {});
    },

    async forkSession(request) {
      return toWebuiRecord(
        await requireCliService(host).forkSession(request, {}),
      );
    },

    async createSession(request) {
      return toWebuiRecord(
        await requireCliService(host).createSession(request, {}),
      );
    },

    async getSession(request) {
      return requireCliService(host).getSession(request, {});
    },

    async getMessages(request) {
      // Each message is copied so the wire's `msgId` requirement is a place the
      // adapter can enforce, rather than a field a surface has to discover is
      // missing once it is already rendering the transcript.
      return toWebuiMessagesResult(
        await requireCliService(host).getMessages(request, {}),
      );
    },

    async exportSessionTransfer(request) {
      return requireCliService(host).exportSessionTransfer(request.id);
    },

    async importSessionTransfer(request) {
      return requireCliService(host).importSessionTransfer(request);
    },

    async getSessionDiff(request) {
      return toWebuiSessionDiff(
        await requireCliService(host).getSessionDiff(request, {}),
      );
    },

    async getTurnDiff(request) {
      return toWebuiTurnDiff(
        await requireCliService(host).getTurnDiff(request, {}),
      );
    },

    async revertTurnDiff(request) {
      return toWebuiRevertResult(
        await requireCliService(host).revertTurnDiff(request, {}),
      );
    },

    async reapplyTurnDiff(request) {
      return toWebuiReapplyResult(
        await requireCliService(host).reapplyTurnDiff(request, {}),
      );
    },

    async getSessionRewindPreview(request) {
      return requireCliService(host).getSessionRewindPreview(request, {});
    },

    async rewindSession(request) {
      return requireCliService(host).rewindSession(request, {});
    },

    async editSessionMessage(request) {
      return toWebuiEditMessageResult(
        await requireCliService(host).editSessionMessage(
          toRuntimeAttachmentRequest(request),
          {},
        ),
      );
    },
  };
}
