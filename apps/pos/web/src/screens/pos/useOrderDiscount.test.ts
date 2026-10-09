import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useOrderDiscount } from "./useOrderDiscount";

describe("order discount keypad", () => {
  it("builds an amount or a percentage discount from the keys", () => {
    const { result } = renderHook(() => useOrderDiscount());
    expect(result.current.discounts).toEqual([]);
    for (const key of ["1", "5"]) act(() => result.current.press(key));
    expect(result.current.discounts).toEqual([{ type: "FIXED", value: 15 }]);
    act(() => result.current.press("%"));
    expect(result.current.discounts).toEqual([{ type: "PERCENTAGE", value: 15 }]);
    act(() => result.current.press("C"));
    expect(result.current.discounts).toEqual([]);
  });

  it("never sends a negative discount", () => {
    const { result } = renderHook(() => useOrderDiscount());
    act(() => result.current.press("5"));
    act(() => result.current.press("+/-"));
    expect(result.current.value).toBe("-5");
    expect(result.current.discounts).toEqual([]);
  });
});
