# FeedbackLoop V5 data-protection design notes

This file records product-design choices. It is not a legal certification or a substitute for a DPIA, contract or security assessment.

## Classroom identity

FeedbackLoop requires a pupil's real full name because teachers need to match feedback and progress records to the correct learner. The name is used for classroom administration and is visible only to the pupil and authorised staff in the relevant workspace.

The service does not need a pupil's home address, date of birth, parent details, medical information, safeguarding information or special-category information for its core feedback function. Those fields should not be added to feedback or private notes.

## Authentication

Accounts may use:

- email and password; or
- Google sign-in through Firebase Authentication.

For email/password accounts, password recovery uses a secure reset link sent by Firebase to the account email. Teachers cannot view, choose or receive a pupil's password.

For Google accounts, authentication and password recovery are managed by the pupil's Google account. FeedbackLoop does not store a separate password.

## Individual teacher workspaces

An individual teacher can own a private teaching workspace and later add a school workspace to the same account. Data remains separated by workspace. V5 does not silently copy pupil records from an individual workspace into a school workspace.

## Access control

Firestore rules are designed to separate:

- one workspace from another;
- pupils from other pupils' records;
- teachers from classes they do not teach;
- school and individual workspaces belonging to the same teacher account.

These rules must still be tested with the Firebase Emulator Suite before real deployment.
