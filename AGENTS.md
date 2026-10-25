# Shadow Live — repository-wide instructions for coding agents

Applies to the **entire repository**, across Flutter, Cloudflare Workers, Firebase/Firestore, R2, Shadow Control, tests, build tools and documentation.

## Reuse first — mandatory engineering gate
Read [docs/REUSE_FIRST_ENGINEERING_STANDARD.md](docs/REUSE_FIRST_ENGINEERING_STANDARD.md) before implementing or reviewing a change.

- **Before coding:** perform a narrow, targeted search for an existing module, shared helper or service that already implements the same behavior. Do not duplicate it.
- **When behavior is genuinely shared:** use the existing tested abstraction. If two or more consumers actually need the same invariant, extract a small stable module with a documented contract; preserve tests for every consumer.
- **When behavior is domain-specific:** keep it owned by that domain. **Do not couple unrelated systems, generalize security policies, or add speculative abstractions** merely to make all work look reusable.
- Separate reusable mechanics from business authorization and policy. In particular, moderation/evidence, wallet/gift settlement, R2 storage ownership, user deletion and agency/room transfers each require their own server-side checks. A shared helper is **never** a permission grant.
- For every PR or subtask explicitly record a reuse decision: **reused / extracted / intentionally domain-specific**, with impacted consumers and test evidence. Include it in the PR description and update the **existing** relevant Trello card; avoid duplicate cards.
- Maintain bounded indexed Firestore queries, scoped R2 access, low-I/O patterns and existing privacy/retention safeguards. No broad scans, unnecessary polling or listeners.
- Preserve existing behavior and integration regressions, pass tests/CI on the exact commit, and verify deployments before reporting success.

## Non-negotiable project guardrails
- Do not reimplement merged work or touch unrelated/frozen work; in particular **do not edit frozen PR #348**.
- **Only GitHub Pages** hosts static web and Shadow Control UI; **only Cloudflare Workers** hosts APIs. Keep those approved deployment targets unchanged.
- Never activate live account erasure, R2 deletion, financial/Play chargeback settlement, legal/evidence disposal or Firebase Auth deletion merely because reusable code or a test exists; preserve `destructiveAllowed:false` until independent approvals and end-to-end verification are complete.
- Do not rebuild APK on every edit. Keep review and CI batches focused.

The reuse-first rule applies to **every future task**, not only account deletion. This file supplies agent guidance; human PR reviews and tests remain necessary.
