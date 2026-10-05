---
name: digital-ambush
description: End-to-end prospect research, personalized demo-page creation, original image generation, HTML outreach composition, safe test delivery, and receipt verification for Entreprenuity Digital Ambush.
user-invocable: true
metadata:
  {"openclaw":{"requires":{"env":["OPENAI_API_KEY"]}}}
---

# Digital Ambush

Own the objective end to end. Diagnosis or a draft is not completion.

## Safety boundary
- Never contact a real prospect during an acceptance test. Deliver only to the monitoring recipient explicitly supplied by the Founder.
- Do not invent research, URLs, deployments, images, sends, or receipts.
- Respect robots/access controls, authentication, provider policy, and protected-action rules.
- Do not expose secrets in prompts, HTML, logs, URLs, commits, or receipts.

## Operating loop
1. **Discover.** Use current public web/browser evidence to find a commercially plausible prospect matching the requested geography/niche. Prefer a business with a real service, current trading evidence, and an identifiable website/marketing opportunity.
2. **Research.** Inspect the official website plus corroborating public sources where useful. Record only evidenced facts. Identify concrete conversion/UX/SEO/offer weaknesses and a specific opportunity. Do not manufacture personal details.
3. **Qualify.** Reject weak prospects. Explain the commercial reason for the selected prospect and the evidence.
4. **Build.** Create a prospect-specific Digital Ambush demo/landing page using the existing Entreprenuity web/deploy tooling. The page must be materially personalized, responsive, and contain no false claims. Deploy it to a real reachable URL.
5. **Visual.** Use OpenClaw's native `image_generate` tool with the configured image model/provider to create an original relevant visual when the objective requests imagery. Store/reference the generated artifact. Never substitute a scraped copyrighted image merely to satisfy the step.
6. **Email.** Compose polished responsive HTML outreach. It must be concise, specific to evidenced research, visually coherent, include the generated visual where technically supported, and link to the live personalized demo. Avoid deceptive urgency, fake testimonials, tracking tricks, or fabricated metrics.
7. **Deliver.** In test mode send only to the monitoring address in the objective, through an already-authorized mail tool/account. Never silently fall back to the prospect address.
8. **Verify.** Independently re-fetch the demo URL, verify the image artifact exists, verify the outbound send receipt/message id and recipient, and where mailbox tools permit verify receipt/rendering.
9. **Receipt.** Return a terminal receipt with prospect, sources, qualification, exact live URL, image artifact/receipt, email subject, recipient, send receipt/message id, and PASS/FAIL for every stage.

## Recovery law
Use the cheapest capable tool first. If a tool fails, diagnose the failure and use an authorized fallback when available. Do not repeat an unchanged failed action. Keep the same objective and receipts across retries.

## Completion gate
PASS requires all requested stages to have current receipts. A beautiful draft without a live URL or verified test send is FAIL/PARTIAL.
