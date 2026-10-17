# Shadow Live private 1:1 calls — pricing rollout contract

**Release state: FREE by default, private calls OFF.** This page documents a
configuration-only preparation. It does NOT implement a Coin debit, receipt,
refund or a paid-call product. Do not advertise paid calls to users.

## Shadow Control

Existing authenticated `/api/private-voice-control` updates
`system_config/messaging` transactionally and audits all changes.

- `privateCallPricingMode`: `free` (default) or `paid` (saved draft).
- `privateCallPriceCoins`: integer in 0..1,000,000; paid draft requires >=1.
- `voiceControlVersion`: optimistic lock; `idempotencyKey`: replay protection.
- The Arabic Control screen can prepare a paid tariff **only while calls OFF**.
- A legacy admin client that sends only the existing booleans preserves the
  stored mode and price rather than resetting the tariff.
- `paidCallsLaunchReady` is explicitly false in server responses; there is
  no environment variable override or direct paid enable path.
- The existing central mutual-follow call policy rejects `paid` even if the
  Firestore `privateCallsEnabled` flag is edited outside Control.
- Free mode still requires the two server-controlled media + push readiness
  flags and an explicit approved Control enable.

## Prerequisites before ANY real paid activation

Decide the chargeable event (accepted call, billed duration or another model),
who pays, cancellations, refunds, balance insufficiency and price visibility.
Implement **one atomic Firestore transaction** with a unique call-based receipt,
balance update and `financial_ledger` record, preserving the existing wallet
emergency lock and ensuring retries cannot double charge. Test concurrent
accept/finish, failure after response loss, rate/price changes during an
invitation, account changes, blocks, insufficient balance, and no charge on
missed/rejected calls. Show the final price and obtain explicit user consent
before spending. Retain emergency OFF and do not enable billing or push until
real Android/PWA two-device tests are signed off.

Approval/testing tracker: https://trello.com/c/PmCt10u2
Field acceptance: https://trello.com/c/z0zPEz0j

No Vercel. Deploy only to GitHub Pages + current Cloudflare Worker.
