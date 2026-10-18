# FeedbackLoop V6.3.6 — teacher temporary passwords

## What changed

This replaces the unreliable email-reset workflow for pupils with a teacher-managed **temporary password** flow.

1. Teacher opens **My classes** and finds the pupil.
2. Select **Reset password**.
3. FeedbackLoop generates a temporary password such as `Temp-K7M4Q2`. The teacher can replace it with another password of at least 8 characters.
4. Teacher gives that temporary password directly to the pupil.
5. The pupil signs in using their normal email address and the temporary password.
6. Before any pupil dashboard or school data opens, FeedbackLoop shows **Choose a new password**.
7. The pupil enters and confirms a new private password. The temporary-password flag is then cleared and FeedbackLoop opens normally.

No password-reset email is required.

## Security behaviour

- The teacher never sees the pupil's final password.
- The temporary password itself is **not stored in Firestore**.
- The reset is performed by a protected Firebase Cloud Function using the Firebase Admin SDK; the browser is never given administrator credentials.
- A normal teacher can only reset a pupil who belongs to one of that teacher's assigned classes. Department heads and school administrators are checked against their workspace permissions.
- Existing Firebase sessions for the pupil are revoked when a temporary password is issued.
- Google-sign-in pupils continue to show **Google login** and do not use this reset flow.
- An audit record notes that a temporary password was set and later changed, but never records either password.

## Important: `12345` will not work

Firebase passwords must be at least 6 characters, and FeedbackLoop now requires at least **8 characters** for both temporary and permanent passwords. A shared password such as `12345678` should not be used for a whole class. The generated temporary password is safer and is intended to be used only once.

## Files changed / added

Upload or replace:

- `js/app.js`
- `js/firebase-service.js`
- `firebase.json`
- `VERSION.txt`
- `functions/package.json`
- `functions/index.js`
- `UPDATE-GUIDE-V6.3.6.md` (optional, for your records)

No Firestore rules change is required for this feature because all privileged password changes happen inside the Cloud Functions.

## One-time Firebase deployment

This version adds Firebase Cloud Functions, so uploading files to GitHub Pages alone is not enough.

From the project folder, using the Firebase CLI:

```bash
firebase login
firebase use feedback-loop-school
firebase deploy --only functions
```

If Firebase asks you to upgrade the project billing plan before Cloud Functions can be deployed, follow the Firebase console prompt. The static website can remain on GitHub Pages; the two password functions run in Firebase's London region (`europe-west2`).

After the functions are deployed, publish the updated website files as usual.

## Test before using with pupils

Use a fictional pupil account first:

1. Sign in as a teacher.
2. Open a class and select **Reset password** beside the test pupil.
3. Note the generated temporary password and submit it.
4. Sign out and sign in as the test pupil using that temporary password.
5. Confirm the normal pupil dashboard does **not** open.
6. Confirm the forced **Choose a new password** screen appears.
7. Choose a new password and confirm FeedbackLoop then opens normally.
8. Sign out and confirm the old temporary password no longer signs in while the newly chosen password does.
