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

function formatTransactionId(debtNumber, documentId) {
  return formatNumericId("DT", debtNumber, documentId);
}

function normalizeDebtItems(entry) {
  const sourceItems = Array.isArray(entry.items)
    ? entry.items
    : [
        {
          product: entry.product,
          quantity: entry.quantity,
          unitPrice: entry.unitPrice,
        },
      ];

  return sourceItems.map((item) => {
    const product = String(item.product || "").trim();
    const quantity = Number(item.quantity);
    const unitPrice = Number(item.unitPrice);
    const total = Number((quantity * unitPrice).toFixed(2));

    return {
      product,
      quantity,
      unitPrice,
      total,
    };
  });
}

function mapDebtSnapshot(snapshot) {
  const data = snapshot.data();
  const items = Array.isArray(data.items) && data.items.length > 0
    ? data.items.map((item) => ({
        product: item.product || "",
        quantity: Number(item.quantity || 0),
        unitPrice: Number(item.unitPrice || 0),
        total: Number(item.total || 0),
      }))
    : [
        {
          product: data.product || "",
          quantity: Number(data.quantity || 0),
          unitPrice: Number(data.unitPrice || 0),
          total: Number(data.total || 0),
        },
      ];

  return {
    id: snapshot.id,
    debtNumber: Number(data.debtNumber || 0),
    transactionId: data.transactionId || formatTransactionId(data.debtNumber, snapshot.id),
    customerId: data.customerId || "",
    customerName: data.customerName || "",
    product: data.product || "",
    items,
    quantity: Number(data.quantity || 0),
    unitPrice: Number(data.unitPrice || 0),
    total: Number(data.total || 0),
    grandTotal: Number(data.grandTotal ?? data.total ?? 0),
    runningBalance: Number(data.runningBalance || 0),
    remainingBalance: Number(data.remainingBalance ?? data.total ?? 0),
    status:
      data.status ||
      (Number(data.remainingBalance ?? data.total ?? 0) <= 0 ? STATUS_PAID : STATUS_UNPAID),
    remarks: data.remarks || "",
    date: data.date || null,
    createdAt: data.createdAt || data.date || null,
    updatedAt: data.updatedAt || data.date || null,
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

  const items = normalizeDebtItems(entry);
  const total = Number(items.reduce((sum, item) => sum + item.total, 0).toFixed(2));

  if (!entry.customerId) {
    throw new Error("Customer is required.");
  }

  if (items.length === 0) {
    throw new Error("At least one item is required.");
  }

  items.forEach((item) => {
    if (!item.product) {
      throw new Error("Each item needs a product name.");
    }

    if (!Number.isFinite(item.quantity) || item.quantity <= 0) {
      throw new Error("Each item quantity must be greater than zero.");
    }

    if (!Number.isFinite(item.unitPrice) || item.unitPrice < 0) {
      throw new Error("Each item unit price must be zero or greater.");
    }
  });

  if (!Number.isFinite(total) || total <= 0) {
    throw new Error("Debt total must be greater than zero.");
  }

  const debtRef = doc(collection(db, DEBTS_COLLECTION));
  const customerRef = doc(db, CUSTOMERS_COLLECTION, entry.customerId);
  const auditRef = doc(collection(db, AUDIT_COLLECTION));

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
    const productSummary = items
      .map((item) => `${item.quantity} ${item.product}`)
      .join(", ");
    const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);
    const unitPrice = items.length === 1 ? items[0].unitPrice : 0;

    const now = Timestamp.now();
    const transactionId = formatTransactionId(debtNumber, debtRef.id);

    transaction.set(debtRef, {
      customerId: entry.customerId,
      debtNumber,
      customerName,
      product: productSummary,
      items,
      quantity: totalQuantity,
      unitPrice,
      total,
      runningBalance,
      grandTotal: total,
      remainingBalance: total,
      status: STATUS_UNPAID,
      remarks: entry.remarks?.trim() || "",
      transactionId,
      date: now,
      createdAt: now,
      updatedAt: now,
    });

    transaction.update(customerRef, {
      currentBalance: runningBalance,
      totalBorrowings: Number(customerData.totalBorrowings || 0) + total,
      transactionCount: Number(customerData.transactionCount || 0) + 1,
    });

    transaction.set(auditRef, {
      action: "DEBT_CREATED",
      entityType: "debt",
      entityId: debtRef.id,
      transactionId,
      customerId: entry.customerId,
      customerName,
      amount: total,
      createdAt: now,
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

export { STATUS_PAID, STATUS_UNPAID, addDebt, getCustomer, getDebts };
