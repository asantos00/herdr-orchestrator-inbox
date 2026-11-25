// A quiet, cross-machine attention inbox built only on Herdr's public local APIs.
// It reads visible terminal output for context and never sends terminal input.

import { View, div, image, svg } from "gpui-kit";
import { TextView, h_flex, v_flex } from "gpui-base";
import { agents, checking, closeOverlay, focused, hc, layout, machines, notify, openOverlay, props, run, setAgentOrder, spaces, terminals, theme } from "herdr";
import {
  ACK_TIMEOUT_MS,
  INBOX_LABEL,
  descendantsNeedAttention,
  parseInboxState,
  recordAction,
  serializeInboxState,
  triageState,
} from "./inbox-state.mjs";
import { actionableAddresses, childNavigation, rootNavigation } from "./inbox-navigation.mjs";
import { actionMessage, labelsWithOptimisticState } from "./inbox-optimistic.mjs";
import { retainedTranscript } from "./retained-transcript.mjs";

const ASSET = "mods/orchestrator-inbox";
const SECTIONS = [
  { status: "blocked", title: "Needs you", empty: "Nothing is waiting on you" },
  { status: "done", title: "Ready to review", empty: "Nothing new to review" },
  { status: "working", title: "Working", empty: "No agents are working" },
  { status: "idle", title: "Idle", empty: "No idle sessions" },
];
const STATUS_TEXT = { blocked: "Needs you", done: "Done", working: "Working", idle: "Idle" };

function findLayout(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = findLayout(child, id);
    if (found) return found;
  }
  return null;
}

function normalizedStatus(status) {
  if (status === "error") return "blocked";
  return STATUS_TEXT[status] ? status : "idle";
}

function isAgentTerminal(terminal) {
  const reportedAgent = terminal?.agent && !["bash", "fish", "nu", "sh", "zsh"].includes(terminal.agent);
  return Boolean(terminal && (terminal.status || terminal.program?.agent || reportedAgent));
}

function mergedTerminals(live, retained) {
  const merged = new Map(retained.map((terminal) => [terminal.address, terminal]));
  for (const terminal of live) merged.set(terminal.address, { ...merged.get(terminal.address), ...terminal });
  return [...merged.values()];
}

function descendantsOf(address, allTerminals) {
  const descendants = [];
  const visit = (parent) => {
    for (const terminal of allTerminals) {
      if (terminal.parent !== parent || descendants.some((entry) => entry.address === terminal.address)) continue;
      descendants.push(terminal);
      visit(terminal.address);
    }
  };
  visit(address);
  return descendants;
}

function retainedAgent(terminal) {
  const name = terminal.name || terminal.where || terminal.agent || terminal.address;
  return {
    ...terminal,
    app: terminal.agent ?? null,
    focused: false,
    pinned: false,
    program: { agent: true, color: null, icon: null, key: terminal.agent || "agent", name: terminal.agent || "Agent", shell: false, tile: null, tint: true },
    seq: terminal.turn ?? 0,
    space: terminal.where || terminal.cwd || "Retained",
    space_name: terminal.where || "Retained",
    tab_name: name,
    title: name,
  };
}

function rootAgentAddress(address, terminalByAddress) {
  let current = terminalByAddress.get(address);
  let root = isAgentTerminal(current) ? current.address : address;
  const seen = new Set();
  while (current?.parent && !seen.has(current.parent)) {
    seen.add(current.parent);
    current = terminalByAddress.get(current.parent);
    if (isAgentTerminal(current)) root = current.address;
  }
  return root;
}

function cleanTitle(value) {
  return (value ?? "")
    .replace(/\x1b\[[0-?]*[ -\/]*[@-~]/g, "")
    .replace(/^[^\p{L}\p{N}\p{Ps}\p{Pi}]+/u, "")
    .replace(/^\[ [!.] \] /, "")
    .trim();
}

function latestActivity(value) {
  let cleaned = (value ?? "")
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-?]*[ -\/]*[@-~]/g, "")
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "");

  const recap = cleaned.match(/※\s*recap:\s*([\s\S]*?)(?=\n\s*(?:Update available|[─━═]|❯|$))/i)?.[1];
  if (recap) {
    const text = recap.replace(/\s+/g, " ").trim();
    return text.length > 280 ? `${text.slice(0, 277)}…` : text;
  }

  cleaned = cleaned.replace(/\n\s*(?:Update Available|Package Updates Available)[\s\S]*$/i, "");
  const lines = cleaned
    .split("\n")
    .map((line) => line.replace(/^[│┃┆┊╎╏└┘├┤┌┐─━═╌╍┄┅┈┉\s]+/, "").trim())
    .filter(Boolean)
    .filter((line) => !/^[─━═_\-—=·•\s]+$/.test(line))
    .filter((line) => !/^(Tip:|auto mode on|esc to cancel|Took \d|Ran \d|Called .+ times|\(no output\))/i.test(line))
    .filter((line) => !/^[❯>$#›]\s*$/.test(line))
    .filter((line) => !/^\$\s/.test(line))
    .filter((line) => !/^\{.*"(?:started|status)"/.test(line))
    .filter((line) => !/^[✻*]\s.*\bdone\b/i.test(line))
    .filter((line) => !/^⏵⏵/.test(line))
    // Pi's terminal footer is operational chrome, not session context. It often
    // wraps across two lines, so drop both the metrics and model-route fragments.
    .filter((line) => !(/[↑↓]\s*\d|\bCH\d|\bR\d+[KMG]?\b|\/\d+k\s*\((?:auto|manual)\)/i.test(line)))
    .filter((line) => !(/^\s*(?:gpt|claude|gemini)-[\w.-]+\s*[•·]/i.test(line)));
  let text = lines.slice(-3).join(" ").replace(/\s+/g, " ").trim();
  if (text.length > 280) text = `${text.slice(0, 277)}…`;
  return text;
}

function machineName(agent, bySpace) {
  const named = bySpace.get(agent.space)?.machine;
  if (named) return named;
  const slash = agent.address.indexOf("/");
  return slash > 0 ? agent.address.slice(0, slash) : "This Mac";
}

function primaryLabel(agent) {
  const tab = cleanTitle(agent.tab_name);
  const title = cleanTitle(agent.title);
  if (tab && !/^\d+$/.test(tab)) return tab;
  if (title && title !== agent.program?.name && title !== agent.address) return title;
  return agent.program?.name || agent.app || agent.address;
}

function programIcon(agent, color) {
  const program = agent.program;
  if (!program?.icon) return svg(`${ASSET}/terminal.svg`).size(15).flex_none().text_color(color);
  return program.tint
    ? svg(program.icon).size(15).flex_none().text_color(color)
    : image(program.icon).size(15).flex_none();
}

function hasWorkingDescendant(address, allTerminals, seen = new Set()) {
  if (seen.has(address)) return false;
  seen.add(address);
  const children = allTerminals.filter((terminal) => terminal.state === "live" && terminal.parent === address);
  return children.some((child) => child.status === "working" || hasWorkingDescendant(child.address, allTerminals, seen));
}

function effectiveRootStatus(agent, allTerminals) {
  // Herdr already owns the federated parent tree. A root waiting synchronously
  // on any hc-managed descendant is still orchestrating, regardless of agent app.
  if (hasWorkingDescendant(agent.address, allTerminals)) return "working";
  return normalizedStatus(agent.status);
}

function groupsFor(list, bySpace) {
  const groups = [];
  const found = new Map();
  for (const agent of list) {
    const machine = machineName(agent, bySpace);
    const key = `${machine}\u0000${agent.space}`;
    let group = found.get(key);
    if (!group) {
      group = { key, machine, space: agent.space_name || "Unnamed space", agents: [] };
      found.set(key, group);
      groups.push(group);
    }
    group.agents.push(agent);
  }
  return groups;
}

export default class LocalInbox extends View {
  init(_props, cx) {
    this.width = null;
    this.previews = new Map();
    this.loading = new Set();
    this.showAll = new Set();
    this.retained = [];
    this.historyLoading = false;
    this.historyReadAt = 0;
    this.tracking = new Set();
    this.actionPending = new Map();
    this.actionErrors = new Map();
    this.optimisticStates = new Map();
    this.listedAddresses = new Set();
    this.retainedOutput = null;
    this.retainedError = null;
    this.showFullRetained = false;
    try {
      this.folded = new Set(JSON.parse(localStorage.getItem("folded") ?? '["working","idle"]'));
      this.subagentsFolded = JSON.parse(localStorage.getItem("inbox.subagents-folded") ?? "true");
    } catch {
      this.folded = new Set(["working", "idle"]);
      this.subagentsFolded = true;
    }
    if (props()?.retained) {
      if (!checking()) this.loadRetained(props().retained, cx);
      return;
    }
    if (!checking()) {
      this.refreshHistory(cx, true);
      cx.timer.every(30000, (timerCx) => {
        this.refreshHistory(timerCx, true);
        timerCx.notify();
      });
    }
  }

  loadRetained(address, cx) {
    cx.spawn(async (spawnCx) => {
      try {
        const result = await hc(["read", address, "--lines", "300"]);
        if (result.code !== 0) throw new Error(result.stderr || "Could not read retained terminal");
        this.retainedOutput = retainedTranscript(result.stdout);
      } catch (error) {
        this.retainedError = error?.message || String(error);
      }
      spawnCx.notify();
    });
  }

  toggle(status, cx) {
    if (this.folded.has(status)) this.folded.delete(status);
    else this.folded.add(status);
    localStorage.setItem("folded", JSON.stringify([...this.folded]));
    cx.notify();
  }

  toggleAll(status, cx) {
    if (this.showAll.has(status)) this.showAll.delete(status);
    else this.showAll.add(status);
    cx.notify();
  }

  toggleSubagents(cx) {
    this.subagentsFolded = !this.subagentsFolded;
    localStorage.setItem("inbox.subagents-folded", JSON.stringify(this.subagentsFolded));
    cx.notify();
  }

  refreshHistory(cx, force = false) {
    if (this.historyLoading || (!force && Date.now() - this.historyReadAt < 1500)) return;
    this.historyLoading = true;
    cx.spawn(async (spawnCx) => {
      try {
        const result = await hc(["ls", "--all", "--json"]);
        if (result.code === 0) {
          const parsed = JSON.parse(result.stdout || "{}");
          const summaries = Array.isArray(parsed.terminals) ? parsed.terminals : [];
          const agentAddresses = new Set(summaries.filter(isAgentTerminal).map((terminal) => terminal.address));
          const roots = summaries
            .filter((terminal) => isAgentTerminal(terminal) && !agentAddresses.has(terminal.parent))
            .slice(-100);
          const previous = new Map(this.retained.map((terminal) => [terminal.address, terminal]));
          const changedRoots = roots.filter((terminal) => {
            const known = previous.get(terminal.address);
            return !known?.labels || known.seq !== terminal.seq || known.state !== terminal.state;
          });
          const details = await Promise.all(
            changedRoots.map(async (terminal) => {
              try {
                const detail = await hc(["get", "--json", terminal.address]);
                return detail.code === 0 ? JSON.parse(detail.stdout || "{}") : null;
              } catch {
                return null;
              }
            }),
          );
          const byAddress = new Map(summaries.map((terminal) => [terminal.address, { ...previous.get(terminal.address), ...terminal }]));
          for (const detail of details) {
            if (detail?.address) byAddress.set(detail.address, { ...byAddress.get(detail.address), ...detail });
          }
          this.retained = [...byAddress.values()];
          this.historyReadAt = Date.now();
        }
      } catch {
        // Live terminals remain usable when retained history is temporarily unavailable.
      }
      this.historyLoading = false;
      spawnCx.notify();
    });
  }

  writeInboxState(agent, state, cx) {
    if (this.actionPending.has(agent.address)) return;
    const event = state.events.at(-1);
    const raw = serializeInboxState(state);
    this.actionPending.set(agent.address, event?.type || "saving");
    this.optimisticStates.set(agent.address, { raw, at: Date.now() });
    this.actionErrors.delete(agent.address);
    cx.notify();
    cx.spawn(async (spawnCx) => {
      try {
        const result = await hc(["label", "--json", agent.address, `${INBOX_LABEL}=${raw}`]);
        if (result.code !== 0) throw new Error(result.stderr || "Could not update Inbox state");
        const message = actionMessage(event?.type, event?.until);
        notify({ title: message, body: primaryLabel(agent), level: "success" });
      } catch (error) {
        const message = error?.message || String(error);
        this.optimisticStates.delete(agent.address);
        this.actionErrors.set(agent.address, message);
        notify({ title: "Inbox action failed", body: message, level: "error" });
      }
      this.actionPending.delete(agent.address);
      spawnCx.notify();
    });
  }

  ensureTracked(agent, cx) {
    if (checking() || agent.labels?.[INBOX_LABEL] || this.tracking.has(agent.address) || agent.state === "finished") return;
    this.tracking.add(agent.address);
    cx.spawn(async (spawnCx) => {
      try {
        const state = parseInboxState(agent.labels);
        const value = `${INBOX_LABEL}=${serializeInboxState({ ...state, tracked: true })}`;
        await hc(["label", "--json", agent.address, value]);
      } catch {
        // Tracking is retried after the terminal changes again.
      }
      this.tracking.delete(agent.address);
      this.refreshHistory(spawnCx, true);
      spawnCx.notify();
    });
  }

  act(agent, type, cx, until = null) {
    const next = recordAction(agent.triage.state, type, agent.triage.fingerprint, Date.now(), until);
    this.writeInboxState(agent, next, cx);
  }

  markReviewed(agent, cx) {
    this.act(agent, "reviewed", cx);
  }

  acknowledge(agent, cx) {
    this.act(agent, "acknowledged", cx, Date.now() + ACK_TIMEOUT_MS);
  }

  snooze(agent, cx, durationMs = ACK_TIMEOUT_MS) {
    this.act(agent, "snoozed", cx, Date.now() + durationMs);
  }

  ensurePreview(agent, cx) {
    if (agent.status === "working") return;
    const cached = this.previews.get(agent.address);
    if (cached?.seq === agent.seq || this.loading.has(agent.address)) return;
    this.loading.add(agent.address);
    cx.spawn(async (cx) => {
      let text = "";
      try {
        const result = await hc(["read", agent.address, "--lines", "12"]);
        text = result.code === 0 ? latestActivity(result.stdout) : "";
      } catch {
        text = "";
      }
      this.loading.delete(agent.address);
      this.previews.set(agent.address, { seq: agent.seq, text });
      cx.notify();
    });
  }

  openCommand(command, title) {
    if (!command) return;
    if (command.name === "inbox.retained") {
      openOverlay({
        mod: "orchestrator-inbox",
        props: { retained: command.args.terminal, retainedTitle: title },
        kind: "dialog",
        modal: true,
        width: 0.82,
        height: 0.8,
      });
      return;
    }
    run(command.name, command.args);
  }

  open(agent) {
    this.openCommand(rootNavigation(agent), primaryLabel(agent));
  }

  openChild(terminal) {
    this.openCommand(
      childNavigation(terminal, this.listedAddresses),
      terminal.name || terminal.template || terminal.program?.name || terminal.address,
    );
  }

  compactAgent(t, agent) {
    const active = agent.focused;
    const label = `${primaryLabel(agent)} · ${STATUS_TEXT[agent.status] ?? "Idle"}`;
    return div()
      .id(`compact-${agent.address}`)
      .w(42)
      .h(38)
      .flex_none()
      .flex()
      .items_center()
      .justify_center()
      .rounded(8)
      .relative()
      .tooltip(label)
      .cursor_pointer()
      .when(active, (el) => el.bg(t.selected))
      .hover((el) => el.bg(t.hover))
      .on_click(() => this.open(agent))
      .child(
        div()
          .size(27)
          .rounded(7)
          .flex()
          .items_center()
          .justify_center()
          .bg(active ? t.accent : t.raised)
          .text_color(active ? t.accent_foreground : t.muted)
          .child(programIcon(agent, active ? t.accent_foreground : t.muted)),
      )
      .child(
        div()
          .absolute()
          .right(4)
          .bottom(4)
          .size(12)
          .rounded(6)
          .flex()
          .items_center()
          .justify_center()
          .bg(t.chrome)
          .child(this.statusMark(t, agent.status)),
      );
  }

  compactSection(t, section, list) {
    const folded = this.folded.has(section.status);
    const visible = this.showAll.has(section.status) ? list : list.slice(0, 5);
    return v_flex()
      .w_full()
      .items_center()
      .pb(5)
      .child(
        h_flex()
          .id(`compact-section-${section.status}`)
          .h(27)
          .px(5)
          .gap(4)
          .items_center()
          .rounded(6)
          .tooltip(`${section.title}: ${list.length} · ${folded ? "expand" : "collapse"}`)
          .cursor_pointer()
          .hover((el) => el.bg(t.hover))
          .on_click((_event, cx) => this.toggle(section.status, cx))
          .child(this.foldChevron(t, `compact-${section.status}`, folded, 9))
          .child(this.statusMark(t, section.status))
          .child(div().min_w(11).text_size(9.5).font_semibold().text_color(t.dim).child(String(list.length))),
      )
      .when(!folded, (el) => el.children(visible.map((agent) => this.compactAgent(t, agent))))
      .when(!folded && list.length > 5, (el) =>
        el.child(
          div()
            .h(24)
            .px(7)
            .rounded(6)
            .flex()
            .items_center()
            .text_size(9.5)
            .font_semibold()
            .text_color(t.dim)
            .tooltip(this.showAll.has(section.status) ? "Show fewer" : `Show ${list.length - 5} more`)
            .cursor_pointer()
            .hover((item) => item.bg(t.hover).text_color(t.foreground))
            .on_click((_event, cx) => this.toggleAll(section.status, cx))
            .child(this.showAll.has(section.status) ? "−" : `+${list.length - 5}`),
        ),
      );
  }

  compact(t, grouped, attention) {
    return v_flex()
      .id("orchestrator-inbox-compact")
      .size_full()
      .bg(t.chrome)
      .on_size_change((size, cx) => {
        if (this.width !== size.width) {
          this.width = size.width;
          cx.notify();
        }
      })
      .child(
        h_flex()
          .h(38)
          .w_full()
          .gap(2)
          .items_center()
          .justify_center()
          .border_b(1)
          .border_color(t.border)
          .child(
            div()
              .id("compact-expand")
              .size(26)
              .rounded(6)
              .flex()
              .items_center()
              .justify_center()
              .tooltip("Open Inbox command center")
              .text_color(t.muted)
              .hover((el) => el.bg(t.hover).text_color(t.foreground))
              .cursor_pointer()
              .on_click(() => run("layout.select", { stack: "work-mode", child: "inbox-command-center" }))
              .child(svg(`${ASSET}/chevron-right.svg`).size(14)),
          )
          .child(
            div()
              .id("compact-open-agents")
              .size(26)
              .rounded(6)
              .relative()
              .flex()
              .items_center()
              .justify_center()
              .tooltip("Open Agents")
              .text_color(t.accent)
              .bg(t.selected)
              .hover((el) => el.bg(t.hover).text_color(t.foreground))
              .cursor_pointer()
              .on_click(() => run("layout.select", { stack: "sidebar-content", child: "sidebar-lists" }))
              .child(svg(`${ASSET}/layers.svg`).size(14))
              .when(attention > 0, (el) =>
                el.child(div().absolute().right(2).top(2).size(5).rounded(3).bg(t.blocked)),
              ),
          ),
      )
      .child(
        v_flex()
          .flex_1()
          .w_full()
          .overflow_y_scrollbar()
          .items_center()
          .pt(4)
          .children(SECTIONS.map((section) => this.compactSection(t, section, grouped.get(section.status)))),
      );
  }

  statusMark(t, status) {
    if (status === "working") {
      return svg(`${ASSET}/spinner.svg`).size(12).flex_none().text_color(t.working).spin(900);
    }
    return div()
      .size(status === "blocked" ? 9 : 8)
      .flex_none()
      .rounded(5)
      .when(status === "idle", (el) => el.border(1.5).border_color(t.idle))
      .when(status !== "idle", (el) => el.bg(t[status] ?? t.dim));
  }

  foldChevron(t, id, folded, size = 12) {
    const motion = { duration: 120, easing: "ease-out" };
    return div()
      .id(`fold-chevron-${id}`)
      .relative()
      .size(size)
      .flex_none()
      .child(
        svg(`${ASSET}/chevron-right.svg`)
          .id(`fold-right-${id}`)
          .absolute()
          .size(size)
          .text_color(t.dim)
          .opacity(folded ? 1 : 0)
          .transition("opacity", motion),
      )
      .child(
        svg(`${ASSET}/chevron-down.svg`)
          .id(`fold-down-${id}`)
          .absolute()
          .size(size)
          .text_color(t.dim)
          .opacity(folded ? 0 : 1)
          .transition("opacity", motion),
      );
  }

  summary(agent) {
    const preview = this.previews.get(agent.address)?.text;
    if (preview) return preview;
    if (this.loading.has(agent.address)) return "Reading latest activity…";
    if (agent.status === "working") return "Working now";
    if (agent.status === "blocked") return "Open the session to review the request";
    if (agent.status === "done") return "Finished — open to review the result";
    return "Idle — open to review the context";
  }

  subagentsFor(address, allTerminals) {
    const rows = [];
    const visit = (parent, depth) => {
      for (const terminal of allTerminals) {
        if (terminal.parent !== parent) continue;
        if (!isAgentTerminal(terminal)) continue;
        rows.push({ terminal, depth });
        visit(terminal.address, depth + 1);
      }
    };
    visit(address, 0);
    return rows;
  }

  subagentRow(t, item, selectedAddress) {
    const terminal = item.terminal;
    const status = normalizedStatus(terminal.status);
    const label = terminal.name || terminal.template || terminal.program?.name || terminal.address;
    return h_flex()
      .id(`subagent-${terminal.address}`)
      .h(30)
      .pl(11 + item.depth * 15)
      .pr(9)
      .gap(7)
      .items_center()
      .cursor_pointer()
      .tooltip(this.listedAddresses.has(terminal.address) ? "Focus child session" : "Peek at child session")
      .when(terminal.address === selectedAddress, (el) => el.bg(t.selected))
      .hover((el) => el.bg(t.hover))
      .on_click(() => this.openChild(terminal))
      .child(div().w(10).h(15).flex_none().border_l(1).border_b(1).rounded_bl(4).border_color(t.input))
      .child(this.statusMark(t, status))
      .child(div().flex_1().truncate().text_size(10.8).text_color(terminal.address === selectedAddress ? t.foreground : t.muted).child(label))
      .child(div().text_size(9.5).text_color(t.dim).child(STATUS_TEXT[status]));
  }

  currentSession(t, selected, subagents, bySpace, selectedAddress) {
    const machine = machineName(selected, bySpace);
    return v_flex()
      .mx(8)
      .mt(3)
      .mb(6)
      .overflow_hidden()
      .rounded(9)
      .border(1)
      .border_color(t.border)
      .bg(t.surface)
      .child(
        h_flex()
          .h(50)
          .px(9)
          .gap(8)
          .items_center()
          .child(div().w(2).h(28).rounded(1).flex_none().bg(t[selected.status] ?? t.accent))
          .child(
            div()
              .size(26)
              .rounded(7)
              .flex_none()
              .flex()
              .items_center()
              .justify_center()
              .bg(t.raised)
              .child(programIcon(selected, t.muted)),
          )
          .child(
            v_flex()
              .flex_1()
              .min_w(0)
              .gap(2)
              .child(div().truncate().text_size(12).font_semibold().text_color(t.foreground).child(primaryLabel(selected)))
              .child(div().truncate().text_size(9.5).text_color(t.dim).child(`Current · ${machine}`)),
          )
          .when(selected.triage.bucket === "to_handle", (el) =>
            el.child(
              div()
                .id(`quick-snooze-current-${selected.address}`)
                .size(24)
                .rounded(6)
                .flex_none()
                .flex()
                .items_center()
                .justify_center()
                .tooltip("Snooze 5 minutes")
                .text_color(t.muted)
                .cursor_pointer()
                .hover((button) => button.bg(t.hover).text_color(t.foreground))
                .on_click((_event, cx) => this.snooze(selected, cx, 5 * 60 * 1000))
                .child(svg(`${ASSET}/clock.svg`).size(12)),
            ),
          )
          .when(selected.status === "done", (el) =>
            el.child(
              div()
                .id(`review-current-${selected.address}`)
                .size(24)
                .rounded(6)
                .flex_none()
                .flex()
                .items_center()
                .justify_center()
                .tooltip("Mark reviewed")
                .text_color(t.done)
                .cursor_pointer()
                .hover((button) => button.bg(`${t.done}18`))
                .on_click((_event, cx) => this.markReviewed(selected, cx))
                .child(svg(`${ASSET}/check.svg`).size(12)),
            ),
          )
          .child(this.statusMark(t, selected.status))
          .when(subagents.length > 0, (el) =>
            el.child(
              h_flex()
                .id("current-subagents-toggle")
                .h(24)
                .px(6)
                .gap(4)
                .rounded(6)
                .flex_none()
                .items_center()
                .tooltip(`${subagents.length} subagent${subagents.length === 1 ? "" : "s"}`)
                .text_color(t.dim)
                .cursor_pointer()
                .hover((button) => button.bg(t.hover).text_color(t.foreground))
                .on_click((_event, cx) => this.toggleSubagents(cx))
                .child(this.foldChevron(t, "subagents", this.subagentsFolded, 9))
                .child(svg(`${ASSET}/layers.svg`).size(11))
                .child(div().text_size(9.5).font_semibold().child(String(subagents.length))),
            ),
          ),
      )
      .when(subagents.length > 0 && !this.subagentsFolded, (el) =>
        el.child(div().h(1).mx(9).bg(t.border)).children(subagents.map((item) => this.subagentRow(t, item, selectedAddress))),
      );
  }

  row(t, agent, index) {
    const active = agent.focused;
    return h_flex()
      .id(`inbox-${agent.address}`)
      .w_full()
      .h(44)
      .px(10)
      .gap(8)
      .items_center()
      .cursor_pointer()
      .when(index > 0, (el) => el.border_t(1).border_color(t.border))
      .when(active, (el) => el.bg(t.selected))
      .hover((el) => el.bg(t.hover))
      .on_click(() => this.open(agent))
      .child(
        div()
          .size(24)
          .rounded(6)
          .flex_none()
          .flex()
          .items_center()
          .justify_center()
          .bg(active ? t.accent : t.raised)
          .text_color(active ? t.accent_foreground : t.muted)
          .child(programIcon(agent, active ? t.accent_foreground : t.muted)),
      )
      .child(
        v_flex()
          .flex_1()
          .min_w(0)
          .gap(2)
          .child(
            h_flex()
              .gap(6)
              .items_center()
              .child(div().flex_1().truncate().text_size(12).font_semibold().text_color(t.foreground).child(primaryLabel(agent)))
              .when(agent.pinned, (el) => el.child(svg(`${ASSET}/pin.svg`).size(11).flex_none().text_color(t.accent))),
          )
          .child(
            div()
              .truncate()
              .text_size(10)
              .text_color(agent.status === "blocked" ? t.foreground : t.muted)
              .child(this.summary(agent)),
          ),
      )
      .when(agent.triage.bucket === "to_handle", (el) =>
        el.child(
          div()
            .id(`quick-snooze-${agent.address}`)
            .size(24)
            .rounded(6)
            .flex_none()
            .flex()
            .items_center()
            .justify_center()
            .tooltip("Snooze 5 minutes")
            .text_color(t.muted)
            .cursor_pointer()
            .hover((button) => button.bg(t.hover).text_color(t.foreground))
            .on_click((_event, cx) => {
              cx.stop_propagation();
              this.snooze(agent, cx, 5 * 60 * 1000);
            })
            .child(svg(`${ASSET}/clock.svg`).size(12)),
        ),
      )
      .when(agent.status === "done", (el) =>
        el.child(
          div()
            .id(`review-${agent.address}`)
            .size(24)
            .rounded(6)
            .flex_none()
            .flex()
            .items_center()
            .justify_center()
            .tooltip("Mark reviewed")
            .text_color(t.done)
            .cursor_pointer()
            .hover((button) => button.bg(`${t.done}18`))
            .on_click((_event, cx) => {
              cx.stop_propagation();
              this.markReviewed(agent, cx);
            })
            .child(svg(`${ASSET}/check.svg`).size(12)),
        ),
      )
      .child(this.statusMark(t, agent.status));
  }

  group(t, group) {
    return v_flex()
      .mx(8)
      .mb(6)
      .overflow_hidden()
      .rounded(8)
      .border(1)
      .border_color(t.border)
      .bg(t.surface)
      .child(
        h_flex()
          .h(28)
          .px(10)
          .gap(7)
          .items_center()
          .border_b(1)
          .border_color(t.border)
          .bg(t.raised)
          .child(svg(`${ASSET}/folder.svg`).size(12).flex_none().text_color(t.dim))
          .child(div().flex_1().truncate().text_size(10.5).font_semibold().text_color(t.muted).child(group.space))
          .child(div().text_size(9.5).text_color(t.dim).child(group.machine)),
      )
      .children(group.agents.map((agent, index) => this.row(t, agent, index)));
  }

  section(t, section, list, bySpace) {
    const folded = this.folded.has(section.status);
    const important = section.status === "blocked" || section.status === "done";
    const showAll = this.showAll.has(section.status);
    const visible = showAll ? list : list.slice(0, 5);
    const groups = groupsFor(visible, bySpace);

    return v_flex()
      .w_full()
      .child(
        h_flex()
          .id(`section-${section.status}`)
          .h(32)
          .px(10)
          .gap(7)
          .items_center()
          .cursor_pointer()
          .when(list.length > 0 && important, (el) => el.bg(`${t[section.status]}08`))
          .hover((el) => el.bg(t.hover))
          .on_click((_event, cx) => this.toggle(section.status, cx))
          .child(this.foldChevron(t, section.status, folded))
          .child(this.statusMark(t, section.status))
          .child(div().flex_1().text_size(11.5).font_semibold().text_color(list.length ? (t[section.status] ?? t.foreground) : t.muted).child(section.title))
          .child(
            div()
              .min_w(section.status === "working" && folded && list.length ? 48 : 21)
              .h(18)
              .px(6)
              .rounded(9)
              .flex()
              .items_center()
              .justify_center()
              .text_size(10.5)
              .font_semibold()
              .text_color(list.length && important ? t[section.status] : t.dim)
              .bg(list.length ? `${t[section.status]}18` : t.raised)
              .child(section.status === "working" && folded && list.length ? `${list.length} active` : String(list.length)),
          ),
      )
      .when(!folded, (el) => el.children(groups.map((group) => this.group(t, group))))
      .when(!folded && list.length > 5, (el) =>
        el.child(
          h_flex()
            .id(`show-all-${section.status}`)
            .h(30)
            .mx(8)
            .mb(6)
            .px(10)
            .items_center()
            .justify_center()
            .rounded(7)
            .text_size(10.5)
            .font_semibold()
            .text_color(t.dim)
            .cursor_pointer()
            .hover((button) => button.bg(t.hover).text_color(t.foreground))
            .on_click((_event, cx) => this.toggleAll(section.status, cx))
            .child(showAll ? "Show fewer" : `Show all ${list.length}`),
        ),
      );
  }

  retainedDialog(t) {
    const address = props().retained;
    const title = props().retainedTitle || address;
    const output = this.retainedOutput;
    const showingFull = this.showFullRetained && output?.full !== output?.review;
    const body = this.retainedError
      ? div().p(16).text_size(12).text_color(t.blocked).child(this.retainedError)
      : output === null
        ? div().p(16).text_size(12).text_color(t.dim).child("Reading retained terminal…")
        : TextView.html(
            `retained-output-${address}-${showingFull ? "full" : "result"}`,
            `<pre>${(showingFull ? output.fullHtml : output.reviewHtml) || "No retained output."}</pre>`,
          )
            .selectable(true)
            .scrollable(true);

    return v_flex()
      .size_full()
      .bg(t.chrome)
      .rounded(10)
      .border(1)
      .border_color(t.border)
      .child(
        h_flex()
          .h(46)
          .px(14)
          .gap(8)
          .items_center()
          .border_b(1)
          .border_color(t.border)
          .child(svg(`${ASSET}/archive.svg`).size(14).text_color(t.muted))
          .child(
            v_flex()
              .flex_1()
              .min_w(0)
              .child(div().truncate().text_size(12).font_semibold().text_color(t.foreground).child(title))
              .child(
                div()
                  .text_size(9.5)
                  .text_color(t.dim)
                  .child(`${showingFull ? "Full transcript" : "Final result"} · Retained session · ${address}`),
              ),
          )
          .when(output && output.full !== output.review, (el) =>
            el.child(
              div()
                .id("toggle-retained-transcript")
                .h(26)
                .px(9)
                .rounded(6)
                .flex()
                .items_center()
                .text_size(10.5)
                .font_semibold()
                .text_color(t.muted)
                .cursor_pointer()
                .hover((button) => button.bg(t.hover).text_color(t.foreground))
                .on_click((_event, cx) => {
                  this.showFullRetained = !showingFull;
                  cx.notify();
                })
                .child(showingFull ? "Show final result" : "Show full transcript"),
            ),
          )
          .child(
            div()
              .id("close-retained-inbox")
              .size(26)
              .rounded(6)
              .flex()
              .items_center()
              .justify_center()
              .text_color(t.muted)
              .cursor_pointer()
              .tooltip("Close")
              .hover((button) => button.bg(t.hover).text_color(t.foreground))
              .on_click(() => closeOverlay(props().overlay))
              .child(svg(`${ASSET}/x.svg`).size(12)),
          ),
      )
      .child(div().flex_1().min_h(0).overflow_hidden().p(12).child(body));
  }

  render(cx) {
    const t = theme();
    if (props()?.retained) return this.retainedDialog(t);
    const bySpace = new Map(spaces().map((space) => [space.id, space]));
    const machineList = machines();
    const unavailable = machineList.filter((machine) => machine.layout === "unavailable");
    const liveTerminals = terminals();
    const allTerminals = mergedTerminals(liveTerminals, this.retained);
    const terminalByAddress = new Map(allTerminals.map((terminal) => [terminal.address, terminal]));
    const liveAgents = [...agents()]
      .map((agent) => {
        const terminal = terminalByAddress.get(agent.address);
        return { ...terminal, ...agent, reportedStatus: terminal?.status ?? agent.status };
      })
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.seq - a.seq);
    this.listedAddresses = new Set(liveAgents.map((agent) => agent.address));
    const roots = new Map(
      liveAgents
        .filter((agent) => rootAgentAddress(agent.address, terminalByAddress) === agent.address)
        .map((agent) => [agent.address, agent]),
    );
    for (const terminal of this.retained) {
      if (terminal.state === "finished" && terminal.labels?.[INBOX_LABEL] && !roots.has(terminal.address)) {
        roots.set(terminal.address, retainedAgent(terminal));
      }
    }
    const all = [...roots.values()].map((agent) => {
      const descendants = descendantsOf(agent.address, allTerminals);
      const reportedStatus = agent.reportedStatus ?? agent.status;
      const liveStatus = agent.state === "finished" ? "done" : effectiveRootStatus({ ...agent, status: reportedStatus }, allTerminals);
      const childNeedsAttention = descendantsNeedAttention(descendants);
      const attentionStatus = childNeedsAttention || reportedStatus === "blocked" || reportedStatus === "error" ? "blocked" : liveStatus;
      const optimistic = this.optimisticStates.get(agent.address);
      const effective = labelsWithOptimisticState(agent.labels, optimistic);
      if (optimistic && effective.settled) this.optimisticStates.delete(agent.address);
      const triage = triageState({ ...agent, labels: effective.labels, status: attentionStatus }, descendants);
      return { ...agent, labels: effective.labels, descendants, liveStatus, triage, status: triage.displayStatus };
    });
    for (const agent of all) this.ensureTracked(agent, cx);
    const focusedAddress = focused()?.agent ?? focused()?.terminal;
    const focusedRootAddress = focusedAddress ? rootAgentAddress(focusedAddress, terminalByAddress) : null;
    const selectedRootAddress = focusedRootAddress;
    const selected = all.find((agent) => agent.address === selectedRootAddress) ?? null;
    const selectedAddress = focusedAddress;
    const subagents = selected ? this.subagentsFor(selected.address, allTerminals) : [];
    const grouped = new Map(SECTIONS.map((section) => [section.status, all.filter((agent) => agent.status === section.status)]));
    const ordered = SECTIONS.flatMap((section) => grouped.get(section.status));
    const sidebarContent = findLayout(layout(), "sidebar-content");
    if (!sidebarContent || sidebarContent.active === "inbox") {
      setAgentOrder(actionableAddresses(ordered));
    }

    const attention = all.filter((agent) => agent.triage.bucket === "to_handle").length;
    if (this.width !== null && this.width < 160) return this.compact(t, grouped, attention);

    for (const section of SECTIONS) {
      if (section.status === "working" || this.folded.has(section.status)) continue;
      for (const agent of grouped.get(section.status)) this.ensurePreview(agent, cx);
    }
    if (selected && selected.status !== "working") this.ensurePreview(selected, cx);

    const activeMachines = new Set(all.map((agent) => machineName(agent, bySpace))).size;
    const machineSummary = `${activeMachines} active machine${activeMachines === 1 ? "" : "s"}`;

    return v_flex()
      .id("orchestrator-inbox-root")
      .size_full()
      .bg(t.chrome)
      .on_size_change((size, cx) => {
        if (this.width !== size.width) {
          this.width = size.width;
          cx.notify();
        }
      })
      .child(
        v_flex()
          .px(12)
          .pt(11)
          .pb(10)
          .gap(4)
          .border_b(1)
          .border_color(t.border)
          .child(
            h_flex()
              .items_center()
              .child(
                h_flex()
                  .flex_1()
                  .gap(8)
                  .items_center()
                  .child(svg(`${ASSET}/archive.svg`).size(15).flex_none().text_color(t.muted))
                  .child(div().font_semibold().text_size(14).text_color(t.foreground).child("Inbox")),
              )
              .child(
                div()
                  .px(8)
                  .h(22)
                  .rounded(11)
                  .flex()
                  .items_center()
                  .text_size(11)
                  .font_semibold()
                  .text_color(attention ? t.blocked : t.muted)
                  .bg(attention ? `${t.blocked}20` : t.raised)
                  .child(String(attention)),
              ),
          )
          .child(
            h_flex()
              .gap(5)
              .pl(23)
              .text_size(10.5)
              .text_color(t.dim)
              .child(machineSummary)
              .when(unavailable.length > 0, (el) => el.child(`· ${unavailable.length} offline`)),
          ),
      )
      .child(
        v_flex()
          .flex_1()
          .overflow_y_scrollbar()
          .py(5)
          .when(Boolean(selected), (el) => el.child(this.currentSession(t, selected, subagents, bySpace, selectedAddress)))
          .children(SECTIONS.map((section) => this.section(t, section, grouped.get(section.status), bySpace))),
      );
  }
}
