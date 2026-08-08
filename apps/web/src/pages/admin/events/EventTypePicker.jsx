import { CalendarDays, Video } from "lucide-react";
import { ModalDialog } from "../../../components/admin/AdminUi.jsx";

const CHOICES = [
  {
    value: "community",
    icon: CalendarDays,
    label: "Event",
    blurb: "A gathering people come to — reunions, barbecues, service days.",
    points: ["Place and address", "Capacity limit", "RSVPs"]
  },
  {
    value: "seminar",
    icon: Video,
    label: "Info session",
    blurb: "An online session you host — panels, workshops, Q&As.",
    points: ["Meeting link", "Presenter and topic", "Registration"]
  }
];

/**
 * Creating a gathering and creating an online session ask for genuinely
 * different things, so the choice happens before the form rather than as a
 * dropdown inside it.
 */
export default function EventTypePicker({ open, onClose, onChoose, dayLabel = "" }) {
  return (
    <ModalDialog
      open={open}
      title="What are you creating?"
      description={dayLabel ? `Scheduled for ${dayLabel}.` : "Pick one — the next step only asks what that kind needs."}
      onClose={onClose}
      className="director-admin-modal pb-events-picker-modal"
    >
      <div className="pb-events-picker">
        {CHOICES.map((choice) => {
          const Icon = choice.icon;
          return (
            <button key={choice.value} type="button" onClick={() => onChoose?.(choice.value)}>
              <span className={`pb-events-picker-icon is-${choice.value}`} aria-hidden="true">
                <Icon />
              </span>
              <strong>{choice.label}</strong>
              <small>{choice.blurb}</small>
              <ul>
                {choice.points.map((point) => <li key={point}>{point}</li>)}
              </ul>
            </button>
          );
        })}
      </div>
    </ModalDialog>
  );
}
