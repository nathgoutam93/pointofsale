import { getSession } from "../lib/session";

/**
 * Admins with more than one branch pick which one a management screen shows; for everyone
 * else it shows nothing (cashiers work at their register's branch).
 */
export function BranchPicker({ value, onChange, className = "w-64" }: { value: string | null; onChange: (branchId: string) => void; className?: string }) {
  const session = getSession();
  if (!session || session.role !== "ADMIN" || session.branches.length < 2) return null;
  return (
    <div className={className}>
      <label className="field-label" htmlFor="managed-branch">Branch</label>
      <select id="managed-branch" className="field" value={value ?? ""} onChange={(event) => onChange(event.target.value)}>
        {session.branches.map((branch) => (
          <option key={branch.id} value={branch.id}>
            {branch.name} ({branch.code})
          </option>
        ))}
      </select>
    </div>
  );
}
