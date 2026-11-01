/**
 * An HTTP 200 response from an agent proves it answered, not that it
 * accomplished the Founder's objective. Require explicit terminal outcome.
 */
export function classifyNeoBusReply(responseText) {
  const body = String(responseText ?? "").trim();
  if (!body) return "BLOCKED";
  const marker = /(?:^|\n)\s*(?:>\s*)?(?:\*\*)?(?:FINAL\s+STATUS|STATUS)(?:\*\*)?\s*:\s*(?:\*\*)?\s*(COMPLETED|DONE|BLOCKED|FAILED|WAITING_HUMAN)\b/gi;
  const matches = Array.from(body.matchAll(marker));
  const declared = matches.length ? matches[matches.length - 1][1].toUpperCase() : null;
  if (declared === "FAILED") return "FAILED";
  if (declared === "BLOCKED" || declared === "WAITING_HUMAN") return "BLOCKED";
  if (declared !== "COMPLETED" && declared !== "DONE") return "BLOCKED";
  const receipt = /\b(?:receipt[_\s-]?id|verification[_\s-]?receipt|test[_\s-]?exit[_\s-]?code)\s*[:=]\s*[\w./:#-]{4,}/i;
  return receipt.test(body) ? "COMPLETED" : "BLOCKED";
}
