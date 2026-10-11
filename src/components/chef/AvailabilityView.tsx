"use client";
// Chef availability calendar (T-034). Built against docs/api-contract.md section 5B and decision
// D-15: a date is bookable only if the chef ticked it ("opt-in"). The window (today to the last
// bookable day) comes from the server, never from the browser clock.
//
// Accessibility: an ARIA grid with one tab stop (arrow keys, Home/End, PageUp/PageDown move
// between days; Space or Enter toggles a day). Each day is a toggle button named with its full
// date, announced as pressed or not pressed. A selected day also shows a check mark and a heavy
// border, so the state is not shown by colour alone.
import { useEffect, useId, useRef, useState } from "react";
import { ApiClientError, apiFetch } from "@/lib/api/client";
import type {
  AvailabilityResponse,
  SetAvailabilityRequest,
} from "@/lib/api/types";
import {
  addMonths,
  bookedDatesMessage,
  dayLabel,
  dayNumber,
  diffDays,
  inWindow,
  monthGrid,
  monthLabel,
  monthStart,
  moveFocus,
  type CalendarKey,
} from "@/lib/chef/calendar";
import { describeError } from "@/lib/chef/form";
import {
  Alert,
  Notice,
  buttonCls,
  cardCls,
  hintCls,
  secondaryButtonCls,
  useSection,
} from "@/components/chef/parts";

const KEYS: readonly string[] = [
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Home",
  "End",
  "PageUp",
  "PageDown",
];
const WEEKDAYS = [
  ["Sunday", "Sun"],
  ["Monday", "Mon"],
  ["Tuesday", "Tue"],
  ["Wednesday", "Wed"],
  ["Thursday", "Thu"],
  ["Friday", "Fri"],
  ["Saturday", "Sat"],
];

function describeAvailabilityError(err: unknown): string {
  if (err instanceof ApiClientError && err.code === "DATE_BOOKED")
    return bookedDatesMessage(err.dates ?? []);
  if (err instanceof ApiClientError && err.code === "VALIDATION_FAILED") {
    const first = err.fields.add ?? err.fields.remove;
    if (first)
      return `${first} Reload the page if the calendar looks out of date.`;
  }
  return describeError(err);
}

export function AvailabilityView() {
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "error"; message: string }
    | { kind: "ready"; data: AvailabilityResponse }
  >({ kind: "loading" });

  useEffect(() => {
    let current = true;
    apiFetch<AvailabilityResponse>("/api/chef/availability").then(
      (data) => {
        if (current) setState({ kind: "ready", data });
      },
      (err) => {
        if (current)
          setState({ kind: "error", message: describeAvailabilityError(err) });
      },
    );
    return () => {
      current = false;
    };
  }, []);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-5 px-4 py-6">
      <h1 className="text-2xl font-semibold tracking-tight">
        Your availability
      </h1>
      {state.kind === "loading" && (
        <p role="status">Loading your availability...</p>
      )}
      {state.kind === "error" && (
        <div
          role="alert"
          className="rounded-md border border-red-700 bg-red-50 p-3 text-sm text-red-900 dark:bg-red-950 dark:text-red-100"
        >
          {state.message}
        </div>
      )}
      {state.kind === "ready" && (
        <Calendar
          data={state.data}
          setData={(data) => setState({ kind: "ready", data })}
        />
      )}
    </main>
  );
}

function Calendar({
  data,
  setData,
}: {
  data: AvailabilityResponse;
  setData: (d: AvailabilityResponse) => void;
}) {
  const { today, lastBookableDay: last } = data;
  const s = useSection();
  const [draft, setDraft] = useState<string[]>(data.days);
  const [month, setMonth] = useState(monthStart(today));
  const [focused, setFocused] = useState(today);
  const [focusTick, setFocusTick] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const headingId = useId();
  const baseId = useId();
  const cellId = (day: string) => `${baseId}-${day}`;

  const change = diffDays(data.days, draft);
  const changes = change.add.length + change.remove.length;
  const firstMonth = monthStart(today);
  const lastMonth = monthStart(last);

  // After a keyboard move into another month the new cell exists only after the render.
  useEffect(() => {
    if (focusTick) document.getElementById(cellId(focused))?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run only when a move was requested
  }, [focusTick]);

  function goToMonth(next: string) {
    if (next < firstMonth || next > lastMonth) return;
    setMonth(next);
    // Keep one tab stop in the month on screen.
    const day = `${next.slice(0, 8)}01`;
    setFocused(day < today ? today : day > last ? last : day);
  }

  function toggleDay(day: string) {
    setMessage(null);
    setDraft((cur) =>
      cur.includes(day) ? cur.filter((d) => d !== day) : [...cur, day].sort(),
    );
  }

  function onKeyDown(ev: React.KeyboardEvent, day: string) {
    if (!KEYS.includes(ev.key)) return;
    ev.preventDefault();
    const next = moveFocus(day, ev.key as CalendarKey, today, last);
    setFocused(next);
    setMonth(monthStart(next));
    setFocusTick((t) => t + 1);
  }

  function save() {
    if (s.busy) return;
    if (changes === 0) {
      setMessage("There are no changes to save.");
      return;
    }
    const body: SetAvailabilityRequest = {};
    if (change.add.length) body.add = change.add;
    if (change.remove.length) body.remove = change.remove;
    setMessage(null);
    void s.run(
      async () => {
        const next = await apiFetch<AvailabilityResponse>(
          "/api/chef/availability",
          { method: "PUT", body },
        );
        setData(next);
        setDraft(next.days);
      },
      "Availability saved.",
      { describe: describeAvailabilityError },
    );
  }

  const weeks = monthGrid(month);
  const saved = new Set(data.days);

  return (
    <>
      <p className={hintCls}>
        Tick the days you can cook. Customers can only book days you have
        ticked. You can choose any day from {dayLabel(today)} to{" "}
        {dayLabel(last)}. Press Space or Enter on a day to tick or untick it,
        use the arrow keys to move, then choose &quot;Save availability&quot;.
        You cannot untick a day that has a booking.
      </p>
      <section aria-labelledby={headingId} className={cardCls}>
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            className={secondaryButtonCls}
            aria-label="Previous month"
            aria-disabled={month <= firstMonth}
            onClick={() => goToMonth(addMonths(month, -1))}
          >
            <span aria-hidden="true">&lsaquo;</span> Prev
          </button>
          <h2
            id={headingId}
            aria-live="polite"
            className="text-center text-lg font-semibold"
          >
            {monthLabel(month)}
          </h2>
          <button
            type="button"
            className={secondaryButtonCls}
            aria-label="Next month"
            aria-disabled={month >= lastMonth}
            onClick={() => goToMonth(addMonths(month, 1))}
          >
            Next <span aria-hidden="true">&rsaquo;</span>
          </button>
        </div>
        <table
          role="grid"
          aria-labelledby={headingId}
          className="w-full table-fixed border-separate border-spacing-1"
        >
          <thead>
            <tr>
              {WEEKDAYS.map(([long, short]) => (
                <th
                  key={long}
                  scope="col"
                  abbr={long}
                  className="pb-1 text-center text-xs font-semibold"
                >
                  {short}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {weeks.map((week, wi) => (
              <tr key={wi}>
                {week.map((day, di) => (
                  <td key={di} role="gridcell" className="p-0 text-center">
                    {day &&
                      (inWindow(day, today, last) ? (
                        <DayButton
                          id={cellId(day)}
                          day={day}
                          today={today}
                          selected={draft.includes(day)}
                          changed={draft.includes(day) !== saved.has(day)}
                          tabStop={day === focused}
                          onToggle={() => {
                            setFocused(day);
                            toggleDay(day);
                          }}
                          onKeyDown={(ev) => onKeyDown(ev, day)}
                        />
                      ) : (
                        <span
                          className="flex min-h-11 items-center justify-center text-sm text-zinc-600 line-through dark:text-zinc-400"
                          aria-label={`${dayLabel(day)}, outside the days you can choose`}
                          role="img"
                        >
                          {dayNumber(day)}
                        </span>
                      ))}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <p className={hintCls}>
          <span aria-hidden="true">&#10003;</span> Ticked = you can cook that
          day. A dot after the number marks a change you have not saved yet.
        </p>
        <p
          role="status"
          data-testid="availability-summary"
          className="font-medium"
        >
          {draft.length} {draft.length === 1 ? "day" : "days"} ticked.{" "}
          {changes === 0
            ? "No unsaved changes."
            : `Unsaved changes: ${change.add.length} to add, ${change.remove.length} to clear.`}
        </p>
        <Alert id={s.alertId} message={s.error} />
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={buttonCls}
            aria-disabled={s.busy}
            onClick={save}
          >
            {s.busy ? "Saving..." : "Save availability"}
          </button>
          <button
            type="button"
            className={secondaryButtonCls}
            onClick={() => {
              setDraft(data.days);
              setMessage("Changes discarded.");
            }}
          >
            Discard changes
          </button>
        </div>
        <Notice message={message ?? s.notice} />
      </section>
    </>
  );
}

function DayButton({
  id,
  day,
  today,
  selected,
  changed,
  tabStop,
  onToggle,
  onKeyDown,
}: {
  id: string;
  day: string;
  today: string;
  selected: boolean;
  changed: boolean;
  tabStop: boolean;
  onToggle: () => void;
  onKeyDown: (ev: React.KeyboardEvent) => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <button
      ref={ref}
      id={id}
      type="button"
      aria-pressed={selected}
      aria-label={`${dayLabel(day)}${day === today ? ", today" : ""}`}
      tabIndex={tabStop ? 0 : -1}
      data-day={day}
      onClick={onToggle}
      onKeyDown={onKeyDown}
      className={`flex min-h-11 w-full flex-col items-center justify-center rounded-md border-2 text-sm font-medium ${
        selected
          ? "border-emerald-950 bg-emerald-800 text-white"
          : "border-zinc-400 bg-white text-zinc-900 hover:bg-zinc-100 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
      } ${day === today ? "underline underline-offset-4" : ""}`}
    >
      <span aria-hidden="true">
        {dayNumber(day)}
        {changed ? "·" : ""}
      </span>
      <span aria-hidden="true" className="h-3 text-xs leading-3">
        {selected ? "✓" : ""}
      </span>
    </button>
  );
}
