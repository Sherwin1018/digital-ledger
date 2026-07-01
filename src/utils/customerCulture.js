const ACCOUNT_TYPES = [
  { value: "individual", label: "Individual Account" },
  { value: "family", label: "Family Account" },
];

const TRUST_STATUSES = [
  {
    value: "trusted",
    label: "Trusted",
    description: "Good payer; can continue borrowing based on tiwala.",
  },
  {
    value: "monitor",
    label: "Monitor",
    description: "Allow credit carefully and review payment history.",
  },
  {
    value: "paused",
    label: "Credit Paused",
    description: "Politely pause new utang until older balances improve.",
  },
];

const PAYMENT_SCHEDULES = [
  { value: "weekly", label: "Weekly wage" },
  { value: "biweekly", label: "Bi-weekly salary" },
  { value: "monthly", label: "Monthly salary" },
  { value: "pension", label: "Pension" },
  { value: "assistance", label: "Government assistance / 4Ps" },
  { value: "seasonal", label: "Seasonal / harvest" },
  { value: "flexible", label: "Flexible / as able" },
];

const PAYMENT_SOURCES = [
  { value: "weekly_wage", label: "Weekly wage" },
  { value: "salary", label: "Salary / sweldo" },
  { value: "pension", label: "Pension" },
  { value: "assistance", label: "Government assistance / 4Ps" },
  { value: "partial", label: "Partial payment" },
  { value: "other", label: "Other" },
];

const COMMON_STORE_ITEMS = [
  "Rice",
  "Instant noodles",
  "Sardines",
  "Canned goods",
  "Coffee",
  "Sugar",
  "Bread",
  "Eggs",
  "Soap",
  "Shampoo sachet",
  "Detergent",
  "Soft drinks",
];

function findLabel(options, value, fallback = "Not set") {
  return options.find((option) => option.value === value)?.label || fallback;
}

function getAccountTypeLabel(value) {
  return findLabel(ACCOUNT_TYPES, value, "Individual Account");
}

function getTrustStatusLabel(value) {
  return findLabel(TRUST_STATUSES, value, "Trusted");
}

function getPaymentScheduleLabel(value) {
  return findLabel(PAYMENT_SCHEDULES, value, "Flexible / as able");
}

function getPaymentSourceLabel(value) {
  return findLabel(PAYMENT_SOURCES, value, "Not specified");
}

function getTrustStatusClass(value) {
  if (value === "paused") {
    return "bg-red-100 text-red-700";
  }

  if (value === "monitor") {
    return "bg-amber-100 text-amber-700";
  }

  return "bg-emerald-100 text-emerald-700";
}

export {
  ACCOUNT_TYPES,
  COMMON_STORE_ITEMS,
  PAYMENT_SCHEDULES,
  PAYMENT_SOURCES,
  TRUST_STATUSES,
  getAccountTypeLabel,
  getPaymentScheduleLabel,
  getPaymentSourceLabel,
  getTrustStatusClass,
  getTrustStatusLabel,
};
