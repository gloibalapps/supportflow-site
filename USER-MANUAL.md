# SupportFlow™: User Manual

Business admin for independent NDIS support workers.
*Covers version 21.*

---

## What this app is for

You work for yourself. You have an ABN, you invoice plan managers or
participants directly, and nobody takes tax out of your pay. This app handles
the paperwork around that: a calendar of your shifts, invoices with the right
NDIS codes, a running figure for the tax you'll owe, your kilometres, and your
service agreements.

**What it does not do.** It doesn't lodge anything with the ATO, prepare a BAS,
or replace an accountant. In your first year of working for yourself a
registered tax agent is usually worth the few hundred dollars, and the fee is
deductible.

**Your working records live on your device.** There is no SupportFlow cloud database or account sync. Encrypted backup copies are stored in the Google Drive or OneDrive account you connect during setup. That's why
backups matter, see [Backing up](#17-backing-up-important).

> **This manual is also inside the app.** Tap **?** in the fixed top header, then **Manual & Help**. The in-app version is written to tap through on a phone and follows the same order as this one.

### How this manual is laid out

It follows the order you'll actually meet things in the app:

| Part | Sections |
|---|---|
| **Getting started** | Installing · The first time you open it · First-time setup (five steps) · Finding your way around |
| **Work** tab | Shifts · Travel · Shift notes |
| **Money** tab | Invoices · Private clients · Payment tracker · Expenses · Tax · GST |
| **People** tab | Participants and plan managers · Service agreements · Incidents |
| **Your data and security** | Backing up · App lock · Licence · Settings |
| **Help** | If something looks wrong · Words you'll see · Sending feedback · Checking things yourself · Where the numbers come from |

---

## 1. Installing SupportFlow

SupportFlow is a Progressive Web App (PWA). You can use it in a browser, or install it so it opens like an app from your phone, tablet or computer. Installing it does not create a SupportFlow cloud account or move your working records to a SupportFlow server. Your records remain on that browser/app installation, with encrypted backups stored in the Google Drive account you connect.

### Android phone or tablet

1. Open **supportflow.work/app** in **Chrome**.
2. Open Chrome's menu.
3. Tap **Install app** or **Add to Home screen** (the wording depends on the device).
4. Confirm **Install**.
5. Open SupportFlow from the new icon on your Home screen.

### iPhone or iPad

1. Open **supportflow.work/app** in **Safari**.
2. Tap the **Share** button.
3. Choose **Add to Home Screen**.
4. Tap **Add**.
5. Open SupportFlow from the new icon on your Home screen.

### Windows PC

1. Open **supportflow.work/app** in **Chrome** or **Microsoft Edge**.
2. Use the **Install** icon in the address bar, or open the browser menu and choose the option to install the app.
3. Confirm **Install**.
4. SupportFlow opens in its own app window and can be pinned to Start or the taskbar.

### Mac

Open **supportflow.work/app** in a browser that offers web-app installation and use its **Install/Add to Dock** option. The exact wording depends on the browser and macOS version. You can also continue using SupportFlow in the browser without installing it.

> **Changing device?** Make sure you have a successful Google Drive or OneDrive backup before clearing the old device or browser. On the new installation, connect the same cloud account and restore the encrypted backup using the password that created it.

### Updating SupportFlow

When a newer SupportFlow version has downloaded, the app shows **A SupportFlow update is ready** with an **Update now** button. Tap **Update now** and SupportFlow reloads into the new version. You do not need to uninstall or reinstall the PWA.

Updating replaces the app code and cached app files; it does not intentionally delete your participants, shifts, invoices, expenses or other locally stored SupportFlow records. Keep Google Drive backups current before changing devices, clearing browser/app data or reinstalling. If you are offline, SupportFlow continues using the installed version until the newer version can be downloaded.

---

## 2. The first time you open it

You get a welcome screen, once, that explains the app in three lines and offers two ways in:

- **Start guided setup**: the five numbered steps in [First-time setup](#3-first-time-setup)
- **Try with demo data first**: see [Demo mode](#demo-mode) below

The manual is always available from the **?** in the top header if you'd rather read before you start.

Guided setup is **five numbered steps, in this order**: PIN, Backup, Details, Managers, Participants. None of them can be skipped, and all five must be finished before normal use.

### Demo mode

**Try with demo data first** loads a made-up business (Sam Taylor), three sample participants, shifts, trips and expenses so you can look at every screen before entering anything real.

- A banner across the top says **Demo mode — sample data** and has a **Start setup for real** button.
- Nothing in demo mode is real, and none of it is kept once you start your own setup: starting setup replaces the demo records.
- Features that use the AI assistant (Tidy this up, the deduction checker and similar) are switched off in demo mode and say so. Invoices raised in demo mode don't use any of your free invoice credits.

---

## 3. First-time setup

A row of numbered round steps (**PIN, Backup, Details, Managers, Participants**) stays pinned to the top of the screen as you scroll, with the current step highlighted and finished steps ticked, so you always know where you are. Anything outlined in **red** still needs you; it turns green with a tick when done. There's a **Read how it works first** button if you'd rather understand the app before filling anything in.

### Step 1 – PIN

Set a PIN (4 or 6 digits, entered twice) that locks the app, so participant details are protected from the very first record. **This step can't be skipped** in guided setup. Once it's set you can add fingerprint or face unlock as a shortcut. See [App lock](#18-app-lock).

### Step 2 – Backup

Your records live on this device only, so this step is your safety net. Three things have to happen before **Continue** unlocks:

1. Create your **backup password** and confirm it.
2. Save the **recovery code** you're shown, and tick **"I've saved my recovery code"**.
3. Connect **Google Drive or OneDrive**. The first encrypted backup must upload successfully.

See [Backing up](#17-backing-up-important) for how the password, the recovery code and restoring work.

### Step 3 – Your details

Name and **ABN** are required. They print on every invoice, and an invoice without an ABN isn't valid, whoever pays you may have to withhold 47%.

Add your bank details so they appear on invoices for payment.

> No ABN? Apply free at **abr.gov.au**. Never pay a website that offers to get
> one for you.

### Step 4 – Plan managers

Every plan management company you invoice:

- Company, contact person, **accounts email**
- **Payment terms in days** (required), this sets the due date on every invoice
 automatically. Type 14 and it confirms: *"Invoices will be due 14 days after
 the invoice date."*

Do this before participants so each one can be linked in a tap. If you deal with
none, use **"I don't deal with any"**.

Email addresses and phone numbers are checked as you type. A phone number must be a valid Australian mobile or landline, a 13/1300/1800 number, or an international number starting with **+**. If something doesn't look right, a message appears under the field and **Save** stays greyed out until it's fixed. The same checks apply when you add or edit a plan manager or a participant later.

### Step 5 – Participants

- Name and **NDIS number**, or tick **"Not an NDIS participant, private
 client"** if they're not, see [Private clients](#9-private-clients-non-ndis)
- **How their plan is managed**: decides who gets the invoice:
 - **Plan managed** → their plan manager is billed. Link them from the list.
 - **Self managed** → they pay you. Enter their payment terms.
 - **NDIA managed** → claimed through myplace. Enter their terms.
- **The item you usually bill them for**: new invoices open on this code. For
 a private client this is a free-text description and your own rate instead
- **Their area**: sets your travel time cap (30 minutes metro and regional
 centres, 60 regional, none remote)
- **Service agreement**: tick if signed. You can also do this later, and
 generate the document itself, from **People → Service agreements**, see [Service agreements](#15-service-agreements)

When all five are done you land on Home. Anything still missing is listed in the checklist on **Money → Tax**.

---

## 4. Finding your way around

SupportFlow has four fixed navigation areas at the bottom of every main screen:

| Area | What it does |
|---|---|
| **Home** | Your start page: totals at a glance (gross income for the year and the month, next shift, uninvoiced work, expenses, outstanding, tax estimate). Only **Next shift** and **Outstanding** open anything when tapped |
| **Work** | Opens the Work shortcut page: Shifts · Travel · Notes |
| **Money** | Opens the Money shortcut page: Invoices · Payment tracker · Expenses · Tax · BAS (when GST registered). The Payment tracker is an add-on: A$29 once on top of Basic, or included in Premium (A$129). See [Payment tracker](#10-payment-tracker-optional-add-on) |
| **People** | Opens the People shortcut page: Participants · Add participant · Plan managers · Service agreements · Incidents |

The **top header is fixed** as well. The **Light mode / Dark mode** pill, immediately left of **?**, switches the app between light and dark. Use **?** for Manual & Help, and use your profile initial at the top right for Settings and other account/device options. Until you use that pill, the app follows your phone's light or dark setting.

### Home

Home shows your numbers at a glance: gross income for the financial year (the large card) and for this month, your next shift, uninvoiced work, expenses this financial year, what's outstanding and your tax estimate.

Only two tiles are tappable: **Next shift** opens your shifts, and **Outstanding** opens the Payment tracker's view of who owes you. Every other tile is display only, so you can't open something by accident while scrolling. To do anything else, use **Work**, **Money** or **People** in the bottom bar.

The **eye icon** on the income card hides every dollar amount on Home (they show as dots) for when someone is looking over your shoulder. Tap it again to show them. The choice is remembered on that device.


### Work, Money and People shortcut pages

Tapping **Work**, **Money** or **People** in the fixed bottom bar first opens a clean shortcut page. Choose the feature you want from there. The shortcut page does not replace the feature itself and does not show your records until you open that feature.

Once you are inside a feature, use the small **Back to Work**, **Back to Money** or **Back to People** control near the top to return to that section's shortcuts. You can also use the fixed bottom navigation at any time to go straight to another main area.

Only the middle content scrolls; the main top header and bottom navigation remain available while you move through the app.

---

## 5. Shifts: the calendar

**Work → Shifts.** A month calendar. Use it for work you've done *and* work
coming up.

Tap **Add a shift**: participant, date, start, finish. The app works out which
NDIS support item applies and shows you why before you save:

> **Self-Care, saturday**
> 01_013_0107_1_1 · $103.54/hr
> *Delivered on a Saturday.*

### Scheduled, completed, cancelled

Every shift has a status, and **the app picks it from the date** so you rarely
touch the field:

- **Scheduled**: dated in the future. Shows on the calendar. **Not offered on
 an invoice**, so booking next Tuesday never prompts you to bill for it.
- **Completed**: dated today or earlier. Available to invoice.
- **Cancelled**: kept on the calendar as a record.

**If a past shift is still marked scheduled**, the calendar asks *"did this go
ahead?"* with a **Yes** button that confirms it in one tap. Money → Tax chases
it too. This is what stops work quietly falling out of your billing.

### Cancelled shifts

Mark it cancelled and record **the date they told you**. The app answers
immediately: under seven days notice it's claimable at up to 100%; seven days or
more it isn't. A claimable cancellation is billable the same as completed
work, on Money → Invoices, even though it's left out of the participant
totals on Work → Shifts.

It only applies if your service agreement covers cancellations and you couldn't
fill the time with other paid work.

### Your shifts, at a glance

Below the calendar, Work → Shifts groups everything by participant rather
than a long scrolling list. Each person gets two totals: **Completed**, hours
and an estimated dollar figure for work already done, and **Scheduled**, the
same for what's still coming up. The estimate uses whatever rate that
participant has set as their usual one, not the time-of-day classification an
actual invoice works out, so treat it as a guide rather than a figure to
invoice from. Cancelled shifts are left out of both totals. Tap a calendar
day instead to see that day's individual shifts.

### Reading the calendar

Dots under each day:

| Colour | Meaning |
|---|---|
| Grey | Scheduled |
| Amber | Past but still scheduled, needs confirming |
| Brass | Completed, not yet invoiced |
| Green | On an invoice |

### The time-of-day rules

- **Weekday daytime**: starts 6:00am or later, finishes by 8:00pm
- **Weekday evening**: starts 8:00pm or later
- **Weekday night**: starts before 6:00am, or runs past midnight
- **Saturday / Sunday / Public holiday**: by the day delivered
- **Sleepover**: crosses midnight, 8 hours or more, you can sleep

**A shift crossing 8:00pm** bills entirely at the evening rate, not split. The
app does this and reminds you the rules require discussing that with the
participant, so it belongs in your service agreement.

---

## 6. Travel

**Work → Travel.** Date, participant, and the distance, either typed directly
as kilometres or worked out from an odometer start and finish reading. Tick
**billable** if it should go on their invoice.

Those kilometres do two jobs: billed to the participant, **and** counted as a
tax deduction. Entered once.

**Travel time is a separate claim** from kilometres, same hourly rate as the
support, capped by the participant's area. Tick **billable** and a **travel
time** field appears on the trip itself, minutes, optional. It rides along
automatically once the trip is ticked for an invoice.

---

## 7. Shift notes

**Work → Notes.** Write about the shift in your own words, in one box. No
required structure to think about while you're writing it, just talk about
what happened.

### Tidy this up

Once you've written something, tap **Tidy this up**. This only appears if the
AI assist feature is switched on for your copy of the app — without it, save
straight from the one box, untidied, works exactly the same otherwise. It
sorts what you said into the five sections NDIS's own record-keeping guidance
points to for a support worker's case notes:

- **Support provided** — what you actually did
- **Participant involvement** — what they did, said or chose, not just "supported participant"
- **Progress toward goals** — how the session connects to what they're working toward
- **Observations** — factual, relevant, nothing beyond what you saw
- **Follow-up** — anything that needs to happen next time

**Whichever of the five your words actually covered gets filled in.** If you
didn't say anything that fits one of them, that section is left blank and
labelled **missing** in orange, rather than invented or silently dropped.

**What you do with a missing section is entirely your call.** Tap into it and
add a line yourself, or leave it and save the note exactly as it is. Nothing
about saving is blocked by a gap. The five-section structure is what NDIA's
guidance points to as best practice, not a rule this app enforces — you decide,
note by note, whether a gap needs filling or whether what you've already said
is enough.

**You can save without ever tidying at all.** A note saved straight from the
one box, untidied, is saved as plain text exactly as written. Tidying is there
to help sort it into the stronger structure, not a required step.

**Why the five-section structure matters, if you do use it.** The NDIS
Commission's own guidance is that case notes should describe what happened,
connect it to the participant's goals, and be complete enough to stand up on
their own. A note that just says *"took her shopping, went fine"* doesn't do
that. A structured note is the difference between something useful if a
payment assurance review ever asks to see your records, and something that
isn't.

> **Minimum requirements, and where each one already lives**
>
> The NDIA's own record-keeping rules say a support record needs, at minimum:
> the participant's name, their NDIS number, the date support was delivered,
> how long it ran, and what kind of support it was. None of that needs typing
> into the note itself:
>
> | Required | Where it already is |
> |---|---|
> | Participant's name | The participant you select for the note |
> | NDIS number | On their record, included automatically when you send a note with **name and NDIS number** switched on |
> | Date | Set on the note, defaults to today |
> | Hours / duration | On the matching shift, in Work → Shifts |
> | Support type | On the matching shift, or in the item you billed for |
>
> The note itself only needs to cover what actually happened, the identifying
> details are already being kept correctly elsewhere in the app.

**Editing an older note** opens exactly the same way a new note does — the
whole thing back in the one box, untidied. Tidy it again from there or save it
as it is, no special handling needed either way.

Mark the finished note:

- **Private**: your own observations, for your records
- **Shareable**: written plainly and factually, suitable for the participant,
 family or plan manager to read

**That mark is about how you've written it, not where it goes.** Ticking it
sends nothing. Notes stay on your device until you send one yourself.

### Sending a note

A shareable note gets a **Send this note** button.

**On a phone** you get your usual share sheet, WhatsApp, Telegram, Messages,
email, whatever you have installed. You can also email it straight to the
participant or their plan manager using the addresses on their records, or copy
the text.

**On a computer** the share sheet usually isn't available, so you'll see email
and copy.

**Nothing goes until you press send** in whichever app opens. Read it over
first.

### What gets sent

The note goes out as plain text: the date, the participant, your name, and what
you wrote, the five headings included as you filled them in.

There's a tick box for **whether to include their full name and NDIS number**:

| Setting | Use it when |
|---|---|
| **On** | Emailing a plan manager, they need both to match the note to the right person |
| **Off** | Sending through a messaging app, the note goes out with a first name only |

**This is personal information about someone else.** Send it only to people
entitled to see it, and check the participant is comfortable with how you're
sending it. Some plan managers require email or their own portal, and a
messaging app may not be acceptable to them.

### The record

Once sent, the note shows in green **when it went and to whom**. Where the app
knows the recipient, an email to a named plan manager, it records the name.
Where it can't know, because you picked the app yourself from the share sheet,
it says so honestly rather than guessing.

That record is the part that matters if anyone ever asks whether something was
passed on.

---

## 8. Invoices

Invoices are built by **ticking work**, not typed up on their own.

### Where it starts

**Money → Invoices**, in a **"Ready to bill"** panel. A finished shift not
yet billed shows a checkbox there. Tick the ones you want, a running total
shows for that participant, hours and dollars, and **Raise invoice** creates
it, already filled in. Ticking someone else's shift replaces the selection
rather than adding to it, a running total across two people wouldn't mean
anything. Work → Shifts stays a plain record, dates, times, status, nothing
about billing lives there.

**Work → Travel** works the same way, on its own screen: billable trips not
yet billed get a checkbox, a running total in kilometres and dollars, and
**Raise invoice**.

Each ticked shift becomes its **own line** on the invoice, its date, start and
finish time, and the correct support item code. Nothing is merged or
summarised, a plan manager reconciling the invoice can check every line
against a specific date.

A **short notice cancellation** can be ticked the same way, on Money →
Invoices alongside completed work. Mark the shift cancelled on Work → Shifts
first and record when it was booked and when they cancelled, the app tells
you straight away whether it's claimable.

**Money → Invoices** is also where you review what already exists, send it,
and track its status: a blue **Sent** tag once it's out, turning red and
reading **Overdue** if it passes its due date unpaid, or green once marked
**Paid**.

### Two safety nets

**Nothing bills twice.** Attached work vanishes from every other invoice's list,
its row turns green with the invoice number, and it locks against editing or
deletion until removed from that invoice.

**Nothing gets forgotten.** If the participant has completed shifts or billable
trips not on this invoice and not on any other, an amber warning appears before
you send: *"3 shifts and 1 trip left off this invoice."*

### Sending

- **Preview PDF**: opens the real, finished document before anyone else sees it
- **Share invoice**: sends the same PDF through Gmail, Outlook, Messages or whatever's installed

Sending marks it **Sent**. When the money arrives, open it and set **Paid**: 
the tax figure only counts paid invoices.

---

## 9. Private clients (non-NDIS)

SupportFlow isn't only for NDIS-funded work. A participant can be marked as a
**private client** — someone you support outside the NDIS, billed on your own
terms rather than against the NDIS price list.

### Setting one up

1. **Participants → Add participant** (or open an existing one to
 edit)
2. Tick **"Not an NDIS participant, private client"**
3. Their **NDIS number becomes optional** — the field disables and clears
4. In place of choosing an NDIS support item, enter:
 - **What do you usually bill them for** — free text, e.g. "Support work,
 hourly"
 - **Rate** — a plain dollar figure, yours to set
5. Everything else (plan manager, payment terms, service agreement) works the
 same as for an NDIS participant

The participant list shows **"Non-NDIS"** in place of an NDIS number, so it
reads as a deliberate choice rather than missing data.

### How this changes billing

- **Logging a shift**: the "Type of support" field is replaced with a note
 showing their description and rate, hours × rate, worked out as you type
 the start and finish time. No NDIS category applies, so none is asked for.
- **Invoices**: each shift bills at their own description and rate, not an
 NDIS item code. A short-notice cancellation is worded the same way.
- **Travel kilometres**: billed at the same rate you've set in **Settings →
 Vehicle**, just without the NDIS travel wording or code on their invoice.
- **Provider travel time**: this is an NDIS-specific claim (capped by area,
 under the pricing rules) and isn't generated for a private client. If your
 arrangement includes billing travel time, add that line to the invoice
 yourself.
- **Notes, agreements, tax and income totals** all work exactly the same as
 for any other participant — the difference is only in what an invoice line
 looks like and where the rate comes from.

### Changing your mind later

Ticking or unticking **"Not an NDIS participant"** on an existing participant
switches them between the two modes at any time, from **Participants → Participants → [their name]**. Past invoices already sent don't change, only new ones.

---

## 10. Payment tracker (optional add-on)

The Payment tracker lives at **Money → Payment tracker**. It shows who owes you, flags overdue invoices, and, if you switch it on, sends polite reminder emails to the payer at business day 7 and 12. At day 20 (day 15 for NDIA-managed) it prepares a complaint draft for you to review. Nothing is ever filed for you.

**What you see depends on your licence.**

- **Basic without the tracker:** a short card explaining what it does, with a single **Add Payment tracker · A$29 once** button. Signed out, it asks you to sign in first.
- **Premium, or Basic with the tracker:** the tracker page itself. It opens on the invoices that need action (it opens on **All** if nothing does). A panel shows whether reminders are **On** or **Off**, with a **Set up** button to change that. If there are no unpaid invoices it says so rather than showing an empty page. The **Patterns**, **Report** and **Settings** tabs each start with a short line saying what they're for.

### Pricing

- **A$29 once:** the Payment tracker, on top of Basic. It does not add a second device.
- **A$29 once:** a second device. This is a separate add-on from the tracker. Buy it from the upgrade screen or Settings → Licence & devices.
- **Premium, A$129 once:** everything in Basic (invoices, shifts, notes, kilometres, expenses and tax), a two-device licence and the Payment tracker. No subscription.

### How you're alerted

When a reminder goes out, you're told in two free ways:

- **Push notifications** to each device where you turned them on (see below).
- **An email to you**, at the address you entered under **Payment tracker → Settings**, if **Also email me when a reminder goes out** is ticked. The payer never receives this one.

SupportFlow does not send text messages.

### Setting up push notifications

Notifications are turned on **separately on each device**, from **Payment tracker → Settings → Turn on phone notifications**. Tap the button yourself, then choose **Allow** when asked.

**Android (Chrome):**
1. Open supportflow.work/app in Chrome. Use Chrome's menu → **Install app** (or **Add to Home screen**).
2. Open SupportFlow from its icon and sign in to the tracker.
3. Go to Payment tracker → Settings → **Turn on phone notifications**, then choose **Allow**.

**Windows or Mac (Chrome or Edge):**
1. Open supportflow.work/app and click the **install** icon in the address bar (or menu → Install SupportFlow / Apps → Install).
2. Open the installed app and sign in to the tracker.
3. Go to Payment tracker → Settings → **Turn on phone notifications**, then choose **Allow**.

**iPhone or iPad (iOS / iPadOS 16.4 or later):**
1. Open supportflow.work/app in **Safari**. Tap **Share → Add to Home Screen**, then **Add**.
2. Open SupportFlow **from the Home Screen icon**, not from Safari.
3. **Sign in again.** The Home Screen app is kept separate from Safari, so you need to sign in to the tracker there too.
4. Go to Payment tracker → Settings → **Turn on phone notifications**, then choose **Allow**.

### Checking or turning notifications back on

If you chose "Don't allow" or notifications stopped arriving:
- **Android:** Settings → Apps → SupportFlow (or Chrome) → Notifications → On. Also check that Do Not Disturb is off.
- **Windows:** Settings → System → Notifications → make sure notifications are on for Chrome/Edge or SupportFlow. In the browser, open the site settings (padlock icon) → Notifications → Allow.
- **Mac:** System Settings → Notifications → Google Chrome / Microsoft Edge / SupportFlow → Allow notifications. Also check Focus.
- **iPhone/iPad:** Settings → Notifications → SupportFlow → Allow Notifications. Also check Focus.

Then open the tracker and tap **Turn on phone notifications** again.

### Limits

- Push delivery **isn't guaranteed**. Battery saving, Do Not Disturb or Focus, being offline, or the phone or browser clearing old subscriptions can delay or drop a notification. Check the tracker regularly as well.
- On iPhone and iPad, notifications **don't work in a normal Safari tab**. They only work in the Home Screen app on iOS 16.4 or later.
- Turning notifications on applies to one device only. Turn them on on every device you want alerts on.
- If you remove the app or clear its data, turn notifications on again.

---

## 11. Expenses

**Money → Expenses → Add an expense.** Enter the date, category, what it was and the amount.

If you're registered for GST, two more fields appear: the **GST shown on the receipt**, and the **business-use percentage** (100 unless part of it was private, such as a phone bill). The app shows the potential GST credit as an estimate; not every business purchase is creditable.

Not sure whether something counts as a deduction? Type what it was and tap **Can I claim this?**, see [The deduction checker](#12-tax).

Expenses you log feed straight into the tax set-aside on **Money → Tax** and into the [Accountant pack](#12-tax).

---

## 12. Tax

**Money → Tax** shows **what to put aside**: current rates plus the Medicare
levy, on income less expenses and vehicle deduction, counting only **paid**
invoices.

The Tax screen shows how the figure is made up: income received, less your expenses and vehicle deduction, less the amount to set aside, leaving what is yours after expenses and tax. Your expenses are taken off **before** that "left over" figure, so it reflects what you actually keep.

> Open a second bank account and move that money across as you're paid. Finding
> it in October is much harder than setting it aside in July.

It looks small early in the year. That's right, the first $18,200 isn't taxed,
and the figure is year-to-date.

### Vehicle

Every logged trip counts at the ATO's cents-per-kilometre rate, up to 5,000 km a
year. That rate **already includes** fuel, servicing, registration, insurance
and depreciation, don't claim those separately as well.

Past 5,000 km the app tells you this method has stopped counting and the logbook
method would likely be worth more. That's an accountant conversation, before
year end.

Owning, leasing or hire-purchasing makes no difference under this method.

### Starting point for this year

Switched to SupportFlow partway through the financial year? Settings has a
**Starting point** panel under Tax. Add a rough total for what you'd already
earned, spent and driven before you started, three numbers, not individual
invoices.

It joins your tax set-aside figure for the current financial year only, so
the number reflects the whole year rather than just the part tracked in the
app. It never appears as an invoice, an expense, or against any participant,
and it stops counting on its own once the financial year rolls over, so it
can't accidentally carry into next year's figure.

### Accountant pack

**Money → Tax → Accountant pack.** Choose the financial year. It opens on the
current Australian year, 1 July to 30 June, and you can pick another year.
**Download PDF** saves the pack. **Print** prints that same PDF, not the rest
of the app.

Give it to your accountant. It has the figures from this app:

- Your business name, trading name if you set one, and ABN
- Income from invoices marked **Paid** (invoice date, invoice number, date paid, amount received, invoice total)
- Expenses by category (date, category, amount, GST on the receipt, business-use percentage)
- Vehicle kilometres and the cents-per-kilometre deduction, including the cap
- The tax set-aside estimate
- GST and BAS figures when the app already calculates them (BAS quarters only if you are registered for GST)

**It does not include participant or client personal information.** No names,
NDIS numbers, notes, incident details, addresses, contact details, plan manager
or payer names, or support descriptions. The words you typed on an expense are
left out as well, because they can name a person. Only the category is shown.

This is not the incident register. Incident records are not in the pack.

The PDF is created on this device. Check the figures before you rely on them.
It is a record of what you entered, not a tax return.

### The deduction checker

**Money → Tax → Claim check.** Type anything, "steel cap boots", "phone bill",
"travel between clients", and it returns a verdict, the reason in plain
English, how to apportion private use, and what evidence to keep. Repeats open
instantly.

### It only reads the ATO

The search is **restricted to ato.gov.au**. Not accounting blogs, not forums,
not other software companies, the ATO site and nothing else. That restriction
is enforced on the server, so it can't be talked around.

**The links underneath are the pages it actually opened**, taken from the search
itself rather than from the answer. A reference can't be invented, and a link to
anywhere other than the ATO is discarded before you see it.

**If nothing on the ATO site answers your question, it says so** instead of
reasoning it out. That doesn't mean you can't claim the thing, it means the
answer isn't on a page this can find, and it's worth asking a registered tax
agent rather than guessing.

It's a starting point, not a ruling. The links are there so you can check the
reasoning yourself, particularly on travel and clothing, where the rules are
narrow and easy to get wrong.

### There's a daily limit

**15 checks a day**, and 30 note tidies. Far more than a normal day of work.

Each check reads live pages from the ATO, which isn't free, so the limit stops
the cost running away. **Anything you've already asked opens instantly and
doesn't count**, the answers are kept on your device. The limit resets the next
day, and the app tells you when you're down to your last five.

> If you see *"the checker isn't switched on for this site yet"*, the person who
> set up your copy hasn't enabled it. Everything else works as normal, and
> **Manual & help → Sources** links to the ATO's occupation guides.

---

## 13. GST

Most NDIS supports are **GST-free**, so you don't add 10%. The trap:

**GST-free income still counts toward the $75,000 threshold.** Being GST-free
doesn't keep you under it.

The app tracks turnover over a **rolling 12 months**, warns at 80%, and tells
you once you're over, registration required within 21 days.

**Registering doesn't mean charging GST** on qualifying supports. They stay
GST-free with GST shown as $0.00. What changes: you lodge a BAS quarterly, and
you can claim back GST on fuel, phone and equipment, often money back to you.

Set your status in **Settings → GST**. Invoices change to match: "Tax invoice"
with a GST-free statement when registered, plain "Invoice" when not.

**Once registered, the Money shortcut page adds BAS**: a quarterly summary of what
you've invoiced and spent, built from records already entered, nothing typed
twice. Income is counted by **the date an invoice was paid**, in the quarter that date falls in, not the date it was issued (an invoice with no paid date falls back to its invoice date). It opens on whichever quarter actually has activity in it rather than
always defaulting to the current one. It's a worksheet to lodge from, not a
lodgement itself, the app doesn't submit anything to the ATO.

---

## 14. Participants and plan managers

**People → Participants** lists everyone you support. **Add participant** opens the same form used in setup, and tapping a person opens their record to edit. **People → Plan managers** is the same for plan management companies, including their payment terms, which set the due date on every invoice. Emails and phone numbers are checked as you type.

- **The due date is blank on an invoice:** the payer has no payment terms. Add them on their record.
- **An invoice says "No billing email":** the plan manager or participant has no email on file. Add it on their record.
- **Switching a participant to or from private client:** see [Private clients](#9-private-clients-non-ndis).

---

## 15. Service agreements

A written agreement is one of **four conditions** keeping your supports
GST-free. Miss one and a support may become taxable, you could owe 10% you
never charged. It's the condition most often skipped.

**Participants → Service agreements** lists everyone you support with their agreement status:

| Colour | Meaning |
|---|---|
| Amber, outlined | No agreement recorded |
| Green | Signed |
| Brass | Signed, review due within 30 days |

Warnings at the top name who's missing one and whose review is coming up, so you
don't have to scan the list.

### Two buttons per person

**Generate one** builds a PDF from what you've already entered, both parties,
ABN, NDIS number, plan management, rates, travel, payment terms, plus clauses
on cancellations, responsibilities, ending the agreement, GST and complaints,
with signature blocks at the end.

**Mark as signed** records it without leaving the screen, and fills today's date
if you haven't set one.

### Dates and details

**Dates and details** opens the participant's full record, where you set the
**date signed**, a **review date**, and **where the signed copy is kept**. Those
same fields also sit at the bottom of any participant's record in **Participants → Participants**.

A review falling within 30 days shows brass here and appears by name on the
checklist on Money → Tax.

It's a starting point, not legal advice. Have it looked over before the first
signing.

---

## 16. Incidents

Use **People → Incidents** to keep an incident register. Record the affected person, date/time, when you became aware, location, factual description, harm/impact, immediate actions, people involved or witnesses, participant support, follow-up and corrective/preventative actions.

Under **Settings → Business & invoice details**, set whether you are a registered NDIS provider. Registered-provider mode adds reportable-incident prompts using the current NDIS Commission categories and common notification timeframes. Most listed reportable incidents show a 24-hour timeframe; unauthorised restrictive practice shows five business days, with a 24-hour warning when harm is recorded. SupportFlow does not decide legal reportability and does not submit a report for you. Use the official Commission guidance/portal. If anyone is in immediate danger, call 000.

**Export register PDF** creates a local PDF summary. Incident records are stored locally with other SupportFlow records and are included in encrypted backups.

---

## 17. Backing up (important)

**Everything is on this device only.** Clear your browser data, lose the phone
or delete the app, and the records go.

### Every backup is encrypted

During onboarding you create **one backup password** and confirm it. That password protects every new SupportFlow backup until you deliberately change it. You do **not** need to type it again for each new backup on the same device.

SupportFlow does not keep the readable password and cannot recover or reset it. The device retains the derived encryption credential required to create later encrypted backups. Backup files are encrypted on the device with AES-256 before they are uploaded to the connected Google Drive.

### Your recovery code (if you forget the password)

As soon as you set the backup password, SupportFlow shows you a **recovery code**, a random code that looks like `ABCD-EFGH-JKLM-NPQR-STUV`.

- It opens your backups **instead of the password**. When you restore, the same box accepts either one.
- It is shown **once**. SupportFlow does not keep a copy and cannot show it to you again. Use **Copy** or **Save as file**, then store it in a password manager or write it down.
- Keep it **away from this device and away from where your backups are stored**. Anyone holding the code and a backup file can open that backup.
- You must tick **"I've saved my recovery code"** before setup continues.

**It works on backups made after the code was created.** The code is stored (still locked) inside each backup file, so a backup made *before* you had a recovery code can only be opened with the password that created it.

**Already set a backup password before recovery codes existed?** Go to **Settings → Backup**. It shows **Recovery code: Not set up** with a **Create recovery code** button. Every backup from then on carries it.

**Settings → Backup → New recovery code** replaces the code. The old one stops working for backups made from then on.

> **If you lose both the backup password and the recovery code, SupportFlow cannot recover your backups for you.** Keep both somewhere secure, away from the device.

If you change the backup password in **Settings → Backup**, you are given a **new recovery code** at the same time, and new backups use the new password and the new code. Existing backup files still require the password (or recovery code) that created them, so keep the old ones until you no longer need those backups.

### Backing up

Google Drive or OneDrive is connected during required onboarding. The first encrypted backup must succeed before onboarding can continue. After that, SupportFlow automatically backs up meaningful changes to the connected account. The saved backup password is used automatically to encrypt each backup before upload.

SupportFlow waits about five minutes after meaningful changes so several edits can be combined into one backup. If the device is offline, the backup remains pending and retries when SupportFlow is next opened online. The latest seven encrypted SupportFlow backups are retained. A PWA cannot reliably run while completely closed, so a pending backup completes when the app is next active and connected.

### Restoring

Tap **Restore**, choose the file, and enter the **backup password or the recovery code** for it.
Get it right and you'll see exactly what's in the file, how many
participants, invoices, and so on, and how many of your current records would
be overwritten, **before anything changes**. Get it wrong and it
tells you plainly rather than showing you gibberish. If the file is an older backup with no recovery code inside it, the message tells you that only its original password will open it.

An older, unencrypted backup file still opens, it doesn't ask for a
passphrase it never had.

### Automatic backups

**Settings → Backup** shows the Google Drive or OneDrive connection and the last successful backup. Automatic backup is the standard behaviour; there is no daily/weekly/fortnightly schedule to configure. After meaningful changes, SupportFlow waits about five minutes and uploads one encrypted backup. **Back up now** remains available for an immediate backup. While a backup is running, the button changes to **Backing up…** and additional backup attempts are blocked until that backup finishes, preventing duplicate Drive files from rapid taps or an overlapping automatic backup.

From the same panel you can change the connected cloud account, or disconnect it. Disconnecting stops automatic backups on that device but does not delete backup files already stored in your Drive. After changing accounts, use **Back up now** to create a fresh encrypted backup in the newly connected account.

A PWA cannot reliably run while it is completely closed, so a backup that is waiting completes the next time SupportFlow is open and online.

The panel always shows **when you last backed up** and **how many records you've
added since**, whether reminders are on or off.

**The ATO expects five years of records**, so regular backups are worth the few
seconds.

### Moving to a new phone or PC

1. On the old device, open **Settings → Backup → Back up now** and wait until the upload confirms. That backup is the only copy of your records.
2. On the new device, open **supportflow.work/app** in your browser, install it, and start setup.
3. When asked to restore, choose the backup file from your Google Drive or OneDrive and enter your **backup password** (or your **recovery code**).
4. Once you've confirmed the new device has everything, stop using the old one. Working on both makes the two copies diverge.

**What transfers:** everything in the encrypted backup: participants, shifts, invoices, service agreements, plan managers, incidents, expenses, trips and settings.

**What doesn't:** your backup password (nobody can recover it for you), your cloud-drive connection (reconnect it on the new device), your licence (it follows your purchase email: use **Restore licence** from the profile menu, see [Licence](#19-licence)), and any unsaved draft open at the time of the last backup.

---

## 18. App lock

**Settings → Lock the app**, near the top of Settings. Light and dark mode are the pill in the top header, immediately left of **?**, not a Settings panel.

The app asks for a **PIN before it opens**, 4 or 6 digits, your choice. You set it during [First-time setup](#3-first-time-setup) (step 1), and you can change or remove it here afterwards. Worth having if you use participant details on a phone that gets left on a bench or handed to someone else for a second.

**This is a screen lock, not encryption.** It stops someone picking up the
phone from casually opening the app, but the records underneath aren't
scrambled by it, your phone's own screen lock is still your first line of
defence, and a [backup](#17-backing-up-important) is the thing that's actually
encrypted.

### Setting it up

Choose 4 or 6 digits, enter the PIN twice, done. The PIN is scrambled before
it's stored, the app never keeps a plain copy of it to check against.

### Fingerprint or face unlock

If your phone and browser support it, **Add fingerprint or face** appears once
a PIN is set. It's offered as a shortcut every time you open the app, your PIN
still works as the fallback if it doesn't recognise you, and you can remove it
any time without losing your PIN. Some browsers or devices don't offer this to
web apps at all, the app tells you plainly rather than showing a broken
button.

### When it locks again

The app asks for the PIN again once SupportFlow has been **in the background for more than 10 minutes**. Switching to your mail app and straight back won't trigger it. It does **not** lock while the app stays open on screen.

### Locking it yourself

Don't want to wait? Tap your avatar, top right, and choose **Lock now**. It appears in that menu once a PIN is set, and locks the app immediately, useful for handing the phone to someone else on the spot.

### If you forget your PIN

**There's no way to reset it.** Nothing about it was sent anywhere that could
check who you are or issue a reset, so the only way back in is **clearing the
app and restoring from a backup**. The lock screen's "Forgotten your PIN?"
link walks you through this, but it means anything since your last backup is
gone.

That's the whole reason [regular backups](#17-backing-up-important) matter.

---

## 19. Licence

The app is free to try, with full access and nothing held back. Once the
free period ends, adding new invoices, shifts, trips, expenses, participants
and plan managers needs a paid SupportFlow licence. Everything you've
already entered stays visible, and you can still view, edit, back up and
export it either way.

Buy the licence from the prompt that appears when the free period ends, or
earlier from the profile menu.

### Plans and licenses

The pricing cards on the SupportFlow home page (supportflow.work, **Plans**)
show two one-off plans. There is no subscription on either plan.

- **Basic, A$79:** invoices, shifts, notes, kilometres, expenses and tax, on
  one device.
- **Second device, A$29:** a separate add-on if you want two devices. It is
  not included in Basic.
- **Premium, A$129:** everything in Basic, a two-device
  licence and the Payment tracker, paid once.

Your current plan and how many devices it covers are shown in the app under
**Settings → Licence & devices**.

### Upgrading from Basic

Next to **One license** on the Basic card there's an **Upgrade** button. It
opens SupportFlow in a **new tab** (supportflow.work/app?buy=upgrade):

1. If this device isn't signed in yet, sign in with the Google account you
   bought Basic with.
2. An **Upgrade SupportFlow** box appears. Choose the option you want:
   - **Add a second device, A$29:** your Basic licence then covers two
     devices. Only available on a one-device (Basic) licence. This is separate
     from the Payment tracker.
   - **Add Payment tracker, A$29:** adds the tracker to your Basic licence.
     It does not add a second device.

   Premium (A$129) is offered to people buying for the first time, not here:
   if you already own Basic you add the second device and the tracker
   separately, A$29 each.
3. You're taken to **Stripe Checkout** to pay. When payment finishes you come
   back to the app and the upgrade is applied automatically.

Tap **Not now** to close the box without buying anything. Basic owners can
also add a second device from **Settings → Licence & devices**.

### Restoring on a new device

Got a new phone, or reinstalled the app? You won't be asked to pay again. On
the licence prompt, tap **"Already have a licence on another device?"** and
enter the email you used at checkout. This device reconnects to the licence
you already own.

### What this doesn't affect

Nothing about the licence touches your records. They're still only ever on
your device, and buying a licence doesn't add a server-side copy of anything.

---

## 20. Settings

Every panel here is collapsed to just its heading, tap one to open it. Only
one stays open at a time, so a long list of settings doesn't stay a long
scroll of settings.

| Panel | For |
|---|---|
| **Lock the app** | PIN and biometric unlock, see [App lock](#18-app-lock) |
| **Business & invoice details** | Name, ABN, GST status, contact, these print on invoices |
| **Bank details** | BSB and account, these print on invoices for payment |
| **Starting point** | Optional prior income, expenses and km if you switched to SupportFlow partway through the year |
| **Backup** | Automatic encrypted Google Drive or OneDrive backup, Back up now, restore, change account or disconnect |
| **Vehicle** | How you hold the car, method, cents-per-km rate |
| **Support item rates** | Where codes came from, travel rate per km |
| **Records** | Run setup again, clear all records |
| **Manual & help** | This manual, the FAQ, official sources, SupportFlow Assistant and feedback |

GST status and turnover live inside **Business & invoice details**, rather
than their own panel.

**Privacy & security** is also available from Settings. It explains where your data is stored, cloud backups, information shared with other services, and links to the full public Privacy Policy and Terms of Use.

---

## 21. If something looks wrong

**A tax figure looks low.** Check the invoice is marked **Paid**: unpaid
invoices don't count. Check the date is inside the current financial year
(1 July – 30 June).

**A shift isn't offered on an invoice.** It's probably still **Scheduled**. Open
it and mark it Completed, or tap **Yes** when the calendar asks whether it went
ahead. A cancelled shift is only offered if it's a claimable short notice
cancellation, seven days notice or more isn't claimable at all.

**A shift or trip won't delete.** It's on an invoice. Remove it from that
invoice first. Deliberate: you can't delete work you've billed.

**The due date is blank.** The payer has no payment terms. Add them on their record under People.

**"No billing email".** The plan manager or participant has no email on file.

**Setup keeps nagging.** The checklist on Money → Tax names exactly what's missing, and
has a button straight to whatever needs doing.

**Can't find service agreements.** They have their own screen, **People → Service agreements**. The same fields also live at the bottom of each participant's
record.

**A private client's invoice shows an NDIS code, not their description.**
Check "Not an NDIS participant, private client" is actually ticked on their
record in **People → Participants**, not just entered as a rate without the
tick. Only ticking it switches how they're billed.

**Asking for a PIN unexpectedly.** It locks itself again after more than 10 minutes
in the background, that's normal, not a fault. If you've genuinely forgotten
the PIN, see [App lock](#18-app-lock), there's no reset, only clearing the
device and restoring from a backup.

**It's asking me to buy a licence.** Your free period has ended. Everything
already entered is still there to view, edit, back up and export. Adding new
records needs a licence. Already bought one on another device? Use
**"Already have a licence on another device?"** rather than buying again, see
[Licence](#19-licence).

---

## 22. Words you'll see

**ABN**: Australian Business Number. Says you work for yourself.

**Sole trader**: you are the business. Your own tax file number, no company.

**Plan manager**: company handling a participant's NDIS money and paying your
invoices.

**Private client**: a participant marked **not an NDIS participant**, see
[Private clients](#9-private-clients-non-ndis). Billed on a description and
rate you set yourself, not an NDIS item.

**Support item number**: the NDIS code for a kind of support, like
01_011_0107_1_1. Each has a maximum price.

**Set-aside**: money kept back for the tax bill, because nobody withholds it.

**GST-free**: no 10% added. Most NDIS supports are.

**BAS**: business Activity Statement. Short quarterly form, once registered.

**Deduction**: a work expense that reduces the income you're taxed on.

**PIN lock**: an optional code asked for before the app opens, see
[App lock](#18-app-lock). Not the same as encryption.

**Trial**: the period you can use the full app free, before a licence is
needed to keep adding new records.

---

## 23. Sending feedback

Blunt feedback is more useful than polite feedback.

**Manual & help → Support.** One box: **"What went wrong?"** — what you were
doing, what you expected, and what happened instead. Even one line helps.

**Describe it without naming a participant.** A reminder sits right under the
box: say "the participant I logged a shift for" rather than who they actually
are, since the message isn't otherwise restricted in what it could contain.

### What actually gets sent

**Nothing sends by itself.** Once you've written something, two buttons appear:

- **Email support**: opens your mail app addressed to
 **globalappsai@gmail.com**, subject "Support NDIS", with everything filled
 in. You still press send yourself.
- **Copy**: puts it on the clipboard to paste wherever instead.

Alongside what you wrote, it automatically includes your name, email and
phone if you've entered them, the app version, your device and browser, and
**counts** of your records, six participants, twelve shifts, and so on — so a
reply doesn't depend on your own mail app being signed into an address that
says who you are. It never includes a participant's name, NDIS number, or
anything else about them.

---

## 24. Checking things yourself

**Manual & help → Official sources** links straight to the places the figures
and rules come from:

| Link | What it's for |
|---|---|
| **NDIS pricing updates** | Current prices, and every change with its effective date |
| **NDIA newsletters** | Subscribe to the monthly Provider newsletter and hear about changes as they happen |
| **NDIS Commission** | Worker screening, practice alerts, complaints, 1800 035 544 |
| **ATO occupation guides** | What community support and care workers can claim |
| **Australian Business Register** | Apply for or check an ABN. Free, never pay a site that offers to do it |

This app is a convenience, not an authority. When something matters, check the
source.

### When the rates go out of date

Prices change every **1 July**, and sometimes mid-year, the NDIA has committed
to giving earlier notice of changes, so it isn't only an annual event.

The app records when its figures were last checked against the published
schedule. Once that's more than a year old, it says so plainly, on the Money → Tax
screen and in **Settings → Support item rates**: rather than quietly looking
current.

**If you see that warning**, check the pricing updates page before you invoice.
SupportFlow app updates are delivered through the PWA update process. NDIS pricing data still needs to be checked against the current official pricing information when the app warns that its stored pricing may be out of date.

---

## Where the numbers come from

Codes and prices: **NDIS Pricing Schedule 2026-27**, National column, effective
1 July 2026, last verified 8 August 2026. Billing rules, time of day,
cancellations, travel: **Pricing Arrangements and Price Limits 2025-26**, the
most recent published rules.

---

*General information only. Not tax, legal or financial advice. Check anything
that matters against the source, or with a registered tax agent.*

---

**SupportFlow™** · © 2026 SupportFlow. All rights reserved.

SupportFlow is an independent software product and is not affiliated with, endorsed by, or operated by the NDIA or NDIS.
