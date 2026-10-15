# Ultra workflows and independent Fast routing

This fork treats three controls separately: **client orchestration**, the selected
model's **native reasoning effort**, and **Fast transport or model selection**.
Enabling one never implicitly enables another or expands tool permissions.

## Ultra

Select the bundled `ultra` skill for an explicit Ultra request. For Ultra-workflow,
it uses the already installed `@mcode-dynamic-workflows` skill, its current tools,
and its topology-review/start gate. It does not install a replacement engine,
start an unapproved DAG, or claim a run when the plugin is missing. A local bounded
Ultra plan is identified separately from a dynamic-workflow execution.

The model's declared effort options still use the ordinary model selector. A
provider-declared `ultra` is a native effort; the orchestration skill does not add
an undeclared `ultra` option to every provider. Native effort and an Ultra workflow
can be selected together.

## Fast configuration

This first implementation exposes Fast as an explicit **per-model BYOK config**;
it does not add a global TUI toggle or change the managed Token Plan protocol.
Add `fast` to a model under `custom_provider.<provider>.models.<exact-model-id>`:

```yaml
custom_provider:
  your-provider:
    api: openai-responses
    options:
      baseURL: https://your-compatible-provider.example/v1
      # Supply credentials through the existing supported configuration flow.
    models:
      exact-model-id-from-your-provider:
        reasoning: true
        thinking:
          effortOptions: [low, high, max]
        fast:
          enabled: true
          mode: openai-priority
```

Use only the effort values, model limits and capabilities your provider actually
supports. Preserve existing credentials; the example is not a complete credential
configuration and does not contact an endpoint.

| Mode | Compatible API | Prepared request |
| --- | --- | --- |
| `openai-priority` | `openai-responses`, `openai-completions` | `service_tier: priority` |
| `openai-fast` | `openai-responses`, `openai-completions` | `service_tier: fast` |
| `anthropic-fast` | `anthropic-messages` | `speed: fast` and the `fast-mode-2026-02-01` beta header |
| `model` | Existing supported custom-provider API | No tier/speed field; retain the exact selected model ID |

Omit `fast` or set `enabled: false` to retain the existing route behavior. Enabled
malformed or incompatible configurations fail before a provider request instead
of silently changing providers, lowering effort or dropping the preference.
Anthropic beta tokens are merged case-insensitively without replacing credentials
or unrelated headers. OpenAI service-tier values are not sent as Anthropic tiers.
OAuth Codex transport is not claimed to support these native Fast flags.

Fast can cost more and may depend on model, account and gateway capabilities.
The request expresses a preference, not proof of priority service or a latency
guarantee. Provider errors remain errors; this feature does not retry with a
cheaper model, change approval policy or conceal unsupported tiers.

### Requested MiniMax Flash/Highspeed model

`M3.1-Preview-Flash-Highspeed` is a requested future offering, **not a verified
release**. This patch does not add it to the managed catalog or promise access.
When a provider really offers a model under that exact identifier, configure it
normally and use `mode: model` to preserve the ID through an OpenAI-compatible or
Anthropic-compatible route without inventing a native speed parameter. Do not use
Anthropic's beta flag on a MiniMax gateway unless that gateway documents support.

## Verification boundary

The shared resolver prepares disjoint reasoning and Fast fields through the
existing payload-patch channel used by the turn executor and auxiliary calls.
Regression tests exercise real model resolution and the final local payload
transform using synthetic configuration; no live provider or paid call is needed.
The source skill's review instructions are not proof of a live dynamic-workflow
run. Interactive TUI/ACP acceptance, plugin execution, actual premium billing,
latency and access to the requested future SKU require separate validation.

Protocol references, checked 2026-10-15:
- OpenAI Responses: https://developers.openai.com/api/reference/resources/responses/methods/create
- OpenAI Chat Completions: https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create
- Anthropic Fast mode: https://platform.claude.com/docs/en/build-with-claude/fast-mode
