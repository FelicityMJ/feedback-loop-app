# FeedbackLoop V6 update

> **Superseded by V6.2:** Use `UPDATE-GUIDE-V6.2.md` and `MULTI-ROLE-AND-MIGRATION-DESIGN-V6.2.md` for the current implementation. V6.2 reconnects pupils automatically and uses multi-role staff permissions.


Version 6 adds continuing multi-subject pupil accounts, shared classes with several teachers, and a controlled path for moving an independently-run class into a later school-wide workspace without losing its learning history.

## Replace these files

At the repository root, replace:

- `firestore.rules`
- `styles.css`
- `VERSION.txt`
- `UPDATE-GUIDE-V6.md`

Inside `js`, replace:

- `app.js`
- `firebase-service.js`

Do not replace `js/firebase-config.js`.

After committing the GitHub changes, copy the full contents of the new `firestore.rules` into Firebase Console → Firestore Database → Rules and click **Publish**.

Then wait for GitHub Pages to update and reload with **Ctrl + Shift + R**.

## Existing pupil joins another subject or class

1. The additional teacher creates a pupil code for the class.
2. The pupil signs in to the same FeedbackLoop account they already use.
3. They click **Join another class**.
4. They enter the new class code and check the class name, subject and workspace.
5. They confirm the join.

The pupil keeps the same Firebase UID, learner ID, login and earlier feedback. If the new class belongs to another independent teacher workspace, FeedbackLoop adds that workspace to the pupil's account and shows the workspace switcher.

## Assign several teachers to one class

A department head, school administrator or individual-workspace owner opens **Manage teachers** for the class and ticks every teacher who shares it. Saving replaces the class teacher list with the selected names.

An independent teacher can also create a **Co-teacher code**. Another teacher adds this code through **Add another teacher workspace**. They are automatically linked to the shared class.

## Move an independent class into a school workspace

The teacher must first add the school workspace to the same account using its teacher department code.

1. Switch back to the individual teacher workspace.
2. Open **My classes**.
3. Select **Move to school** on the class.
4. Choose the destination school, department and subject.
5. Submit the request.
6. A destination school administrator or relevant department head approves it.
7. The original teacher switches to the destination school workspace.
8. Under **Class moves**, select **Copy class and history**.

FeedbackLoop copies:

- the class structure;
- pupil memberships and target grades;
- assessment results;
- feedback records, including rich-text strengths and next steps;
- pupil reflections and actions;
- interventions;
- co-teacher assignments for teachers who have already joined the destination school.

The individual copy remains as a historical backup. The copied records contain migration-origin fields so portfolio exports can avoid showing the same record twice.

## Reconnect pupils to the school workspace

After the class has been copied:

1. The teacher creates a pupil code for the new school copy of the class.
2. Existing pupils sign in to their current account.
3. They use **Join another class** and enter the new school class code.

FeedbackLoop recognises the same pupil UID and exposes the already-copied feedback history in the school workspace. No new pupil account or learner ID is created.

## Important pilot note

Continue using fictional test accounts until the Firestore rules have been emulator-tested and the privacy/compliance documents have been completed for real pupil use.
