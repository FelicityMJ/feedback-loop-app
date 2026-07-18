# FeedbackLoop V4 — department and class code update

This update changes joining so the responsibility follows the school structure:

- the school administrator creates a **department-head code** for a department;
- the department head creates a reusable **teacher department code**;
- the department head assigns joined teachers to classes;
- each teacher creates a reusable **pupil class code** for their own class.

There is no role selector and no email-restriction field. The code itself fixes the role and scope.

## Replace these GitHub files

Upload the files from the update bundle, preserving the folders:

- `js/app.js`
- `js/firebase-service.js`
- `js/demo-data.js`
- `firestore.rules`
- `styles.css`
- `README.md`
- `SETUP-GUIDE.md`

Commit the update to `main`, wait for GitHub Pages to publish, then press **Ctrl + Shift + R** on the app.

## Essential Firebase step

GitHub does not deploy Firestore rules automatically. Open **Firebase → Firestore Database → Rules**, replace the existing rules with the new `firestore.rules`, then select **Publish**.

## Recommended test order

1. As school administrator, create a department-head code for Business and IT.
2. Create a fictional department-head account with that code.
3. As that department head, create a teacher department code.
4. Use the department code to finish creating the fictional teacher account.
5. As department head, assign the teacher to 4E Computing.
6. As teacher, generate the 4E Computing pupil class code.
7. Create a fictional pupil account with the class code.

## Existing incomplete teacher account

If Firebase Authentication already contains the teacher email but there is no matching Firestore `users` document, do not recreate it manually. Enter the same email, password and the new department code through **Join a school**. The app signs into the existing Authentication account and completes the missing FeedbackLoop profile.

Old invitation codes can be disabled from the code table after the new workflow has been tested.
