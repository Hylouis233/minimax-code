---
name: ultra
description: |
  Use an explicit Ultra or Ultra-workflow request to plan, execute and verify a
  bounded task using the installed dynamic-workflow skill when available. This
  is client-side orchestration, not a model name, reasoning effort or permission
  grant. Do not activate for an ordinary request containing only "fast", or for
  a provider's native effort setting without an orchestration request.
descriptions:
  zh-Hans: "按明确的 Ultra 请求组织任务；可组合动态工作流、原生推理档位和独立 Fast 配置，不扩大权限。"
displayNames:
  zh-Hans: "Ultra 工作流"
---

# Ultra

Treat orchestration, provider reasoning and Fast routing as independent choices.
A user can combine this skill with any provider-declared reasoning effort and an
explicit Fast model or transport configuration. This skill must not change either
model configuration or spending preferences on its own.

## Establish the execution contract

Read the requested goal, acceptance criteria, existing work and constraints.
Plan a bounded set of tasks, dependencies, review steps and stopping conditions.
Use the current workspace and approval policy. Do not add tools, install plugins,
grant permissions, expose secrets or dispatch paid work merely because Ultra was
selected. Do not invent a number of workers or a spending budget as an approval.

## Use the existing dynamic workflow implementation

When the user requests Ultra-workflow, or explicitly chooses the installed
`dynamic-workflow` skill from the `mcode-dynamic-workflows` plugin for the plan,
discover that installed skill and read its current instructions and tool schemas
before invoking it. Reuse its
actual planner, validator, lifecycle and result tooling; do not implement a
parallel scheduler or fabricate a workflow run.

Show the proposed topology and any material cost/concurrency choices. Obtain the
approval required by the installed workflow skill before its start operation.
A prior high-level request is not permission to skip that skill's review gate.
Respect its pause/cancel/status semantics and report actual run identifiers and
results. No infinite self-relaunch, automatic permission escalation or silent
replacement of a failed workflow with unbounded subagents.

If the skill is absent or its tools are unavailable, report that specific gap.
Do not claim an Ultra-workflow run occurred. A bounded local Ultra plan may still
be used when that matches the user's request, but label it as a local plan rather
than the missing workflow engine.

## Preserve provider controls

A provider-native `ultra`, `max` or other effort is sent only when declared by the
selected model and explicitly selected through the normal model controls. This
skill's name is never converted into a wire effort automatically.

Fast is optional and separate: an exact model ID, OpenAI `service_tier`, or
Anthropic `speed` must use the provider-compatible, explicitly configured route.
Do not lower reasoning, claim guaranteed latency or priority from a request flag,
or silently switch models after an unsupported-model/tier response. A requested
future model is not an available model until the provider actually offers it.

## Verify and report

Verify outputs against the agreed criteria using the existing project tests and
independent checks appropriate to the task. Distinguish executed checks, failed
checks and untested boundaries. Report remaining blockers and actual workflow
status without inventing completion, elapsed time, cost or background work.
