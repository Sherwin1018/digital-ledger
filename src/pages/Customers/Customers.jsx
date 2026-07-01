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
import DashboardLayout from "../../components/layout/DashboardLayout";
import { firebaseConfigError } from "../../firebase/firebase";
import {
  addCustomer,
  deleteCustomer,
  getCustomers,
  normalizeContactNumber,
  updateCustomer,
} from "../../services/customersService";
import { getFirebaseErrorMessage } from "../../utils/firebaseError";

const emptyForm = {
  firstName: "",
  lastName: "",
  contactNumber: "",
  address: "",
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
  } else if (!/^\+?\d{10,15}$/.test(normalizedContact)) {
    errors.contactNumber = "Contact number must be 10 to 15 digits.";
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

  async function loadCustomers() {
    setLoading(true);
    setFetchError("");

    try {
      const nextCustomers = await getCustomers();
      setCustomers(nextCustomers);
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
      closeModal();
    } catch (error) {
      setActionError(getFirebaseErrorMessage(error, "Unable to save customer."));
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
      closeDeleteModal();
    } catch (error) {
      setActionError(getFirebaseErrorMessage(error, "Unable to delete customer."));
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
              placeholder="Search by name, contact, address, or ID"
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

        <section className="overflow-hidden rounded-3xl bg-white shadow-md">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-50">
                <tr className="text-left text-sm font-semibold text-slate-600">
                  <th className="px-6 py-4">Customer ID</th>
                  <th className="px-6 py-4">Name</th>
                  <th className="px-6 py-4">Contact Number</th>
                  <th className="px-6 py-4">Address</th>
                  <th className="px-6 py-4">Created Date</th>
                  <th className="px-6 py-4">Current Balance</th>
                  <th className="px-6 py-4 text-right">Actions</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-100 bg-white">
                {loading ? (
                  <tr>
                    <td className="px-6 py-12 text-center text-slate-500" colSpan="7">
                      Loading customers...
                    </td>
                  </tr>
                ) : fetchError ? (
                  <tr>
                    <td className="px-6 py-12 text-center text-red-600" colSpan="7">
                      {fetchError}
                    </td>
                  </tr>
                ) : filteredCustomers.length === 0 ? (
                  <tr>
                    <td className="px-6 py-12 text-center text-slate-500" colSpan="7">
                      No customers found yet.
                    </td>
                  </tr>
                ) : (
                  filteredCustomers.map((customer) => (
                    <tr key={customer.id} className="text-sm text-slate-700">
                      <td className="px-6 py-4 font-mono text-xs text-slate-500">
                        {customer.id}
                      </td>
                      <td className="px-6 py-4 font-medium text-slate-900">
                        {customer.firstName} {customer.lastName}
                      </td>
                      <td className="px-6 py-4">{customer.contactNumber}</td>
                      <td className="px-6 py-4">{customer.address}</td>
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
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/50 p-4">
          <div className="flex min-h-full items-center justify-center">
            <div className="my-6 flex max-h-[calc(100vh-3rem)] w-full max-w-2xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-5">
              <div className="flex items-center gap-3">
                <div className="rounded-2xl bg-cyan-100 p-3 text-cyan-700">
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
                  <p className="text-sm text-slate-500">
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
                <div className="grid gap-4 p-6 sm:grid-cols-2">
                  <div className="rounded-2xl bg-slate-50 p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                      Customer ID
                    </p>
                    <p className="mt-2 break-all font-mono text-sm text-slate-700">
                      {selectedCustomer.id}
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
                  <div className="rounded-2xl bg-slate-50 p-4 sm:col-span-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                      Address
                    </p>
                    <p className="mt-2 text-sm font-medium text-slate-700">
                      {selectedCustomer.address}
                    </p>
                  </div>
                </div>
              ) : (
                <form className="space-y-5 p-6" onSubmit={handleSubmit}>
                  <div className="grid gap-5 sm:grid-cols-2">
                    <label className="block">
                      <span className="mb-2 block text-sm font-medium text-slate-700">
                        First Name
                      </span>
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
                      <span className="mb-2 block text-sm font-medium text-slate-700">
                        Last Name
                      </span>
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
                      <span className="mb-2 block text-sm font-medium text-slate-700">
                        Contact Number
                      </span>
                      <input
                        type="text"
                        value={form.contactNumber}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            contactNumber: event.target.value,
                          }))
                        }
                        placeholder="09XXXXXXXXX or +639XXXXXXXXX"
                        className="w-full rounded-2xl border border-slate-200 px-4 py-3 outline-none transition focus:border-cyan-400"
                      />
                      {formErrors.contactNumber && (
                        <p className="mt-2 text-sm text-red-600">
                          {formErrors.contactNumber}
                        </p>
                      )}
                    </label>

                  <label className="block">
                    <span className="mb-2 block text-sm font-medium text-slate-700">
                      Current Balance
                    </span>
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
                    <span className="mb-2 block text-sm font-medium text-slate-700">
                      Address
                    </span>
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
                      className="rounded-2xl bg-cyan-500 px-5 py-3 font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-70"
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
                    className="rounded-2xl bg-red-500 px-5 py-3 font-semibold text-white transition hover:bg-red-400 disabled:cursor-not-allowed disabled:opacity-70"
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
