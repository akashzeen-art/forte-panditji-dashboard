import {
  RecaptchaVerifier,
  signInWithPhoneNumber,
  signOut,
  type ConfirmationResult,
  type User,
} from "firebase/auth";
import { FirebaseError } from "firebase/app";
import { getFirebaseAuth } from "../lib/firebase";
import { normalizeMobile } from "./api";

const RECAPTCHA_TIMEOUT_MS = 120_000;

let verifier: RecaptchaVerifier | null = null;

function resetVerifier(): void {
  try {
    verifier?.clear();
  } catch {
    /* widget already gone */
  }
  verifier = null;
}

/** A fresh widget in a fresh element per attempt — reusing a cleared/expired one fails verification. */
function createVerifier(containerId: string): RecaptchaVerifier {
  resetVerifier();
  const host = document.getElementById(containerId);
  if (!host) throw new Error("Verification widget missing. Please refresh the page.");
  const el = document.createElement("div");
  host.replaceChildren(el);
  verifier = new RecaptchaVerifier(getFirebaseAuth(), el, { size: "invisible" });
  return verifier;
}

function isIpHost(hostname: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.includes(":");
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(
      () => reject(new Error("Verification timed out. Please tap Send OTP again.")),
      ms,
    );
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        window.clearTimeout(timer);
        reject(err);
      },
    );
  });
}

function otpErrorMessage(err: unknown): string {
  const code = err instanceof FirebaseError ? err.code : "";
  console.warn("[otp]", code || "error", err);
  switch (code) {
    case "auth/invalid-phone-number":
      return "Invalid mobile number";
    case "auth/too-many-requests":
      return "Too many attempts. Please try again later.";
    case "auth/billing-not-enabled":
      return "SMS OTP needs the Firebase Blaze plan. Upgrade the project, or use a test phone number.";
    case "auth/quota-exceeded":
      return "OTP limit reached for today. Please try again later.";
    case "auth/invalid-verification-code":
      return "Incorrect OTP. Please check and try again.";
    case "auth/code-expired":
      return "OTP expired. Please request a new one.";
    case "auth/captcha-check-failed":
    case "auth/invalid-app-credential":
      return `Verification failed (${code}). Please refresh the page and try again.`;
    case "auth/unauthorized-domain":
      return "This domain is not authorised in Firebase. Add it under Authentication → Settings → Authorized domains.";
    case "auth/operation-not-allowed":
      if (err instanceof Error && /region/i.test(err.message)) {
        return "SMS to India is not enabled in Firebase. Allow India under Authentication → Settings → SMS region policy.";
      }
      return "Phone sign-in is disabled in Firebase. Enable it under Authentication → Sign-in method.";
    case "auth/network-request-failed":
      return "Network error. Check your connection and try again.";
    default:
      return err instanceof Error ? err.message : "Something went wrong";
  }
}

// ── Web OTP API (Chrome Android auto-retrieval) ──────────────────────────────

type OtpCredential = { code: string };

/** Starts Web OTP API listener. Resolves with the 6-digit code when SMS arrives, or null if unsupported/timed-out. */
function listenWebOtp(signal: AbortSignal): Promise<string | null> {
  if (typeof navigator === "undefined" || !("credentials" in navigator)) return Promise.resolve(null);
  return (navigator.credentials as unknown as {
    get(opts: { otp: { transport: string[] }; signal: AbortSignal }): Promise<OtpCredential | null>;
  })
    .get({ otp: { transport: ["sms"] }, signal })
    .then((c) => c?.code ?? null)
    .catch(() => null);
}

/** Sends an SMS OTP to +91<mobile> via Firebase Phone Auth (invisible reCAPTCHA).
 *  Also starts Web OTP API listener so Chrome Android auto-fills + auto-submits. */
export async function sendOtp(
  mobile: string,
  recaptchaContainerId: string,
  onAutoVerify?: (code: string) => void,
): Promise<ConfirmationResult> {
  const msisdn = normalizeMobile(mobile);
  if (msisdn.length !== 10) throw new Error("Enter a valid 10-digit mobile number");

  const { hostname, port } = window.location;
  if (isIpHost(hostname)) {
    throw new Error(
      `OTP doesn't work on an IP address (${hostname}). Open http://localhost:${port || "3001"} or the live site instead.`,
    );
  }

  try {
    const confirmation = await withTimeout(
      signInWithPhoneNumber(getFirebaseAuth(), `+91${msisdn}`, createVerifier(recaptchaContainerId)),
      RECAPTCHA_TIMEOUT_MS,
    );

    // Start Web OTP API in background — Chrome Android intercepts SMS automatically
    if (onAutoVerify) {
      const abort = new AbortController();
      // Cancel after 2 minutes
      const cancelTimer = window.setTimeout(() => abort.abort(), 120_000);
      listenWebOtp(abort.signal).then((code) => {
        window.clearTimeout(cancelTimer);
        if (code && code.length === 6) onAutoVerify(code);
      });
    }

    return confirmation;
  } catch (err) {
    resetVerifier();
    throw new Error(otpErrorMessage(err));
  }
}

export async function verifyOtp(confirmation: ConfirmationResult, code: string): Promise<User> {
  try {
    const { user } = await confirmation.confirm(code.trim());
    return user;
  } catch (err) {
    throw new Error(otpErrorMessage(err));
  }
}

/** Resolves the signed-in Firebase user after the persisted session has been restored. */
export async function getVerifiedUser(): Promise<User | null> {
  const auth = getFirebaseAuth();
  await auth.authStateReady();
  return auth.currentUser;
}

export function phoneMatches(user: User | null, mobile: string): boolean {
  const msisdn = normalizeMobile(mobile);
  return msisdn.length === 10 && normalizeMobile(user?.phoneNumber || "") === msisdn;
}

export async function signOutOtp(): Promise<void> {
  resetVerifier();
  await signOut(getFirebaseAuth()).catch(() => {});
}
