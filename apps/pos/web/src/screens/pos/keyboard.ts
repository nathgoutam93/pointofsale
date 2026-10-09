// Keyboard input for the POS keypad dialogs.

export const shouldIgnoreDialogKey = (event: KeyboardEvent) => {
  const target = event.target as HTMLElement | null;
  if (!target) return false;
  const tagName = target.tagName;
  return (
    target.isContentEditable ||
    tagName === "INPUT" ||
    tagName === "TEXTAREA" ||
    tagName === "SELECT"
  );
};

export const keypadKeyFromEvent = (event: KeyboardEvent) => {
  if (/^\d$/.test(event.key)) return event.key;
  if (event.key === "." || event.key === "Decimal") return ".";
  if (event.key === "Backspace") return "<";
  if (event.key === "Delete" || event.key.toLowerCase() === "c") return "C";
  if (event.key === "-") return "+/-";
  if (event.key === "%") return "%";
  return null;
};
