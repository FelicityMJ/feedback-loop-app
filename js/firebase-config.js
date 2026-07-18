// Replace the placeholder values with the Firebase web-app configuration
// copied from Firebase Console > Project settings > Your apps.
export const firebaseConfig = {
  apiKey: "AIzaSyCAgWzhPjGT2PxyvogGS9SZ-3J4KxfWIRQ",
  authDomain: "feedback-loop-school.firebaseapp.com",
  projectId: "feedback-loop-school",
  storageBucket: "feedback-loop-school.firebasestorage.app",
  messagingSenderId: "211193320459",
  appId: "1:211193320459:web:8d3d01b99ae29e0131630e"
};

export const appSettings = {
  appName: "FeedbackLoop",
  // The app starts in demo mode until a real Firebase config is pasted above.
  forceDemoMode: false,
  // After publishing, replace this with your GitHub Pages or custom-domain URL.
  publicAppUrl: window.location.origin + window.location.pathname
};

export const firebaseIsConfigured =
  !firebaseConfig.apiKey.includes("PASTE_") &&
  !firebaseConfig.projectId.includes("PASTE_");
