import { useEffect, useMemo, useState } from "react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import {
  ChevronRight,
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
import FieldLabel from "../../components/forms/FieldLabel";
import DashboardLayout from "../../components/layout/DashboardLayout";
import PaginationControls from "../../components/PaginationControls";
import { useToast } from "../../context/useToast";
import { firebaseConfigError } from "../../firebase/firebase";
import { getCustomers } from "../../services/customersService";
import {
  UTANG_TYPE_BOTH,
  UTANG_TYPE_CASH,
  UTANG_TYPE_GOODS,
  addDebt,
  getDebts,
  voidDebt,
} from "../../services/debtsService";
import { getPayments } from "../../services/paymentsService";
import {
  COMMON_STORE_ITEMS,
  getPaymentScheduleLabel,
  getTrustStatusClass,
  getTrustStatusLabel,
} from "../../utils/customerCulture";
import { getFirebaseErrorMessage } from "../../utils/firebaseError";
import { reconcileLedger } from "../../utils/ledgerReconciliation";

const emptyForm = {
  customerId: "",
  utangType: UTANG_TYPE_GOODS,
  items: [{ product: "", quantity: "1", unitPrice: "0" }],
  cashAmount: "",
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

function getDateKey(timestamp) {
  const date = getJsDate(timestamp);

  if (!date) {
    return "unknown-date";
  }

  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
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

function getUtangTypeLabel(type) {
  if (type === UTANG_TYPE_CASH) {
    return "Cash";
  }

  if (type === UTANG_TYPE_BOTH) {
    return "Goods + Cash";
  }

  return "Goods";
}

function hasGoods(type) {
  return type === UTANG_TYPE_GOODS || type === UTANG_TYPE_BOTH;
}

function hasCash(type) {
  return type === UTANG_TYPE_CASH || type === UTANG_TYPE_BOTH;
}

function addDisplaySequence(debts) {
  const sorted = [...debts].sort((left, right) => {
    const leftDate = getJsDate(left.date)?.getTime() || 0;
    const rightDate = getJsDate(right.date)?.getTime() || 0;

    if (rightDate !== leftDate) {
      return rightDate - leftDate;
    }

    return Number(left.debtNumber || 0) - Number(right.debtNumber || 0);
  });
  const dateCounts = new Map();

  return sorted.map((debt) => {
    const dateKey = debt.dateKey || getDateKey(debt.date);
    const nextSequence = debt.dailySequence || Number(dateCounts.get(dateKey) || 0) + 1;

    dateCounts.set(dateKey, nextSequence);

    return {
      ...debt,
      dateKey,
      displaySequence: nextSequence,
    };
  });
}

function groupDebtsByCustomer(debts) {
  const groups = new Map();

  addDisplaySequence(debts).forEach((debt) => {
    const key = debt.customerId || debt.customerName;
    const existing = groups.get(key);
    const debtItems = getDebtItems(debt);
    const transactionIds = [debt.transactionId].filter(Boolean);

    if (!existing) {
      groups.set(key, {
        ...debt,
        id: `customer-${key}`,
        debtIds: [debt.id],
        transactionIds,
        items: debtItems,
        total: Number(debt.total || 0),
        remainingBalance: Number(debt.remainingBalance ?? debt.total ?? 0),
        cashAmount: Number(debt.cashAmount || 0),
        goodsTotal: Number(debt.goodsTotal ?? debt.total ?? 0),
        displaySequence: debt.displaySequence,
        utangType: debt.utangType,
      });
      return;
    }

    existing.debtIds.push(debt.id);
    existing.transactionIds.push(...transactionIds);
    existing.items = [...existing.items, ...debtItems];
    existing.total += Number(debt.total || 0);
    existing.remainingBalance += Number(debt.remainingBalance ?? debt.total ?? 0);
    existing.cashAmount += Number(debt.cashAmount || 0);
    existing.goodsTotal += Number(debt.goodsTotal ?? debt.total ?? 0);
    existing.transactionId = `${existing.transactionIds[0]} +${existing.transactionIds.length - 1}`;
    existing.utangType =
      existing.cashAmount > 0 && existing.goodsTotal > 0
        ? UTANG_TYPE_BOTH
        : existing.cashAmount > 0
          ? UTANG_TYPE_CASH
          : UTANG_TYPE_GOODS;

    const existingDate = getJsDate(existing.date)?.getTime() || 0;
    const nextDate = getJsDate(debt.date)?.getTime() || 0;

    if (nextDate > existingDate) {
      existing.date = debt.date;
      existing.dateKey = debt.dateKey;
      existing.displaySequence = debt.displaySequence;
    }
  });

  return [...groups.values()].sort(
    (left, right) => (getJsDate(right.date)?.getTime() || 0) - (getJsDate(left.date)?.getTime() || 0),
  );
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
  return status === "PAID" || status === "Paid"
    ? "bg-emerald-100 text-emerald-700"
    : "bg-amber-100 text-amber-700";
}

function getDebtPaymentStatus(debt) {
  const balance = Number(debt.remainingBalance ?? debt.total ?? 0);
  return balance <= 0 ? "PAID" : "UNPAID";
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
  document.text(`Grand Total: ${formatCurrency(debt.total)}`, 14, 51);
  document.text(`Remaining Balance: ${formatCurrency(debt.remainingBalance)}`, 14, 58);
  document.text(`Status: ${paymentStatus}`, 14, 65);

  autoTable(document, {
    startY: 75,
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
          <tr><td><strong>Grand Total</strong></td><td>${Number(debt.total || 0)}</td></tr>
          <tr><td><strong>Remaining Balance</strong></td><td>${Number(debt.remainingBalance ?? debt.total ?? 0)}</td></tr>
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
  const shouldValidateGoods = hasGoods(form.utangType);
  const shouldValidateCash = hasCash(form.utangType);

  if (!form.customerId) {
    errors.customerId = "Customer is required.";
  }

  if (shouldValidateGoods && !form.items.length) {
    errors.items = "At least one item is required.";
  }

  if (shouldValidateGoods) {
    form.items.forEach((item) => {
    const quantity = Number(item.quantity);
    const unitPrice = Number(item.unitPrice);

    if (!item.product.trim()) {
      errors.items = "Each item needs a product name.";
    } else if (!Number.isFinite(quantity) || quantity <= 0) {
      errors.items = "Each quantity must be greater than zero.";
    } else if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
      errors.items = "Each unit price must be greater than zero.";
    }
  });
  }

  if (shouldValidateCash) {
    const cashAmount = Number(form.cashAmount);

    if (!Number.isFinite(cashAmount) || cashAmount <= 0) {
      errors.cashAmount = "Cash utang amount must be greater than zero.";
    }
  }

  return errors;
}

function Debts() {
  const [debts, setDebts] = useState([]);
  const [payments, setPayments] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [loading, setLoading] = useState(!firebaseConfigError);
  const [fetchError, setFetchError] = useState("");
  const [actionError, setActionError] = useState("");
  const [formErrors, setFormErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedDebt, setSelectedDebt] = useState(null);
  const [debtPendingVoid, setDebtPendingVoid] = useState(null);
  const [voidReason, setVoidReason] = useState("");
  const [voiding, setVoiding] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [collapsedItemIndexes, setCollapsedItemIndexes] = useState(new Set());
  const [page, setPage] = useState(1);
  const { showToast } = useToast();

  const activeDebtGroups = useMemo(
    () =>
      groupDebtsByCustomer(
        debts.filter((debt) => Number(debt.remainingBalance ?? debt.total ?? 0) > 0),
      ),
    [debts],
  );

  const filteredDebts = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();

    if (!term) {
      return activeDebtGroups;
    }

    return activeDebtGroups.filter((debt) => {
      return (
        debt.transactionId.toLowerCase().includes(term) ||
        debt.transactionIds?.some((transactionId) => transactionId.toLowerCase().includes(term)) ||
        debt.customerName.toLowerCase().includes(term) ||
        getUtangTypeLabel(debt.utangType).toLowerCase().includes(term) ||
        debt.product.toLowerCase().includes(term) ||
        getDebtItems(debt).some((item) => item.product.toLowerCase().includes(term)) ||
        debt.remarks.toLowerCase().includes(term)
      );
    });
  }, [activeDebtGroups, searchTerm]);

  const selectedCustomer = useMemo(
    () => customers.find((customer) => customer.id === form.customerId) || null,
    [customers, form.customerId],
  );
  const paginatedDebts = useMemo(
    () => filteredDebts.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [filteredDebts, page],
  );

  const computedTotal = useMemo(() => {
    const goodsTotal = hasGoods(form.utangType) ? form.items.reduce((sum, item) => {
      const quantity = Number(item.quantity);
      const unitPrice = Number(item.unitPrice);

      if (!Number.isFinite(quantity) || !Number.isFinite(unitPrice)) {
        return sum;
      }

      return sum + quantity * unitPrice;
    }, 0) : 0;
    const cashAmount = hasCash(form.utangType) ? Number(form.cashAmount || 0) : 0;

    return goodsTotal + (Number.isFinite(cashAmount) ? cashAmount : 0);
  }, [form.cashAmount, form.items, form.utangType]);

  const projectedRunningBalance = (selectedCustomer?.currentBalance || 0) + computedTotal;

  const selectedDebtPayments = useMemo(() => {
    if (!selectedDebt) {
      return [];
    }

    return payments
      .filter((payment) => {
        const debtIds = new Set(selectedDebt.debtIds || [selectedDebt.id]);

        return (
          debtIds.has(payment.debtId) ||
          payment.debtAllocations?.some((allocation) => debtIds.has(allocation.debtId))
        );
      })
      .sort((left, right) => {
        const leftDate =
          typeof left.date?.toDate === "function" ? left.date.toDate() : new Date(left.date);
        const rightDate =
          typeof right.date?.toDate === "function" ? right.date.toDate() : new Date(right.date);
        return rightDate - leftDate;
      });
  }, [payments, selectedDebt]);

  function getDebtRemainingBalance(debt) {
    return Number(debt.remainingBalance ?? debt.total ?? 0);
  }

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
    setCollapsedItemIndexes(new Set([0]));
    setFormErrors({});
    setActionError("");
    setSubmitting(false);
    setIsModalOpen(true);
  }

  function closeModal() {
    setIsModalOpen(false);
    setForm(emptyForm);
    setCollapsedItemIndexes(new Set());
    setFormErrors({});
    setActionError("");
    setSubmitting(false);
  }

  function closeViewModal() {
    setSelectedDebt(null);
  }

  function closeVoidModal() {
    setDebtPendingVoid(null);
    setVoidReason("");
    setVoiding(false);
    setActionError("");
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
    setCollapsedItemIndexes((current) => new Set([...current, form.items.length]));
  }

  function toggleItemCollapsed(index) {
    setCollapsedItemIndexes((current) => {
      const next = new Set(current);

      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }

      return next;
    });
  }

  function removeItemRow(index) {
    setForm((current) => ({
      ...current,
      items:
        current.items.length === 1
          ? current.items
          : current.items.filter((_, itemIndex) => itemIndex !== index),
    }));

    setCollapsedItemIndexes((current) => {
      const next = new Set();

      current.forEach((itemIndex) => {
        if (itemIndex < index) {
          next.add(itemIndex);
        } else if (itemIndex > index) {
          next.add(itemIndex - 1);
        }
      });

      return next;
    });
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
      showToast({ type: "success", message: "Debt transaction saved successfully." });
      closeModal();
    } catch (error) {
      const message = getFirebaseErrorMessage(error, "Unable to save debt entry.");
      setActionError(message);
      showToast({ type: "error", message });
      setSubmitting(false);
    }
  }

  async function handleVoidConfirm() {
    if (!debtPendingVoid) {
      return;
    }

    setVoiding(true);
    setActionError("");

    try {
      const debtIds = debtPendingVoid.debtIds || [debtPendingVoid.id];

      await Promise.all(debtIds.map((debtId) => voidDebt(debtId, voidReason)));
      await loadData();
      showToast({ type: "success", message: "Utang voided and balance corrected." });
      closeVoidModal();
      closeViewModal();
    } catch (error) {
      const message = getFirebaseErrorMessage(error, "Unable to void utang.");
      setActionError(message);
      showToast({ type: "error", message });
      setVoiding(false);
    }
  }

  const totalDebtAmount = filteredDebts.reduce((sum, debt) => sum + Number(debt.total || 0), 0);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <section className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <label className="flex w-full min-w-0 items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm sm:min-w-[260px] sm:flex-1">
            <Search size={18} className="text-slate-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(event) => {
                setSearchTerm(event.target.value);
                setPage(1);
              }}
              placeholder="Search by customer, product, remarks, or transaction"
              className="w-full bg-transparent text-sm text-slate-700 outline-none placeholder:text-slate-400"
            />
          </label>

          <button
            type="button"
            onClick={openAddModal}
            disabled={Boolean(firebaseConfigError)}
            className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-cyan-500 px-5 py-3 font-semibold text-slate-950 transition duration-1000 hover:bg-cyan-400 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
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

        <section className="space-y-3">
          {loading ? (
            <div className="rounded-3xl bg-white p-5 text-center text-sm text-slate-500 shadow-md">
              Loading debt ledger...
            </div>
          ) : fetchError ? (
            <div className="rounded-3xl border border-red-200 bg-red-50 p-5 text-sm text-red-700 shadow-md">
              {fetchError}
            </div>
          ) : filteredDebts.length === 0 ? (
            <div className="rounded-3xl bg-white p-5 text-center text-sm text-slate-500 shadow-md">
              No debt entries yet.
            </div>
          ) : (
            paginatedDebts.map((debt) => {
              const paymentStatus = getDebtPaymentStatus(debt);

              return (
                <article
                  key={debt.id}
                  className="flex items-center justify-between gap-3 rounded-3xl bg-white px-4 py-4 shadow-md transition hover:shadow-lg sm:gap-4 sm:px-5"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-base font-bold text-slate-900 sm:text-lg">
                        {debt.customerName}
                      </h3>
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-semibold ${getPaymentStatusClass(
                          paymentStatus,
                        )}`}
                      >
                        {paymentStatus}
                      </span>
                    </div>

                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500 sm:gap-x-6 sm:text-sm">
                      <span>{getUtangTypeLabel(debt.utangType)}</span>
                      <span>{debt.debtIds?.length || 1} active utang</span>
                      <span>Latest: {formatDate(debt.date)}</span>
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-4">
                    <div className="hidden text-right sm:block">
                      <p className="text-xs text-slate-500">Remaining</p>
                      <p className="font-bold text-cyan-700">
                        {formatCurrency(getDebtRemainingBalance(debt))}
                      </p>
                    </div>
                    <div className="hidden text-right md:block">
                      <p className="text-xs text-slate-500">Total</p>
                      <p className="font-semibold text-slate-900">
                        {formatCurrency(debt.total)}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedDebt(debt)}
                      className="min-h-12 min-w-12 rounded-full bg-slate-900 p-3 text-white transition hover:bg-cyan-600 active:scale-95"
                      aria-label={`View ${debt.customerName} utang details`}
                    >
                      <ChevronRight size={18} />
                    </button>
                  </div>
                </article>
              );
            })
          )}
        </section>

        <PaginationControls
          page={page}
          pageSize={PAGE_SIZE}
          totalItems={filteredDebts.length}
          onPageChange={setPage}
        />
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/50 p-3 sm:p-4">
          <div className="flex min-h-full items-start justify-center sm:items-center">
            <div className="my-3 flex max-h-[calc(100dvh-1.5rem)] w-full max-w-2xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl sm:my-6 sm:max-h-[calc(100vh-3rem)]">
              <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4 sm:items-center sm:px-6 sm:py-5">
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
                <form className="space-y-5 p-5 pb-28 sm:p-6 sm:pb-6" onSubmit={handleSubmit}>
                  <div className="grid gap-5 sm:grid-cols-2">
                    <label className="block sm:col-span-2">
                      <FieldLabel required>Customer</FieldLabel>
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
                      <FieldLabel required>Utang Type</FieldLabel>
                      <select
                        value={form.utangType}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            utangType: event.target.value,
                          }))
                        }
                        className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 outline-none transition focus:border-cyan-400"
                      >
                        <option value={UTANG_TYPE_GOODS}>Goods</option>
                        <option value={UTANG_TYPE_CASH}>Cash</option>
                        <option value={UTANG_TYPE_BOTH}>Goods + Cash</option>
                      </select>
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

                    {hasGoods(form.utangType) && (
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
                          const isCollapsed = collapsedItemIndexes.has(index);

                          return (
                            <div
                              key={`debt-item-${index}`}
                              className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
                            >
                              <div className="flex items-center justify-between gap-3 bg-slate-50 px-3 py-3">
                                <div className="min-w-0">
                                  <p className="text-xs font-semibold uppercase text-slate-400">
                                    Product #{index + 1}
                                  </p>
                                  <p className="truncate text-sm font-semibold text-slate-900">
                                    {item.product.trim() || "New product"} ·{" "}
                                    {formatCurrency(lineTotal)}
                                  </p>
                                </div>
                                <div className="flex shrink-0 items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() => toggleItemCollapsed(index)}
                                    className="rounded-full border border-cyan-200 px-3 py-1 text-xs font-semibold text-cyan-700 transition hover:bg-cyan-50"
                                  >
                                    {isCollapsed ? "Show" : "Hide"}
                                  </button>
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

                              {!isCollapsed && (
                                <div className="grid gap-3 bg-slate-50/60 p-3 sm:grid-cols-[1fr_110px_130px_auto]">
                                  <label className="block">
                                    <span className="mb-1 block text-xs font-medium text-slate-500">
                                      Product <span className="text-red-500">*</span>
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
                                      Qty <span className="text-red-500">*</span>
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
                                      Unit Price <span className="text-red-500">*</span>
                                    </span>
                                    <input
                                      type="number"
                                      min="0.01"
                                      step="0.01"
                                      value={item.unitPrice}
                                      onChange={(event) =>
                                        updateItem(index, "unitPrice", event.target.value)
                                      }
                                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 outline-none transition focus:border-cyan-400"
                                    />
                                  </label>

                                  <div className="flex items-end">
                                    <div className="w-full">
                                      <span className="mb-1 block text-xs font-medium text-slate-500">
                                        Line Total
                                      </span>
                                      <p className="rounded-xl bg-white px-3 py-2 text-sm font-semibold text-slate-900">
                                        {formatCurrency(lineTotal)}
                                      </p>
                                    </div>
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>

                      {formErrors.items && (
                        <p className="text-sm text-red-600">{formErrors.items}</p>
                      )}
                    </div>
                    )}

                    {hasCash(form.utangType) && (
                      <label className="block sm:col-span-2">
                        <FieldLabel required>Cash Utang Amount</FieldLabel>
                        <input
                          type="number"
                          min="0.01"
                          step="0.01"
                          value={form.cashAmount}
                          onChange={(event) =>
                            setForm((current) => ({
                              ...current,
                              cashAmount: event.target.value,
                            }))
                          }
                          placeholder="0.00"
                          className="w-full rounded-2xl border border-slate-200 px-4 py-3 outline-none transition focus:border-cyan-400"
                        />
                        {formErrors.cashAmount && (
                          <p className="mt-2 text-sm text-red-600">
                            {formErrors.cashAmount}
                          </p>
                        )}
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

                  <div className="sticky bottom-0 -mx-5 -mb-28 flex flex-col-reverse gap-3 border-t border-slate-200 bg-white/95 p-5 shadow-[0_-12px_24px_rgba(15,23,42,0.08)] backdrop-blur sm:static sm:mx-0 sm:mb-0 sm:flex-row sm:justify-end sm:border-t-0 sm:bg-transparent sm:p-0 sm:shadow-none sm:backdrop-blur-0">
                    <button
                      type="button"
                      onClick={closeModal}
                      className="rounded-2xl border border-slate-200 px-5 py-3 font-medium text-slate-600 transition hover:bg-slate-50"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={addItemRow}
                      className="inline-flex items-center justify-center gap-2 rounded-2xl border border-cyan-200 px-5 py-3 font-semibold text-cyan-700 transition hover:bg-cyan-50 sm:hidden"
                    >
                      <Plus size={18} />
                      Add Another Item
                    </button>
                    <button
                      type="submit"
                      disabled={submitting}
                      className="inline-flex items-center justify-center gap-2 rounded-2xl bg-cyan-500 px-5 py-3 font-semibold text-slate-950 transition duration-1000 hover:bg-cyan-400 active:scale-95 disabled:cursor-not-allowed disabled:opacity-70"
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
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/50 p-3 sm:p-4">
          <div className="flex min-h-full items-start justify-center sm:items-center">
            <div className="my-3 flex max-h-[calc(100dvh-1.5rem)] w-full max-w-3xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl sm:my-6 sm:max-h-[calc(100vh-3rem)]">
              <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4 sm:items-center sm:px-6 sm:py-5">
                <div className="flex min-w-0 items-start gap-3 sm:items-center">
                  <div className="shrink-0 rounded-2xl bg-cyan-100 p-3 text-cyan-700">
                    <ReceiptText size={20} />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-slate-900">
                      View Borrowed Goods
                    </h3>
                    <p className="break-words text-sm text-slate-500">
                      Full item list for {selectedDebt.transactionId}.
                      {selectedDebt.transactionIds?.length > 1
                        ? ` Includes ${selectedDebt.transactionIds.join(", ")}.`
                        : ""}
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

              <div className="space-y-5 overflow-y-auto p-5 sm:p-6">
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
                      Grand Total
                    </p>
                    <p className="mt-2 font-semibold text-slate-900">
                      {formatCurrency(selectedDebt.total)}
                    </p>
                  </div>
                  <div className="rounded-2xl bg-slate-50 p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                      Date / Sequence
                    </p>
                    <p className="mt-2 font-semibold text-slate-900">
                      {formatDate(selectedDebt.date)} #{selectedDebt.displaySequence || selectedDebt.dailySequence || "-"}
                    </p>
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="rounded-2xl bg-slate-50 p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                      Transaction ID
                    </p>
                    <p className="mt-2 font-mono text-sm font-semibold text-slate-900">
                      {selectedDebt.transactionId}
                    </p>
                  </div>
                  <div className="rounded-2xl bg-slate-50 p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                      Utang Type
                    </p>
                    <p className="mt-2 font-semibold text-slate-900">
                      {getUtangTypeLabel(selectedDebt.utangType)}
                    </p>
                  </div>
                  <div className="rounded-2xl bg-slate-50 p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                      Remaining Balance
                    </p>
                    <p className="mt-2 font-semibold text-cyan-700">
                      {formatCurrency(getDebtRemainingBalance(selectedDebt))}
                    </p>
                  </div>
                </div>

                {hasGoods(selectedDebt.utangType) && (
                <div className="overflow-hidden rounded-2xl border border-slate-200">
                  <div className="overflow-x-auto">
                  <table className="min-w-[38rem] divide-y divide-slate-200">
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
                </div>
                )}

                {hasCash(selectedDebt.utangType) && (
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                      Cash Utang
                    </p>
                    <p className="mt-2 text-xl font-bold text-slate-900">
                      {formatCurrency(selectedDebt.cashAmount)}
                    </p>
                  </div>
                )}

                <div className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-600">
                  <span className="font-semibold text-slate-900">Remarks:</span>{" "}
                  {selectedDebt.remarks || "-"}
                </div>

                <div className="overflow-hidden rounded-2xl border border-slate-200">
                  <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
                    <h4 className="font-semibold text-slate-900">Payment History</h4>
                    <p className="text-sm text-slate-500">
                      Records are append-only and never overwritten.
                    </p>
                  </div>
                  <div className="overflow-x-auto">
                  <table className="min-w-[38rem] divide-y divide-slate-200">
                    <thead className="bg-white">
                      <tr className="text-left text-sm font-semibold text-slate-600">
                        <th className="px-4 py-3">Receipt No.</th>
                        <th className="px-4 py-3">Date</th>
                        <th className="px-4 py-3">Payment</th>
                        <th className="px-4 py-3">Remaining After</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white text-sm">
                      {selectedDebtPayments.length === 0 ? (
                        <tr>
                          <td className="px-4 py-5 text-slate-500" colSpan="4">
                            No payments recorded for this transaction yet.
                          </td>
                        </tr>
                      ) : (
                        selectedDebtPayments.map((payment) => (
                          <tr key={payment.id}>
                            <td className="px-4 py-3 font-mono text-xs text-slate-500">
                              {payment.paymentId}
                            </td>
                            <td className="px-4 py-3">{formatDate(payment.date)}</td>
                            <td className="px-4 py-3 font-semibold text-emerald-700">
                              {formatCurrency(payment.amount)}
                            </td>
                            <td className="px-4 py-3 font-semibold text-cyan-700">
                              {formatCurrency(payment.remainingBalance)}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                  </div>
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
                  <button
                    type="button"
                    onClick={() => setDebtPendingVoid(selectedDebt)}
                    className="inline-flex items-center justify-center gap-2 rounded-2xl bg-amber-400 px-5 py-3 font-semibold text-slate-950 transition hover:bg-amber-300"
                  >
                    Void Utang
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {debtPendingVoid && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/50 p-4">
          <div className="flex min-h-full items-center justify-center">
            <div className="my-6 flex w-full max-w-lg flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
              <div className="flex items-center justify-between border-b border-slate-200 px-6 py-5">
                <div>
                  <h3 className="text-xl font-bold text-slate-900">Void Utang</h3>
                  <p className="mt-1 text-sm text-slate-500">
                    Use this for wrong customer, duplicate item, or wrong amount.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={closeVoidModal}
                  className="rounded-xl p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
                  aria-label="Close void utang modal"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="space-y-5 p-6">
                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-800">
                  Confirm void for {debtPendingVoid.transactionId} under {debtPendingVoid.customerName}.
                  This will reverse the unpaid utang, restore the customer's balance, and keep an audit record.
                </div>

                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-slate-700">
                    Reason <span className="text-red-500">*</span>
                  </span>
                  <textarea
                    value={voidReason}
                    onChange={(event) => setVoidReason(event.target.value)}
                    rows="3"
                    placeholder="e.g. Wrong customer, duplicate utang, wrong item."
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
                    {voiding ? "Voiding..." : "Void Utang"}
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
