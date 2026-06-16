# EMAIL_CHANNEL_DISCOVERY_20260528_002

Owner: Rob / Entreprenuity Web Design
To: Neil / AG / Kerry / OpenClaw
Priority: P0

Rob is driving. Do not ask Rob to manually send emails or relay secrets through Telegram.

## Mission

Find whether an approved email sending route already exists locally for the Entreprenuity email account. If a safe route exists, prepare configuration for Rob review. If none exists, return the single easiest owner action needed.

## Hard boundary

Do not send prospect emails from this command.
Do not send test emails until Rob explicitly confirms the channel/setup step.
Do not ask Rob to paste secrets into Telegram, GitHub, ChatGPT, or logs.
Do not print secrets.
Do not commit secrets.

## Discovery checklist

Check for existing approved routes:
- Gmail OAuth token
- Google Workspace/Gmail API token
- SMTP env variables
- SendGrid or Mailgun env variables
- existing OpenClaw email plugin
- existing Entreprenuity website backend mail provider

Print only YES/NO and variable names. Do not print values.

## If route is found

Return:
- route_type
- where it is configured
- whether it can send from the Entreprenuity address
- config diff needed with secrets redacted
- safest test-email plan to Rob only

## If no route is found

Return:
BLOCKED_EMAIL_ROUTE_NEEDS_ONE_OWNER_ACTION

Pick the single fastest safe action:
- Gmail App Password
or
- Gmail OAuth login on PC
or
- SendGrid API key

Do not list ten options. Pick one.

## Current lead state

- 28 verified direct-email leads ready.
- Send-ready files exist.
- No prospect outreach until the email channel is proven with Rob-only test.

## Required receipt

EMAIL_CHANNEL_DISCOVERY_RECEIPT

final_status: READY_FOR_NEWTON_REVIEW / PARTIAL / BLOCKED / FAIL
existing_email_route_found YES/NO:
route_type:
email_channel_ready_for_test YES/NO:
verified_leads_ready:
secrets_printed NO:
credentials_committed NO:
prospect_emails_sent NO:
blocker:
one_action_needed_from_Rob:
final sentence: Neil/AG/Kerry does not claim PASS.
