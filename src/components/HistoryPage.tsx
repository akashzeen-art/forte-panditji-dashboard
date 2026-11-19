import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  CalendarDays,
  Eye,
  History,
  Loader2,
  Phone,
  Receipt,
  RefreshCw,
  UserRound,
  Wallet,
  X,
} from "lucide-react";
import {
  fetchCustomerDetails,
  fetchPanditHistory,
  normalizeMobile,
  toSearchDate,
  type CustomerCallDetails,
  type HistoryCall,
  type HistoryPurchase,
  type PanditHistory,
} from "../services/api";

type HistoryPageProps = {
  agentMobile: string;
  onBack: () => void;
};

const EARN_RATE = 0.4;

function formatInr(amount: number): string {
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `₹${amount}`;
  }
}

function formatDateTime(raw: string): string {
  if (!raw) return "—";
  const d = new Date(raw.includes("T") ? raw : raw.replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function isSuccessfulPayment(status: string | null | undefined): boolean {
  const s = (status || "").trim().toUpperCase();
  return s === "SUCCESS" || s === "PAID" || s === "COMPLETED";
}

function paymentTone(status: string | null): string {
  const s = (status || "").trim().toUpperCase();
  if (isSuccessfulPayment(s)) {
    return "border-green-300 bg-green-50 text-green-800";
  }
  if (s === "FAILED" || s === "FAILURE" || s === "CANCELLED") {
    return "border-red-300 bg-red-50 text-red-800";
  }
  return "border-stone-300 bg-stone-50 text-stone-600";
}

function paymentLabel(status: string | null): string {
  const s = (status || "").trim();
  return s || "Pending";
}

function UserDataModal({
  open,
  loading,
  error,
  details,
  fallbackName,
  onClose,
}: {
  open: boolean;
  loading: boolean;
  error: string;
  details: CustomerCallDetails | null;
  fallbackName: string;
  onClose: () => void;
}) {
  if (!open) return null;

  const rows: Array<[string, string]> = [
    ["Name", details?.fullName || fallbackName || "Customer"],
    ["Date of Birth", details?.birthDate || "—"],
    ["Time of Birth", details?.birthTime || "—"],
    ["Place of Birth", details?.birthPlace || "—"],
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-stone-950/45 p-4 sm:items-center">
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        aria-label="Close"
        onClick={onClose}
      />
      <div className="relative z-10 w-full max-w-md overflow-hidden rounded-3xl border border-[#e8d9c8] bg-[#fffaf5] shadow-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-[#e8d9c8] bg-[#fff7ed] px-4 py-3.5">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-green-200 bg-green-50 text-green-800">
              <UserRound className="h-4 w-4" />
            </span>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-[#9a3412]">
                Customer
              </p>
              <h3 className="font-display text-lg font-bold text-stone-900">User data</h3>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-[#e8d9c8] bg-white text-stone-600 transition hover:bg-[#fff7ed]"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-4">
          {loading ? (
            <p className="flex items-center justify-center gap-2 py-10 text-sm text-stone-600">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading user data…
            </p>
          ) : error ? (
            <p className="rounded-2xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700">
              {error}
            </p>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-[#e8d9c8]">
              <table className="w-full text-left text-sm">
                <tbody className="divide-y divide-[#e8d9c8]">
                  {rows.map(([label, value]) => (
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
        </div>
      </div>
    </div>
  );
}

function PurchaseCard({
  purchase,
  onView,
}: {
  purchase: HistoryPurchase;
  onView: (mobile: string, name: string) => void;
}) {
  return (
    <article className="sutra-card overflow-hidden rounded-2xl">
      <div className="flex items-start justify-between gap-3 border-b border-[#e8d9c8] bg-[#fff7ed] px-4 py-3">
        <div className="min-w-0">
          <p className="truncate font-semibold text-stone-900">{purchase.customerName}</p>
          <p className="text-xs text-stone-500">
            {formatDateTime(purchase.paymentDate || purchase.createdAt)}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <p className="text-base font-bold tabular-nums text-[#9a3412]">
            {formatInr(purchase.totalAmount)}
          </p>
          <span
            className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${paymentTone(
              purchase.paymentStatus,
            )}`}
          >
            {paymentLabel(purchase.paymentStatus)}
          </span>
        </div>
      </div>

      <ul className="divide-y divide-[#e8d9c8]">
        {purchase.items.map((item, idx) => (
          <li
            key={`${purchase.transactionId}-${item.itemCode}-${idx}`}
            className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm"
          >
            <div className="min-w-0">
              <p className="truncate font-medium text-stone-800">{item.productName}</p>
              <p className="text-[11px] text-stone-500">
                {item.itemCode}
                {item.quantity > 1 ? ` · Qty ${item.quantity}` : ""}
              </p>
            </div>
            <p className="shrink-0 font-semibold tabular-nums text-stone-800">
              {formatInr(item.amount)}
            </p>
          </li>
        ))}
      </ul>

      <div className="flex items-center justify-between gap-2 border-t border-[#e8d9c8] px-4 py-2.5">
        <span className="text-[11px] text-stone-500">
          Created {formatDateTime(purchase.createdAt)}
        </span>
        <button
          type="button"
          onClick={() => onView(purchase.customerMobile, purchase.customerName)}
          className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[#e8d9c8] bg-white px-3 text-[11px] font-semibold text-[#9a3412] shadow-sm transition hover:bg-[#fff7ed]"
        >
          <Eye className="h-3.5 w-3.5" />
          View
        </button>
      </div>
    </article>
  );
}

function CallCard({
  call,
  onView,
}: {
  call: HistoryCall;
  onView: (mobile: string, name: string) => void;
}) {
  const timeLabel = [call.callDate, call.callTime].filter(Boolean).join(" · ") || "—";

  return (
    <article className="flex items-center gap-3 rounded-2xl border border-[#e8d9c8] bg-white px-3.5 py-3">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-green-200 bg-green-50 text-green-800">
        <Phone className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold text-stone-900">{call.customerName || "Customer"}</p>
        <p className="text-xs text-stone-500">{timeLabel}</p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1.5">
        <p className="rounded-lg bg-[#fff7ed] px-2.5 py-1 text-xs font-bold tabular-nums text-[#9a3412]">
          {call.customerCallDuration || "00:00:00"}
        </p>
        <button
          type="button"
          onClick={() => onView(call.customerNumber, call.customerName)}
          className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[#e8d9c8] bg-white px-3 text-[11px] font-semibold text-[#9a3412] shadow-sm transition hover:bg-[#fff7ed]"
        >
          <Eye className="h-3.5 w-3.5" />
          View
        </button>
      </div>
    </article>
  );
}

async function enrichCallNames(calls: HistoryCall[]): Promise<HistoryCall[]> {
  const unique = Array.from(
    new Set(
      calls
        .map((c) => normalizeMobile(c.customerNumber))
        .filter((m) => m.length === 10),
    ),
  );
  if (unique.length === 0) return calls;

  const nameByMobile = new Map<string, string>();
  await Promise.all(
    unique.map(async (mobile) => {
      try {
        const details = await fetchCustomerDetails(mobile);
        if (details?.fullName && details.fullName !== "Caller") {
          nameByMobile.set(mobile, details.fullName);
        }
      } catch {
        /* ignore — keep existing label */
      }
    }),
  );

  if (nameByMobile.size === 0) return calls;

  return calls.map((call) => {
    const mobile = normalizeMobile(call.customerNumber);
    const resolved = nameByMobile.get(mobile);
    if (!resolved) return call;
    if (call.customerName && call.customerName !== "Customer") return call;
    return { ...call, customerName: resolved };
  });
}

export default function HistoryPage({ agentMobile, onBack }: HistoryPageProps) {
  const [searchDate, setSearchDate] = useState(() => toSearchDate());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [history, setHistory] = useState<PanditHistory>({
    purchaseHistory: [],
    callHistory: [],
  });

  const [viewOpen, setViewOpen] = useState(false);
  const [viewLoading, setViewLoading] = useState(false);
  const [viewError, setViewError] = useState("");
  const [viewDetails, setViewDetails] = useState<CustomerCallDetails | null>(null);
  const [viewFallbackName, setViewFallbackName] = useState("Customer");

  const load = useCallback(
    async (date: string) => {
      setLoading(true);
      setError("");
      try {
        const data = await fetchPanditHistory(agentMobile, date);
        const callHistory = await enrichCallNames(data.callHistory);
        setHistory({ ...data, callHistory });
      } catch (err) {
        setHistory({ purchaseHistory: [], callHistory: [] });
        setError(err instanceof Error ? err.message : "Could not load history");
      } finally {
        setLoading(false);
      }
    },
    [agentMobile],
  );

  useEffect(() => {
    void load(searchDate);
  }, [load, searchDate]);

  const purchases = history.purchaseHistory;
  const calls = history.callHistory;

  const { totalAmount, amountEarn } = useMemo(() => {
    // Count only successful payments — PENDING / failed stay out of totals
    const total = purchases.reduce((sum, p) => {
      if (!isSuccessfulPayment(p.paymentStatus)) return sum;
      return sum + (Number(p.totalAmount) || 0);
    }, 0);
    return {
      totalAmount: total,
      amountEarn: Math.round(total * EARN_RATE),
    };
  }, [purchases]);

  const openUserView = async (mobileRaw: string, name: string) => {
    const mobile = normalizeMobile(mobileRaw);
    setViewFallbackName(name || "Customer");
    setViewDetails(null);
    setViewError("");
    setViewOpen(true);

    if (mobile.length !== 10) {
      setViewError("Customer profile is unavailable for this record.");
      return;
    }

    setViewLoading(true);
    try {
      const details = await fetchCustomerDetails(mobile);
      if (!details) {
        setViewError("No user data found for this customer.");
        return;
      }
      setViewDetails(details);
    } catch (err) {
      setViewError(err instanceof Error ? err.message : "Could not load user data");
    } finally {
      setViewLoading(false);
    }
  };

  return (
    <div className="flex flex-1 flex-col pb-4">
      <div className="mb-4 flex items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          className="flex h-10 w-10 items-center justify-center rounded-xl border border-[#e8d9c8] bg-white text-stone-700 shadow-sm transition hover:bg-[#fff7ed]"
          aria-label="Back to dashboard"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-[#9a3412]">
            Records
          </p>
          <h1 className="font-display text-2xl font-bold text-stone-900">History</h1>
        </div>
        <button
          type="button"
          disabled={loading}
          onClick={() => void load(searchDate)}
          className="flex h-10 w-10 items-center justify-center rounded-xl border border-[#e8d9c8] bg-white text-[#9a3412] shadow-sm transition hover:bg-[#fff7ed] disabled:opacity-50"
          aria-label="Refresh history"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
        </button>
      </div>

      <section className="sutra-card mb-5 rounded-3xl p-4">
        <label className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-stone-500">
          <CalendarDays className="h-3.5 w-3.5 text-[#c2410c]" />
          Search date
        </label>
        <input
          type="date"
          value={searchDate}
          max={toSearchDate()}
          onChange={(e) => setSearchDate(e.target.value)}
          className="h-12 w-full rounded-xl border border-[#e8d9c8] bg-white px-4 text-base text-stone-900 outline-none focus:border-[#c2410c] focus:ring-2 focus:ring-[#fdba74]/50"
        />
      </section>

      <section className="mb-5 grid grid-cols-2 gap-3">
        <div className="sutra-card rounded-2xl p-4">
          <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-stone-500">
            <Wallet className="h-3.5 w-3.5 text-[#c2410c]" />
            Total Amount
          </div>
          <p className="font-display text-2xl font-bold tabular-nums text-stone-900">
            {formatInr(totalAmount)}
          </p>
        </div>
        <div className="sutra-card rounded-2xl p-4">
          <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-stone-500">
            <Receipt className="h-3.5 w-3.5 text-green-700" />
            Amount Earn
          </div>
          <p className="font-display text-2xl font-bold tabular-nums text-green-800">
            {formatInr(amountEarn)}
          </p>
          <p className="mt-1 text-[11px] text-stone-500">
            40% of successful payments
          </p>
        </div>
      </section>

      {error ? (
        <p className="mb-4 rounded-2xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {loading && purchases.length === 0 && calls.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 py-16 text-stone-500">
          <Loader2 className="h-7 w-7 animate-spin text-[#c2410c]" />
          <p className="text-sm">Loading history…</p>
        </div>
      ) : (
        <>
          <section className="mb-5">
            <div className="mb-3 flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-[#e8d9c8] bg-[#fff7ed] text-[#9a3412]">
                <Receipt className="h-4 w-4" />
              </span>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-[#9a3412]">
                  Purchases
                </p>
                <h2 className="font-display text-xl font-bold text-stone-800">
                  Payment history
                </h2>
              </div>
            </div>

            {purchases.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-[#e8d9c8] bg-[#fff7ed]/80 px-3.5 py-4 text-center text-sm text-stone-500">
                No purchases for this date.
              </p>
            ) : (
              <div className="space-y-3">
                {purchases.map((purchase) => (
                  <PurchaseCard
                    key={purchase.transactionId || purchase.createdAt}
                    purchase={purchase}
                    onView={(mobile, name) => void openUserView(mobile, name)}
                  />
                ))}
              </div>
            )}
          </section>

          <section className="mb-2">
            <div className="mb-3 flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-green-200 bg-green-50 text-green-800">
                <History className="h-4 w-4" />
              </span>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-[#9a3412]">
                  Calls
                </p>
                <h2 className="font-display text-xl font-bold text-stone-800">
                  Call history
                </h2>
              </div>
            </div>

            {calls.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-[#e8d9c8] bg-[#fff7ed]/80 px-3.5 py-4 text-center text-sm text-stone-500">
                No calls for this date.
              </p>
            ) : (
              <div className="space-y-2.5">
                {calls.map((call, idx) => (
                  <CallCard
                    key={`${call.customerNumber}-${call.callTime}-${idx}`}
                    call={call}
                    onView={(mobile, name) => void openUserView(mobile, name)}
                  />
                ))}
              </div>
            )}
          </section>
        </>
      )}

      <UserDataModal
        open={viewOpen}
        loading={viewLoading}
        error={viewError}
        details={viewDetails}
        fallbackName={viewFallbackName}
        onClose={() => {
          setViewOpen(false);
          setViewDetails(null);
          setViewError("");
        }}
      />
    </div>
  );
}
