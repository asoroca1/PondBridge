const dialogStacks = new WeakMap();
const FOCUSABLE_SELECTOR = "a[href],button,input,select,textarea,[tabindex],[contenteditable='true']";

function focusableElements(dialog) {
  const view = dialog.ownerDocument.defaultView;
  return [...dialog.querySelectorAll(FOCUSABLE_SELECTOR)].filter((element) => {
    if (element.tabIndex < 0 || element.matches(":disabled")) return false;
    if (element.closest('[hidden],[inert],[aria-hidden="true"]')) return false;
    const visibility = view.getComputedStyle(element).visibility;
    return element.getClientRects().length > 0 && visibility !== "hidden" && visibility !== "collapse";
  });
}

// Shared by every modal surface so a confirmation above another dialog owns
// keyboard input until it closes. Each document has its own stack.
export function activateDialogFocus(dialog, onClose) {
  if (!dialog) return () => {};
  const doc = dialog.ownerDocument;
  const view = doc.defaultView;
  const returnFocusTo = doc.activeElement;
  const stack = dialogStacks.get(doc) || [];
  dialogStacks.set(doc, stack);
  const entry = { dialog };
  // React mounts child effects first; keep a containing dialog below its child.
  const descendantIndex = stack.findIndex((item) => dialog.contains(item.dialog));
  if (descendantIndex < 0) stack.push(entry);
  else stack.splice(descendantIndex, 0, entry);
  const isTop = () => stack[stack.length - 1] === entry;
  const focusFirst = () => (focusableElements(dialog)[0] || dialog).focus();
  const frame = view.requestAnimationFrame(() => {
    if (isTop()) focusFirst();
  });

  function onKeyDown(event) {
    if (!isTop() || event.defaultPrevented) return;
    if (event.key === "Escape") {
      event.preventDefault();
      onClose?.();
      return;
    }
    if (event.key !== "Tab") return;
    const items = focusableElements(dialog);
    const first = items[0];
    const last = items[items.length - 1];
    const active = doc.activeElement;
    if (!items.length) {
      event.preventDefault();
      dialog.focus();
    } else if (!items.includes(active)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    } else if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  doc.addEventListener("keydown", onKeyDown);
  return () => {
    view.cancelAnimationFrame(frame);
    doc.removeEventListener("keydown", onKeyDown);
    const wasTop = isTop();
    const index = stack.indexOf(entry);
    if (index >= 0) stack.splice(index, 1);
    if (!wasTop) return;
    const remainingDialog = stack[stack.length - 1]?.dialog;
    if (returnFocusTo?.isConnected && (!remainingDialog || remainingDialog.contains(returnFocusTo))) {
      returnFocusTo.focus?.();
    } else if (remainingDialog) {
      (focusableElements(remainingDialog)[0] || remainingDialog).focus();
    }
  };
}
