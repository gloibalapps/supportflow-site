# Privacy Policy: SupportFlow™

*Last updated: 18 August 2026*

## The short version

Your SupportFlow records stay on your device by default. There is no SupportFlow user account and no central database operated by the developer that stores your participant records, shift notes, invoices or other work records.

SupportFlow™ is hosted using Netlify. When you access the app, Netlify may process ordinary technical information required to deliver and secure the app, such as your IP address, browser or device information and web requests. Your participant records are not intentionally sent to Netlify as part of storing or managing them in SupportFlow.


Other optional actions, such as creating a backup, sharing a shift note or contacting support, can also cause information to leave your device. These are explained below and occur when you choose to use them.

This short version is an overview. The full policy below explains how information is handled.

---

## 1. Who this policy covers

This policy covers SupportFlow™ (the app), provided by its developer, contactable at **support@supportflow.work**.

It applies whether you use the app on a phone, tablet or desktop browser, and whether you are using a production release or authorised testing build.

SupportFlow™ is designed for support workers, including sole traders, who may record information about NDIS participants.

As the support worker entering information into the app, you remain responsible for ensuring that you are authorised to collect, store, use and disclose the participant information you enter into SupportFlow, including under any applicable consent, service agreement or other authority.

This policy explains how SupportFlow handles information. It does not establish or replace your own authority or legal obligations concerning participant information.

Because SupportFlow may be used to record sensitive and health-related information, the app has been designed with the standards of the Australian Privacy Principles (APPs) under the *Privacy Act 1988* (Cth) in mind.

The privacy obligations applying to an individual support worker or business depend on their particular circumstances.

<!-- BETA TESTING NOTICE: REMOVE WHEN BETA TESTING ENDS -->
### Beta testing privacy rule

During beta testing, use fictional or dummy participant details when you are testing SupportFlow. Real participant information is not required to participate in the beta.

If you choose to use SupportFlow as part of your normal support work with real participant information, you remain responsible for ensuring you have the appropriate authority or consent to collect, record, store, use and disclose that information.
<!-- END BETA TESTING NOTICE -->

## 2. Information you may store in SupportFlow

### About you

Information you enter about yourself may include:

- Your name
- ABN
- Contact details
- Bank details used for invoicing
- GST settings
- Business settings
- Vehicle and travel settings

### About participants

Information you enter about participants may include:

- Name
- NDIS number
- Plan management type
- Contact information
- Support information
- Shift notes
- Service agreement information

Shift notes and other records may contain sensitive or health-related information concerning a participant's disability, circumstances or support needs.

### About plan managers

Information may include:

- Organisation or company name
- Contact person's name
- Billing email
- Other billing information you enter

### Records of your work

SupportFlow may store records including:

- Shifts
- Timesheets
- Travel
- Invoices
- Expenses
- Service agreements
- Notes and other records you create
- Incident records, including factual incident descriptions, immediate actions, follow-up and corrective actions

## 3. Where your SupportFlow records are stored

Your SupportFlow records are stored **locally on your device using the app's local data storage**.

There is:

- No SupportFlow user account required to hold these records
- No central participant database operated by the developer
- No routine upload of participant records to the developer

Under normal operation, the developer cannot view your locally stored participant records, shifts, invoices, expenses or notes.

This local-first design is intentional and is intended to reduce unnecessary central collection of participant information.

SupportFlow does not operate a central participant-record database or account synchronisation service. During onboarding, you choose one cloud account for encrypted backups: Google Drive, Dropbox, or OneDrive. SupportFlow encrypts the backup on the device before upload. The provider stores the encrypted file. The backup password and the recovery key are not sent with the file. SupportFlow cannot decrypt a backup for you. You can reset the backup password yourself with the recovery key you saved. If you lose both, the backup cannot be decrypted.

### Cloud backups: Google Drive, Dropbox, and OneDrive

When you connect Google Drive, SupportFlow requests access only for the backup files the app creates or uses (`drive.file`). It does not request unrestricted access to unrelated files.

When you connect Dropbox, SupportFlow requests access only inside the app folder (`files.content.read`, `files.content.write`, `files.metadata.read` on an App folder app).

When you connect OneDrive, SupportFlow requests `Files.ReadWrite.AppFolder` and `offline_access`. That is limited to the app's own folder.

Before upload, the backup is encrypted on your device with AES-256. The provider stores the encrypted file. Your backup password and recovery key are not included and are not sent to the provider or to SupportFlow. Restore downloads the file and decrypts it on your device with the backup password or the recovery key for that file.

Disconnecting a provider in Settings stops future backups from this device. It does not delete backup files already stored.

## 4. Hosting and Netlify

SupportFlow™ is hosted using **Netlify**, a third-party web hosting and application delivery provider.

When you open or use SupportFlow, your device must communicate with Netlify's infrastructure so that the application can be delivered to your device.

As part of operating its hosting infrastructure, Netlify may process technical information associated with web requests, such as:

- IP address
- Browser type and version
- Device or operating-system information
- Date and time of requests
- Pages, files or application resources requested
- Other technical information necessary to deliver, protect and operate the hosting service

This technical hosting information is separate from the participant and business records you store inside SupportFlow.

SupportFlow does **not intentionally transmit participant names, NDIS numbers, shift notes, invoices or other locally stored participant records to Netlify merely because the app is hosted there**.

Netlify handles information processed through its infrastructure in accordance with its own applicable privacy, security and data-processing terms.

### Public website analytics

The public SupportFlow website uses Google Analytics 4 to understand basic website usage, such as page visits, sessions, general device/browser information and how visitors move through the public website. This analytics tagging is not included in the private SupportFlow app workspace, admin area, market page or tester-management pages.

SupportFlow configures Google Analytics for measurement only and disables Google Signals and advertising-personalisation signals in the website tag. Participant records, progress notes, invoice contents, NDIS numbers, locally stored app records and encrypted backup contents are not intentionally sent to Google Analytics.

## 5. When your information may leave your device

Although your SupportFlow records are stored locally by default, certain actions can cause information to leave your device.

### 5.1 Claimable deduction checker

Claimable is an optional deduction-checking feature.



**What Claimable sends:**

- The question you type
- Limited technical context needed for the feature to operate, where applicable

**What Claimable is designed not to send:**

- Participant names
- NDIS numbers
- Shift notes
- Participant health information
- Other participant records stored elsewhere in SupportFlow

Claimable is designed not to read participant records or automatically construct questions from those records.

**Do not enter participant names, NDIS numbers, health information or other personal information into Claimable.** Ask the deduction question in general terms.



If Claimable is unavailable or disabled in a particular build, no Claimable API request is sent.

### 5.2 Backups

When you create a SupportFlow backup, the backup file is encrypted on your device using AES-256 and a passphrase you choose before the encrypted backup file is exported.

You decide what happens to that file. For example, you may:

- Save it locally
- Store it using your own cloud-storage provider
- Email it to yourself
- Transfer it using another service available on your device

The developer does not receive a copy of your backup as part of this process.

Your backup password and recovery key are not transmitted to or stored by the developer.

The developer cannot recover or decrypt the backup for you. You can reset the backup password yourself if you still have the recovery key for that file. If you lose both, the backup cannot be decrypted. Backups made before recovery keys still open with the password they were made with.

If you choose to send or store the encrypted backup using another service, that provider's own privacy and data-handling terms apply.

### 5.3 Shift notes and records you choose to share

If you choose to share or send a shift note or other record, SupportFlow uses the sharing or communication options available on your device.

You choose what information is shared and who receives it.

Where the app provides a choice between identifying and less-identifying information, you should select the minimum amount of participant information reasonably necessary for the purpose.

The developer does not automatically receive a copy of information you share with another person.

### 5.4 Feedback and support

If you choose to contact the developer using a feedback or support feature, the information you decide to include in that communication will be sent to the developer.

Where the app opens your own email application, nothing is sent until you choose to send the message.

Feedback or support communications may contain basic technical information such as app version, device type, browser information or screen information where this is included to assist with troubleshooting.

**Do not include participant names, NDIS numbers, health information or other unnecessary participant information in feedback or support messages.**

Support and feedback emails may be retained for as long as reasonably necessary to investigate the issue, respond to you and improve the app.

## 6. Development assistance





## 7. What SupportFlow does not do

Under the current version described by this policy, SupportFlow does not:

- Maintain a central developer-operated database of participant records
- Sell participant or support-worker information
- Rent or trade personal information
- Build advertising profiles from participant records
- Use participant records for targeted advertising
- Give the developer routine access to participant records stored on your device


SupportFlow will only request device permissions where they are necessary for a feature you choose to use.

## 8. Security

Because your SupportFlow records are stored locally, the security of your information depends partly on the security of your device.

### App lock

Where enabled, SupportFlow's optional PIN or biometric lock controls access to the app.

A 4 or 6 digit PIN is hashed using PBKDF2 before storage and is not stored or recoverable by the developer in plain text.

Where supported by the device and app configuration, fingerprint or facial authentication may also be used.

The PIN or biometric lock protects **access to the app**. It should not be interpreted as encryption of the underlying locally stored records.

### Local records

SupportFlow's locally stored records are not independently encrypted at rest by the app in the current version.

SupportFlow therefore relies partly on the security protections provided by your phone, tablet or computer.

You should protect your device using appropriate measures such as:

- A strong device PIN, password or biometric lock
- Current operating-system and security updates
- Appropriate physical security
- Remote locking or wiping where your device supports it

### Backups

Backup files created using SupportFlow's encrypted backup feature are encrypted using AES-256 before export, as described in section 5.2.

### No central participant database

The developer does not operate a central database containing SupportFlow participant records. This reduces the amount of participant information held centrally by the developer.

## 9. Lost or stolen devices and data breaches

Because participant records are stored locally, the developer cannot detect whether your device has been lost, stolen or accessed without your permission.

If a device containing participant information is lost, stolen or compromised, you should promptly:

- Secure or remotely lock the device where possible
- Remotely erase it where appropriate and available
- Assess what information may have been exposed
- Consider the risk to affected participants
- Determine whether you have notification or other obligations under applicable privacy or NDIS requirements

The Notifiable Data Breaches scheme under the *Privacy Act 1988* imposes notification requirements in certain circumstances where an entity covered by the Act experiences an eligible data breach likely to result in serious harm.

Whether those requirements apply depends on the circumstances and the legal obligations applying to the relevant person or organisation.

If the developer experiences a breach involving information actually held by the developer, such as support correspondence, the developer will assess and respond to the incident and make any notifications required by applicable law.

## 10. Access, correction and deletion

Because your operational records are stored locally on your device, you have direct access to those records through SupportFlow.

You can correct or delete records using the functions provided by the app.

Where export functionality is available, you may also export your records.

The developer generally cannot retrieve, correct or delete your locally stored participant records because the developer does not possess them.

If you have sent the developer a support or feedback email containing personal information, you may request deletion of information held by the developer by contacting:

**support@supportflow.work**


## 11. Overseas processing and services you choose

The two main circumstances in which overseas processing may occur are:

1. **Netlify hosting:** Netlify operates international infrastructure and may process technical hosting information outside Australia as part of delivering and securing the application.

This does not mean your locally stored participant database is uploaded to either provider.

You may also choose to use third-party services to store or transmit information exported from SupportFlow, such as your own cloud-storage, email, file-sharing or device-backup service.

Those services operate under their own privacy and data-handling terms.

## 12. Children and participants under 18

SupportFlow is intended for adult support workers and is not directed at children as users of the app.

A support worker may, however, provide services to an NDIS participant who is under 18 and may enter information relating to that participant.

Information concerning a participant under 18 should be handled with the same care as other participant information and in accordance with the support worker's applicable legal, consent, service-agreement and NDIS obligations.

## 13. How long information is kept

Because your SupportFlow records are stored locally on your device, you control their retention.

SupportFlow does not automatically delete your records merely because a particular period has passed.

You are responsible for retaining records for any period required by taxation, NDIS, business, contractual or other applicable requirements.

The Australian Taxation Office generally requires most business records to be retained for five years, although different or longer retention periods can apply to particular records or circumstances.

Information actually received by the developer, such as feedback or support correspondence, will be retained only for as long as reasonably necessary for the purpose for which it was received or as otherwise required by law.

## 14. Complaints

If you believe your privacy, or a participant's privacy, has not been handled properly in connection with SupportFlow, contact the developer:

**Email:** support@supportflow.work  
**Subject:** Privacy complaint

The developer will investigate and respond within a reasonable period.

Depending on the circumstances and applicable law, you may also have the right to make a complaint to the Office of the Australian Information Commissioner (OAIC).

**OAIC website:** oaic.gov.au  
**Phone:** 1300 363 992

NDIS-related privacy or information-handling concerns may also involve obligations administered by the NDIS Quality and Safeguards Commission, depending on the circumstances.

## 15. Changes to this policy

SupportFlow may change over time.

If a future change materially affects how personal information is collected, stored, transmitted or disclosed, this privacy policy will be updated accordingly.

The updated policy will display a revised date.

Where appropriate, a notice will also be displayed within the app.

If a new optional feature involves external storage, synchronisation, artificial intelligence processing or another third-party service, the relevant information handling will be explained before or when that feature is introduced.

## 16. Contact

**Developer:** SupportFlow™  
**Email:** support@supportflow.work

---

*This policy describes SupportFlow™'s data-handling practices as accurately as possible. It does not constitute legal advice to support workers about their individual privacy, NDIS, taxation, record-keeping or service-provider obligations. Those obligations may vary according to individual circumstances, applicable legislation, NDIS requirements and agreements with participants.*



