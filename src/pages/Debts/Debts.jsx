import { useEffect, useMemo, useState } from "react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import {
  Eye,
  FileSpreadsheet,
  FileText,
  PackagePlus,
  Plus,
  ReceiptText,
  Search,
  Trash2,
  X,
} from "lucide-react";
import CustomerCombobox from "../../components/forms/CustomerCombobox";
import DashboardLayout from "../../components/layout/DashboardLayout";
import { firebaseConfigError } from "../../firebase/firebase";
import { getCustomers } from "../../services/customersService";
import { addDebt, getDebts } from "../../services/debtsService";
import {
  COMMON_STORE_ITEMS,
  getPaymentScheduleLabel,
  getTrustStatusClass,
  getTrustStatusLabel,
} from "../../utils/customerCulture";
import { getFirebaseErrorMessage } from "../../utils/firebaseError";

const emptyForm = {
  customerId: "",
  items: [{ product: "", quantity: "1", unitPrice: "0" }],
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

function getDebtItems(debt) {
  if (Array.isArray(debt.items) && debt.items.length > 0) {
    return debt.items;
  }

  return [
    {
      product: debt.product,
      quantity: debt.quantity,
      unitPrice: debt.unitPrice,
      total: debt.total,
    },
  ];
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function getDebtFilename(debt, extension) {
  return `${debt.transactionId || "debt-receipt"}-${debt.customerName || "customer"}.${extension}`
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, "-");
}

function getPaymentStatusClass(status) {
  return status === "Paid" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700";
}

function downloadDebtPdf(debt, paymentStatus = "Unpaid") {
  const document = new jsPDF();
  const items = getDebtItems(debt);

  document.setFontSize(18);
  document.text("Digital Ledger Debt Receipt", 14, 18);
  document.setFontSize(11);
  document.text(`Transaction ID: ${debt.transactionId}`, 14, 30);
  document.text(`Customer: ${debt.customerName}`, 14, 37);
  document.text(`Date: ${formatDate(debt.date)}`, 14, 44);
  document.text(`Running Balance: ${formatCurrency(debt.runningBalance)}`, 14, 51);
  document.text(`Status: ${paymentStatus}`, 14, 58);

  autoTable(document, {
    startY: 68,
    head: [["Item", "Quantity", "Unit Price", "Line Total"]],
    body: items.map((item) => [
      item.product,
      String(item.quantity),
      formatCurrency(item.unitPrice),
      formatCurrency(item.total),
    ]),
    foot: [["", "", "Total", formatCurrency(debt.total)]],
    styles: { fontSize: 9 },
    headStyles: { fillColor: [6, 182, 212] },
    footStyles: { fillColor: [226, 232, 240], textColor: [15, 23, 42] },
  });

  const finalY = document.lastAutoTable?.finalY || 62;
  document.text(`Remarks: ${debt.remarks || "-"}`, 14, finalY + 12);
  document.save(getDebtFilename(debt, "pdf"));
}

function downloadDebtExcel(debt, paymentStatus = "Unpaid") {
  const rows = getDebtItems(debt)
    .map(
      (item) => `
        <tr>
          <td>${escapeHtml(item.product)}</td>
          <td>${Number(item.quantity || 0)}</td>
          <td>${Number(item.unitPrice || 0)}</td>
          <td>${Number(item.total || 0)}</td>
        </tr>
      `,
    )
    .join("");
  const html = `
    <html>
      <head><meta charset="utf-8" /></head>
      <body>
        <table>
          <tr><td><strong>Transaction ID</strong></td><td>${escapeHtml(debt.transactionId)}</td></tr>
          <tr><td><strong>Customer</strong></td><td>${escapeHtml(debt.customerName)}</td></tr>
          <tr><td><strong>Date</strong></td><td>${escapeHtml(formatDate(debt.date))}</td></tr>
          <tr><td><strong>Status</strong></td><td>${escapeHtml(paymentStatus)}</td></tr>
          <tr><td><strong>Total</strong></td><td>${Number(debt.total || 0)}</td></tr>
          <tr><td><strong>Running Balance</strong></td><td>${Number(debt.runningBalance || 0)}</td></tr>
          <tr><td><strong>Remarks</strong></td><td>${escapeHtml(debt.remarks || "-")}</td></tr>
        </table>
        <table border="1">
          <thead>
            <tr>
              <th>Item</th>
              <th>Quantity</th>
              <th>Unit Price</th>
              <th>Line Total</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </body>
    </html>
  `;
  const blob = new Blob([html], {
    type: "application/vnd.ms-excel;charset=utf-8",
  });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = getDebtFilename(debt, "xls");
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

function validateDebtForm(form) {
  const errors = {};

  if (!form.customerId) {
    errors.customerId = "Customer is required.";
  }

  if (!form.items.length) {
    errors.items = "At least one item is required.";
  }

  form.items.forEach((item) => {
    const quantity = Number(item.quantity);
    const unitPrice = Number(item.unitPrice);

    if (!item.product.trim()) {
      errors.items = "Each item needs a product name.";
    } else if (!Number.isFinite(quantity) || quantity <= 0) {
      errors.items = "Each quantity must be greater than zero.";
    } else if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      errors.items = "Each unit price must be zero or greater.";
    }
  });

  return errors;
}

function Debts() {
  const [debts, setDebts] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [loading, setLoading] = useState(!firebaseConfigError);
  const [fetchError, setFetchError] = useState("");
  const [actionError, setActionError] = useState("");
  const [formErrors, setFormErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedDebt, setSelectedDebt] = useState(null);
  const [form, setForm] = useState(emptyForm);

  const filteredDebts = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();

    if (!term) {
      return debts;
    }

    return debts.filter((debt) => {
      return (
        debt.transactionId.toLowerCase().includes(term) ||
        debt.customerName.toLowerCase().includes(term) ||
        debt.product.toLowerCase().includes(term) ||
        getDebtItems(debt).some((item) => item.product.toLowerCase().includes(term)) ||
        debt.remarks.toLowerCase().includes(term)
      );
    });
  }, [debts, searchTerm]);

  const selectedCustomer = useMemo(
    () => customers.find((customer) => customer.id === form.customerId) || null,
    [customers, form.customerId],
  );

  const computedTotal = useMemo(() => {
    return form.items.reduce((sum, item) => {
      const quantity = Number(item.quantity);
      const unitPrice = Number(item.unitPrice);

      if (!Number.isFinite(quantity) || !Number.isFinite(unitPrice)) {
        return sum;
      }

      return sum + quantity * unitPrice;
    }, 0);
  }, [form.items]);

  const projectedRunningBalance = (selectedCustomer?.currentBalance || 0) + computedTotal;

  function getDebtCustomer(debt) {
    return customers.find((customer) => customer.id === debt.customerId) || null;
  }

  function getDebtPaymentStatus(debt) {
    const customer = getDebtCustomer(debt);
    const balance = Number(customer?.currentBalance ?? debt.runningBalance ?? 0);

    return balance <= 0 ? "Paid" : "Unpaid";
  }

  async function loadData() {
    setLoading(true);
    setFetchError("");

    try {
      const [nextCustomers, nextDebts] = await Promise.all([getCustomers(), getDebts()]);
      setCustomers(nextCustomers);
      setDebts(nextDebts);
    } catch (error) {
      setFetchError(getFirebaseErrorMessage(error, "Failed to load debts."));
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

  function closeViewModal() {
    setSelectedDebt(null);
  }

  function updateItem(index, field, value) {
    setForm((current) => ({
      ...current,
      items: current.items.map((item, itemIndex) =>
        itemIndex === index ? { ...item, [field]: value } : item,
      ),
    }));
  }

  function addItemRow() {
    setForm((current) => ({
      ...current,
      items: [...current.items, { product: "", quantity: "1", unitPrice: "0" }],
    }));
  }

  function removeItemRow(index) {
    setForm((current) => ({
      ...current,
      items:
        current.items.length === 1
          ? current.items
          : current.items.filter((_, itemIndex) => itemIndex !== index),
    }));
  }

  async function handleSubmit(event) {
    event.preventDefault();

    const validationErrors = validateDebtForm(form);
    setFormErrors(validationErrors);
    setActionError("");

    if (Object.keys(validationErrors).length > 0) {
      return;
    }

    setSubmitting(true);

    try {
      await addDebt({
        ...form,
        customerName: selectedCustomer
          ? `${selectedCustomer.firstName} ${selectedCustomer.lastName}`
          : "",
      });
      await loadData();
      closeModal();
    } catch (error) {
      setActionError(getFirebaseErrorMessage(error, "Unable to save debt entry."));
      setSubmitting(false);
    }
  }

  const totalDebtAmount = filteredDebts.reduce((sum, debt) => sum + Number(debt.total || 0), 0);

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
              placeholder="Search by customer, product, remarks, or transaction"
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
            Add Pa-lista Entry
          </button>
        </section>

        {firebaseConfigError && (
          <div className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Firebase is not configured yet. Create `.env.local`, add your Firebase
            values, and restart the dev server before using the debt module.
          </div>
        )}

        {actionError && (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {actionError}
          </div>
        )}

        <section className="grid gap-4 md:grid-cols-3">
          <div className="rounded-3xl bg-white p-5 shadow-md">
            <p className="text-sm text-slate-500">Debt Entries</p>
            <p className="mt-3 text-3xl font-bold text-slate-900">
              {filteredDebts.length}
            </p>
          </div>
          <div className="rounded-3xl bg-white p-5 shadow-md">
            <p className="text-sm text-slate-500">Total Debt Amount</p>
            <p className="mt-3 text-3xl font-bold text-slate-900">
              {formatCurrency(totalDebtAmount)}
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
                  <th className="px-6 py-4">Items</th>
                  <th className="px-6 py-4">Lines</th>
                  <th className="px-6 py-4">Total</th>
                  <th className="px-6 py-4">Running Balance</th>
                  <th className="px-6 py-4">Date</th>
                  <th className="px-6 py-4">Remarks</th>
                  <th className="px-6 py-4 text-right">Proof</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {loading ? (
                  <tr>
                    <td className="px-6 py-12 text-center text-slate-500" colSpan="10">
                      Loading debt ledger...
                    </td>
                  </tr>
                ) : fetchError ? (
                  <tr>
                    <td className="px-6 py-12 text-center text-red-600" colSpan="10">
                      {fetchError}
                    </td>
                  </tr>
                ) : filteredDebts.length === 0 ? (
                  <tr>
                    <td className="px-6 py-12 text-center text-slate-500" colSpan="10">
                      No debt entries yet.
                    </td>
                  </tr>
                ) : (
                  filteredDebts.map((debt) => {
                    const items = getDebtItems(debt);
                    const paymentStatus = getDebtPaymentStatus(debt);

                    return (
                      <tr key={debt.id} className="text-sm text-slate-700">
                        <td className="px-6 py-4 font-mono text-xs text-slate-500">
                          {debt.transactionId}
                        </td>
                        <td className="px-6 py-4 font-medium text-slate-900">
                          {debt.customerName}
                        </td>
                        <td className="px-6 py-4">
                          <div className="space-y-1">
                            {items.slice(0, 3).map((item, index) => (
                              <p key={`${debt.id}-${item.product}-${index}`}>
                                {item.quantity} x {item.product}{" "}
                                <span className="text-slate-400">
                                  ({formatCurrency(item.total)})
                                </span>
                              </p>
                            ))}
                            {items.length > 3 && (
                              <p className="text-xs text-slate-500">
                                +{items.length - 3} more item(s)
                              </p>
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-4">{items.length}</td>
                        <td className="px-6 py-4 font-semibold text-slate-900">
                          {formatCurrency(debt.total)}
                        </td>
                        <td className="px-6 py-4 font-semibold text-cyan-700">
                          {formatCurrency(debt.runningBalance)}
                        </td>
                        <td className="px-6 py-4">{formatDate(debt.date)}</td>
                        <td className="px-6 py-4">
                          <span
                            className={`rounded-full px-3 py-1 text-xs font-semibold ${getPaymentStatusClass(
                              paymentStatus,
                            )}`}
                          >
                            {paymentStatus}
                          </span>
                          <p className="mt-2 text-xs text-slate-500">
                            {debt.remarks || "-"}
                          </p>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => setSelectedDebt(debt)}
                              className="inline-flex items-center gap-1 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 transition hover:border-cyan-200 hover:bg-cyan-50 hover:text-cyan-700"
                            >
                              <Eye size={14} />
                              View
                            </button>
                            <button
                              type="button"
                              onClick={() => downloadDebtPdf(debt, paymentStatus)}
                              className="inline-flex items-center gap-1 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-red-600 transition hover:border-red-200 hover:bg-red-50"
                            >
                              <FileText size={14} />
                              PDF
                            </button>
                            <button
                              type="button"
                              onClick={() => downloadDebtExcel(debt, paymentStatus)}
                              className="inline-flex items-center gap-1 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-emerald-600 transition hover:border-emerald-200 hover:bg-emerald-50"
                            >
                              <FileSpreadsheet size={14} />
                              Excel
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
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
                  <div className="rounded-2xl bg-cyan-100 p-3 text-cyan-700">
                    <PackagePlus size={20} />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-slate-900">
                      Add Pa-lista Entry
                    </h3>
                    <p className="text-sm text-slate-500">
                      Records utang sa tindahan with automatic total and running balance.
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

                    <div className="space-y-3 sm:col-span-2">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <p className="text-sm font-medium text-slate-700">
                            Items Purchased
                          </p>
                          <p className="text-xs text-slate-500">
                            Add all products in one pa-lista transaction.
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={addItemRow}
                          className="inline-flex items-center justify-center gap-2 rounded-xl border border-cyan-200 px-4 py-2 text-sm font-semibold text-cyan-700 transition hover:bg-cyan-50"
                        >
                          <Plus size={16} />
                          Add Item
                        </button>
                      </div>

                      <datalist id="common-store-items">
                        {COMMON_STORE_ITEMS.map((item) => (
                          <option key={item} value={item} />
                        ))}
                      </datalist>

                      <div className="space-y-3">
                        {form.items.map((item, index) => {
                          const quantity = Number(item.quantity);
                          const unitPrice = Number(item.unitPrice);
                          const lineTotal =
                            Number.isFinite(quantity) && Number.isFinite(unitPrice)
                              ? quantity * unitPrice
                              : 0;

                          return (
                            <div
                              key={`debt-item-${index}`}
                              className="grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3 sm:grid-cols-[1fr_110px_130px_auto]"
                            >
                              <label className="block">
                                <span className="mb-1 block text-xs font-medium text-slate-500">
                                  Product
                                </span>
                                <input
                                  type="text"
                                  value={item.product}
                                  onChange={(event) =>
                                    updateItem(index, "product", event.target.value)
                                  }
                                  list="common-store-items"
                                  placeholder="e.g. Sardines"
                                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 outline-none transition focus:border-cyan-400"
                                />
                              </label>

                              <label className="block">
                                <span className="mb-1 block text-xs font-medium text-slate-500">
                                  Qty
                                </span>
                                <input
                                  type="number"
                                  min="1"
                                  step="1"
                                  value={item.quantity}
                                  onChange={(event) =>
                                    updateItem(index, "quantity", event.target.value)
                                  }
                                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 outline-none transition focus:border-cyan-400"
                                />
                              </label>

                              <label className="block">
                                <span className="mb-1 block text-xs font-medium text-slate-500">
                                  Unit Price
                                </span>
                                <input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  value={item.unitPrice}
                                  onChange={(event) =>
                                    updateItem(index, "unitPrice", event.target.value)
                                  }
                                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 outline-none transition focus:border-cyan-400"
                                />
                              </label>

                              <div className="flex items-end justify-between gap-3">
                                <div>
                                  <span className="mb-1 block text-xs font-medium text-slate-500">
                                    Line Total
                                  </span>
                                  <p className="rounded-xl bg-white px-3 py-2 text-sm font-semibold text-slate-900">
                                    {formatCurrency(lineTotal)}
                                  </p>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => removeItemRow(index)}
                                  disabled={form.items.length === 1}
                                  className="rounded-xl p-2 text-slate-400 transition hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40"
                                  aria-label="Remove item"
                                >
                                  <Trash2 size={16} />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {formErrors.items && (
                        <p className="text-sm text-red-600">{formErrors.items}</p>
                      )}
                    </div>

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
                        placeholder="e.g. Pa-lista muna. Bayaran sa sweldo."
                        className="w-full rounded-2xl border border-slate-200 px-4 py-3 outline-none transition focus:border-cyan-400"
                      />
                    </label>
                  </div>

                  <div className="grid gap-4 rounded-3xl bg-slate-50 p-5 sm:grid-cols-2">
                    <div className="rounded-2xl bg-white p-4 shadow-sm">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                        Automatic Total
                      </p>
                      <p className="mt-2 text-2xl font-bold text-slate-900">
                        {formatCurrency(computedTotal)}
                      </p>
                    </div>
                    <div className="rounded-2xl bg-white p-4 shadow-sm">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                        Projected Running Balance
                      </p>
                      <p className="mt-2 text-2xl font-bold text-cyan-700">
                        {formatCurrency(projectedRunningBalance)}
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
                        Current Customer Balance
                      </p>
                      <p className="mt-2 text-lg font-semibold text-slate-900">
                        {formatCurrency(selectedCustomer?.currentBalance || 0)}
                      </p>
                    </div>
                  </div>

                  {selectedCustomer && (
                    <div className="space-y-3">
                      <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                        Debt will be added to{" "}
                        <span className="font-semibold text-slate-900">
                          {selectedCustomer.firstName} {selectedCustomer.lastName}
                        </span>
                        , and the running balance will update automatically.
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
                          <span className="text-slate-500">
                            Expected payment:{" "}
                            {getPaymentScheduleLabel(selectedCustomer.paymentSchedule)}
                          </span>
                        </div>
                        {selectedCustomer.trustStatus === "paused" && (
                          <p className="mt-2 text-sm font-medium text-red-700">
                            Credit is marked paused. Confirm with the owner before allowing
                            another pa-lista entry.
                          </p>
                        )}
                        {selectedCustomer.trustStatus === "monitor" && (
                          <p className="mt-2 text-sm font-medium text-amber-700">
                            Monitor this account carefully and review payment history.
                          </p>
                        )}
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
                      className="inline-flex items-center justify-center gap-2 rounded-2xl bg-cyan-500 px-5 py-3 font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-70"
                    >
                      <ReceiptText size={18} />
                      {submitting ? "Saving..." : "Save Debt Entry"}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        </div>
      )}

      {selectedDebt && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/50 p-4">
          <div className="flex min-h-full items-center justify-center">
            <div className="my-6 flex max-h-[calc(100vh-3rem)] w-full max-w-3xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
              <div className="flex items-center justify-between border-b border-slate-200 px-6 py-5">
                <div className="flex items-center gap-3">
                  <div className="rounded-2xl bg-cyan-100 p-3 text-cyan-700">
                    <ReceiptText size={20} />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-slate-900">
                      View Borrowed Goods
                    </h3>
                    <p className="text-sm text-slate-500">
                      Full item list for {selectedDebt.transactionId}.
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={closeViewModal}
                  className="rounded-xl p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
                  aria-label="Close view debt modal"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="space-y-5 overflow-y-auto p-6">
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="rounded-2xl bg-slate-50 p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                      Customer
                    </p>
                    <p className="mt-2 font-semibold text-slate-900">
                      {selectedDebt.customerName}
                    </p>
                  </div>
                  <div className="rounded-2xl bg-slate-50 p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                      Status
                    </p>
                    <span
                      className={`mt-2 inline-flex rounded-full px-3 py-1 text-xs font-semibold ${getPaymentStatusClass(
                        getDebtPaymentStatus(selectedDebt),
                      )}`}
                    >
                      {getDebtPaymentStatus(selectedDebt)}
                    </span>
                  </div>
                  <div className="rounded-2xl bg-slate-50 p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                      Total Utang
                    </p>
                    <p className="mt-2 font-semibold text-slate-900">
                      {formatCurrency(selectedDebt.total)}
                    </p>
                  </div>
                  <div className="rounded-2xl bg-slate-50 p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                      Date
                    </p>
                    <p className="mt-2 font-semibold text-slate-900">
                      {formatDate(selectedDebt.date)}
                    </p>
                  </div>
                </div>

                <div className="overflow-hidden rounded-2xl border border-slate-200">
                  <table className="min-w-full divide-y divide-slate-200">
                    <thead className="bg-slate-50">
                      <tr className="text-left text-sm font-semibold text-slate-600">
                        <th className="px-4 py-3">Goods / Item</th>
                        <th className="px-4 py-3">Quantity</th>
                        <th className="px-4 py-3">Unit Price</th>
                        <th className="px-4 py-3">Line Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white text-sm">
                      {getDebtItems(selectedDebt).map((item, index) => (
                        <tr key={`${selectedDebt.id}-view-${index}`}>
                          <td className="px-4 py-3 font-medium text-slate-900">
                            {item.product}
                          </td>
                          <td className="px-4 py-3">{item.quantity}</td>
                          <td className="px-4 py-3">{formatCurrency(item.unitPrice)}</td>
                          <td className="px-4 py-3 font-semibold text-slate-900">
                            {formatCurrency(item.total)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-600">
                  <span className="font-semibold text-slate-900">Remarks:</span>{" "}
                  {selectedDebt.remarks || "-"}
                </div>

                <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                  <button
                    type="button"
                    onClick={closeViewModal}
                    className="rounded-2xl border border-slate-200 px-5 py-3 font-medium text-slate-600 transition hover:bg-slate-50"
                  >
                    Close
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      downloadDebtPdf(selectedDebt, getDebtPaymentStatus(selectedDebt))
                    }
                    className="inline-flex items-center justify-center gap-2 rounded-2xl bg-red-500 px-5 py-3 font-semibold text-white transition hover:bg-red-400"
                  >
                    <FileText size={18} />
                    PDF Proof
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      downloadDebtExcel(selectedDebt, getDebtPaymentStatus(selectedDebt))
                    }
                    className="inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-500 px-5 py-3 font-semibold text-white transition hover:bg-emerald-400"
                  >
                    <FileSpreadsheet size={18} />
                    Excel Proof
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

export default Debts;
