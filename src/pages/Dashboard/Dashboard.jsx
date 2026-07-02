import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowDownLeft,
  ArrowUpRight,
  Coins,
  ReceiptText,
  ShieldCheck,
  Users,
} from "lucide-react";
import DashboardLayout from "../../components/layout/DashboardLayout";
import { firebaseConfigError } from "../../firebase/firebase";
import { getCustomers } from "../../services/customersService";
import { getDebts } from "../../services/debtsService";
import { getPayments } from "../../services/paymentsService";
import { getTrustStatusClass, getTrustStatusLabel } from "../../utils/customerCulture";
import { getFirebaseErrorMessage } from "../../utils/firebaseError";
import { reconcileLedger } from "../../utils/ledgerReconciliation";

function formatCurrency(value) {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
  }).format(Number(value || 0));
}

function formatDate(timestamp) {
  if (!timestamp) {
    return "Just now";
  }

  const date =
    typeof timestamp.toDate === "function" ? timestamp.toDate() : new Date(timestamp);

  if (Number.isNaN(date.getTime())) {
    return "Invalid date";
  }

  return new Intl.DateTimeFormat("en-PH", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}

function getJsDate(timestamp) {
  if (!timestamp) {
    return null;
  }

  if (typeof timestamp.toDate === "function") {
    return timestamp.toDate();
  }

  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getMonthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function getMonthLabel(date) {
  return new Intl.DateTimeFormat("en-PH", {
    month: "short",
    year: "2-digit",
  }).format(date);
}

function buildMonthlyCollections(payments) {
  const now = new Date();
  const months = Array.from({ length: 6 }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth() - (5 - index), 1);
    return {
      key: getMonthKey(date),
      label: getMonthLabel(date),
      value: 0,
    };
  });

  payments.forEach((payment) => {
    const date = getJsDate(payment.date);

    if (!date) {
      return;
    }

    const month = months.find((entry) => entry.key === getMonthKey(date));

    if (month) {
      month.value += Number(payment.amount || 0);
    }
  });

  return months;
}

function buildOutstandingTrend(debts, payments) {
  const now = new Date();
  const months = Array.from({ length: 6 }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth() - (5 - index), 1);
    return {
      key: getMonthKey(date),
      label: getMonthLabel(date),
      value: 0,
    };
  });

  const events = [
    ...debts.map((debt) => ({
      date: getJsDate(debt.date),
      delta: Number(debt.total || 0),
    })),
    ...payments.map((payment) => ({
      date: getJsDate(payment.date),
      delta: -Number(payment.amount || 0),
    })),
  ]
    .filter((event) => event.date)
    .sort((left, right) => left.date - right.date);

  let runningOutstanding = 0;
  let eventIndex = 0;

  months.forEach((month, monthIndex) => {
    const monthEnd = new Date(now.getFullYear(), now.getMonth() - (4 - monthIndex), 0, 23, 59, 59, 999);

    while (eventIndex < events.length && events[eventIndex].date <= monthEnd) {
      runningOutstanding += events[eventIndex].delta;
      eventIndex += 1;
    }

    month.value = Math.max(runningOutstanding, 0);
  });

  return months;
}

function Dashboard() {
  const [customers, setCustomers] = useState([]);
  const [debts, setDebts] = useState([]);
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(!firebaseConfigError);
  const [error, setError] = useState("");

  async function loadAnalytics() {
    setLoading(true);
    setError("");

    try {
      const [nextCustomers, nextDebts, nextPayments] = await Promise.all([
        getCustomers(),
        getDebts(),
        getPayments(),
      ]);
      const reconciledLedger = reconcileLedger(nextDebts, nextPayments);

      setCustomers(nextCustomers);
      setDebts(reconciledLedger.debts);
      setPayments(reconciledLedger.payments);
    } catch (nextError) {
      setError(
        getFirebaseErrorMessage(nextError, "Failed to load dashboard analytics."),
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (firebaseConfigError) {
      return;
    }

    const timer = window.setTimeout(loadAnalytics, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const analytics = useMemo(() => {
    const today = new Date();
    const isSameDay = (date) =>
      date &&
      date.getFullYear() === today.getFullYear() &&
      date.getMonth() === today.getMonth() &&
      date.getDate() === today.getDate();

    const totalCustomers = customers.length;
    const outstandingBalance = customers.reduce(
      (sum, customer) => sum + Number(customer.currentBalance || 0),
      0,
    );
    const todaysPayments = payments.reduce((sum, payment) => {
      const date = getJsDate(payment.date);
      return isSameDay(date) ? sum + Number(payment.amount || 0) : sum;
    }, 0);
    const transactionsToday =
      debts.filter((debt) => isSameDay(getJsDate(debt.date))).length +
      payments.filter((payment) => isSameDay(getJsDate(payment.date))).length;

    const recentTransactions = [
      ...debts.map((debt) => ({
        id: debt.id,
        transactionId: debt.transactionId,
        customerName: debt.customerName,
        type: "Debt",
        amount: Number(debt.total || 0),
        date: debt.date,
      })),
      ...payments.map((payment) => ({
        id: payment.id,
        transactionId: payment.transactionId,
        customerName: payment.customerName,
        type: "Payment",
        amount: Number(payment.amount || 0),
        date: payment.date,
      })),
    ]
      .sort((left, right) => {
        const leftDate = getJsDate(left.date)?.getTime() || 0;
        const rightDate = getJsDate(right.date)?.getTime() || 0;
        return rightDate - leftDate;
      })
      .slice(0, 6);

    const recentPayments = [...payments].slice(0, 6);
    const highestBalances = [...customers]
      .sort((left, right) => Number(right.currentBalance || 0) - Number(left.currentBalance || 0))
      .slice(0, 6);
    const trustSummary = {
      trusted: customers.filter((customer) => customer.trustStatus !== "monitor" && customer.trustStatus !== "paused").length,
      monitor: customers.filter((customer) => customer.trustStatus === "monitor").length,
      paused: customers.filter((customer) => customer.trustStatus === "paused").length,
      familyAccounts: customers.filter((customer) => customer.accountType === "family").length,
    };

    return {
      cards: [
        {
          title: "Total Customers",
          value: totalCustomers,
          icon: Users,
          tone: "bg-cyan-100 text-cyan-700",
        },
        {
          title: "Outstanding Balance",
          value: formatCurrency(outstandingBalance),
          icon: Coins,
          tone: "bg-amber-100 text-amber-700",
        },
        {
          title: "Today's Payments",
          value: formatCurrency(todaysPayments),
          icon: ArrowDownLeft,
          tone: "bg-emerald-100 text-emerald-700",
        },
        {
          title: "Transactions Today",
          value: transactionsToday,
          icon: Activity,
          tone: "bg-violet-100 text-violet-700",
        },
      ],
      monthlyCollections: buildMonthlyCollections(payments),
      outstandingTrend: buildOutstandingTrend(debts, payments),
      recentTransactions,
      recentPayments,
      highestBalances,
      trustSummary,
    };
  }, [customers, debts, payments]);

  const maxCollectionsValue = Math.max(
    ...analytics.monthlyCollections.map((entry) => entry.value),
    1,
  );
  const maxOutstandingValue = Math.max(
    ...analytics.outstandingTrend.map((entry) => entry.value),
    1,
  );

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {firebaseConfigError && (
          <div className="rounded-3xl border border-amber-300 bg-amber-50 px-5 py-4 text-sm text-amber-800">
            Firebase is not configured yet. Create `.env.local`, add your Firebase
            values, and restart the dev server before using dashboard analytics.
          </div>
        )}

        {error && (
          <div className="rounded-3xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700">
            {error}
          </div>
        )}

        <section className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-4">
          {analytics.cards.map((card) => (
            <article key={card.title} className="rounded-3xl bg-white p-6 shadow-md">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm text-slate-500">{card.title}</p>
                  <p className="mt-3 text-3xl font-bold text-slate-900">{card.value}</p>
                </div>
                <div className={`rounded-2xl p-3 ${card.tone}`}>
                  <card.icon size={22} />
                </div>
              </div>
            </article>
          ))}
        </section>

        <section className="rounded-3xl bg-white p-6 shadow-md">
          <div className="mb-5 flex items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-bold text-slate-900">Tiwala Snapshot</h2>
              <p className="mt-1 text-sm text-slate-500">
                Community credit health based on customer trust profiles.
              </p>
            </div>
            <ShieldCheck className="text-slate-300" size={24} />
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              { key: "trusted", value: analytics.trustSummary.trusted },
              { key: "monitor", value: analytics.trustSummary.monitor },
              { key: "paused", value: analytics.trustSummary.paused },
            ].map((item) => (
              <div key={item.key} className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                <span
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${getTrustStatusClass(
                    item.key,
                  )}`}
                >
                  {getTrustStatusLabel(item.key)}
                </span>
                <p className="mt-3 text-2xl font-bold text-slate-900">{item.value}</p>
              </div>
            ))}
            <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
              <span className="rounded-full bg-cyan-100 px-3 py-1 text-xs font-semibold text-cyan-700">
                Family Accounts
              </span>
              <p className="mt-3 text-2xl font-bold text-slate-900">
                {analytics.trustSummary.familyAccounts}
              </p>
            </div>
          </div>
        </section>

        <section className="grid gap-6 xl:grid-cols-2">
          <article className="rounded-3xl bg-white p-6 shadow-md">
            <div className="mb-6 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold text-slate-900">Monthly Collections</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Payments collected in the last six months.
                </p>
              </div>
              <ReceiptText className="text-slate-300" size={22} />
            </div>

            <div className="flex h-72 items-end gap-3">
              {analytics.monthlyCollections.map((entry) => (
                <div key={entry.key} className="flex flex-1 flex-col items-center gap-3">
                  <div
                    className="w-full rounded-t-2xl bg-cyan-500/90 transition-all"
                    style={{
                      height: `${Math.max((entry.value / maxCollectionsValue) * 220, 10)}px`,
                    }}
                    title={`${entry.label}: ${formatCurrency(entry.value)}`}
                  />
                  <div className="text-center">
                    <p className="text-xs font-semibold text-slate-700">{entry.label}</p>
                    <p className="mt-1 text-[11px] text-slate-400">
                      {formatCurrency(entry.value)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </article>

          <article className="rounded-3xl bg-white p-6 shadow-md">
            <div className="mb-6 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold text-slate-900">Outstanding Balance Trend</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Running balance snapshot by month.
                </p>
              </div>
              <ArrowUpRight className="text-slate-300" size={22} />
            </div>

            <div className="space-y-4">
              {analytics.outstandingTrend.map((entry) => (
                <div key={entry.key} className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium text-slate-700">{entry.label}</span>
                    <span className="text-slate-500">{formatCurrency(entry.value)}</span>
                  </div>
                  <div className="h-3 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-amber-400 transition-all"
                      style={{
                        width: `${Math.max((entry.value / maxOutstandingValue) * 100, entry.value ? 8 : 0)}%`,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </article>
        </section>

        <section className="grid gap-6 xl:grid-cols-3">
          <article className="rounded-3xl bg-white p-6 shadow-md xl:col-span-1">
            <h2 className="text-xl font-bold text-slate-900">Recent Transactions</h2>
            <p className="mt-1 text-sm text-slate-500">
              Latest debt and payment activity.
            </p>

            <div className="mt-5 space-y-3">
              {loading ? (
                <p className="text-sm text-slate-500">Loading transactions...</p>
              ) : analytics.recentTransactions.length === 0 ? (
                <p className="text-sm text-slate-500">No transactions yet.</p>
              ) : (
                analytics.recentTransactions.map((item) => (
                  <div
                    key={`${item.type}-${item.id}`}
                    className="rounded-2xl border border-slate-100 bg-slate-50 p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-slate-900">{item.customerName}</p>
                        <p className="mt-1 text-xs text-slate-500">{item.transactionId}</p>
                      </div>
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-semibold ${
                          item.type === "Debt"
                            ? "bg-amber-100 text-amber-700"
                            : "bg-emerald-100 text-emerald-700"
                        }`}
                      >
                        {item.type}
                      </span>
                    </div>
                    <div className="mt-3 flex items-center justify-between text-sm">
                      <span className="text-slate-500">{formatDate(item.date)}</span>
                      <span className="font-semibold text-slate-900">
                        {formatCurrency(item.amount)}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </article>

          <article className="rounded-3xl bg-white p-6 shadow-md xl:col-span-1">
            <h2 className="text-xl font-bold text-slate-900">Recent Payments</h2>
            <p className="mt-1 text-sm text-slate-500">
              Most recent collections recorded.
            </p>

            <div className="mt-5 space-y-3 md:hidden">
              {loading ? (
                <p className="text-sm text-slate-500">Loading payments...</p>
              ) : analytics.recentPayments.length === 0 ? (
                <p className="text-sm text-slate-500">No payments yet.</p>
              ) : (
                analytics.recentPayments.map((payment) => (
                  <div
                    key={payment.id}
                    className="rounded-2xl border border-slate-100 bg-slate-50 p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-slate-900">
                          {payment.customerName}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          {formatDate(payment.date)}
                        </p>
                      </div>
                      <span className="font-semibold text-emerald-700">
                        {formatCurrency(payment.amount)}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="mt-5 hidden overflow-hidden rounded-2xl border border-slate-100 md:block">
              <table className="min-w-full divide-y divide-slate-100">
                <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Customer</th>
                    <th className="px-4 py-3">Amount</th>
                    <th className="px-4 py-3">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white text-sm">
                  {loading ? (
                    <tr>
                      <td className="px-4 py-6 text-slate-500" colSpan="3">
                        Loading payments...
                      </td>
                    </tr>
                  ) : analytics.recentPayments.length === 0 ? (
                    <tr>
                      <td className="px-4 py-6 text-slate-500" colSpan="3">
                        No payments yet.
                      </td>
                    </tr>
                  ) : (
                    analytics.recentPayments.map((payment) => (
                      <tr key={payment.id}>
                        <td className="px-4 py-3 font-medium text-slate-900">
                          {payment.customerName}
                        </td>
                        <td className="px-4 py-3 text-emerald-700">
                          {formatCurrency(payment.amount)}
                        </td>
                        <td className="px-4 py-3 text-slate-500">
                          {formatDate(payment.date)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </article>

          <article className="rounded-3xl bg-white p-6 shadow-md xl:col-span-1">
            <h2 className="text-xl font-bold text-slate-900">Customers With Highest Balance</h2>
            <p className="mt-1 text-sm text-slate-500">
              Outstanding balances ranked from highest to lowest.
            </p>

            <div className="mt-5 space-y-3">
              {loading ? (
                <p className="text-sm text-slate-500">Loading balances...</p>
              ) : analytics.highestBalances.length === 0 ? (
                <p className="text-sm text-slate-500">No customers yet.</p>
              ) : (
                analytics.highestBalances.map((customer, index) => (
                  <div
                    key={customer.id}
                    className="flex items-center justify-between rounded-2xl border border-slate-100 bg-slate-50 px-4 py-4"
                  >
                    <div>
                      <p className="font-semibold text-slate-900">
                        {index + 1}. {customer.firstName} {customer.lastName}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">{customer.contactNumber}</p>
                    </div>
                    <span className="text-sm font-semibold text-amber-700">
                      {formatCurrency(customer.currentBalance)}
                    </span>
                  </div>
                ))
              )}
            </div>
          </article>
        </section>
      </div>
    </DashboardLayout>
  );
}

export default Dashboard;
