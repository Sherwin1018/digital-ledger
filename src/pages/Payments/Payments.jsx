import { useEffect, useMemo, useState } from "react";
import jsPDF from "jspdf";
import { FileText, HandCoins, Plus, Printer, ReceiptText, Search, X } from "lucide-react";
import CustomerCombobox from "../../components/forms/CustomerCombobox";
import DashboardLayout from "../../components/layout/DashboardLayout";
import { useToast } from "../../context/useToast";
import { firebaseConfigError } from "../../firebase/firebase";
import { getCustomers } from "../../services/customersService";
import { getDebts } from "../../services/debtsService";
import { addPayment, getPayments } from "../../services/paymentsService";
import {
  PAYMENT_SOURCES,
  getPaymentScheduleLabel,
  getPaymentSourceLabel,
  getTrustStatusClass,
  getTrustStatusLabel,
} from "../../utils/customerCulture";
import { getFirebaseErrorMessage } from "../../utils/firebaseError";
import { reconcileLedger } from "../../utils/ledgerReconciliation";

const emptyForm = {
  customerId: "",
  debtId: "",
  amount: "",
  paymentSource: "partial",
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

function validatePaymentForm(form, selectedCustomer, selectedDebt) {
  const errors = {};
  const amount = Number(form.amount);
  const transactionBalance = Number(selectedDebt?.remainingBalance ?? 0);

  if (!form.customerId) {
    errors.customerId = "Customer is required.";
  }

  if (!form.debtId) {
    errors.debtId = "Debt transaction is required.";
  }

  if (!Number.isFinite(amount) || amount <= 0) {
    errors.amount = "Payment amount must be greater than zero.";
  } else if (selectedDebt && amount > transactionBalance) {
    errors.amount = "Payment cannot be greater than the selected transaction balance.";
  }

  return errors;
}

function getPaymentStatus(payment) {
  return Number(payment.remainingBalance || 0) <= 0 ? "PAID" : "UNPAID";
}

function getReceiptFilename(payment, extension) {
  return `${payment.paymentId || "payment-receipt"}-${payment.customerName || "customer"}.${extension}`
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, "-");
}

function downloadPaymentReceipt(payment) {
  const document = new jsPDF();

  document.setFontSize(18);
  document.text("Digital Ledger Payment Receipt", 14, 18);
  document.setFontSize(11);
  document.text(`Receipt Number: ${payment.paymentId}`, 14, 32);
  document.text(`Customer: ${payment.customerName}`, 14, 40);
  document.text(`Transaction ID: ${payment.transactionId}`, 14, 48);
  document.text(`Payment Date: ${formatDate(payment.date)}`, 14, 56);
  document.text(`Payment Amount: ${formatCurrency(payment.amount)}`, 14, 64);
  document.text(`Remaining Balance: ${formatCurrency(payment.remainingBalance)}`, 14, 72);
  document.text(`Payment Status: ${getPaymentStatus(payment)}`, 14, 80);

  document.save(getReceiptFilename(payment, "pdf"));
}

function printPaymentReceipt(payment) {
  const printWindow = window.open("", "_blank", "width=720,height=720");

  if (!printWindow) {
    return;
  }

  printWindow.document.write(`
    <html>
      <head>
        <title>${payment.paymentId}</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 32px; color: #0f172a; }
          h1 { margin-bottom: 20px; }
          p { margin: 8px 0; font-size: 14px; }
          strong { display: inline-block; min-width: 180px; }
        </style>
      </head>
      <body>
        <h1>Digital Ledger Payment Receipt</h1>
        <p><strong>Receipt Number:</strong> ${payment.paymentId}</p>
        <p><strong>Customer:</strong> ${payment.customerName}</p>
        <p><strong>Transaction ID:</strong> ${payment.transactionId}</p>
        <p><strong>Payment Date:</strong> ${formatDate(payment.date)}</p>
        <p><strong>Payment Amount:</strong> ${formatCurrency(payment.amount)}</p>
        <p><strong>Remaining Balance:</strong> ${formatCurrency(payment.remainingBalance)}</p>
        <p><strong>Payment Status:</strong> ${getPaymentStatus(payment)}</p>
      </body>
    </html>
  `);
  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
}

function Payments() {
  const [payments, setPayments] = useState([]);
  const [debts, setDebts] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [loading, setLoading] = useState(!firebaseConfigError);
  const [fetchError, setFetchError] = useState("");
  const [actionError, setActionError] = useState("");
  const [formErrors, setFormErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const { showToast } = useToast();

  const filteredPayments = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();

    if (!term) {
      return payments;
    }

    return payments.filter((payment) => {
      return (
        payment.paymentId.toLowerCase().includes(term) ||
        payment.transactionId.toLowerCase().includes(term) ||
        payment.customerName.toLowerCase().includes(term) ||
        getPaymentSourceLabel(payment.paymentSource).toLowerCase().includes(term) ||
        payment.remarks.toLowerCase().includes(term)
      );
    });
  }, [payments, searchTerm]);

  const selectedCustomer = useMemo(
    () => customers.find((customer) => customer.id === form.customerId) || null,
    [customers, form.customerId],
  );

  const unpaidCustomerDebts = useMemo(
    () =>
      debts.filter(
        (debt) =>
          debt.customerId === form.customerId &&
          Number(debt.remainingBalance ?? debt.total ?? 0) > 0,
      ),
    [debts, form.customerId],
  );

  const selectedDebt = useMemo(
    () => unpaidCustomerDebts.find((debt) => debt.id === form.debtId) || null,
    [form.debtId, unpaidCustomerDebts],
  );

  const currentBalance = Number(selectedCustomer?.currentBalance || 0);
  const paymentAmount = Number(form.amount || 0);
  const selectedTransactionBalance = Number(selectedDebt?.remainingBalance ?? 0);
  const projectedRemainingBalance = Math.max(selectedTransactionBalance - paymentAmount, 0);

  async function loadData() {
    setLoading(true);
    setFetchError("");

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

    const validationErrors = validatePaymentForm(form, selectedCustomer, selectedDebt);
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
      showToast({ type: "success", message: "Payment saved successfully." });
      closeModal();
    } catch (error) {
      const message = getFirebaseErrorMessage(error, "Unable to save payment.");
      setActionError(message);
      showToast({ type: "error", message });
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

        <section className="space-y-3 md:hidden">
          {loading ? (
            <div className="rounded-3xl bg-white p-5 text-center text-sm text-slate-500 shadow-md">
              Loading payments...
            </div>
          ) : fetchError ? (
            <div className="rounded-3xl border border-red-200 bg-red-50 p-5 text-sm text-red-700 shadow-md">
              {fetchError}
            </div>
          ) : filteredPayments.length === 0 ? (
            <div className="rounded-3xl bg-white p-5 text-center text-sm text-slate-500 shadow-md">
              No payment history yet.
            </div>
          ) : (
            filteredPayments.map((payment) => (
              <article key={payment.id} className="rounded-3xl bg-white p-5 shadow-md">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-mono text-xs text-slate-500">
                      {payment.paymentId}
                    </p>
                    <h3 className="mt-2 text-lg font-bold text-slate-900">
                      {payment.customerName}
                    </h3>
                    <p className="mt-1 font-mono text-xs text-slate-500">
                      {payment.transactionId || "-"}
                    </p>
                  </div>
                  <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">
                    {formatCurrency(payment.amount)}
                  </span>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-3 rounded-2xl bg-slate-50 p-3 text-sm">
                  <div>
                    <p className="text-xs text-slate-500">Previous</p>
                    <p className="mt-1 font-semibold text-slate-900">
                      {formatCurrency(payment.previousBalance)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Remaining</p>
                    <p className="mt-1 font-bold text-cyan-700">
                      {formatCurrency(payment.remainingBalance)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Source</p>
                    <p className="mt-1 font-medium text-slate-700">
                      {getPaymentSourceLabel(payment.paymentSource)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Date</p>
                    <p className="mt-1 font-medium text-slate-700">
                      {formatDate(payment.date)}
                    </p>
                  </div>
                </div>

                <p className="mt-3 text-sm text-slate-500">{payment.remarks || "-"}</p>

                <div className="mt-4 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => downloadPaymentReceipt(payment)}
                    className="inline-flex items-center justify-center gap-1 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-red-600 transition hover:border-red-200 hover:bg-red-50"
                  >
                    <FileText size={14} />
                    PDF
                  </button>
                  <button
                    type="button"
                    onClick={() => printPaymentReceipt(payment)}
                    className="inline-flex items-center justify-center gap-1 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 transition hover:border-cyan-200 hover:bg-cyan-50"
                  >
                    <Printer size={14} />
                    Print
                  </button>
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
                  <th className="px-6 py-4">Receipt No.</th>
                  <th className="px-6 py-4">Debt Transaction</th>
                  <th className="px-6 py-4">Customer</th>
                  <th className="px-6 py-4">Payment</th>
                  <th className="px-6 py-4">Previous Balance</th>
                  <th className="px-6 py-4">Remaining Balance</th>
                  <th className="px-6 py-4">Payment Source</th>
                  <th className="px-6 py-4">Date</th>
                  <th className="px-6 py-4">Remarks</th>
                  <th className="px-6 py-4 text-right">Receipt</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {loading ? (
                  <tr>
                    <td className="px-6 py-12 text-center text-slate-500" colSpan="10">
                      Loading payments...
                    </td>
                  </tr>
                ) : fetchError ? (
                  <tr>
                    <td className="px-6 py-12 text-center text-red-600" colSpan="10">
                      {fetchError}
                    </td>
                  </tr>
                ) : filteredPayments.length === 0 ? (
                  <tr>
                    <td className="px-6 py-12 text-center text-slate-500" colSpan="10">
                      No payment history yet.
                    </td>
                  </tr>
                ) : (
                  filteredPayments.map((payment) => (
                    <tr key={payment.id} className="text-sm text-slate-700">
                      <td className="px-6 py-4 font-mono text-xs text-slate-500">
                        {payment.paymentId}
                      </td>
                      <td className="px-6 py-4 font-mono text-xs text-slate-500">
                        {payment.transactionId || "-"}
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
                      <td className="px-6 py-4">
                        {getPaymentSourceLabel(payment.paymentSource)}
                      </td>
                      <td className="px-6 py-4">{formatDate(payment.date)}</td>
                      <td className="px-6 py-4">{payment.remarks || "-"}</td>
                      <td className="px-6 py-4">
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => downloadPaymentReceipt(payment)}
                            className="inline-flex items-center gap-1 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-red-600 transition hover:border-red-200 hover:bg-red-50"
                          >
                            <FileText size={14} />
                            PDF
                          </button>
                          <button
                            type="button"
                            onClick={() => printPaymentReceipt(payment)}
                            className="inline-flex items-center gap-1 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 transition hover:border-cyan-200 hover:bg-cyan-50"
                          >
                            <Printer size={14} />
                            Print
                          </button>
                        </div>
                      </td>
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
                        Customer <span className="text-red-500">*</span>
                      </span>
                      <CustomerCombobox
                        customers={customers}
                        selectedCustomerId={form.customerId}
                        onSelect={(customerId) =>
                          setForm((current) => ({
                            ...current,
                            customerId,
                            debtId: "",
                          }))
                        }
                        error={formErrors.customerId}
                      />
                    </label>

                    <label className="block sm:col-span-2">
                      <span className="mb-2 block text-sm font-medium text-slate-700">
                        Debt Transaction <span className="text-red-500">*</span>
                      </span>
                      <select
                        value={form.debtId}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            debtId: event.target.value,
                          }))
                        }
                        disabled={!form.customerId}
                        className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 outline-none transition focus:border-cyan-400 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
                      >
                        <option value="">
                          {form.customerId
                            ? "Select unpaid transaction"
                            : "Select a customer first"}
                        </option>
                        {unpaidCustomerDebts.map((debt) => (
                          <option key={debt.id} value={debt.id}>
                            {debt.transactionId} • {formatDate(debt.date)} •{" "}
                            {formatCurrency(debt.remainingBalance ?? debt.total)}
                          </option>
                        ))}
                      </select>
                      {formErrors.debtId && (
                        <p className="mt-2 text-sm text-red-600">{formErrors.debtId}</p>
                      )}
                      {form.customerId && unpaidCustomerDebts.length === 0 && (
                        <p className="mt-2 text-sm text-amber-700">
                          This customer has no unpaid debt transactions.
                        </p>
                      )}
                    </label>

                    <label className="block">
                      <span className="mb-2 block text-sm font-medium text-slate-700">
                        Customer Outstanding Balance <span className="text-slate-400">◌</span>
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
                        Date <span className="text-slate-400">◌</span>
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
                        Transaction Balance <span className="text-slate-400">◌</span>
                      </span>
                      <input
                        type="text"
                        value={formatCurrency(selectedTransactionBalance)}
                        readOnly
                        className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-500 outline-none"
                      />
                    </label>

                    <label className="block">
                      <span className="mb-2 block text-sm font-medium text-slate-700">
                        Payment Amount <span className="text-red-500">*</span>
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

                    <label className="block">
                      <span className="mb-2 block text-sm font-medium text-slate-700">
                        Payment Source / Habit <span className="text-slate-400">◌</span>
                      </span>
                      <select
                        value={form.paymentSource}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            paymentSource: event.target.value,
                          }))
                        }
                        className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 outline-none transition focus:border-cyan-400"
                      >
                        {PAYMENT_SOURCES.map((source) => (
                          <option key={source.value} value={source.value}>
                            {source.label}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="block sm:col-span-2">
                      <span className="mb-2 block text-sm font-medium text-slate-700">
                        Remarks <span className="text-slate-400">◌</span>
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
                        placeholder="e.g. Partial payment from sweldo."
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
                        {selectedDebt?.transactionId || "Select transaction"}
                      </p>
                    </div>
                    <div className="rounded-2xl bg-white p-4 shadow-sm">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                        Rule Check
                      </p>
                      <p className="mt-2 text-sm font-semibold text-slate-900">
                        Source: {getPaymentSourceLabel(form.paymentSource)}
                      </p>
                    </div>
                  </div>

                  {selectedCustomer && (
                    <div className="space-y-3">
                      <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                        Payment will be applied to{" "}
                        <span className="font-semibold text-slate-900">
                          {selectedCustomer.firstName} {selectedCustomer.lastName}
                        </span>
                        , and the remaining balance will update automatically.
                      </div>
                      <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`rounded-full px-3 py-1 text-xs font-semibold ${getTrustStatusClass(
                              selectedCustomer.trustStatus,
                            )}`}
                          >
                            {getTrustStatusLabel(selectedCustomer.trustStatus)}
                          </span>
                          <span>
                            Expected payment habit:{" "}
                            {getPaymentScheduleLabel(selectedCustomer.paymentSchedule)}
                          </span>
                        </div>
                      </div>
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
                      className="inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-500 px-5 py-3 font-semibold text-white transition duration-1000 hover:bg-emerald-400 active:scale-95 disabled:cursor-not-allowed disabled:opacity-70"
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
