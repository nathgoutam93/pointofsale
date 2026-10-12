/**
 * Lets the app shell ask the open screen before leaving it by other means than router
 * navigation (Logout, Close Register reload the page). The POS registers a guard that asks
 * the cashier what to do with an unsaved cart; without a guard, leaving is always allowed.
 */

type LeaveGuard = () => Promise<boolean>;

let currentGuard: LeaveGuard | null = null;

export function setLeaveGuard(guard: LeaveGuard | null) {
  currentGuard = guard;
}

/** Resolves true when it's fine to leave (the guard saved or discarded), false to stay. */
export function confirmLeave(): Promise<boolean> {
  return currentGuard ? currentGuard() : Promise.resolve(true);
}
