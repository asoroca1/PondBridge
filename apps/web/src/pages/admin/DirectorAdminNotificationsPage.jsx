import { useCallback, useEffect, useMemo, useState } from "react";
import { Card } from "@pondbridge/ui";
import { BellOff, BellRing, Check, LoaderCircle } from "lucide-react";
import { ModalConfirm } from "../../components/admin/AdminUi.jsx";
import { useConfirmDialog } from "../../components/admin/useConfirmDialog.js";
import useAdminApi from "./useAdminApi.js";
import AlertsActivityView from "./alerts/AlertsActivityView.jsx";
import AlertsRulesView from "./alerts/AlertsRulesView.jsx";
import AlertsSendView from "./alerts/AlertsSendView.jsx";
import useAlertSettings from "./alerts/useAlertSettings.js";
import { sendBlockReason } from "./alerts/alertOptions.js";
import "./director-admin-alerts.css";

const TABS = [
  { key: "rules", label: "Automatic alerts" },
  { key: "send", label: "Send one" },
  { key: "activity", label: "Activity" }
];

export default function DirectorAdminNotificationsPage() {
  const { slug, request } = useAdminApi();
  const { confirm, confirmDialogProps } = useConfirmDialog();
  const { settings, loading, saveState, error: settingsError, update, setError } = useAlertSettings(request);

  const [tab, setTab] = useState("rules");
  const [templates, setTemplates] = useState([]);
  const [schedules, setSchedules] = useState([]);
  const [history, setHistory] = useState([]);
  const [status, setStatus] = useState("");
  const [actionError, setActionError] = useState("");

  const loadTemplates = useCallback(async () => {
    try {
      const response = await request("/notifications/templates");
      setTemplates(Array.isArray(response?.items) ? response.items : []);
    } catch { setTemplates([]); }
  }, [request]);

  const loadSchedules = useCallback(async () => {
    try {
      const response = await request("/notifications/schedules");
      setSchedules(Array.isArray(response?.items) ? response.items : []);
    } catch { setSchedules([]); }
  }, [request]);

  const loadHistory = useCallback(async () => {
    try {
      const response = await request("/notifications/history");
      setHistory(Array.isArray(response?.items) ? response.items : []);
    } catch { setHistory([]); }
  }, [request]);

  useEffect(() => {
    loadTemplates();
    loadSchedules();
    loadHistory();
  }, [loadHistory, loadSchedules, loadTemplates]);

  const flash = useCallback((message) => {
    setActionError("");
    setError("");
    setStatus(message);
    window.setTimeout(() => setStatus(""), 4000);
  }, [setError]);

  const fail = useCallback((message) => {
    setStatus("");
    setActionError(message);
  }, []);

  const pending = useMemo(
    () => schedules.filter((item) => String(item?.status || "").toLowerCase() === "pending"),
    [schedules]
  );
  const pastRuns = useMemo(
    () => schedules.filter((item) => String(item?.status || "").toLowerCase() !== "pending").slice(0, 10),
    [schedules]
  );

  async function cancelSchedule(schedule) {
    const id = schedule?.id || schedule?._id;
    if (!id) return;
    const confirmed = await confirm({
      title: `Cancel “${schedule.title || "this alert"}”?`,
      description: "It will not be sent. You can always send it again later.",
      confirmLabel: "Cancel it",
      tone: "danger"
    });
    if (!confirmed) return;
    try {
      await request(`/notifications/schedules/${id}`, { method: "DELETE" });
      flash("Scheduled alert canceled.");
      await loadSchedules();
    } catch (requestError) {
      fail(requestError.message || "Could not cancel that alert.");
    }
  }

  if (loading) return <Card><p className="muted">Loading alert settings…</p></Card>;

  const off = !settings.mobileEnabled;
  const blockReason = sendBlockReason(settings);
  const error = actionError || settingsError;

  return (
    <div className="pb-alerts">
      <Card className={`pb-alerts-master${off ? " is-off" : ""}`}>
        <div className="pb-alerts-master-copy">
          {off ? <BellOff aria-hidden="true" /> : <BellRing aria-hidden="true" />}
          <div>
            <strong>{off ? "Mobile alerts are off" : "Mobile alerts are on"}</strong>
            <span>
              {off
                ? "Nothing reaches anyone's phone — not automatic alerts, not one-offs. Your settings below are kept."
                : "Members with the app installed can receive alerts from this network."}
            </span>
          </div>
        </div>
        <label className="pb-alerts-master-switch">
          <input
            type="checkbox"
            role="switch"
            checked={!off}
            onChange={(event) => update({ mobileEnabled: event.target.checked })}
          />
          <span aria-hidden="true" />
          <em>{off ? "Off" : "On"}</em>
        </label>
      </Card>

      <div className="pb-alerts-bar">
        <nav className="pb-alerts-tabs" aria-label="Mobile alert sections">
          {TABS.map((item) => (
            <button
              key={item.key}
              type="button"
              className={tab === item.key ? "is-active" : ""}
              aria-current={tab === item.key ? "page" : undefined}
              onClick={() => setTab(item.key)}
            >
              {item.label}
              {item.key === "activity" && pending.length ? <em>{pending.length}</em> : null}
            </button>
          ))}
        </nav>
        <span className="pb-alerts-savestate" role="status" aria-live="polite">
          {saveState === "saving" ? (
            <><LoaderCircle aria-hidden="true" className="is-spinning" /> Saving…</>
          ) : saveState === "saved" ? (
            <><Check aria-hidden="true" /> Saved</>
          ) : null}
        </span>
      </div>

      {error ? <p className="error-text" role="alert">{error}</p> : null}
      {status ? <p className="success-text" role="status">{status}</p> : null}

      {tab === "rules" ? (
        <AlertsRulesView settings={settings} update={update} disabled={off} />
      ) : tab === "send" ? (
        <AlertsSendView
          request={request}
          slug={slug}
          settings={settings}
          blockReason={blockReason}
          templates={templates}
          confirm={confirm}
          onFlash={flash}
          onError={fail}
          onTemplatesChanged={loadTemplates}
          onSent={(scheduled) => {
            if (scheduled) loadSchedules();
            else loadHistory();
            setTab("activity");
          }}
        />
      ) : (
        <AlertsActivityView
          scheduled={pending}
          pastRuns={pastRuns}
          history={history}
          onCancelSchedule={cancelSchedule}
        />
      )}

      <ModalConfirm {...confirmDialogProps} />
    </div>
  );
}
