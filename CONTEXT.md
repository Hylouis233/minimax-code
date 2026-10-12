# MiniMax Code

This repository is a fork of the public MiniMax Code projection. It carries two
products on one runtime: the existing terminal client, and a WebUI client that is
under construction. The vocabulary below is the language both clients and the
runtime already use, plus the terms this work introduces.

This is the repository's single glossary. It is a language document and nothing
else: no file paths, no design decisions, no specification. If a term you need is
missing, that is a signal — either the project does not use the concept, or the
glossary has a gap to fill here.

## Language

### Layers and clients

**Harness layer**:
Everything below the interface layer: the session, turn, agent and model services
that execute work and persist it. It exposes an in-process API only; it has no
network interface.
_Avoid_: backend, core, engine

**Client**:
An interface implementation that sits on the harness layer and exposes sessions to
a person or a program. This repository ships three of them inside `packages/tui`:
the interactive terminal (TUI), `exec` (headless), and ACP.
_Avoid_: frontend, UI layer, app

**WebUI client**:
The fourth client: a browser interface served by `packages/webui`, running as a
peer of the TUI against the same harness layer.
_Avoid_: web CLI, web front end for the CLI, web version

### WebUI internal layers

Four layers inside `packages/webui`. The client/server split says where code runs;
these say who owns a responsibility.

**WebUI runtime**:
The Node-side module group that adapts public harness capabilities and owns every
process resource the service holds — OAuth core, leases and refresh timers,
quota, check-in, account login, the mcode-tools broker, the browser provider,
profile files and session transfer. It knows nothing about which session a browser
has selected.
_Avoid_: harness runtime, runtime host, backend — those name the harness side

**WebUI application**:
The browser-side owner of business orchestration and of the single write authority
for session and interaction records: recovery policy, request ownership, query
invalidation and progress derivation. Not a second execution runtime.
_Avoid_: client runtime, controller, store — the store is only one part of it

**Loopback server**:
The network ingress: authentication, envelope validation, dispatch, wire
projection, socket lifecycle and static assets. It holds no browser state.
_Avoid_: API server, backend, gateway

**Binding**:
A statically declared mapping from one wire operation to one runtime capability
method, replacing a hand-written forwarding closure. It is never discovered by
enumerating runtime methods, and no request body selects an arbitrary runtime
member.
_Avoid_: reflection, dispatch table, adapter — those name the behaviour it forbids

Not to be confused with the client's `bindings/` layer, which is a **React
binding**. One is a static wire mapping; the other is a React subscription layer.

**Event channel**:
The single long-lived `watchEvents` subscription a WebUI application instance
owns, shared by every consumer in that instance. Distinct from a stream frame
channel, which `send`/`resume` and terminal keep separately.
_Avoid_: socket, connection, subscription

**Stream loop**:
The browser mechanism that reads a session's stream frames and manages resume and
cancellation. It performs the history, context and stream-state transforms it needs through
injected bundles rather than reaching into projection modules.
_Avoid_: stream handler, reader

### WebUI client layers

The seven layers of the browser side, from the surface inwards. A file's layer is
readable from its path, because the path names the layer and then the business.

**Component**:
The React shell and the panels it renders. Owns rendering and interaction state;
submits named commands and holds no writer.

**React binding**:
React subscriptions, application context, browser navigation and DOM effects. The
bridge that converts a writer into a command surface, and the layer that reaches the
application.
_Avoid_: provider, hook layer

**Projection**:
A pure module that turns wire payloads and owned state into the shapes a component
renders. No React, no transport, no browser global.

**Mechanism**:
An algorithm with no application policy — the stream loop and the stream lease.

**Infrastructure**:
Browser IO: the transport, the event channel, storage, downloads. It decides no
business rule.
_Avoid_: utils, helpers

**Contract**:
The client-facing declarations: the capability ports, the browser-local view types
and the leaf readers. It imports nothing but `shared/`.

**Composition root**:
The one module that constructs the application, the store and the capability
bindings, and publishes them to every business. It is the only place that knows
which capability is wired.

### Sessions

**Session**:
A durable unit of work with one working directory and one selected model, persisted
in the data directory.
_Avoid_: conversation, chat, thread

**Turn**:
One submitted request inside a session, from submission to completion, including the
tool execution and interactions it requires.
_Avoid_: request, run, task

**Working directory**:
The directory a session is bound to. It is the execution boundary for file and Git
tools, is chosen explicitly when the session is created, and cannot be changed
afterwards.
_Avoid_: cwd, project path, root

**Stream frame**:
The unit the harness pushes to a client while a turn runs. One frame may carry a
whole message, a text chunk, a runtime event, an action delta, a status change or a
resynchronisation notice.
_Avoid_: chunk, delta, event

**Resynchronisation (resync)**:
The state where a client's cursor has fallen outside the range the harness still
holds, so the client must discard its incremental view and reload authoritative
history.
_Avoid_: replay, reflow

**Permission prompt**:
A harness request asking the client to authorise a tool call before it runs.
_Avoid_: approval, confirmation, consent

**Questionnaire**:
A structured question the harness asks mid-turn. The turn stays paused until the
client answers, dismisses it, or the session is aborted.
_Avoid_: survey, form, prompt

### Business

**Business**:
One user-facing area of the WebUI client, together with the logic that serves only
it. The WebUI client has twelve of them; `turn` is one even though the user never
sees it, because it owns the turn substrate.
_Avoid_: surface, feature, area, panel, section — each already names something else
here

**Turn substrate**:
The state and rules behind a running turn: the stream part of the session store,
the lease and its generation, the stream loop, the turn intents and the active-turn
read. It belongs to the `turn` business, and every other business reads it.
_Avoid_: core, engine, backbone, runtime (that is the Node-side module group)

**Capability**:
Something the harness or the runtime can do that a client may or may not be wired
to. An absent capability is a legal state, not an error.
_Avoid_: feature, service, function

**Capability port**:
The typed boundary through which the browser asks for one group of capabilities.
The WebUI client has eight, and one wire operation belongs to exactly one of them.
_Avoid_: interface, API, adapter

**Capability slice**:
The subset of one capability port that one business is given. A business receives a
slice — never the whole port, and never the composed transport.
_Avoid_: port slice, partial port

**Client transport**:
The browser's single composed object of capability methods. It is internal to the
composition root; a business is given its slice instead.
_Avoid_: transport layer, API client, gateway

**Harness port**:
The set of methods the WebUI runtime may call on the harness, and the shape the
loopback server is allowed to depend on.
_Avoid_: host surface, cliService surface, backend API

### Wire

**Operation**:
One named wire request together with its validator. The registry order is
observable on the wire, so an operation's position is part of the contract.
_Avoid_: endpoint, route, API call, command (a command is local)

**Dedicated handler**:
An operation that cannot be expressed as a single capability call and therefore
keeps a hand-written handler. Every other operation is a binding.
_Avoid_: custom handler, special case, override

**Wire contract**:
The request and result types both sides of the browser-to-loopback boundary share.
It is the only place a cross-process type may be declared.
_Avoid_: DTO, schema, model, payload

**Envelope**:
The outer part of every wire message: protocol version, kind, request id. A frame
carries one request, response, event or error.
_Avoid_: header, wrapper, metadata

**Wire projection**:
A server-side transformation between what a capability returns and what the wire
carries.
_Avoid_: serialisation, shaping, mapping

### Turn lifecycle and stream mechanics

**Stream lease**:
The claim one stream attempt holds on a session's stream. Exactly one lease is live
per session, and a lease carries a generation.
_Avoid_: lock, subscription token, ownership

**Generation**:
The number a lease is issued with, one higher than the last. Every write a stream
attempt makes is fenced against the generation it claimed, so a superseded attempt
cannot write.
_Avoid_: version, epoch, sequence

**Generation fence**:
The check that refuses a write whose generation is no longer the live one. It is
the whole correctness argument for one stream attempt per session.
_Avoid_: guard, mutex, validation

**Stream sink**:
The object a stream attempt writes through. It is minted inside the application
layer already fenced, so a caller can neither build one nor name another session's
slice.
_Avoid_: writer, setter, updater

**Turn intent**:
A named request to act on a turn — attach, send, stop, retry. An intent resolves
its own capabilities; it never accepts them from its caller.
_Avoid_: action, command, callback

**Active turn**:
The turn the harness reports as currently running for a session, as distinct from
what this browser believes is running.
_Avoid_: current turn, live turn, in-flight turn

**Queue**:
The turns a client has accepted but that have not started, because a turn was
already in flight. Queueing is what a send becomes when the session is busy.
_Avoid_: backlog, pending list, buffer

### Session data and its owners

**Session store**:
The single writable copy of session and interaction records. One per application
instance.
_Avoid_: cache, state container, model

**Session catalog**:
The single copy of every session record, plus the two query results that reference
it. Flat and tree are two queries, not two sets of entities, so a rename patches
one record and both views agree.
_Avoid_: index, registry, map

**Read model**:
The part of a business's owned state that other businesses may read. Writes never
pass through it.
_Avoid_: view, snapshot, projection (a projection derives a render shape)

**Selector**:
A pure function from owned state to a value a component renders.
_Avoid_: getter, accessor, resolver

**Workflow owner**:
The module that performs one business request end to end — the capability call, the
store write and the refresh that follows.
_Avoid_: service, manager, handler

**Coordinator**:
The module that owns one family of transitions over time: process events, turns, or
interactions.
_Avoid_: controller, orchestrator, dispatcher

**Draft**:
The composer's unsent input, kept per session key.
_Avoid_: text, input value, buffer

**Unread**:
The count of events a session accumulated while it was not the selected one.
_Avoid_: badge, notification, indicator

**Overlay**:
A durable per-session or per-project flag the browser stores itself — pinned,
starred or archived. The browser owns it; the harness does not know it exists.
_Avoid_: flag, marker, tag, favourite

### What the user works with

**Rail**:
The column that lists projects and recent sessions.

**Composer**:
The message input, its menus and its toolbar.

**Transcript**:
A session's message log.

**Workspace panel**:
The right column and the tabs it shows. A tab is a kind, not a component, and the
set of kinds is enumerated in exactly one place.
_Avoid_: side panel, right bar, inspector

**Progress**:
What a turn has done so far, expressed as todos and subagents.
_Avoid_: status, summary, dashboard

**Review**:
The diff a turn or a working tree produced, and the mutations a user may ask for. A
review is a capability, not a business: it exists only because a turn produced it.
_Avoid_: changeset, patch, PR

**Goal**:
A durable objective a session pursues across turns. A goal has a status and a
version, and a patch that disagrees with the current version is refused rather than
applied.
_Avoid_: objective, task, target, milestone

**Plan mode**:
The session state in which the runtime asks the user to confirm a plan before it
executes.

**Canvas**:
A workspace graph the user lays out and mutates.

**Terminal**:
A process the page attaches to through a tab, with a stream of its own.

**Team mode**:
The mode in which a session's turns are delegated to child sessions.
_Avoid_: multi-agent, delegation

**Session transfer**:
A session serialised into one file, and the import or export of that file.
_Avoid_: backup, dump, archive (an archive is a workspace zip)

### Cloud account

**Quota**:
The account-level allowance the user menu shows. Distinct from per-session usage.
_Avoid_: limit, balance, allowance

**Usage**:
The token and context figures for one session.
_Avoid_: cost, spend, consumption

**Credits**:
The account's remaining balance, rendered as an integer with thousands separators.
_Avoid_: points, coins

**Check-in**:
The daily sign-in that grants an allowance.
_Avoid_: daily reward, attendance

### Plugins and skills

**Plugin management**:
The browser for the plugin marketplace and for the installed plugins.
_Avoid_: extension manager, add-on store

**MCP server**:
An external tool server a plugin can start. The client shows its status, not its
contents.
_Avoid_: tool server, connector

**Skill**:
A reusable instruction set the runtime can load. The composer's slash palette lists
the runtime's skills; plugin management manages them.
_Avoid_: prompt, template, recipe

### Runtime ownership

**Runtime owner**:
One running harness instance, identified per process. A session's live execution,
stream subscriptions and pending interactions belong to the owner that created
them.
_Avoid_: daemon, server, backend instance

Not to be confused with the **WebUI runtime**, which is a module group inside the
WebUI service rather than a running instance. A process has one runtime owner and
one WebUI runtime; the words name different things.

**surface**:
The value a client declares to identify which interface it is, from the fixed set
the harness knows. It gates interaction capabilities and the cold-start execution
policy.
_Avoid_: client type, mode, channel — and do not use it for a pane of the interface
(that is a **business**) or for the method set of the runtime host (that is the
**harness port**). The word is overloaded in this codebase; this is the only
meaning it carries.

### Storage and repository

**Data directory**:
Where credentials, configuration and session history live. The CLI default is
`~/.minimax`; the WebUI client shares it.
_Avoid_: user data, profile dir

**Upstream**:
`MiniMax-AI/minimax-code`, the reviewed public projection of an internal monorepo.
This repository is a fork of it, and its history arrives through a three-way merge.
_Avoid_: origin, source repo, official repo
