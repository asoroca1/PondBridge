import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

function isModifiedClick(event) {
  return event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
}

export function useUnsavedChangesGuard(isDirty) {
  const navigate = useNavigate();
  const bypassRef = useRef(false);
  const [pendingDestination, setPendingDestination] = useState("");

  const continueTo = useCallback((destination = "") => {
    const value = String(destination || "").trim();
    if (!value) return;
    bypassRef.current = true;
    try {
      const url = new URL(value, window.location.href);
      if (url.origin === window.location.origin) {
        navigate(`${url.pathname}${url.search}${url.hash}`);
      } else {
        window.location.assign(url.toString());
      }
    } catch {
      navigate(value);
    }
  }, [navigate]);

  const requestNavigation = useCallback((destination = "") => {
    if (!isDirty || bypassRef.current) {
      continueTo(destination);
      return;
    }
    setPendingDestination(String(destination || ""));
  }, [continueTo, isDirty]);

  useEffect(() => {
    if (!isDirty) {
      setPendingDestination("");
      return undefined;
    }

    function handleBeforeUnload(event) {
      if (bypassRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    }

    function handleDocumentClick(event) {
      if (bypassRef.current || event.defaultPrevented || isModifiedClick(event)) return;
      const anchor = event.target?.closest?.("a[href]");
      if (!anchor || anchor.hasAttribute("download") || anchor.target === "_blank") return;
      const href = String(anchor.getAttribute("href") || "").trim();
      if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) return;
      event.preventDefault();
      event.stopPropagation();
      setPendingDestination(anchor.href || href);
    }

    window.addEventListener("beforeunload", handleBeforeUnload);
    document.addEventListener("click", handleDocumentClick, true);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      document.removeEventListener("click", handleDocumentClick, true);
    };
  }, [isDirty]);

  const discardAndContinue = useCallback(() => {
    const destination = pendingDestination;
    setPendingDestination("");
    continueTo(destination);
  }, [continueTo, pendingDestination]);

  return {
    pendingDestination,
    requestNavigation,
    keepEditing: () => setPendingDestination(""),
    discardAndContinue
  };
}
