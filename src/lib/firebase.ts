import { initializeApp, type FirebaseApp } from "firebase/app";
import { connectAuthEmulator, getAuth, type Auth } from "firebase/auth";

const L = (msg: string, ...a: unknown[]) =>
  console.log(`%c[firebase] ${msg}`, "color:#facc15;font-weight:bold", ...a);
const LE = (msg: string, ...a: unknown[]) =>
  console.error(`%c[firebase] ${msg}`, "color:#f87171;font-weight:bold", ...a);

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
  if (!app) {
    app = initializeApp(firebaseConfig);
    L("app initialised", { projectId: firebaseConfig.projectId, appId: firebaseConfig.appId });
  }
  return app;
}

export function getFirebaseAuth(): Auth {
  if (!auth) {
    L("initialising Auth");
    auth = getAuth(getFirebaseApp());
    auth.useDeviceLanguage();
    const emulatorUrl = import.meta.env.VITE_FIREBASE_AUTH_EMULATOR_URL;
    if (import.meta.env.DEV && emulatorUrl) {
      connectAuthEmulator(auth, emulatorUrl, { disableWarnings: true });
      L("Auth emulator connected", emulatorUrl);
    }
    L("Auth ready", { domain: firebaseConfig.authDomain });
  }
  return auth;
}

/**
 * Analytics is optional — skipped in dev and when the domain is not authorised.
 * The Firebase Installations 400 error is caused by Analytics trying to register
 * the domain; we catch and log it instead of letting it pollute the console.
 */
export async function initFirebaseAnalytics(): Promise<void> {
  if (!isFirebaseConfigured() || !firebaseConfig.measurementId) {
    L("analytics skipped — not configured");
    return;
  }
  if (import.meta.env.DEV) {
    L("analytics skipped — dev mode");
    return;
  }
  L("analytics init starting", { measurementId: firebaseConfig.measurementId, domain: window.location.hostname });
  try {
    const { getAnalytics, isSupported } = await import("firebase/analytics");
    const supported = await isSupported();
    L("analytics isSupported →", supported);
    if (supported) {
      getAnalytics(getFirebaseApp());
      L("analytics active ✓");
    } else {
      L("analytics not supported on this browser/domain — skipped");
    }
  } catch (err) {
    // 400 INVALID_ARGUMENT means the domain is not added to Firebase authorised domains.
    // Go to Firebase Console → Authentication → Settings → Authorised domains
    // and add: panditji.myastrosutra.online
    LE("analytics init failed (domain probably not authorised in Firebase Console)", err);
  }
}
