import { useState } from "react";
import { Button, Textarea } from "@pondbridge/ui";
import { Check, ShieldQuestion, X } from "lucide-react";
import { RECOGNITION, recognitionMeta } from "./peopleStages.js";

const FILTERS = [
  { value: "any", label: "Everyone waiting" },
  { value: "invited", label: RECOGNITION.invited.label },
  { value: "known", label: RECOGNITION.known.label },
  { value: "unrecognized", label: RECOGNITION.unrecognized.label }
];

/**
 * The top of the review queue.
 *
 * A director facing hundreds of requests should not have to page through them.
 * The queue is split by whether the person was actually invited, so the
 * expected bulk can be cleared in one decision and the remainder — the people
 * nobody asked to join — gets the attention it deserves.
 */
export default function ReviewQueueBar({ directory, actions, onResult }) {
  const [confirming, setConfirming] = useState(null);
  const [reason, setReason] = useState("");

  const counts = directory.recognitionCounts;
  const waiting = Number(directory.counts?.request || 0);
  const match = directory.filters.match;
  const busy = Boolean(actions.busy);

  if (!waiting) return null;

  const scopeCount = match === "any" ? waiting : Number(counts[match] || 0);

  async function commit() {
    const { action } = confirming;
    const result = await actions.decideMany(action, {
      scope: "all",
      match,
      reason: action === "deny" ? reason : ""
    });
    setConfirming(null);
    setReason("");
    onResult?.(result);
  }

  return (
    <div className="pb-review-bar">
      <div className="pb-review-head">
        <div>
          <strong>{waiting.toLocaleString()} {waiting === 1 ? "person is" : "people are"} waiting on you</strong>
          <small>Nobody in this list can sign in until you decide.</small>
        </div>
        <div className="pb-review-split">
          {Object.keys(RECOGNITION).map((key) => {
            const meta = recognitionMeta(key);
            const value = Number(counts[key] || 0);
            if (!value) return null;
            return (
              <button
                key={key}
                type="button"
                className={`pb-people-stage tone-${meta.tone} ${match === key ? "is-selected" : ""}`}
                onClick={() =>
                  directory.setFilters((prev) => ({ ...prev, match: prev.match === key ? "any" : key }))
                }
                title={meta.blurb}
              >
                {value.toLocaleString()} {meta.label.toLowerCase()}
              </button>
            );
          })}
        </div>
      </div>

      <div className="pb-review-actions">
        <label className="pb-review-scope">
          <span>Showing</span>
          <select
            value={match}
            onChange={(event) =>
              directory.setFilters((prev) => ({ ...prev, match: event.target.value }))
            }
            aria-label="Filter the review queue"
          >
            {FILTERS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>

        {confirming ? (
          <div className="pb-review-confirm" role="alertdialog" aria-label="Confirm bulk decision">
            <p>
              {confirming.action === "approve"
                ? `Approve ${scopeCount.toLocaleString()} ${scopeCount === 1 ? "person" : "people"}? They get access immediately and are emailed that they were approved.`
                : `Turn down ${scopeCount.toLocaleString()} ${scopeCount === 1 ? "person" : "people"}? They are emailed that their request was declined.`}
            </p>
            {confirming.action === "deny" ? (
              <Textarea
                rows={2}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Reason to include in the email (optional)"
              />
            ) : null}
            <div>
              <Button
                type="button"
                size="sm"
                variant={confirming.action === "approve" ? "primary" : "secondary"}
                onClick={commit}
                loading={busy}
              >
                Yes, {confirming.action === "approve" ? "approve" : "turn down"} {scopeCount.toLocaleString()}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setConfirming(null)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="pb-review-buttons">
            <Button
              type="button"
              size="sm"
              disabled={!scopeCount || busy}
              onClick={() => setConfirming({ action: "approve" })}
            >
              <Check aria-hidden="true" />
              Approve all {scopeCount.toLocaleString()}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={!scopeCount || busy}
              onClick={() => setConfirming({ action: "deny" })}
            >
              <X aria-hidden="true" />
              Turn down all {scopeCount.toLocaleString()}
            </Button>
            {Number(counts.unrecognized || 0) > 0 && match !== "unrecognized" ? (
              <button
                type="button"
                className="pb-review-nudge"
                onClick={() => directory.setFilters((prev) => ({ ...prev, match: "unrecognized" }))}
              >
                <ShieldQuestion aria-hidden="true" />
                Check the {Number(counts.unrecognized).toLocaleString()} nobody invited first
              </button>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
