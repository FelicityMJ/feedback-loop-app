const daysAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
};

export const DEMO_SCHOOL_ID = "northbridge-academy";

export const demoData = {
  school: {
    id: DEMO_SCHOOL_ID,
    name: "Northbridge Academy",
    shortName: "Northbridge",
    transferCode: "northbridge-academy~NB42Q7",
    active: true
  },
  departments: [
    { id: "computing-business", name: "Computing & Business", headIds: ["demo-head"] },
    { id: "mathematics", name: "Mathematics", headIds: [] },
    { id: "english", name: "English", headIds: [] }
  ],
  subjects: [
    { id: "computing", name: "Computing Science", departmentId: "computing-business", gradeScale: "A-D" },
    { id: "business", name: "Business Management", departmentId: "computing-business", gradeScale: "A-D" },
    { id: "maths", name: "Mathematics", departmentId: "mathematics", gradeScale: "A-D" },
    { id: "english", name: "English", departmentId: "english", gradeScale: "A-D" }
  ],
  users: [
    { id: "demo-admin", learnerId: null, displayName: "Mrs Campbell", email: "admin@northbridge.demo", role: "schoolAdmin", schoolId: DEMO_SCHOOL_ID, departmentIds: [], active: true },
    { id: "demo-head", learnerId: null, displayName: "Mr Fraser", email: "head@northbridge.demo", role: "departmentHead", schoolId: DEMO_SCHOOL_ID, departmentIds: ["computing-business"], active: true },
    { id: "demo-teacher", learnerId: null, displayName: "Mrs Miller", email: "teacher@northbridge.demo", role: "teacher", schoolId: DEMO_SCHOOL_ID, departmentIds: ["computing-business"], active: true },
    { id: "demo-pupil", learnerId: "L-2F4A9D7C", displayName: "Ava Morrison", email: "ava.morrison@northbridge.demo", role: "pupil", schoolId: DEMO_SCHOOL_ID, departmentIds: [], active: true, schoolHistoryIds: [DEMO_SCHOOL_ID] },
    { id: "pupil-2", learnerId: "L-5A2B91E4", displayName: "Jamie Reid", email: "jamie.reid@northbridge.demo", role: "pupil", schoolId: DEMO_SCHOOL_ID, departmentIds: [], active: true, schoolHistoryIds: [DEMO_SCHOOL_ID] },
    { id: "pupil-3", learnerId: "L-8E77C22A", displayName: "Sophie Khan", email: "sophie.khan@northbridge.demo", role: "pupil", schoolId: DEMO_SCHOOL_ID, departmentIds: [], active: true, schoolHistoryIds: [DEMO_SCHOOL_ID] },
    { id: "pupil-4", learnerId: "L-118DB7F0", displayName: "Lewis Grant", email: "lewis.grant@northbridge.demo", role: "pupil", schoolId: DEMO_SCHOOL_ID, departmentIds: [], active: true, schoolHistoryIds: [DEMO_SCHOOL_ID] }
  ],
  classes: [
    { id: "n5-computing-a", name: "4A Computing", subjectId: "computing", departmentId: "computing-business", teacherIds: ["demo-teacher", "demo-head"], academicYear: "2026/27", targetQualification: "National 5", active: true },
    { id: "higher-computing", name: "Higher Computing", subjectId: "computing", departmentId: "computing-business", teacherIds: ["demo-head"], academicYear: "2026/27", targetQualification: "Higher", active: true },
    { id: "n5-business-a", name: "4A Business", subjectId: "business", departmentId: "computing-business", teacherIds: ["demo-teacher"], academicYear: "2026/27", targetQualification: "National 5", active: true }
  ],
  memberships: [
    { id: "m1", userId: "demo-pupil", classId: "n5-computing-a", subjectId: "computing", targetGrade: "A", currentGrade: "B", active: true },
    { id: "m2", userId: "pupil-2", classId: "n5-computing-a", subjectId: "computing", targetGrade: "B", currentGrade: "C", active: true },
    { id: "m3", userId: "pupil-3", classId: "n5-computing-a", subjectId: "computing", targetGrade: "A", currentGrade: "A", active: true },
    { id: "m4", userId: "pupil-4", classId: "n5-computing-a", subjectId: "computing", targetGrade: "C", currentGrade: "D", active: true },
    { id: "m5", userId: "demo-pupil", classId: "n5-business-a", subjectId: "business", targetGrade: "A", currentGrade: "A", active: true }
  ],
  assessments: [
    { id: "a1", pupilId: "demo-pupil", classId: "n5-computing-a", subjectId: "computing", name: "Software Design Check", topic: "Software Design", score: 14, maxScore: 20, percentage: 70, grade: "B", date: daysAgo(86) },
    { id: "a2", pupilId: "demo-pupil", classId: "n5-computing-a", subjectId: "computing", name: "Python Selection", topic: "Selection", score: 16, maxScore: 20, percentage: 80, grade: "A", date: daysAgo(60) },
    { id: "a3", pupilId: "demo-pupil", classId: "n5-computing-a", subjectId: "computing", name: "Database Progress Check", topic: "Database", score: 15, maxScore: 25, percentage: 60, grade: "C", date: daysAgo(34) },
    { id: "a4", pupilId: "demo-pupil", classId: "n5-computing-a", subjectId: "computing", name: "Programming Prelim", topic: "Programming", score: 37, maxScore: 50, percentage: 74, grade: "B", date: daysAgo(9) },
    { id: "a5", pupilId: "demo-pupil", classId: "n5-business-a", subjectId: "business", name: "Marketing Test", topic: "Marketing", score: 42, maxScore: 50, percentage: 84, grade: "A", date: daysAgo(22) },

    { id: "a6", pupilId: "pupil-2", classId: "n5-computing-a", subjectId: "computing", name: "Software Design Check", topic: "Software Design", score: 11, maxScore: 20, percentage: 55, grade: "D", date: daysAgo(86) },
    { id: "a7", pupilId: "pupil-2", classId: "n5-computing-a", subjectId: "computing", name: "Python Selection", topic: "Selection", score: 13, maxScore: 20, percentage: 65, grade: "C", date: daysAgo(60) },
    { id: "a8", pupilId: "pupil-2", classId: "n5-computing-a", subjectId: "computing", name: "Database Progress Check", topic: "Database", score: 14, maxScore: 25, percentage: 56, grade: "D", date: daysAgo(34) },
    { id: "a9", pupilId: "pupil-2", classId: "n5-computing-a", subjectId: "computing", name: "Programming Prelim", topic: "Programming", score: 31, maxScore: 50, percentage: 62, grade: "C", date: daysAgo(9) },

    { id: "a10", pupilId: "pupil-3", classId: "n5-computing-a", subjectId: "computing", name: "Software Design Check", topic: "Software Design", score: 17, maxScore: 20, percentage: 85, grade: "A", date: daysAgo(86) },
    { id: "a11", pupilId: "pupil-3", classId: "n5-computing-a", subjectId: "computing", name: "Python Selection", topic: "Selection", score: 18, maxScore: 20, percentage: 90, grade: "A", date: daysAgo(60) },
    { id: "a12", pupilId: "pupil-3", classId: "n5-computing-a", subjectId: "computing", name: "Database Progress Check", topic: "Database", score: 21, maxScore: 25, percentage: 84, grade: "A", date: daysAgo(34) },
    { id: "a13", pupilId: "pupil-3", classId: "n5-computing-a", subjectId: "computing", name: "Programming Prelim", topic: "Programming", score: 44, maxScore: 50, percentage: 88, grade: "A", date: daysAgo(9) },

    { id: "a14", pupilId: "pupil-4", classId: "n5-computing-a", subjectId: "computing", name: "Software Design Check", topic: "Software Design", score: 12, maxScore: 20, percentage: 60, grade: "C", date: daysAgo(86) },
    { id: "a15", pupilId: "pupil-4", classId: "n5-computing-a", subjectId: "computing", name: "Python Selection", topic: "Selection", score: 11, maxScore: 20, percentage: 55, grade: "D", date: daysAgo(60) },
    { id: "a16", pupilId: "pupil-4", classId: "n5-computing-a", subjectId: "computing", name: "Database Progress Check", topic: "Database", score: 12, maxScore: 25, percentage: 48, grade: "D", date: daysAgo(34) },
    { id: "a17", pupilId: "pupil-4", classId: "n5-computing-a", subjectId: "computing", name: "Programming Prelim", topic: "Programming", score: 21, maxScore: 50, percentage: 42, grade: "No Award", date: daysAgo(9) }
  ],
  feedbackRecords: [
    { id: "f1", pupilId: "demo-pupil", classId: "n5-computing-a", subjectId: "computing", assessmentId: "a2", assessmentName: "Python Selection", date: daysAgo(60), skill: "Selection", feedbackType: "Progress Check", strength: "You selected the correct conditions and used if, elif and else accurately.", nextStep: "Explain why each condition is needed using the actual variables from the question.", trafficLight: "Green", status: "closed", teacherId: "demo-teacher", teacherNotes: "Secure practical skill." },
    { id: "f2", pupilId: "demo-pupil", classId: "n5-computing-a", subjectId: "computing", assessmentId: "a3", assessmentName: "Database Progress Check", date: daysAgo(34), skill: "SQL", feedbackType: "Written", strength: "Good use of SELECT and WHERE to find the correct records.", nextStep: "Practise ORDER BY with ASC and DESC, then explain what changes in the output.", trafficLight: "Amber", status: "awaitingReview", teacherId: "demo-teacher", teacherNotes: "Check the follow-up SQL task." },
    { id: "f3", pupilId: "demo-pupil", classId: "n5-computing-a", subjectId: "computing", assessmentId: "a4", assessmentName: "Programming Prelim", date: daysAgo(9), skill: "Evaluation", feedbackType: "Timed Question", strength: "You identified the relevant efficiency issue.", nextStep: "Explain why the improvement matters and link your answer to the readings array.", trafficLight: "Red", status: "open", teacherId: "demo-teacher", teacherNotes: "Recurring precision issue in extended answers." },
    { id: "f4", pupilId: "pupil-2", classId: "n5-computing-a", subjectId: "computing", assessmentId: "a9", assessmentName: "Programming Prelim", date: daysAgo(9), skill: "Input validation", feedbackType: "Timed Question", strength: "Correctly identified that a conditional loop was required.", nextStep: "Write the invalid condition using both limits and the OR operator.", trafficLight: "Amber", status: "open", teacherId: "demo-teacher" },
    { id: "f5", pupilId: "pupil-4", classId: "n5-computing-a", subjectId: "computing", assessmentId: "a17", assessmentName: "Programming Prelim", date: daysAgo(9), skill: "Arrays", feedbackType: "Timed Question", strength: "You recognised that several values had to be stored.", nextStep: "Practise traversing an array using an index and range(len(array)).", trafficLight: "Red", status: "open", teacherId: "demo-teacher", teacherNotes: "Needs intervention before next assessment." },
    { id: "f6", pupilId: "pupil-4", classId: "n5-computing-a", subjectId: "computing", assessmentId: "a16", assessmentName: "Database Progress Check", date: daysAgo(34), skill: "Data dictionaries", feedbackType: "Written", strength: "Field names were relevant.", nextStep: "Include data type, size and validation for every field.", trafficLight: "Red", status: "overdue", teacherId: "demo-teacher" }
  ],
  feedbackActions: [
    { id: "fa1", feedbackId: "f1", pupilId: "demo-pupil", reflection: "I was giving a general answer instead of referring to the variables in the program.", actionTaken: "I corrected the answer and completed two similar selection explanations.", confidenceBefore: 3, confidenceAfter: 5, status: "approved", teacherReview: "Good correction. You used the variable names precisely.", submittedAt: daysAgo(55), reviewedAt: daysAgo(53) },
    { id: "fa2", feedbackId: "f2", pupilId: "demo-pupil", reflection: "I understand filtering but I mixed up the direction of the sort.", actionTaken: "I completed three ORDER BY questions using ASC and DESC and added a flashcard.", confidenceBefore: 2, confidenceAfter: 4, status: "submitted", teacherReview: "", submittedAt: daysAgo(30) }
  ],
  interventions: [
    { id: "i1", pupilId: "pupil-4", classId: "n5-computing-a", concernArea: "Programming and unresolved feedback", concernLevel: "High", action: "Weekly targeted retrieval and teacher check-in.", ownerId: "demo-teacher", openedAt: daysAgo(7), reviewDate: daysAgo(-7), impact: "", status: "In progress" },
    { id: "i2", pupilId: "pupil-2", classId: "n5-computing-a", concernArea: "Extended explanations", concernLevel: "Medium", action: "Use model-answer structure for explain/justify questions.", ownerId: "demo-teacher", openedAt: daysAgo(20), reviewDate: daysAgo(-2), impact: "More precise answers in recent classwork.", status: "In progress" }
  ],
  invites: [
    { id: "northbridge-academy~TEACH-9K4M", schoolId: DEMO_SCHOOL_ID, role: "teacher", departmentIds: ["computing-business"], active: true, label: "Computing teacher invite" },
    { id: "northbridge-academy~4ACOMP-26", schoolId: DEMO_SCHOOL_ID, role: "pupil", classIds: ["n5-computing-a"], active: true, label: "4A Computing pupil code" }
  ],
  transferRequests: [],
  emailChangeRequests: []
};

export const demoRoleUsers = {
  schoolAdmin: "demo-admin",
  departmentHead: "demo-head",
  teacher: "demo-teacher",
  pupil: "demo-pupil"
};
