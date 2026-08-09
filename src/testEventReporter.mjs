/**
 * @typedef {object} NodeTestFailEvent
 * @property {"test:fail"} type
 * @property {object} data
 * @property {string} data.name
 * @property {object} [data.details]
 * @property {number} [data.details.duration_ms]
 * @property {Error & { cause?: Error }} [data.details.error]
 */

/**
 * @typedef {object} NodeTestSummaryEvent
 * @property {"test:summary"} type
 * @property {object} data
 * @property {string} [data.file] absent only on the one aggregate summary emitted at the end of the run
 * @property {number} data.duration_ms
 * @property {object} data.counts
 * @property {number} data.counts.tests
 * @property {number} data.counts.passed
 * @property {number} data.counts.failed
 * @property {number} data.counts.skipped
 * @property {number} data.counts.todo
 * @property {number} data.counts.cancelled
 */

/** @typedef {NodeTestFailEvent | NodeTestSummaryEvent | { type: string, data: object }} NodeTestEvent */

/**
 * @typedef {object} ReportedError
 * @property {string} message
 * @property {string | null} stack
 */

/**
 * @typedef {object} ReportedFailure
 * @property {string} name
 * @property {number} durationMs
 * @property {ReportedError | null} error
 */

/**
 * @typedef {object} ReportedCounts
 * @property {number} tests
 * @property {number} pass
 * @property {number} fail
 * @property {number} skip
 * @property {number} todo
 * @property {number} cancelled
 * @property {number} [durationMs] present once merged with the summary's own duration in parseReporterEvents
 */

/**
 * @param {Error & { cause?: Error }} [error]
 * @returns {ReportedError | null}
 */
function pickError(error) {
  if (!error) {
    return null;
  }
  // node:test wraps assertion failures in an ERR_TEST_FAILURE error whose own .stack
  // has no frames; the actual file:line trace lives on .cause (e.g. an AssertionError).
  return { message: error.message ?? String(error), stack: error.cause?.stack ?? error.stack ?? null };
}

/**
 * node:test emits a "test:summary" per file plus one aggregate at the end;
 * the aggregate is the only one without a "file" attached.
 * @param {NodeTestSummaryEvent["data"]} data
 * @returns {boolean}
 */
function isAggregateSummary(data) {
  return data.file == null;
}

/**
 * The node:test custom reporter itself (`--test-reporter=<this file>`). Runs inside the
 * spawned workspace's process; only test:fail and the aggregate test:summary are kept,
 * each re-emitted as one JSON line on stdout for the parent process to read back.
 * @param {AsyncIterable<NodeTestEvent>} source
 * @returns {AsyncGenerator<string>}
 */
export default async function* testEventReporter(source) {
  for await (const event of source) {
    if (event.type === "test:fail") {
      const line = {
        type: "test:fail",
        name: event.data.name,
        durationMs: event.data.details?.duration_ms ?? 0,
        error: pickError(event.data.details?.error)
      };
      yield `${JSON.stringify(line)}\n`;
      continue;
    }

    if (event.type === "test:summary" && isAggregateSummary(event.data)) {
      const { counts, duration_ms: durationMs } = event.data;
      const line = {
        type: "test:summary",
        counts: {
          tests: counts.tests,
          pass: counts.passed,
          fail: counts.failed,
          skip: counts.skipped,
          todo: counts.todo,
          cancelled: counts.cancelled
        },
        durationMs
      };
      yield `${JSON.stringify(line)}\n`;
    }
  }
}

/**
 * Parses the JSON lines emitted by {@link testEventReporter} back out of a workspace's
 * captured stdout, running in the parent process. Lines that aren't valid JSON (npm noise,
 * or a workspace script that never runs node:test at all) are silently skipped rather than
 * treated as a parsing error.
 * @param {string} output
 * @returns {{ counts: ReportedCounts | null, failingTests: string[], failures: ReportedFailure[] }}
 */
export function parseReporterEvents(output) {
  let counts = null;
  let durationMs = null;
  const failures = [];

  for (const rawLine of output.split("\n")) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    let event;
    try {
      event = JSON.parse(line);
    }
    catch {
      continue;
    }

    if (event?.type === "test:fail" && typeof event.name === "string") {
      failures.push({ name: event.name, durationMs: event.durationMs, error: event.error });
    }
    else if (event?.type === "test:summary" && event.counts) {
      counts = event.counts;
      durationMs = event.durationMs;
    }
  }

  return {
    counts: counts ? { ...counts, durationMs } : null,
    failingTests: failures.map((failure) => failure.name),
    failures
  };
}

/**
 * @param {ReportedFailure[]} failures
 * @returns {string}
 */
export function renderFailureRecap(failures) {
  return failures
    .map(({ name, durationMs, error }) => {
      const header = `✖ ${name} (${Number(durationMs ?? 0).toFixed(1)}ms)`;
      const detail = error?.stack ?? error?.message ?? "";
      return detail ? `${header}\n${detail}` : header;
    })
    .join("\n\n");
}

/**
 * @param {ReportedCounts} counts
 * @returns {string}
 */
export function renderSummaryText(counts) {
  return [
    `ℹ tests ${counts.tests}`,
    `ℹ pass ${counts.pass}`,
    `ℹ fail ${counts.fail}`,
    `ℹ skipped ${counts.skip}`,
    `ℹ todo ${counts.todo}`,
    `ℹ cancelled ${counts.cancelled}`,
    `ℹ duration_ms ${counts.durationMs}`
  ].join("\n");
}
