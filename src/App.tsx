import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ConfirmationResult } from "firebase/auth";
import {
  ArrowLeft,
  Calendar,
  Check,
  Clock,
  Loader2,
  LogOut,
  MapPin,
  MessageSquare,
  PhoneOff,
  ShieldCheck,
  Sparkles,
  Star,
  UserRound,
  Wifi,
  WifiOff,
} from "lucide-react";
import {
  clearSession,
  fetchConsultationItems,
  fetchCustomerDetails,
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

type View = "login" | "dashboard";
type LoginStep = "mobile" | "otp";

const RECAPTCHA_CONTAINER_ID = "recaptcha-container";
const OTP_LENGTH = 6;
const RESEND_SECONDS = 30;

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
    hint: "Ready to take calls",
    icon: Sparkles,
    tone: "border-emerald-200 bg-emerald-50 text-emerald-800",
    active:
      "border-emerald-500 bg-emerald-100 text-emerald-900 shadow-sm ring-2 ring-emerald-400/40",
  },
  {
    id: "BUSY",
    label: "Busy",
    hint: "On a live consultation",
    icon: PhoneOff,
    tone: "border-rose-200 bg-rose-50 text-rose-800",
    active:
      "border-rose-500 bg-rose-100 text-rose-900 shadow-sm ring-2 ring-rose-400/40",
  },
];

function StatusPill({ status }: { status: PanditApiStatus }) {
  const label = statusLabel(status);
  const styles: Record<string, string> = {
    AVAILABLE: "border-emerald-300 bg-emerald-100 text-emerald-800",
    OFFLINE: "border-stone-300 bg-stone-100 text-stone-600",
    BUSY: "border-rose-300 bg-rose-100 text-rose-800",
    BREAK: "border-sky-300 bg-sky-100 text-sky-800",
    AWAY: "border-sky-300 bg-sky-100 text-sky-800",
  };

  return (
    <div
      className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-bold tracking-wide ${styles[label] || styles.OFFLINE}`}
    >
      {label === "AVAILABLE" && (
        <span className="relative flex h-2.5 w-2.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-70" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
        </span>
      )}
      {label}
    </div>
  );
}

function isStoneItem(item: ConsultationItem): boolean {
  return item.category.trim().toUpperCase() === "STONE";
}

export default function App() {
  const [view, setView] = useState<View>("login");
  const [mobile, setMobile] = useState("");
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

  useEffect(() => {
    if (panditDigits.length !== 10 || view !== "dashboard") return;

    const timers: number[] = [];
    const refreshProfile = () => {
      fetchPanditByMobile(panditDigits)
        .then((data) => setProfile(data))
        .catch(() => {});
    };

    const off = onCustomerCall(({ customer, pandit, phase }) => {
      if (pandit && pandit !== panditDigits) return;
      if (phase === "oncall") {
        qrCustomerRef.current = customer;
        setQrCustomer(customer);
        setPaymentLinkResult(null);
        setSentItemIds([]);
        setSendingItemId(null);
        setCallerDetails(null);
        setCallerLoading(true);
        fetchCustomerDetails(customer)
          .then((details) => {
            if (qrCustomerRef.current !== customer) return;
            setCallerDetails(details);
          })
          .catch(() => {
            if (qrCustomerRef.current !== customer) return;
            setCallerDetails({
              mobile: customer,
              fullName: "Caller",
              birthDate: "—",
              birthTime: "—",
              birthPlace: "—",
            });
          })
          .finally(() => {
            if (qrCustomerRef.current === customer) setCallerLoading(false);
          });
        return;
      }
      if (qrCustomerRef.current !== customer) return;
      qrCustomerRef.current = "";
      setQrCustomer("");
      setCallerDetails(null);
      setCallerLoading(false);
      setPaymentLinkResult(null);
      setSendingItemId(null);
      setSentItemIds([]);
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
      await fetchPanditByMobile(mobile);
      const result = await sendOtp(mobile, RECAPTCHA_CONTAINER_ID);
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

    // Lock all other buttons while this one sends
    setSendingItemId(item.id);
    setPaymentLinkResult(null);
    try {
      await sendPaymentLink({
        customer: qrCustomer,
        customerName: callerDetails?.fullName || "Caller",
        agent,
        amount: item.amount,
        itemCode: item.code,
      });
      setSentItemIds((prev) =>
        prev.includes(item.id) ? prev : [...prev, item.id],
      );
      setPaymentLinkResult({
        ok: true,
        text: `Payment link sent for ${item.description} (₹${item.amount.toLocaleString("en-IN")})`,
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
      setMobile("");
      setView("login");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Logout failed");
    } finally {
      setLoading(false);
    }
  };

  if (booting) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f8f5f0]">
        <Loader2 className="h-8 w-8 animate-spin text-amber-600" />
      </div>
    );
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#f8f5f0] text-stone-900">
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        <div className="absolute -left-24 -top-24 h-72 w-72 rounded-full bg-amber-300/25 blur-[90px]" />
        <div className="absolute bottom-0 right-0 h-80 w-80 rounded-full bg-orange-200/30 blur-[100px]" />
      </div>

      <div className="relative mx-auto flex min-h-screen max-w-md flex-col px-4 py-8 sm:px-6">
        <div className="mb-10 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-amber-300 bg-amber-100">
              <Star className="h-5 w-5 text-amber-600" fill="currentColor" />
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-amber-700">
                My Astro Sutra
              </p>
              <p className="text-sm font-semibold text-stone-700">Pandit Ji Dashboard</p>
            </div>
          </div>

          {view === "dashboard" && (
            <div
              className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider ${
                wsConnected
                  ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                  : "border-stone-300 bg-white text-stone-500"
              }`}
            >
              {wsConnected ? (
                <Wifi className="h-3 w-3" />
              ) : (
                <WifiOff className="h-3 w-3" />
              )}
              {wsConnected ? "Synced" : "Syncing"}
            </div>
          )}
        </div>

        {view === "login" ? (
          <>
            <header className="mb-8">
              <h1 className="font-display text-3xl font-bold leading-tight text-stone-900">
                Pandit Ji{" "}
                <span className="bg-gradient-to-r from-amber-600 to-orange-500 bg-clip-text text-transparent">
                  Login
                </span>
              </h1>
              <p className="mt-2 text-sm text-stone-600">
                {loginStep === "mobile" ? (
                  <>
                    Enter your registered mobile number to receive an OTP. On login your
                    status becomes{" "}
                    <span className="font-semibold text-emerald-700">AVAILABLE</span>.
                  </>
                ) : (
                  <>
                    Enter the {OTP_LENGTH}-digit OTP sent to{" "}
                    <span className="font-semibold text-stone-800">+91 {mobile}</span>.
                  </>
                )}
              </p>
            </header>

            {!firebaseReady && (
              <p className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-3.5 py-2.5 text-sm text-amber-900">
                OTP login is not configured yet. Add the Firebase keys to the dashboard&apos;s
                environment file and restart.
              </p>
            )}

            {loginStep === "mobile" ? (
              <form
                onSubmit={handleSendOtp}
                className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm"
              >
                <label className="mb-2 block text-[11px] font-semibold uppercase tracking-wider text-stone-500">
                  Mobile number
                </label>
                <div className="mb-4 flex gap-2">
                  <span className="flex h-12 items-center rounded-xl border border-stone-200 bg-stone-50 px-3.5 text-sm text-stone-600">
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
                    className="h-12 flex-1 rounded-xl border border-stone-200 bg-white px-4 text-base text-stone-900 outline-none placeholder:text-stone-400 focus:border-amber-500 focus:ring-2 focus:ring-amber-200"
                  />
                </div>

                {error && (
                  <p className="mb-4 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
                    {error}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={loading || !firebaseReady || mobile.length !== 10}
                  className="flex h-12 w-full items-center justify-center rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 text-sm font-bold text-white shadow-sm transition hover:brightness-105 disabled:opacity-40"
                >
                  {loading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Sending OTP…
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
                className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm"
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
                  className="mb-4 h-12 w-full rounded-xl border border-stone-200 bg-white px-4 text-center text-xl font-semibold tracking-[0.5em] text-stone-900 outline-none placeholder:text-stone-300 focus:border-amber-500 focus:ring-2 focus:ring-amber-200"
                />

                {error && (
                  <p className="mb-4 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
                    {error}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={loading || otp.length !== OTP_LENGTH}
                  className="flex h-12 w-full items-center justify-center rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 text-sm font-bold text-white shadow-sm transition hover:brightness-105 disabled:opacity-40"
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
                    className="font-semibold text-amber-700 transition hover:text-amber-800 disabled:text-stone-400"
                  >
                    {resendIn > 0 ? `Resend OTP in ${resendIn}s` : "Resend OTP"}
                  </button>
                </div>
              </form>
            )}

            <div id={RECAPTCHA_CONTAINER_ID} />
          </>
        ) : (
          profile && (
            <div className="flex flex-1 flex-col">
              <header className="mb-6">
                <h1 className="font-display text-2xl font-bold text-stone-900">
                  Welcome, {profile.fullName.split(" ")[0]}
                </h1>
                <p className="mt-1 text-sm text-stone-600">{profile.title}</p>
              </header>

              <div className="mb-5 overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
                <div className="flex items-center gap-4 p-5">
                  <PanditAvatar
                    src={profile.imageUrl}
                    name={profile.fullName}
                    className="h-24 w-24 shrink-0 rounded-2xl border-2 border-amber-300 text-2xl shadow-sm"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-stone-900">{profile.fullName}</p>
                    <p className="truncate text-xs text-stone-500">{profile.specialty}</p>
                    <p className="mt-1 text-xs capitalize text-stone-500">{profile.gender}</p>
                  </div>
                </div>
              </div>

              <div className="mb-4 rounded-2xl border border-stone-200 bg-white p-5 text-center shadow-sm">
                <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.2em] text-stone-500">
                  Current status
                </p>
                <StatusPill status={profile.status} />
              </div>

              <div className="mb-6 rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
                <div className="mb-3 flex items-center justify-between">
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-stone-500">
                      Set status
                    </p>
                    <p className="mt-0.5 text-xs text-stone-500">
                      Tap to update — seekers see this live
                    </p>
                  </div>
                  {saving && <Loader2 className="h-4 w-4 animate-spin text-amber-600" />}
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
                        className={`flex items-center gap-3 rounded-xl border px-3.5 py-3 text-left transition ${
                          active ? opt.active : opt.tone
                        } ${!active ? "hover:border-stone-300 hover:bg-stone-50" : ""} disabled:opacity-60`}
                      >
                        <span
                          className={`flex h-10 w-10 items-center justify-center rounded-lg border ${
                            active
                              ? "border-current/20 bg-white/70"
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
                          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-white">
                            <Check className="h-3 w-3 stroke-[3]" />
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>

                {success && (
                  <p className="mt-3 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-sm text-emerald-800">
                    <Check className="h-4 w-4 shrink-0" />
                    {success}
                  </p>
                )}
              </div>

              <div className="mb-6 rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
                <div className="mb-3 flex items-center gap-2.5">
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-sky-200 bg-sky-50 text-sky-600">
                    <UserRound className="h-4 w-4" />
                  </span>
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-stone-500">
                      Caller details
                    </p>
                    <p className="mt-0.5 text-xs text-stone-500">
                      Shown when the customer call is connected
                    </p>
                  </div>
                </div>

                {qrCustomer.length !== 10 ? (
                  <p className="rounded-xl border border-stone-200 bg-stone-50 px-3.5 py-3 text-sm text-stone-500">
                    Waiting for a connected call…
                  </p>
                ) : callerLoading ? (
                  <p className="flex items-center gap-2 rounded-xl border border-stone-200 bg-stone-50 px-3.5 py-3 text-sm text-stone-600">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading caller profile…
                  </p>
                ) : (
                  <div className="space-y-2.5">
                    <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-700">
                        Name
                      </p>
                      <p className="mt-0.5 text-base font-semibold text-stone-900">
                        {callerDetails?.fullName || "Caller"}
                      </p>
                    </div>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                      <div className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-2.5">
                        <p className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-stone-500">
                          <Calendar className="h-3 w-3" />
                          DOB
                        </p>
                        <p className="mt-1 text-sm font-medium text-stone-800">
                          {callerDetails?.birthDate || "—"}
                        </p>
                      </div>
                      <div className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-2.5">
                        <p className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-stone-500">
                          <Clock className="h-3 w-3" />
                          TOB
                        </p>
                        <p className="mt-1 text-sm font-medium text-stone-800">
                          {callerDetails?.birthTime || "—"}
                        </p>
                      </div>
                      <div className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-2.5">
                        <p className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-stone-500">
                          <MapPin className="h-3 w-3" />
                          POB
                        </p>
                        <p className="mt-1 text-sm font-medium text-stone-800">
                          {callerDetails?.birthPlace || "—"}
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="mb-6 rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
                <div className="mb-3 flex items-center gap-2.5">
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-violet-200 bg-violet-50 text-violet-600">
                    <Sparkles className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-stone-500">
                      Consultation items
                    </p>
                    <p className="mt-0.5 text-xs text-stone-500">
                      Tap Send to push a payment link to the caller
                    </p>
                  </div>
                </div>

                <div
                  className={`mb-3 flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold ${
                    qrCustomer.length === 10
                      ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                      : "border-stone-200 bg-stone-50 text-stone-500"
                  }`}
                >
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full ${
                      qrCustomer.length === 10 ? "animate-pulse bg-emerald-500" : "bg-stone-400"
                    }`}
                  />
                  {qrCustomer.length === 10
                    ? "Customer connected — tap Send on an item"
                    : "Waiting for a call to connect"}
                </div>

                {catalogLoading ? (
                  <p className="flex items-center gap-2 rounded-xl border border-stone-200 bg-stone-50 px-3.5 py-3 text-sm text-stone-600">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading items…
                  </p>
                ) : catalogError ? (
                  <p className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
                    {catalogError}
                  </p>
                ) : poojaCatalog.length === 0 ? (
                  <p className="rounded-xl border border-stone-200 bg-stone-50 px-3.5 py-3 text-sm text-stone-500">
                    No consultation items available.
                  </p>
                ) : (
                  <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
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
                          className={`flex aspect-square flex-col justify-between rounded-2xl border p-3.5 shadow-sm ${
                            alreadySent
                              ? "border-stone-200 bg-stone-100 opacity-70"
                              : "border-stone-200 bg-gradient-to-br from-white to-amber-50/60"
                          }`}
                        >
                          <p className="line-clamp-4 text-sm font-semibold leading-snug text-stone-900">
                            {item.description}
                          </p>
                          <div className="mt-3 space-y-2">
                            <p className="text-lg font-bold text-amber-700">
                              ₹{item.amount.toLocaleString("en-IN")}
                            </p>
                            <button
                              type="button"
                              disabled={disabled && !busy}
                              onClick={() => void handleSendPaymentLink(item)}
                              className={`inline-flex h-9 w-full items-center justify-center rounded-lg text-xs font-bold transition ${
                                alreadySent
                                  ? "cursor-not-allowed bg-stone-300 text-stone-600"
                                  : disabled && !busy
                                    ? "cursor-not-allowed bg-stone-200 text-stone-500"
                                    : "bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-sm hover:brightness-105 active:scale-[0.98]"
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
                        ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                        : "border-red-200 bg-red-50 text-red-700"
                    }`}
                  >
                    {paymentLinkResult.ok && <Check className="h-4 w-4 shrink-0" />}
                    {paymentLinkResult.text}
                  </p>
                )}
              </div>

              {error && (
                <p className="mb-4 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
                  {error}
                </p>
              )}

              <div className="mt-auto pt-4">
                <button
                  type="button"
                  onClick={() => void handleLogout()}
                  disabled={loading}
                  className="flex h-12 w-full items-center justify-center rounded-xl border border-stone-300 bg-white text-sm font-semibold text-stone-800 shadow-sm transition hover:bg-stone-50 disabled:opacity-50"
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
