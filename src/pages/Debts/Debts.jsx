import { useEffect, useMemo, useState } from "react";
import { PackagePlus, Plus, ReceiptText, Search, X } from "lucide-react";
import DashboardLayout from "../../components/layout/DashboardLayout";
import { firebaseConfigError } from "../../firebase/firebase";
import { getCustomers } from "../../services/customersService";
import { addDebt, getDebts } from "../../services/debtsService";
import { getFirebaseErrorMessage } from "../../utils/firebaseError";

const emptyForm = {
  customerId: "",
  product: "",
  quantity: "1",
  unitPrice: "0",
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

function validateDebtForm(form) {
  const errors = {};
  const quantity = Number(form.quantity);
  const unitPrice = Number(form.unitPrice);

  if (!form.customerId) {
    errors.customerId = "Customer is required.";
  }

  if (!form.product.trim()) {
    errors.product = "Product is required.";
  }

  if (!Number.isFinite(quantity) || quantity <= 0) {
    errors.quantity = "Quantity must be greater than zero.";
  }

  if (!Number.isFinite(unitPrice) || unitPrice < 0) {
    errors.unitPrice = "Unit price must be zero or greater.";
  }

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
        debt.remarks.toLowerCase().includes(term)
      );
    });
  }, [debts, searchTerm]);

  const selectedCustomer = useMemo(
    () => customers.find((customer) => customer.id === form.customerId) || null,
    [customers, form.customerId],
  );

  const computedTotal = useMemo(() => {
    const quantity = Number(form.quantity);
    const unitPrice = Number(form.unitPrice);

    if (!Number.isFinite(quantity) || !Number.isFinite(unitPrice)) {
      return 0;
    }

    return quantity * unitPrice;
  }, [form.quantity, form.unitPrice]);

  const projectedRunningBalance = (selectedCustomer?.currentBalance || 0) + computedTotal;

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
            Add Debt
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
                  <th className="px-6 py-4">Product</th>
                  <th className="px-6 py-4">Quantity</th>
                  <th className="px-6 py-4">Unit Price</th>
                  <th className="px-6 py-4">Total</th>
                  <th className="px-6 py-4">Running Balance</th>
                  <th className="px-6 py-4">Date</th>
                  <th className="px-6 py-4">Remarks</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {loading ? (
                  <tr>
                    <td className="px-6 py-12 text-center text-slate-500" colSpan="9">
                      Loading debt ledger...
                    </td>
                  </tr>
                ) : fetchError ? (
                  <tr>
                    <td className="px-6 py-12 text-center text-red-600" colSpan="9">
                      {fetchError}
                    </td>
                  </tr>
                ) : filteredDebts.length === 0 ? (
                  <tr>
                    <td className="px-6 py-12 text-center text-slate-500" colSpan="9">
                      No debt entries yet.
                    </td>
                  </tr>
                ) : (
                  filteredDebts.map((debt) => (
                    <tr key={debt.id} className="text-sm text-slate-700">
                      <td className="px-6 py-4 font-mono text-xs text-slate-500">
                        {debt.transactionId}
                      </td>
                      <td className="px-6 py-4 font-medium text-slate-900">
                        {debt.customerName}
                      </td>
                      <td className="px-6 py-4">{debt.product}</td>
                      <td className="px-6 py-4">{debt.quantity}</td>
                      <td className="px-6 py-4">{formatCurrency(debt.unitPrice)}</td>
                      <td className="px-6 py-4 font-semibold text-slate-900">
                        {formatCurrency(debt.total)}
                      </td>
                      <td className="px-6 py-4 font-semibold text-cyan-700">
                        {formatCurrency(debt.runningBalance)}
                      </td>
                      <td className="px-6 py-4">{formatDate(debt.date)}</td>
                      <td className="px-6 py-4">{debt.remarks || "-"}</td>
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
                    <PackagePlus size={20} />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-slate-900">Add Debt</h3>
                    <p className="text-sm text-slate-500">
                      Totals, date, transaction ID, and running balance are automatic.
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
                        Product
                      </span>
                      <input
                        type="text"
                        value={form.product}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            product: event.target.value,
                          }))
                        }
                        className="w-full rounded-2xl border border-slate-200 px-4 py-3 outline-none transition focus:border-cyan-400"
                      />
                      {formErrors.product && (
                        <p className="mt-2 text-sm text-red-600">{formErrors.product}</p>
                      )}
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
                        Quantity
                      </span>
                      <input
                        type="number"
                        min="1"
                        step="1"
                        value={form.quantity}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            quantity: event.target.value,
                          }))
                        }
                        className="w-full rounded-2xl border border-slate-200 px-4 py-3 outline-none transition focus:border-cyan-400"
                      />
                      {formErrors.quantity && (
                        <p className="mt-2 text-sm text-red-600">{formErrors.quantity}</p>
                      )}
                    </label>

                    <label className="block">
                      <span className="mb-2 block text-sm font-medium text-slate-700">
                        Unit Price
                      </span>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={form.unitPrice}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            unitPrice: event.target.value,
                          }))
                        }
                        className="w-full rounded-2xl border border-slate-200 px-4 py-3 outline-none transition focus:border-cyan-400"
                      />
                      {formErrors.unitPrice && (
                        <p className="mt-2 text-sm text-red-600">{formErrors.unitPrice}</p>
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
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                      Debt will be added to{" "}
                      <span className="font-semibold text-slate-900">
                        {selectedCustomer.firstName} {selectedCustomer.lastName}
                      </span>
                      , and the running balance will update automatically.
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
    </DashboardLayout>
  );
}

export default Debts;
