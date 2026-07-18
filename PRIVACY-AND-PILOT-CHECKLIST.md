# FeedbackLoop — privacy and pilot checklist

Do not load real pupil records until these points have been agreed with the school or local-authority data-protection lead.

## Governance

- Confirm who is the data controller for the pilot.
- Confirm whether the Firebase/Google services are approved for this type of pupil data.
- Complete a Data Protection Impact Assessment before live processing.
- Record the lawful basis for processing assessment, feedback and intervention information.
- Agree a child-friendly privacy notice for pupils and a parent/carer notice where required.
- Agree who can create schools, administrators and transfer codes.

The ICO says a DPIA should begin early in the design of a child-facing service and should identify, assess and mitigate risks before processing starts. Its edtech guidance also makes clear that ordinary data-protection requirements still apply to educational technology.

## Data minimisation

- Do not store safeguarding disclosures in FeedbackLoop.
- Do not store medical, special-category or disciplinary information in ordinary feedback fields.
- Keep private teacher notes short, factual and educationally necessary.
- Decide whether intervention records should be visible only to named staff rather than all school staff.
- Do not use the at-risk score as an automated decision. It is a prompt for professional review.

## Access testing

Before launch, create fictional accounts and confirm:

- a pupil sees only their own assessment and feedback records;
- a pupil cannot edit teacher feedback or grades;
- a teacher cannot obtain another school's records;
- a former school cannot read records created after transfer;
- a destination school sees only the transfer summary before acceptance;
- confidential teacher notes never appear in pupil CSV, JSON or printable reports;
- email changes require school approval and verification of the new address.

## Retention and deletion

Agree and document:

- how long assessment and feedback records are retained;
- how long closed transfer requests are retained;
- when unused invitation codes expire;
- what happens when a pupil leaves without transferring;
- how a subject-access request or correction request will be handled;
- how account deletion differs from deletion of the school's statutory education record.

## Security before a live pilot

- Use a school-controlled Firebase/Google account, not a personal account, for the live project.
- Turn on multi-factor authentication for project administrators.
- Restrict the number of school-administrator accounts.
- Use long random invitation and transfer codes.
- Disable codes immediately after accidental disclosure.
- Review Firestore rules with an experienced developer or the council's approved technical team.
- Set budget and usage alerts in Google Cloud/Firebase.
- Keep a tested export and recovery procedure.
- Record changes to permissions and transfers in an audit log before wider rollout.

## Recommended pilot sequence

1. Demo mode with built-in fictional data.
2. Connected Firebase project using fictional users only.
3. Staff-only pilot with no pupil login.
4. Small approved class pilot.
5. Review access logs, pupil experience and data-protection controls.
6. Department rollout only after sign-off.

## Important technical note

The supplied Firestore rules enforce school and role boundaries, but a production rollout should add stricter class-level access grants or trusted server-side custom claims so ordinary teachers cannot list unrelated pupil profiles within the same school. The current version is appropriate for development and a controlled fictional-data pilot, not an unreviewed school-wide launch.
