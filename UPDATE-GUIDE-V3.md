# FeedbackLoop v3 update

This update changes feedback entry to a pupil-owned, autosaving workflow.

## Files that changed

Upload these files to the same locations in your GitHub repository:

- `js/app.js`
- `js/firebase-service.js`
- `js/demo-data.js`
- `styles.css`
- `firestore.rules`
- `README.md`
- `SETUP-GUIDE.md`

You may instead upload the complete contents of the updated project and allow GitHub to replace files with the same names.

## Essential Firebase step

After uploading the website files:

1. Open Firebase Console.
2. Open **Firestore Database → Rules**.
3. Copy all of the updated `firestore.rules` file from GitHub.
4. Replace the old rules in Firebase.
5. Select **Publish**.

Without the updated rules, pupils will see a permission error when the app tries to autosave their drafts.

## How to test it

1. Open the GitHub Pages website in demo mode.
2. Enter as **Pupil**.
3. Open **My feedback record**.
4. Select **New feedback record**.
5. Choose **Verbal** and check that the result fields disappear.
6. Choose **Prelim** and check that the result and paper/section fields appear.
7. Enter `42` out of `50`; the app should show `84% · A2`.
8. Type a next step, make part of it bold and apply a coloured highlight.
9. Wait for the status to change from **Unsaved changes** to **Saving…** and then **Saved at…**.
10. Close the editor. The record should appear under **Continue a draft**.
11. Continue the draft and select **Finish and add to my record**.
12. Switch the demo role to **Teacher** and open **Live feedback** to see the submitted record.

For a true simultaneous live test, connect Firebase and open the pupil and teacher accounts on two separate browsers or devices.
