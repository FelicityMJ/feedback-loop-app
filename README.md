# FeedbackLoop

A static GitHub/Firebase school feedback platform based on the workflow in `Feedback_Tracker_Pro_Microsoft_Teams_v4.xlsx`.

## What is already built

- Four roles: school administrator, department head, teacher and pupil.
- School → department → subject → class structure.
- Role-scoped reusable codes: administrators create department-head codes, department heads create teacher department codes, and teachers create pupil class codes.
- Department heads can assign joined teachers to classes.
- Pupil-created feedback records with type-driven fields for verbal feedback, prelims, tests, homework, coursework and practical work.
- Autosaved drafts that can be continued the next day, with a visible save status.
- Live teacher monitoring of pupil drafts through Firestore realtime updates.
- Rich pupil notes with bold text and yellow, green, pink or blue highlighting.
- Assessment results, percentages, detailed A1–D8 grades and target grades.
- Pupil grade-versus-target graph.
- Strengths, next steps and traffic-light feedback.
- Pupil reflection, action evidence, optional teacher review and closed feedback loops.
- Whole-class teacher dashboard and individual pupil dashboard.
- Department overview and multi-indicator at-risk flags.
- Intervention records.
- Permanent learner ID independent of email address.
- School-authorised email change workflow.
- Destination-school transfer request and acceptance workflow.
- Pupil downloads: CSV, JSON and printable report/PDF.
- Demo mode with realistic example data.
- Firebase Authentication, Firestore integration and security rules.

## Open the demo

The app automatically runs in demo mode while `js/firebase-config.js` still contains placeholder values.

Because the app uses JavaScript modules, preview it through a small local web server rather than double-clicking `index.html`:

```bash
python -m http.server 8000
```

Then open `http://localhost:8000`.

The easiest route for the owner is to upload the folder to GitHub Pages and preview the supplied demo there before connecting Firebase.

## Important pilot limitation

The transfer workflow moves the pupil account and shares a concise learner summary. Full historical records remain visible to the pupil and downloadable, but are not automatically copied into the destination school's database in this first version. That protects old-school records while the governance and consent model is reviewed.

## Main files

- `index.html` — app entry point.
- `styles.css` — responsive visual design.
- `js/app.js` — dashboards and user interactions.
- `js/firebase-service.js` — authentication and Firestore data access.
- `js/firebase-config.js` — paste the Firebase web configuration here.
- `firestore.rules` — database access rules.
- `firestore.indexes.json` — suggested indexes.
- `SETUP-GUIDE.md` — exact owner setup steps.
- `PRIVACY-AND-PILOT-CHECKLIST.md` — checks before using real pupil data.

## Recommended repository name

`feedback-loop-app`

This gives a GitHub Pages address such as:

`https://felicitymj.github.io/feedback-loop-app/`

## Licence

Copyright © 2026 Felicity Miller. All rights reserved.

This is proprietary software. See the `LICENSE` file for the full terms.

## V5 account options

FeedbackLoop now supports three entry routes:

1. **Sign in** — for an existing account, using email/password or Google.
2. **Join with code** — pupils use a class code and teachers use a department code.
3. **Teacher account** — an individual teacher creates a full private workspace without waiting for a school account.

An individual teacher can later add a school workspace to the same account using a department code. The top-bar workspace selector keeps personal and school data separate.

Pupil accounts use real full names. Email/password pupils can receive a secure password-reset email; Google pupils recover access through their Google account.

## Version 6: continuing accounts and school adoption

- Pupils can join additional classes and subjects from inside their existing account.
- One pupil login can hold memberships in several independent or school workspaces.
- Classes can be assigned to several teachers.
- Individual-workspace owners can create co-teacher class codes.
- Independently-run classes can be copied into a later school-wide workspace with results, feedback, reflections and interventions preserved.
- Existing pupils reconnect to the migrated school class with the same account and learner ID.

See `UPDATE-GUIDE-V6.md` and `WORKSPACE-AND-MIGRATION-DESIGN-V6.md`.
