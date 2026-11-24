import test from "node:test";
import assert from "node:assert/strict";
import { actionMessage, labelsWithOptimisticState, OPTIMISTIC_TTL_MS } from "./inbox-optimistic.mjs";

test("uses optimistic triage state immediately", () => {
  const optimistic = { raw: '{"version":1,"events":[]}', at: 1000 };
  const result = labelsWithOptimisticState({ "herdr.inbox": "old" }, optimistic, 1001);
  assert.equal(result.labels["herdr.inbox"], optimistic.raw);
  assert.equal(result.settled, false);
});

test("settles when native state confirms or the optimistic window expires", () => {
  const optimistic = { raw: "new", at: 1000 };
  assert.equal(labelsWithOptimisticState({ "herdr.inbox": "new" }, optimistic, 1001).settled, true);
  assert.equal(labelsWithOptimisticState({ "herdr.inbox": "old" }, optimistic, 1000 + OPTIMISTIC_TTL_MS).settled, true);
});

test("describes action feedback clearly", () => {
  assert.equal(actionMessage("reviewed", null, 1000), "Marked reviewed");
  assert.equal(actionMessage("acknowledged", null, 1000), "Acknowledged");
  assert.equal(actionMessage("snoozed", 301000, 1000), "Snoozed for 5 minutes");
});
