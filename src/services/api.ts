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
const GET_DATA_PATH =
  import.meta.env.VITE_ASTRO_GET_DATA_URL || "/api/astro/getdata";
const CONSULTATION_ITEMS_PATH =
  import.meta.env.VITE_CONSULTATION_ITEMS_URL || "/api/consultation/items";
const PAYMENT_LINK_PATH =
  import.meta.env.VITE_ASTRO_PAYMENT_LINK_URL || "/api/astro/payment-link";
const PANDIT_HISTORY_PATH =
  import.meta.env.VITE_ASTRO_PANDIT_HISTORY_URL || "/api/astro/pandit/history";
const DEFAULT_PORTAL_ID = import.meta.env.VITE_PORTAL_ID || "1028";
const SESSION_KEY = "pandit_dashboard_mobile";
const PROFILE_KEY = "pandit_dashboard_profile";

/** Caller details shown when a call is connected */
export type CustomerCallDetails = {
  mobile: string;
  fullName: string;
  birthDate: string;
  birthTime: string;
  birthPlace: string;
};

export type ConsultationItem = {
  id: number;
  code: string;
  category: string;
  amount: number;
  itemType: string;
  description: string;
  status: number;
  createdAt?: string;
  updatedAt?: string;
};

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
  const s = (raw || "").trim().toUpperCase().replace(/[\s-]+/g, "_");
  if (s === "AVAILABLE" || s === "ONLINE" || s === "FREE") return "AVAILABLE";
  if (s === "OFFLINE") return "OFFLINE";
  if (s === "BREAK" || s === "ON_BREAK" || s === "AWAY") return "BREAK";
  if (
    s === "BUSY" ||
    s === "ON_CALL" ||
    s === "ONCALL" ||
    s === "CALLING" ||
    s === "IN_CALL" ||
    s === "CONNECTED"
  ) {
    return "BUSY";
  }
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

export function getStoredProfile(): PanditProfile | null {
  try {
    const data = JSON.parse(localStorage.getItem(PROFILE_KEY) || "null") as PanditProfile | null;
    return data?.phoneNumber ? data : null;
  } catch {
    return null;
  }
}

export function storeProfile(profile: PanditProfile): void {
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
}

export function clearSession(): void {
  localStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(PROFILE_KEY);
}

export class PanditNotFoundError extends Error {}

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
    throw new PanditNotFoundError(
      `Mobile number ${msisdn} is not registered as a Pandit Ji. Please contact admin.`,
    );
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

function mapCustomerDetails(
  data: Record<string, unknown>,
  msisdn: string,
): CustomerCallDetails {
  const fullName = String(data.fullName || data.name || "").trim();
  const birthDate = String(data.birthDate || data.dob || "").trim();
  const birthTimeRaw = String(data.birthTime || data.tob || "").trim();
  const birthTime = birthTimeRaw.replace(/^(\d{1,2}:\d{2}).*$/, "$1");
  const birthPlace = String(data.birthPlace || data.pob || "").trim();

  return {
    mobile: normalizeMobile(String(data.phoneNumber || data.msisdn || msisdn)),
    fullName: fullName || "Caller",
    birthDate: birthDate || "—",
    birthTime: birthTime || "—",
    birthPlace: birthPlace || "—",
  };
}

/** GET /api/astro/getdata?msisdn= — Name, DOB, TOB, POB for the connected caller. */
export async function fetchCustomerDetails(
  customerMobile: string,
): Promise<CustomerCallDetails | null> {
  const msisdn = normalizeMobile(customerMobile);
  if (msisdn.length !== 10) return null;

  const response = await fetch(
    `${resolveApiUrl(GET_DATA_PATH)}?msisdn=${encodeURIComponent(msisdn)}`,
    { method: "GET", headers: { Accept: "application/json" } },
  );

  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`Could not load caller details (${response.status})`);
  }

  const data = (await response.json()) as Record<string, unknown>;
  return mapCustomerDetails(data, msisdn);
}

/**
 * Retries getdata a few times — profile can lag right after OTP / saveuserdata.
 */
export async function fetchCustomerDetailsWithRetry(
  customerMobile: string,
  attempts = 4,
  delayMs = 900,
): Promise<CustomerCallDetails> {
  const msisdn = normalizeMobile(customerMobile);
  const fallback: CustomerCallDetails = {
    mobile: msisdn,
    fullName: "Caller",
    birthDate: "—",
    birthTime: "—",
    birthPlace: "—",
  };
  if (msisdn.length !== 10) return fallback;

  for (let i = 0; i < attempts; i++) {
    try {
      const details = await fetchCustomerDetails(msisdn);
      if (details && details.fullName && details.fullName !== "Caller") {
        return details;
      }
      if (details) {
        // Keep last non-null result even if name is still placeholder
        if (i === attempts - 1) return details;
      }
    } catch {
      /* retry */
    }
    if (i < attempts - 1) {
      await new Promise((r) => window.setTimeout(r, delayMs));
    }
  }
  return fallback;
}

/** GET /api/consultation/items — pooja / stone catalog for Pandit Ji. */
export async function fetchConsultationItems(): Promise<ConsultationItem[]> {
  const response = await fetch(resolveApiUrl(CONSULTATION_ITEMS_PATH), {
    method: "GET",
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(`Could not load consultation items (${response.status})`);
  }

  const data = (await response.json()) as unknown;
  if (!Array.isArray(data)) return [];

  return data
    .map((raw) => {
      const row = raw as Record<string, unknown>;
      return {
        id: Number(row.id) || 0,
        code: String(row.code || "").trim(),
        category: String(row.category || "").trim() || "Other",
        amount: Number(row.amount) || 0,
        itemType: String(row.itemType || "").trim() || "SERVICE",
        description: String(row.description || "").trim() || "Item",
        status: Number(row.status) || 0,
        createdAt: row.createdAt ? String(row.createdAt) : undefined,
        updatedAt: row.updatedAt ? String(row.updatedAt) : undefined,
      } satisfies ConsultationItem;
    })
    .filter((item) => item.id > 0 && item.status === 1);
}

export type PaymentLinkPayload = {
  portalId: number | string;
  customer: string;
  customerName: string;
  agent: string;
  panditName: string;
  amount: number;
  itemCode: string;
};

/** POST /api/astro/payment-link — push payment link to the connected customer's screen. */
export async function sendPaymentLink(input: {
  customer: string;
  customerName: string;
  agent: string;
  panditName: string;
  amount: number;
  itemCode: string;
  portalId?: number | string;
}): Promise<void> {
  const customer = normalizeMobile(input.customer);
  const agent = normalizeMobile(input.agent);
  if (customer.length !== 10) {
    throw new Error("Connect a customer call before sending a payment link");
  }
  if (agent.length !== 10) {
    throw new Error("Pandit Ji mobile is missing");
  }
  if (!input.itemCode.trim()) {
    throw new Error("Item code is required");
  }

  const portalRaw = String(input.portalId ?? DEFAULT_PORTAL_ID).trim() || "1028";
  const portalNum = Number(portalRaw);
  const payload: PaymentLinkPayload = {
    portalId: Number.isFinite(portalNum) ? portalNum : portalRaw,
    customer,
    customerName: (input.customerName || "Caller").trim() || "Caller",
    agent,
    panditName: (input.panditName || "Pandit Ji").trim() || "Pandit Ji",
    amount: Number(input.amount) || 0,
    itemCode: input.itemCode.trim(),
  };

  const response = await fetch(resolveApiUrl(PAYMENT_LINK_PATH), {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(text || `Payment link failed (${response.status})`);
  }
}

export type HistoryPurchaseItem = {
  itemCode: string;
  productName: string;
  amount: number;
  quantity: number;
};

export type HistoryPurchase = {
  transactionId: number;
  customerMobile: string;
  customerName: string;
  createdAt: string;
  totalAmount: number;
  paymentStatus: string | null;
  paymentDate: string;
  items: HistoryPurchaseItem[];
};

export type HistoryCall = {
  callDate: string;
  customerCallDuration: string;
  /** Kept for View → getdata; never display on History list. */
  customerNumber: string;
  callTime: string;
  customerName: string;
};

export type PanditHistory = {
  purchaseHistory: HistoryPurchase[];
  callHistory: HistoryCall[];
};

/** Local calendar date as YYYY-MM-DD */
export function toSearchDate(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** GET /api/astro/pandit/history?agent=&searchDate=YYYY-MM-DD */
export async function fetchPanditHistory(
  agentMobile: string,
  searchDate: string,
): Promise<PanditHistory> {
  const agent = normalizeMobile(agentMobile);
  if (agent.length !== 10) {
    throw new Error("Pandit Ji mobile is missing");
  }
  const date = String(searchDate || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error("Choose a valid date");
  }

  const url =
    `${resolveApiUrl(PANDIT_HISTORY_PATH)}?agent=${encodeURIComponent(agent)}` +
    `&searchDate=${encodeURIComponent(date)}`;

  const response = await fetch(url, {
    method: "GET",
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(text || `Could not load history (${response.status})`);
  }

  const data = (await response.json()) as Record<string, unknown>;
  const purchasesRaw = Array.isArray(data.purchaseHistory) ? data.purchaseHistory : [];
  const callsRaw = Array.isArray(data.callHistory) ? data.callHistory : [];

  const purchaseHistory: HistoryPurchase[] = purchasesRaw.map((raw) => {
    const row = raw as Record<string, unknown>;
    const itemsRaw = Array.isArray(row.items) ? row.items : [];
    return {
      transactionId: Number(row.transaction_id) || 0,
      customerMobile: normalizeMobile(String(row.customer_mobile || "")),
      customerName: String(row.customer_name || "Customer").trim() || "Customer",
      createdAt: String(row.created_at || ""),
      totalAmount: Number(row.total_amount) || 0,
      paymentStatus: row.payment_status == null ? null : String(row.payment_status),
      paymentDate: String(row.payment_date || ""),
      items: itemsRaw.map((itemRaw) => {
        const item = itemRaw as Record<string, unknown>;
        return {
          itemCode: String(item.item_code || "").trim(),
          productName: String(item.product_name || "Item").trim() || "Item",
          amount: Number(item.amount) || 0,
          quantity: Number(item.quantity) || 1,
        };
      }),
    };
  });

  const callHistory: HistoryCall[] = callsRaw.map((raw) => {
    const row = raw as Record<string, unknown>;
    const customerNumber = normalizeMobile(
      String(row.customer_number || row.msisdn || row.customer_mobile || ""),
    );
    const customerName = String(
      row.customer_name || row.customerName || row.fullName || row.name || "",
    ).trim();
    return {
      callDate: String(row.call_date || ""),
      customerCallDuration: String(row.customer_call_duration || "00:00:00"),
      customerNumber,
      callTime: String(row.call_time || ""),
      customerName: customerName || "Customer",
    };
  });

  return { purchaseHistory, callHistory };
}

/** Login: load profile then set AVAILABLE */
export async function loginPandit(mobile: string): Promise<PanditProfile> {
  const profile = await fetchPanditByMobile(mobile);
  await updatePanditStatus(profile.phoneNumber, "AVAILABLE");
  const loggedIn: PanditProfile = { ...profile, status: "AVAILABLE" };
  storeMobile(profile.phoneNumber);
  storeProfile(loggedIn);
  return loggedIn;
}

/** Logout: set OFFLINE then clear session */
export async function logoutPandit(mobile: string): Promise<void> {
  const msisdn = normalizeMobile(mobile);
  if (msisdn.length === 10) {
    await updatePanditStatus(msisdn, "OFFLINE");
  }
  clearSession();
}
