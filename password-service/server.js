const express = require("express");
const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

initializeApp();

const app = express();
const auth = getAuth();
const db = getFirestore();

app.use(express.json({ limit: "32kb" }));

app.use((req, res, next) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.set("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.status(204).send("");
  next();
});

function cleanString(value) {
  return String(value || "").trim();
}

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

async function verifyCaller(req) {
  const header = cleanString(req.get("authorization"));
  if (!header.toLowerCase().startsWith("bearer ")) {
    const error = new Error("Sign in to FeedbackSteps first.");
    error.status = 401;
    throw error;
  }
  const token = header.slice(7).trim();
  try {
    return await auth.verifyIdToken(token, true);
  } catch (cause) {
    const error = new Error("Your sign-in is no longer valid. Sign in again and retry.");
    error.status = 401;
    error.cause = cause;
    throw error;
  }
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
  const teacherClassIds = new Set(
    classSnap.docs.filter((doc) => doc.data().active !== false).map((doc) => doc.id)
  );
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

  const membershipSnap = await db
    .collection(`schools/${schoolId}/memberships`)
    .where("userId", "==", pupilUid)
    .get();

  for (const membershipDoc of membershipSnap.docs) {
    const membership = membershipDoc.data();
    if (membership.active === false || !membership.classId) continue;
    const classSnap = await db.doc(`schools/${schoolId}/classes/${membership.classId}`).get();
    if (
      classSnap.exists &&
      classSnap.data().active !== false &&
      headIds.has(classSnap.data().departmentId)
    ) return true;
  }
  return false;
}

async function setTemporaryPassword(callerUid, body) {
  const schoolId = cleanString(body.schoolId);
  const pupilId = cleanString(body.pupilId);
  const temporaryPassword = String(body.temporaryPassword || "");

  if (!schoolId || !pupilId) {
    const error = new Error("Choose a pupil from one of your classes.");
    error.status = 400;
    throw error;
  }
  if (temporaryPassword.length < 8) {
    const error = new Error("Use a temporary password with at least 8 characters.");
    error.status = 400;
    throw error;
  }
  if (temporaryPassword.length > 128) {
    const error = new Error("The temporary password is too long.");
    error.status = 400;
    throw error;
  }

  const [staffWorkspace, pupilWorkspace] = await Promise.all([
    workspaceRecord(callerUid, schoolId),
    workspaceRecord(pupilId, schoolId)
  ]);

  if (!staffWorkspace) {
    const error = new Error("You do not have access to this school workspace.");
    error.status = 403;
    throw error;
  }
  if (!pupilWorkspace || !rolesFrom(pupilWorkspace).pupil) {
    const error = new Error("That pupil is not active in this workspace.");
    error.status = 404;
    throw error;
  }
  if (pupilWorkspace.authProvider === "google") {
    const error = new Error("This pupil signs in with Google and does not have a FeedbackSteps password.");
    error.status = 409;
    throw error;
  }

  const staffRoles = rolesFrom(staffWorkspace);
  let permitted = staffRoles.schoolAdmin === true;
  if (!permitted && staffRoles.teacher) {
    permitted = await pupilIsInTeacherClass(callerUid, pupilId, schoolId);
  }
  if (!permitted && staffRoles.departmentHead) {
    permitted = await pupilIsInHeadDepartment(staffWorkspace, pupilId, schoolId);
  }
  if (!permitted) {
    const error = new Error("You can only reset passwords for pupils you are authorised to manage.");
    error.status = 403;
    throw error;
  }

  await auth.updateUser(pupilId, { password: temporaryPassword });
  await auth.revokeRefreshTokens(pupilId);

  const now = FieldValue.serverTimestamp();
  await db.doc(`users/${pupilId}`).set({
    mustChangePassword: true,
    temporaryPasswordSetAt: now,
    temporaryPasswordSetBy: callerUid,
    updatedAt: now
  }, { merge: true });

  await db.collection(`schools/${schoolId}/auditLogs`).add({
    action: "temporaryPasswordSet",
    userId: callerUid,
    targetUserId: pupilId,
    createdAt: now
  });

  return { ok: true, mustChangePassword: true };
}

async function completePasswordChange(callerUid, body) {
  const newPassword = String(body.newPassword || "");
  if (newPassword.length < 8) {
    const error = new Error("Choose a new password with at least 8 characters.");
    error.status = 400;
    throw error;
  }
  if (newPassword.length > 128) {
    const error = new Error("The password is too long.");
    error.status = 400;
    throw error;
  }

  const userRef = db.doc(`users/${callerUid}`);
  const userSnap = await userRef.get();
  if (!userSnap.exists) {
    const error = new Error("Your FeedbackSteps profile could not be found.");
    error.status = 404;
    throw error;
  }

  const profile = userSnap.data();
  if (profile.mustChangePassword !== true) {
    const error = new Error("A temporary-password change is not required for this account.");
    error.status = 409;
    throw error;
  }

  await auth.updateUser(callerUid, { password: newPassword });

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
      userId: callerUid,
      createdAt: now
    });
  }

  return { ok: true };
}

app.get("/", (_req, res) => {
  res.json({ ok: true, service: "FeedbackSteps password service" });
});

app.post("/", async (req, res) => {
  try {
    const decoded = await verifyCaller(req);
    const action = cleanString(req.body?.action);
    let result;

    if (action === "setTemporaryPassword") {
      result = await setTemporaryPassword(decoded.uid, req.body || {});
    } else if (action === "completePasswordChange") {
      result = await completePasswordChange(decoded.uid, req.body || {});
    } else {
      const error = new Error("The password action was not recognised.");
      error.status = 400;
      throw error;
    }

    res.status(200).json(result);
  } catch (error) {
    console.error(error);
    res.status(Number(error.status) || 500).json({
      ok: false,
      error: Number(error.status) ? error.message : "The password service could not complete that request."
    });
  }
});

const port = Number(process.env.PORT) || 8080;
app.listen(port, () => {
  console.log(`FeedbackSteps password service listening on ${port}`);
});
