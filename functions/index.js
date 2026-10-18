const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

initializeApp();

const db = getFirestore();
const auth = getAuth();

function rolesFrom(data = {}) {
  const roles = { ...(data.roles || {}) };
  if (data.role === "schoolAdmin") roles.schoolAdmin = true;
  if (data.role === "departmentHead") {
    roles.departmentHead = true;
    roles.teacher = true;
  }
  if (data.role === "teacher") roles.teacher = true;
  if (data.role === "pupil") roles.pupil = true;
  if (roles.departmentHead) roles.teacher = true;
  return roles;
}

function cleanString(value) {
  return String(value || "").trim();
}

async function workspaceRecord(uid, schoolId) {
  const snap = await db.doc(`users/${uid}/workspaces/${schoolId}`).get();
  if (!snap.exists || snap.data().active === false) return null;
  return snap.data();
}

async function pupilIsInTeacherClass(staffUid, pupilUid, schoolId) {
  const [classSnap, membershipSnap] = await Promise.all([
    db.collection(`schools/${schoolId}/classes`).where("teacherIds", "array-contains", staffUid).get(),
    db.collection(`schools/${schoolId}/memberships`).where("userId", "==", pupilUid).get()
  ]);
  const teacherClassIds = new Set(classSnap.docs.filter((doc) => doc.data().active !== false).map((doc) => doc.id));
  return membershipSnap.docs.some((doc) => {
    const membership = doc.data();
    return membership.active !== false && teacherClassIds.has(membership.classId);
  });
}

async function pupilIsInHeadDepartment(headWorkspace, pupilUid, schoolId) {
  const headIds = new Set([
    ...(headWorkspace.departmentHeadDepartmentIds || []),
    ...(headWorkspace.departmentIds || [])
  ]);
  if (!headIds.size) return false;
  const membershipSnap = await db.collection(`schools/${schoolId}/memberships`).where("userId", "==", pupilUid).get();
  for (const membershipDoc of membershipSnap.docs) {
    const membership = membershipDoc.data();
    if (membership.active === false || !membership.classId) continue;
    const classSnap = await db.doc(`schools/${schoolId}/classes/${membership.classId}`).get();
    if (classSnap.exists && classSnap.data().active !== false && headIds.has(classSnap.data().departmentId)) return true;
  }
  return false;
}

exports.setPupilTemporaryPassword = onCall({ region: "europe-west2" }, async (request) => {
  if (!request.auth?.uid) throw new HttpsError("unauthenticated", "Sign in as a member of staff first.");

  const schoolId = cleanString(request.data?.schoolId);
  const pupilId = cleanString(request.data?.pupilId);
  const temporaryPassword = String(request.data?.temporaryPassword || "");
  if (!schoolId || !pupilId) throw new HttpsError("invalid-argument", "Choose a pupil from one of your classes.");
  if (temporaryPassword.length < 8) throw new HttpsError("invalid-argument", "Use a temporary password with at least 8 characters.");
  if (temporaryPassword.length > 128) throw new HttpsError("invalid-argument", "The temporary password is too long.");

  const [staffWorkspace, pupilWorkspace] = await Promise.all([
    workspaceRecord(request.auth.uid, schoolId),
    workspaceRecord(pupilId, schoolId)
  ]);
  if (!staffWorkspace) throw new HttpsError("permission-denied", "You do not have access to this school workspace.");
  if (!pupilWorkspace || !rolesFrom(pupilWorkspace).pupil) throw new HttpsError("not-found", "That pupil is not active in this workspace.");
  if (pupilWorkspace.authProvider === "google") throw new HttpsError("failed-precondition", "This pupil signs in with Google and does not have a FeedbackLoop password.");

  const staffRoles = rolesFrom(staffWorkspace);
  let permitted = staffRoles.schoolAdmin === true;
  if (!permitted && staffRoles.teacher) permitted = await pupilIsInTeacherClass(request.auth.uid, pupilId, schoolId);
  if (!permitted && staffRoles.departmentHead) permitted = await pupilIsInHeadDepartment(staffWorkspace, pupilId, schoolId);
  if (!permitted) throw new HttpsError("permission-denied", "You can only reset passwords for pupils you are authorised to manage.");

  try {
    await auth.updateUser(pupilId, { password: temporaryPassword });
    await auth.revokeRefreshTokens(pupilId);
  } catch (error) {
    console.error("Unable to set temporary pupil password", error);
    throw new HttpsError("internal", "Firebase could not set that temporary password.");
  }

  const now = FieldValue.serverTimestamp();
  await db.doc(`users/${pupilId}`).set({
    mustChangePassword: true,
    temporaryPasswordSetAt: now,
    temporaryPasswordSetBy: request.auth.uid,
    updatedAt: now
  }, { merge: true });
  await db.collection(`schools/${schoolId}/auditLogs`).add({
    action: "temporaryPasswordSet",
    userId: request.auth.uid,
    targetUserId: pupilId,
    createdAt: now
  });

  return { ok: true, mustChangePassword: true };
});

exports.completeTemporaryPasswordChange = onCall({ region: "europe-west2" }, async (request) => {
  if (!request.auth?.uid) throw new HttpsError("unauthenticated", "Sign in with your temporary password first.");
  const newPassword = String(request.data?.newPassword || "");
  if (newPassword.length < 8) throw new HttpsError("invalid-argument", "Choose a new password with at least 8 characters.");
  if (newPassword.length > 128) throw new HttpsError("invalid-argument", "The password is too long.");

  const userRef = db.doc(`users/${request.auth.uid}`);
  const userSnap = await userRef.get();
  if (!userSnap.exists) throw new HttpsError("not-found", "Your FeedbackLoop profile could not be found.");
  const profile = userSnap.data();
  if (profile.mustChangePassword !== true) throw new HttpsError("failed-precondition", "A temporary-password change is not required for this account.");

  try {
    await auth.updateUser(request.auth.uid, { password: newPassword });
  } catch (error) {
    console.error("Unable to complete temporary-password change", error);
    throw new HttpsError("internal", "Firebase could not save the new password.");
  }

  const now = FieldValue.serverTimestamp();
  await userRef.set({
    mustChangePassword: false,
    temporaryPasswordSetAt: FieldValue.delete(),
    temporaryPasswordSetBy: FieldValue.delete(),
    passwordChangedAt: now,
    updatedAt: now
  }, { merge: true });

  if (profile.schoolId) {
    await db.collection(`schools/${profile.schoolId}/auditLogs`).add({
      action: "temporaryPasswordChangedByPupil",
      userId: request.auth.uid,
      createdAt: now
    });
  }

  return { ok: true };
});
