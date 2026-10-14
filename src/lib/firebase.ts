import { initializeApp, type FirebaseApp } from "firebase/app";
import { connectAuthEmulator, getAuth, type Auth } from "firebase/auth";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

export function isFirebaseConfigured(): boolean {
  return Boolean(
    firebaseConfig.apiKey && firebaseConfig.authDomain && firebaseConfig.projectId && firebaseConfig.appId,
  );
}

let app: FirebaseApp | null = null;
let auth: Auth | null = null;

function getFirebaseApp(): FirebaseApp {
  if (!isFirebaseConfigured()) {
    throw new Error("Firebase is not configured. Add the VITE_FIREBASE_* values to .env.local");
  }
  if (!app) app = initializeApp(firebaseConfig);
  return app;
}

export function getFirebaseAuth(): Auth {
  if (!auth) {
    auth = getAuth(getFirebaseApp());
    auth.useDeviceLanguage();
    const emulatorUrl = import.meta.env.VITE_FIREBASE_AUTH_EMULATOR_URL;
    if (import.meta.env.DEV && emulatorUrl) {
      connectAuthEmulator(auth, emulatorUrl, { disableWarnings: true });
    }
  }
  return auth;
}

/** Analytics is optional — loaded lazily and skipped where unsupported (e.g. blocked cookies). */
export async function initFirebaseAnalytics(): Promise<void> {
  if (!isFirebaseConfigured() || !firebaseConfig.measurementId || import.meta.env.DEV) return;
  try {
    const { getAnalytics, isSupported } = await import("firebase/analytics");
    if (await isSupported()) getAnalytics(getFirebaseApp());
  } catch {
    /* analytics must never block the dashboard */
  }
}
