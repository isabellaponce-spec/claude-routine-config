# Zuora daily sync routine — standing amendments

These rules override or extend the base system prompt for every run.

## ETA window
Use `today + 8 days` (not +7) as the window cutoff so items due on the 8th calendar day are caught.

## Exclude integration wave items
From both the Workplan and OQT tracker sections, skip any row whose Name/Item describes a wave of gateway/payment-method integrations. Drop rows matching patterns like:
- "Wave 1", "Wave 2", "Wave 3", "Wave 4" (any wave number)
- "Specialty acquirers", "Direct-debit rails portfolio", "Wallets and digital payments", "Regional and local payment methods"

These are handled internally by the Integrations team and should never appear in the Slack summary.

## Workplan owner filter
The Workplan CSV may list Owner as "Zuora" for items that are actually joint or Yuno-led. Trust the sheet going forward but flag any item with Owner = "Zuora" that appears to be a Yuno deliverable (the team will keep the sheet accurate).
