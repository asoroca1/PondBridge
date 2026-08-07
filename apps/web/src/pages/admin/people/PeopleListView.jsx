import { useEffect, useMemo, useState } from "react";
import { Button, Input, Select } from "@pondbridge/ui";
import { Check, Download, Mail, PauseCircle, Search, Send, UserRound } from "lucide-react";
import PersonDetail from "./PersonDetail.jsx";
import {
  personInitials,
  personName,
  stageMeta,
  stageSummary,
  isInvitable,
  canApprove
} from "./peopleStages.js";

const COMPLETION_OPTIONS = [
  { value: "all", label: "Any completion" },
  { value: "complete", label: "100% complete" },
  { value: "high", label: "80–99%" },
  { value: "medium", label: "60–79%" },
  { value: "low", label: "30–59%" },
  { value: "minimal", label: "Under 30%" }
];

const SORT_OPTIONS = [
  { value: "recent", label: "Most recent" },
  { value: "oldest", label: "Oldest first" },
  { value: "name_asc", label: "Name A–Z" },
  { value: "name_desc", label: "Name Z–A" },
  { value: "completion_desc", label: "Completion high–low" },
  { value: "completion_asc", label: "Completion low–high" }
];

export default function PeopleListView({
  stage,
  directory,
  actions,
  slug,
  onInvite,
  onEmail,
  onExport
}) {
  const [selectedKeys, setSelectedKeys] = useState([]);
  const [activeKey, setActiveKey] = useState("");
  const { items, loading, filters, setFilters } = directory;

  // Selections and the open person only make sense for what is on screen.
  useEffect(() => {
    setSelectedKeys((keys) => keys.filter((key) => items.some((item) => item.key === key)));
    setActiveKey((key) => (items.some((item) => item.key === key) ? key : ""));
  }, [items]);

  const selected = useMemo(
    () => items.filter((item) => selectedKeys.includes(item.key)),
    [items, selectedKeys]
  );
  const active = useMemo(
    () => items.find((item) => item.key === activeKey) || null,
    [activeKey, items]
  );

  const invitable = selected.filter(isInvitable);
  const approvable = selected.filter(canApprove);
  const emailable = selected.filter((person) => person.profileId);
  const allOnPageSelected = items.length > 0 && items.every((item) => selectedKeys.includes(item.key));

  function toggle(key) {
    setSelectedKeys((keys) => (keys.includes(key) ? keys.filter((item) => item !== key) : [...keys, key]));
  }

  function patchFilter(changes) {
    setFilters((prev) => ({ ...prev, ...changes }));
  }

  async function holdSelected() {
    for (const person of selected) {
      // Sequential so a partial failure leaves a clear, consistent state.
      await actions.setContactStatus(person, "do_not_contact");
    }
    setSelectedKeys([]);
  }

  async function approveSelected() {
    for (const person of approvable) {
      await actions.approve(person);
    }
    setSelectedKeys([]);
  }

  return (
    <div className="pb-people-browser">
      <div className="pb-people-list">
        <div className="pb-people-toolbar">
          <label className="pb-people-search">
            <Search aria-hidden="true" />
            <Input
              value={filters.q}
              onChange={(event) => patchFilter({ q: event.target.value })}
              placeholder={`Search ${stageMeta(stage).label.toLowerCase()}`}
              aria-label="Search people"
            />
          </label>
          <div className="pb-people-filters">
            <Select value={filters.role} onChange={(event) => patchFilter({ role: event.target.value })} aria-label="Role">
              <option value="all">Any role</option>
              {directory.roleOptions.map((role) => <option key={role} value={role}>{role}</option>)}
            </Select>
            <Select value={filters.year} onChange={(event) => patchFilter({ year: event.target.value })} aria-label="Camp year">
              <option value="all">Any year</option>
              {directory.yearOptions.map((year) => <option key={year} value={year}>{year}</option>)}
            </Select>
            {stage === "member" || stage === "all" ? (
              <Select
                value={filters.completion}
                onChange={(event) => patchFilter({ completion: event.target.value })}
                aria-label="Profile completion"
              >
                {COMPLETION_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </Select>
            ) : null}
            <Select value={filters.sort} onChange={(event) => patchFilter({ sort: event.target.value })} aria-label="Sort">
              {SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </Select>
            <Button type="button" variant="ghost" size="sm" onClick={directory.resetFilters}>Reset</Button>
            <Button type="button" variant="ghost" size="sm" onClick={onExport}>
              <Download aria-hidden="true" />
              Export
            </Button>
          </div>
        </div>

        {selected.length ? (
          <div className="pb-people-bulk">
            <span>{selected.length} selected</span>
            <div>
              {invitable.length ? (
                <Button type="button" size="sm" onClick={() => onInvite(invitable)}>
                  <Send aria-hidden="true" />
                  Invite {invitable.length}
                </Button>
              ) : null}
              {approvable.length ? (
                <Button type="button" size="sm" onClick={approveSelected} loading={actions.busy === "approve"}>
                  <Check aria-hidden="true" />
                  Approve {approvable.length}
                </Button>
              ) : null}
              {emailable.length ? (
                <Button type="button" variant="secondary" size="sm" onClick={() => onEmail(emailable)}>
                  <Mail aria-hidden="true" />
                  Email {emailable.length}
                </Button>
              ) : null}
              <Button type="button" variant="ghost" size="sm" onClick={holdSelected} loading={actions.busy === "hold"}>
                <PauseCircle aria-hidden="true" />
                Hold
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setSelectedKeys([])}>Clear</Button>
            </div>
          </div>
        ) : null}

        <div className="pb-people-list-head">
          <label className="pb-people-select-all">
            <input
              type="checkbox"
              checked={allOnPageSelected}
              disabled={!items.length}
              onChange={(event) => setSelectedKeys(event.target.checked ? items.map((item) => item.key) : [])}
            />
            Select page
          </label>
          <span>{directory.total.toLocaleString()} {directory.total === 1 ? "person" : "people"}</span>
        </div>

        <ul className="pb-people-rows">
          {loading ? (
            <li className="pb-people-placeholder">Loading…</li>
          ) : !items.length ? (
            <li className="pb-people-empty">
              <UserRound aria-hidden="true" />
              <strong>Nobody here yet.</strong>
              <span>{stageMeta(stage).blurb}</span>
            </li>
          ) : (
            items.map((person) => {
              const meta = stageMeta(person.stage);
              return (
                <li key={person.key}>
                  <div className={`pb-people-row ${person.key === activeKey ? "is-active" : ""}`}>
                    <input
                      type="checkbox"
                      checked={selectedKeys.includes(person.key)}
                      onChange={() => toggle(person.key)}
                      aria-label={`Select ${personName(person)}`}
                    />
                    <button type="button" onClick={() => setActiveKey(person.key)}>
                      <span className="pb-people-avatar" aria-hidden="true">
                        {person.avatarUrl ? <img src={person.avatarUrl} alt="" /> : personInitials(person)}
                      </span>
                      <span className="pb-people-row-main">
                        <strong>{personName(person)}</strong>
                        <small>{person.email}</small>
                        <small className="pb-people-row-summary">{stageSummary(person)}</small>
                      </span>
                      {stage === "all" ? (
                        <span className={`pb-people-stage tone-${meta.tone}`}>{meta.label}</span>
                      ) : null}
                    </button>
                  </div>
                </li>
              );
            })
          )}
        </ul>

        {directory.totalPages > 1 ? (
          <div className="pb-people-pagination">
            <Button
              variant="secondary"
              size="sm"
              disabled={directory.page <= 1 || loading}
              onClick={() => directory.setPage(directory.page - 1)}
            >
              Previous
            </Button>
            <span className="muted">Page {directory.page} of {directory.totalPages}</span>
            <Button
              variant="secondary"
              size="sm"
              disabled={directory.page >= directory.totalPages || loading}
              onClick={() => directory.setPage(directory.page + 1)}
            >
              Next
            </Button>
          </div>
        ) : null}
      </div>

      <PersonDetail
        person={active}
        slug={slug}
        actions={actions}
        onInvite={onInvite}
        onEmail={onEmail}
      />
    </div>
  );
}
