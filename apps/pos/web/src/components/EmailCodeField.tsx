/**
 * The code the server emailed to an owner's address the first time it creates a business or
 * moves one online. "Send a new code" sends the same request again without a code.
 */
export function EmailCodeField({
  id,
  message,
  value,
  onChange,
  onResend,
  disabled,
}: {
  id: string;
  message: string;
  value: string;
  onChange: (value: string) => void;
  onResend: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="rounded-md border border-brand-200 bg-brand-50 p-3">
      <p className="text-sm text-slate-700" role="status">
        {message}
      </p>
      <label className="field-label mt-2" htmlFor={id}>
        Code from the email
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <input
          id={id}
          className="field h-10 w-40 font-mono tracking-widest"
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 8))}
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="12345678"
          required
          autoFocus
          disabled={disabled}
        />
        <button type="button" className="btn-ghost text-sm" onClick={onResend} disabled={disabled}>
          Send a new code
        </button>
      </div>
    </div>
  );
}
