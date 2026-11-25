import test from "node:test";
import assert from "node:assert/strict";
import { retainedTranscript } from "./retained-transcript.mjs";

const footer = `
──────────────────────────────────────────────────────────
zsh: warning: 1 jobs SIGHUPed
──────────────────────────────────────────────────────────
~/dev/project (main)
↑2.0M ↓386k R155M CH99.6% $77.650 (sub) 24.4%/272k (auto)`;

test("shows the final Pi result instead of preceding tool output", () => {
  const transcript = `
 $ gh run watch 123 --exit-status

 Run CI has completed with 'success'

 Took 1.1s

 Thinking...

 Published the synthetic screenshot gallery:

 https://example.com/gallery

 - All four root queue states
 - Retained transcript review

 CI passed.
${footer}`;

  const result = retainedTranscript(transcript);

  assert.equal(
    result.review,
    "Published the synthetic screenshot gallery:\n\n https://example.com/gallery\n\n - All four root queue states\n - Retained transcript review\n\n CI passed.",
  );
  assert.doesNotMatch(result.review, /gh run|Thinking|SIGHUPed|CH99/);
  assert.match(result.full, /gh run watch/);
  assert.doesNotMatch(result.full, /SIGHUPed|CH99/);
});

test("falls back to a bounded tail when no final-result marker exists", () => {
  const transcript = Array.from({ length: 90 }, (_, index) => `line ${index + 1}`).join("\n") + footer;

  const result = retainedTranscript(transcript);

  assert.doesNotMatch(result.review, /line 1\b|line 30\b/);
  assert.match(result.review, /^line 31\n/);
  assert.match(result.review, /line 90$/);
  assert.equal(result.review.split("\n").length, 60);
});

test("escapes terminal text before rendering it as HTML", () => {
  const result = retainedTranscript("Thinking...\n\n<script>alert('x')</script> & done");

  assert.equal(result.reviewHtml, "&lt;script&gt;alert('x')&lt;/script&gt; &amp; done");
  assert.equal(result.fullHtml, "Thinking...\n\n&lt;script&gt;alert('x')&lt;/script&gt; &amp; done");
});
