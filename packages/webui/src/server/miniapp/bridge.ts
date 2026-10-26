// The page half of the Mini App bridge, served by the proxy.
//
// A Mini App page reaches its host through `window.mcode.miniapp.*`. On the
// desktop client that namespace comes from an Electron preload; a browser tab
// cannot install one, so the proxy injects a script and this module is it. The
// namespace mirrors the shipped preload's composer method
// (`app/dist/main/modules/browser/miniapp-preload.js`): `message.append(text)`
// resolves on a confirmed append and rejects with the failure code — the same
// codes, because a page written against the desktop client must not see a
// different vocabulary here.
//
// The page half knows no identity. It cannot name a session or a plugin: the
// host supplies both from the view it framed, so the most a page can ask for is
// "append this to whoever is hosting me".
//
// `postMessage` needs a target origin, and the page does not know the client's
// origin — so it posts to `*` and the *host* is what refuses a foreign sender.
// That direction is deliberate: the check belongs where the trusted side is, and
// the payload the page can reach is a bounded string that a person confirms.

import {
  WEBUI_MINIAPP_BRIDGE_APPEND_REPLY,
  WEBUI_MINIAPP_BRIDGE_APPEND_REQUEST,
  WEBUI_MINIAPP_BRIDGE_PATH,
  WEBUI_MINIAPP_COMPOSER_MAX_TEXT_LENGTH,
} from "../../shared/contracts/miniapp.js";
import type { MiniAppPageBridge } from "./proxy.js";

/**
 * The script the proxy serves at `WEBUI_MINIAPP_BRIDGE_PATH`.
 *
 * A string rather than a file: the proxy injects it into a document, and a
 * bundler that resolved it as a module would give it a module's scope instead of
 * the page's. Written out once, so the path the tag names and the body it serves
 * cannot disagree.
 */
const SCRIPT = `(function () {
  "use strict";
  var REQUEST = ${JSON.stringify(WEBUI_MINIAPP_BRIDGE_APPEND_REQUEST)};
  var REPLY = ${JSON.stringify(WEBUI_MINIAPP_BRIDGE_APPEND_REPLY)};
  var MAX_TEXT = ${WEBUI_MINIAPP_COMPOSER_MAX_TEXT_LENGTH};
  var sequence = 0;
  var pending = new Map();
  window.addEventListener("message", function (event) {
    if (event.source !== window.parent) return;
    var data = event.data;
    if (!data || typeof data !== "object" || data.type !== REPLY) return;
    if (typeof data.requestId !== "string") return;
    var settle = pending.get(data.requestId);
    if (!settle) return;
    pending.delete(data.requestId);
    settle(data.result);
  });
  function append(text) {
    return new Promise(function (resolve, reject) {
      if (typeof text !== "string") {
        reject(new Error("invalid_request"));
        return;
      }
      if (text.length > MAX_TEXT) {
        reject(new Error("text_too_large"));
        return;
      }
      sequence += 1;
      var requestId = "miniapp-" + Date.now().toString(36) + "-" + sequence;
      pending.set(requestId, function (result) {
        if (result && result.success === true) {
          resolve();
          return;
        }
        reject(new Error(result && result.code ? result.code : "result_unknown"));
      });
      window.parent.postMessage({ type: REQUEST, requestId: requestId, text: text }, "*");
    });
  }
  var mcode = (window.mcode = window.mcode || {});
  mcode.miniapp = mcode.miniapp || {};
  mcode.miniapp.message = mcode.miniapp.message || {};
  mcode.miniapp.message.append = append;
})();
`;

/** The bridge the proxy injects into every document it serves. */
export function miniAppPageBridge(): MiniAppPageBridge {
  return { path: WEBUI_MINIAPP_BRIDGE_PATH, script: SCRIPT };
}
