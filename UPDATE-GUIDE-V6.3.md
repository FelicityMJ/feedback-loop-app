# FeedbackLoop V6.3 update guide

This guide upgrades an already working V6.2 installation to **V6.3 — Feedback to Action**.

## No backfill is required

Do not run a new Admin SDK migration for V6.3. Existing V6.2 feedback remains unchanged and is automatically shown as mistake-and-improvement items until a pupil updates or pins an item. New V6.3 records are stored only when the new features are used.

The existing `scripts` folder is unchanged and is not required for this update.

## Files to replace in GitHub

Replace these existing files:

```text
VERSION.txt
README.md
SETUP-GUIDE.md
PRIVACY-AND-PILOT-CHECKLIST.md
firestore.rules
styles.css
js/app.js
js/demo-data.js
js/export.js
js/firebase-service.js
```

Add these new files:

```text
UPDATE-GUIDE-V6.3.md
FEEDBACK-TO-ACTION-DESIGN-V6.3.md
```

Do not replace these unchanged files:

```text
index.html
js/firebase-config.js
js/charts.js
firestore.indexes.json
firebase.json
manifest.webmanifest
.nojekyll
```

Do not upload a Firebase service-account JSON key.

## Commit and deploy

1. Upload the replacement and new files to the root of the existing GitHub repository.
2. Use the commit message `Upgrade FeedbackLoop to V6.3`.
3. Wait for GitHub Pages to show a successful deployment.
4. Open `VERSION.txt` in GitHub and confirm it says `6.3.0`.
5. Confirm `js/firebase-config.js` still contains the working Firebase project configuration.

## Publish the V6.3 Firestore rules

Committing `firestore.rules` to GitHub does not activate it in Firebase.

1. Open **Firebase Console → Firestore Database → Rules**.
2. Copy the current rules into a local safety file.
3. Copy the complete V6.3 `firestore.rules` file into the Firebase editor.
4. Click **Publish**.

`firestore.indexes.json` did not change for V6.3. The participant lookup for pupil feedback sessions uses a single-field `array-contains` query and does not require a new composite index.

## New Firestore collections

V6.3 creates these school subcollections when features are first used:

```text
schools/{schoolId}/feedbackSessions
schools/{schoolId}/improvementBank
schools/{schoolId}/riskOverrides
```

- A feedback session stores a snapshot of the invited pupil IDs. Pupils can read only sessions containing their own UID.
- Improvement-bank items belong to one pupil. Existing feedback is displayed without writing duplicate records.
- Risk overrides retain the calculated level, selected professional level, reason, review date and reviewer.

## Fictional-data checks

Complete these before using real pupil records:

1. Sign in as a fictional pupil and open **My feedback loops**.
2. Confirm an open teacher-led session appears and opens with class, title and topic already filled in.
3. Confirm the editor includes bold, four highlights, **• List**, **1. List** and clear formatting.
4. Open **Mistake & improvement bank** and update, pin and filter an item.
5. Open **My learning record → Save as PDF** and check complete, feedback, bank and assessment-only options.
6. Save a PDF and confirm bold, highlights, bullets, numbered lists and paragraph spacing remain visible.
7. Sign in as a fictional teacher and start a live feedback session.
8. Confirm the session shows submitted, active, drafts, not started and red counts.
9. Close, reopen and archive a fictional session.
10. Open a pupil dashboard and review a support indicator.
11. Confirm the calculated score and every contributing reason remain visible after a professional override.
12. Confirm the review appears in the school audit records.
13. Sign in as a department head and confirm transparent reasons and review controls appear in the department overview.

## Final release check

Hard-refresh the published site with `Ctrl + Shift + R`, then test pupil, teacher, department-head and administrator accounts once more. V6.4 spaced resurfacing and the topic-based exam-readiness map are intentionally not included in V6.3.
