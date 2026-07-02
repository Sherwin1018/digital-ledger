import { CircleDotDashed } from "lucide-react";

function FieldLabel({ children, required = false }) {
  return (
    <span className="mb-2 flex items-center gap-1 text-sm font-medium text-slate-700">
      <span>{children}</span>
      {required ? (
        <span className="text-red-500" aria-label="required">
          *
        </span>
      ) : (
        <CircleDotDashed
          size={13}
          className="text-slate-400"
          aria-label="optional"
        />
      )}
    </span>
  );
}

export default FieldLabel;
