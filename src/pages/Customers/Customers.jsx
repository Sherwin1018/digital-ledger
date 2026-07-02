import { useEffect, useMemo, useState } from "react";
import {
  Eye,
  Pencil,
  Plus,
  Search,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import FieldLabel from "../../components/forms/FieldLabel";
import DashboardLayout from "../../components/layout/DashboardLayout";
import { useToast } from "../../context/useToast";
import { firebaseConfigError } from "../../firebase/firebase";
import {
  addCustomer,
  deleteCustomer,
  getCustomers,
  normalizeContactNumber,
  updateCustomer,
} from "../../services/customersService";
import { getDebts } from "../../services/debtsService";
import { getPayments } from "../../services/paymentsService";
import {
  ACCOUNT_TYPES,
  PAYMENT_SCHEDULES,
  TRUST_STATUSES,
  getAccountTypeLabel,
  getPaymentScheduleLabel,
  getTrustStatusClass,
  getTrustStatusLabel,
} from "../../utils/customerCulture";
import { getFirebaseErrorMessage } from "../../utils/firebaseError";
import {
  PHILIPPINE_MOBILE_ERROR,
  PHILIPPINE_MOBILE_PLACEHOLDER,
  isValidPhilippineMobileNumber,
  sanitizePhilippineMobileInput,
} from "../../utils/philippineMobileNumber";
import { reconcileLedger } from "../../utils/ledgerReconciliation";

const emptyForm = {
  firstName: "",
  lastName: "",
  contactNumber: "",
  address: "",
  accountType: "individual",
  householdName: "",
  paymentSchedule: "flexible",
  trustStatus: "trusted",
  communityNotes: "",
  currentBalance: "0",
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

function validateCustomerForm(form) {
  const errors = {};
  const normalizedContact = normalizeContactNumber(form.contactNumber);

  if (!form.firstName.trim()) {
    errors.firstName = "First name is required.";
  }

  if (!form.lastName.trim()) {
    errors.lastName = "Last name is required.";
  }

  if (!normalizedContact) {
    errors.contactNumber = "Contact number is required.";
  } else if (!isValidPhilippineMobileNumber(normalizedContact)) {
    errors.contactNumber = PHILIPPINE_MOBILE_ERROR;
  }

  if (!form.address.trim()) {
    errors.address = "Address is required.";
  }

  if (form.currentBalance === "") {
    errors.currentBalance = "Current balance is required.";
  } else if (Number.isNaN(Number(form.currentBalance))) {
    errors.currentBalance = "Current balance must be a valid number.";
  } else if (Number(form.currentBalance) < 0) {
    errors.currentBalance = "Current balance cannot be negative.";
  }

  return errors;
}

function Customers() {
  const [customers, setCustomers] = useState([]);
  const [debts, setDebts] = useState([]);
  const [payments, setPayments] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [loading, setLoading] = useState(!firebaseConfigError);
  const [fetchError, setFetchError] = useState("");
  const [actionError, setActionError] = useState("");
  const [formErrors, setFormErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState("add");
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [customerPendingDelete, setCustomerPendingDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const { showToast } = useToast();

  const filteredCustomers = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();

    if (!term) {
      return customers;
    }

    return customers.filter((customer) => {
      const fullName = `${customer.firstName} ${customer.lastName}`.toLowerCase();

      return (
        fullName.includes(term) ||
        customer.contactNumber.toLowerCase().includes(term) ||
        customer.address.toLowerCase().includes(term) ||
        customer.householdName.toLowerCase().includes(term) ||
        getTrustStatusLabel(customer.trustStatus).toLowerCase().includes(term) ||
        getPaymentScheduleLabel(customer.paymentSchedule).toLowerCase().includes(term) ||
        customer.displayId.toLowerCase().includes(term) ||
        customer.id.toLowerCase().includes(term)
      );
    });
  }, [customers, searchTerm]);

  const duplicateHints = useMemo(() => {
    if (modalMode !== "add") {
      return [];
    }

    const firstName = form.firstName.trim().toLowerCase();
    const lastName = form.lastName.trim().toLowerCase();
    const normalizedContact = normalizeContactNumber(form.contactNumber);

    if (!firstName && !lastName && !normalizedContact) {
      return [];
    }

    return customers.filter((customer) => {
      const matchesName =
        firstName &&
        lastName &&
        customer.firstName.trim().toLowerCase() === firstName &&
        customer.lastName.trim().toLowerCase() === lastName;
      const matchesContact =
        normalizedContact && normalizeContactNumber(customer.contactNumber) === normalizedContact;

      return matchesName || matchesContact;
    });
  }, [customers, form.contactNumber, form.firstName, form.lastName, modalMode]);

  const selectedCustomerDebts = useMemo(() => {
    if (!selectedCustomer) {
      return [];
    }

    return debts
      .filter((debt) => debt.customerId === selectedCustomer.id)
      .sort((left, right) => (getJsDate(right.date)?.getTime() || 0) - (getJsDate(left.date)?.getTime() || 0));
  }, [debts, selectedCustomer]);

  const selectedCustomerPayments = useMemo(() => {
    if (!selectedCustomer) {
      return [];
    }

    return payments
      .filter((payment) => payment.customerId === selectedCustomer.id)
      .sort((left, right) => (getJsDate(right.date)?.getTime() || 0) - (getJsDate(left.date)?.getTime() || 0));
  }, [payments, selectedCustomer]);

  const selectedCustomerSummary = useMemo(() => {
    const totalBorrowings = selectedCustomerDebts.reduce(
      (sum, debt) => sum + Number(debt.total || 0),
      0,
    );
    const totalPayments = selectedCustomerPayments.reduce(
      (sum, payment) => sum + Number(payment.amount || 0),
      0,
    );
    const outstandingBalance = selectedCustomerDebts.reduce(
      (sum, debt) => sum + Number(debt.remainingBalance ?? debt.total ?? 0),
      0,
    );

    return {
      outstandingBalance,
      totalBorrowings,
      totalPayments,
      transactionCount: selectedCustomerDebts.length,
      recentTransactions: selectedCustomerDebts.slice(0, 5),
      recentPayments: selectedCustomerPayments.slice(0, 5),
    };
  }, [selectedCustomerDebts, selectedCustomerPayments]);

  async function loadCustomers() {
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
      setFetchError(getFirebaseErrorMessage(error, "Failed to load customers."));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (firebaseConfigError) {
      return;
    }

    const timer = window.setTimeout(loadCustomers, 0);
    return () => window.clearTimeout(timer);
  }, []);

  function closeModal() {
    setIsModalOpen(false);
    setModalMode("add");
    setSelectedCustomer(null);
    setForm(emptyForm);
    setFormErrors({});
    setActionError("");
    setSubmitting(false);
  }

  function closeDeleteModal() {
    setCustomerPendingDelete(null);
    setDeleting(false);
    setActionError("");
  }

  function openAddModal() {
    setModalMode("add");
    setSelectedCustomer(null);
    setForm(emptyForm);
    setFormErrors({});
    setActionError("");
    setIsModalOpen(true);
  }

  function openEditModal(customer) {
    setModalMode("edit");
    setSelectedCustomer(customer);
    setForm({
      firstName: customer.firstName,
      lastName: customer.lastName,
      contactNumber: customer.contactNumber,
      address: customer.address,
      accountType: customer.accountType || "individual",
      householdName: customer.householdName || "",
      paymentSchedule: customer.paymentSchedule || "flexible",
      trustStatus: customer.trustStatus || "trusted",
      communityNotes: customer.communityNotes || "",
      currentBalance: String(customer.currentBalance ?? 0),
    });
    setFormErrors({});
    setActionError("");
    setIsModalOpen(true);
  }

  function openViewModal(customer) {
    setModalMode("view");
    setSelectedCustomer(customer);
    setFormErrors({});
    setActionError("");
    setIsModalOpen(true);
  }

  async function handleSubmit(event) {
    event.preventDefault();

    const validationErrors = validateCustomerForm(form);
    setFormErrors(validationErrors);
    setActionError("");

    if (Object.keys(validationErrors).length > 0) {
      return;
    }

    setSubmitting(true);

    try {
      if (modalMode === "add") {
        await addCustomer(form);
      } else if (selectedCustomer) {
        await updateCustomer(selectedCustomer.id, form);
      }

      await loadCustomers();
      showToast({
        type: "success",
        message: modalMode === "add" ? "Customer saved successfully." : "Customer updated successfully.",
      });
      closeModal();
    } catch (error) {
      const message = getFirebaseErrorMessage(error, "Unable to save customer.");
      setActionError(message);
      showToast({ type: "error", message });
      setSubmitting(false);
    }
  }

  function openDeleteModal(customer) {
    setCustomerPendingDelete(customer);
    setActionError("");
  }

  async function handleDeleteConfirm() {
    if (!customerPendingDelete) {
      return;
    }

    setDeleting(true);
    setActionError("");

    try {
      await deleteCustomer(customerPendingDelete.id);
      await loadCustomers();
      showToast({ type: "success", message: "Customer deleted successfully." });
      closeDeleteModal();
    } catch (error) {
      const message = getFirebaseErrorMessage(error, "Unable to delete customer.");
      setActionError(message);
      showToast({ type: "error", message });
      setDeleting(false);
    }
  }

  const totalBalance = filteredCustomers.reduce(
    (sum, customer) => sum + Number(customer.currentBalance || 0),
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
              placeholder="Search by name, family, contact, payday, trust, or ID"
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
            Add Customer
          </button>
        </section>

        {firebaseConfigError && (
          <div className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Firebase is not configured yet. Create `.env.local`, add your Firebase
            values, and restart the dev server before using customer management.
          </div>
        )}

        {actionError && (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {actionError}
          </div>
        )}

        <section className="grid gap-4 md:grid-cols-3">
          <div className="rounded-3xl bg-white p-5 shadow-md">
            <p className="text-sm text-slate-500">Total Customers</p>
            <p className="mt-3 text-3xl font-bold text-slate-900">
              {filteredCustomers.length}
            </p>
          </div>
          <div className="rounded-3xl bg-white p-5 shadow-md">
            <p className="text-sm text-slate-500">Combined Balance</p>
            <p className="mt-3 text-3xl font-bold text-slate-900">
              {formatCurrency(totalBalance)}
            </p>
          </div>
          <div className="rounded-3xl bg-white p-5 shadow-md">
            <p className="text-sm text-slate-500">Search Results</p>
            <p className="mt-3 text-3xl font-bold text-slate-900">
              {searchTerm ? filteredCustomers.length : customers.length}
            </p>
          </div>
        </section>

        <section className="space-y-3 md:hidden">
          {loading ? (
            <div className="rounded-3xl bg-white p-5 text-center text-sm text-slate-500 shadow-md">
              Loading customers...
            </div>
          ) : fetchError ? (
            <div className="rounded-3xl border border-red-200 bg-red-50 p-5 text-sm text-red-700 shadow-md">
              {fetchError}
            </div>
          ) : filteredCustomers.length === 0 ? (
            <div className="rounded-3xl bg-white p-5 text-center text-sm text-slate-500 shadow-md">
              No customers found yet.
            </div>
          ) : (
            filteredCustomers.map((customer) => (
              <article key={customer.id} className="rounded-3xl bg-white p-5 shadow-md">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-mono text-xs text-slate-500">
                      {customer.displayId}
                    </p>
                    <h3 className="mt-2 text-lg font-bold text-slate-900">
                      {customer.firstName} {customer.lastName}
                    </h3>
                    <p className="mt-1 text-sm text-slate-500">{customer.contactNumber}</p>
                  </div>
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${getTrustStatusClass(
                      customer.trustStatus,
                    )}`}
                  >
                    {getTrustStatusLabel(customer.trustStatus)}
                  </span>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-3 rounded-2xl bg-slate-50 p-3 text-sm">
                  <div>
                    <p className="text-xs text-slate-500">Account</p>
                    <p className="mt-1 font-semibold text-slate-900">
                      {getAccountTypeLabel(customer.accountType)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Balance</p>
                    <p className="mt-1 font-bold text-slate-900">
                      {formatCurrency(customer.currentBalance)}
                    </p>
                  </div>
                  <div className="col-span-2">
                    <p className="text-xs text-slate-500">Payment Habit</p>
                    <p className="mt-1 font-medium text-slate-700">
                      {getPaymentScheduleLabel(customer.paymentSchedule)}
                    </p>
                  </div>
                </div>

                <p className="mt-3 line-clamp-2 text-sm text-slate-500">
                  {customer.address}
                </p>

                <div className="mt-4 grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => openViewModal(customer)}
                    className="inline-flex items-center justify-center gap-1 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 transition hover:border-cyan-300 hover:text-cyan-600"
                  >
                    <Eye size={14} />
                    View
                  </button>
                  <button
                    type="button"
                    onClick={() => openEditModal(customer)}
                    className="inline-flex items-center justify-center gap-1 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 transition hover:border-amber-300 hover:text-amber-600"
                  >
                    <Pencil size={14} />
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => openDeleteModal(customer)}
                    className="inline-flex items-center justify-center gap-1 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 transition hover:border-red-300 hover:text-red-600"
                  >
                    <Trash2 size={14} />
                    Delete
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
                  <th className="px-6 py-4">Customer ID</th>
                  <th className="px-6 py-4">Name</th>
                  <th className="px-6 py-4">Account</th>
                  <th className="px-6 py-4">Contact Number</th>
                  <th className="px-6 py-4">Address</th>
                  <th className="px-6 py-4">Trust</th>
                  <th className="px-6 py-4">Created Date</th>
                  <th className="px-6 py-4">Current Balance</th>
                  <th className="px-6 py-4 text-right">Actions</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-100 bg-white">
                {loading ? (
                  <tr>
                    <td className="px-6 py-12 text-center text-slate-500" colSpan="9">
                      Loading customers...
                    </td>
                  </tr>
                ) : fetchError ? (
                  <tr>
                    <td className="px-6 py-12 text-center text-red-600" colSpan="9">
                      {fetchError}
                    </td>
                  </tr>
                ) : filteredCustomers.length === 0 ? (
                  <tr>
                    <td className="px-6 py-12 text-center text-slate-500" colSpan="9">
                      No customers found yet.
                    </td>
                  </tr>
                ) : (
                  filteredCustomers.map((customer) => (
                    <tr key={customer.id} className="text-sm text-slate-700">
                      <td className="px-6 py-4 font-mono text-xs text-slate-500">
                        {customer.displayId}
                      </td>
                      <td className="px-6 py-4 font-medium text-slate-900">
                        {customer.firstName} {customer.lastName}
                      </td>
                      <td className="px-6 py-4">
                        <p>{getAccountTypeLabel(customer.accountType)}</p>
                        {customer.householdName && (
                          <p className="mt-1 text-xs text-slate-500">
                            {customer.householdName}
                          </p>
                        )}
                      </td>
                      <td className="px-6 py-4">{customer.contactNumber}</td>
                      <td className="px-6 py-4">{customer.address}</td>
                      <td className="px-6 py-4">
                        <span
                          className={`rounded-full px-3 py-1 text-xs font-semibold ${getTrustStatusClass(
                            customer.trustStatus,
                          )}`}
                        >
                          {getTrustStatusLabel(customer.trustStatus)}
                        </span>
                        <p className="mt-1 text-xs text-slate-500">
                          {getPaymentScheduleLabel(customer.paymentSchedule)}
                        </p>
                      </td>
                      <td className="px-6 py-4">{formatDate(customer.createdAt)}</td>
                      <td className="px-6 py-4 font-semibold text-slate-900">
                        {formatCurrency(customer.currentBalance)}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => openViewModal(customer)}
                            className="rounded-xl border border-slate-200 p-2 text-slate-600 transition hover:border-cyan-300 hover:text-cyan-600"
                            aria-label="View customer"
                          >
                            <Eye size={16} />
                          </button>
                          <button
                            type="button"
                            onClick={() => openEditModal(customer)}
                            className="rounded-xl border border-slate-200 p-2 text-slate-600 transition hover:border-amber-300 hover:text-amber-600"
                            aria-label="Edit customer"
                          >
                            <Pencil size={16} />
                          </button>
                          <button
                            type="button"
                            onClick={() => openDeleteModal(customer)}
                            className="rounded-xl border border-slate-200 p-2 text-slate-600 transition hover:border-red-300 hover:text-red-600"
                            aria-label="Delete customer"
                          >
                            <Trash2 size={16} />
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
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/50 p-3 sm:p-4">
          <div className="flex min-h-full items-start justify-center sm:items-center">
            <div className="my-3 flex max-h-[calc(100dvh-1.5rem)] w-full max-w-2xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl sm:my-6 sm:max-h-[calc(100vh-3rem)]">
            <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4 sm:items-center sm:px-6 sm:py-5">
              <div className="flex min-w-0 items-start gap-3 sm:items-center">
                <div className="shrink-0 rounded-2xl bg-cyan-100 p-3 text-cyan-700">
                  <UserRound size={20} />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-slate-900">
                    {modalMode === "add"
                      ? "Add Customer"
                      : modalMode === "edit"
                        ? "Edit Customer"
                        : "View Customer"}
                  </h3>
                  <p className="break-words text-sm text-slate-500">
                    {modalMode === "view"
                      ? "Review customer information."
                      : "All required fields must be completed."}
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
              {modalMode === "view" && selectedCustomer ? (
                <div className="grid gap-4 p-5 sm:grid-cols-2 sm:p-6">
                  <div className="rounded-2xl bg-slate-50 p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                      Customer ID
                    </p>
                    <p className="mt-2 break-all font-mono text-sm text-slate-700">
                      {selectedCustomer.displayId}
                    </p>
                  </div>
                  <div className="rounded-2xl bg-slate-50 p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                      Created Date
                    </p>
                    <p className="mt-2 text-sm font-medium text-slate-700">
                      {formatDate(selectedCustomer.createdAt)}
                    </p>
                  </div>
                  <div className="rounded-2xl bg-slate-50 p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                      First Name
                    </p>
                    <p className="mt-2 text-sm font-medium text-slate-700">
                      {selectedCustomer.firstName}
                    </p>
                  </div>
                  <div className="rounded-2xl bg-slate-50 p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                      Last Name
                    </p>
                    <p className="mt-2 text-sm font-medium text-slate-700">
                      {selectedCustomer.lastName}
                    </p>
                  </div>
                  <div className="rounded-2xl bg-slate-50 p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                      Contact Number
                    </p>
                    <p className="mt-2 text-sm font-medium text-slate-700">
                      {selectedCustomer.contactNumber}
                    </p>
                  </div>
                  <div className="rounded-2xl bg-slate-50 p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                      Current Balance
                    </p>
                    <p className="mt-2 text-sm font-medium text-slate-700">
                      {formatCurrency(selectedCustomer.currentBalance)}
                    </p>
                  </div>
                  <div className="rounded-2xl bg-cyan-50 p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-cyan-600">
                      Total Borrowings
                    </p>
                    <p className="mt-2 text-sm font-semibold text-slate-900">
                      {formatCurrency(selectedCustomerSummary.totalBorrowings)}
                    </p>
                  </div>
                  <div className="rounded-2xl bg-emerald-50 p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-emerald-600">
                      Total Payments
                    </p>
                    <p className="mt-2 text-sm font-semibold text-slate-900">
                      {formatCurrency(selectedCustomerSummary.totalPayments)}
                    </p>
                  </div>
                  <div className="rounded-2xl bg-amber-50 p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-amber-600">
                      Outstanding Balance
                    </p>
                    <p className="mt-2 text-sm font-semibold text-slate-900">
                      {formatCurrency(selectedCustomerSummary.outstandingBalance)}
                    </p>
                  </div>
                  <div className="rounded-2xl bg-violet-50 p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-violet-600">
                      Number of Transactions
                    </p>
                    <p className="mt-2 text-sm font-semibold text-slate-900">
                      {selectedCustomerSummary.transactionCount}
                    </p>
                  </div>
                  <div className="rounded-2xl bg-slate-50 p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                      Account Type
                    </p>
                    <p className="mt-2 text-sm font-medium text-slate-700">
                      {getAccountTypeLabel(selectedCustomer.accountType)}
                    </p>
                  </div>
                  <div className="rounded-2xl bg-slate-50 p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                      Household / Family
                    </p>
                    <p className="mt-2 text-sm font-medium text-slate-700">
                      {selectedCustomer.householdName || "-"}
                    </p>
                  </div>
                  <div className="rounded-2xl bg-slate-50 p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                      Tiwala Status
                    </p>
                    <p className="mt-2 text-sm font-medium text-slate-700">
                      {getTrustStatusLabel(selectedCustomer.trustStatus)}
                    </p>
                  </div>
                  <div className="rounded-2xl bg-slate-50 p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                      Expected Payment Habit
                    </p>
                    <p className="mt-2 text-sm font-medium text-slate-700">
                      {getPaymentScheduleLabel(selectedCustomer.paymentSchedule)}
                    </p>
                  </div>
                  <div className="rounded-2xl bg-slate-50 p-4 sm:col-span-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                      Address
                    </p>
                    <p className="mt-2 text-sm font-medium text-slate-700">
                      {selectedCustomer.address}
                    </p>
                  </div>
                  <div className="rounded-2xl bg-slate-50 p-4 sm:col-span-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                      Community Notes
                    </p>
                    <p className="mt-2 whitespace-pre-wrap text-sm font-medium text-slate-700">
                      {selectedCustomer.communityNotes || "-"}
                    </p>
                  </div>
                  <div className="overflow-hidden rounded-2xl border border-slate-200 sm:col-span-2">
                    <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
                      <h4 className="font-semibold text-slate-900">Recent Transactions</h4>
                    </div>
                    <div className="overflow-x-auto">
                    <table className="min-w-[42rem] divide-y divide-slate-200">
                      <thead className="bg-white text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                        <tr>
                          <th className="px-4 py-3">Transaction ID</th>
                          <th className="px-4 py-3">Date</th>
                          <th className="px-4 py-3">Grand Total</th>
                          <th className="px-4 py-3">Remaining</th>
                          <th className="px-4 py-3">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 bg-white text-sm">
                        {selectedCustomerSummary.recentTransactions.length === 0 ? (
                          <tr>
                            <td className="px-4 py-5 text-slate-500" colSpan="5">
                              No borrowing history yet.
                            </td>
                          </tr>
                        ) : (
                          selectedCustomerSummary.recentTransactions.map((debt) => (
                            <tr key={debt.id}>
                              <td className="px-4 py-3 font-mono text-xs text-slate-500">
                                {debt.transactionId}
                              </td>
                              <td className="px-4 py-3">{formatDate(debt.date)}</td>
                              <td className="px-4 py-3">{formatCurrency(debt.total)}</td>
                              <td className="px-4 py-3 font-semibold text-cyan-700">
                                {formatCurrency(debt.remainingBalance ?? debt.total)}
                              </td>
                              <td className="px-4 py-3">
                                {Number(debt.remainingBalance ?? debt.total) <= 0 ? "PAID" : "UNPAID"}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                    </div>
                  </div>
                  <div className="overflow-hidden rounded-2xl border border-slate-200 sm:col-span-2">
                    <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
                      <h4 className="font-semibold text-slate-900">Recent Payments</h4>
                    </div>
                    <div className="overflow-x-auto">
                    <table className="min-w-[42rem] divide-y divide-slate-200">
                      <thead className="bg-white text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                        <tr>
                          <th className="px-4 py-3">Receipt No.</th>
                          <th className="px-4 py-3">Transaction ID</th>
                          <th className="px-4 py-3">Date</th>
                          <th className="px-4 py-3">Payment</th>
                          <th className="px-4 py-3">Remaining</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 bg-white text-sm">
                        {selectedCustomerSummary.recentPayments.length === 0 ? (
                          <tr>
                            <td className="px-4 py-5 text-slate-500" colSpan="5">
                              No payment history yet.
                            </td>
                          </tr>
                        ) : (
                          selectedCustomerSummary.recentPayments.map((payment) => (
                            <tr key={payment.id}>
                              <td className="px-4 py-3 font-mono text-xs text-slate-500">
                                {payment.paymentId}
                              </td>
                              <td className="px-4 py-3 font-mono text-xs text-slate-500">
                                {payment.transactionId}
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
                </div>
              ) : (
                <form className="space-y-5 p-6" onSubmit={handleSubmit}>
                  <div className="grid gap-5 sm:grid-cols-2">
                    <label className="block">
                      <FieldLabel required>First Name</FieldLabel>
                      <input
                        type="text"
                        value={form.firstName}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            firstName: event.target.value,
                          }))
                        }
                        className="w-full rounded-2xl border border-slate-200 px-4 py-3 outline-none transition focus:border-cyan-400"
                      />
                      {formErrors.firstName && (
                        <p className="mt-2 text-sm text-red-600">{formErrors.firstName}</p>
                      )}
                    </label>

                    <label className="block">
                      <FieldLabel required>Last Name</FieldLabel>
                      <input
                        type="text"
                        value={form.lastName}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            lastName: event.target.value,
                          }))
                        }
                        className="w-full rounded-2xl border border-slate-200 px-4 py-3 outline-none transition focus:border-cyan-400"
                      />
                      {formErrors.lastName && (
                        <p className="mt-2 text-sm text-red-600">{formErrors.lastName}</p>
                      )}
                    </label>

                    <label className="block">
                      <FieldLabel required>Contact Number</FieldLabel>
                      <input
                        type="text"
                        value={form.contactNumber}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            contactNumber: sanitizePhilippineMobileInput(event.target.value),
                          }))
                        }
                        inputMode="tel"
                        maxLength="13"
                        placeholder={PHILIPPINE_MOBILE_PLACEHOLDER}
                        className="w-full rounded-2xl border border-slate-200 px-4 py-3 outline-none transition focus:border-cyan-400"
                      />
                      {formErrors.contactNumber && (
                        <p className="mt-2 text-sm text-red-600">
                          {formErrors.contactNumber}
                        </p>
                      )}
                    </label>

                    <label className="block">
                      <FieldLabel required>Current Balance</FieldLabel>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={form.currentBalance}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            currentBalance: event.target.value,
                          }))
                        }
                        className="w-full rounded-2xl border border-slate-200 px-4 py-3 outline-none transition focus:border-cyan-400"
                      />
                      {formErrors.currentBalance && (
                        <p className="mt-2 text-sm text-red-600">
                          {formErrors.currentBalance}
                        </p>
                      )}
                    </label>

                    <label className="block">
                      <FieldLabel>Account Type</FieldLabel>
                      <select
                        value={form.accountType}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            accountType: event.target.value,
                          }))
                        }
                        className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 outline-none transition focus:border-cyan-400"
                      >
                        {ACCOUNT_TYPES.map((type) => (
                          <option key={type.value} value={type.value}>
                            {type.label}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="block">
                      <FieldLabel>Household / Family Name</FieldLabel>
                      <input
                        type="text"
                        value={form.householdName}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            householdName: event.target.value,
                          }))
                        }
                        placeholder="e.g. Garcia Family"
                        className="w-full rounded-2xl border border-slate-200 px-4 py-3 outline-none transition focus:border-cyan-400"
                      />
                    </label>

                    <label className="block">
                      <FieldLabel>Tiwala Status</FieldLabel>
                      <select
                        value={form.trustStatus}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            trustStatus: event.target.value,
                          }))
                        }
                        className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 outline-none transition focus:border-cyan-400"
                      >
                        {TRUST_STATUSES.map((status) => (
                          <option key={status.value} value={status.value}>
                            {status.label}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="block">
                      <FieldLabel>Expected Payment Habit</FieldLabel>
                      <select
                        value={form.paymentSchedule}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            paymentSchedule: event.target.value,
                          }))
                        }
                        className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 outline-none transition focus:border-cyan-400"
                      >
                        {PAYMENT_SCHEDULES.map((schedule) => (
                          <option key={schedule.value} value={schedule.value}>
                            {schedule.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  {duplicateHints.length > 0 && (
                    <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4">
                      <p className="text-sm font-semibold text-amber-800">
                        Possible existing customer found
                      </p>
                      <p className="mt-1 text-sm text-amber-700">
                        Review these matches first to reduce duplicate records.
                      </p>
                      <div className="mt-3 space-y-2">
                        {duplicateHints.slice(0, 3).map((customer) => (
                          <div
                            key={customer.id}
                            className="rounded-2xl border border-amber-200 bg-white px-4 py-3 text-sm text-slate-700"
                          >
                            <p className="font-semibold text-slate-900">
                              {customer.firstName} {customer.lastName}
                            </p>
                            <p className="mt-1 text-slate-600">
                              {customer.contactNumber} · {customer.address}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <label className="block">
                    <FieldLabel required>Address</FieldLabel>
                    <textarea
                      value={form.address}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          address: event.target.value,
                        }))
                      }
                      rows="4"
                      className="w-full rounded-2xl border border-slate-200 px-4 py-3 outline-none transition focus:border-cyan-400"
                    />
                    {formErrors.address && (
                      <p className="mt-2 text-sm text-red-600">{formErrors.address}</p>
                    )}
                  </label>

                  <label className="block">
                    <FieldLabel>Community Notes</FieldLabel>
                    <textarea
                      value={form.communityNotes}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          communityNotes: event.target.value,
                        }))
                      }
                      rows="3"
                      placeholder="e.g. Bayaran sa sweldo, family member can buy under this account."
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
                      onClick={closeModal}
                      className="rounded-2xl border border-slate-200 px-5 py-3 font-medium text-slate-600 transition hover:bg-slate-50"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={submitting}
                      className="rounded-2xl bg-cyan-500 px-5 py-3 font-semibold text-slate-950 transition duration-1000 hover:bg-cyan-400 active:scale-95 disabled:cursor-not-allowed disabled:opacity-70"
                    >
                      {submitting
                        ? "Saving..."
                        : modalMode === "add"
                          ? "Save Customer"
                          : "Update Customer"}
                    </button>
                  </div>
                </form>
              )}
            </div>
            </div>
          </div>
        </div>
      )}

      {customerPendingDelete && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/50 p-4">
          <div className="flex min-h-full items-center justify-center">
            <div className="my-6 flex w-full max-w-md flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
              <div className="flex items-center justify-between border-b border-slate-200 px-6 py-5">
                <div>
                  <h3 className="text-xl font-bold text-slate-900">Delete Customer</h3>
                  <p className="mt-1 text-sm text-slate-500">
                    This action removes the selected customer record.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={closeDeleteModal}
                  className="rounded-xl p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
                  aria-label="Close delete confirmation modal"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="space-y-5 p-6">
                <div className="rounded-2xl border border-red-100 bg-red-50 px-4 py-4 text-sm text-red-700">
                  Are you sure you want to delete{" "}
                  <span className="font-semibold">
                    {customerPendingDelete.firstName} {customerPendingDelete.lastName}
                  </span>
                  ?
                </div>

                {actionError && (
                  <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    {actionError}
                  </div>
                )}

                <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                  <button
                    type="button"
                    onClick={closeDeleteModal}
                    disabled={deleting}
                    className="rounded-2xl border border-slate-200 px-5 py-3 font-medium text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleDeleteConfirm}
                    disabled={deleting}
                    className="rounded-2xl bg-red-500 px-5 py-3 font-semibold text-white transition duration-1000 hover:bg-red-400 active:scale-95 disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    {deleting ? "Deleting..." : "Delete Customer"}
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

export default Customers;

