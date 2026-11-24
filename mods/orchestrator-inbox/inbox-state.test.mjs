import test from "node:test";
import assert from "node:assert/strict";
import {
  ACK_TIMEOUT_MS,
  INBOX_LABEL,
  activityFingerprint,
  descendantsNeedAttention,
  parseInboxState,
  recordAction,
  serializeInboxState,
  triageState,
} from "./inbox-state.mjs";

const now = 1_000_000;
const root = (overrides = {}) => ({
  address: "t1",
  state: "live",
  status: "blocked",
  turn: 2,
  report: { msg: "Choose an option" },
  labels: {},
  ...overrides,
});

function labeled(terminal, state) {
  return { ...terminal, labels: { ...terminal.labels, [INBOX_LABEL]: serializeInboxState(state) } };
}

test("only live blocked descendants make a root need attention", () => {
  assert.equal(descendantsNeedAttention([{ state: "live", status: "blocked" }]), true);
  assert.equal(descendantsNeedAttention([{ state: "live", status: "error" }]), true);
  assert.equal(descendantsNeedAttention([{ state: "finished", status: null, exit_code: 1 }]), false);
});

test("blocked and unreviewed completed roots need handling", () => {
  assert.equal(triageState(root(), [], now).bucket, "to_handle");
  const completed = root({ state: "finished", status: null, exit_code: 0 });
  assert.equal(triageState(completed, [], now).reviewNeeded, true);
  assert.equal(triageState(completed, [], now).displayStatus, "done");
});

test("opening has no state transition because triage is derived only from labels", () => {
  const before = triageState(root(), [], now);
  const after = triageState(root(), [], now + 1);
  assert.deepEqual(after.state, before.state);
  assert.equal(after.bucket, "to_handle");
});

test("acknowledgement moves unchanged work to in progress and expires", () => {
  const terminal = root();
  const fingerprint = activityFingerprint(terminal, []);
  const state = recordAction(parseInboxState({}), "acknowledged", fingerprint, now, now + ACK_TIMEOUT_MS);
  const acknowledged = labeled(terminal, state);
  assert.equal(triageState(acknowledged, [], now + 1).bucket, "in_progress");
  assert.equal(triageState(acknowledged, [], now + ACK_TIMEOUT_MS + 1).bucket, "to_handle");
  assert.equal(triageState(acknowledged, [], now + ACK_TIMEOUT_MS + 1).wakeReason, "Timeout reached");
});

test("relevant descendant activity wakes acknowledged or snoozed work", () => {
  const child = { address: "t2", state: "live", status: "working", turn: 1, report: null };
  const fingerprint = activityFingerprint(root(), [child]);
  const state = recordAction(parseInboxState({}), "snoozed", fingerprint, now, now + ACK_TIMEOUT_MS);
  const snoozed = labeled(root(), state);
  assert.equal(triageState(snoozed, [child], now + 1).snoozed, true);
  const failed = { ...child, status: "blocked", turn: 2, report: { msg: "CI failed" } };
  const awakened = triageState(snoozed, [failed], now + 2);
  assert.equal(awakened.bucket, "to_handle");
  assert.equal(awakened.wakeReason, "Relevant activity");
});

test("review is sticky only for the completed activity fingerprint", () => {
  const terminal = root({ state: "finished", status: null, exit_code: 0 });
  const fingerprint = activityFingerprint(terminal, []);
  const reviewed = labeled(terminal, recordAction(parseInboxState({}), "reviewed", fingerprint, now));
  assert.equal(triageState(reviewed, [], now + 1).bucket, "reviewed");
  assert.equal(triageState({ ...reviewed, turn: 3 }, [], now + 2).reviewNeeded, true);
});

test("the label is compact, bounded, and malformed data fails open", () => {
  let state = parseInboxState({ [INBOX_LABEL]: "not-json" });
  assert.equal(state.tracked, true);
  for (let index = 0; index < 80; index += 1) {
    state = recordAction(state, "acknowledged", String(index), now + index, now + index + 10);
  }
  const encoded = serializeInboxState(state);
  assert.equal(JSON.parse(encoded).events.length, 64);
});
