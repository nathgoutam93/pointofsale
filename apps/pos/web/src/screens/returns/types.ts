// Shapes used by the Returns screen and its parts.

export type ReturnRefundMode = "CASH" | "WALLET";

/** A line of the bill being returned against: what can still come back, and what is coming back. */
export type ReturnLine = {
  lineId: string;
  itemId: string;
  itemName: string;
  soldQty: number;
  alreadyReturned: number;
  availableQty: number;
  leastCount: number;
  leastCountStep: string;
  rate: number;
  returnQty: number;
  amount: number;
};
