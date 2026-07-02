import { useEffect, useMemo, useState } from "react";
import { Archive, CalendarDays, Search } from "lucide-react";
import DashboardLayout from "../../components/layout/DashboardLayout";
import { firebaseConfigError } from "../../firebase/firebase";
import { getCustomers } from "../../services/customersService";
import { getDebts } from "../../services/debtsService";
import { getPayments } from "../../services/paymentsService";
import { getFirebaseErrorMessage } from "../../utils/firebaseError";
import { reconcileLedger } from "../../utils/ledgerReconciliation";

function formatCurrency(value) {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
  }).format(Number(value || 0));
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

function formatDate(timestamp) {
  const date = getJsDate(timestamp);

  if (!date) {
    return "Invalid date";
  }

  return new Intl.DateTimeFormat("en-PH", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}

function getDateKey(timestamp) {
  const date = getJsDate(timestamp);

  if (!date) {
    return "";
  }

  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

function getMonthKey(timestamp) {
  const date = getJsDate(timestamp);

  if (!date) {
    return "";
  }

  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function getYearKey(timestamp) {
  const date = getJsDate(timestamp);
  return date ? String(date.getFullYear()) : "";
}

function getDebtItems(debt) {
  return Array.isArray(debt.items) && debt.items.length > 0
    ? debt.items
    : [
        {
          product: debt.product,
          quantity: debt.quantity,
          unitPrice: debt.unitPrice,
          total: debt.total,
        },
      ];
}

function getTotalItemQuantity(debt) {
  return getDebtItems(debt).reduce(
    (sum, item) => sum + Number(item.quantity || 0),
    0,
  );
}

function groupArchivedDebts(debts) {
  const groups = new Map();

  debts.forEach((debt) => {
    const key = `${debt.customerId}-${getDateKey(debt.date)}-PAID`;
    const existing = groups.get(key);

    if (!existing) {
      groups.set(key, {
        ...debt,
        id: key,
        debtIds: [debt.id],
        transactionIds: [debt.transactionId],
        items: getDebtItems(debt),
        product: debt.product,
        total: Number(debt.total || 0),
        remainingBalance: 0,
      });
      return;
    }

    existing.debtIds.push(debt.id);
    existing.transactionIds.push(debt.transactionId);
    existing.items = [...existing.items, ...getDebtItems(debt)];
    existing.product = `${existing.product}, ${debt.product}`;
    existing.total += Number(debt.total || 0);
    existing.transactionId = `${existing.transactionIds[0]} +${existing.transactionIds.length - 1}`;
  });

  return [...groups.values()].sort(
    (left, right) => (getJsDate(right.date)?.getTime() || 0) - (getJsDate(left.date)?.getTime() || 0),
  );
}

function Archives() {
  const [customers, setCustomers] = useState([]);
  const [debts, setDebts] = useState([]);
  const [payments, setPayments] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [customerFilter, setCustomerFilter] = useState("");
  const [dateFilter, setDateFilter] = useState("");
  const [monthFilter, setMonthFilter] = useState("");
  const [yearFilter, setYearFilter] = useState("");
  const [loading, setLoading] = useState(!firebaseConfigError);
  const [error, setError] = useState("");

  async function loadData() {
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
      setError(getFirebaseErrorMessage(nextError, "Failed to load archives."));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (firebaseConfigError) {
      return;
    }

    const timer = window.setTimeout(loadData, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const archivedGroups = useMemo(
    () =>
      groupArchivedDebts(
        debts.filter((debt) => Number(debt.remainingBalance ?? debt.total ?? 0) <= 0),
      ),
    [debts],
  );

  const filteredArchives = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();

    return archivedGroups.filter((debt) => {
      const matchesSearch =
        !term ||
        debt.customerName.toLowerCase().includes(term) ||
        debt.transactionId.toLowerCase().includes(term) ||
        debt.transactionIds?.some((transactionId) => transactionId.toLowerCase().includes(term)) ||
        getDebtItems(debt).some((item) => item.product.toLowerCase().includes(term));
      const matchesCustomer = !customerFilter || debt.customerId === customerFilter;
      const matchesDate = !dateFilter || getDateKey(debt.date) === dateFilter;
      const matchesMonth = !monthFilter || getMonthKey(debt.date) === monthFilter;
      const matchesYear = !yearFilter || getYearKey(debt.date) === yearFilter;

      return matchesSearch && matchesCustomer && matchesDate && matchesMonth && matchesYear;
    });
  }, [archivedGroups, customerFilter, dateFilter, monthFilter, searchTerm, yearFilter]);

  const availableYears = useMemo(
    () => [...new Set(archivedGroups.map((debt) => getYearKey(debt.date)).filter(Boolean))],
    [archivedGroups],
  );

  function getPaymentsForDebtGroup(debt) {
    const debtIds = new Set(debt.debtIds || [debt.id]);

    return payments.filter(
      (payment) =>
        debtIds.has(payment.debtId) ||
        payment.debtAllocations?.some((allocation) => debtIds.has(allocation.debtId)),
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <section className="grid gap-3 xl:grid-cols-[1.2fr_repeat(4,minmax(0,0.7fr))]">
          <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
            <Search size={18} className="text-slate-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Search archived paid debts"
              className="w-full bg-transparent text-sm text-slate-700 outline-none placeholder:text-slate-400"
            />
          </label>

          <select
            value={customerFilter}
            onChange={(event) => setCustomerFilter(event.target.value)}
            className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 shadow-sm outline-none"
          >
            <option value="">All customers</option>
            {customers.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.firstName} {customer.lastName}
              </option>
            ))}
          </select>

          <input
            type="date"
            value={dateFilter}
            onChange={(event) => setDateFilter(event.target.value)}
            className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 shadow-sm outline-none"
          />

          <input
            type="month"
            value={monthFilter}
            onChange={(event) => setMonthFilter(event.target.value)}
            className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 shadow-sm outline-none"
          />

          <select
            value={yearFilter}
            onChange={(event) => setYearFilter(event.target.value)}
            className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 shadow-sm outline-none"
          >
            <option value="">All years</option>
            {availableYears.map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </select>
        </section>

        {firebaseConfigError && (
          <div className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Firebase is not configured yet. Add Firebase values before using archives.
          </div>
        )}

        {error && (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <section className="grid gap-4 md:grid-cols-3">
          <div className="rounded-3xl bg-white p-5 shadow-md">
            <p className="text-sm text-slate-500">Archived Paid Groups</p>
            <p className="mt-3 text-3xl font-bold text-slate-900">{filteredArchives.length}</p>
          </div>
          <div className="rounded-3xl bg-white p-5 shadow-md">
            <p className="text-sm text-slate-500">Archived Value</p>
            <p className="mt-3 text-3xl font-bold text-slate-900">
              {formatCurrency(filteredArchives.reduce((sum, debt) => sum + Number(debt.total || 0), 0))}
            </p>
          </div>
          <div className="rounded-3xl bg-white p-5 shadow-md">
            <p className="text-sm text-slate-500">Status</p>
            <p className="mt-3 inline-flex items-center gap-2 rounded-full bg-emerald-100 px-4 py-2 text-sm font-semibold text-emerald-700">
              <Archive size={16} />
              PAID only
            </p>
          </div>
        </section>

        <section className="space-y-3 md:hidden">
          {loading ? (
            <div className="rounded-3xl bg-white p-5 text-center text-sm text-slate-500 shadow-md">
              Loading archives...
            </div>
          ) : filteredArchives.length === 0 ? (
            <div className="rounded-3xl bg-white p-5 text-center text-sm text-slate-500 shadow-md">
              No paid debts found.
            </div>
          ) : (
            filteredArchives.map((debt) => (
              <article key={debt.id} className="rounded-3xl bg-white p-5 shadow-md">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-mono text-xs text-slate-500">
                      {debt.transactionId}
                    </p>
                    <h3 className="mt-2 text-lg font-bold text-slate-900">
                      {debt.customerName}
                    </h3>
                    <p className="mt-1 text-sm text-slate-500">
                      <CalendarDays size={14} className="mr-1 inline text-slate-400" />
                      {formatDate(debt.date)}
                    </p>
                  </div>
                  <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">
                    PAID
                  </span>
                </div>

                <div className="mt-4 space-y-1 rounded-2xl bg-slate-50 p-3 text-sm text-slate-700">
                  {getDebtItems(debt).slice(0, 4).map((item, index) => (
                    <p key={`${debt.id}-mobile-${item.product}-${index}`}>
                      {item.quantity} x {item.product}{" "}
                      <span className="text-slate-400">
                        ({formatCurrency(item.total)})
                      </span>
                    </p>
                  ))}
                </div>

                <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-2xl bg-slate-50 p-3">
                    <p className="text-xs text-slate-500">Total Items</p>
                    <p className="mt-1 font-bold text-slate-900">
                      {getTotalItemQuantity(debt)}
                    </p>
                  </div>
                  <div className="rounded-2xl bg-slate-50 p-3">
                    <p className="text-xs text-slate-500">Grand Total</p>
                    <p className="mt-1 font-bold text-slate-900">
                      {formatCurrency(debt.total)}
                    </p>
                  </div>
                </div>
                <div className="mt-4 rounded-2xl bg-emerald-50 p-3 text-sm">
                  <p className="font-semibold text-emerald-800">How paid</p>
                  {getPaymentsForDebtGroup(debt).length === 0 ? (
                    <p className="mt-1 text-emerald-700">No linked payment receipt found.</p>
                  ) : (
                    <div className="mt-2 space-y-1 text-emerald-800">
                      {getPaymentsForDebtGroup(debt).map((payment) => (
                        <p key={`${debt.id}-${payment.id}`}>
                          {payment.paymentId} - {formatCurrency(payment.amount)} on{" "}
                          {formatDate(payment.date)}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              </article>
            ))
          )}
        </section>

        <section className="hidden overflow-hidden rounded-3xl bg-white shadow-md md:block">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-50">
                <tr className="text-left text-sm font-semibold text-slate-600">
                  <th className="px-6 py-4">Transaction ID</th>
                  <th className="px-6 py-4">Customer</th>
                  <th className="px-6 py-4">Purchased Goods</th>
                  <th className="px-6 py-4">Total Items</th>
                  <th className="px-6 py-4">Grand Total</th>
                  <th className="px-6 py-4">Date</th>
                  <th className="px-6 py-4">Payment Receipts</th>
                  <th className="px-6 py-4">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {loading ? (
                  <tr>
                    <td className="px-6 py-12 text-center text-slate-500" colSpan="8">
                      Loading archives...
                    </td>
                  </tr>
                ) : filteredArchives.length === 0 ? (
                  <tr>
                    <td className="px-6 py-12 text-center text-slate-500" colSpan="8">
                      No paid debts found.
                    </td>
                  </tr>
                ) : (
                  filteredArchives.map((debt) => (
                    <tr key={debt.id} className="text-sm text-slate-700">
                      <td className="px-6 py-4 font-mono text-xs text-slate-500">
                        {debt.transactionId}
                        {debt.transactionIds?.length > 1 && (
                          <p className="mt-1 text-[11px] text-slate-400">
                            {debt.transactionIds.join(", ")}
                          </p>
                        )}
                      </td>
                      <td className="px-6 py-4 font-semibold text-slate-900">
                        {debt.customerName}
                      </td>
                      <td className="px-6 py-4">
                        <div className="space-y-1">
                          {getDebtItems(debt).slice(0, 4).map((item, index) => (
                            <p key={`${debt.id}-${item.product}-${index}`}>
                              {item.quantity} x {item.product}{" "}
                              <span className="text-slate-400">
                                ({formatCurrency(item.total)})
                              </span>
                            </p>
                          ))}
                        </div>
                      </td>
                      <td className="px-6 py-4 font-semibold text-slate-900">
                        {getTotalItemQuantity(debt)}
                      </td>
                      <td className="px-6 py-4 font-semibold text-slate-900">
                        {formatCurrency(debt.total)}
                      </td>
                      <td className="px-6 py-4">
                        <CalendarDays size={14} className="mr-1 inline text-slate-400" />
                        {formatDate(debt.date)}
                      </td>
                      <td className="px-6 py-4 text-sm text-slate-600">
                        {getPaymentsForDebtGroup(debt).length === 0 ? (
                          "No linked receipt"
                        ) : (
                          <div className="space-y-1">
                            {getPaymentsForDebtGroup(debt).map((payment) => (
                              <p key={`${debt.id}-table-${payment.id}`}>
                                {payment.paymentId} - {formatCurrency(payment.amount)}
                              </p>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">
                          PAID
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </DashboardLayout>
  );
}

export default Archives;
