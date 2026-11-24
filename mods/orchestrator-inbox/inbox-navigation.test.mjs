import test from "node:test";
import assert from "node:assert/strict";
import { actionableAddresses, childNavigation, rootNavigation } from "./inbox-navigation.mjs";

test("limits Inbox keyboard navigation to actionable roots", () => {
  const agents = [
    { address: "needs", triage: { bucket: "to_handle" } },
    { address: "working", triage: { bucket: "in_progress" } },
    { address: "review", triage: { bucket: "to_handle" } },
    { address: "idle", triage: { bucket: "all_work" } },
  ];
  assert.deepEqual(actionableAddresses(agents), ["needs", "review"]);
});

test("focuses live roots and opens finished retained roots", () => {
  assert.deepEqual(rootNavigation({ address: "t1", state: "live" }), {
    name: "agent.focus",
    args: { terminal: "t1" },
  });
  assert.deepEqual(rootNavigation({ address: "t2", state: "finished" }), {
    name: "inbox.retained",
    args: { terminal: "t2" },
  });
});

test("focuses child agents that already have a pane", () => {
  assert.deepEqual(childNavigation({ address: "t2" }, new Set(["t2"])), {
    name: "pane.focus",
    args: { terminal: "t2" },
  });
});

test("peeks at live headless children and opens finished retained children", () => {
  assert.deepEqual(childNavigation({ address: "t3", state: "live" }, new Set()), {
    name: "terminal.peek",
    args: { terminal: "t3" },
  });
  assert.deepEqual(childNavigation({ address: "t4", state: "finished" }, new Set()), {
    name: "inbox.retained",
    args: { terminal: "t4" },
  });
  assert.equal(childNavigation({}, new Set()), null);
});
