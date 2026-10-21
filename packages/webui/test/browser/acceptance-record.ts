// The acceptance record.
//
// Two tickets ask for a recorded result rather than a claim: the browser
// version, the operating system, the settings that were enabled, and what was
// observed. A matrix written by hand drifts from what the suites actually did,
// so the suites write the record while they run and the published matrix is
// written from it.
//
// The file is workspace material, not a published document: the published
// matrix is `packages/webui/docs/browser-use/09-acceptance-record.md`, and it
// says which run it was written from.
//
// One file per suite. A suite replaces its own file on the first record of a
// run, so a re-run cannot leave a case behind from the previous one, and the
// suites cannot overwrite each other's records.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { release } from "node:os";
import { resolve } from "node:path";

/** What one acceptance case observed. */
export interface AcceptanceObservation {
  /** The surface the case ran on. */
  readonly surface: string;
  /** The browser the case drove. */
  readonly browser: string;
  /** The browser's own version string. */
  readonly browserVersion: string;
  /** Which entry the case went through. */
  readonly entry: "development" | "packaged";
  /** The case's name. */
  readonly case: string;
  /**
   * The configuration the case ran under.
   *
   * Read from the host where the host knows it: the switch states come from
   * the bridge's own snapshot, so the record says what was in force rather
   * than what the test intended. The switches the bridge does not carry are
   * named as such.
   *
   * A function is read **after** the case body has run, so the record
   * describes the state the observation was made in rather than the state the
   * case started in.
   */
  readonly settings:
    | Readonly<Record<string, unknown>>
    | (() => Readonly<Record<string, unknown>>);
  /** What was observed. */
  readonly observed: string;
  /** Whether the case held. */
  readonly result: "pass" | "fail";
}

/** One recorded run. */
export interface AcceptanceRecord extends AcceptanceObservation {
  /** When the case ran. */
  readonly at: string;
  /** The operating system the case ran on. */
  readonly os: string;
  /** The suite the case belongs to. */
  readonly suite: string;
}

const recordDir = resolve(
  new URL("../../../../.plan/board/validation", import.meta.url).pathname,
);

/** The suites that have written a record in this process. */
const started = new Set<string>();

/**
 * Start a suite's record.
 *
 * The suite's file is emptied here, at the start of the run, rather than on
 * its first record: a run that fails during setup — the extension does not
 * build, the browser does not start — would otherwise leave the **previous**
 * run's cases in place, and the file would then read as a pass for cases
 * that never ran.
 */
export function beginAcceptanceSuite(suite: string): void {
  mkdirSync(recordDir, { recursive: true });
  writeFileSync(resolve(recordDir, `${suite}.acceptance.json`), "[]\n", "utf8");
  started.add(suite);
}

/**
 * Write one record for a suite.
 *
 * The suite's file is replaced on its first record of the process, so a
 * second run of the same suite starts from an empty file rather than
 * appending to the previous run's cases.
 */
export function recordAcceptance(
  suite: string,
  observation: AcceptanceObservation,
): void {
  const record: AcceptanceRecord = {
    ...observation,
    at: new Date().toISOString(),
    os: `${process.platform} ${release()}`,
    suite,
  };
  mkdirSync(recordDir, { recursive: true });
  const path = resolve(recordDir, `${suite}.acceptance.json`);
  if (!started.has(suite)) {
    started.add(suite);
    writeFileSync(path, "[]\n", "utf8");
  }
  const existing = readRecords(path);
  existing.push(record);
  writeFileSync(path, `${JSON.stringify(existing, null, 2)}\n`, "utf8");
}

/**
 * Run one acceptance case and record what it observed.
 *
 * A failed case is recorded as a failure before the error is re-thrown: a
 * record that only holds the passing cases is a record of what was supposed to
 * happen, which is not what was asked for.
 */
export async function observeAcceptance(
  suite: string,
  observation: Omit<AcceptanceObservation, "result">,
  body: () => Promise<void>,
): Promise<void> {
  const settings = (): Readonly<Record<string, unknown>> =>
    typeof observation.settings === "function" ? observation.settings() : observation.settings;
  try {
    await body();
    recordAcceptance(suite, { ...observation, settings: settings(), result: "pass" });
  } catch (error) {
    recordAcceptance(suite, {
      ...observation,
      settings: settings(),
      result: "fail",
      observed: `${observation.observed} — failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    });
    throw error;
  }
}

function readRecords(path: string): AcceptanceRecord[] {
  try {
    const raw = readFileSync(path, "utf8");
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as AcceptanceRecord[]) : [];
  } catch {
    return [];
  }
}
