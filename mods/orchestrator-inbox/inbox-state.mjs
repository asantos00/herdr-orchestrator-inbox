export const INBOX_LABEL = "herdr.inbox";
export const ACK_TIMEOUT_MS = 60 * 60 * 1000;
const MAX_EVENTS = 64;

function stableTerminalFact(terminal) {
  return {
    address: terminal.address ?? "",
    state: terminal.state ?? "live",
    status: terminal.status ?? null,
    turn: terminal.turn ?? null,
    report: terminal.report ?? null,
    reason: terminal.reason ?? null,
    exit_code: terminal.exit_code ?? null,
  };
}

function hash(value) {
  const text = JSON.stringify(value);
  let result = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    result ^= text.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(36);
}

export function activityFingerprint(root, descendants = []) {
  return hash([
    stableTerminalFact(root),
    [...descendants]
      .map(stableTerminalFact)
      .sort((left, right) => left.address.localeCompare(right.address)),
  ]);
}

export function parseInboxState(labels) {
  const raw = labels?.[INBOX_LABEL];
  if (!raw) return { version: 1, tracked: false, events: [] };
  try {
    const value = JSON.parse(raw);
    if (!value || value.version !== 1 || !Array.isArray(value.events)) throw new Error("invalid state");
    return {
      version: 1,
      tracked: value.tracked !== false,
      events: value.events.filter((event) => event && typeof event.type === "string"),
    };
  } catch {
    return { version: 1, tracked: true, events: [] };
  }
}

export function serializeInboxState(state) {
  return JSON.stringify({
    version: 1,
    tracked: state.tracked !== false,
    events: (state.events ?? []).slice(-MAX_EVENTS),
  });
}

export function recordAction(state, type, fingerprint, now = Date.now(), until = null) {
  const event = { type, at: now, fingerprint };
  if (Number.isFinite(until)) event.until = until;
  return {
    version: 1,
    tracked: true,
    events: [...(state.events ?? []), event].slice(-MAX_EVENTS),
  };
}

export function lastAction(state) {
  return state.events?.at(-1) ?? null;
}

export function descendantsNeedAttention(descendants = []) {
  return descendants.some(
    (child) => child.state === "live" && (child.status === "blocked" || child.status === "error" || child.exit_code > 0),
  );
}

export function isInboxTerminalVisible(terminal) {
  return terminal?.state !== "finished" || terminal.reason !== "killed";
}

export function triageState(root, descendants = [], now = Date.now()) {
  const state = parseInboxState(root.labels);
  const fingerprint = activityFingerprint(root, descendants);
  const action = lastAction(state);
  const unchanged = action?.fingerprint === fingerprint;
  const activeUntil = Number.isFinite(action?.until) && action.until > now;
  const acknowledged = action?.type === "acknowledged" && unchanged && activeUntil;
  const snoozed = action?.type === "snoozed" && unchanged && activeUntil;
  const done = root.state === "finished" || root.status === "done";
  const reviewed = action?.type === "reviewed" && unchanged;
  const reviewNeeded = done && !reviewed;
  const blocked = root.status === "blocked" || root.status === "error" || root.exit_code > 0;
  const actionable = blocked || reviewNeeded;
  const handled = acknowledged || snoozed;

  let bucket = "in_progress";
  if (actionable && !handled) bucket = "to_handle";
  else if (done && reviewed) bucket = "reviewed";

  let displayStatus = root.status ?? (root.state === "finished" ? "done" : "idle");
  if (reviewNeeded) displayStatus = "done";
  else if (handled && blocked) displayStatus = "working";
  else if (done && reviewed) displayStatus = "idle";

  return {
    state,
    action,
    fingerprint,
    bucket,
    displayStatus,
    reviewNeeded,
    acknowledged,
    snoozed,
    wakeReason:
      action && !unchanged && (action.type === "acknowledged" || action.type === "snoozed")
        ? "Relevant activity"
        : action && unchanged && !activeUntil && (action.type === "acknowledged" || action.type === "snoozed")
          ? "Timeout reached"
          : null,
  };
}
