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

let verifier: RecaptchaVerifier | null = null;

function resetVerifier(): void {
  verifier?.clear();
  verifier = null;
}

function getVerifier(containerId: string): RecaptchaVerifier {
  if (!verifier) {
    verifier = new RecaptchaVerifier(getFirebaseAuth(), containerId, {
      size: "invisible",
      "expired-callback": resetVerifier,
    });
  }
  return verifier;
}

function otpErrorMessage(err: unknown): string {
  const code = err instanceof FirebaseError ? err.code : "";
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
      return "Verification failed. Please refresh the page and try again.";
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

/** Sends an SMS OTP to +91<mobile> via Firebase Phone Auth (invisible reCAPTCHA). */
export async function sendOtp(mobile: string, recaptchaContainerId: string): Promise<ConfirmationResult> {
  const msisdn = normalizeMobile(mobile);
  if (msisdn.length !== 10) throw new Error("Enter a valid 10-digit mobile number");

  try {
    return await signInWithPhoneNumber(getFirebaseAuth(), `+91${msisdn}`, getVerifier(recaptchaContainerId));
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
