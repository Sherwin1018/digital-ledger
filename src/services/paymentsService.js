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
const OVERPAYMENT_REJECT = "reject";
const OVERPAYMENT_CHANGE = "change";
const OVERPAYMENT_ADVANCE = "advance";

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
    appliedAmount: Number(data.appliedAmount ?? data.amount ?? 0),
    overpaymentAmount: Number(data.overpaymentAmount || 0),
    changeDue: Number(data.changeDue || 0),
    advanceCreditAmount: Number(data.advanceCreditAmount || 0),
    previousBalance: Number(data.previousBalance || 0),
    remainingBalance: Number(data.remainingBalance || 0),
    customerPreviousBalance: Number(data.customerPreviousBalance ?? data.previousBalance ?? 0),
    customerRemainingBalance: Number(data.customerRemainingBalance ?? data.remainingBalance ?? 0),
    status: data.status || (Number(data.remainingBalance || 0) <= 0 ? STATUS_PAID : STATUS_UNPAID),
    paymentSource: data.paymentSource || "",
    remarks: data.remarks || "",
    debtAllocations: Array.isArray(data.debtAllocations)
      ? data.debtAllocations.map((allocation) => ({
          debtId: allocation.debtId || "",
          transactionId: allocation.transactionId || "",
          amount: Number(allocation.amount || 0),
          remainingBalanceAfter: Number(allocation.remainingBalanceAfter || 0),
        }))
      : [],
    overpaymentAction: data.overpaymentAction || "",
    voided: Boolean(data.voided),
    voidReason: data.voidReason || "",
    voidedAt: data.voidedAt || null,
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

  return snapshot.docs.map(mapPaymentSnapshot).filter((payment) => !payment.voided);
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

  return snapshot.docs.map(mapPaymentSnapshot).filter((payment) => !payment.voided);
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
  const auditRef = doc(collection(db, AUDIT_COLLECTION));
  const customerDebtsQuery = query(
    collection(db, DEBTS_COLLECTION),
    where("customerId", "==", entry.customerId),
  );
  const customerDebtSnapshot = await getDocs(customerDebtsQuery);
  const unpaidDebtRefs = customerDebtSnapshot.docs
    .filter((debtDocument) => {
      const debtData = debtDocument.data();

      return (
        !debtData.voided &&
        debtData.status !== STATUS_PAID &&
        Number(debtData.remainingBalance ?? debtData.total ?? 0) > 0
      );
    })
    .sort((left, right) => {
      const leftDate = left.data().date?.toMillis?.() || 0;
      const rightDate = right.data().date?.toMillis?.() || 0;

      return leftDate - rightDate;
    })
    .map((debtDocument) => debtDocument.ref);

  await runTransaction(db, async (transaction) => {
    const customerSnapshot = await transaction.get(customerRef);

    if (!customerSnapshot.exists()) {
      throw new Error("Selected customer could not be found.");
    }

    const customerData = customerSnapshot.data();
    const customerPreviousBalance = Number(customerData.currentBalance || 0);
    const unpaidDebtSnapshots = await Promise.all(
      unpaidDebtRefs.map((debtRef) => transaction.get(debtRef)),
    );
    const unpaidDebts = unpaidDebtSnapshots
      .filter((debtSnapshot) => debtSnapshot.exists())
      .map((debtSnapshot) => ({
        ref: debtSnapshot.ref,
        id: debtSnapshot.id,
        data: debtSnapshot.data(),
      }))
      .filter((debt) => !debt.data.voided)
      .filter((debt) => debt.data.customerId === entry.customerId)
      .filter((debt) => debt.data.status !== STATUS_PAID)
      .filter((debt) => Number(debt.data.remainingBalance ?? debt.data.total ?? 0) > 0);

    if (customerPreviousBalance <= 0 || unpaidDebts.length === 0) {
      throw new Error("This customer has no unpaid utang to apply payment to.");
    }

    const overpaymentAction = entry.overpaymentAction || OVERPAYMENT_CHANGE;

    if (amount > customerPreviousBalance && overpaymentAction === OVERPAYMENT_REJECT) {
      throw new Error("Payment is bigger than the customer's utang. Choose sukli or advance credit.");
    }

    const paymentNumber = await getNextDisplayNumber(transaction, "payments");
    let unappliedAmount = Number(Math.min(amount, customerPreviousBalance).toFixed(2));
    const appliedAmount = unappliedAmount;
    const overpaymentAmount = Number(Math.max(amount - customerPreviousBalance, 0).toFixed(2));
    const changeDue = overpaymentAction === OVERPAYMENT_CHANGE ? overpaymentAmount : 0;
    const advanceCreditAmount = overpaymentAction === OVERPAYMENT_ADVANCE ? overpaymentAmount : 0;
    const allocations = [];
    const now = Timestamp.now();

    unpaidDebts.forEach((debt) => {
      if (unappliedAmount <= 0) {
        return;
      }

      const debtData = debt.data;
      const previousDebtBalance = Number(debtData.remainingBalance ?? debtData.total ?? 0);
      const allocationAmount = Number(Math.min(unappliedAmount, previousDebtBalance).toFixed(2));
      const remainingDebtBalance = Number((previousDebtBalance - allocationAmount).toFixed(2));
      const transactionId =
        debtData.transactionId || formatNumericId("DT", debtData.debtNumber, debt.id);

      allocations.push({
        debtId: debt.id,
        transactionId,
        amount: allocationAmount,
        remainingBalanceAfter: remainingDebtBalance,
      });

      transaction.update(debt.ref, {
        remainingBalance: remainingDebtBalance,
        status: remainingDebtBalance <= 0 ? STATUS_PAID : STATUS_UNPAID,
        updatedAt: now,
      });

      unappliedAmount = Number((unappliedAmount - allocationAmount).toFixed(2));
    });

    if (allocations.length === 0) {
      throw new Error("No unpaid utang could be found for this customer.");
    }

    const customerRemainingBalance = Number(Math.max(customerPreviousBalance - appliedAmount, 0).toFixed(2));
    const status = customerRemainingBalance <= 0 ? STATUS_PAID : STATUS_UNPAID;
    const customerName =
      `${customerData.firstName || ""} ${customerData.lastName || ""}`.trim() ||
      entry.customerName ||
      "Unknown Customer";
    const paymentId = formatPaymentId(paymentNumber, paymentRef.id);
    const firstAllocation = allocations[0];
    const debtTransactionId =
      allocations.length > 1
        ? `${firstAllocation.transactionId} +${allocations.length - 1}`
        : firstAllocation.transactionId;
    const remarks = entry.remarks?.trim() || (status === STATUS_PAID ? "Fully paid" : "Partial payment");

    transaction.set(paymentRef, {
      debtId: firstAllocation.debtId,
      transactionId: debtTransactionId,
      debtTransactionId,
      customerId: entry.customerId,
      paymentNumber,
      paymentId,
      customerName,
      amount,
      appliedAmount,
      overpaymentAmount,
      changeDue,
      advanceCreditAmount,
      previousBalance: customerPreviousBalance,
      remainingBalance: customerRemainingBalance,
      customerPreviousBalance,
      customerRemainingBalance,
      status,
      paymentSource: entry.paymentSource || "",
      remarks,
      debtAllocations: allocations,
      overpaymentAction,
      voided: false,
      date: now,
      createdAt: now,
    });

    transaction.update(customerRef, {
      currentBalance: customerRemainingBalance,
      totalPayments: Number(customerData.totalPayments || 0) + amount,
      advanceCredit: Number(customerData.advanceCredit || 0) + advanceCreditAmount,
    });

    transaction.set(auditRef, {
      action: "PAYMENT_RECORDED",
      entityType: "payment",
      entityId: paymentRef.id,
      paymentId,
      debtId: firstAllocation.debtId,
      transactionId: debtTransactionId,
      customerId: entry.customerId,
      customerName,
      amount,
      appliedAmount,
      overpaymentAmount,
      previousBalance: customerPreviousBalance,
      remainingBalance: customerRemainingBalance,
      status,
      debtAllocations: allocations,
      createdAt: now,
    });
  });
}

async function voidPayment(paymentId, reason) {
  ensureFirestore();

  if (!paymentId) {
    throw new Error("Payment is required.");
  }

  if (!reason?.trim()) {
    throw new Error("Void reason is required.");
  }

  const paymentRef = doc(db, PAYMENTS_COLLECTION, paymentId);
  const auditRef = doc(collection(db, AUDIT_COLLECTION));

  await runTransaction(db, async (transaction) => {
    const paymentSnapshot = await transaction.get(paymentRef);

    if (!paymentSnapshot.exists()) {
      throw new Error("Payment could not be found.");
    }

    const paymentData = paymentSnapshot.data();

    if (paymentData.voided) {
      throw new Error("This payment is already voided.");
    }

    const customerRef = doc(db, CUSTOMERS_COLLECTION, paymentData.customerId);
    const customerSnapshot = await transaction.get(customerRef);
    const now = Timestamp.now();
    const allocations = Array.isArray(paymentData.debtAllocations)
      ? paymentData.debtAllocations
      : paymentData.debtId
        ? [{ debtId: paymentData.debtId, amount: Number(paymentData.appliedAmount ?? paymentData.amount ?? 0) }]
        : [];

    for (const allocation of allocations) {
      const debtRef = doc(db, DEBTS_COLLECTION, allocation.debtId);
      const debtSnapshot = await transaction.get(debtRef);

      if (debtSnapshot.exists()) {
        const debtData = debtSnapshot.data();
        const nextRemainingBalance = Number(
          (Number(debtData.remainingBalance ?? debtData.total ?? 0) + Number(allocation.amount || 0)).toFixed(2),
        );

        transaction.update(debtRef, {
          remainingBalance: nextRemainingBalance,
          status: nextRemainingBalance <= 0 ? STATUS_PAID : STATUS_UNPAID,
          updatedAt: now,
        });
      }
    }

    if (customerSnapshot.exists()) {
      const customerData = customerSnapshot.data();
      const appliedAmount = Number(paymentData.appliedAmount ?? paymentData.amount ?? 0);
      const advanceCreditAmount = Number(paymentData.advanceCreditAmount || 0);

      transaction.update(customerRef, {
        currentBalance: Number((Number(customerData.currentBalance || 0) + appliedAmount).toFixed(2)),
        totalPayments: Math.max(Number(customerData.totalPayments || 0) - Number(paymentData.amount || 0), 0),
        advanceCredit: Math.max(Number(customerData.advanceCredit || 0) - advanceCreditAmount, 0),
      });
    }

    transaction.update(paymentRef, {
      voided: true,
      voidReason: reason.trim(),
      voidedAt: now,
      updatedAt: now,
    });

    transaction.set(auditRef, {
      action: "PAYMENT_VOIDED",
      entityType: "payment",
      entityId: paymentId,
      paymentId: paymentData.paymentId || paymentId,
      customerId: paymentData.customerId || "",
      customerName: paymentData.customerName || "",
      amount: Number(paymentData.amount || 0),
      reason: reason.trim(),
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

export {
  OVERPAYMENT_ADVANCE,
  OVERPAYMENT_CHANGE,
  OVERPAYMENT_REJECT,
  addPayment,
  getDebt,
  getPayments,
  getPaymentsByDebt,
  voidPayment,
};
