import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft,
  CalendarDays,
  History,
  Loader2,
  Phone,
  Receipt,
  RefreshCw,
} from "lucide-react";
import {
  fetchPanditHistory,
  toSearchDate,
  type HistoryCall,
  type HistoryPurchase,
  type PanditHistory,
} from "../services/api";

type HistoryPageProps = {
  agentMobile: string;
  onBack: () => void;
};

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

function paymentTone(status: string | null): string {
  const s = (status || "").trim().toUpperCase();
  if (s === "SUCCESS" || s === "PAID" || s === "COMPLETED") {
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

function PurchaseCard({ purchase }: { purchase: HistoryPurchase }) {
  return (
    <article className="sutra-card overflow-hidden rounded-2xl">
      <div className="flex items-start justify-between gap-3 border-b border-[#e8d9c8] bg-[#fff7ed] px-4 py-3">
        <div className="min-w-0">
          <p className="truncate font-semibold text-stone-900">{purchase.customerName}</p>
          <p className="text-xs text-stone-500">
            {purchase.customerMobile ? `+91 ${purchase.customerMobile}` : "—"}
          </p>
        </div>
        <div className="text-right">
          <p className="text-base font-bold tabular-nums text-[#9a3412]">
            {formatInr(purchase.totalAmount)}
          </p>
          <span
            className={`mt-1 inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${paymentTone(
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

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#e8d9c8] px-4 py-2.5 text-[11px] text-stone-500">
        <span>Txn #{purchase.transactionId || "—"}</span>
        <span>Created {formatDateTime(purchase.createdAt)}</span>
        {purchase.paymentDate ? (
          <span className="w-full sm:w-auto">Paid {formatDateTime(purchase.paymentDate)}</span>
        ) : null}
      </div>
    </article>
  );
}

function CallCard({ call }: { call: HistoryCall }) {
  const number = call.customerNumber.replace(/^\+91/, "").replace(/\D/g, "");
  const display =
    number.length === 10 ? `+91 ${number}` : call.customerNumber || "—";

  return (
    <article className="flex items-center gap-3 rounded-2xl border border-[#e8d9c8] bg-white px-3.5 py-3">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-green-200 bg-green-50 text-green-800">
        <Phone className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold text-stone-900">{display}</p>
        <p className="text-xs text-stone-500">
          {call.callDate || "—"} · {call.callTime || "—"}
        </p>
      </div>
      <p className="shrink-0 rounded-lg bg-[#fff7ed] px-2.5 py-1 text-xs font-bold tabular-nums text-[#9a3412]">
        {call.customerCallDuration || "00:00:00"}
      </p>
    </article>
  );
}

export default function HistoryPage({ agentMobile, onBack }: HistoryPageProps) {
  const [searchDate, setSearchDate] = useState(() => toSearchDate());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [history, setHistory] = useState<PanditHistory>({
    purchaseHistory: [],
    callHistory: [],
  });

  const load = useCallback(
    async (date: string) => {
      setLoading(true);
      setError("");
      try {
        const data = await fetchPanditHistory(agentMobile, date);
        setHistory(data);
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
                  <PurchaseCard key={purchase.transactionId || purchase.createdAt} purchase={purchase} />
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
                  />
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
