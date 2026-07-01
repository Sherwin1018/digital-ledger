function cleanMobileNumber(value) {
  return String(value || "").replace(/[^\d+]/g, "");
}

function normalizePhilippineMobileNumber(value) {
  const cleaned = cleanMobileNumber(value);

  if (/^09\d{9}$/.test(cleaned)) {
    return cleaned;
  }

  if (/^\+639\d{9}$/.test(cleaned)) {
    return `0${cleaned.slice(3)}`;
  }

  if (/^639\d{9}$/.test(cleaned)) {
    return `0${cleaned.slice(2)}`;
  }

  return cleaned;
}

function isValidPhilippineMobileNumber(value) {
  return /^09\d{9}$/.test(normalizePhilippineMobileNumber(value));
}

function sanitizePhilippineMobileInput(value) {
  const cleaned = cleanMobileNumber(value);

  if (cleaned.startsWith("+")) {
    return `+${cleaned.slice(1).replace(/\D/g, "").slice(0, 12)}`;
  }

  return cleaned.replace(/\D/g, "").slice(0, 12);
}

const PHILIPPINE_MOBILE_PLACEHOLDER = "09XXXXXXXXX or +639XXXXXXXXX";
const PHILIPPINE_MOBILE_ERROR = "Enter a valid Philippine mobile number, e.g. 09123456789.";

export {
  PHILIPPINE_MOBILE_ERROR,
  PHILIPPINE_MOBILE_PLACEHOLDER,
  isValidPhilippineMobileNumber,
  normalizePhilippineMobileNumber,
  sanitizePhilippineMobileInput,
};
