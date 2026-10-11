# Data & Security: SupportFlow™

*Last updated: 18 August 2026*

## Your records stay on your device

SupportFlow™ uses a local-first approach to participant and business records.

Your participants, shifts, notes, invoices, expenses and other operational records are stored locally on your device using the app's local data storage.

SupportFlow does not operate a central developer database containing these records.

Under normal operation, the developer cannot view your locally stored participant records.

## App protection

SupportFlow provides an optional PIN lock and, where supported, biometric authentication such as fingerprint or facial recognition.

Your PIN is hashed using PBKDF2 before storage and is not stored in plain text.

These features protect **access to SupportFlow**.

They do not independently encrypt all records stored locally by the app.

## Local data

In the current version, SupportFlow's locally stored operational records are not independently encrypted at rest by the app.

SupportFlow therefore also relies on the security protections provided by your phone, tablet or computer.

For this reason, we strongly recommend that you:

- Use a strong device PIN, password or biometric lock
- Keep your device's operating system updated
- Do not share your SupportFlow PIN
- Do not leave an unlocked device unattended
- Enable remote device location, locking or wiping where available
- Regularly create encrypted SupportFlow backups

## Encrypted backups

When you create a protected SupportFlow backup, the backup file is encrypted on your device using AES-256 before it is exported.

The backup is protected using a passphrase that you choose.

The developer does not receive or store your passphrase and cannot recover it.

**If you lose the passphrase, the encrypted backup cannot be recovered by the developer.**

Keep your passphrase somewhere secure and separate from the device containing your SupportFlow records.




Claimable is designed not to read or automatically include participant records stored elsewhere in SupportFlow.

**Do not enter participant names, NDIS numbers, health information or other personal information into Claimable.**


## Development assistance


No real participant records, real support-worker business records or production user information were intentionally supplied during that development process. Fictional and example information was used for testing and demonstration.


## No central participant database

SupportFlow's local-first architecture means the developer does not maintain a central database containing all users' participant records.

This reduces the amount of sensitive participant information centrally held by SupportFlow.

It does not remove the need to secure your own device.

## Hosting

The SupportFlow application is hosted using Netlify.

Your device communicates with Netlify to load and operate the web application. Normal technical web-hosting information may therefore be processed by Netlify.

Your locally stored participant records are not intentionally uploaded to Netlify simply because SupportFlow is hosted there.

## Sharing information

Information can leave your device when **you choose to export, back up, email or share it**, or when you intentionally submit a question through Claimable.

Once you send information to another person or service, its security may also depend on the recipient and service you selected.

Always check the recipient before sending participant information and share only what is reasonably necessary.

## If your device is lost or stolen

If a device containing SupportFlow records is lost, stolen or compromised:

1. Lock or remotely secure the device if possible.
2. Consider remotely erasing it where appropriate.
3. Change relevant device or account passwords if necessary.
4. Consider what participant information may have been accessible.
5. Assess whether you have any notification or reporting obligations.

## Reporting a security concern

If you discover a security issue involving SupportFlow itself, please contact:

**globalappsai@gmail.com**

Do not include participant names, NDIS numbers, health information or other unnecessary participant information when reporting a technical problem.



## Early Access tester activity telemetry

During the Early Access testing program, SupportFlow records limited tester/app activity metadata so the developer can tell whether a tester is actively evaluating the app and which major areas have been tried. This may include app-open activity, active days, app version, broad device type, and use of major sections such as Shifts, Notes, Travel, Invoices, Expenses, Tax and Help, plus metadata that a record was created or feedback was submitted.

This telemetry does **not** include participant names, NDIS numbers, progress-note text, invoice contents, addresses, financial amounts, service details or other participant/client record content. Tester activity is used only to administer the Early Access program, assess feature coverage and improve SupportFlow. Tester telemetry will be reviewed at public launch; tester-specific monitoring will be removed or replaced by the production analytics disclosure that matches what the released product actually collects.



### Full restore
Current backups include business and invoice details, bank/payment details, operational records, settings stored in the main data profile, and the portable PIN hash/salt. On restore these profile fields are merged explicitly so blank defaults cannot overwrite restored business or banking values. Biometric/WebAuthn credentials are not portable between devices and must be enabled again after restore. Backups created before the full-restore fix may not contain PIN security state.


## Incident records

Incident records are treated as working records within SupportFlow. They remain stored locally on the device and are included in encrypted Google Drive backups when backup is enabled. SupportFlow does not automatically transmit incident descriptions or participant incident content to the NDIS Commission or another authority. Registered-provider reporting prompts are calculated locally from the incident details entered by the user.
