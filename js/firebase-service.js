import { firebaseConfig, appSettings, firebaseIsConfigured } from "./firebase-config.js";
import { demoData, demoRoleUsers, DEMO_SCHOOL_ID } from "./demo-data.js";

export const isDemoMode = appSettings.forceDemoMode || !firebaseIsConfigured;

let app = null;
let auth = null;
let db = null;
let initializeApp, getAuth, onAuthStateChanged, signInWithEmailAndPassword;
let createUserWithEmailAndPassword, firebaseSignOut, sendPasswordResetEmail;
let sendEmailVerification, GoogleAuthProvider, signInWithPopup, updateProfile, deleteUser;
let verifyBeforeUpdateEmail, getFirestore, doc, getDoc, getDocs, setDoc;
let addDoc, updateDoc, deleteDoc, collection, query, where, limit, onSnapshot;
let serverTimestamp, writeBatch, arrayUnion;

const firebaseReady = isDemoMode ? Promise.resolve() : Promise.all([
  import("https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js"),
  import("https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js"),
  import("https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js")
]).then(([appMod, authMod, firestoreMod]) => {
  ({ initializeApp } = appMod);
  ({
    getAuth, onAuthStateChanged, signInWithEmailAndPassword,
    createUserWithEmailAndPassword, signOut: firebaseSignOut,
    sendPasswordResetEmail, sendEmailVerification, GoogleAuthProvider,
    signInWithPopup, updateProfile, deleteUser, verifyBeforeUpdateEmail
  } = authMod);
  ({
    getFirestore, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc,
    collection, query, where, limit, onSnapshot, serverTimestamp, writeBatch, arrayUnion
  } = firestoreMod);
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  auth.useDeviceLanguage();
  db = getFirestore(app);
});

const clone = (value) => JSON.parse(JSON.stringify(value));
const makeUuid = () => {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};
const randomId = (prefix = "") => `${prefix}${makeUuid().replaceAll("-", "").slice(0, 12)}`;
const learnerId = () => `L-${makeUuid().replaceAll("-", "").slice(0, 8).toUpperCase()}`;
const asDateValue = (value) => {
  if (!value) return value;
  if (typeof value?.toDate === "function") return value.toDate().toISOString();
  return value;
};
const normaliseDoc = (snap) => {
  const data = snap.data();
  return Object.fromEntries(
    Object.entries({ id: snap.id, ...data }).map(([key, value]) => [key, asDateValue(value)])
  );
};

const demoStorageKey = "feedbackLoopDemoStateV2";
const demoUserKey = "feedbackLoopDemoUserV2";

function getDemoState() {
  const stored = localStorage.getItem(demoStorageKey);
  if (stored) return JSON.parse(stored);
  const initial = clone(demoData);
  localStorage.setItem(demoStorageKey, JSON.stringify(initial));
  return initial;
}

function saveDemoState(state) {
  localStorage.setItem(demoStorageKey, JSON.stringify(state));
  window.dispatchEvent(new CustomEvent("feedbackloop-demo-state-changed", { detail: clone(state) }));
}

function getDemoUser() {
  const id = localStorage.getItem(demoUserKey);
  if (!id) return null;
  const state = getDemoState();
  return state.users.find((u) => u.id === id) || null;
}

function findSchoolDocPath(schoolId, group, id) {
  return doc(db, "schools", schoolId, group, id);
}

async function fetchCollection(pathParts, constraints = []) {
  const ref = collection(db, ...pathParts);
  const q = constraints.length ? query(ref, ...constraints) : ref;
  const snap = await getDocs(q);
  return snap.docs.map(normaliseDoc);
}

async function safeFetch(pathParts, constraints = []) {
  try {
    return await fetchCollection(pathParts, constraints);
  } catch (error) {
    console.warn("Optional collection could not be loaded", pathParts.join("/"), error);
    return [];
  }
}

export function observeAuth(callback) {
  if (isDemoMode) {
    queueMicrotask(() => callback(getDemoUser()));
    return () => {};
  }
  let unsubscribe = () => {};
  firebaseReady
    .then(() => { unsubscribe = onAuthStateChanged(auth, callback); })
    .catch((error) => { console.error("Firebase could not start", error); callback(null); });
  return () => unsubscribe();
}


export function observeSchoolFeedback(profile, callback, errorCallback = console.error) {
  if (!profile?.schoolId) return () => {};
  if (isDemoMode) {
    const emit = () => callback(clone(getDemoState().feedbackRecords || []));
    const handler = () => emit();
    window.addEventListener("feedbackloop-demo-state-changed", handler);
    queueMicrotask(emit);
    return () => window.removeEventListener("feedbackloop-demo-state-changed", handler);
  }

  let unsubscribe = () => {};
  let cancelled = false;
  firebaseReady.then(() => {
    if (cancelled) return;
    const base = collection(db, "schools", profile.schoolId, "feedbackRecords");
    const ref = profile.role === "pupil"
      ? query(base, where("pupilId", "==", profile.id))
      : base;
    unsubscribe = onSnapshot(ref, (snapshot) => {
      callback(snapshot.docs.map(normaliseDoc));
    }, errorCallback);
  }).catch(errorCallback);

  return () => {
    cancelled = true;
    unsubscribe();
  };
}

export async function demoSignInAs(role) {
  const id = demoRoleUsers[role];
  if (!id) throw new Error("Unknown demo role.");
  localStorage.setItem(demoUserKey, id);
  return getDemoUser();
}

export async function signIn(email, password) {
  if (isDemoMode) {
    const state = getDemoState();
    const user = state.users.find((u) => u.email.toLowerCase() === email.toLowerCase());
    if (!user) throw new Error("Use one of the demo role buttons below.");
    localStorage.setItem(demoUserKey, user.id);
    return user;
  }
  await firebaseReady;
  const result = await signInWithEmailAndPassword(auth, email, password);
  return result.user;
}

export async function signInWithGoogle() {
  if (isDemoMode) return demoSignInAs("teacher");
  await firebaseReady;
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  const result = await signInWithPopup(auth, provider);
  return result.user;
}

export async function resetPassword(email) {
  if (isDemoMode) return;
  await firebaseReady;
  await sendPasswordResetEmail(auth, email, { url: appSettings.publicAppUrl });
}

export async function signOut() {
  if (isDemoMode) {
    localStorage.removeItem(demoUserKey);
    return;
  }
  await firebaseReady;
  await firebaseSignOut(auth);
}

export async function registerWithInvite({ displayName, email, password, inviteCode }) {
  const code = inviteCode.trim();
  const schoolId = code.split("~")[0];
  if (!schoolId || !code.includes("~")) throw new Error("That invitation code is not in the expected format.");

  if (isDemoMode) {
    const state = getDemoState();
    const invite = state.invites.find((item) => item.id === code && item.active);
    if (!invite) throw new Error("That invitation code is not active.");
    const id = randomId("demo-");
    const user = {
      id,
      displayName,
      email,
      role: invite.role,
      schoolId: invite.schoolId,
      departmentIds: invite.departmentIds || [],
      learnerId: invite.role === "pupil" ? learnerId() : null,
      schoolHistoryIds: invite.role === "pupil" ? [invite.schoolId] : [],
      active: true,
      inviteCode: code
    };
    state.users.push(user);
    if (invite.role === "pupil") {
      for (const classId of invite.classIds || []) {
        const cls = state.classes.find((c) => c.id === classId);
        state.memberships.push({
          id: randomId("m-"),
          userId: id,
          classId,
          subjectId: cls?.subjectId || "",
          targetGrade: "",
          currentGrade: "",
          active: true
        });
      }
    }
    saveDemoState(state);
    localStorage.setItem(demoUserKey, id);
    return user;
  }

  await firebaseReady;
  const inviteRef = findSchoolDocPath(schoolId, "invites", code);
  const inviteSnap = await getDoc(inviteRef);
  if (!inviteSnap.exists() || inviteSnap.data().active !== true) throw new Error("That invitation code is not active.");
  const invite = inviteSnap.data();
  if (invite.emailRestriction && invite.emailRestriction.toLowerCase() !== email.toLowerCase()) {
    throw new Error("This invitation was issued for a different email address.");
  }

  let result;
  let createdNow = false;
  try {
    result = await createUserWithEmailAndPassword(auth, email, password);
    createdNow = true;
  } catch (error) {
    // A previous failed Firestore profile write can leave the Firebase Auth
    // account behind. Let that person sign in with the same password and
    // finish redeeming the invitation instead of forcing an administrator to
    // delete the account manually.
    if (error?.code !== "auth/email-already-in-use") throw error;
    result = await signInWithEmailAndPassword(auth, email, password);
    const existingProfile = await getDoc(doc(db, "users", result.user.uid));
    if (existingProfile.exists()) {
      throw new Error("This account already has a FeedbackLoop profile. Use Sign in instead.");
    }
  }

  await updateProfile(result.user, { displayName });
  const batch = writeBatch(db);
  const profile = {
    displayName,
    email,
    role: invite.role,
    schoolId,
    departmentIds: invite.departmentIds || [],
    learnerId: invite.role === "pupil" ? learnerId() : null,
    schoolHistoryIds: invite.role === "pupil" ? [schoolId] : [],
    active: true,
    inviteCode: code,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };
  batch.set(doc(db, "users", result.user.uid), profile);
  if (invite.role === "pupil") {
    for (const classId of invite.classIds || []) {
      const membershipRef = doc(collection(db, "schools", schoolId, "memberships"));
      batch.set(membershipRef, {
        userId: result.user.uid,
        classId,
        subjectId: invite.subjectId || "",
        targetGrade: "",
        currentGrade: "",
        active: true,
        inviteCode: code,
        createdAt: serverTimestamp()
      });
    }
  }
  try {
    await batch.commit();
  } catch (error) {
    // Authentication and Firestore are separate services. If this function
    // created the Auth account but Firestore rejected the profile batch,
    // remove the new Auth account so the person can retry cleanly.
    if (createdNow) {
      try {
        await deleteUser(result.user);
      } catch (cleanupError) {
        console.warn("Could not remove incomplete Firebase Auth account.", cleanupError);
      }
    }
    throw error;
  }
  await sendEmailVerification(result.user, { url: appSettings.publicAppUrl });
  return result.user;
}

export async function getUserProfile(user) {
  if (!user) return null;
  if (isDemoMode) return clone(getDemoState().users.find((u) => u.id === user.id) || user);
  await firebaseReady;
  const snap = await getDoc(doc(db, "users", user.uid));
  if (!snap.exists()) return null;
  const profile = normaliseDoc(snap);

  if (user.email && profile.email !== user.email) {
    const q = query(
      collection(db, "emailChangeRequests"),
      where("pupilId", "==", user.uid),
      where("newEmail", "==", user.email),
      where("status", "==", "approved"),
      limit(1)
    );
    const requests = await getDocs(q);
    if (!requests.empty) {
      const req = requests.docs[0];
      await updateDoc(doc(db, "users", user.uid), { email: user.email, updatedAt: serverTimestamp() });
      await updateDoc(req.ref, { status: "completed", completedAt: serverTimestamp() });
      profile.email = user.email;
    }
  }
  return profile;
}

export async function loadAppData(profile) {
  if (isDemoMode) return clone(getDemoState());
  await firebaseReady;
  const schoolId = profile.schoolId;
  const schoolSnap = await getDoc(doc(db, "schools", schoolId));
  const school = schoolSnap.exists() ? normaliseDoc(schoolSnap) : { id: schoolId, name: "School" };
  const isPupil = profile.role === "pupil";
  const staff = ["schoolAdmin", "departmentHead", "teacher"].includes(profile.role);

  const [departments, subjects, classes] = await Promise.all([
    safeFetch(["schools", schoolId, "departments"]),
    safeFetch(["schools", schoolId, "subjects"]),
    safeFetch(["schools", schoolId, "classes"])
  ]);

  const pupilConstraint = where("pupilId", "==", profile.id);
  const memberConstraint = where("userId", "==", profile.id);
  const [users, memberships, assessments, feedbackRecords, feedbackActions, interventions, invites] = await Promise.all([
    staff ? safeFetch(["users"], [where("schoolId", "==", schoolId)]) : Promise.resolve([profile]),
    isPupil ? safeFetch(["schools", schoolId, "memberships"], [memberConstraint]) : safeFetch(["schools", schoolId, "memberships"]),
    isPupil ? safeFetch(["schools", schoolId, "assessments"], [pupilConstraint]) : safeFetch(["schools", schoolId, "assessments"]),
    isPupil ? safeFetch(["schools", schoolId, "feedbackRecords"], [pupilConstraint]) : safeFetch(["schools", schoolId, "feedbackRecords"]),
    isPupil ? safeFetch(["schools", schoolId, "feedbackActions"], [pupilConstraint]) : safeFetch(["schools", schoolId, "feedbackActions"]),
    isPupil ? Promise.resolve([]) : safeFetch(["schools", schoolId, "interventions"]),
    profile.role === "schoolAdmin"
      ? safeFetch(["schools", schoolId, "invites"])
      : staff
        ? safeFetch(["schools", schoolId, "invites"], [where("createdBy", "==", profile.id)])
        : Promise.resolve([])
  ]);

  const [transferFrom, transferTo, emailChangeRequests] = await Promise.all([
    safeFetch(["transferRequests"], [where("fromSchoolId", "==", schoolId)]),
    safeFetch(["transferRequests"], [where("toSchoolId", "==", schoolId)]),
    isPupil
      ? safeFetch(["emailChangeRequests"], [where("pupilId", "==", profile.id)])
      : profile.role === "schoolAdmin"
        ? safeFetch(["emailChangeRequests"], [where("schoolId", "==", schoolId)])
        : Promise.resolve([])
  ]);

  return {
    school,
    departments,
    subjects,
    users,
    classes,
    memberships,
    assessments,
    feedbackRecords,
    feedbackActions,
    interventions,
    invites,
    transferRequests: [...transferFrom, ...transferTo].filter((x, i, arr) => arr.findIndex((y) => y.id === x.id) === i),
    emailChangeRequests
  };
}

export async function loadPupilPortfolio(profile) {
  if (isDemoMode) return clone(getDemoState());
  await firebaseReady;
  const schoolIds = [...new Set([...(profile.schoolHistoryIds || []), profile.schoolId].filter(Boolean))];
  const portfolio = {
    schools: [], departments: [], subjects: [], classes: [], memberships: [], assessments: [],
    feedbackRecords: [], feedbackActions: [], interventions: []
  };
  for (const schoolId of schoolIds) {
    const schoolSnap = await getDoc(doc(db, "schools", schoolId));
    if (schoolSnap.exists()) portfolio.schools.push(normaliseDoc(schoolSnap));
    const [subjects, classes, memberships, assessments, feedbackRecords, feedbackActions] = await Promise.all([
      safeFetch(["schools", schoolId, "subjects"]),
      safeFetch(["schools", schoolId, "classes"]),
      safeFetch(["schools", schoolId, "memberships"], [where("userId", "==", profile.id)]),
      safeFetch(["schools", schoolId, "assessments"], [where("pupilId", "==", profile.id)]),
      safeFetch(["schools", schoolId, "feedbackRecords"], [where("pupilId", "==", profile.id)]),
      safeFetch(["schools", schoolId, "feedbackActions"], [where("pupilId", "==", profile.id)])
    ]);
    portfolio.subjects.push(...subjects.map((x) => ({ ...x, schoolId })));
    portfolio.classes.push(...classes.map((x) => ({ ...x, schoolId })));
    portfolio.memberships.push(...memberships.map((x) => ({ ...x, schoolId })));
    portfolio.assessments.push(...assessments.map((x) => ({ ...x, schoolId })));
    portfolio.feedbackRecords.push(...feedbackRecords.map((x) => ({ ...x, schoolId })));
    portfolio.feedbackActions.push(...feedbackActions.map((x) => ({ ...x, schoolId })));
  }
  return portfolio;
}

export async function createSchoolEntity(schoolId, group, data) {
  if (isDemoMode) {
    const state = getDemoState();
    const targetKey = group;
    const item = { id: randomId(`${group.slice(0, 2)}-`), ...data, createdAt: new Date().toISOString() };
    if (!Array.isArray(state[targetKey])) throw new Error(`Unknown demo collection: ${group}`);
    state[targetKey].push(item);
    saveDemoState(state);
    return item;
  }
  await firebaseReady;
  const payload = { ...data, createdAt: serverTimestamp(), updatedAt: serverTimestamp() };
  const ref = await addDoc(collection(db, "schools", schoolId, group), payload);
  return { id: ref.id, ...data };
}

export async function updateSchoolEntity(schoolId, group, id, changes) {
  if (isDemoMode) {
    const state = getDemoState();
    const item = state[group]?.find((x) => x.id === id);
    if (!item) throw new Error("Record not found.");
    Object.assign(item, changes, { updatedAt: new Date().toISOString() });
    saveDemoState(state);
    return clone(item);
  }
  await firebaseReady;
  await updateDoc(findSchoolDocPath(schoolId, group, id), { ...changes, updatedAt: serverTimestamp() });
}

export async function deleteSchoolEntity(schoolId, group, id) {
  if (isDemoMode) {
    const state = getDemoState();
    state[group] = state[group].filter((x) => x.id !== id);
    saveDemoState(state);
    return;
  }
  await firebaseReady;
  await deleteDoc(findSchoolDocPath(schoolId, group, id));
}

export async function createInvite(schoolId, data) {
  const suffix = makeUuid().replaceAll("-", "").slice(0, 10).toUpperCase();
  const code = `${schoolId}~${suffix}`;
  const item = { id: code, schoolId, ...data, active: true, createdAt: new Date().toISOString() };
  if (isDemoMode) {
    const state = getDemoState();
    state.invites.push(item);
    saveDemoState(state);
    return item;
  }
  await firebaseReady;
  await setDoc(findSchoolDocPath(schoolId, "invites", code), {
    schoolId,
    ...data,
    active: true,
    createdAt: serverTimestamp()
  });
  return item;
}

export async function updateUserProfile(userId, changes) {
  if (isDemoMode) {
    const state = getDemoState();
    const user = state.users.find((x) => x.id === userId);
    if (!user) throw new Error("User not found.");
    Object.assign(user, changes, { updatedAt: new Date().toISOString() });
    saveDemoState(state);
    return clone(user);
  }
  await firebaseReady;
  await updateDoc(doc(db, "users", userId), { ...changes, updatedAt: serverTimestamp() });
}

export async function createEmailChangeRequest(profile, newEmail) {
  const payload = {
    pupilId: profile.id,
    schoolId: profile.schoolId,
    oldEmail: profile.email,
    newEmail: newEmail.trim().toLowerCase(),
    status: "requested",
    requestedAt: new Date().toISOString()
  };
  if (isDemoMode) {
    const state = getDemoState();
    const item = { id: randomId("email-"), ...payload };
    state.emailChangeRequests.push(item);
    saveDemoState(state);
    return item;
  }
  await firebaseReady;
  const ref = await addDoc(collection(db, "emailChangeRequests"), { ...payload, requestedAt: serverTimestamp() });
  return { id: ref.id, ...payload };
}

export async function approveEmailChangeRequest(requestId, approved, note = "") {
  const status = approved ? "approved" : "declined";
  if (isDemoMode) {
    const state = getDemoState();
    const req = state.emailChangeRequests.find((x) => x.id === requestId);
    Object.assign(req, { status, schoolNote: note, decidedAt: new Date().toISOString() });
    saveDemoState(state);
    return;
  }
  await firebaseReady;
  await updateDoc(doc(db, "emailChangeRequests", requestId), {
    status,
    schoolNote: note,
    decidedAt: serverTimestamp()
  });
}

export async function beginApprovedEmailChange(request) {
  if (request.status !== "approved") throw new Error("The school has not approved this email change yet.");
  if (isDemoMode) {
    const state = getDemoState();
    const user = state.users.find((u) => u.id === request.pupilId);
    user.email = request.newEmail;
    request.status = "completed";
    request.completedAt = new Date().toISOString();
    saveDemoState(state);
    return;
  }
  await firebaseReady;
  await verifyBeforeUpdateEmail(auth.currentUser, request.newEmail, {
    url: appSettings.publicAppUrl,
    handleCodeInApp: false
  });
}

export async function createTransferRequest(profile, destinationCode, shareLevel, summary) {
  const toSchoolId = destinationCode.trim().split("~")[0];
  if (!toSchoolId || !destinationCode.includes("~")) throw new Error("Enter the transfer code supplied by the new school.");
  const payload = {
    pupilId: profile.id,
    pupilName: profile.displayName,
    learnerId: profile.learnerId,
    fromSchoolId: profile.schoolId,
    toSchoolId,
    destinationCode: destinationCode.trim(),
    shareLevel,
    sharedSummary: summary,
    status: "requested",
    requestedAt: new Date().toISOString()
  };
  if (isDemoMode) {
    const state = getDemoState();
    const item = { id: randomId("transfer-"), ...payload };
    state.transferRequests.push(item);
    saveDemoState(state);
    return item;
  }
  await firebaseReady;
  const destinationSnap = await getDoc(doc(db, "schools", toSchoolId));
  if (!destinationSnap.exists() || destinationSnap.data().transferCode !== destinationCode.trim()) {
    throw new Error("That destination-school transfer code is not valid.");
  }
  const ref = await addDoc(collection(db, "transferRequests"), { ...payload, requestedAt: serverTimestamp() });
  return { id: ref.id, ...payload };
}

export async function decideTransferRequest(requestId, accepted, classIds = []) {
  const status = accepted ? "accepted" : "declined";
  if (isDemoMode) {
    const state = getDemoState();
    const req = state.transferRequests.find((x) => x.id === requestId);
    Object.assign(req, { status, classIds, decidedAt: new Date().toISOString() });
    saveDemoState(state);
    return;
  }
  await firebaseReady;
  await updateDoc(doc(db, "transferRequests", requestId), {
    status,
    classIds,
    decidedAt: serverTimestamp()
  });
}

export async function completeTransfer(profile, request) {
  if (request.status !== "accepted" || request.pupilId !== profile.id) throw new Error("This transfer is not ready to complete.");
  if (isDemoMode) {
    const state = getDemoState();
    const user = state.users.find((u) => u.id === profile.id);
    user.schoolHistoryIds = [...new Set([...(user.schoolHistoryIds || []), request.fromSchoolId, request.toSchoolId])];
    user.schoolId = request.toSchoolId;
    user.approvedTransferId = request.id;
    request.status = "completed";
    request.completedAt = new Date().toISOString();
    saveDemoState(state);
    return;
  }
  await firebaseReady;
  const batch = writeBatch(db);
  batch.update(doc(db, "users", profile.id), {
    schoolId: request.toSchoolId,
    schoolHistoryIds: arrayUnion(request.fromSchoolId, request.toSchoolId),
    approvedTransferId: request.id,
    updatedAt: serverTimestamp()
  });
  batch.update(doc(db, "transferRequests", request.id), {
    status: "completed",
    completedAt: serverTimestamp()
  });
  for (const classId of request.classIds || []) {
    const memberRef = doc(collection(db, "schools", request.toSchoolId, "memberships"));
    batch.set(memberRef, {
      userId: profile.id,
      classId,
      subjectId: "",
      targetGrade: "",
      currentGrade: "",
      active: true,
      approvedTransferId: request.id,
      createdAt: serverTimestamp()
    });
  }
  await batch.commit();
}

export async function resetDemoData() {
  localStorage.removeItem(demoStorageKey);
  localStorage.removeItem(demoUserKey);
}

export { DEMO_SCHOOL_ID };
