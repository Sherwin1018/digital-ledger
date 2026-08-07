function PaginationControls({ page, pageSize, totalItems, onPageChange }) {
  const totalPages = Math.max(Math.ceil(totalItems / pageSize), 1);
  const startItem = totalItems === 0 ? 0 : (page - 1) * pageSize + 1;
  const endItem = Math.min(page * pageSize, totalItems);

  if (totalItems <= pageSize) {
    return null;
  }

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600 shadow-sm sm:flex-row sm:items-center sm:justify-between">
      <span className="text-center sm:text-left">
        Showing {startItem}-{endItem} of {totalItems}
      </span>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 sm:flex">
        <button
          type="button"
          onClick={() => onPageChange(Math.max(page - 1, 1))}
          disabled={page <= 1}
          className="min-h-11 rounded-xl border border-slate-200 px-4 py-2 font-semibold text-slate-600 transition hover:border-cyan-200 hover:bg-cyan-50 hover:text-cyan-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Prev
        </button>
        <span className="rounded-xl bg-slate-100 px-3 py-2 font-semibold text-slate-700">
          {page} / {totalPages}
        </span>
        <button
          type="button"
          onClick={() => onPageChange(Math.min(page + 1, totalPages))}
          disabled={page >= totalPages}
          className="min-h-11 rounded-xl border border-slate-200 px-4 py-2 font-semibold text-slate-600 transition hover:border-cyan-200 hover:bg-cyan-50 hover:text-cyan-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Next
        </button>
      </div>
    </div>
  );
}

export default PaginationControls;
