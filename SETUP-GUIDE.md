# FeedbackLoop V6.3 — setup guide

This app uses static files on GitHub Pages and Firebase Authentication/Firestore. Complete the sections in order and use fictional accounts until every permission path has been tested.

## 1. Publish the repository

1. Upload the complete package to the existing `feedback-loop-app` repository.
2. Keep the existing `js/firebase-config.js` values.
3. Enable GitHub Pages from the `main` branch and repository root.
4. Wait for the deployment, then hard-refresh with `Ctrl + Shift + R`.

To preview locally:

```bash
python -m http.server 8000
```

## 2. Firebase Authentication

Enable:

- Email/Password;
- Google.

Add the GitHub Pages or custom domain under **Authentication → Settings → Authorised domains**.

## 3. Firestore

Use the existing V6.1 Firestore database. Before updating:

1. take a backup/export;
2. copy the complete V6.3 `firestore.rules` into **Firestore Database → Rules**;
3. publish the rules;
4. retain the supplied `firestore.indexes.json`.

Do not manually delete or recreate existing `users`, `schools`, classes or pupil records.

## 4. Upgrade existing V6.1 accounts to the V6.2 role foundation

V6.2 can interpret old roles immediately, but the owner backfill upgrades the full pilot consistently.

Install the Admin SDK locally:

```bash
npm install --no-save firebase-admin
```

Authenticate with Application Default Credentials or a protected service-account file, then run:

```bash
node scripts/backfill-v62-roles.mjs
```

Review the dry run. To apply:

```bash
node scripts/backfill-v62-roles.mjs --apply
```

The script preserves all existing IDs, classes, `teacherIds`, memberships, results, feedback and learner history.

## 5. Create a school pilot activation code

The normal browser app cannot create top-level activation codes. Create them with the owner script:

```bash
node scripts/create-v62-activation-code.mjs --type=school --email=admin@example.org --label="School pilot"
```

Or create an uppercase document manually in `activationCodes` with:

| Field | Type | Value |
|---|---|---|
| `accountType` | string | `school` |
| `active` | boolean | `true` |
| `licenceType` | string | `complimentaryPilot` |
| `workspaceStatus` | string | `active` |
| `assignedEmail` | string | optional exact activating email |
| `trialEndsAt` | string/null | ISO date-time for a trial, otherwise null |
| `sponsorName` | string | optional |
| `label` | string | owner description |

Do not add redemption fields. The app writes them when the code is used.

## 6. Activate a new school

1. Open FeedbackLoop signed out.
2. Choose **School pilot**.
3. Enter the activating person’s real name, school name and owner-issued activation code.
4. Choose whether they should also receive teacher access.
5. Create the account with Email/Password or Google.

The app creates the school, administrator profile and workspace membership atomically. The activation code then becomes inactive.

## 7. Complete initial school setup

The activating administrator can:

1. open **School administration → School setup**;
2. create departments;
3. create subjects;
4. create classes, initially unassigned or assigned to an existing teacher;
5. open **Staff roles & codes** and manage their own permissions;
6. temporarily give themselves department-head access to one or more departments;
7. appoint permanent department heads;
8. remove only their own department-head permission while retaining administrator and teacher access.

The final administrator cannot be removed. A teacher cannot lose teacher access until their classes have been reassigned.

## 8. Add staff

A school administrator opens **School administration → Staff roles & codes → Create internal staff code**.

The code can grant:

- teacher;
- department head plus teacher;
- school administrator;
- any safe combination of those permissions.

For a new account, the staff member chooses **Join with code**. For an existing FeedbackLoop staff account, they sign in and use **Add another staff workspace** or the equivalent add-workspace action. Permissions are added to the same school membership.

Department heads can create teacher codes for departments they lead. Department-head codes from V6.1 automatically include teacher permission in V6.2.

## 9. Add pupils

1. Assign at least one teacher to the class.
2. That teacher opens **My classes**.
3. Create a pupil class code.
4. A new pupil chooses **Join with code** and creates one account.
5. An existing pupil signs in and chooses **Join another class**.

The same Firebase UID and learner ID are retained across class and workspace memberships.

## 10. Independent-teacher pilot activation

Create an owner-issued teacher code:

```bash
node scripts/create-v62-activation-code.mjs --type=teacher --email=teacher@example.org --label="Independent teacher pilot"
```

The teacher chooses **Teacher pilot** when signed out. The app creates a private individual-teacher workspace. They can later join a participating school using a school-generated staff code without creating another account.

## 11. Workspace state

Change `schools/{schoolId}.workspaceStatus` only through owner administration during the pilot:

- `active` — normal use;
- `paused` — data is visible but writes are blocked;
- `trial` — the trial end is displayed and the browser becomes read-only after expiry.

Keep `licence.status` aligned with `workspaceStatus`.

For a trial activation code:

```bash
node scripts/create-v62-activation-code.mjs --type=school --status=trial --trial-ends=2026-10-31
```

## 12. Move an independent class into a school

1. The independent teacher first joins the destination school as a teacher.
2. In the individual workspace, choose **Move to school** for the class.
3. Select the destination school, department and subject.
4. A destination school administrator or relevant department head approves it.
5. The teacher switches to the destination school.
6. Choose **Start migration**.
7. If the browser closes or the connection fails, return and choose **Resume migration**.

V6.2 copies class structure, memberships, assessments, feedback, actions and interventions in resumable phases. Existing pupils are then connected automatically to the destination school with the same account. They do not need a new code or new learner ID.

## 13. Test before the pilot

Use fictional accounts to verify:

- a teacher sees only assigned classes;
- a head can switch between My classes and Department overview;
- a multi-role administrator can switch across all three areas;
- final-administrator and assigned-class protections work;
- activation codes cannot be reused;
- paused workspaces are read-only;
- interrupted migrations resume without duplicates;
- pupils reconnect automatically;
- source data remains intact;
- audit entries are visible only to school administrators.

Compile the rules in a test Firebase project or Firestore emulator before using real pupil data. The browser build sandbox used to assemble this package did not permit a live local-page smoke test or Firebase CLI download.


## 16. V6.3 feedback-to-action checks

V6.3 needs no additional Admin SDK backfill. Publish the V6.3 rules and test with fictional data:

- start, close, reopen and archive a live feedback session;
- confirm only pupils included in the session roster can load it;
- test bold, four highlights, bullet lists and numbered lists;
- update and pin an improvement-bank item;
- save each pupil PDF report type and inspect formatting;
- record a professional support-indicator review and confirm the calculated reasons remain visible;
- confirm the review creates an audit record.

See `UPDATE-GUIDE-V6.3.md` for the exact replacement-file list.
