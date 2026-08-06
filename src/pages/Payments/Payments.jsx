import { useEffect, useMemo, useState } from "react";
import jsPDF from "jspdf";
import { FileText, HandCoins, Plus, Printer, ReceiptText, Search, X } from "lucide-react";
import CustomerCombobox from "../../components/forms/CustomerCombobox";
import DashboardLayout from "../../components/layout/DashboardLayout";
import PaginationControls from "../../components/PaginationControls";
import { useToast } from "../../context/useToast";
import { firebaseConfigError } from "../../firebase/firebase";
import { getCustomers } from "../../services/customersService";
import { getDebts } from "../../services/debtsService";
import { addPayment, getPayments, voidPayment } from "../../services/paymentsService";
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
  amount: "",
  paymentSource: "partial",
  overpaymentAction: "change",
  remarks: "",
};
const PAGE_SIZE = 25;

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
  const currentBalance = Number(selectedCustomer?.currentBalance || 0);

  if (!form.customerId) {
    errors.customerId = "Customer is required.";
  }

  if (!Number.isFinite(amount) || amount <= 0) {
    errors.amount = "Payment amount must be greater than zero.";
  } else if (selectedCustomer && currentBalance <= 0) {
    errors.amount = "This customer has no unpaid utang.";
  } else if (selectedCustomer && amount > currentBalance && form.overpaymentAction === "reject") {
    errors.amount = "Payment is bigger than the utang. Choose sukli or advance credit.";
  }

  return errors;
}

function getPaymentStatus(payment) {
  return Number(payment.remainingBalance || 0) <= 0 ? "CLEAR" : "UNPAID";
}

function getAllocationSummary(payment) {
  if (!Array.isArray(payment.debtAllocations) || payment.debtAllocations.length === 0) {
    return payment.transactionId || "-";
  }

  const firstAllocation = payment.debtAllocations[0];
  return payment.debtAllocations.length > 1
    ? `${firstAllocation.transactionId} +${payment.debtAllocations.length - 1} utang`
    : firstAllocation.transactionId;
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
  document.text(`Applied To: ${payment.transactionId}`, 14, 48);
  document.text(`Payment Date: ${formatDate(payment.date)}`, 14, 56);
  document.text(`Halaga ng Bayad: ${formatCurrency(payment.amount)}`, 14, 64);
  document.text(`Matitirang Utang: ${formatCurrency(payment.remainingBalance)}`, 14, 72);
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
        <p><strong>Applied To:</strong> ${payment.transactionId}</p>
        <p><strong>Payment Date:</strong> ${formatDate(payment.date)}</p>
        <p><strong>Halaga ng Bayad:</strong> ${formatCurrency(payment.amount)}</p>
        <p><strong>Matitirang Utang:</strong> ${formatCurrency(payment.remainingBalance)}</p>
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
  const [paymentPendingVoid, setPaymentPendingVoid] = useState(null);
  const [voidReason, setVoidReason] = useState("");
  const [voiding, setVoiding] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [page, setPage] = useState(1);
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
  const paginatedPayments = useMemo(
    () => filteredPayments.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [filteredPayments, page],
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

  const currentBalance = Number(selectedCustomer?.currentBalance || 0);
  const paymentAmount = Number(form.amount || 0);
  const appliedPaymentAmount = Math.min(paymentAmount, currentBalance);
  const overpaymentAmount = Math.max(paymentAmount - currentBalance, 0);
  const projectedRemainingBalance = Math.max(currentBalance - appliedPaymentAmount, 0);

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

  function closeVoidModal() {
    setPaymentPendingVoid(null);
    setVoidReason("");
    setVoiding(false);
    setActionError("");
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
      showToast({ type: "success", message: "Payment saved successfully." });
      closeModal();
    } catch (error) {
      const message = getFirebaseErrorMessage(error, "Unable to save payment.");
      setActionError(message);
      showToast({ type: "error", message });
      setSubmitting(false);
    }
  }

  async function handleVoidConfirm() {
    if (!paymentPendingVoid) {
      return;
    }

    setVoiding(true);
    setActionError("");

    try {
      await voidPayment(paymentPendingVoid.id, voidReason);
      await loadData();
      showToast({ type: "success", message: "Payment voided and balance restored." });
      closeVoidModal();
    } catch (error) {
      const message = getFirebaseErrorMessage(error, "Unable to void payment.");
      setActionError(message);
      showToast({ type: "error", message });
      setVoiding(false);
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
              onChange={(event) => {
                setSearchTerm(event.target.value);
                setPage(1);
              }}
              placeholder="Search customer, bayad notes, or receipt"
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
            Magdagdag ng Bayad
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
            <p className="text-sm text-slate-500">Mga Bayad</p>
            <p className="mt-3 text-3xl font-bold text-slate-900">
              {filteredPayments.length}
            </p>
          </div>
          <div className="rounded-3xl bg-white p-5 shadow-md">
            <p className="text-sm text-slate-500">Nakolekta</p>
            <p className="mt-3 text-3xl font-bold text-slate-900">
              {formatCurrency(totalCollected)}
            </p>
          </div>
          <div className="rounded-3xl bg-white p-5 shadow-md">
            <p className="text-sm text-slate-500">Customers</p>
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
            paginatedPayments.map((payment) => (
              <article key={payment.id} className="rounded-3xl bg-white p-5 shadow-md">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-mono text-xs text-slate-500">
                      {payment.paymentId}
                    </p>
                    <h3 className="mt-2 text-lg font-bold text-slate-900">
                      {payment.customerName}
                    </h3>
                    <p className="mt-1 text-xs text-slate-500">
                      Applied to: {getAllocationSummary(payment)}
                    </p>
                  </div>
                  <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">
                    {formatCurrency(payment.amount)}
                  </span>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-3 rounded-2xl bg-slate-50 p-3 text-sm">
                  <div>
                    <p className="text-xs text-slate-500">Dating Utang</p>
                    <p className="mt-1 font-semibold text-slate-900">
                      {formatCurrency(payment.previousBalance)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Natitirang Utang</p>
                    <p className="mt-1 font-bold text-cyan-700">
                      {formatCurrency(payment.remainingBalance)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Uri ng Bayad</p>
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
                {Number(payment.changeDue || 0) > 0 && (
                  <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-700">
                    Sukli: {formatCurrency(payment.changeDue)}
                  </p>
                )}
                {Number(payment.advanceCreditAmount || 0) > 0 && (
                  <p className="mt-2 rounded-xl bg-cyan-50 px-3 py-2 text-sm font-semibold text-cyan-700">
                    Advance credit: {formatCurrency(payment.advanceCreditAmount)}
                  </p>
                )}

                <div className="mt-4 grid grid-cols-3 gap-2">
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
                  <button
                    type="button"
                    onClick={() => setPaymentPendingVoid(payment)}
                    className="inline-flex items-center justify-center gap-1 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-amber-700 transition hover:border-amber-200 hover:bg-amber-50"
                  >
                    Void
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
                  <th className="px-6 py-4">Applied To</th>
                  <th className="px-6 py-4">Customer</th>
                  <th className="px-6 py-4">Payment</th>
                  <th className="px-6 py-4">Dating Utang</th>
                  <th className="px-6 py-4">Natitirang Utang</th>
                  <th className="px-6 py-4">Uri ng Bayad</th>
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
                  paginatedPayments.map((payment) => (
                    <tr key={payment.id} className="text-sm text-slate-700">
                      <td className="px-6 py-4 font-mono text-xs text-slate-500">
                        {payment.paymentId}
                      </td>
                      <td className="px-6 py-4 font-mono text-xs text-slate-500">
                        {getAllocationSummary(payment)}
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
                          <button
                            type="button"
                            onClick={() => setPaymentPendingVoid(payment)}
                            className="inline-flex items-center gap-1 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-amber-700 transition hover:border-amber-200 hover:bg-amber-50"
                          >
                            Void
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

        <PaginationControls
          page={page}
          pageSize={PAGE_SIZE}
          totalItems={filteredPayments.length}
          onPageChange={setPage}
        />
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
                    <h3 className="text-xl font-bold text-slate-900">Magdagdag ng Bayad</h3>
                    <p className="text-sm text-slate-500">
                      Piliin ang customer, ilagay ang bayad, automatic ibabawas sa pinakalumang utang.
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
                          }))
                        }
                        error={formErrors.customerId}
                      />
                    </label>
                    {form.customerId && (
                      <div className="rounded-2xl border border-cyan-100 bg-cyan-50 px-4 py-3 text-sm text-cyan-800 sm:col-span-2">
                        {unpaidCustomerDebts.length > 0
                          ? `May ${unpaidCustomerDebts.length} unpaid utang. Automatic ibabawas ang bayad sa pinakalumang utang muna.`
                          : "Walang unpaid utang ang customer na ito."}
                      </div>
                    )}

                    <label className="block">
                      <span className="mb-2 block text-sm font-medium text-slate-700">
                        Kabuuang Utang <span className="text-slate-400">◌</span>
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
                        Ibabawas sa Utang <span className="text-slate-400">◌</span>
                      </span>
                      <input
                        type="text"
                        value={formatCurrency(appliedPaymentAmount)}
                        readOnly
                        className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-500 outline-none"
                      />
                    </label>

                    <label className="block">
                      <span className="mb-2 block text-sm font-medium text-slate-700">
                        Halaga ng Bayad <span className="text-red-500">*</span>
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
                        Uri ng Bayad <span className="text-slate-400">◌</span>
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

                    {overpaymentAmount > 0 && (
                      <label className="block sm:col-span-2">
                        <span className="mb-2 block text-sm font-medium text-slate-700">
                          Sobra ang bayad ng {formatCurrency(overpaymentAmount)}
                        </span>
                        <select
                          value={form.overpaymentAction}
                          onChange={(event) =>
                            setForm((current) => ({
                              ...current,
                              overpaymentAction: event.target.value,
                            }))
                          }
                          className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 outline-none transition focus:border-cyan-400"
                        >
                          <option value="change">Ibalik bilang sukli</option>
                          <option value="advance">Itabi bilang advance credit</option>
                          <option value="reject">Huwag tanggapin kung sobra</option>
                        </select>
                      </label>
                    )}

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
                        Matitirang Utang
                      </p>
                      <p className="mt-2 text-2xl font-bold text-cyan-700">
                        {formatCurrency(projectedRemainingBalance)}
                      </p>
                    </div>
                    <div className="rounded-2xl bg-white p-4 shadow-sm">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                        Applied To
                      </p>
                      <p className="mt-2 font-mono text-sm text-slate-700">
                        {unpaidCustomerDebts.length > 0 ? "Oldest unpaid utang first" : "No unpaid utang"}
                      </p>
                    </div>
                    <div className="rounded-2xl bg-white p-4 shadow-sm">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                        Sobra / Sukli
                      </p>
                      <p className="mt-2 text-sm font-semibold text-slate-900">
                        {overpaymentAmount > 0 ? formatCurrency(overpaymentAmount) : "Walang sobra"}
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
                        , oldest unpaid utang first.
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

                  <div className="flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-sm text-slate-500">
                      {paymentAmount > 0
                        ? `Ready to record ${formatCurrency(paymentAmount)} for ${selectedCustomer?.firstName || "this customer"}.`
                        : "Enter an amount, then record the payment."}
                    </p>
                    <div className="flex flex-col-reverse gap-3 sm:flex-row">
                    <button
                      type="button"
                      onClick={closeModal}
                      className="rounded-2xl border border-slate-200 px-5 py-3 font-medium text-slate-600 transition hover:bg-slate-50"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={submitting || paymentAmount <= 0 || !selectedCustomer}
                      className="inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-6 py-3 text-base font-bold text-white shadow-lg shadow-emerald-600/20 transition hover:bg-emerald-500 active:scale-95 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500 disabled:shadow-none"
                    >
                      <ReceiptText size={18} />
                      {submitting
                        ? "Recording..."
                        : paymentAmount > 0
                          ? `Record ${formatCurrency(paymentAmount)}`
                          : "Record Payment"}
                    </button>
                    </div>
                  </div>
                </form>
              </div>
            </div>
          </div>
        </div>
      )}

      {paymentPendingVoid && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/50 p-4">
          <div className="flex min-h-full items-center justify-center">
            <div className="my-6 flex w-full max-w-lg flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
              <div className="flex items-center justify-between border-b border-slate-200 px-6 py-5">
                <div>
                  <h3 className="text-xl font-bold text-slate-900">Void Payment</h3>
                  <p className="mt-1 text-sm text-slate-500">
                    This restores the utang balance and keeps an audit record.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={closeVoidModal}
                  className="rounded-xl p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
                  aria-label="Close void payment modal"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="space-y-5 p-6">
                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-800">
                  Confirm void for receipt{" "}
                  <span className="font-semibold">{paymentPendingVoid.paymentId}</span>{" "}
                  under {paymentPendingVoid.customerName}. This will reverse{" "}
                  <span className="font-semibold">
                    {formatCurrency(paymentPendingVoid.appliedAmount ?? paymentPendingVoid.amount)}
                  </span>
                  , restore the utang balance, and keep an audit record.
                  .
                </div>

                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-slate-700">
                    Reason <span className="text-red-500">*</span>
                  </span>
                  <textarea
                    value={voidReason}
                    onChange={(event) => setVoidReason(event.target.value)}
                    rows="3"
                    placeholder="e.g. Wrong customer, duplicate payment, wrong amount."
                    className="w-full rounded-2xl border border-slate-200 px-4 py-3 outline-none transition focus:border-cyan-400"
                  />
                </label>

                {actionError && (
                  <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    {actionError}
                  </div>
                )}

                <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                  <button
                    type="button"
                    onClick={closeVoidModal}
                    disabled={voiding}
                    className="rounded-2xl border border-slate-200 px-5 py-3 font-medium text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleVoidConfirm}
                    disabled={voiding || !voidReason.trim()}
                    className="rounded-2xl bg-amber-400 px-5 py-3 font-semibold text-slate-950 transition hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    {voiding ? "Voiding..." : "Void Payment"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}

export default Payments;
