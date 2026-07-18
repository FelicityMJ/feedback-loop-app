// Replace the placeholder values with the Firebase web-app configuration
// copied from Firebase Console > Project settings > Your apps.
export const firebaseConfig = {
  apiKey: "PASTE_YOUR_API_KEY_HERE",
  authDomain: "PASTE_YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "PASTE_YOUR_PROJECT_ID",
  storageBucket: "PASTE_YOUR_PROJECT_ID.firebasestorage.app",
  messagingSenderId: "PASTE_YOUR_MESSAGING_SENDER_ID",
  appId: "PASTE_YOUR_APP_ID"
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
