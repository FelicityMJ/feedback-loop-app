# FeedbackLoop V6.3.5 — easier pupil password reset

## What changed

Teachers can now reset an email/password pupil account directly from the class pupil list.

- Open **My classes** (or the teacher overview).
- Find the pupil.
- Select **Reset password** beside their name.
- Confirm the pupil and email address.
- Firebase emails the pupil a secure link so they can choose a new password.

Pupils who use Google sign-in show **Google login** instead, because those accounts do not have a FeedbackLoop password.

The existing reset button on the individual pupil dashboard is still available.

## Files to upload

Replace:

- `js/app.js`
- `VERSION.txt`

Optionally upload this update guide for your records. No Firestore rules, Firebase service, or Authentication changes are required for this update.

## Why the teacher does not type the pupil's new password

The browser app should not be given permission to change another user's Firebase Authentication password directly. The secure reset-email flow keeps the pupil's password private while making the action one click from the teacher's class list.
