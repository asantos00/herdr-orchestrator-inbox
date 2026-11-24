import { INBOX_LABEL } from "./inbox-state.mjs";

export const OPTIMISTIC_TTL_MS = 15000;

export function labelsWithOptimisticState(labels, optimistic, now = Date.now()) {
  if (!optimistic) return { labels: labels ?? {}, settled: false };
  const remote = labels?.[INBOX_LABEL];
  if (remote === optimistic.raw) return { labels: labels ?? {}, settled: true };
  if (now - optimistic.at >= OPTIMISTIC_TTL_MS) return { labels: labels ?? {}, settled: true };
  return {
    labels: { ...(labels ?? {}), [INBOX_LABEL]: optimistic.raw },
    settled: false,
  };
}

export function actionMessage(type, until = null, now = Date.now()) {
  if (type === "reviewed") return "Marked reviewed";
  if (type === "acknowledged") return "Acknowledged";
  if (type === "snoozed" && Number.isFinite(until)) {
    const minutes = Math.max(1, Math.round((until - now) / 60000));
    return `Snoozed for ${minutes} minute${minutes === 1 ? "" : "s"}`;
  }
  return "Inbox updated";
}
