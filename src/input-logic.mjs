export function updateInputText(current, key, maximumLength = 5) {
  if (key === "⌫" || key === "BACKSPACE") return current.slice(0, -1);
  if (/^[A-Z]$/.test(key) && current.length < maximumLength) {
    return current + key;
  }
  return current;
}
