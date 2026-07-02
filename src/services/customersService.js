import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { db, firebaseConfigError } from "../firebase/firebase";
import { normalizePhilippineMobileNumber } from "../utils/philippineMobileNumber";
import { formatNumericId, getNextDisplayNumber } from "./idService";

const CUSTOMERS_COLLECTION = "customers";

function ensureFirestore() {
  if (!db) {
    throw new Error(
      firebaseConfigError || "Firestore is unavailable because Firebase is not configured.",
    );
  }
}

function normalizeName(value) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeContactNumber(value) {
  return normalizePhilippineMobileNumber(value);
}

function mapCustomerSnapshot(snapshot) {
  const data = snapshot.data();

  return {
    id: snapshot.id,
    customerNumber: Number(data.customerNumber || 0),
    displayId: formatNumericId("CUST", data.customerNumber, snapshot.id),
    firstName: data.firstName || "",
    lastName: data.lastName || "",
    contactNumber: data.contactNumber || "",
    address: data.address || "",
    accountType: data.accountType || "individual",
    householdName: data.householdName || "",
    paymentSchedule: data.paymentSchedule || "flexible",
    trustStatus: data.trustStatus || "trusted",
    communityNotes: data.communityNotes || "",
    createdAt: data.createdAt || null,
    currentBalance: Number(data.currentBalance || 0),
    totalBorrowings: Number(data.totalBorrowings || 0),
    totalPayments: Number(data.totalPayments || 0),
    transactionCount: Number(data.transactionCount || 0),
  };
}

async function getCustomers() {
  ensureFirestore();

  const customersQuery = query(
    collection(db, CUSTOMERS_COLLECTION),
    orderBy("createdAt", "desc"),
  );
  const snapshot = await getDocs(customersQuery);

  return snapshot.docs.map(mapCustomerSnapshot);
}

async function checkDuplicateCustomer({ firstName, lastName, contactNumber, excludeId }) {
  ensureFirestore();

  const duplicateQuery = query(
    collection(db, CUSTOMERS_COLLECTION),
    where("contactNumber", "==", normalizeContactNumber(contactNumber)),
  );
  const snapshot = await getDocs(duplicateQuery);
  const normalizedFirstName = normalizeName(firstName);
  const normalizedLastName = normalizeName(lastName);

  return snapshot.docs.some((customerDoc) => {
    if (excludeId && customerDoc.id === excludeId) {
      return false;
    }

    const customer = customerDoc.data();

    return (
      customer.normalizedFirstName === normalizedFirstName &&
      customer.normalizedLastName === normalizedLastName
    );
  });
}

async function addCustomer(customer) {
  ensureFirestore();

  const duplicateExists = await checkDuplicateCustomer(customer);

  if (duplicateExists) {
    throw new Error("A customer with the same name and contact number already exists.");
  }

  const customerRef = doc(collection(db, CUSTOMERS_COLLECTION));

  await runTransaction(db, async (transaction) => {
    const customerNumber = await getNextDisplayNumber(transaction, "customers");

    transaction.set(customerRef, {
      customerNumber,
      firstName: customer.firstName.trim(),
      lastName: customer.lastName.trim(),
      contactNumber: normalizeContactNumber(customer.contactNumber),
      address: customer.address.trim(),
      accountType: customer.accountType || "individual",
      householdName: customer.householdName?.trim() || "",
      paymentSchedule: customer.paymentSchedule || "flexible",
      trustStatus: customer.trustStatus || "trusted",
      communityNotes: customer.communityNotes?.trim() || "",
      currentBalance: Number(customer.currentBalance || 0),
      totalBorrowings: Number(customer.currentBalance || 0),
      totalPayments: 0,
      transactionCount: 0,
      normalizedFirstName: normalizeName(customer.firstName),
      normalizedLastName: normalizeName(customer.lastName),
      createdAt: serverTimestamp(),
    });
  });
}

async function updateCustomer(customerId, customer) {
  ensureFirestore();

  const duplicateExists = await checkDuplicateCustomer({
    ...customer,
    excludeId: customerId,
  });

  if (duplicateExists) {
    throw new Error("A customer with the same name and contact number already exists.");
  }

  await updateDoc(doc(db, CUSTOMERS_COLLECTION, customerId), {
    firstName: customer.firstName.trim(),
    lastName: customer.lastName.trim(),
    contactNumber: normalizeContactNumber(customer.contactNumber),
    address: customer.address.trim(),
    accountType: customer.accountType || "individual",
    householdName: customer.householdName?.trim() || "",
    paymentSchedule: customer.paymentSchedule || "flexible",
    trustStatus: customer.trustStatus || "trusted",
    communityNotes: customer.communityNotes?.trim() || "",
    currentBalance: Number(customer.currentBalance || 0),
    normalizedFirstName: normalizeName(customer.firstName),
    normalizedLastName: normalizeName(customer.lastName),
  });
}

async function deleteCustomer(customerId) {
  ensureFirestore();
  await deleteDoc(doc(db, CUSTOMERS_COLLECTION, customerId));
}

export {
  addCustomer,
  deleteCustomer,
  getCustomers,
  normalizeContactNumber,
  updateCustomer,
};
