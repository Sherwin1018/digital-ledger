import { useEffect, useMemo, useState } from "react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import {
  CalendarRange,
  FileSpreadsheet,
  FileText,
  Printer,
  ReceiptText,
  WalletCards,
} from "lucide-react";
import DashboardLayout from "../../components/layout/DashboardLayout";
import { firebaseConfigError } from "../../firebase/firebase";
import { getCustomers } from "../../services/customersService";
import { getDebts } from "../../services/debtsService";
import { getPayments } from "../../services/paymentsService";
import { getFirebaseErrorMessage } from "../../utils/firebaseError";

const reportOptions = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "yearly", label: "Yearly" },
];

function formatCurrency(value) {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
  }).format(Number(value || 0));
}

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

function formatDate(timestamp) {
  const date = getJsDate(timestamp);

  if (!date) {
    return "Invalid date";
  }

  return new Intl.DateTimeFormat("en-PH", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}

function getRangeBounds(type) {
  const now = new Date();
  let start;
  let end;

  if (type === "daily") {
    start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  } else if (type === "weekly") {
    const day = now.getDay();
    const distanceFromMonday = (day + 6) % 7;
    start = new Date(now);
    start.setDate(now.getDate() - distanceFromMonday);
    start.setHours(0, 0, 0, 0);
    end = new Date(start);
    end.setDate(start.getDate() + 6);
    end.setHours(23, 59, 59, 999);
  } else if (type === "monthly") {
    start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  } else {
    start = new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0);
    end = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
  }

  return { start, end };
}

function isWithinRange(timestamp, range) {
  const date = getJsDate(timestamp);
  return date && date >= range.start && date <= range.end;
}

function Reports() {
  const [customers, setCustomers] = useState([]);
  const [debts, setDebts] = useState([]);
  const [payments, setPayments] = useState([]);
  const [reportType, setReportType] = useState("daily");
  const [loading, setLoading] = useState(!firebaseConfigError);
  const [error, setError] = useState("");

  useEffect(() => {
    if (firebaseConfigError) {
      setLoading(false);
      return;
    }

    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    setError("");

    try {
      const [nextCustomers, nextDebts, nextPayments] = await Promise.all([
        getCustomers(),
        getDebts(),
        getPayments(),
      ]);

      setCustomers(nextCustomers);
      setDebts(nextDebts);
      setPayments(nextPayments);
    } catch (nextError) {
      setError(getFirebaseErrorMessage(nextError, "Failed to load reports data."));
    } finally {
      setLoading(false);
    }
  }

  const reportData = useMemo(() => {
    const range = getRangeBounds(reportType);
    const filteredDebts = debts.filter((debt) => isWithinRange(debt.date, range));
    const filteredPayments = payments.filter((payment) => isWithinRange(payment.date, range));
    const totalDebt = filteredDebts.reduce((sum, debt) => sum + Number(debt.total || 0), 0);
    const totalPayments = filteredPayments.reduce(
      (sum, payment) => sum + Number(payment.amount || 0),
      0,
    );
    const outstandingBalance = customers.reduce(
      (sum, customer) => sum + Number(customer.currentBalance || 0),
      0,
    );
    const transactions = [
      ...filteredDebts.map((debt) => ({
        id: debt.id,
        type: "Debt",
        transactionId: debt.transactionId,
        customerName: debt.customerName,
        amount: Number(debt.total || 0),
        balanceAfter: Number(debt.runningBalance || 0),
        date: debt.date,
        remarks: debt.remarks || debt.product || "-",
      })),
      ...filteredPayments.map((payment) => ({
        id: payment.id,
        type: "Payment",
        transactionId: payment.transactionId,
        customerName: payment.customerName,
        amount: Number(payment.amount || 0),
        balanceAfter: Number(payment.remainingBalance || 0),
        date: payment.date,
        remarks: payment.remarks || "-",
      })),
    ].sort((left, right) => {
      const leftDate = getJsDate(left.date)?.getTime() || 0;
      const rightDate = getJsDate(right.date)?.getTime() || 0;
      return rightDate - leftDate;
    });

    return {
      range,
      filteredDebts,
      filteredPayments,
      totalDebt,
      totalPayments,
      outstandingBalance,
      transactions,
    };
  }, [customers, debts, payments, reportType]);

  const reportRows = reportData.transactions.map((item) => [
    item.type,
    item.transactionId,
    item.customerName,
    formatCurrency(item.amount),
    formatCurrency(item.balanceAfter),
    formatDate(item.date),
    item.remarks,
  ]);

  const rangeLabel = `${formatDate(reportData.range.start)} - ${formatDate(reportData.range.end)}`;

  function handleExcelExport() {
    const workbook = XLSX.utils.book_new();
    const sheetData = [
      ["Report Type", reportOptions.find((item) => item.value === reportType)?.label || reportType],
      ["Range", rangeLabel],
      [],
      ["Metric", "Value"],
      ["Total Debt", reportData.totalDebt],
      ["Total Payments", reportData.totalPayments],
      ["Outstanding Balance", reportData.outstandingBalance],
      ["Transactions", reportData.transactions.length],
      [],
      ["Type", "Transaction ID", "Customer", "Amount", "Balance After", "Date", "Remarks"],
      ...reportData.transactions.map((item) => [
        item.type,
        item.transactionId,
        item.customerName,
        Number(item.amount || 0),
        Number(item.balanceAfter || 0),
        formatDate(item.date),
        item.remarks,
      ]),
    ];

    const worksheet = XLSX.utils.aoa_to_sheet(sheetData);
    XLSX.utils.book_append_sheet(workbook, worksheet, "Reports");
    XLSX.writeFile(workbook, `digital-ledger-${reportType}-report.xlsx`);
  }

  function handlePdfExport() {
    const document = new jsPDF();
    document.setFontSize(18);
    document.text("Digital Ledger Report", 14, 18);
    document.setFontSize(11);
    document.text(`Type: ${reportOptions.find((item) => item.value === reportType)?.label}`, 14, 28);
    document.text(`Range: ${rangeLabel}`, 14, 35);
    document.text(`Total Debt: ${formatCurrency(reportData.totalDebt)}`, 14, 45);
    document.text(`Total Payments: ${formatCurrency(reportData.totalPayments)}`, 14, 52);
    document.text(`Outstanding Balance: ${formatCurrency(reportData.outstandingBalance)}`, 14, 59);

    autoTable(document, {
      startY: 70,
      head: [["Type", "Transaction ID", "Customer", "Amount", "Balance After", "Date", "Remarks"]],
      body: reportRows,
      styles: { fontSize: 8 },
      headStyles: { fillColor: [6, 182, 212] },
    });

    document.save(`digital-ledger-${reportType}-report.pdf`);
  }

  function handlePrint() {
    const printWindow = window.open("", "_blank", "width=1200,height=800");

    if (!printWindow) {
      return;
    }

    const rows = reportData.transactions
      .map(
        (item) => `
          <tr>
            <td>${item.type}</td>
            <td>${item.transactionId}</td>
            <td>${item.customerName}</td>
            <td>${formatCurrency(item.amount)}</td>
            <td>${formatCurrency(item.balanceAfter)}</td>
            <td>${formatDate(item.date)}</td>
            <td>${item.remarks}</td>
          </tr>
        `,
      )
      .join("");

    printWindow.document.write(`
      <html>
        <head>
          <title>Digital Ledger Report</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 24px; color: #0f172a; }
            h1 { margin-bottom: 8px; }
            p { margin: 4px 0; }
            .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 24px 0; }
            .card { border: 1px solid #cbd5e1; border-radius: 12px; padding: 12px; }
            table { width: 100%; border-collapse: collapse; margin-top: 20px; }
            th, td { border: 1px solid #cbd5e1; padding: 8px; text-align: left; font-size: 12px; }
            th { background: #e2e8f0; }
          </style>
        </head>
        <body>
          <h1>Digital Ledger Report</h1>
          <p><strong>Type:</strong> ${reportOptions.find((item) => item.value === reportType)?.label}</p>
          <p><strong>Range:</strong> ${rangeLabel}</p>
          <div class="grid">
            <div class="card"><strong>Total Debt</strong><br />${formatCurrency(reportData.totalDebt)}</div>
            <div class="card"><strong>Total Payments</strong><br />${formatCurrency(reportData.totalPayments)}</div>
            <div class="card"><strong>Outstanding Balance</strong><br />${formatCurrency(reportData.outstandingBalance)}</div>
            <div class="card"><strong>Transactions</strong><br />${reportData.transactions.length}</div>
          </div>
          <table>
            <thead>
              <tr>
                <th>Type</th>
                <th>Transaction ID</th>
                <th>Customer</th>
                <th>Amount</th>
                <th>Balance After</th>
                <th>Date</th>
                <th>Remarks</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <section className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
            <CalendarRange size={18} className="text-slate-400" />
            <select
              value={reportType}
              onChange={(event) => setReportType(event.target.value)}
              className="bg-transparent text-sm font-medium text-slate-700 outline-none"
            >
              {reportOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            onClick={handlePdfExport}
            disabled={loading || Boolean(firebaseConfigError)}
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-red-500 px-4 py-3 font-semibold text-white transition hover:bg-red-400 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <FileText size={18} />
            PDF
          </button>

          <button
            type="button"
            onClick={handleExcelExport}
            disabled={loading || Boolean(firebaseConfigError)}
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-500 px-4 py-3 font-semibold text-white transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <FileSpreadsheet size={18} />
            Excel
          </button>

          <button
            type="button"
            onClick={handlePrint}
            disabled={loading || Boolean(firebaseConfigError)}
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-900 px-4 py-3 font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Printer size={18} />
            Print
          </button>
        </section>

        {firebaseConfigError && (
          <div className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Firebase is not configured yet. Create `.env.local`, add your Firebase
            values, and restart the dev server before generating reports.
          </div>
        )}

        {error && (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <section className="grid gap-4 md:grid-cols-4">
          <article className="rounded-3xl bg-white p-5 shadow-md">
            <p className="text-sm text-slate-500">Total Debt</p>
            <p className="mt-3 text-3xl font-bold text-slate-900">
              {formatCurrency(reportData.totalDebt)}
            </p>
          </article>
          <article className="rounded-3xl bg-white p-5 shadow-md">
            <p className="text-sm text-slate-500">Total Payments</p>
            <p className="mt-3 text-3xl font-bold text-slate-900">
              {formatCurrency(reportData.totalPayments)}
            </p>
          </article>
          <article className="rounded-3xl bg-white p-5 shadow-md">
            <p className="text-sm text-slate-500">Outstanding Balance</p>
            <p className="mt-3 text-3xl font-bold text-slate-900">
              {formatCurrency(reportData.outstandingBalance)}
            </p>
          </article>
          <article className="rounded-3xl bg-white p-5 shadow-md">
            <p className="text-sm text-slate-500">Transactions</p>
            <p className="mt-3 text-3xl font-bold text-slate-900">
              {reportData.transactions.length}
            </p>
          </article>
        </section>

        <section className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
          <article className="rounded-3xl bg-white p-6 shadow-md">
            <h2 className="text-xl font-bold text-slate-900">Report Transactions</h2>
            <p className="mt-1 text-sm text-slate-500">Range: {rangeLabel}</p>

            <div className="mt-5 overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200">
                <thead className="bg-slate-50">
                  <tr className="text-left text-sm font-semibold text-slate-600">
                    <th className="px-4 py-3">Type</th>
                    <th className="px-4 py-3">Transaction ID</th>
                    <th className="px-4 py-3">Customer</th>
                    <th className="px-4 py-3">Amount</th>
                    <th className="px-4 py-3">Balance After</th>
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Remarks</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white text-sm">
                  {loading ? (
                    <tr>
                      <td className="px-4 py-6 text-slate-500" colSpan="7">
                        Loading report transactions...
                      </td>
                    </tr>
                  ) : reportData.transactions.length === 0 ? (
                    <tr>
                      <td className="px-4 py-6 text-slate-500" colSpan="7">
                        No transactions found for this period.
                      </td>
                    </tr>
                  ) : (
                    reportData.transactions.map((item) => (
                      <tr key={`${item.type}-${item.id}`}>
                        <td className="px-4 py-3">
                          <span
                            className={`rounded-full px-3 py-1 text-xs font-semibold ${
                              item.type === "Debt"
                                ? "bg-amber-100 text-amber-700"
                                : "bg-emerald-100 text-emerald-700"
                            }`}
                          >
                            {item.type}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-slate-500">
                          {item.transactionId}
                        </td>
                        <td className="px-4 py-3 font-medium text-slate-900">
                          {item.customerName}
                        </td>
                        <td className="px-4 py-3">{formatCurrency(item.amount)}</td>
                        <td className="px-4 py-3">{formatCurrency(item.balanceAfter)}</td>
                        <td className="px-4 py-3">{formatDate(item.date)}</td>
                        <td className="px-4 py-3">{item.remarks}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </article>

          <article className="space-y-6">
            <div className="rounded-3xl bg-white p-6 shadow-md">
              <div className="flex items-center gap-3">
                <div className="rounded-2xl bg-cyan-100 p-3 text-cyan-700">
                  <ReceiptText size={20} />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-slate-900">Collections Snapshot</h2>
                  <p className="text-sm text-slate-500">Debt vs payment totals for the selected period.</p>
                </div>
              </div>

              <div className="mt-5 space-y-4">
                <div>
                  <div className="mb-2 flex items-center justify-between text-sm">
                    <span className="text-slate-600">Debt Recorded</span>
                    <span className="font-semibold text-slate-900">
                      {formatCurrency(reportData.totalDebt)}
                    </span>
                  </div>
                  <div className="h-3 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-amber-400"
                      style={{
                        width: `${Math.min(
                          (reportData.totalDebt /
                            Math.max(reportData.totalDebt, reportData.totalPayments, 1)) *
                            100,
                          100,
                        )}%`,
                      }}
                    />
                  </div>
                </div>

                <div>
                  <div className="mb-2 flex items-center justify-between text-sm">
                    <span className="text-slate-600">Payments Collected</span>
                    <span className="font-semibold text-slate-900">
                      {formatCurrency(reportData.totalPayments)}
                    </span>
                  </div>
                  <div className="h-3 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-emerald-400"
                      style={{
                        width: `${Math.min(
                          (reportData.totalPayments /
                            Math.max(reportData.totalDebt, reportData.totalPayments, 1)) *
                            100,
                          100,
                        )}%`,
                      }}
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-3xl bg-white p-6 shadow-md">
              <div className="flex items-center gap-3">
                <div className="rounded-2xl bg-violet-100 p-3 text-violet-700">
                  <WalletCards size={20} />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-slate-900">Period Summary</h2>
                  <p className="text-sm text-slate-500">Quick counts for the current report range.</p>
                </div>
              </div>

              <div className="mt-5 space-y-3">
                <div className="flex items-center justify-between rounded-2xl bg-slate-50 px-4 py-3">
                  <span className="text-sm text-slate-600">Debt Entries</span>
                  <span className="font-semibold text-slate-900">
                    {reportData.filteredDebts.length}
                  </span>
                </div>
                <div className="flex items-center justify-between rounded-2xl bg-slate-50 px-4 py-3">
                  <span className="text-sm text-slate-600">Payment Entries</span>
                  <span className="font-semibold text-slate-900">
                    {reportData.filteredPayments.length}
                  </span>
                </div>
                <div className="flex items-center justify-between rounded-2xl bg-slate-50 px-4 py-3">
                  <span className="text-sm text-slate-600">Customers in System</span>
                  <span className="font-semibold text-slate-900">{customers.length}</span>
                </div>
              </div>
            </div>
          </article>
        </section>
      </div>
    </DashboardLayout>
  );
}

export default Reports;
