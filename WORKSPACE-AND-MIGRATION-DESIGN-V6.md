# Workspace and migration design — V6

## Permanent identity

A person has one Firebase Authentication account and one top-level `users/{uid}` profile. A pupil's `learnerId` is not replaced when another class or workspace is added.

## Workspace memberships

Access to each independent or school workspace is represented by:

`users/{uid}/workspaces/{workspaceId}`

The top-level user profile mirrors the currently selected workspace for compatibility with the dashboard. Switching workspace changes the mirrored role and department fields; it does not create another account.

## Class membership

Pupil membership remains a separate record under the workspace:

`schools/{workspaceId}/memberships/{membershipId}`

This allows one pupil to belong to Computing, Maths and other classes while using one account.

## Shared teaching

Each class stores a `teacherIds` array. More than one teacher or department head can be selected. Access to the class is based on membership of this array and the person's workspace role.

## School adoption

Independent classes are not silently relabelled as school records. A migration request records the source class and intended destination department/subject. After destination approval, the source owner copies the class history into the school workspace.

Copied records retain:

- `migrationRequestId`
- `migrationOriginWorkspaceId`
- `migrationOriginId`

The original remains as a historical backup. Portfolio loading uses the migration-origin fields to suppress duplicate copies of the same record.

## Pupil reconnection

The copied school membership uses the existing pupil UID. The pupil later enters the school class code to add the school workspace to their own account. Once joined, the copied history becomes visible immediately.
