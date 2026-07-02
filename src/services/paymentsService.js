import {
  Timestamp,
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  runTransaction,
  where,
} from "firebase/firestore";
import { db, firebaseConfigError } from "../firebase/firebase";
import { formatNumericId, getNextDisplayNumber } from "./idService";

const PAYMENTS_COLLECTION = "payments";
const CUSTOMERS_COLLECTION = "customers";
const DEBTS_COLLECTION = "debts";
const AUDIT_COLLECTION = "auditTrail";
const STATUS_PAID = "PAID";
const STATUS_UNPAID = "UNPAID";

function ensureFirestore() {
  if (!db) {
    throw new Error(
      firebaseConfigError || "Firestore is unavailable because Firebase is not configured.",
    );
  }
}

function formatPaymentId(paymentNumber, documentId) {
  return formatNumericId("PM", paymentNumber, documentId);
}

function mapPaymentSnapshot(snapshot) {
  const data = snapshot.data();
  const paymentId = data.paymentId || data.transactionId || formatPaymentId(data.paymentNumber, snapshot.id);

  return {
    id: snapshot.id,
    paymentNumber: Number(data.paymentNumber || 0),
    paymentId,
    transactionId: data.transactionId || "",
    debtId: data.debtId || "",
    debtTransactionId: data.debtTransactionId || data.transactionId || "",
    customerId: data.customerId || "",
    customerName: data.customerName || "",
    amount: Number(data.amount || 0),
    previousBalance: Number(data.previousBalance || 0),
    remainingBalance: Number(data.remainingBalance || 0),
    customerPreviousBalance: Number(data.customerPreviousBalance ?? data.previousBalance ?? 0),
    customerRemainingBalance: Number(data.customerRemainingBalance ?? data.remainingBalance ?? 0),
    status: data.status || (Number(data.remainingBalance || 0) <= 0 ? STATUS_PAID : STATUS_UNPAID),
    paymentSource: data.paymentSource || "",
    remarks: data.remarks || "",
    date: data.date || null,
    createdAt: data.createdAt || data.date || null,
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

async function getPaymentsByDebt(debtId) {
  ensureFirestore();

  if (!debtId) {
    return [];
  }

  const paymentsQuery = query(
    collection(db, PAYMENTS_COLLECTION),
    where("debtId", "==", debtId),
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

  if (!entry.debtId) {
    throw new Error("Debt transaction is required.");
  }

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Payment amount must be greater than zero.");
  }

  const paymentRef = doc(collection(db, PAYMENTS_COLLECTION));
  const customerRef = doc(db, CUSTOMERS_COLLECTION, entry.customerId);
  const debtRef = doc(db, DEBTS_COLLECTION, entry.debtId);
  const auditRef = doc(collection(db, AUDIT_COLLECTION));

  await runTransaction(db, async (transaction) => {
    const [customerSnapshot, debtSnapshot] = await Promise.all([
      transaction.get(customerRef),
      transaction.get(debtRef),
    ]);

    if (!customerSnapshot.exists()) {
      throw new Error("Selected customer could not be found.");
    }

    if (!debtSnapshot.exists()) {
      throw new Error("Selected debt transaction could not be found.");
    }

    const customerData = customerSnapshot.data();
    const debtData = debtSnapshot.data();
    const customerPreviousBalance = Number(customerData.currentBalance || 0);
    const previousBalance = Number(debtData.remainingBalance ?? debtData.total ?? 0);

    if (previousBalance <= 0) {
      throw new Error("This debt transaction is already paid.");
    }

    if (debtData.customerId !== entry.customerId) {
      throw new Error("Selected transaction does not belong to this customer.");
    }

    if (amount > previousBalance) {
      throw new Error("Payment cannot be greater than the transaction balance.");
    }

    const remainingBalance = Number((previousBalance - amount).toFixed(2));
    const customerRemainingBalance = Number(
      Math.max(customerPreviousBalance - amount, 0).toFixed(2),
    );
    const status = remainingBalance <= 0 ? STATUS_PAID : STATUS_UNPAID;
    const paymentNumber = await getNextDisplayNumber(transaction, "payments");
    const customerName =
      `${customerData.firstName || ""} ${customerData.lastName || ""}`.trim() ||
      entry.customerName ||
      "Unknown Customer";
    const paymentId = formatPaymentId(paymentNumber, paymentRef.id);
    const debtTransactionId =
      debtData.transactionId || formatNumericId("DT", debtData.debtNumber, debtRef.id);
    const remarks = entry.remarks?.trim() || (status === STATUS_PAID ? "Paid" : "Partial payment");
    const now = Timestamp.now();

    transaction.set(paymentRef, {
      debtId: entry.debtId,
      transactionId: debtTransactionId,
      debtTransactionId,
      customerId: entry.customerId,
      paymentNumber,
      paymentId,
      customerName,
      amount,
      previousBalance,
      remainingBalance,
      customerPreviousBalance,
      customerRemainingBalance,
      status,
      paymentSource: entry.paymentSource || "",
      remarks,
      date: now,
      createdAt: now,
    });

    transaction.update(debtRef, {
      remainingBalance,
      status,
      updatedAt: now,
    });

    transaction.update(customerRef, {
      currentBalance: customerRemainingBalance,
      totalPayments: Number(customerData.totalPayments || 0) + amount,
    });

    transaction.set(auditRef, {
      action: "PAYMENT_RECORDED",
      entityType: "payment",
      entityId: paymentRef.id,
      paymentId,
      debtId: entry.debtId,
      transactionId: debtTransactionId,
      customerId: entry.customerId,
      customerName,
      amount,
      previousBalance,
      remainingBalance,
      status,
      createdAt: now,
    });
  });
}

async function getDebt(debtId) {
  ensureFirestore();

  const snapshot = await getDoc(doc(db, DEBTS_COLLECTION, debtId));

  if (!snapshot.exists()) {
    throw new Error("Debt transaction not found.");
  }

  return snapshot.data();
}

export { addPayment, getDebt, getPayments, getPaymentsByDebt };
