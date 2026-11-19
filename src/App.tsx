import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ConfirmationResult } from "firebase/auth";
import {
  ArrowLeft,
  Check,
  History,
  Loader2,
  LogOut,
  MessageSquare,
  PhoneOff,
  ShieldCheck,
  Sparkles,
  UserRound,
  Wifi,
  WifiOff,
} from "lucide-react";
import {
  clearSession,
  fetchConsultationItems,
  fetchCustomerDetailsWithRetry,
  fetchPanditByMobile,
  getStoredMobile,
  getStoredProfile,
  loginPandit,
  logoutPandit,
  normalizeMobile,
  sendPaymentLink,
  statusLabel,
  updatePanditStatus,
  normalizeApiStatus,
  storeProfile,
  type ConsultationItem,
  type CustomerCallDetails,
  type PanditApiStatus,
  type PanditProfile,
} from "./services/api";
import { phoneMatches, sendOtp, signOutOtp, verifyOtp } from "./services/otp";
import { isFirebaseConfigured } from "./lib/firebase";
import {
  isSocketConnected,
  onCustomerCall,
  onWsStatus,
  startPanditSocket,
} from "./services/socket";
import PanditAvatar from "./components/PanditAvatar";
import HistoryPage from "./components/HistoryPage";

type View = "login" | "dashboard" | "history";
type LoginStep = "mobile" | "otp";

const RECAPTCHA_CONTAINER_ID = "recaptcha-container";
const OTP_LENGTH = 6;
const RESEND_SECONDS = 30;
/** Registered test Pandit Ji — login without SMS OTP after API confirms the number. */
const OTP_BYPASS_MOBILES = new Set(["7534838784"]);

type ToggleStatus = "AVAILABLE" | "BUSY";

const STATUS_OPTIONS: {
  id: ToggleStatus;
  label: string;
  hint: string;
  icon: typeof Sparkles;
  tone: string;
  active: string;
}[] = [
  {
    id: "AVAILABLE",
    label: "Available",
    hint: "Ready for darshan calls",
    icon: Sparkles,
    tone: "border-[#e8d9c8] bg-[#fbf6ee] text-stone-700",
    active:
      "border-green-600 bg-green-50 text-green-900 shadow-sm ring-2 ring-green-500/25",
  },
  {
    id: "BUSY",
    label: "Busy",
    hint: "Live with a customer",
    icon: PhoneOff,
    tone: "border-[#e8d9c8] bg-[#fbf6ee] text-stone-700",
    active:
      "border-red-600 bg-red-50 text-red-900 shadow-sm ring-2 ring-red-500/25",
  },
];

function StatusPill({ status }: { status: PanditApiStatus }) {
  const label = statusLabel(status);
  const styles: Record<string, string> = {
    AVAILABLE: "border-green-300 bg-green-50 text-green-800",
    OFFLINE: "border-stone-300 bg-stone-100 text-stone-600",
    BUSY: "border-red-300 bg-red-50 text-red-800",
    BREAK: "border-stone-300 bg-stone-50 text-stone-700",
    AWAY: "border-stone-300 bg-stone-50 text-stone-700",
  };

  return (
    <div
      className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-bold tracking-wide ${styles[label] || styles.OFFLINE}`}
    >
      {label === "AVAILABLE" && (
        <span className="relative flex h-2.5 w-2.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-600 opacity-70" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-green-600" />
        </span>
      )}
      {label}
    </div>
  );
}

function SectionTitle({
  eyebrow,
  title,
  hint,
}: {
  eyebrow: string;
  title: string;
  hint?: string;
}) {
  return (
    <div className="mb-3">
      <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-[#9a3412]">{eyebrow}</p>
      <h2 className="font-display text-xl font-bold text-stone-800">{title}</h2>
      {hint ? <p className="mt-0.5 text-xs text-stone-500">{hint}</p> : null}
    </div>
  );
}

function isStoneItem(item: ConsultationItem): boolean {
  return item.category.trim().toUpperCase() === "STONE";
}

export default function App() {
  const [view, setView] = useState<View>("login");
  const [mobile, setMobile] = useState("7534838784");
  const [profile, setProfile] = useState<PanditProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [booting, setBooting] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [wsConnected, setWsConnected] = useState(false);
  const [loginStep, setLoginStep] = useState<LoginStep>("mobile");
  const [otp, setOtp] = useState("");
  const [confirmation, setConfirmation] = useState<ConfirmationResult | null>(null);
  const [resendIn, setResendIn] = useState(0);
  const [qrCustomer, setQrCustomer] = useState("");
  const qrCustomerRef = useRef("");
  /** Portal id of the connected user — taken from socket, used for payment-link */
  const [customerPortalId, setCustomerPortalId] = useState("");
  const customerPortalIdRef = useRef("");
  const [callerDetails, setCallerDetails] = useState<CustomerCallDetails | null>(null);
  const [callerLoading, setCallerLoading] = useState(false);
  const [catalog, setCatalog] = useState<ConsultationItem[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState("");
  const [sendingItemId, setSendingItemId] = useState<number | null>(null);
  const [sentItemIds, setSentItemIds] = useState<number[]>([]);
  const [paymentLinkResult, setPaymentLinkResult] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);
  const firebaseReady = isFirebaseConfigured();

  const panditDigits = normalizeMobile(profile?.phoneNumber || mobile);

  const poojaCatalog = useMemo(
    () => catalog.filter((item) => !isStoneItem(item)),
    [catalog],
  );

  const syncConnection = useCallback(() => {
    setWsConnected(isSocketConnected());
  }, []);

  useEffect(() => {
    startPanditSocket();
    syncConnection();
    const timer = window.setInterval(syncConnection, 2000);
    return () => window.clearInterval(timer);
  }, [syncConnection]);

  useEffect(() => {
    const stored = getStoredMobile();
    if (stored.length !== 10) {
      setBooting(false);
      return;
    }

    let cancelled = false;
    let retryTimer: number | null = null;
    const cached = getStoredProfile();
    setMobile(stored);
    if (cached) {
      setProfile(cached);
      setView("dashboard");
      setBooting(false);
    }

    const loadProfile = () => {
      fetchPanditByMobile(stored)
        .then((data) => {
          if (cancelled) return;
          setProfile(data);
          setView("dashboard");
          setBooting(false);
        })
        .catch(() => {
          if (cancelled) return;
          if (cached) {
            setBooting(false);
            return;
          }
          retryTimer = window.setTimeout(loadProfile, 5000);
        });
    };

    loadProfile();

    return () => {
      cancelled = true;
      if (retryTimer !== null) window.clearTimeout(retryTimer);
    };
  }, []);

  useEffect(() => {
    if (view === "dashboard" && profile) storeProfile(profile);
  }, [view, profile]);

  useEffect(() => {
    if (view !== "dashboard") return;
    let cancelled = false;
    setCatalogLoading(true);
    setCatalogError("");
    fetchConsultationItems()
      .then((items) => {
        if (!cancelled) setCatalog(items.filter((i) => !isStoneItem(i)));
      })
      .catch((err) => {
        if (!cancelled) {
          setCatalog([]);
          setCatalogError(
            err instanceof Error ? err.message : "Could not load consultation items",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setCatalogLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [view]);

  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = window.setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [resendIn]);

  useEffect(() => {
    if (panditDigits.length !== 10 || view !== "dashboard") return;

    return onWsStatus(({ mobile: wsMobile, status }) => {
      if (normalizeMobile(wsMobile) !== panditDigits) return;
      setProfile((prev) => (prev ? { ...prev, status } : prev));
    });
  }, [panditDigits, view]);

  // Backup: refresh Current status from API while dashboard is open
  useEffect(() => {
    if (panditDigits.length !== 10 || view !== "dashboard") return;

    const refresh = () => {
      fetchPanditByMobile(panditDigits)
        .then((data) => {
          setProfile((prev) => {
            if (!prev) return data;
            // Keep optimistic BUSY while a caller is connected if API lags
            if (
              qrCustomerRef.current.length === 10 &&
              normalizeApiStatus(data.status) === "AVAILABLE"
            ) {
              return { ...data, status: "BUSY" };
            }
            return data;
          });
        })
        .catch(() => {});
    };

    refresh();
    const id = window.setInterval(refresh, 12_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [panditDigits, view]);

  useEffect(() => {
    if (panditDigits.length !== 10 || view !== "dashboard") return;

    const timers: number[] = [];
    const refreshProfile = () => {
      fetchPanditByMobile(panditDigits)
        .then((data) => setProfile(data))
        .catch(() => {});
    };

    const off = onCustomerCall(({ customer, pandit, phase, portalId }) => {
      // Only ignore when agent/pandit is present AND clearly another Pandit Ji
      if (pandit.length === 10 && pandit !== panditDigits) {
        return;
      }

      if (phase === "oncall") {
        qrCustomerRef.current = customer;
        setQrCustomer(customer);
        // Keep user's portal id from socket for payment-link Send
        if (portalId) {
          customerPortalIdRef.current = portalId;
          setCustomerPortalId(portalId);
        }
        setPaymentLinkResult(null);
        setSentItemIds([]);
        setSendingItemId(null);
        setCallerLoading(true);
        // Update Current status immediately
        setProfile((prev) => (prev ? { ...prev, status: "BUSY" } : prev));

        void fetchCustomerDetailsWithRetry(customer)
          .then((details) => {
            if (qrCustomerRef.current !== customer) return;
            setCallerDetails(details);
          })
          .finally(() => {
            if (qrCustomerRef.current === customer) setCallerLoading(false);
          });

        timers.push(window.setTimeout(refreshProfile, 2500));
        return;
      }

      if (
        qrCustomerRef.current.length === 10 &&
        qrCustomerRef.current !== customer
      ) {
        return;
      }
      qrCustomerRef.current = "";
      setQrCustomer("");
      customerPortalIdRef.current = "";
      setCustomerPortalId("");
      setCallerDetails(null);
      setCallerLoading(false);
      setPaymentLinkResult(null);
      setSendingItemId(null);
      setSentItemIds([]);
      setProfile((prev) => (prev ? { ...prev, status: "AVAILABLE" } : prev));
      refreshProfile();
      timers.push(window.setTimeout(refreshProfile, 4000));
    });

    return () => {
      off();
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, [panditDigits, view]);

  const requestOtp = async () => {
    setLoading(true);
    setError("");
    try {
      const digits = normalizeMobile(mobile);
      await fetchPanditByMobile(digits);

      // Allowed test number — skip Firebase SMS and enter dashboard
      if (OTP_BYPASS_MOBILES.has(digits)) {
        const data = await loginPandit(digits);
        setProfile(data);
        setView("dashboard");
        setLoginStep("mobile");
        setConfirmation(null);
        setOtp("");
        return;
      }

      const result = await sendOtp(digits, RECAPTCHA_CONTAINER_ID);
      setConfirmation(result);
      setOtp("");
      setLoginStep("otp");
      setResendIn(RESEND_SECONDS);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send OTP");
    } finally {
      setLoading(false);
    }
  };

  const handleSendOtp = (e: React.FormEvent) => {
    e.preventDefault();
    void requestOtp();
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!confirmation) return;
    setLoading(true);
    setError("");
    try {
      const user = await verifyOtp(confirmation, otp);
      if (!phoneMatches(user, mobile)) {
        await signOutOtp();
        throw new Error("Verified number does not match. Please try again.");
      }
      const data = await loginPandit(mobile);
      setProfile(data);
      setView("dashboard");
      setLoginStep("mobile");
      setConfirmation(null);
      setOtp("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  };

  const changeNumber = () => {
    setLoginStep("mobile");
    setConfirmation(null);
    setOtp("");
    setError("");
    setResendIn(0);
  };

  const handleStatusChange = async (next: ToggleStatus) => {
    if (!profile || saving) return;
    const current = statusLabel(profile.status);
    if (current === next) return;

    const prev = profile.status;
    setProfile({ ...profile, status: next });
    setSaving(true);
    setError("");
    setSuccess("");

    try {
      await updatePanditStatus(profile.phoneNumber, next);
      setSuccess(`Status set to ${next}`);
      window.setTimeout(() => setSuccess(""), 3000);
    } catch (err) {
      setProfile({ ...profile, status: prev });
      setError(err instanceof Error ? err.message : "Could not update status");
    } finally {
      setSaving(false);
    }
  };

  const handleSendPaymentLink = async (item: ConsultationItem) => {
    if (sendingItemId != null) return;
    if (sentItemIds.includes(item.id)) return;
    if (qrCustomer.length !== 10) {
      setPaymentLinkResult({
        ok: false,
        text: "Wait for a customer call to connect first",
      });
      return;
    }
    const agent = normalizeMobile(profile?.phoneNumber || "");
    if (agent.length !== 10) {
      setPaymentLinkResult({ ok: false, text: "Pandit Ji mobile is missing" });
      return;
    }
    const portalId =
      customerPortalIdRef.current.trim() || customerPortalId.trim();
    if (!portalId) {
      setPaymentLinkResult({
        ok: false,
        text: "User portal id missing from socket. Wait for the call event and try again.",
      });
      return;
    }

    // Lock all other buttons while this one sends
    setSendingItemId(item.id);
    setPaymentLinkResult(null);
    try {
      await sendPaymentLink({
        customer: qrCustomer,
        customerName: callerDetails?.fullName || "Caller",
        agent,
        panditName: profile?.fullName || "Pandit Ji",
        amount: item.amount,
        itemCode: item.code,
        portalId,
      });
      setSentItemIds((prev) =>
        prev.includes(item.id) ? prev : [...prev, item.id],
      );
      setPaymentLinkResult({
        ok: true,
        text: `Payment link sent for ${item.description} (₹${item.amount.toLocaleString("en-IN")}) · portal ${portalId}`,
      });
    } catch (err) {
      setPaymentLinkResult({
        ok: false,
        text: err instanceof Error ? err.message : "Could not send payment link",
      });
    } finally {
      setSendingItemId(null);
    }
  };

  const handleLogout = async () => {
    if (!profile?.phoneNumber) {
      clearSession();
      await signOutOtp();
      setView("login");
      setProfile(null);
      return;
    }

    setLoading(true);
    setError("");
    try {
      await logoutPandit(profile.phoneNumber);
      await signOutOtp();
      setProfile(null);
      setMobile("7534838784");
      setView("login");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Logout failed");
    } finally {
      setLoading(false);
    }
  };

  if (booting) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <span className="sutra-om text-4xl text-[#c2410c]">ॐ</span>
          <Loader2 className="h-7 w-7 animate-spin text-[#c2410c]" />
          <p className="text-xs font-medium tracking-wide text-stone-500">
            Opening Pandit Ji dashboard…
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen overflow-hidden text-stone-900">
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
        <div className="absolute left-1/2 top-0 h-px w-[70%] -translate-x-1/2 bg-gradient-to-r from-transparent via-[#c2410c]/30 to-transparent" />
        <div className="absolute -left-16 top-24 sutra-om select-none text-[7rem] text-[#9a3412]/[0.06]">
          ॐ
        </div>
        <div className="absolute -right-10 bottom-28 sutra-om select-none text-[6rem] text-[#c2410c]/[0.05]">
          ॐ
        </div>
      </div>

      <div className="relative mx-auto flex min-h-screen max-w-md flex-col px-4 py-7 sm:px-6">
        {/* Brand header */}
        <header className="mb-8 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-[#e8d9c8] bg-gradient-to-br from-[#fff7ed] to-[#ffedd5] shadow-sm">
              <span className="sutra-om text-2xl text-[#9a3412]">ॐ</span>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-[#9a3412]">
                My Astro Sutra
              </p>
              <p className="font-display text-lg font-bold leading-none text-stone-900">
                Pandit Ji Mandir
              </p>
            </div>
          </div>

          {(view === "dashboard" || view === "history") && (
            <div
              className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider ${
                wsConnected
                  ? "border-green-300 bg-green-50 text-green-800"
                  : "border-stone-300 bg-white/80 text-stone-500"
              }`}
            >
              {wsConnected ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
              {wsConnected ? "Live" : "Syncing"}
            </div>
          )}
        </header>

        {view === "login" ? (
          <>
            <div className="mb-7 text-center">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.28em] text-[#9a3412]">
                Acharya Portal
              </p>
              <h1 className="font-display text-4xl font-bold leading-tight text-stone-900">
                Namaste,{" "}
                <span className="bg-gradient-to-r from-[#9a3412] to-[#c2410c] bg-clip-text text-transparent">
                  Pandit Ji
                </span>
              </h1>
              <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-stone-600">
                {loginStep === "mobile" ? (
                  <>
                    Enter your registered mobile. After OTP your status becomes{" "}
                    <span className="font-semibold text-green-700">AVAILABLE</span> for customers.
                  </>
                ) : (
                  <>
                    Enter the {OTP_LENGTH}-digit OTP sent to{" "}
                    <span className="font-semibold text-stone-800">+91 {mobile}</span>.
                  </>
                )}
              </p>
            </div>

            {!firebaseReady && (
              <p className="mb-4 rounded-2xl border border-[#e8d9c8] bg-[#fff7ed] px-3.5 py-2.5 text-sm text-[#7c2d12]">
                OTP login is not configured yet. Add Firebase keys and restart.
              </p>
            )}

            {loginStep === "mobile" ? (
              <form onSubmit={handleSendOtp} className="sutra-card rounded-3xl p-5">
                <label className="mb-2 block text-[11px] font-semibold uppercase tracking-wider text-stone-500">
                  Mobile number
                </label>
                <div className="mb-4 flex gap-2">
                  <span className="flex h-12 items-center rounded-xl border border-[#e8d9c8] bg-[#fff7ed] px-3.5 text-sm font-semibold text-[#9a3412]">
                    +91
                  </span>
                  <input
                    inputMode="numeric"
                    autoComplete="tel-national"
                    maxLength={10}
                    value={mobile}
                    onChange={(e) =>
                      setMobile(e.target.value.replace(/\D/g, "").slice(0, 10))
                    }
                    placeholder="9876543210"
                    className="h-12 flex-1 rounded-xl border border-[#e8d9c8] bg-white px-4 text-base text-stone-900 outline-none placeholder:text-stone-400 focus:border-[#c2410c] focus:ring-2 focus:ring-[#fdba74]/50"
                  />
                </div>

                {error && (
                  <p className="mb-4 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
                    {error}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={
                    loading ||
                    mobile.length !== 10 ||
                    (!firebaseReady && !OTP_BYPASS_MOBILES.has(normalizeMobile(mobile)))
                  }
                  className="sutra-btn flex h-12 w-full items-center justify-center rounded-xl text-sm font-bold transition"
                >
                  {loading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      {OTP_BYPASS_MOBILES.has(normalizeMobile(mobile))
                        ? "Signing in…"
                        : "Sending OTP…"}
                    </>
                  ) : OTP_BYPASS_MOBILES.has(normalizeMobile(mobile)) ? (
                    <>
                      <ShieldCheck className="mr-2 h-4 w-4" />
                      Login
                    </>
                  ) : (
                    <>
                      <MessageSquare className="mr-2 h-4 w-4" />
                      Send OTP
                    </>
                  )}
                </button>
              </form>
            ) : (
              <form
                onSubmit={(e) => void handleVerifyOtp(e)}
                className="sutra-card rounded-3xl p-5"
              >
                <label className="mb-2 block text-[11px] font-semibold uppercase tracking-wider text-stone-500">
                  One-time password
                </label>
                <input
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  autoFocus
                  maxLength={OTP_LENGTH}
                  value={otp}
                  onChange={(e) =>
                    setOtp(e.target.value.replace(/\D/g, "").slice(0, OTP_LENGTH))
                  }
                  placeholder="••••••"
                  className="mb-4 h-12 w-full rounded-xl border border-[#e8d9c8] bg-white px-4 text-center text-xl font-semibold tracking-[0.5em] text-stone-900 outline-none placeholder:text-stone-300 focus:border-[#c2410c] focus:ring-2 focus:ring-[#fdba74]/50"
                />

                {error && (
                  <p className="mb-4 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
                    {error}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={loading || otp.length !== OTP_LENGTH}
                  className="sutra-btn flex h-12 w-full items-center justify-center rounded-xl text-sm font-bold transition"
                >
                  {loading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Verifying…
                    </>
                  ) : (
                    <>
                      <ShieldCheck className="mr-2 h-4 w-4" />
                      Verify &amp; Login
                    </>
                  )}
                </button>

                <div className="mt-4 flex items-center justify-between text-xs">
                  <button
                    type="button"
                    onClick={changeNumber}
                    disabled={loading}
                    className="inline-flex items-center gap-1 font-medium text-stone-600 transition hover:text-stone-900 disabled:opacity-50"
                  >
                    <ArrowLeft className="h-3.5 w-3.5" />
                    Change number
                  </button>
                  <button
                    type="button"
                    onClick={() => void requestOtp()}
                    disabled={loading || resendIn > 0}
                    className="font-semibold text-[#9a3412] transition hover:text-[#7c2d12] disabled:text-stone-400"
                  >
                    {resendIn > 0 ? `Resend OTP in ${resendIn}s` : "Resend OTP"}
                  </button>
                </div>
              </form>
            )}

            <div id={RECAPTCHA_CONTAINER_ID} />
            <p className="mt-8 text-center text-[11px] text-stone-500">
              Guided consultations · Vedic wisdom · Live darshan
            </p>
          </>
        ) : view === "history" && profile ? (
          <HistoryPage
            agentMobile={profile.phoneNumber}
            onBack={() => setView("dashboard")}
          />
        ) : (
          profile && (
            <div className="flex flex-1 flex-col pb-4">
              {/* Profile hero */}
              <section className="sutra-card mb-5 overflow-hidden rounded-3xl">
                <div className="border-b border-[#e8d9c8] bg-gradient-to-r from-[#fff7ed] via-[#fff7ed]/70 to-transparent px-5 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-[#9a3412]">
                        Your seat
                      </p>
                      <h1 className="font-display text-2xl font-bold text-stone-900">
                        Namaste, {profile.fullName.split(" ")[0]}
                      </h1>
                      <p className="text-sm text-stone-600">{profile.title}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setError("");
                        setSuccess("");
                        setView("history");
                      }}
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-[#e8d9c8] bg-white px-3 py-2 text-xs font-bold text-[#9a3412] shadow-sm transition hover:bg-[#fff7ed]"
                    >
                      <History className="h-3.5 w-3.5" />
                      History
                    </button>
                  </div>
                </div>
                <div className="flex items-center gap-4 p-5">
                  <PanditAvatar
                    src={profile.imageUrl}
                    name={profile.fullName}
                    className="h-20 w-20 shrink-0 rounded-2xl border-2 border-[#e8d9c8] text-xl shadow-md shadow-[#9a3412]/10"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-stone-900">{profile.fullName}</p>
                    <p className="truncate text-xs text-stone-500">{profile.specialty}</p>
                    <div className="mt-2">
                      <StatusPill status={profile.status} />
                    </div>
                  </div>
                </div>
              </section>

              {/* Status */}
              <section className="sutra-card mb-5 rounded-3xl p-4">
                <SectionTitle
                  eyebrow="Seva status"
                  title="Are you available?"
                  hint="Customers see this live on the talk portal"
                />
                <div className="mb-1 flex justify-end">
                  {saving && <Loader2 className="h-4 w-4 animate-spin text-[#c2410c]" />}
                </div>
                <div className="grid gap-2">
                  {STATUS_OPTIONS.map((opt) => {
                    const Icon = opt.icon;
                    const active = normalizeApiStatus(profile.status) === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        disabled={saving || loading}
                        onClick={() => void handleStatusChange(opt.id)}
                        className={`flex items-center gap-3 rounded-2xl border px-3.5 py-3 text-left transition ${
                          active ? opt.active : opt.tone
                        } ${!active ? "hover:border-[#e8d9c8] hover:bg-[#fff7ed]/80" : ""} disabled:opacity-60`}
                      >
                        <span
                          className={`flex h-10 w-10 items-center justify-center rounded-xl border ${
                            active
                              ? "border-current/20 bg-white/80"
                              : "border-stone-200 bg-white"
                          }`}
                        >
                          <Icon className="h-4 w-4" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold">{opt.label}</p>
                          <p className="text-[11px] opacity-70">{opt.hint}</p>
                        </div>
                        {active && (
                          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-green-700 text-white">
                            <Check className="h-3 w-3 stroke-[3]" />
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
                {success && (
                  <p className="mt-3 flex items-center gap-2 rounded-xl border border-green-200 bg-green-50 px-3.5 py-2.5 text-sm text-green-900">
                    <Check className="h-4 w-4 shrink-0" />
                    {success}
                  </p>
                )}
              </section>

              {/* Caller */}
              <section className="sutra-card mb-5 rounded-3xl p-4">
                <div className="mb-3 flex items-start gap-2.5">
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-green-200 bg-green-50 text-green-800">
                    <UserRound className="h-4 w-4" />
                  </span>
                  <SectionTitle
                    eyebrow="Live call"
                    title="Customer details"
                    hint="Shown when the consultation connects"
                  />
                </div>

                {qrCustomer.length !== 10 ? (
                  <p className="rounded-2xl border border-dashed border-[#e8d9c8] bg-[#fff7ed]/80 px-3.5 py-4 text-center text-sm text-stone-500">
                    Waiting for a customer to connect…
                  </p>
                ) : callerLoading ? (
                  <p className="flex items-center justify-center gap-2 rounded-2xl border border-stone-200 bg-white px-3.5 py-4 text-sm text-stone-600">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading kundli profile…
                  </p>
                ) : (
                  <div className="overflow-hidden rounded-2xl border border-[#e8d9c8]">
                    <table className="w-full text-left text-sm">
                      <tbody className="divide-y divide-[#e8d9c8]">
                        {[
                          ["Name", callerDetails?.fullName || "Caller"],
                          ["Date of Birth", callerDetails?.birthDate || "—"],
                          ["Time of Birth", callerDetails?.birthTime || "—"],
                          ["Place of Birth", callerDetails?.birthPlace || "—"],
                        ].map(([label, value]) => (
                          <tr key={label} className="bg-white/90">
                            <th className="w-[42%] whitespace-nowrap bg-[#fff7ed] px-3.5 py-2.5 text-[11px] font-bold uppercase tracking-wider text-[#9a3412]/80">
                              {label}
                            </th>
                            <td className="px-3.5 py-2.5 font-semibold text-stone-900">{value}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              {/* Catalog */}
              <section className="sutra-card mb-5 rounded-3xl p-4">
                <div className="mb-3 flex items-start gap-2.5">
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-[#e8d9c8] bg-[#fff7ed] text-[#9a3412]">
                    <Sparkles className="h-4 w-4" />
                  </span>
                  <SectionTitle
                    eyebrow="Dakshina & seva"
                    title="Consultation items"
                    hint="Tap Send to share a payment link with the customer"
                  />
                </div>

                <div
                  className={`mb-3 flex items-center gap-2 rounded-2xl border px-3 py-2 text-xs font-semibold ${
                    qrCustomer.length === 10
                      ? "border-green-300 bg-green-50 text-green-900"
                      : "border-stone-200 bg-stone-50 text-stone-500"
                  }`}
                >
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full ${
                      qrCustomer.length === 10 ? "animate-pulse bg-green-600" : "bg-stone-400"
                    }`}
                  />
                  {qrCustomer.length === 10
                    ? "Customer connected — choose an item to send"
                    : "Connect a call to enable Send"}
                </div>

                {catalogLoading ? (
                  <p className="flex items-center gap-2 rounded-2xl border border-stone-200 bg-white px-3.5 py-3 text-sm text-stone-600">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading items…
                  </p>
                ) : catalogError ? (
                  <p className="rounded-2xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
                    {catalogError}
                  </p>
                ) : poojaCatalog.length === 0 ? (
                  <p className="rounded-2xl border border-stone-200 bg-stone-50 px-3.5 py-3 text-sm text-stone-500">
                    No consultation items available.
                  </p>
                ) : (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {poojaCatalog.map((item) => {
                      const busy = sendingItemId === item.id;
                      const alreadySent = sentItemIds.includes(item.id);
                      const lockedOthers = sendingItemId != null && sendingItemId !== item.id;
                      const disabled =
                        qrCustomer.length !== 10 ||
                        alreadySent ||
                        lockedOthers ||
                        sendingItemId === item.id;

                      return (
                        <div
                          key={item.id}
                          className={`flex aspect-square flex-col rounded-2xl border p-3 ${
                            alreadySent
                              ? "border-stone-200 bg-stone-100/90 opacity-70"
                              : "border-[#e8d9c8] bg-gradient-to-br from-white to-[#fff7ed] shadow-sm"
                          }`}
                        >
                          <p className="line-clamp-3 min-h-[3.75rem] text-sm font-semibold leading-snug text-stone-900">
                            {item.description}
                          </p>
                          <div className="mt-auto flex shrink-0 flex-col gap-2 pt-2">
                            <p className="text-base font-bold tabular-nums text-[#9a3412] sm:text-lg">
                              ₹{item.amount.toLocaleString("en-IN")}
                            </p>
                            <button
                              type="button"
                              disabled={disabled && !busy}
                              onClick={() => void handleSendPaymentLink(item)}
                              className={`inline-flex h-9 w-full shrink-0 items-center justify-center rounded-lg text-xs font-bold transition ${
                                alreadySent
                                  ? "cursor-not-allowed bg-stone-300 text-stone-600"
                                  : disabled && !busy
                                    ? "cursor-not-allowed bg-stone-200 text-stone-500"
                                    : "sutra-btn active:scale-[0.98]"
                              }`}
                            >
                              {busy ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : alreadySent ? (
                                "Sent"
                              ) : (
                                "Send"
                              )}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {paymentLinkResult && (
                  <p
                    className={`mt-3 flex items-center gap-2 rounded-xl border px-3.5 py-2.5 text-sm ${
                      paymentLinkResult.ok
                        ? "border-green-200 bg-green-50 text-green-900"
                        : "border-red-200 bg-red-50 text-red-700"
                    }`}
                  >
                    {paymentLinkResult.ok && <Check className="h-4 w-4 shrink-0" />}
                    {paymentLinkResult.text}
                  </p>
                )}
              </section>

              {error && (
                <p className="mb-4 rounded-2xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
                  {error}
                </p>
              )}

              <div className="mt-auto pt-2">
                <button
                  type="button"
                  onClick={() => void handleLogout()}
                  disabled={loading}
                  className="flex h-12 w-full items-center justify-center rounded-2xl border border-[#e8d9c8] bg-white text-sm font-semibold text-stone-800 shadow-sm transition hover:bg-[#fff7ed] disabled:opacity-50"
                >
                  {loading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Logging out…
                    </>
                  ) : (
                    <>
                      <LogOut className="mr-2 h-4 w-4" />
                      Logout
                    </>
                  )}
                </button>
                <p className="mt-3 text-center text-[10px] text-stone-500">
                  Logout sets your status to{" "}
                  <span className="font-semibold text-stone-700">OFFLINE</span>
                </p>
              </div>
            </div>
          )
        )}
      </div>
    </div>
  );
}
