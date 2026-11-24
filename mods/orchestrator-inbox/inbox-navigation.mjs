export function actionableAddresses(agents) {
  return agents.filter((agent) => agent.triage?.bucket === "to_handle").map((agent) => agent.address);
}

export function rootNavigation(agent) {
  if (!agent?.address) return null;
  return {
    name: agent.state === "finished" ? "inbox.retained" : "agent.focus",
    args: { terminal: agent.address },
  };
}

export function childNavigation(terminal, listedAddresses) {
  if (!terminal?.address) return null;
  return {
    name: listedAddresses.has(terminal.address)
      ? "pane.focus"
      : terminal.state === "finished"
        ? "inbox.retained"
        : "terminal.peek",
    args: { terminal: terminal.address },
  };
}
