import { useCallback, useEffect, useId, useRef, useState } from "react";
import { requestJson } from "../lib/http.js";

const DEBOUNCE_MS = 300;
const MIN_QUERY_LENGTH = 3;

/**
 * Street-address type-ahead for the first line of an address.
 *
 * The list is a suggestion, never a gate: typing straight through without
 * picking anything leaves exactly what was typed. If the lookup endpoint is
 * slow, rate-limited, or unconfigured, the field silently behaves like a
 * plain text input.
 */
export default function AddressAutocomplete({
  id,
  value = "",
  onChange,
  onSelect,
  hasError = false,
  autoComplete = "address-line1",
  placeholder = ""
}) {
  const listboxId = `${useId()}-address-suggestions`;
  const [suggestions, setSuggestions] = useState([]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const wrapRef = useRef(null);
  // Set when a suggestion is applied, so the resulting value change does not
  // immediately trigger a fresh lookup for the text we just filled in.
  const suppressNextLookupRef = useRef(false);

  const closeList = useCallback(() => {
    setOpen(false);
    setActiveIndex(-1);
  }, []);

  useEffect(() => {
    if (suppressNextLookupRef.current) {
      suppressNextLookupRef.current = false;
      return undefined;
    }

    const query = String(value || "").trim();
    if (query.length < MIN_QUERY_LENGTH) {
      setSuggestions([]);
      closeList();
      return undefined;
    }

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const payload = await requestJson(
          `/api/public/address-suggest?q=${encodeURIComponent(query)}`,
          { signal: controller.signal }
        );
        const next = Array.isArray(payload?.suggestions) ? payload.suggestions : [];
        setSuggestions(next);
        setActiveIndex(-1);
        setOpen(next.length > 0);
      } catch {
        // A failed lookup leaves the field as ordinary manual entry.
        setSuggestions([]);
        closeList();
      }
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [value, closeList]);

  useEffect(() => {
    function onDocumentPointerDown(event) {
      if (!wrapRef.current?.contains(event.target)) closeList();
    }
    document.addEventListener("mousedown", onDocumentPointerDown);
    return () => document.removeEventListener("mousedown", onDocumentPointerDown);
  }, [closeList]);

  function applySuggestion(suggestion) {
    if (!suggestion?.address) return;
    suppressNextLookupRef.current = true;
    setSuggestions([]);
    closeList();
    onSelect?.(suggestion.address);
  }

  function onKeyDown(event) {
    if (!open || suggestions.length === 0) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((prev) => (prev + 1) % suggestions.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((prev) => (prev <= 0 ? suggestions.length - 1 : prev - 1));
    } else if (event.key === "Enter" && activeIndex >= 0) {
      // Only intercept Enter when a suggestion is highlighted, so Enter still
      // submits the step for anyone typing the address by hand.
      event.preventDefault();
      applySuggestion(suggestions[activeIndex]);
    } else if (event.key === "Escape") {
      closeList();
    }
  }

  return (
    <div className="pb-address-autocomplete" ref={wrapRef}>
      <input
        id={id}
        className={`wizard1-input ${hasError ? "has-error" : ""}`}
        value={value}
        onChange={(event) => onChange?.(event.target.value)}
        onKeyDown={onKeyDown}
        onFocus={() => setOpen(suggestions.length > 0)}
        autoComplete={autoComplete}
        placeholder={placeholder}
        role="combobox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={
          activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined
        }
      />
      {open && suggestions.length > 0 ? (
        <ul className="pb-address-suggestions" id={listboxId} role="listbox">
          {suggestions.map((suggestion, index) => (
            <li
              key={suggestion.label}
              id={`${listboxId}-option-${index}`}
              role="option"
              aria-selected={index === activeIndex}
              className={index === activeIndex ? "is-active" : ""}
            >
              <button
                type="button"
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => applySuggestion(suggestion)}
              >
                {suggestion.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
