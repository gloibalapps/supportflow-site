# SupportFlow pricing

**One-off. No subscription.**

New accounts receive **5 free invoices for 30 days**.

| Option | Price (AUD) | Licences |
|---|---:|---:|
| Basic | A$79 once | 1 |
| Extra (second) device (add-on, separate from late payment fees) | A$29 once | 2 |
| Late payment fees (add-on, on top of Basic; internal id `tracker`) | A$29 once | The devices the licence already covers |
| Premium | A$129 once. | 2, and late payment fees |

There is no subscription and no SMS add-on.

Basic checkout is unchanged.

---

Older credit-pack pricing (Build 27, legacy):

# SupportFlow pricing — Build 27

**No monthly subscription. No monthly fees. Pay only when you invoice.**

New accounts received **5 free invoice credits**.

| Pack | Price (AUD) | Invoice credits |
|---|---:|---:|
| Casual | $7.99 | 10 |
| Most Popular | $19.99 | 30 |
| Best Value | $39.99 | 100 |

Credits are valid for 30 days. Buying more credits while your window is open adds them to your balance and resets the 30-day window; once credits expire, a new purchase starts a fresh balance and a new 30-day window. Creating, editing and previewing drafts is free. One credit is consumed when an invoice is finalised. A 24-hour correction rule is reserved for accidental finalisation so a genuine correction does not unfairly consume another credit.

SupportFlow Pro remains separate from invoice-volume credits and is reserved for advanced business dashboards, reporting, exports and analytics.

**Implementation note:** paid credits must only be added after server-side payment confirmation. The browser/client must never be trusted to grant paid credits.
