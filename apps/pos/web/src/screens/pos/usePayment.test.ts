import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { usePayment } from "./usePayment";

type Props = { total: number; isWalkInSelected: boolean; walletBalance: number };

const setup = (props: Partial<Props> = {}) => {
  const hook = renderHook((p: Props) => usePayment(p), {
    initialProps: { total: 450, isWalkInSelected: true, walletBalance: 0, ...props },
  });
  act(() => hook.result.current.start());
  return hook;
};

/** Types an amount on the keypad (after clearing it), as a cashier would. */
const type = (hook: ReturnType<typeof setup>, amount: string) => {
  act(() => hook.result.current.press("C"));
  for (const key of amount) act(() => hook.result.current.press(key));
};

describe("payment dialog", () => {
  it("opens with the whole total ready as cash, which settles a walk-in sale", () => {
    const hook = setup();
    expect(hook.result.current.amount).toBe("450.00");
    act(() => hook.result.current.applyLine());
    expect(hook.result.current.lines).toEqual([{ mode: "CASH", amount: 450 }]);
    expect(hook.result.current.canValidate).toBe(true);
    expect(hook.result.current.changeAmount).toBe(0);
  });

  it("takes a larger note as cash tendered and works out the change", () => {
    const hook = setup();
    type(hook, "500");
    act(() => hook.result.current.applyLine());
    expect(hook.result.current.lines).toEqual([{ mode: "CASH", amount: 450, tendered: 500 }]);
    expect(hook.result.current.changeAmount).toBe(50);
    expect(hook.result.current.matchesTotal).toBe(true);
  });

  it("splits a bill between card and cash, offering what is left", () => {
    const hook = setup();
    act(() => hook.result.current.setMethod("CARD"));
    type(hook, "200");
    act(() => hook.result.current.applyLine());
    expect(hook.result.current.amount).toBe("250.00");
    expect(hook.result.current.canValidate).toBe(false);
    act(() => hook.result.current.setMethod("CASH"));
    act(() => hook.result.current.applyLine());
    expect(hook.result.current.remainingAmount).toBe(0);
    expect(hook.result.current.canValidate).toBe(true);
  });

  it("refuses a card or UPI payment above what is due", () => {
    const hook = setup();
    act(() => hook.result.current.setMethod("UPI"));
    type(hook, "500");
    act(() => hook.result.current.applyLine());
    expect(hook.result.current.lines).toEqual([]);
    expect(hook.result.current.error).toMatch(/exceeds remaining/);
  });

  it("refuses more cash once nothing is left to pay", () => {
    const hook = setup();
    act(() => hook.result.current.setMethod("CARD"));
    act(() => hook.result.current.applyLine());
    act(() => hook.result.current.setMethod("CASH"));
    type(hook, "100");
    act(() => hook.result.current.applyLine());
    expect(hook.result.current.lines).toEqual([{ mode: "CARD", amount: 450 }]);
    expect(hook.result.current.error).toMatch(/Nothing is left/);
  });

  it("limits a wallet payment to the balance", () => {
    const hook = setup({ isWalkInSelected: false, walletBalance: 100 });
    act(() => hook.result.current.setMethod("WALLET"));
    type(hook, "150");
    act(() => hook.result.current.applyLine());
    expect(hook.result.current.lines).toEqual([]);
    expect(hook.result.current.error).toMatch(/insufficient/);
    type(hook, "100");
    act(() => hook.result.current.applyLine());
    expect(hook.result.current.lines).toEqual([{ mode: "WALLET", amount: 100 }]);
    // A customer may leave the rest on credit.
    expect(hook.result.current.canValidate).toBe(true);
  });

  it("can put a customer's extra cash into their wallet instead of giving change", () => {
    const hook = setup({ isWalkInSelected: false });
    act(() => hook.result.current.setCashExcessTo("WALLET"));
    type(hook, "500");
    act(() => hook.result.current.applyLine());
    expect(hook.result.current.lines).toEqual([{ mode: "CASH", amount: 500 }]);
    expect(hook.result.current.excessAmount).toBe(50);
    expect(hook.result.current.changeAmount).toBe(0);
  });

  it("drops wallet payments and credit when the customer becomes a walk-in", () => {
    const hook = setup({ isWalkInSelected: false, walletBalance: 1000 });
    act(() => hook.result.current.setMethod("WALLET"));
    type(hook, "50");
    act(() => hook.result.current.applyLine());
    hook.rerender({ total: 450, isWalkInSelected: true, walletBalance: 1000 });
    expect(hook.result.current.lines).toEqual([]);
    expect(hook.result.current.method).toBe("CASH");
    expect(hook.result.current.availableMethods.map((m) => m.key)).toEqual(["CASH", "CARD", "UPI"]);
  });

  it("edits the typed amount on the keypad", () => {
    const hook = setup();
    type(hook, "12");
    act(() => hook.result.current.press("."));
    act(() => hook.result.current.press("5"));
    act(() => hook.result.current.press("."));
    expect(hook.result.current.amount).toBe("12.5");
    act(() => hook.result.current.press("<"));
    act(() => hook.result.current.press("+100"));
    expect(hook.result.current.amount).toBe("112");
  });
});
