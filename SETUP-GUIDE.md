# FeedbackLoop — exact setup guide

This version deliberately follows the same simple pattern as the existing `python-practice-app`: static files in GitHub Pages, with Firebase Authentication and Firestore supplying the accounts and data.

Do the sections in order. You do not need to edit the large `app.js` file.

---

## Part 1 — preview the finished demo first

1. Create a new GitHub repository called `feedback-loop-app`.
2. Make it **Public** if you are using GitHub Pages on a free GitHub account.
3. Upload every file and folder from this package, including:
   - `.nojekyll`
   - `index.html`
   - `styles.css`
   - the complete `js` folder
   - `firestore.rules`
   - `firestore.indexes.json`
4. Commit the files to the `main` branch.
5. In GitHub, open **Settings → Pages**.
6. Under **Build and deployment**, choose:
   - Source: **Deploy from a branch**
   - Branch: **main**
   - Folder: **/(root)**
7. Save.
8. Open:

   `https://felicitymj.github.io/feedback-loop-app/`

Because the Firebase configuration still contains placeholders, the site will open in **demo mode**. Use the four demo buttons to inspect the pupil, teacher, department-head and school-administrator dashboards.

---

## Part 2 — create a separate Firebase project

Use a separate project rather than putting school feedback records inside `python-practice-5b289`. It keeps ComputingNat5 practice data and school feedback data isolated.

1. Open Firebase Console.
2. Choose **Create a project**.
3. Suggested project name: `feedback-loop-school`.
4. Google Analytics is not needed for the first version.
5. When the project opens, select the **Web app** icon.
6. App nickname: `FeedbackLoop web`.
7. Do not enable Firebase Hosting at this stage because GitHub Pages is hosting the files.
8. Select **Register app**.
9. Firebase shows a configuration object beginning with:

```javascript
const firebaseConfig = {
  apiKey: "...",
  authDomain: "...",
  projectId: "..."
};
```

10. In the GitHub repository, open `js/firebase-config.js`.
11. Select the pencil/edit button.
12. Replace only the placeholder values inside `firebaseConfig` with the values Firebase supplied.
13. Change `publicAppUrl` to:

```javascript
publicAppUrl: "https://felicitymj.github.io/feedback-loop-app/"
```

14. Commit the change.

Once that commit publishes, demo mode turns off and the site connects to Firebase.

---

## Part 3 — enable sign-in

1. In Firebase Console, open **Build → Authentication**.
2. Select **Get started**.
3. Open the **Sign-in method** tab.
4. Enable **Email/Password**.
5. Enable **Google** as well.
6. Open **Authentication → Settings → Authorised domains**.
7. Add:

   `felicitymj.github.io`

This is required for Google sign-in and email-action links opened from the GitHub Pages site.

---

## Part 4 — create Firestore

1. Open **Build → Firestore Database**.
2. Select **Create database**.
3. Choose **Production mode**.
4. Select the London region used for the other app: **europe-west2**.
5. Create the database.

Do not add pupil data yet.

---

## Part 5 — publish the supplied Firestore rules

1. In the GitHub repository, open `firestore.rules`.
2. Copy the entire file.
3. In Firebase Console, open **Firestore Database → Rules**.
4. Replace the existing rules with the copied rules.
5. Select **Publish**.

The rules separate schools, keep pupil records linked to their permanent Firebase user ID, and stop pupils editing teacher feedback.

### Indexes

Most queries use Firestore's automatic indexes. If Firebase displays an error saying an index is required, open the link in the error and select **Create index**.

The supplied `firestore.indexes.json` is also ready for later Firebase CLI deployment.

---

## Part 6 — create the first school administrator

This is the only account created manually. After this, invitations are generated inside the app.

### A. Create the sign-in account

1. Open **Authentication → Users**.
2. Select **Add user**.
3. Enter your email address and a temporary strong password.
4. Create the user.
5. Copy the user's **User UID**.

### B. Create the school document

1. Open **Firestore Database → Data**.
2. Select **Start collection**.
3. Collection ID:

   `schools`

4. Document ID: use a permanent lower-case school ID, for example:

   `oldmachar-academy`

5. Add these fields:

| Field | Type | Example value |
|---|---|---|
| `name` | string | `Oldmachar Academy` |
| `shortName` | string | `Oldmachar` |
| `active` | boolean | `true` |
| `transferCode` | string | `oldmachar-academy~CHANGE-THIS-TO-A-LONG-RANDOM-CODE` |

The text before `~` must exactly match the document ID. Make the text after `~` long and hard to guess.

### C. Create your administrator profile

1. Go back to the Firestore root.
2. Start a collection called:

   `users`

3. Use your copied Firebase **User UID** as the document ID.
4. Add these fields:

| Field | Type | Value |
|---|---|---|
| `displayName` | string | Your name |
| `email` | string | The same email used in Authentication |
| `role` | string | `schoolAdmin` |
| `schoolId` | string | The exact school document ID |
| `departmentIds` | array | Empty array |
| `schoolHistoryIds` | array | Empty array |
| `active` | boolean | `true` |

5. Open the FeedbackLoop site and sign in.

You should now see the school-administrator dashboard.

---

## Part 7 — set up the school inside the app

Sign in as the school administrator and work in this order:

1. Open **School setup**.
2. Add the departments.
3. Add the subjects and connect each subject to its department.
4. Add classes.
5. Create staff invitation codes.
6. Give each teacher or department head only their own code.

For a department head invitation, select the correct department before generating the code.

For a teacher invitation, a department can be attached now; classes can be created or assigned after the teacher joins.

---

## Part 8 — add teachers and classes

1. The teacher opens the same site.
2. They choose **Join a school**.
3. They enter their name, school email, password and invitation code.
4. Their role and school come from the invitation code; they cannot choose a higher role themselves.
5. The teacher can create classes.
6. From **My classes**, choose **Pupil code** to create a pupil invitation code for a class.
7. Give the code only to pupils in that class.

A school administrator can also create pupil codes from **School setup**.

---

## Part 9 — add pupils

1. The pupil opens the site.
2. They choose **Join a school**.
3. They enter their school email and the class invitation code.
4. Firebase creates a permanent user UID.
5. FeedbackLoop creates a separate `learnerId` such as `L-2F4A9D7C`.
6. The learner ID remains stable if their email or school later changes.

The pupil then sees only subjects attached to their class memberships.

---

## Part 10 — everyday teacher workflow

1. Open **Assessments & feedback**.
2. Add an assessment result to build the grade graph.
3. Add feedback with:
   - assessment/activity;
   - skill or topic;
   - strength;
   - precise next step;
   - traffic light;
   - optional private teacher note.
4. The pupil opens **My feedback loops**.
5. They explain what the feedback means and record the action they took.
6. The teacher selects **Review action**.
7. Approving the evidence closes the loop; returning it opens the loop again.

---

## Part 11 — changing a pupil's school email

Do this before the old school account is disabled.

1. The pupil opens **Account & transfer**.
2. They select **Request email change**.
3. They enter a personal email or their new-school email.
4. The school administrator opens **Transfers & email**.
5. The administrator approves the request.
6. The pupil returns to the page and selects **Send verification to new email**.
7. Firebase sends a verification link to the new address.
8. When the pupil opens the link, Firebase changes the login email but keeps the same UID and learner profile.
9. On the next sign-in, FeedbackLoop synchronises the verified email into the pupil profile.

The old school email is no longer the identity of the account.

---

## Part 12 — transferring to another participating school

1. The destination school's administrator gives the pupil its `transferCode`.
2. The pupil opens **Account & transfer → Request transfer**.
3. The pupil chooses:
   - **Summary transfer**; or
   - **Start fresh**, keeping old history private.
4. The destination school administrator opens **Transfers & email**.
5. They review the pupil's learner summary and accept or decline.
6. The pupil selects **Complete transfer** after acceptance.
7. The pupil account moves to the new school but keeps the same Firebase UID and learner ID.
8. Old feedback remains pupil-visible and downloadable.
9. The old school retains its own historical records but does not see records created by the new school.

The first version shares a concise summary rather than copying the full old-school database into the new school.

---

## Part 13 — downloading the pupil record

From **My learning record**, a pupil can choose:

- **Download spreadsheet** — CSV file;
- **Download data** — structured JSON backup;
- **Printable PDF** — opens the print view, then choose **Save as PDF**.

Teacher-only notes and interventions are excluded from the pupil export.

---

## Part 14 — before real pupil use

Use only fictional test pupils until the school or local authority has approved the pilot.

Complete the separate `PRIVACY-AND-PILOT-CHECKLIST.md`, including a DPIA, privacy information, retention rules, access testing and a review of the Firebase/Google terms used by the school.
