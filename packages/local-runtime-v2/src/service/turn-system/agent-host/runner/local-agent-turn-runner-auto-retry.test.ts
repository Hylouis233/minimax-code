import { describe, expect, it } from 'vitest';

import { RespDataType } from '@mavis/agent-core/protocol/agent-message';
import { RuntimeEventStatus, RuntimeEventType, type IRuntimeEvent } from '@mavis/protocol';
import { LLM_ERROR_STATUS_CODES } from '@mavis/shared/llm-error-classifier';

import { LocalAgentTurnRunner } from './local-agent-turn-runner.js';

// End-to-end behaviour of the turn-level automatic retry: a retryable terminal
// failure must be held back and the whole turn re-run, without the client ever
// seeing the intermediate failures.

function terminal(status: RuntimeEventStatus, message?: string): IRuntimeEvent {
  let seq = 0;
  return {
    schema: 'runtime.event/v1',
    event_id: `evt_${status}_${++seq}`,
    session_id: 'ses',
    turn_id: 'turn',
    type: RuntimeEventType.SESSION_STATUS,
    payload: {
      status,
      ...(message ? { error: { message, stop_reason: { type: 'error', message } } } : {}),
    },
  } as unknown as IRuntimeEvent;
}

function failedTerminal(message: string): IRuntimeEvent {
  return terminal(RuntimeEventStatus.FAILED, message);
}

function collector() {
  const events: IRuntimeEvent[] = [];
  return {
    events,
    eventWriter: {
      events,
      async pushRuntime(event: IRuntimeEvent) {
        events.push(event);
      },
      async appendEvents(next: IRuntimeEvent[]) {
        events.push(...next);
      },
    },
  };
}

function input(eventWriter: ReturnType<typeof collector>['eventWriter']) {
  return {
    workspaceDir: '/tmp/ws',
    systemPrompt: '',
    userMessage: { text: 'hi' },
    llm: { model: {} as never },
    sessionId: 'ses',
    turnId: 'turn',
    contentReviewRequired: false,
    eventWriter,
    toolContext: {
      agentName: 'test',
      parentAgentConfig: {},
      trustedExactWritePaths: [],
      eventWriter,
    } as never,
  };
}

function statuses(events: readonly IRuntimeEvent[]): unknown[] {
  return events
    .filter((event) => event.type === RuntimeEventType.SESSION_STATUS)
    .map((event) => event.payload?.status);
}

describe('LocalAgentTurnRunner automatic turn retry', () => {
  it('re-runs the whole turn after a retryable failure and hides the intermediate errors', async () => {
    const { events, eventWriter } = collector();
    let calls = 0;
    const delays: number[] = [];
    const runner = new LocalAgentTurnRunner({
      reviewContent: async () => ({ pass: true }),
      turnAutoRetrySleep: async (delayMs) => {
        delays.push(delayMs);
      },
      piRunner: {
        async runTurn(turnInput) {
          calls += 1;
          if (calls <= 2) {
            await turnInput.eventWriter.pushRuntime(
              failedTerminal('[Error] 529 overloaded'),
            );
            return;
          }
          await turnInput.eventWriter.pushRuntime(terminal(RuntimeEventStatus.COMPLETED));
        },
      },
    });

    const output = await runner.runTurn(input(eventWriter));

    expect(calls).toBe(3);
    // The two retryable failures must never reach the client.
    expect(statuses(events)).toEqual([RuntimeEventStatus.COMPLETED]);
    expect(output.outcome.status).toBe('completed');
    expect(delays).toHaveLength(2);
    expect(delays[1]).toBeGreaterThan(delays[0]);
  });

  it('surfaces the original error after the retry budget is spent', async () => {
    const { events, eventWriter } = collector();
    let calls = 0;
    const runner = new LocalAgentTurnRunner({
      reviewContent: async () => ({ pass: true }),
      turnAutoRetrySleep: async () => {},
      turnAutoRetryPolicy: { maxRetries: 2 },
      piRunner: {
        async runTurn(turnInput) {
          calls += 1;
          await turnInput.eventWriter.pushRuntime(failedTerminal('[Error] 529 overloaded'));
        },
      },
    });

    const output = await runner.runTurn(input(eventWriter));

    expect(calls).toBe(3);
    expect(statuses(events)).toEqual([RuntimeEventStatus.FAILED]);
    expect(output.outcome.status).toBe('failed');
  });

  it('does not retry a non-retryable failure such as usage limit', async () => {
    const { events, eventWriter } = collector();
    let calls = 0;
    const runner = new LocalAgentTurnRunner({
      reviewContent: async () => ({ pass: true }),
      turnAutoRetrySleep: async () => {
        throw new Error('backoff must not run for a terminal error');
      },
      piRunner: {
        async runTurn(turnInput) {
          calls += 1;
          await turnInput.eventWriter.pushRuntime({
            ...failedTerminal('Token Plan usage limit reached'),
            payload: {
              status: RuntimeEventStatus.FAILED,
              error: {
                message: 'Token Plan usage limit reached',
                code: LLM_ERROR_STATUS_CODES.USAGE_LIMIT_EXCEEDED,
                stop_reason: { type: 'error', message: 'Token Plan usage limit reached' },
              },
            },
          });
        },
      },
    });

    const output = await runner.runTurn(input(eventWriter));

    expect(calls).toBe(1);
    expect(statuses(events)).toEqual([RuntimeEventStatus.FAILED]);
    expect(output.outcome.status).toBe('failed');
  });

  it('does not retry once output has already been released to the client', async () => {
    const { events, eventWriter } = collector();
    let calls = 0;
    const runner = new LocalAgentTurnRunner({
      reviewContent: async () => ({ pass: true }),
      turnAutoRetrySleep: async () => {
        throw new Error('backoff must not run after visible output');
      },
      piRunner: {
        async runTurn(turnInput) {
          calls += 1;
          await turnInput.eventWriter.appendEvents([
            {
              schema: 'runtime.event/v1',
              event_id: `evt_msg_${calls}`,
              session_id: 'ses',
              turn_id: 'turn',
              type: RuntimeEventType.STREAM_RESP,
              payload: {
                stream_resp: JSON.stringify({
                  type: RespDataType.AgentMessage,
                  agent_message: {
                    msg_id: `msg_${calls}`,
                    role: 'assistant',
                    msg_content: 'partial answer',
                  },
                }),
              },
            } as unknown as IRuntimeEvent,
          ]);
          await turnInput.eventWriter.pushRuntime(failedTerminal('[Error] 529 overloaded'));
        },
      },
    });

    await runner.runTurn(input(eventWriter));

    expect(calls).toBe(1);
    expect(statuses(events)).toEqual([RuntimeEventStatus.FAILED]);
  });

  it('still surfaces the terminal error when the backoff is cancelled', async () => {
    // Regression: if the hold were consumed at decision time, a cancelled
    // backoff would end the turn with no terminal frame at all.
    const { events, eventWriter } = collector();
    const controller = new AbortController();
    let calls = 0;
    const runner = new LocalAgentTurnRunner({
      reviewContent: async () => ({ pass: true }),
      turnAutoRetrySleep: async () => {
        controller.abort();
        throw new Error('cancelled during backoff');
      },
      piRunner: {
        async runTurn(turnInput) {
          calls += 1;
          await turnInput.eventWriter.pushRuntime(failedTerminal('[Error] 529 overloaded'));
        },
      },
    });

    await runner.runTurn({ ...input(eventWriter), signal: controller.signal });

    expect(calls).toBe(1);
    expect(statuses(events)).toContain(RuntimeEventStatus.FAILED);
  });

  it('propagates a throwing retried attempt without emitting a duplicate terminal event', async () => {
    // The first attempt's hold is legitimately consumed when the retry starts,
    // so the newer exception wins. What must not happen is a stale FAILED from
    // the first attempt leaking out alongside it, which would put two
    // conflicting terminal frames on one turn.
    const { events, eventWriter } = collector();
    let calls = 0;
    const runner = new LocalAgentTurnRunner({
      reviewContent: async () => ({ pass: true }),
      turnAutoRetrySleep: async () => {},
      piRunner: {
        async runTurn(turnInput) {
          calls += 1;
          if (calls === 1) {
            await turnInput.eventWriter.pushRuntime(failedTerminal('[Error] 529 overloaded'));
            return;
          }
          throw new Error('tool loop exploded');
        },
      },
    });

    await expect(runner.runTurn(input(eventWriter))).rejects.toThrow('tool loop exploded');
    expect(calls).toBe(2);
    expect(statuses(events)).toEqual([]);
  });

  it('keeps the previous terminal behaviour when the budget is disabled', async () => {
    const { events, eventWriter } = collector();
    let calls = 0;
    const runner = new LocalAgentTurnRunner({
      reviewContent: async () => ({ pass: true }),
      turnAutoRetryPolicy: { maxRetries: 0 },
      piRunner: {
        async runTurn(turnInput) {
          calls += 1;
          await turnInput.eventWriter.pushRuntime(failedTerminal('[Error] 529 overloaded'));
        },
      },
    });

    const output = await runner.runTurn(input(eventWriter));

    expect(calls).toBe(1);
    expect(statuses(events)).toEqual([RuntimeEventStatus.FAILED]);
    expect(output.outcome.status).toBe('failed');
  });
});
