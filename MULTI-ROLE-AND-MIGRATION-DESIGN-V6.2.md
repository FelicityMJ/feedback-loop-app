# FeedbackLoop V6.2 — multi-role and migration design

## 1. Identity, school membership and permissions

A Firebase Authentication user remains the permanent login identity. The top-level `users/{uid}` document stores the currently selected workspace and portable pupil identity fields. School-specific permissions live in:

```text
users/{uid}/workspaces/{schoolId}
```

One staff membership can hold several permissions. Separate accounts are not created for administrator, department-head and teacher work.

```json
{
  "uid": "firebase-uid",
  "schoolId": "northbridge-academy",
  "role": "schoolAdmin",
  "roles": {
    "schoolAdmin": true,
    "departmentHead": true,
    "teacher": true,
    "pupil": false
  },
  "roleSchemaVersion": 2,
  "departmentIds": ["business-it"],
  "departmentHeadDepartmentIds": ["business-it"],
  "active": true
}
```

`departmentIds` records the departments the staff account belongs to for teaching and code scope. `departmentHeadDepartmentIds` is the narrower list used by Department overview.

## 2. Permission invariants

- A pupil membership contains only `pupil: true`.
- A department head always contains `teacher: true`.
- A staff membership must contain at least one staff permission.
- `role` is the canonical highest permission and remains for compatibility.
- The browser never trusts `role` alone when a V6.2 `roles` map is present.
- A user cannot edit their own workspace membership to expand permissions without a valid staff invitation.
- School administrators change staff permissions through the protected administration workflow.

## 3. Area visibility

### My classes

A class is visible only when:

```text
classes/{classId}.teacherIds contains uid
```

Department leadership does not automatically expose every department class inside My classes.

### Department overview

A class is visible when its `departmentId` is contained in the user’s `departmentHeadDepartmentIds`.

### School administration

Available only when `roles.schoolAdmin` is true for the selected school membership.

## 4. School activation

The owner creates an `activationCodes/{code}` document outside the browser. The public app may perform an exact lookup but cannot list or create activation codes.

Redemption creates the activation result in a single Firestore transaction:

```text
activationCodes/{code}
schools/{schoolId}
users/{uid}
users/{uid}/workspaces/{schoolId}
```

The transaction changes `active` on the activation code to `false` and records the redeemer. A competing redemption therefore fails.

## 5. Internal staff invitations

School-generated invitations remain inside:

```text
schools/{schoolId}/invites/{schoolId~randomCode}
```

V6.2 introduces `role: "staff"` invitations with a complete `roles` map. When an existing staff account redeems one, the service calculates the union of existing and invited permissions, then saves the merged canonical membership. Department-head department IDs are also merged.

## 6. Leadership handover

Role changes are non-destructive. A handover updates:

- `users/{uid}` when this is the user’s currently selected school;
- `users/{uid}/workspaces/{schoolId}`;
- each affected `departments/{departmentId}.headIds`;
- an append-only `auditLogs` entry.

It does not update or delete class, membership, pupil, assessment, feedback or intervention documents.

The service checks all active school memberships before allowing the final administrator to be removed. It checks current class `teacherIds` before removing teacher permission. Department leadership checks combine V6.2 membership data with legacy `headIds` so a V6.1 head cannot be silently orphaned during conversion.

## 7. V6.1 compatibility

Legacy profiles are interpreted as follows at every permission read:

```text
teacher        → teacher
departmentHead → departmentHead + teacher
schoolAdmin    → schoolAdmin
pupil          → pupil
```

First sign-in writes the equivalent V6.2 permission map and, when necessary, creates the missing current-workspace membership. Security rules only permit this bootstrap when the requested permissions exactly match the existing legacy role, preventing self-escalation.

The optional Admin SDK backfill performs the same operation for every account and can be limited to one school.

## 8. Workspace access state

The school document is the source of the current access state:

```json
{
  "workspaceStatus": "trial",
  "licence": {
    "type": "trial",
    "status": "trial",
    "trialEndsAt": "2026-10-31T00:00:00.000Z",
    "complimentary": false,
    "sponsorName": "",
    "activationLabel": "Autumn pilot"
  }
}
```

Pausing a workspace does not delete or detach any data. It changes the app to read-only and Firestore rules reject writes to school collections.

## 9. Class migration state machine

A migration request stores its current phase and deterministic destination class ID:

```json
{
  "status": "migrating",
  "migrationPhase": "feedbackRecords",
  "sourceWorkspaceId": "personal-uid",
  "sourceClassId": "class-a",
  "destinationSchoolId": "northbridge-academy",
  "destinationClassId": "mig_request_class-a"
}
```

Each copied record stores:

```json
{
  "migrationRequestId": "request-id",
  "migrationOriginWorkspaceId": "personal-uid",
  "migrationOriginId": "source-record-id"
}
```

The destination document ID is derived from the request and source ID. A repeated write therefore targets the same document and uses merge semantics.

## 10. Automatic pupil reconnection

For each active source membership, the migration process:

1. verifies that the source `userId` still belongs to a pupil profile;
2. creates or merges `users/{pupilUid}/workspaces/{destinationSchoolId}` as a pupil membership;
3. adds the destination school to `workspaceIds` and `schoolHistoryIds`;
4. preserves the same UID and learner ID;
5. leaves the source workspace membership and original records intact.

The pupil signs in with the same account. No replacement account, new learner ID or manual destination class code is required.

## 11. Audit model

V6.2 creates school audit entries for at least:

- school activation;
- staff joining a workspace;
- staff permission changes;
- completed class migration.

Audit records are visible only in School administration under the supplied rules.

## 12. Trusted-backend boundary

The browser implementation is suitable for a tightly controlled invitation-only pilot. Before wider commercial deployment, move the following to callable Cloud Functions or another trusted server:

- activation-code creation and lifecycle management;
- staff-role changes and final-leader checks;
- paid licence and trial-expiry enforcement;
- large class migrations and retry scheduling;
- organisation-sponsored licence administration.

The current schema deliberately anticipates that move, so the browser UI and stored data do not need another identity redesign.
