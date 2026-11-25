const REVIEW_LINE_LIMIT = 60;
const FOOTER_SCAN_LINES = 12;

function cleanTerminalText(value) {
  return (value ?? "")
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-?]*[ -\/]*[@-~]/g, "")
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "")
    .replace(/\r/g, "");
}

function withoutShellFooter(value) {
  const lines = value.split("\n");
  const start = Math.max(0, lines.length - FOOTER_SCAN_LINES);
  for (let index = start; index < lines.length; index += 1) {
    if (!/^\s*[─━═╌╍┄┅┈┉_-]{10,}\s*$/.test(lines[index])) continue;
    const tail = lines.slice(index + 1).join("\n");
    if (/zsh: warning:|(?:^|\n)\s*[~\/]\S.*\([^\n)]*\)|(?:^|\n)\s*[↑↓].*\bCH\d/i.test(tail)) {
      return lines.slice(0, index).join("\n").trimEnd();
    }
  }
  return value.trimEnd();
}

function finalResult(value) {
  const lines = value.split("\n");
  let marker = -1;
  for (let index = 0; index < lines.length; index += 1) {
    if (/^\s*Thinking(?:\.{3}|…)?\s*$/i.test(lines[index])) marker = index;
  }
  const result = marker >= 0 ? lines.slice(marker + 1) : lines.slice(-REVIEW_LINE_LIMIT);
  return result.slice(-REVIEW_LINE_LIMIT).join("\n").trim();
}

function escapeHtml(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export function retainedTranscript(value) {
  const full = withoutShellFooter(cleanTerminalText(value)).trim();
  const review = finalResult(full) || full.split("\n").slice(-REVIEW_LINE_LIMIT).join("\n").trim();
  return {
    review,
    full,
    reviewHtml: escapeHtml(review),
    fullHtml: escapeHtml(full),
  };
}
