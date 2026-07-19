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

export async function sendPupilPasswordReset(email) {
  const address = String(email || "").trim();
  if (!address) throw new Error("This pupil does not have an email address recorded.");
  return resetPassword(address);
}

export async function signOut() {
  if (isDemoMode) {
    localStorage.removeItem(demoUserKey);
    return;
  }
  await firebaseReady;
  await firebaseSignOut(auth);
}

async function loadInvite(inviteCode) {
  const code = String(inviteCode || "").trim();
  const schoolId = code.split("~")[0];
  if (!schoolId || !code.includes("~")) throw new Error("That invitation code is not in the expected format.");
  const inviteRef = findSchoolDocPath(schoolId, "invites", code);
  const inviteSnap = await getDoc(inviteRef);
  if (!inviteSnap.exists() || inviteSnap.data().active !== true) throw new Error("That invitation code is not active.");
  return { code, schoolId, invite: inviteSnap.data() };
}

export async function previewPupilClassInvite(inviteCode) {
  if (isDemoMode) {
    const state = getDemoState();
    const code = String(inviteCode || "").trim();
    const invite = state.invites.find((item) => item.id === code && item.active === true);
    if (!invite || invite.role !== "pupil") throw new Error("Enter an active pupil class code.");
    const cls = state.classes.find((item) => (invite.classIds || []).includes(item.id));
    const subject = state.subjects.find((item) => item.id === (cls?.subjectId || invite.subjectId));
    return {
      inviteCode: code,
      schoolId: invite.schoolId || DEMO_SCHOOL_ID,
      workspaceName: state.school?.name || "Demo school",
      classId: cls?.id || "",
      className: cls?.name || invite.scopeLabel || "Class",
      subjectName: subject?.name || "Subject"
    };
  }
  await firebaseReady;
  const { code, schoolId, invite } = await loadInvite(inviteCode);
  if (invite.role !== "pupil" || invite.scopeType !== "class") throw new Error("Enter a pupil class code, not a staff code.");
  const classId = (invite.classIds || [])[0];
  if (!classId) throw new Error("That class code is incomplete.");
  const [schoolSnap, classSnap] = await Promise.all([
    getDoc(doc(db, "schools", schoolId)),
    getDoc(doc(db, "schools", schoolId, "classes", classId))
  ]);
  if (!schoolSnap.exists() || !classSnap.exists()) throw new Error("The class connected to that code could not be found.");
  const cls = classSnap.data();
  const subjectSnap = cls.subjectId ? await getDoc(doc(db, "schools", schoolId, "subjects", cls.subjectId)) : null;
  return {
    inviteCode: code,
    schoolId,
    workspaceName: schoolSnap.data().name || schoolSnap.data().shortName || "School workspace",
    classId,
    className: cls.name || invite.scopeLabel || "Class",
    subjectName: subjectSnap?.exists() ? subjectSnap.data().name : "Subject"
  };
}

export async function joinPupilClass(profile, inviteCode) {
  if (!profile || profile.role !== "pupil") throw new Error("Only a pupil account can join a pupil class code.");
  if (isDemoMode) {
    const state = getDemoState();
    const code = String(inviteCode || "").trim();
    const invite = state.invites.find((item) => item.id === code && item.active === true && item.role === "pupil");
    if (!invite) throw new Error("Enter an active pupil class code.");
    for (const classId of invite.classIds || []) {
      if (!state.memberships.some((item) => item.userId === profile.id && item.classId === classId)) {
        const cls = state.classes.find((item) => item.id === classId);
        state.memberships.push({ id: randomId("m-"), userId: profile.id, classId, subjectId: cls?.subjectId || invite.subjectId || "", targetGrade: "", currentGrade: "", active: true, inviteCode: code });
      }
    }
    const user = state.users.find((item) => item.id === profile.id);
    user.workspaceIds = [...new Set([...(user.workspaceIds || [user.schoolId]), invite.schoolId || user.schoolId])];
    saveDemoState(state);
    return clone(user);
  }

  await firebaseReady;
  const { code, schoolId, invite } = await loadInvite(inviteCode);
  if (invite.role !== "pupil" || invite.scopeType !== "class") throw new Error("Enter a pupil class code, not a staff code.");
  const existingMemberships = await fetchCollection(["schools", schoolId, "memberships"], [where("userId", "==", profile.id)]);
  const existingClassIds = new Set(existingMemberships.filter((item) => item.active !== false).map((item) => item.classId));
  const classIds = (invite.classIds || []).filter(Boolean);
  if (!classIds.length) throw new Error("That class code is incomplete.");

  const workspaceRef = doc(db, "users", profile.id, "workspaces", schoolId);
  const workspaceSnap = await getDoc(workspaceRef);
  const batch = writeBatch(db);
  if (!workspaceSnap.exists()) {
    batch.set(workspaceRef, {
      uid: profile.id,
      schoolId,
      role: "pupil",
      departmentIds: invite.departmentIds || [],
      workspaceOwner: false,
      authProvider: profile.authProvider || providerName(auth.currentUser),
      inviteCode: code,
      active: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
  }
  batch.update(doc(db, "users", profile.id), {
    schoolId,
    role: "pupil",
    departmentIds: invite.departmentIds || [],
    workspaceOwner: false,
    inviteCode: code,
    workspaceIds: arrayUnion(schoolId),
    updatedAt: serverTimestamp()
  });
  for (const classId of classIds) {
    if (existingClassIds.has(classId)) continue;
    const membershipRef = doc(collection(db, "schools", schoolId, "memberships"));
    batch.set(membershipRef, {
      userId: profile.id,
      classId,
      subjectId: invite.subjectId || "",
      targetGrade: "",
      currentGrade: "",
      active: true,
      inviteCode: code,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
  }
  await batch.commit();
  return getUserProfile(auth.currentUser);
}

function providerName(user, fallback = "password") {
  if (user?.providerData?.some((item) => item.providerId === "google.com")) return "google";
  return fallback;
}

async function completeInviteProfile(user, { displayName, inviteCode, authProvider = "password" }) {
  const realName = String(displayName || user?.displayName || "").trim();
  if (!realName) throw new Error("Enter the pupil or staff member's real full name.");
  const { code, schoolId, invite } = await loadInvite(inviteCode);
  const email = String(user?.email || "").trim();
  if (!email) throw new Error("This account does not have an email address.");
  if (invite.emailRestriction && invite.emailRestriction.toLowerCase() !== email.toLowerCase()) {
    throw new Error("This invitation was issued for a different email address.");
  }
  const existingProfile = await getDoc(doc(db, "users", user.uid));
  if (existingProfile.exists()) throw new Error("This account already has a FeedbackLoop profile. Use Sign in instead.");

  await updateProfile(user, { displayName: realName });
  const batch = writeBatch(db);
  const departments = invite.departmentIds || [];
  const profile = {
    displayName: realName,
    email,
    role: invite.role,
    schoolId,
    departmentIds: departments,
    learnerId: invite.role === "pupil" ? learnerId() : null,
    schoolHistoryIds: invite.role === "pupil" ? [schoolId] : [],
    workspaceIds: [schoolId],
    workspaceOwner: false,
    authProvider,
    active: true,
    inviteCode: code,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };
  batch.set(doc(db, "users", user.uid), profile);
  batch.set(doc(db, "users", user.uid, "workspaces", schoolId), {
    uid: user.uid,
    schoolId,
    role: invite.role,
    departmentIds: departments,
    workspaceOwner: false,
    authProvider,
    inviteCode: code,
    active: true,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
  if (invite.role === "pupil") {
    for (const classId of invite.classIds || []) {
      const membershipRef = doc(collection(db, "schools", schoolId, "memberships"));
      batch.set(membershipRef, {
        userId: user.uid,
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
  await batch.commit();
  if (authProvider === "password" && !user.emailVerified) {
    try {
      await sendEmailVerification(user, { url: appSettings.publicAppUrl });
    } catch (error) {
      console.warn("Profile created, but the verification email could not be sent.", error);
    }
  }
  return user;
}

export async function registerWithInvite({ displayName, email, password, inviteCode }) {
  if (isDemoMode) {
    const state = getDemoState();
    const code = String(inviteCode || "").trim();
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
      workspaceIds: [invite.schoolId],
      authProvider: "password",
      active: true,
      inviteCode: code
    };
    state.users.push(user);
    if (invite.role === "pupil") {
      for (const classId of invite.classIds || []) {
        const cls = state.classes.find((c) => c.id === classId);
        state.memberships.push({ id: randomId("m-"), userId: id, classId, subjectId: cls?.subjectId || "", targetGrade: "", currentGrade: "", active: true });
      }
    }
    saveDemoState(state);
    localStorage.setItem(demoUserKey, id);
    return user;
  }

  await firebaseReady;
  let result;
  let createdNow = false;
  try {
    result = await createUserWithEmailAndPassword(auth, email, password);
    createdNow = true;
  } catch (error) {
    if (error?.code !== "auth/email-already-in-use") throw error;
    result = await signInWithEmailAndPassword(auth, email, password);
  }
  try {
    return await completeInviteProfile(result.user, { displayName, inviteCode, authProvider: "password" });
  } catch (error) {
    if (createdNow) {
      try { await deleteUser(result.user); } catch (cleanupError) { console.warn("Could not remove incomplete Firebase Auth account.", cleanupError); }
    }
    throw error;
  }
}

export async function registerWithInviteGoogle({ displayName, inviteCode }) {
  if (isDemoMode) return registerWithInvite({ displayName, email: "pupil@example.com", password: "demo-password", inviteCode });
  await firebaseReady;
  const user = await signInWithGoogle();
  return completeInviteProfile(user, { displayName: displayName || user.displayName, inviteCode, authProvider: "google" });
}

async function createIndependentWorkspaceForUser(user, { displayName, workspaceName, authProvider }) {
  const realName = String(displayName || user?.displayName || "").trim();
  if (!realName) throw new Error("Enter your real full name.");
  const name = String(workspaceName || "").trim() || `${realName}'s Classes`;
  const existingProfile = await getDoc(doc(db, "users", user.uid));
  if (existingProfile.exists()) throw new Error("This account already has a FeedbackLoop profile. Use Sign in instead.");
  const workspaceId = `personal-${user.uid}`;
  const departmentId = "personal-department";
  const subjectId = "personal-subject";
  await updateProfile(user, { displayName: realName });
  const batch = writeBatch(db);
  batch.set(doc(db, "schools", workspaceId), {
    name,
    shortName: name,
    active: true,
    workspaceType: "individualTeacher",
    ownerId: user.uid,
    transferCode: "",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
  batch.set(doc(db, "users", user.uid), {
    displayName: realName,
    email: user.email || "",
    role: "teacher",
    schoolId: workspaceId,
    departmentIds: [departmentId],
    learnerId: null,
    schoolHistoryIds: [],
    workspaceIds: [workspaceId],
    workspaceOwner: true,
    authProvider,
    active: true,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
  batch.set(doc(db, "users", user.uid, "workspaces", workspaceId), {
    uid: user.uid,
    schoolId: workspaceId,
    role: "teacher",
    departmentIds: [departmentId],
    workspaceOwner: true,
    authProvider,
    active: true,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
  await batch.commit();
  try {
    const setupBatch = writeBatch(db);
    setupBatch.set(doc(db, "schools", workspaceId, "departments", departmentId), {
      name: "My subjects",
      headIds: [user.uid],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    setupBatch.set(doc(db, "schools", workspaceId, "subjects", subjectId), {
      name: "General subject",
      departmentId,
      gradeScale: "A1–D8",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    await setupBatch.commit();
  } catch (error) {
    console.warn("Teacher workspace was created without the starter subject. It can be added from My classes.", error);
  }
  if (authProvider === "password" && !user.emailVerified) {
    try { await sendEmailVerification(user, { url: appSettings.publicAppUrl }); }
    catch (error) { console.warn("Workspace created, but the verification email could not be sent.", error); }
  }
  return user;
}

export async function registerIndependentTeacher({ displayName, workspaceName, email, password }) {
  if (isDemoMode) return demoSignInAs("teacher");
  await firebaseReady;
  const result = await createUserWithEmailAndPassword(auth, email, password);
  try {
    return await createIndependentWorkspaceForUser(result.user, { displayName, workspaceName, authProvider: "password" });
  } catch (error) {
    try { await deleteUser(result.user); } catch (cleanupError) { console.warn("Could not remove incomplete teacher account.", cleanupError); }
    throw error;
  }
}

export async function registerIndependentTeacherGoogle({ workspaceName }) {
  if (isDemoMode) return demoSignInAs("teacher");
  await firebaseReady;
  const user = await signInWithGoogle();
  return createIndependentWorkspaceForUser(user, { displayName: user.displayName, workspaceName, authProvider: "google" });
}

export async function joinTeacherWorkspace(profile, inviteCode) {
  if (isDemoMode) return profile;
  await firebaseReady;
  if (!profile || profile.role !== "teacher") throw new Error("Only a teacher account can join a department using this option.");
  const { code, schoolId, invite } = await loadInvite(inviteCode);
  if (invite.role !== "teacher") throw new Error("Enter a teacher department code.");
  const workspaceRef = doc(db, "users", profile.id, "workspaces", schoolId);
  const existing = await getDoc(workspaceRef);
  if (existing.exists()) {
    await switchWorkspace(profile, schoolId);
    for (const classId of invite.classIds || []) {
      await updateDoc(doc(db, "schools", schoolId, "classes", classId), {
        teacherIds: arrayUnion(profile.id),
        updatedAt: serverTimestamp()
      });
    }
    return getUserProfile(auth.currentUser);
  }
  const batch = writeBatch(db);
  batch.set(workspaceRef, {
    uid: profile.id,
    schoolId,
    role: "teacher",
    departmentIds: invite.departmentIds || [],
    workspaceOwner: false,
    authProvider: profile.authProvider || providerName(auth.currentUser),
    inviteCode: code,
    active: true,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
  batch.update(doc(db, "users", profile.id), {
    schoolId,
    role: "teacher",
    departmentIds: invite.departmentIds || [],
    workspaceOwner: false,
    inviteCode: code,
    workspaceIds: arrayUnion(schoolId),
    updatedAt: serverTimestamp()
  });
  await batch.commit();
  for (const classId of invite.classIds || []) {
    try {
      await updateDoc(doc(db, "schools", schoolId, "classes", classId), {
        teacherIds: arrayUnion(profile.id),
        updatedAt: serverTimestamp()
      });
    } catch (error) {
      console.warn("Teacher joined the workspace but could not be attached to an invited class.", classId, error);
    }
  }
  try {
    await addDoc(collection(db, "schools", schoolId, "auditLogs"), {
      action: "teacherJoinedWorkspace",
      userId: profile.id,
      userName: profile.displayName,
      inviteCode: code,
      createdAt: serverTimestamp()
    });
  } catch (error) {
    console.warn("School joined, but the audit entry could not be written.", error);
  }
  return getUserProfile(auth.currentUser);
}

export async function loadWorkspaceStructure(profile, schoolId) {
  if (isDemoMode) {
    const state = getDemoState();
    return { school: clone(state.school), departments: clone(state.departments), subjects: clone(state.subjects), membership: { role: profile.role, departmentIds: profile.departmentIds || [] } };
  }
  await firebaseReady;
  const [schoolSnap, membershipSnap, departments, subjects] = await Promise.all([
    getDoc(doc(db, "schools", schoolId)),
    getDoc(doc(db, "users", profile.id, "workspaces", schoolId)),
    safeFetch(["schools", schoolId, "departments"]),
    safeFetch(["schools", schoolId, "subjects"])
  ]);
  if (!schoolSnap.exists() || !membershipSnap.exists() || membershipSnap.data().active === false) throw new Error("You do not have access to that school workspace.");
  return { school: normaliseDoc(schoolSnap), departments, subjects, membership: membershipSnap.data() };
}

export async function createClassMigrationRequest(profile, data) {
  if (isDemoMode) {
    const state = getDemoState();
    const sourceClass = state.classes.find((item) => item.id === data.sourceClassId);
    const request = { id: randomId("migration-"), createdBy: profile.id, createdByName: profile.displayName, sourceWorkspaceId: profile.schoolId, sourceClassId: data.sourceClassId, sourceClassName: sourceClass?.name || "Class", destinationSchoolId: data.destinationSchoolId, destinationDepartmentId: data.destinationDepartmentId, destinationSubjectId: data.destinationSubjectId, status: "requested", requestedAt: new Date().toISOString() };
    state.classMigrationRequests = state.classMigrationRequests || [];
    state.classMigrationRequests.push(request);
    saveDemoState(state);
    return request;
  }
  await firebaseReady;
  const sourceClassSnap = await getDoc(doc(db, "schools", profile.schoolId, "classes", data.sourceClassId));
  if (!sourceClassSnap.exists()) throw new Error("The source class could not be found.");
  const sourceSchoolSnap = await getDoc(doc(db, "schools", profile.schoolId));
  if (!sourceSchoolSnap.exists() || sourceSchoolSnap.data().workspaceType !== "individualTeacher" || sourceSchoolSnap.data().ownerId !== profile.id) {
    throw new Error("Only the owner of an individual teacher workspace can move this class.");
  }
  const [destinationMembership, destinationSchool, destinationDepartment, destinationSubject] = await Promise.all([
    getDoc(doc(db, "users", profile.id, "workspaces", data.destinationSchoolId)),
    getDoc(doc(db, "schools", data.destinationSchoolId)),
    getDoc(doc(db, "schools", data.destinationSchoolId, "departments", data.destinationDepartmentId)),
    getDoc(doc(db, "schools", data.destinationSchoolId, "subjects", data.destinationSubjectId))
  ]);
  if (!destinationMembership.exists() || destinationMembership.data().active === false || destinationMembership.data().role !== "teacher") throw new Error("Join the destination school as a teacher before moving a class.");
  if (!destinationSchool.exists() || !destinationDepartment.exists() || !destinationSubject.exists()) throw new Error("Choose a valid destination department and subject.");
  if (destinationSubject.data().departmentId !== data.destinationDepartmentId) throw new Error("The selected subject does not belong to that department.");
  const payload = {
    createdBy: profile.id,
    createdByName: profile.displayName,
    sourceWorkspaceId: profile.schoolId,
    sourceWorkspaceName: sourceSchoolSnap.data().name || "Individual workspace",
    sourceClassId: data.sourceClassId,
    sourceClassName: sourceClassSnap.data().name || "Class",
    destinationSchoolId: data.destinationSchoolId,
    destinationSchoolName: destinationSchool.data().name || "School",
    destinationDepartmentId: data.destinationDepartmentId,
    destinationSubjectId: data.destinationSubjectId,
    status: "requested",
    requestedAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };
  const ref = await addDoc(collection(db, "classMigrationRequests"), payload);
  return { id: ref.id, ...payload };
}

export async function decideClassMigrationRequest(requestId, accepted) {
  if (isDemoMode) {
    const state = getDemoState();
    const request = (state.classMigrationRequests || []).find((item) => item.id === requestId);
    if (!request) throw new Error("Migration request not found.");
    request.status = accepted ? "accepted" : "declined";
    request.decidedAt = new Date().toISOString();
    saveDemoState(state);
    return;
  }
  await firebaseReady;
  await updateDoc(doc(db, "classMigrationRequests", requestId), {
    status: accepted ? "accepted" : "declined",
    decidedAt: serverTimestamp(),
    decidedBy: auth.currentUser.uid,
    updatedAt: serverTimestamp()
  });
}

function migratedDocId(requestId, sourceId) {
  return `mig_${requestId}_${String(sourceId).replace(/[^A-Za-z0-9_-]/g, "_")}`;
}

async function commitSetOperations(operations) {
  for (let start = 0; start < operations.length; start += 400) {
    const batch = writeBatch(db);
    for (const operation of operations.slice(start, start + 400)) {
      batch.set(operation.ref, operation.data, operation.options || {});
    }
    await batch.commit();
  }
}

export async function completeClassMigration(profile, requestId) {
  if (isDemoMode) {
    const state = getDemoState();
    const request = (state.classMigrationRequests || []).find((item) => item.id === requestId);
    if (!request || request.status !== "accepted") throw new Error("This class move has not been approved.");
    request.status = "completed";
    request.completedAt = new Date().toISOString();
    saveDemoState(state);
    return request;
  }
  await firebaseReady;
  const requestRef = doc(db, "classMigrationRequests", requestId);
  const requestSnap = await getDoc(requestRef);
  if (!requestSnap.exists()) throw new Error("Class move request not found.");
  const request = { id: requestSnap.id, ...requestSnap.data() };
  if (request.status !== "accepted") throw new Error("This class move must be approved before it can be completed.");
  if (request.createdBy !== profile.id) throw new Error("Only the teacher who requested this move can complete it.");
  if (profile.schoolId !== request.destinationSchoolId) throw new Error("Switch to the destination school workspace before completing the move.");

  const sourceClassSnap = await getDoc(doc(db, "schools", request.sourceWorkspaceId, "classes", request.sourceClassId));
  if (!sourceClassSnap.exists()) throw new Error("The original class could not be found.");
  const sourceClass = sourceClassSnap.data();
  const [memberships, assessments, feedbackRecords, feedbackActions, interventions] = await Promise.all([
    fetchCollection(["schools", request.sourceWorkspaceId, "memberships"], [where("classId", "==", request.sourceClassId)]),
    fetchCollection(["schools", request.sourceWorkspaceId, "assessments"], [where("classId", "==", request.sourceClassId)]),
    fetchCollection(["schools", request.sourceWorkspaceId, "feedbackRecords"], [where("classId", "==", request.sourceClassId)]),
    fetchCollection(["schools", request.sourceWorkspaceId, "feedbackActions"]),
    fetchCollection(["schools", request.sourceWorkspaceId, "interventions"], [where("classId", "==", request.sourceClassId)])
  ]);
  const sourceFeedbackIds = new Set(feedbackRecords.map((item) => item.id));
  const relevantActions = feedbackActions.filter((item) => sourceFeedbackIds.has(item.feedbackId));
  const destinationClassId = migratedDocId(request.id, request.sourceClassId);
  const destinationTeacherIds = [profile.id];
  for (const teacherId of sourceClass.teacherIds || []) {
    if (destinationTeacherIds.includes(teacherId)) continue;
    try {
      const teacherWorkspace = await getDoc(doc(db, "users", teacherId, "workspaces", request.destinationSchoolId));
      if (teacherWorkspace.exists() && teacherWorkspace.data().active !== false && ["teacher", "departmentHead"].includes(teacherWorkspace.data().role)) destinationTeacherIds.push(teacherId);
    } catch (error) {
      console.warn("Could not check whether a co-teacher has joined the destination school.", teacherId, error);
    }
  }
  const now = serverTimestamp();
  const operations = [];
  operations.push({
    ref: doc(db, "schools", request.destinationSchoolId, "classes", destinationClassId),
    data: {
      ...sourceClass,
      subjectId: request.destinationSubjectId,
      departmentId: request.destinationDepartmentId,
      teacherIds: destinationTeacherIds,
      active: true,
      migrationRequestId: request.id,
      migrationOriginWorkspaceId: request.sourceWorkspaceId,
      migrationOriginClassId: request.sourceClassId,
      createdAt: sourceClass.createdAt || now,
      updatedAt: now
    },
    options: { merge: true }
  });
  for (const item of memberships) {
    operations.push({ ref: doc(db, "schools", request.destinationSchoolId, "memberships", migratedDocId(request.id, item.id)), data: { ...item, classId: destinationClassId, subjectId: request.destinationSubjectId, active: item.active !== false, migrationRequestId: request.id, migrationOriginWorkspaceId: request.sourceWorkspaceId, migrationOriginId: item.id, updatedAt: now }, options: { merge: true } });
  }
  for (const item of assessments) {
    operations.push({ ref: doc(db, "schools", request.destinationSchoolId, "assessments", migratedDocId(request.id, item.id)), data: { ...item, classId: destinationClassId, subjectId: request.destinationSubjectId, migrationRequestId: request.id, migrationOriginWorkspaceId: request.sourceWorkspaceId, migrationOriginId: item.id, updatedAt: now }, options: { merge: true } });
  }
  for (const item of feedbackRecords) {
    operations.push({ ref: doc(db, "schools", request.destinationSchoolId, "feedbackRecords", migratedDocId(request.id, item.id)), data: { ...item, classId: destinationClassId, subjectId: request.destinationSubjectId, migrationRequestId: request.id, migrationOriginWorkspaceId: request.sourceWorkspaceId, migrationOriginId: item.id, updatedAt: now }, options: { merge: true } });
  }
  for (const item of relevantActions) {
    operations.push({ ref: doc(db, "schools", request.destinationSchoolId, "feedbackActions", migratedDocId(request.id, item.id)), data: { ...item, feedbackId: migratedDocId(request.id, item.feedbackId), migrationRequestId: request.id, migrationOriginWorkspaceId: request.sourceWorkspaceId, migrationOriginId: item.id, updatedAt: now }, options: { merge: true } });
  }
  for (const item of interventions) {
    operations.push({ ref: doc(db, "schools", request.destinationSchoolId, "interventions", migratedDocId(request.id, item.id)), data: { ...item, classId: destinationClassId, migrationRequestId: request.id, migrationOriginWorkspaceId: request.sourceWorkspaceId, migrationOriginId: item.id, updatedAt: now }, options: { merge: true } });
  }
  await commitSetOperations(operations);
  await updateDoc(requestRef, {
    status: "completed",
    destinationClassId,
    copiedMembershipCount: memberships.length,
    copiedAssessmentCount: assessments.length,
    copiedFeedbackCount: feedbackRecords.length,
    completedAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
  return { ...request, status: "completed", destinationClassId };
}

export async function switchWorkspace(profile, schoolId) {
  if (isDemoMode) return profile;
  await firebaseReady;
  const membershipSnap = await getDoc(doc(db, "users", profile.id, "workspaces", schoolId));
  if (!membershipSnap.exists() || membershipSnap.data().active === false) throw new Error("You no longer have access to that workspace.");
  const membership = membershipSnap.data();
  await updateDoc(doc(db, "users", profile.id), {
    schoolId,
    role: membership.role,
    departmentIds: membership.departmentIds || [],
    workspaceOwner: membership.workspaceOwner === true,
    updatedAt: serverTimestamp()
  });
  return getUserProfile(auth.currentUser);
}

export async function getUserProfile(user) {
  if (!user) return null;
  if (isDemoMode) return clone(getDemoState().users.find((u) => u.id === user.id) || user);
  await firebaseReady;
  const snap = await getDoc(doc(db, "users", user.uid));
  if (!snap.exists()) return null;
  const profile = normaliseDoc(snap);
  profile.workspaceIds = Array.isArray(profile.workspaceIds) && profile.workspaceIds.length
    ? profile.workspaceIds
    : [profile.schoolId].filter(Boolean);
  profile.authProvider = profile.authProvider || providerName(user);

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
  const workspaceIds = [...new Set([...(profile.workspaceIds || []), schoolId].filter(Boolean))];
  const workspaceSnaps = await Promise.all(workspaceIds.map((id) => getDoc(doc(db, "schools", id))));
  const workspaces = workspaceSnaps.filter((snap) => snap.exists()).map(normaliseDoc);
  const school = workspaces.find((item) => item.id === schoolId) || { id: schoolId, name: "School" };
  const isPupil = profile.role === "pupil";
  const staff = ["schoolAdmin", "departmentHead", "teacher"].includes(profile.role);

  const [departments, subjects, classes] = await Promise.all([
    safeFetch(["schools", schoolId, "departments"]),
    safeFetch(["schools", schoolId, "subjects"]),
    safeFetch(["schools", schoolId, "classes"])
  ]);

  const pupilConstraint = where("pupilId", "==", profile.id);
  const memberConstraint = where("userId", "==", profile.id);
  const usersPromise = staff
    ? Promise.all([
        safeFetch(["users"], [where("schoolId", "==", schoolId)]),
        safeFetch(["users"], [where("workspaceIds", "array-contains", schoolId)])
      ]).then(([activeUsers, workspaceUsers]) => [...activeUsers, ...workspaceUsers].filter((item, index, array) => array.findIndex((other) => other.id === item.id) === index))
    : Promise.resolve([profile]);

  const [users, memberships, assessments, feedbackRecords, feedbackActions, interventions, invites] = await Promise.all([
    usersPromise,
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

  const scopedUsers = staff
    ? await Promise.all(users.map(async (user) => {
        try {
          const membershipSnap = await getDoc(doc(db, "users", user.id, "workspaces", schoolId));
          if (!membershipSnap.exists()) return user;
          const membership = membershipSnap.data();
          return {
            ...user,
            role: membership.role || user.role,
            departmentIds: membership.departmentIds || user.departmentIds || [],
            workspaceOwner: membership.workspaceOwner === true,
            authProvider: membership.authProvider || user.authProvider
          };
        } catch (error) {
          return user;
        }
      }))
    : users;

  const migrationToPromise = ["schoolAdmin", "departmentHead"].includes(profile.role)
    ? safeFetch(["classMigrationRequests"], [where("destinationSchoolId", "==", schoolId)])
    : Promise.resolve([]);

  const [transferFrom, transferTo, emailChangeRequests, migrationFrom, migrationTo, migrationMine] = await Promise.all([
    safeFetch(["transferRequests"], [where("fromSchoolId", "==", schoolId)]),
    safeFetch(["transferRequests"], [where("toSchoolId", "==", schoolId)]),
    isPupil
      ? safeFetch(["emailChangeRequests"], [where("pupilId", "==", profile.id)])
      : profile.role === "schoolAdmin"
        ? safeFetch(["emailChangeRequests"], [where("schoolId", "==", schoolId)])
        : Promise.resolve([]),
    staff ? safeFetch(["classMigrationRequests"], [where("sourceWorkspaceId", "==", schoolId)]) : Promise.resolve([]),
    migrationToPromise,
    staff ? safeFetch(["classMigrationRequests"], [where("createdBy", "==", profile.id)]) : Promise.resolve([])
  ]);

  return {
    school,
    workspaces,
    departments,
    subjects,
    users: scopedUsers,
    classes,
    memberships,
    assessments,
    feedbackRecords,
    feedbackActions,
    interventions,
    invites,
    transferRequests: [...transferFrom, ...transferTo].filter((x, i, arr) => arr.findIndex((y) => y.id === x.id) === i),
    emailChangeRequests,
    classMigrationRequests: [...migrationFrom, ...migrationTo, ...migrationMine].filter((x, i, arr) => arr.findIndex((y) => y.id === x.id) === i)
  };
}

export async function loadPupilPortfolio(profile) {
  if (isDemoMode) return clone(getDemoState());
  await firebaseReady;
  const schoolIds = [...new Set([...(profile.workspaceIds || []), ...(profile.schoolHistoryIds || []), profile.schoolId].filter(Boolean))];
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
  const dedupeMigrated = (items) => {
    const chosen = new Map();
    for (const item of items) {
      const originKey = item.migrationOriginWorkspaceId && item.migrationOriginId
        ? `${item.migrationOriginWorkspaceId}:${item.migrationOriginId}`
        : `${item.schoolId}:${item.id}`;
      const existing = chosen.get(originKey);
      if (!existing || item.migrationRequestId) chosen.set(originKey, item);
    }
    return [...chosen.values()];
  };
  portfolio.memberships = dedupeMigrated(portfolio.memberships);
  portfolio.assessments = dedupeMigrated(portfolio.assessments);
  portfolio.feedbackRecords = dedupeMigrated(portfolio.feedbackRecords);
  portfolio.feedbackActions = dedupeMigrated(portfolio.feedbackActions);
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
