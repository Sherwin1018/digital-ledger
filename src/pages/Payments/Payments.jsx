import { useEffect, useMemo, useState } from "react";
import { HandCoins, Plus, ReceiptText, Search, X } from "lucide-react";
import DashboardLayout from "../../components/layout/DashboardLayout";
import { firebaseConfigError } from "../../firebase/firebase";
import { getCustomers } from "../../services/customersService";
import { addPayment, getPayments } from "../../services/paymentsService";
import { getFirebaseErrorMessage } from "../../utils/firebaseError";

const emptyForm = {
  customerId: "",
  amount: "",
  remarks: "",
};

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

function validatePaymentForm(form, selectedCustomer) {
  const errors = {};
  const amount = Number(form.amount);
  const balance = Number(selectedCustomer?.currentBalance || 0);

  if (!form.customerId) {
    errors.customerId = "Customer is required.";
  }

  if (!Number.isFinite(amount) || amount <= 0) {
    errors.amount = "Payment amount must be greater than zero.";
  } else if (amount > balance) {
    errors.amount = "Payment cannot be greater than the current balance.";
  }

  return errors;
}

function Payments() {
  const [payments, setPayments] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [loading, setLoading] = useState(!firebaseConfigError);
  const [fetchError, setFetchError] = useState("");
  const [actionError, setActionError] = useState("");
  const [formErrors, setFormErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);

  const filteredPayments = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();

    if (!term) {
      return payments;
    }

    return payments.filter((payment) => {
      return (
        payment.transactionId.toLowerCase().includes(term) ||
        payment.customerName.toLowerCase().includes(term) ||
        payment.remarks.toLowerCase().includes(term)
      );
    });
  }, [payments, searchTerm]);

  const selectedCustomer = useMemo(
    () => customers.find((customer) => customer.id === form.customerId) || null,
    [customers, form.customerId],
  );

  const currentBalance = Number(selectedCustomer?.currentBalance || 0);
  const paymentAmount = Number(form.amount || 0);
  const projectedRemainingBalance = Math.max(currentBalance - paymentAmount, 0);

  async function loadData() {
    setLoading(true);
    setFetchError("");

    try {
      const [nextCustomers, nextPayments] = await Promise.all([
        getCustomers(),
        getPayments(),
      ]);
      setCustomers(nextCustomers);
      setPayments(nextPayments);
    } catch (error) {
      setFetchError(getFirebaseErrorMessage(error, "Failed to load payments."));
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

  function openAddModal() {
    setForm(emptyForm);
    setFormErrors({});
    setActionError("");
    setSubmitting(false);
    setIsModalOpen(true);
  }

  function closeModal() {
    setIsModalOpen(false);
    setForm(emptyForm);
    setFormErrors({});
    setActionError("");
    setSubmitting(false);
  }

  async function handleSubmit(event) {
    event.preventDefault();

    const validationErrors = validatePaymentForm(form, selectedCustomer);
    setFormErrors(validationErrors);
    setActionError("");

    if (Object.keys(validationErrors).length > 0) {
      return;
    }

    setSubmitting(true);

    try {
      await addPayment({
        ...form,
        customerName: selectedCustomer
          ? `${selectedCustomer.firstName} ${selectedCustomer.lastName}`
          : "",
      });
      await loadData();
      closeModal();
    } catch (error) {
      setActionError(getFirebaseErrorMessage(error, "Unable to save payment."));
      setSubmitting(false);
    }
  }

  const totalCollected = filteredPayments.reduce(
    (sum, payment) => sum + Number(payment.amount || 0),
    0,
  );

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <section className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <label className="flex min-w-[260px] items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
            <Search size={18} className="text-slate-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Search by customer, remarks, or transaction"
              className="w-full bg-transparent text-sm text-slate-700 outline-none placeholder:text-slate-400"
            />
          </label>

          <button
            type="button"
            onClick={openAddModal}
            disabled={Boolean(firebaseConfigError)}
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-cyan-500 px-5 py-3 font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Plus size={18} />
            Add Payment
          </button>
        </section>

        {firebaseConfigError && (
          <div className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Firebase is not configured yet. Create `.env.local`, add your Firebase
            values, and restart the dev server before using the payment module.
          </div>
        )}

        {actionError && (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {actionError}
          </div>
        )}

        <section className="grid gap-4 md:grid-cols-3">
          <div className="rounded-3xl bg-white p-5 shadow-md">
            <p className="text-sm text-slate-500">Payment Entries</p>
            <p className="mt-3 text-3xl font-bold text-slate-900">
              {filteredPayments.length}
            </p>
          </div>
          <div className="rounded-3xl bg-white p-5 shadow-md">
            <p className="text-sm text-slate-500">Total Collected</p>
            <p className="mt-3 text-3xl font-bold text-slate-900">
              {formatCurrency(totalCollected)}
            </p>
          </div>
          <div className="rounded-3xl bg-white p-5 shadow-md">
            <p className="text-sm text-slate-500">Customers Available</p>
            <p className="mt-3 text-3xl font-bold text-slate-900">{customers.length}</p>
          </div>
        </section>

        <section className="overflow-hidden rounded-3xl bg-white shadow-md">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-50">
                <tr className="text-left text-sm font-semibold text-slate-600">
                  <th className="px-6 py-4">Transaction ID</th>
                  <th className="px-6 py-4">Customer</th>
                  <th className="px-6 py-4">Payment</th>
                  <th className="px-6 py-4">Previous Balance</th>
                  <th className="px-6 py-4">Remaining Balance</th>
                  <th className="px-6 py-4">Date</th>
                  <th className="px-6 py-4">Remarks</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {loading ? (
                  <tr>
                    <td className="px-6 py-12 text-center text-slate-500" colSpan="7">
                      Loading payments...
                    </td>
                  </tr>
                ) : fetchError ? (
                  <tr>
                    <td className="px-6 py-12 text-center text-red-600" colSpan="7">
                      {fetchError}
                    </td>
                  </tr>
                ) : filteredPayments.length === 0 ? (
                  <tr>
                    <td className="px-6 py-12 text-center text-slate-500" colSpan="7">
                      No payment history yet.
                    </td>
                  </tr>
                ) : (
                  filteredPayments.map((payment) => (
                    <tr key={payment.id} className="text-sm text-slate-700">
                      <td className="px-6 py-4 font-mono text-xs text-slate-500">
                        {payment.transactionId}
                      </td>
                      <td className="px-6 py-4 font-medium text-slate-900">
                        {payment.customerName}
                      </td>
                      <td className="px-6 py-4 font-semibold text-emerald-700">
                        {formatCurrency(payment.amount)}
                      </td>
                      <td className="px-6 py-4">{formatCurrency(payment.previousBalance)}</td>
                      <td className="px-6 py-4 font-semibold text-cyan-700">
                        {formatCurrency(payment.remainingBalance)}
                      </td>
                      <td className="px-6 py-4">{formatDate(payment.date)}</td>
                      <td className="px-6 py-4">{payment.remarks || "-"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/50 p-4">
          <div className="flex min-h-full items-center justify-center">
            <div className="my-6 flex max-h-[calc(100vh-3rem)] w-full max-w-2xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
              <div className="flex items-center justify-between border-b border-slate-200 px-6 py-5">
                <div className="flex items-center gap-3">
                  <div className="rounded-2xl bg-emerald-100 p-3 text-emerald-700">
                    <HandCoins size={20} />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-slate-900">Add Payment</h3>
                    <p className="text-sm text-slate-500">
                      Remaining balance updates automatically and payment history is
                      preserved.
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={closeModal}
                  className="rounded-xl p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
                  aria-label="Close modal"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="overflow-y-auto">
                <form className="space-y-5 p-6" onSubmit={handleSubmit}>
                  <div className="grid gap-5 sm:grid-cols-2">
                    <label className="block sm:col-span-2">
                      <span className="mb-2 block text-sm font-medium text-slate-700">
                        Customer
                      </span>
                      <select
                        value={form.customerId}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            customerId: event.target.value,
                          }))
                        }
                        className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 outline-none transition focus:border-cyan-400"
                      >
                        <option value="">Select a customer</option>
                        {customers.map((customer) => (
                          <option key={customer.id} value={customer.id}>
                            {customer.firstName} {customer.lastName}
                          </option>
                        ))}
                      </select>
                      {formErrors.customerId && (
                        <p className="mt-2 text-sm text-red-600">{formErrors.customerId}</p>
                      )}
                    </label>

                    <label className="block">
                      <span className="mb-2 block text-sm font-medium text-slate-700">
                        Current Balance
                      </span>
                      <input
                        type="text"
                        value={formatCurrency(currentBalance)}
                        readOnly
                        className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-500 outline-none"
                      />
                    </label>

                    <label className="block">
                      <span className="mb-2 block text-sm font-medium text-slate-700">
                        Date
                      </span>
                      <input
                        type="text"
                        value={new Intl.DateTimeFormat("en-PH", {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                        }).format(new Date())}
                        readOnly
                        className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-500 outline-none"
                      />
                    </label>

                    <label className="block">
                      <span className="mb-2 block text-sm font-medium text-slate-700">
                        Payment Amount
                      </span>
                      <input
                        type="number"
                        min="0.01"
                        step="0.01"
                        value={form.amount}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            amount: event.target.value,
                          }))
                        }
                        className="w-full rounded-2xl border border-slate-200 px-4 py-3 outline-none transition focus:border-cyan-400"
                      />
                      {formErrors.amount && (
                        <p className="mt-2 text-sm text-red-600">{formErrors.amount}</p>
                      )}
                    </label>

                    <label className="block sm:col-span-2">
                      <span className="mb-2 block text-sm font-medium text-slate-700">
                        Remarks
                      </span>
                      <textarea
                        value={form.remarks}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            remarks: event.target.value,
                          }))
                        }
                        rows="3"
                        className="w-full rounded-2xl border border-slate-200 px-4 py-3 outline-none transition focus:border-cyan-400"
                      />
                    </label>
                  </div>

                  <div className="grid gap-4 rounded-3xl bg-slate-50 p-5 sm:grid-cols-2">
                    <div className="rounded-2xl bg-white p-4 shadow-sm">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                        Payment Entered
                      </p>
                      <p className="mt-2 text-2xl font-bold text-emerald-700">
                        {formatCurrency(paymentAmount)}
                      </p>
                    </div>
                    <div className="rounded-2xl bg-white p-4 shadow-sm">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                        Remaining Balance
                      </p>
                      <p className="mt-2 text-2xl font-bold text-cyan-700">
                        {formatCurrency(projectedRemainingBalance)}
                      </p>
                    </div>
                    <div className="rounded-2xl bg-white p-4 shadow-sm">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                        Transaction ID
                      </p>
                      <p className="mt-2 font-mono text-sm text-slate-700">
                        Generated after save
                      </p>
                    </div>
                    <div className="rounded-2xl bg-white p-4 shadow-sm">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                        Rule Check
                      </p>
                      <p className="mt-2 text-sm font-semibold text-slate-900">
                        Cannot pay more than current balance and cannot pay zero.
                      </p>
                    </div>
                  </div>

                  {selectedCustomer && (
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                      Payment will be applied to{" "}
                      <span className="font-semibold text-slate-900">
                        {selectedCustomer.firstName} {selectedCustomer.lastName}
                      </span>
                      , and the remaining balance will update automatically.
                    </div>
                  )}

                  {actionError && (
                    <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                      {actionError}
                    </div>
                  )}

                  <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                    <button
                      type="button"
                      onClick={closeModal}
                      className="rounded-2xl border border-slate-200 px-5 py-3 font-medium text-slate-600 transition hover:bg-slate-50"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={submitting}
                      className="inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-500 px-5 py-3 font-semibold text-white transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-70"
                    >
                      <ReceiptText size={18} />
                      {submitting ? "Saving..." : "Save Payment"}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}

export default Payments;
