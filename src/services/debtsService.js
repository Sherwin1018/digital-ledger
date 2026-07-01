import {
  Timestamp,
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  runTransaction,
} from "firebase/firestore";
import { db, firebaseConfigError } from "../firebase/firebase";
import { formatNumericId, getNextDisplayNumber } from "./idService";

const DEBTS_COLLECTION = "debts";
const CUSTOMERS_COLLECTION = "customers";

function ensureFirestore() {
  if (!db) {
    throw new Error(
      firebaseConfigError || "Firestore is unavailable because Firebase is not configured.",
    );
  }
}

function formatTransactionId(debtNumber, documentId) {
  return formatNumericId("DT", debtNumber, documentId);
}

function mapDebtSnapshot(snapshot) {
  const data = snapshot.data();

  return {
    id: snapshot.id,
    debtNumber: Number(data.debtNumber || 0),
    transactionId: data.transactionId || formatTransactionId(data.debtNumber, snapshot.id),
    customerId: data.customerId || "",
    customerName: data.customerName || "",
    product: data.product || "",
    quantity: Number(data.quantity || 0),
    unitPrice: Number(data.unitPrice || 0),
    total: Number(data.total || 0),
    runningBalance: Number(data.runningBalance || 0),
    remarks: data.remarks || "",
    date: data.date || null,
  };
}

async function getDebts() {
  ensureFirestore();

  const debtsQuery = query(collection(db, DEBTS_COLLECTION), orderBy("date", "desc"));
  const snapshot = await getDocs(debtsQuery);

  return snapshot.docs.map(mapDebtSnapshot);
}

async function addDebt(entry) {
  ensureFirestore();

  const quantity = Number(entry.quantity);
  const unitPrice = Number(entry.unitPrice);
  const total = quantity * unitPrice;

  if (!entry.customerId) {
    throw new Error("Customer is required.");
  }

  if (!entry.product.trim()) {
    throw new Error("Product is required.");
  }

  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new Error("Quantity must be greater than zero.");
  }

  if (!Number.isFinite(unitPrice) || unitPrice < 0) {
    throw new Error("Unit price must be zero or greater.");
  }

  const debtRef = doc(collection(db, DEBTS_COLLECTION));
  const customerRef = doc(db, CUSTOMERS_COLLECTION, entry.customerId);

  await runTransaction(db, async (transaction) => {
    const customerSnapshot = await transaction.get(customerRef);

    if (!customerSnapshot.exists()) {
      throw new Error("Selected customer could not be found.");
    }

    const customerData = customerSnapshot.data();
    const currentBalance = Number(customerData.currentBalance || 0);
    const runningBalance = currentBalance + total;
    const debtNumber = await getNextDisplayNumber(transaction, "debts");
    const customerName =
      `${customerData.firstName || ""} ${customerData.lastName || ""}`.trim() ||
      entry.customerName ||
      "Unknown Customer";

    transaction.set(debtRef, {
      customerId: entry.customerId,
      debtNumber,
      customerName,
      product: entry.product.trim(),
      quantity,
      unitPrice,
      total,
      runningBalance,
      remarks: entry.remarks.trim(),
      transactionId: formatTransactionId(debtNumber, debtRef.id),
      date: Timestamp.now(),
    });

    transaction.update(customerRef, {
      currentBalance: runningBalance,
    });
  });
}

async function getCustomer(customerId) {
  ensureFirestore();

  const snapshot = await getDoc(doc(db, CUSTOMERS_COLLECTION, customerId));

  if (!snapshot.exists()) {
    throw new Error("Customer not found.");
  }

  return snapshot.data();
}

export { addDebt, getCustomer, getDebts };
