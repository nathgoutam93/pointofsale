import { CASHIER_PERMISSION_LABELS, CASHIER_PERMISSIONS, type CashierPermission } from "@pos/contracts";
import { useIsOffline } from "../../lib/mode";

/** What a cashier may do beyond selling (Settings → Cashiers & Access); admins can do it all. */
export function CashierPermissions({
  value,
  onChange,
  disabled = false,
}: {
  value: readonly CashierPermission[];
  onChange: (next: CashierPermission[]) => void;
  disabled?: boolean;
}) {
  const offline = useIsOffline();
  // Transfers are between branches of an online business.
  const shown = CASHIER_PERMISSIONS.filter((permission) => !(offline && permission === "SEND_TRANSFERS"));
  return (
    <div className="rounded border border-slate-200 p-2">
      <p className="text-xs font-semibold text-slate-600">Also allowed to</p>
      <div className="mt-2 grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
        {shown.map((permission) => {
          const { label, detail } = CASHIER_PERMISSION_LABELS[permission];
          return (
            <label key={permission} className="flex items-start gap-1.5 text-xs" title={detail}>
              <input
                type="checkbox"
                className="mt-0.5"
                checked={value.includes(permission)}
                disabled={disabled}
                onChange={(event) =>
                  onChange(event.target.checked ? [...value, permission] : value.filter((entry) => entry !== permission))
                }
              />
              <span>
                <span className="font-medium text-slate-800">{label}</span>
                <span className="block text-slate-500">{detail}</span>
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
