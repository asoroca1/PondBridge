import { Button, Card } from "@pondbridge/ui";
import { categoryLabel, formatDateTime, formatScheduleStatus } from "./alertOptions.js";

function audienceText(value = "") {
  return String(value || "").replace(/_/g, " ") || "—";
}

export default function AlertsActivityView({ scheduled, pastRuns, history, onCancelSchedule }) {
  // Only worth its own section when something actually went wrong; a clean run
  // already shows up under "Already sent".
  const problems = pastRuns.filter((item) => {
    const status = String(item?.status || "").toLowerCase();
    return status === "failed" || status === "canceled";
  });

  return (
    <div className="pb-alerts-pane">
      <Card>
        <h2 className="pb-section-title">Waiting to go out</h2>
        {!scheduled.length ? (
          <p className="muted">Nothing scheduled.</p>
        ) : (
          <ul className="pb-alerts-list">
            {scheduled.map((item) => (
              <li key={item.id || item._id}>
                <div>
                  <strong>{item.title}</strong>
                  <small>
                    {formatDateTime(item.runAt)} · {audienceText(item.audience)} · {categoryLabel(item.category)}
                  </small>
                </div>
                <Button variant="ghost" size="sm" onClick={() => onCancelSchedule(item)}>Cancel</Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <h2 className="pb-section-title">Already sent</h2>
        {!history.length ? (
          <p className="muted">Nothing has been sent yet.</p>
        ) : (
          <ul className="pb-alerts-list">
            {history.map((item) => (
              <li key={item.id}>
                <div>
                  <strong>{item.title}</strong>
                  <small>{formatDateTime(item.createdAt)} · {categoryLabel(item.category)}</small>
                </div>
                <span className="pb-alerts-stats">
                  <em>{item.totalRecipients}</em> sent
                  {item.pushDelivered != null ? <> · <em>{item.pushDelivered}</em> pushed</> : null}
                  {item.unreadCount != null ? <> · <em>{item.unreadCount}</em> unread</> : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {problems.length ? (
        <Card>
          <h2 className="pb-section-title">Did not send</h2>
          <ul className="pb-alerts-list">
            {problems.map((item) => (
              <li key={item.id || item._id}>
                <div>
                  <strong>{item.title}</strong>
                  <small>{formatDateTime(item.runAt)} · {formatScheduleStatus(item.status)}</small>
                </div>
                {item.error ? <span className="pb-alerts-stats is-error">{item.error}</span> : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
