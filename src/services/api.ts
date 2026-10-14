export type PanditApiStatus =
  | "AVAILABLE"
  | "OFFLINE"
  | "BUSY"
  | "BREAK"
  | "available"
  | "offline"
  | "busy"
  | "break";

export type PanditProfile = {
  id: string;
  fullName: string;
  title: string;
  specialty: string;
  imageUrl: string;
  phoneNumber: string;
  gender: string;
  status: PanditApiStatus;
  isActive: boolean;
};

import { resolveApiUrl, resolveImageUrl } from "../lib/upstream";

const PANDIT_BY_MOBILE_PATH =
  import.meta.env.VITE_ASTRO_PANDIT_BY_MOBILE_URL || "/api/astro/pandit";
const PANDIT_STATUS_PATH =
  import.meta.env.VITE_ASTRO_PANDIT_STATUS_URL || "/api/astro/pandit/status";
const SHOW_QR_PATH = import.meta.env.VITE_ASTRO_SHOW_QR_URL || "/api/astro/show-qr";
const SESSION_KEY = "pandit_dashboard_mobile";

function mapProfile(data: Record<string, unknown>, mobile: string): PanditProfile {
  const phone = normalizeMobile(String(data.phoneNumber || mobile));
  return {
    id: String(data.id ?? ""),
    fullName: String(data.fullName || data.name || "Pandit Ji").trim(),
    title: String(data.title || "Vedic Acharya").trim(),
    specialty: String(data.specialty || "Vedic Guidance").trim(),
    imageUrl: resolveImageUrl(String(data.imageUrl || "")),
    phoneNumber: phone,
    gender: String(data.gender || "Male").trim(),
    status: normalizeApiStatus(String(data.status || "OFFLINE")),
    isActive: data.isActive !== false,
  };
}

export function normalizeMobile(raw: string): string {
  const digits = String(raw || "").replace(/\D/g, "");
  if (digits.length >= 10) return digits.slice(-10);
  return digits;
}

export function normalizeApiStatus(raw?: string): PanditApiStatus {
  const s = (raw || "").trim().toUpperCase();
  if (s === "AVAILABLE" || s === "ONLINE" || s === "FREE") return "AVAILABLE";
  if (s === "OFFLINE") return "OFFLINE";
  if (s === "BREAK" || s === "ON_BREAK") return "BREAK";
  if (s === "BUSY" || s === "ON_CALL") return "BUSY";
  return "OFFLINE";
}

export function statusLabel(status: PanditApiStatus): string {
  const normalized = normalizeApiStatus(status);
  if (normalized === "BREAK") return "AWAY";
  return normalized;
}

export function getStoredMobile(): string {
  return normalizeMobile(localStorage.getItem(SESSION_KEY) || "");
}

export function storeMobile(mobile: string): void {
  const digits = normalizeMobile(mobile);
  if (digits.length === 10) {
    localStorage.setItem(SESSION_KEY, digits);
  }
}

export function clearSession(): void {
  localStorage.removeItem(SESSION_KEY);
}

/** GET /api/astro/pandit?mobile= */
export async function fetchPanditByMobile(mobile: string): Promise<PanditProfile> {
  const msisdn = normalizeMobile(mobile);
  if (msisdn.length !== 10) {
    throw new Error("Enter a valid 10-digit mobile number");
  }

  const response = await fetch(
    `${resolveApiUrl(PANDIT_BY_MOBILE_PATH)}?mobile=${encodeURIComponent(msisdn)}`,
    { method: "GET", headers: { Accept: "application/json" } },
  );

  if (response.status === 404) {
    throw new Error("No Pandit Ji profile found for this number");
  }
  if (!response.ok) {
    throw new Error(`Could not load profile (${response.status})`);
  }

  const data = (await response.json()) as Record<string, unknown>;
  return mapProfile(data, msisdn);
}

/** POST /api/astro/pandit/status?mobile=&status=AVAILABLE|OFFLINE|BUSY|BREAK */
export async function updatePanditStatus(
  mobile: string,
  status: PanditApiStatus,
): Promise<void> {
  const msisdn = normalizeMobile(mobile);
  if (msisdn.length !== 10) {
    throw new Error("Valid mobile required");
  }

  const apiStatus = normalizeApiStatus(status);
  const url =
    `${resolveApiUrl(PANDIT_STATUS_PATH)}?mobile=${encodeURIComponent(msisdn)}` +
    `&status=${encodeURIComponent(apiStatus)}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(text || `Status update failed (${response.status})`);
  }
}

/** GET /api/astro/show-qr?customer= — backend pushes the payment QR to that customer's screen. */
export async function sendPaymentQr(customerMobile: string): Promise<void> {
  const customer = normalizeMobile(customerMobile);
  if (customer.length !== 10) {
    throw new Error("Enter the customer's 10-digit mobile number");
  }

  const response = await fetch(
    `${resolveApiUrl(SHOW_QR_PATH)}?customer=${encodeURIComponent(customer)}`,
    { method: "GET", headers: { Accept: "application/json" } },
  );

  if (!response.ok) {
    throw new Error(`Could not send QR (${response.status})`);
  }
}

/** Login: load profile then set AVAILABLE */
export async function loginPandit(mobile: string): Promise<PanditProfile> {
  const profile = await fetchPanditByMobile(mobile);
  await updatePanditStatus(profile.phoneNumber, "AVAILABLE");
  storeMobile(profile.phoneNumber);
  return { ...profile, status: "AVAILABLE" };
}

/** Logout: set OFFLINE then clear session */
export async function logoutPandit(mobile: string): Promise<void> {
  const msisdn = normalizeMobile(mobile);
  if (msisdn.length === 10) {
    await updatePanditStatus(msisdn, "OFFLINE");
  }
  clearSession();
}
