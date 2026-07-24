import { useEffect, useId, useMemo, useRef, useState } from "react";
import { API_BASE } from "../lib/api";
import { getToken } from "../lib/helpers";

const MIN_QUERY_LENGTH = 2;
const SEARCH_DEBOUNCE_MS = 180;

async function fetchCities(query, signal) {
  const url = `${API_BASE}/geo/cities?q=${encodeURIComponent(query)}&limit=10`;
  const token = getToken();
  const headers = { Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(url, { signal, headers, credentials: "include" });
  if (!response.ok) throw new Error(`city search failed: ${response.status}`);
  const data = await response.json();
  return Array.isArray(data?.results) ? data.results : [];
}

async function addCity({ city, state, country }) {
  const url = `${API_BASE}/geo/cities`;
  const token = getToken();
  const headers = { "Content-Type": "application/json", Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(url, {
    method: "POST",
    headers,
    credentials: "include",
    body: JSON.stringify({ city, state, country })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error?.message || "Could not save that city.");
  }
  return data?.city || null;
}

function parseManualEntry(raw) {
  const parts = String(raw || "").split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 3) return { city: parts[0], state: parts[1], country: parts[2] };
  if (parts.length === 2) {
    const tail = parts[1].toUpperCase();
    const isUsState = /^[A-Z]{2}$/.test(tail);
    return { city: parts[0], state: isUsState ? tail : "", country: isUsState ? "US" : parts[1] };
  }
  return { city: parts[0] || "", state: "", country: "" };
}

export default function CityCombobox({
  value,
  onChange,
  placeholder = "City, State (US) or City, Country",
  hasError = false,
  className = "",
  inputClassName = "wizard1-input",
  inputId = "",
  ariaDescribedBy = ""
}) {
  const listId = useId();
  const errorId = useId();
  const resolvedInputId = inputId || `${listId}-input`;
  const containerRef = useRef(null);
  const [input, setInput] = useState(value || "");
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    if (value !== undefined && value !== input) {
      setInput(value || "");
    }
  }, [value]);

  useEffect(() => {
    const trimmed = String(input || "").trim();
    if (trimmed.length < MIN_QUERY_LENGTH) {
      setResults([]);
      return () => {};
    }

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const rows = await fetchCities(trimmed, controller.signal);
        setResults(rows);
      } catch (err) {
        if (err.name !== "AbortError") setResults([]);
      } finally {
        setLoading(false);
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [input]);

  useEffect(() => {
    function handleDocumentClick(event) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(event.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleDocumentClick);
    return () => document.removeEventListener("mousedown", handleDocumentClick);
  }, []);

  const showAddOption = useMemo(() => {
    const trimmed = String(input || "").trim();
    if (trimmed.length < MIN_QUERY_LENGTH) return false;
    if (loading) return false;
    const exactMatch = results.some(
      (row) => String(row.label || "").toLowerCase() === trimmed.toLowerCase()
    );
    return !exactMatch;
  }, [input, loading, results]);

  function commitSelection(row) {
    if (!row) return;
    setInput(row.label);
    setOpen(false);
    setHighlight(-1);
    setErrorMessage("");
    onChange?.(row.label, row);
  }

  async function handleAddManual() {
    const parsed = parseManualEntry(input);
    if (!parsed.city) {
      setErrorMessage("Add a city name.");
      return;
    }
    setSaving(true);
    setErrorMessage("");
    try {
      const saved = await addCity(parsed);
      if (saved) commitSelection(saved);
      else setErrorMessage("Could not save that city.");
    } catch (err) {
      setErrorMessage(err.message || "Could not save that city.");
    } finally {
      setSaving(false);
    }
  }

  function handleKeyDown(event) {
    if (!open) return;
    const optionCount = results.length + (showAddOption ? 1 : 0);
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlight((h) => (h + 1) % Math.max(1, optionCount));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlight((h) => (h - 1 + optionCount) % Math.max(1, optionCount));
    } else if (event.key === "Enter") {
      if (highlight < 0) return;
      event.preventDefault();
      if (highlight < results.length) commitSelection(results[highlight]);
      else handleAddManual();
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div ref={containerRef} className={`city-combobox ${className}`} style={{ position: "relative" }}>
      <input
        id={resolvedInputId}
        className={`${inputClassName} ${hasError ? "has-error" : ""}`}
        value={input}
        placeholder={placeholder}
        onChange={(event) => {
          setInput(event.target.value);
          setOpen(true);
          setHighlight(-1);
          setErrorMessage("");
          onChange?.(event.target.value, null);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-invalid={hasError || Boolean(errorMessage)}
        aria-describedby={[ariaDescribedBy, errorMessage ? errorId : ""].filter(Boolean).join(" ") || undefined}
        autoComplete="off"
      />
      {open && (results.length > 0 || showAddOption || loading) && (
        <ul
          id={listId}
          role="listbox"
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            zIndex: 50,
            background: "var(--surface, #fff)",
            border: "1px solid var(--border, #d0d5dd)",
            borderRadius: 8,
            marginTop: 4,
            padding: 4,
            listStyle: "none",
            maxHeight: 260,
            overflowY: "auto",
            boxShadow: "0 8px 24px rgba(0,0,0,0.08)"
          }}
        >
          {loading && (
            <li style={{ padding: "8px 10px", fontSize: 13, opacity: 0.7 }}>Searching…</li>
          )}
          {!loading &&
            results.map((row, index) => (
              <li
                key={row.key}
                role="option"
                aria-selected={index === highlight}
                onMouseDown={(event) => {
                  event.preventDefault();
                  commitSelection(row);
                }}
                onMouseEnter={() => setHighlight(index)}
                style={{
                  padding: "8px 10px",
                  borderRadius: 6,
                  cursor: "pointer",
                  background: index === highlight ? "rgba(0,0,0,0.06)" : "transparent"
                }}
              >
                {row.label}
              </li>
            ))}
          {!loading && showAddOption && (
            <li
              role="option"
              aria-selected={highlight === results.length}
              onMouseDown={(event) => {
                event.preventDefault();
                handleAddManual();
              }}
              onMouseEnter={() => setHighlight(results.length)}
              style={{
                padding: "8px 10px",
                borderRadius: 6,
                cursor: saving ? "progress" : "pointer",
                fontSize: 13,
                background: highlight === results.length ? "rgba(0,0,0,0.06)" : "transparent",
                borderTop: results.length ? "1px solid var(--border, #e5e7eb)" : "none"
              }}
            >
              {saving ? "Adding…" : `Add "${input.trim()}" as a new location`}
            </li>
          )}
        </ul>
      )}
      {errorMessage && (
        <p id={errorId} className="wizard1-error" style={{ marginTop: 6 }}>{errorMessage}</p>
      )}
    </div>
  );
}
