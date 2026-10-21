# Store disclosures — Chrome Web Store and Edge Add-ons

Both stores ask the same questions, and the answers are the same because the
extension is one package. This document is the source the two listings are
written from; the per-store wording differs only in the store's own terms.

## Single purpose

**Pair this browser with a MiniMax Code WebUI running on the same machine, so
that the person and the Agent can work in the same browser page.**

The extension connects to a WebUI host on the loopback interface, pairs with
it once, and then relays three things between them:

- which tabs are open, so the host can show them;
- the picture of the tab the person is looking at, so the host can display it;
- the person's pointer, keyboard and text input, so the person can act on the
  page the Agent is working in.

It does not browse on its own, it does not collect anything for anyone else,
and it does not work unless a WebUI is running on this machine and the person
has turned the browser's Browser Use switch on.

## What the extension sends, and to whom

Every byte the extension sends goes to **one place**: the WebUI host on
`http://127.0.0.1` or `http://localhost`, over a WebSocket, and only after
the person has paired it. The extension has no other destination, no
analytics, no telemetry and no remote code.

| What | Where it goes | Why |
| --- | --- | --- |
| The tabs' titles and URLs | The loopback WebUI host | So the host can show which page is open and let the Agent select one. |
| A picture of the **visible** tab | The loopback WebUI host | So the host can show the person the page the Agent is driving. |
| Pointer, keyboard and text input | The loopback WebUI host | So the person's input reaches the page the Agent is working in. |
| The result of a DevTools command | The loopback WebUI host | So the host can read the page the Agent asked about. |
| A pairing credential, encrypted | The loopback WebUI host | So the host can prove the peer is this extension and not something else. |

The extension never sends a page's *contents* — it never reads the DOM, the
cookies or the storage of a page. It forwards what the browser's own DevTools
protocol exposes, and only the commands listed in
`packages/browser-extension/src/cdp.ts`.

## What the extension stores, and where

All of it is in the browser's own extension storage, on this machine, and
none of it leaves the machine.

| What | Where | Lifetime |
| --- | --- | --- |
| The WebUI host's address | `chrome.storage.local` | Until the person clears it. |
| The installation key the person pasted | `chrome.storage.local` | Until the person clears it. |
| The pairing credential the host issued | `chrome.storage.local` | Replaced on every pairing; removed when the browser's switch is turned off. |
| A random identifier for this browser | `chrome.storage.local` | Until the person clears it. |
| The last error, for the options page | `chrome.storage.session` | Until the browser closes. |

The extension writes **nothing** to disk outside the browser's extension
storage, and it keeps **no log**: there is no `console` call anywhere in the
extension, because an extension that logs what it is carrying leaks pairing
material and page content into whatever collects extension logs.

## The permissions requested, and why each is needed

| Permission | Why it is needed |
| --- | --- |
| `debugger` | The only way an extension can dispatch input to a page the way the browser does, and the only way to run a DevTools command against a tab. Chrome's `debugger` API exposes only a **subset** of the DevTools domains, and the extension restricts itself further to the commands in `cdp.ts`. |
| `tabs` | Knowing which tabs exist, so the host can show them and the Agent can select one. |
| `activeTab` | Working with the tab the person has made active. |
| `scripting` | Injecting the small amount of scripting the input path needs. |
| `storage` | Holding the host address, the installation key and the pairing credential, as described above. |
| `webNavigation` | Knowing when a tab navigated, so the host can tell a page that was replaced from the page it replaced. |
| `<all_urls>` (host permission) | `chrome.tabs.captureVisibleTab` — the only way to deliver the picture of the visible tab — requires either this permission or an `activeTab` permission granted by a user gesture on that page. There is no gesture here: the **host** is asking for the picture, not the person clicking the extension's icon. Without it the browser refuses the capture with *"Either the '<all_urls>' or 'activeTab' permission is required."* The extension captures the visible tab and does nothing else with it: it does not read the page's contents and it does not inject anything. |

The host permissions also include `http://127.0.0.1/*` and
`http://localhost/*`, which is where the WebUI host is reached.

## Privacy policy

The extension collects **no personal data** and transmits **no personal data**
to any party other than the WebUI host running on the same machine, which the
person has installed and started themselves.

The data that passes between the extension and that host — tab titles, tab
URLs, the picture of the visible tab, and the person's input — is the data of
the pages the person is already looking at. It moves only between two programs
on the same machine, over the loopback interface, and only while the person has
the browser's Browser Use switch on. It is not stored by the extension beyond
the credentials described above, and it is not sent anywhere else.

No data is sold, shared, or used for advertising, and there is no analytics or
telemetry of any kind.

## The packaged build differs from the development build in exactly these ways

| | Development build | Packaged build |
| --- | --- | --- |
| Extension identity | The id Chrome derives from the unpacked directory — different for every path, and therefore **not** a stable identity | The id the store issues, fixed and recorded |
| How the identity is fixed | Nothing in the build pins it | The manifest's `key` field carries the store's public key, and the id follows from it: the first sixteen bytes of its SHA-256, each nibble mapped to a letter from `a` |
| Where the identity is recorded | Nowhere; it is derived from the path | In the build manifest, and the host validates against it |
| Everything else | Identical | Identical — the packaged manifest differs from the development manifest in the `key` field and in nothing else |
| Accepted by a packaged host | **No.** A packaged host ignores the development allowlist | Only the recorded store identity |
| Accepted by a development host | Only the ids in the development allowlist | The store identity, when it is listed |

A packaged host therefore never accepts a development build, and a
development build is never mistaken for a store build. The identity the bridge
accepts is the one the store issues, because that is the only identity the
person can be sure is the extension they installed from the store.
