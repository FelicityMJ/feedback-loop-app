# FeedbackLoop V6.2 update guide

V6.2 changes staff access from one exclusive role per school to a permission set attached to one account. It also adds invitation-only pilot activation, workspace licence states and automatic resumable class migration with pupil reconnection.

## Files to replace

Replace these root files:

- `firestore.rules`
- `styles.css`
- `VERSION.txt`
- `README.md`
- `SETUP-GUIDE.md`

Replace these files inside `js`:

- `app.js`
- `demo-data.js`
- `firebase-service.js`

Add:

- `UPDATE-GUIDE-V6.2.md`
- `MULTI-ROLE-AND-MIGRATION-DESIGN-V6.2.md`
- the `scripts` folder

Do **not** replace `js/firebase-config.js` with a blank or example configuration. Keep the Firebase settings already used by V6.1.

## Required deployment order

1. Back up Firestore or export the pilot project.
2. Upload the V6.2 files to the GitHub repository.
3. Publish the complete V6.2 `firestore.rules` in Firebase Console.
4. Run the V6.2 role backfill in dry-run mode.
5. Apply the backfill after checking the output.
6. Create fictional activation codes and test both teacher and school activation.
7. Test each existing account type before using V6.2 with the pilot group.
8. Hard-refresh the published site with `Ctrl + Shift + R`.

The browser remains compatible with V6.1 records during the transition, so the code and rules can be deployed before the optional full backfill.

## New staff permission data

Each staff membership now contains both a canonical `role` and a V6.2 permission map:

```json
{
  "role": "schoolAdmin",
  "roles": {
    "schoolAdmin": true,
    "departmentHead": true,
    "teacher": true,
    "pupil": false
  },
  "roleSchemaVersion": 2,
  "departmentIds": ["business-it"],
  "departmentHeadDepartmentIds": ["business-it"]
}
```

`role` is retained for compatibility and indicates the highest current permission. `roles` is authoritative for the V6.2 interface.

The canonical priority is:

1. pupil;
2. school administrator;
3. department head;
4. teacher.

A pupil account cannot also hold a staff role. A department head always has teacher permission.

## Existing V6.1 conversion

The conversion is deliberately additive:

| V6.1 role | V6.2 permissions |
|---|---|
| `teacher` | `teacher: true` |
| `departmentHead` | `departmentHead: true`, `teacher: true` |
| `schoolAdmin` | `schoolAdmin: true` |
| `pupil` | `pupil: true` |

The conversion does not alter:

- Firebase user IDs;
- learner IDs;
- school IDs;
- class IDs;
- existing `teacherIds` arrays;
- memberships;
- pupils;
- assessments and results;
- feedback records, actions or interventions;
- transfer and email-change history.

V6.2 converts an old profile in memory immediately and attempts to save the new permission map on first sign-in. The supplied owner backfill upgrades all existing profiles and workspace memberships without waiting for each user to return.

### Run the backfill

Install the Firebase Admin SDK locally and authenticate as described in `scripts/README.md`.

Dry run:

```bash
node scripts/backfill-v62-roles.mjs
```

Apply:

```bash
node scripts/backfill-v62-roles.mjs --apply
```

For one school only:

```bash
node scripts/backfill-v62-roles.mjs --school=your-school-id
node scripts/backfill-v62-roles.mjs --school=your-school-id --apply
```

The script also creates missing current-workspace membership documents, adds department `headIds`, sets existing workspaces to an active legacy-pilot state and enables school-administrator emergency management unless it was explicitly disabled.

## Multi-role interface

Staff see only the areas permitted for their current school membership:

- **My classes** — classes whose `teacherIds` contains the signed-in user ID;
- **Department overview** — classes in `departmentHeadDepartmentIds`;
- **School administration** — setup, departments, staff permissions, licences, migration approvals and audit records.

The area switch changes the view, not the login or account. Switching school workspaces remains separate from switching role areas.

## Initial school activation

V6.2 no longer allows unrestricted creation of independent-teacher or school workspaces. An owner-issued activation code is required.

A school activation creates, in one Firestore transaction:

- the school document;
- the activating user profile;
- the user’s school-workspace membership;
- the activation-code redemption record.

This prevents one code being redeemed twice during simultaneous requests.

The activating administrator can choose teacher permission immediately. After activation they can:

- create departments, subjects and classes;
- assign or remove their own teacher permission when safe;
- temporarily give themselves department-head access;
- appoint permanent department heads;
- remove only their own department-head permission while retaining administrator and teacher access.

## Activation-code collection

Activation codes live at:

```text
activationCodes/{UPPERCASE_CODE}
```

A school code contains:

```json
{
  "accountType": "school",
  "active": true,
  "licenceType": "complimentaryPilot",
  "workspaceStatus": "active",
  "assignedEmail": "optional@example.org",
  "trialEndsAt": null,
  "sponsorName": "",
  "label": "School pilot"
}
```

An independent-teacher code uses:

```json
{
  "accountType": "independentTeacher",
  "active": true,
  "licenceType": "complimentaryPilot",
  "workspaceStatus": "active"
}
```

Do not pre-populate `redeemedBy`, `redeemedEmail`, `redeemedWorkspaceId` or `redeemedAt`. V6.2 writes those fields atomically when the code is used.

The owner script creates correctly structured codes:

```bash
node scripts/create-v62-activation-code.mjs --type=school --email=pilot@example.org
node scripts/create-v62-activation-code.mjs --type=teacher --email=teacher@example.org
```

## Workspace and licence states

Each school or independent-teacher workspace can contain:

```json
{
  "workspaceStatus": "active",
  "licence": {
    "type": "complimentaryPilot",
    "status": "active",
    "trialEndsAt": null,
    "complimentary": true,
    "sponsorName": "",
    "activationLabel": "V6.2 pilot"
  }
}
```

Supported interface states are:

- `active` — normal use;
- `paused` — records remain visible and browser changes are blocked;
- `trial` — the trial end is displayed and the browser becomes read-only after expiry.

Firestore rules enforce the paused state. Trial-expiry enforcement is currently also performed by the browser. Before a paid public launch, enforce trial expiry through trusted backend code or a callable Cloud Function using a Firestore `Timestamp`.

## Internal staff codes

School administrators create internal staff codes from **School administration → Staff roles & codes**. A code can grant any permitted combination of:

- school administrator;
- department head;
- teacher.

Selecting department head automatically selects teacher. A staff member who already has an account uses the code from inside the account, and the new permissions are merged into the same school membership rather than creating another profile.

Department heads can still create teacher codes for departments they lead. Teachers can still create pupil class codes for classes assigned to them.

## Leadership safety checks

The V6.2 service prevents:

- removing the final school administrator;
- removing the final department head where emergency administrator management has been explicitly disabled;
- removing teacher permission while the person remains in any class `teacherIds` list;
- creating a staff account with no staff permission;
- creating a department-head permission without teacher permission.

Permission changes update profile and department leadership records in one batch and write an audit entry. They never delete classes, memberships, pupils, assessments, results or feedback.

Cross-record checks such as “final administrator” and “teacher still owns classes” are enforced by the V6.2 application service. Firestore rules prevent ordinary users changing their own permission scope, but Firestore rules cannot safely count all administrators or inspect every assigned class in one write. Before unrestricted production use, move `updateStaffRoles` to a callable Cloud Function or another trusted backend transaction and allow role writes only through that backend.

## Resumable class migration

V6.2 replaces the final manual pupil-rejoin step. After destination approval, the requesting teacher switches to the destination workspace and selects **Start migration** or **Resume migration**.

The browser progresses through deterministic, repeatable phases:

1. class;
2. memberships;
3. assessments;
4. feedback records;
5. feedback actions;
6. interventions;
7. pupil reconnection;
8. completed.

Every copied document uses a deterministic destination ID and stores migration-origin metadata. Re-running an interrupted phase merges the same records instead of creating duplicates.

During pupil reconnection V6.2:

- creates or updates the pupil’s destination-workspace membership;
- keeps the same Firebase UID and learner ID;
- adds the destination to `workspaceIds` and `schoolHistoryIds`;
- links the copied destination class membership;
- leaves the source class and source history intact.

Only co-teachers who already hold teacher permission in the destination school are retained on the destination class.

## Minimum test checklist

Use fictional data and test all of the following:

- V6.1 teacher signs in and sees only assigned classes.
- V6.1 department head signs in and can switch between My classes and Department overview.
- V6.1 school administrator signs in and sees School administration.
- A school administrator adds teacher and department-head permissions to themselves.
- A department head is automatically retained as a teacher.
- Removing the final administrator is refused.
- Removing teacher permission while a class is assigned is refused.
- Reassigning the class first allows teacher permission to be removed.
- A complimentary school activation code works once and cannot be reused.
- An independent-teacher activation code works once and cannot be reused.
- A paused workspace is readable but not editable.
- A migration can be interrupted, resumed and completed without duplicate records.
- Existing pupils appear in the destination workspace without creating new accounts.
- Source classes, pupil history and feedback remain present.
- Audit records appear for activation, role changes and completed migration.

## Validation completed for this package

- JavaScript syntax checks pass for every app and owner-script file.
- Demo-mode policy tests pass for all three V6.1 staff conversions, department-head teacher inheritance, final-administrator protection, assigned-class teacher protection and safe removal of an administrator’s own temporary department-head permission. The test also confirms class and feedback counts remain unchanged.
- `git diff --check` reports no whitespace errors.
- Rule delimiters and the complete rules structure were statically reviewed.
- A browser smoke test could not be run in the build sandbox because local HTTP and `file://` pages were blocked by its administrator policy.
- Firebase CLI rule compilation could not be completed in the build sandbox because the CLI download was unavailable. Publish first to a test Firebase project or run the Firestore emulator before using real pupil data.
