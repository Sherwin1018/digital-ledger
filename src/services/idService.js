import { doc } from "firebase/firestore";
import { db } from "../firebase/firebase";

const COUNTERS_COLLECTION = "systemCounters";
const COUNTERS_DOCUMENT = "ids";

function getCounterRef() {
  return doc(db, COUNTERS_COLLECTION, COUNTERS_DOCUMENT);
}

async function getNextDisplayNumber(transaction, counterKey) {
  const counterRef = getCounterRef();
  const counterSnapshot = await transaction.get(counterRef);
  const currentValue = Number(counterSnapshot.data()?.[counterKey] || 0);
  const nextValue = currentValue + 1;

  transaction.set(counterRef, { [counterKey]: nextValue }, { merge: true });

  return nextValue;
}

async function getNextDisplayNumbers(transaction, counterKeys) {
  const counterRef = getCounterRef();
  const counterSnapshot = await transaction.get(counterRef);
  const currentCounters = counterSnapshot.data() || {};
  const updates = {};
  const nextValues = {};

  counterKeys.forEach((counterKey) => {
    const nextValue = Number(currentCounters[counterKey] || 0) + 1;

    updates[counterKey] = nextValue;
    nextValues[counterKey] = nextValue;
  });

  transaction.set(counterRef, updates, { merge: true });

  return nextValues;
}

function formatNumericId(prefix, value, fallbackId = "") {
  const number = Number(value);

  if (Number.isInteger(number) && number > 0) {
    return `${prefix}-${String(number).padStart(4, "0")}`;
  }

  return fallbackId ? `${prefix}-${fallbackId.slice(0, 8).toUpperCase()}` : `${prefix}-PENDING`;
}

export { COUNTERS_COLLECTION, getNextDisplayNumber, getNextDisplayNumbers, formatNumericId };
