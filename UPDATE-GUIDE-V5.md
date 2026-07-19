# FeedbackLoop V5 update — individual teachers, Google sign-in and pupil password reset

## What this update adds

- Teachers can create a full individual workspace without a department-head code.
- The same teacher account can later join a school using a teacher department code.
- A workspace switcher appears when the account belongs to more than one workspace.
- Pupils and staff join using their real full name.
- Google sign-in can be used for sign-in, pupil/class-code registration and independent teacher registration.
- Teachers can send a secure Firebase password-reset email from a pupil dashboard.
- Google pupils are clearly labelled as Google sign-in users and do not receive a FeedbackLoop password-reset button.

## Upload these files to GitHub

Replace the existing versions of:

- `firestore.rules`
- `styles.css`
- `js/app.js`
- `js/firebase-service.js`

Also upload:

- `UPDATE-GUIDE-V5.md`
- `VERSION.txt`

Do not replace `js/firebase-config.js` because it contains your own Firebase web configuration.

Commit message:

`Add individual teacher workspaces and account recovery`

## Publish the Firestore rules

Uploading `firestore.rules` to GitHub does not publish the live rules.

1. Open Firebase Console.
2. Open **Firestore Database → Rules**.
3. Replace the current rules with the new `firestore.rules`.
4. Select **Publish**.

## Enable Google sign-in

1. Open **Firebase Console → Authentication**.
2. Open **Sign-in method**.
3. Select **Google**.
4. Enable it, choose the project support email and save.
5. In **Authentication → Settings → Authorized domains**, make sure the website host is listed, for example `felicitymj.github.io`.

## Password-reset email

Firebase sends the reset link to the pupil's own email address. The teacher never sees or chooses the new password.

You can edit the wording and sender name in:

**Firebase Console → Authentication → Templates → Password reset**

## Test sequence

Use fictional accounts until the security and data-protection review is complete.

### Independent teacher

1. Sign out.
2. Choose **Teacher account**.
3. Create a workspace using email/password or Google.
4. Open **My classes**.
5. Add or rename the subject structure as needed, create a class and generate a pupil code.

### Pupil using email/password

1. Choose **Join with code**.
2. Enter the pupil's real full name, email, password and class code.
3. Open the pupil dashboard as the teacher.
4. Select **Send password reset**.
5. Confirm the reset email arrives at the pupil's address.

### Pupil using Google

1. Choose **Join with code**.
2. Enter the real full name and class code.
3. Select **Join using Google**.
4. The pupil dashboard should show **Uses Google sign-in** instead of a password-reset button.

### Link an independent teacher to a school

1. The department head creates a teacher department code.
2. The independent teacher opens their personal workspace.
3. Open **My classes → Link to a school**.
4. Enter the teacher department code.
5. The school opens as the active workspace.
6. Use the workspace selector at the top to move between the individual and school workspaces.

Existing personal classes remain in the individual workspace. V5 links the account and workspaces; it does not automatically copy pupil records into the school workspace.

## Existing accounts

Existing school accounts continue to work. The new multi-workspace records are created automatically for new V5 registrations. To test the complete individual-teacher flow, use a new fictional teacher account.
