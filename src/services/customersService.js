import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { db, firebaseConfigError } from "../firebase/firebase";

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
  return value.replace(/[^\d+]/g, "");
}

function mapCustomerSnapshot(snapshot) {
  const data = snapshot.data();

  return {
    id: snapshot.id,
    firstName: data.firstName || "",
    lastName: data.lastName || "",
    contactNumber: data.contactNumber || "",
    address: data.address || "",
    createdAt: data.createdAt || null,
    currentBalance: Number(data.currentBalance || 0),
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

  await addDoc(collection(db, CUSTOMERS_COLLECTION), {
    firstName: customer.firstName.trim(),
    lastName: customer.lastName.trim(),
    contactNumber: normalizeContactNumber(customer.contactNumber),
    address: customer.address.trim(),
    currentBalance: Number(customer.currentBalance || 0),
    normalizedFirstName: normalizeName(customer.firstName),
    normalizedLastName: normalizeName(customer.lastName),
    createdAt: serverTimestamp(),
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
