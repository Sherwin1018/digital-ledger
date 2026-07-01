import { getCustomers } from "./customersService";
import { getDebts } from "./debtsService";
import { getPayments } from "./paymentsService";
import { getStoreSettings } from "./settingsService";

function getJsDate(timestamp) {
  if (!timestamp) {
    return null;
  }

  if (typeof timestamp.toDate === "function") {
    return timestamp.toDate();
  }

  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? null : date;
}

function buildNotification(id, title, description, createdAt, tone = "info") {
  return {
    id,
    title,
    description,
    createdAt: createdAt || new Date(0),
    tone,
  };
}

async function getNotifications() {
  const [customers, debts, payments, settings] = await Promise.all([
    getCustomers(),
    getDebts(),
    getPayments(),
    getStoreSettings(),
  ]);

  const notifications = [];

  if (!settings.storeName || !settings.storeAddress || !settings.contactNumber) {
    notifications.push(
      buildNotification(
        "settings-incomplete",
        "Complete store settings",
        "Add your store name, address, and contact number in Settings.",
        new Date(),
        "warning",
      ),
    );
  }

  customers
    .filter((customer) => Number(customer.currentBalance || 0) > 0)
    .sort((left, right) => Number(right.currentBalance || 0) - Number(left.currentBalance || 0))
    .slice(0, 3)
    .forEach((customer) => {
      notifications.push(
        buildNotification(
          `balance-${customer.id}`,
          "Outstanding balance reminder",
          `${customer.firstName} ${customer.lastName} has an unpaid balance of ${new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(Number(customer.currentBalance || 0))}.`,
          getJsDate(customer.createdAt) || new Date(),
          "warning",
        ),
      );
    });

  debts.slice(0, 3).forEach((debt) => {
    notifications.push(
      buildNotification(
        `debt-${debt.id}`,
        "New debt recorded",
        `${debt.customerName} was charged ${new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(Number(debt.total || 0))} for ${debt.product}.`,
        getJsDate(debt.date) || new Date(),
        "info",
      ),
    );
  });

  payments.slice(0, 3).forEach((payment) => {
    notifications.push(
      buildNotification(
        `payment-${payment.id}`,
        "Payment received",
        `${payment.customerName} paid ${new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(Number(payment.amount || 0))}.`,
        getJsDate(payment.date) || new Date(),
        "success",
      ),
    );
  });

  return notifications
    .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
    .slice(0, 10);
}

export { getNotifications };
