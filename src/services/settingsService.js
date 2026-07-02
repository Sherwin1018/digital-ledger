import {
  Timestamp,
  collection,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  writeBatch,
} from "firebase/firestore";
import { db, firebaseConfigError } from "../firebase/firebase";
import { normalizePhilippineMobileNumber } from "../utils/philippineMobileNumber";

const SETTINGS_COLLECTION = "settings";
const STORE_PROFILE_DOCUMENT = "storeProfile";
const ADMIN_PROFILE_DOCUMENT = "adminProfile";
const BACKUP_COLLECTIONS = ["customers", "debts", "payments", "auditTrail", "systemCounters"];

function ensureFirestore() {
  if (!db) {
    throw new Error(
      firebaseConfigError || "Firestore is unavailable because Firebase is not configured.",
    );
  }
}

function normalizeContactNumber(value) {
  return normalizePhilippineMobileNumber(value);
}

function serializeValue(value) {
  if (value && typeof value.toDate === "function") {
    return {
      __type: "timestamp",
      value: value.toDate().toISOString(),
    };
  }

  if (Array.isArray(value)) {
    return value.map(serializeValue);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [key, serializeValue(nestedValue)]),
    );
  }

  return value;
}

function deserializeValue(value) {
  if (Array.isArray(value)) {
    return value.map(deserializeValue);
  }

  if (value && typeof value === "object") {
    if (value.__type === "timestamp" && value.value) {
      return Timestamp.fromDate(new Date(value.value));
    }

    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [key, deserializeValue(nestedValue)]),
    );
  }

  return value;
}

function getDefaultSettings() {
  return {
    storeName: "",
    storeAddress: "",
    contactNumber: "",
    updatedAt: null,
  };
}

async function getStoreSettings() {
  ensureFirestore();

  const settingsRef = doc(db, SETTINGS_COLLECTION, STORE_PROFILE_DOCUMENT);
  const snapshot = await getDoc(settingsRef);

  if (!snapshot.exists()) {
    return getDefaultSettings();
  }

  const data = snapshot.data();

  return {
    storeName: data.storeName || "",
    storeAddress: data.storeAddress || "",
    contactNumber: data.contactNumber || "",
    updatedAt: data.updatedAt || null,
  };
}

async function saveStoreSettings(settings, adminUser) {
  ensureFirestore();

  const settingsRef = doc(db, SETTINGS_COLLECTION, STORE_PROFILE_DOCUMENT);

  await setDoc(
    settingsRef,
    {
      storeName: settings.storeName.trim(),
      storeAddress: settings.storeAddress.trim(),
      contactNumber: normalizeContactNumber(settings.contactNumber),
      updatedAt: serverTimestamp(),
      updatedBy: adminUser?.uid || "",
      updatedByEmail: adminUser?.email || "",
      createdAt: Timestamp.now(),
    },
    { merge: true },
  );
}

async function createBackupSnapshot() {
  ensureFirestore();

  const collectionSnapshots = await Promise.all(
    BACKUP_COLLECTIONS.map(async (collectionName) => {
      const snapshot = await getDocs(collection(db, collectionName));

      return [
        collectionName,
        snapshot.docs.map((item) => ({
          id: item.id,
          data: serializeValue(item.data()),
        })),
      ];
    }),
  );

  const settingsDocs = await Promise.all([
    getDoc(doc(db, SETTINGS_COLLECTION, STORE_PROFILE_DOCUMENT)),
    getDoc(doc(db, SETTINGS_COLLECTION, ADMIN_PROFILE_DOCUMENT)),
  ]);

  return {
    metadata: {
      app: "digital-ledger",
      version: 1,
      exportedAt: new Date().toISOString(),
    },
    collections: Object.fromEntries(collectionSnapshots),
    settings: {
      storeProfile: settingsDocs[0].exists()
        ? serializeValue(settingsDocs[0].data())
        : null,
      adminProfile: settingsDocs[1].exists()
        ? serializeValue(settingsDocs[1].data())
        : null,
    },
  };
}

function validateBackupSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") {
    throw new Error("The selected backup file is invalid.");
  }

  if (snapshot.metadata?.app !== "digital-ledger") {
    throw new Error("This backup file does not belong to Digital Ledger.");
  }

  if (!snapshot.collections || typeof snapshot.collections !== "object") {
    throw new Error("The backup file is missing collection data.");
  }
}

async function restoreBackupSnapshot(snapshot) {
  ensureFirestore();
  validateBackupSnapshot(snapshot);

  const deleteBatch = writeBatch(db);

  for (const collectionName of BACKUP_COLLECTIONS) {
    const existingSnapshot = await getDocs(collection(db, collectionName));

    existingSnapshot.docs.forEach((item) => {
      deleteBatch.delete(doc(db, collectionName, item.id));
    });
  }

  deleteBatch.delete(doc(db, SETTINGS_COLLECTION, STORE_PROFILE_DOCUMENT));
  deleteBatch.delete(doc(db, SETTINGS_COLLECTION, ADMIN_PROFILE_DOCUMENT));
  await deleteBatch.commit();

  const writeBatchOperation = writeBatch(db);

  for (const collectionName of BACKUP_COLLECTIONS) {
    const entries = Array.isArray(snapshot.collections[collectionName])
      ? snapshot.collections[collectionName]
      : [];

    entries.forEach((entry) => {
      writeBatchOperation.set(
        doc(db, collectionName, entry.id),
        deserializeValue(entry.data || {}),
      );
    });
  }

  if (snapshot.settings?.storeProfile) {
    writeBatchOperation.set(
      doc(db, SETTINGS_COLLECTION, STORE_PROFILE_DOCUMENT),
      deserializeValue(snapshot.settings.storeProfile),
    );
  }

  if (snapshot.settings?.adminProfile) {
    writeBatchOperation.set(
      doc(db, SETTINGS_COLLECTION, ADMIN_PROFILE_DOCUMENT),
      deserializeValue(snapshot.settings.adminProfile),
    );
  }

  await writeBatchOperation.commit();
}

export {
  createBackupSnapshot,
  getStoreSettings,
  normalizeContactNumber,
  restoreBackupSnapshot,
  saveStoreSettings,
};
