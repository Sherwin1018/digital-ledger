import {
  Timestamp,
  collection,
  doc,
  getDocs,
  orderBy,
  query,
  runTransaction,
} from "firebase/firestore";
import { db, firebaseConfigError } from "../firebase/firebase";
import { formatNumericId, getNextDisplayNumber } from "./idService";

const PAYMENTS_COLLECTION = "payments";
const CUSTOMERS_COLLECTION = "customers";

function ensureFirestore() {
  if (!db) {
    throw new Error(
      firebaseConfigError || "Firestore is unavailable because Firebase is not configured.",
    );
  }
}

function formatTransactionId(paymentNumber, documentId) {
  return formatNumericId("PM", paymentNumber, documentId);
}

function mapPaymentSnapshot(snapshot) {
  const data = snapshot.data();

  return {
    id: snapshot.id,
    paymentNumber: Number(data.paymentNumber || 0),
    transactionId: data.transactionId || formatTransactionId(data.paymentNumber, snapshot.id),
    customerId: data.customerId || "",
    customerName: data.customerName || "",
    amount: Number(data.amount || 0),
    previousBalance: Number(data.previousBalance || 0),
    remainingBalance: Number(data.remainingBalance || 0),
    remarks: data.remarks || "",
    date: data.date || null,
  };
}

async function getPayments() {
  ensureFirestore();

  const paymentsQuery = query(
    collection(db, PAYMENTS_COLLECTION),
    orderBy("date", "desc"),
  );
  const snapshot = await getDocs(paymentsQuery);

  return snapshot.docs.map(mapPaymentSnapshot);
}

async function addPayment(entry) {
  ensureFirestore();

  const amount = Number(entry.amount);

  if (!entry.customerId) {
    throw new Error("Customer is required.");
  }

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Payment amount must be greater than zero.");
  }

  const paymentRef = doc(collection(db, PAYMENTS_COLLECTION));
  const customerRef = doc(db, CUSTOMERS_COLLECTION, entry.customerId);

  await runTransaction(db, async (transaction) => {
    const customerSnapshot = await transaction.get(customerRef);

    if (!customerSnapshot.exists()) {
      throw new Error("Selected customer could not be found.");
    }

    const customerData = customerSnapshot.data();
    const previousBalance = Number(customerData.currentBalance || 0);

    if (previousBalance <= 0) {
      throw new Error("This customer has no remaining balance to pay.");
    }

    if (amount > previousBalance) {
      throw new Error("Payment cannot be greater than the current balance.");
    }

    const remainingBalance = previousBalance - amount;
    const paymentNumber = await getNextDisplayNumber(transaction, "payments");
    const customerName =
      `${customerData.firstName || ""} ${customerData.lastName || ""}`.trim() ||
      entry.customerName ||
      "Unknown Customer";

    transaction.set(paymentRef, {
      customerId: entry.customerId,
      paymentNumber,
      customerName,
      amount,
      previousBalance,
      remainingBalance,
      remarks: entry.remarks.trim(),
      transactionId: formatTransactionId(paymentNumber, paymentRef.id),
      date: Timestamp.now(),
    });

    transaction.update(customerRef, {
      currentBalance: remainingBalance,
    });
  });
}

export { addPayment, getPayments };
