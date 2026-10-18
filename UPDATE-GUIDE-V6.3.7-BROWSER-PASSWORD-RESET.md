# FeedbackSteps V6.3.7 — browser-only temporary password setup

This version keeps the teacher workflow simple:

1. Teacher opens **My Classes**.
2. Clicks **Reset password** beside a pupil.
3. FeedbackSteps generates a temporary password.
4. The pupil signs in with it.
5. FeedbackSteps forces the pupil to choose a private new password before opening the dashboard.

No password-reset email is required.

## Important

There is a one-time backend setup because a normal web page must never have Firebase administrator privileges. This version is designed so that setup can be completed in the **Google Cloud web console + GitHub**, without Windows Command Prompt, Node, npm or Firebase CLI on your computer.

## Files to upload to GitHub

Replace/update the normal site files, especially:

- `js/app.js`
- `js/firebase-service.js`
- `js/firebase-config.js`
- `firebase.json`
- `VERSION.txt`

Add the new folder:

- `password-service/package.json`
- `password-service/server.js`

Do not delete your real Firebase values from `js/firebase-config.js`.

## One-time Cloud Run setup

Use the same Google Cloud project as Firebase: `feedback-loop-school`.

1. Open Google Cloud Console → **Cloud Run**.
2. Choose **Connect repository** / continuous deployment from a repository.
3. Choose **Cloud Build** and connect the GitHub repository that contains FeedbackSteps.
4. Select the `main` branch.
5. Build type: **Node.js via Google Cloud buildpacks**.
6. Build context directory: `/password-service`.
7. Service name: `feedbacksteps-password-service`.
8. Region: choose a UK/nearby region, e.g. `europe-west2` if offered.
9. Authentication: **Allow public access**. This is safe for this service because every password action still requires and verifies a signed-in Firebase ID token and checks the teacher/pupil permissions in Firestore.
10. Create the service.

Cloud Run will build the Node service directly from GitHub. Future commits to the selected branch can automatically rebuild it.

## Permissions for the Cloud Run service identity

The service account used by the Cloud Run service needs permission to:

- manage Firebase Authentication users (to set a temporary password)
- read/write Firestore (to check teacher/class permissions and set the forced-change flag)

If the first test reports a server permission error, open Google Cloud Console → **IAM & Admin → IAM**, find the service account used by the Cloud Run service, and add:

- **Firebase Authentication Admin**
- **Cloud Datastore User**

Only grant these roles to the Cloud Run service account, not to pupils or teachers.

## Connect FeedbackSteps to the service

After Cloud Run finishes deployment, copy the service URL shown on its page. It looks like:

`https://feedbacksteps-password-service-xxxxx.europe-west2.run.app`

Open `js/firebase-config.js` in GitHub and set:

```js
passwordAdminUrl: "PASTE_THE_CLOUD_RUN_URL_HERE"
```

Commit the change. GitHub Pages will then use the password service.

## Test with a dummy pupil

1. Sign in as a teacher.
2. Open **My Classes**.
3. Click **Reset password** beside a test pupil.
4. Use the generated temporary password.
5. Sign out and sign in as the pupil using that temporary password.
6. Confirm that the normal pupil dashboard is blocked and **Choose a new password** appears.
7. Save a new password.
8. Sign out and confirm the new password works and the temporary password no longer works.

Google-sign-in pupils are not given this reset button because their password is managed by Google rather than FeedbackSteps.
