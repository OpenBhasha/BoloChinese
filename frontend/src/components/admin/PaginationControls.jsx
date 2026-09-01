export default function PaginationControls({ currentPage, totalPages, onPrev, onNext, className = "" }) {
  return (
    <div className={`flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4 justify-between px-4 py-3 border-t border-[#d2dad0] ${className}`}>
      <span className="text-xs text-black/60">
        Page {currentPage} of {totalPages}
      </span>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onPrev}
          disabled={currentPage <= 1}
          className="px-3 py-1.5 rounded border border-[#c3cdc0] text-xs font-semibold text-black/70 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-white"
        >
          Previous
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={currentPage >= totalPages}
          className="px-3 py-1.5 rounded border border-[#c3cdc0] text-xs font-semibold text-black/70 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-white"
        >
          Next
        </button>
      </div>
    </div>
  );
}
