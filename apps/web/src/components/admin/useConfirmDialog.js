import { useCallback, useEffect, useRef, useState } from "react";

const DEFAULT_OPTIONS = {
  title: "Are you sure?",
  description: "This action cannot be undone.",
  confirmLabel: "Confirm",
  cancelLabel: "Cancel",
  tone: "danger",
};

/**
 * Promise-based bridge for replacing blocking browser confirmations with the
 * shared, keyboard-accessible product dialog.
 */
export function useConfirmDialog() {
  const [options, setOptions] = useState(null);
  const resolverRef = useRef(null);

  const settle = useCallback((accepted) => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    setOptions(null);
    resolve?.(accepted);
  }, []);

  const confirm = useCallback((nextOptions = {}) => {
    resolverRef.current?.(false);
    return new Promise((resolve) => {
      resolverRef.current = resolve;
      setOptions({ ...DEFAULT_OPTIONS, ...nextOptions });
    });
  }, []);

  useEffect(
    () => () => {
      resolverRef.current?.(false);
      resolverRef.current = null;
    },
    []
  );

  return {
    confirm,
    confirmDialogProps: {
      open: Boolean(options),
      title: options?.title || DEFAULT_OPTIONS.title,
      description: options?.description || DEFAULT_OPTIONS.description,
      confirmLabel: options?.confirmLabel || DEFAULT_OPTIONS.confirmLabel,
      cancelLabel: options?.cancelLabel || DEFAULT_OPTIONS.cancelLabel,
      tone: options?.tone || DEFAULT_OPTIONS.tone,
      onConfirm: () => settle(true),
      onCancel: () => settle(false),
    },
  };
}
