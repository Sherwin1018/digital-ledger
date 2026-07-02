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

function getTime(timestamp) {
  return getJsDate(timestamp)?.getTime() || 0;
}

function roundCurrency(value) {
  return Number(Number(value || 0).toFixed(2));
}

function isLegacyCustomerPayment(payment) {
  return (
    !payment.debtId &&
    !String(payment.debtTransactionId || "").startsWith("DT-") &&
    !String(payment.transactionId || "").startsWith("DT-")
  );
}

function reconcileLedger(debts, payments) {
  const debtCopies = debts
    .filter((debt) => !debt.voided)
    .map((debt) => ({
      ...debt,
      remainingBalance: roundCurrency(debt.remainingBalance ?? debt.total ?? 0),
    }));
  const debtById = new Map(debtCopies.map((debt) => [debt.id, debt]));
  const debtsByCustomer = debtCopies.reduce((groups, debt) => {
    const nextGroups = groups;
    const customerDebts = nextGroups.get(debt.customerId) || [];

    customerDebts.push(debt);
    nextGroups.set(debt.customerId, customerDebts);

    return nextGroups;
  }, new Map());

  debtsByCustomer.forEach((customerDebts) => {
    customerDebts.sort((left, right) => getTime(left.date) - getTime(right.date));
  });

  const paymentCopies = [...payments]
    .filter((payment) => !payment.voided)
    .sort((left, right) => getTime(left.date) - getTime(right.date))
    .map((payment) => {
      if (Array.isArray(payment.debtAllocations) && payment.debtAllocations.length > 0) {
        return {
          ...payment,
          transactionId:
            payment.transactionId ||
            (payment.debtAllocations.length > 1
              ? `${payment.debtAllocations[0].transactionId} +${payment.debtAllocations.length - 1}`
              : payment.debtAllocations[0].transactionId),
          debtTransactionId:
            payment.debtTransactionId ||
            payment.transactionId ||
            payment.debtAllocations[0].transactionId,
        };
      }

      if (!isLegacyCustomerPayment(payment)) {
        const linkedDebt = debtById.get(payment.debtId);

        return {
          ...payment,
          transactionId:
            payment.transactionId ||
            payment.debtTransactionId ||
            linkedDebt?.transactionId ||
            "",
          debtTransactionId:
            payment.debtTransactionId ||
            payment.transactionId ||
            linkedDebt?.transactionId ||
            "",
          debtAllocations: payment.debtId
            ? [
                {
                  debtId: payment.debtId,
                  transactionId:
                    payment.transactionId ||
                    payment.debtTransactionId ||
                    linkedDebt?.transactionId ||
                    "",
                  amount: Number(payment.amount || 0),
                  remainingBalanceAfter: Number(payment.remainingBalance || 0),
                },
              ]
            : [],
        };
      }

      let unappliedAmount = roundCurrency(payment.amount);
      const allocations = [];
      const customerDebts = debtsByCustomer.get(payment.customerId) || [];

      customerDebts.forEach((debt) => {
        if (unappliedAmount <= 0 || Number(debt.remainingBalance || 0) <= 0) {
          return;
        }

        const amount = Math.min(unappliedAmount, Number(debt.remainingBalance || 0));
        const remainingBalanceAfter = roundCurrency(debt.remainingBalance - amount);

        debt.remainingBalance = remainingBalanceAfter;
        debt.status = remainingBalanceAfter <= 0 ? "PAID" : "UNPAID";
        unappliedAmount = roundCurrency(unappliedAmount - amount);

        allocations.push({
          debtId: debt.id,
          transactionId: debt.transactionId,
          amount,
          remainingBalanceAfter,
        });
      });

      const firstAllocation = allocations[0];
      const transactionId =
        allocations.length > 1
          ? `${firstAllocation.transactionId} +${allocations.length - 1}`
          : firstAllocation?.transactionId || payment.transactionId || "";

      return {
        ...payment,
        debtId: firstAllocation?.debtId || payment.debtId || "",
        transactionId,
        debtTransactionId: transactionId,
        debtAllocations: allocations,
        previousBalance: firstAllocation
          ? roundCurrency(firstAllocation.remainingBalanceAfter + firstAllocation.amount)
          : payment.previousBalance,
        remainingBalance: firstAllocation
          ? firstAllocation.remainingBalanceAfter
          : payment.remainingBalance,
        status:
          firstAllocation && firstAllocation.remainingBalanceAfter <= 0 ? "PAID" : payment.status,
      };
    });

  return {
    debts: debtCopies.map((debt) => ({
      ...debt,
      status: Number(debt.remainingBalance || 0) <= 0 ? "PAID" : "UNPAID",
    })),
    payments: paymentCopies.sort((left, right) => getTime(right.date) - getTime(left.date)),
  };
}

export { reconcileLedger };
