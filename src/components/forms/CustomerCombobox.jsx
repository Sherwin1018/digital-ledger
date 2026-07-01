import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Search } from "lucide-react";

function getCustomerLabel(customer) {
  if (!customer) {
    return "";
  }

  return `${customer.displayId} - ${customer.firstName} ${customer.lastName}`;
}

function customerMatchesTerm(customer, term) {
  const searchable = [
    customer.displayId,
    customer.firstName,
    customer.lastName,
    customer.contactNumber,
    customer.address,
  ]
    .join(" ")
    .toLowerCase();

  return searchable.includes(term);
}

function CustomerCombobox({
  customers,
  selectedCustomerId,
  onSelect,
  error,
  disabled = false,
}) {
  const wrapperRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const filteredCustomers = useMemo(() => {
    const term = query.trim().toLowerCase();

    if (!term) {
      return customers.slice(0, 30);
    }

    return customers.filter((customer) => customerMatchesTerm(customer, term)).slice(0, 30);
  }, [customers, query]);

  useEffect(() => {
    function handleDocumentMouseDown(event) {
      if (!wrapperRef.current?.contains(event.target)) {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handleDocumentMouseDown);
    return () => document.removeEventListener("mousedown", handleDocumentMouseDown);
  }, []);

  function handleInputChange(event) {
    setQuery(event.target.value);
    setOpen(true);

    if (selectedCustomerId) {
      onSelect("");
    }
  }

  function handleSelect(customer) {
    onSelect(customer.id);
    setQuery(getCustomerLabel(customer));
    setOpen(false);
  }

  return (
    <div ref={wrapperRef} className="relative">
      <div className="relative">
        <Search
          size={18}
          className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"
        />
        <input
          type="text"
          value={query}
          onChange={handleInputChange}
          onFocus={() => setOpen(true)}
          disabled={disabled}
          placeholder="Type customer name, ID, contact, or address"
          className="w-full rounded-2xl border border-slate-200 bg-white py-3 pl-11 pr-12 outline-none transition focus:border-cyan-400 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
        />
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          disabled={disabled}
          className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-1 text-slate-500 transition hover:bg-slate-100 disabled:cursor-not-allowed"
          aria-label="Toggle customer results"
        >
          <ChevronDown size={18} />
        </button>
      </div>

      {open && !disabled && (
        <div className="absolute z-30 mt-2 max-h-72 w-full overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-xl">
          {filteredCustomers.length === 0 ? (
            <div className="px-4 py-4 text-sm text-slate-500">
              No matching customers found.
            </div>
          ) : (
            filteredCustomers.map((customer) => (
              <button
                key={customer.id}
                type="button"
                onClick={() => handleSelect(customer)}
                className={`block w-full px-4 py-3 text-left transition hover:bg-cyan-50 ${
                  customer.id === selectedCustomerId ? "bg-cyan-50" : ""
                }`}
              >
                <span className="block text-sm font-semibold text-slate-900">
                  {getCustomerLabel(customer)}
                </span>
                <span className="mt-1 block text-xs text-slate-500">
                  {customer.contactNumber} - {customer.address}
                </span>
              </button>
            ))
          )}
        </div>
      )}

      {customers.length > 30 && open && (
        <p className="mt-2 text-xs text-slate-500">
          Showing the first 30 matches. Keep typing to narrow the results.
        </p>
      )}

      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}

export default CustomerCombobox;
