"use client";
// The sections of the admin review page (T-036). See ChefReviewView.tsx for the overview.
// MOCK: every check result is recorded by an admin by hand; nothing is really verified. Reasons,
// notes, bios and file names come from users and are shown as plain text only (React escapes them;
// nothing here uses dangerouslySetInnerHTML).
import { useRef, useState } from "react";
import { ApiClientError, apiFetch } from "@/lib/api/client";
import type {
  AdminChecksRequest,
  AdminChefActionResponse,
  AdminChefDetail,
  KitchenReviewRequest,
  MockCheckStatus,
  RejectChefRequest,
} from "@/lib/api/types";
import {
  REASON_MAX,
  REASON_MIN,
  buildChecksBody,
  buildKitchenBody,
  checkStatusLabel,
  chefStatusText,
  describeAdminError,
  describeAdminMissing,
  foodHandlerRow,
  formatWhen,
  idRow,
  isImagePath,
  kitchenRows,
  reasonProblem,
  type AdminAction,
  type CheckEdits,
  type DocRow,
} from "@/lib/admin/queue";
import { MockBadge } from "@/components/MockBadge";
import {
  Alert,
  Notice,
  Section,
  TextAreaField,
  buttonCls,
  hintCls,
  secondaryButtonCls,
  useSection,
} from "@/components/chef/parts";

interface SectionProps {
  detail: AdminChefDetail;
  chefId: string;
  /** Loads the application again (also fresh file links). */
  onReload: () => void | Promise<void>;
  /** Loads the new state after a successful change. True when it loaded. */
  onChanged: () => Promise<boolean>;
}

class RefreshFailed extends Error {}

/** useSection plus: a 409 INVALID_STATE offers a "Reload this application" button. */
function useAdminSection(action: AdminAction) {
  const s = useSection();
  const [stale, setStale] = useState(false);
  function run(fn: () => Promise<void>, success: string) {
    setStale(false);
    return s.run(fn, success, {
      describe: (err) => {
        if (err instanceof RefreshFailed)
          return "Saved, but the page could not refresh itself. Reload this application to see the new state.";
        setStale(err instanceof ApiClientError && err.code === "INVALID_STATE");
        return describeAdminError(err, action);
      },
    });
  }
  function fail(message: string, fields: Record<string, string> = {}) {
    setStale(false);
    s.fail(message, fields);
  }
  return { ...s, run, fail, stale };
}

function ReloadButton({
  show,
  onReload,
}: {
  show: boolean;
  onReload: SectionProps["onReload"];
}) {
  if (!show) return null;
  return (
    <button
      type="button"
      onClick={() => void onReload()}
      className={`${secondaryButtonCls} self-start`}
    >
      Reload this application
    </button>
  );
}

function CheckLine({
  label,
  status,
}: {
  label: string;
  status: MockCheckStatus;
}) {
  return (
    <li className="flex flex-wrap items-center gap-2">
      <span>{label}:</span>
      <MockBadge>MOCK</MockBadge>
      <span className="font-medium">{checkStatusLabel(status)}</span>
    </li>
  );
}

function fileName(path: string): string {
  return path.split("/").pop() ?? path;
}

// ---------------------------------------------------------------------------
// Application fields
// ---------------------------------------------------------------------------
export function ApplicationSection({ detail }: { detail: AdminChefDetail }) {
  const a = detail.application;
  const rate =
    a.hourlyRateCents === null
      ? "not set"
      : `$${(a.hourlyRateCents / 100).toFixed(2)} per hour`;
  const rows: [string, React.ReactNode][] = [
    ["Display name", a.displayName],
    ["Email (for your review only)", detail.email ?? "none"],
    ["Status", chefStatusText(a.status)],
    [
      "Bio",
      a.bio ? (
        <span className="whitespace-pre-wrap break-words">{a.bio}</span>
      ) : (
        "none"
      ),
    ],
    ["Cuisines", a.cuisines.join(", ") || "none"],
    ["Languages", a.languages.join(", ") || "none"],
    ["Hourly rate", rate],
    [
      "Service area",
      a.servicePostalPrefix
        ? `${a.servicePostalPrefix}, ${a.serviceRadiusKm} km`
        : "not set",
    ],
    [
      "Cooking places",
      a.locationOptions
        .map((l) => (l === "chef_home" ? "Chef's home" : "Customer's home"))
        .join(", ") || "none",
    ],
    [
      "Allergen-awareness acknowledgement",
      a.allergenAckAt
        ? `Acknowledged ${formatWhen(a.allergenAckAt)}`
        : "not yet",
    ],
  ];
  return (
    <Section title="Application">
      <dl className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-[14rem_minmax(0,1fr)]">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="font-medium">{k}</dt>
            <dd className="break-words">{v}</dd>
          </div>
        ))}
      </dl>
      {a.rejectReason && (
        <p>
          <span className="font-medium">Reason given to the chef: </span>
          <span className="whitespace-pre-wrap break-words">
            {a.rejectReason}
          </span>
        </p>
      )}
      <div>
        <p className="font-medium">
          Missing from the chef&apos;s own checklist
        </p>
        {a.missing.length ? (
          <ul className="list-disc pl-6" data-testid="missing-list">
            {a.missing.map((m) => (
              <li key={m}>{describeAdminMissing(m)}</li>
            ))}
          </ul>
        ) : (
          <p>Nothing. The application is complete.</p>
        )}
        <p className={hintCls}>
          This list does not check that the uploaded files still exist.
          Approving does.
        </p>
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------
function DocFile({ row }: { row: DocRow }) {
  return (
    <li className="flex flex-col gap-2 rounded-md border border-zinc-300 p-3 dark:border-zinc-700">
      <p className="font-medium">
        {row.label}{" "}
        <span className="font-normal text-zinc-700 dark:text-zinc-300">
          (file {fileName(row.path)})
        </span>
      </p>
      {row.url ? (
        <>
          {isImagePath(row.path) && (
            // A signed link to a file in private storage: next/image would only add a proxy.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={row.url}
              alt={`${row.label} uploaded by the chef`}
              className="max-h-72 w-full rounded-md border border-zinc-300 object-contain"
            />
          )}
          <a
            href={row.url}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-emerald-800 underline dark:text-emerald-300"
          >
            Open {row.label} in a new tab
          </a>
        </>
      ) : (
        <p
          data-testid="doc-unavailable"
          className="rounded-md border border-amber-700 bg-amber-50 p-2 text-sm text-amber-950"
        >
          Not available: the application lists this file but the server could
          not give you a link to it, so it may be missing from storage. Try
          reloading. You cannot mark it verified until you have opened it.
        </p>
      )}
    </li>
  );
}

export function DocumentsSection({ detail }: { detail: AdminChefDetail }) {
  const app = detail.application;
  const id = idRow(app, detail.documents);
  const fh = foodHandlerRow(app, detail.documents);
  return (
    <Section title="Documents">
      <p className={hintCls}>
        <strong>MOCK:</strong> look at the files, then record what you decide
        below. Nothing reads or verifies them automatically. Links stop working
        after 5 minutes; they are fetched again on their own, or use
        &quot;Reload application and file links&quot;.
      </p>
      <ul className="flex flex-col gap-3">
        {id ? (
          <DocFile row={id} />
        ) : (
          <li>No government ID file uploaded yet.</li>
        )}
        {fh ? (
          <DocFile row={fh} />
        ) : (
          <li>No Food Handler Certificate file uploaded yet.</li>
        )}
      </ul>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// MOCK checks
// ---------------------------------------------------------------------------
const STATUS_OPTIONS: MockCheckStatus[] = [
  "not_started",
  "pending",
  "verified",
  "failed",
];

function CheckSelect({
  name,
  label,
  current,
  value,
  onChange,
  disabled,
  error,
  hint,
}: {
  name: string;
  label: string;
  current: MockCheckStatus;
  value: MockCheckStatus;
  onChange: (v: MockCheckStatus) => void;
  disabled?: boolean;
  error?: string;
  hint?: string;
}) {
  const id = `check-${name}`;
  const described =
    [hint ? `${id}-hint` : "", error ? `${id}-error` : ""]
      .filter(Boolean)
      .join(" ") || undefined;
  return (
    <li className="flex flex-col gap-1 rounded-md border border-zinc-300 p-3 dark:border-zinc-700">
      <p className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{label}</span>
        <MockBadge>MOCK</MockBadge>
        <span>Now: {checkStatusLabel(current)}</span>
      </p>
      <label htmlFor={id} className="text-sm font-medium">
        {label} result to record
      </label>
      {hint && (
        <p id={`${id}-hint`} className={hintCls}>
          {hint}
        </p>
      )}
      <select
        id={id}
        value={value}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={described}
        onChange={(e) => onChange(e.target.value as MockCheckStatus)}
        className="min-h-11 rounded-md border border-zinc-400 bg-white px-3 text-base text-zinc-900 aria-[invalid=true]:border-red-700 disabled:opacity-60 dark:bg-zinc-900 dark:text-zinc-100"
      >
        {STATUS_OPTIONS.map((o) => (
          <option key={o} value={o}>
            {checkStatusLabel(o)}
          </option>
        ))}
      </select>
      {error && (
        <p
          id={`${id}-error`}
          className="text-sm font-medium text-red-700 dark:text-red-400"
        >
          {error}
        </p>
      )}
    </li>
  );
}

export function ChecksSection({
  detail,
  chefId,
  onReload,
  onChanged,
}: SectionProps) {
  const app = detail.application;
  const s = useAdminSection("checks");
  const [edits, setEdits] = useState<CheckEdits>({});
  const id = idRow(app, detail.documents);
  const fh = foodHandlerRow(app, detail.documents);
  const value = {
    id: edits.id ?? app.checks.id,
    foodHandler: edits.foodHandler ?? app.checks.foodHandler,
    police: edits.police ?? app.checks.police,
  };

  function save() {
    const { body, errors } = buildChecksBody(app, edits, detail.documents);
    if (!body) {
      if (errors.form) s.fail(errors.form);
      else s.fail("Check the highlighted fields.", errors);
      return;
    }
    void s.run(async () => {
      await apiFetch<AdminChefActionResponse>(
        `/api/admin/chefs/${encodeURIComponent(chefId)}/checks`,
        { method: "PATCH", body: body satisfies AdminChecksRequest },
      );
      setEdits({});
      if (!(await onChanged())) throw new RefreshFailed();
    }, "MOCK checks saved. Nothing was really verified.");
  }

  return (
    <Section title="Document checks (MOCK)">
      <p className={hintCls}>
        <strong>MOCK:</strong> these are outcomes you record by hand. Nothing is
        really verified, not even by choosing &quot;Verified&quot;. Saving the
        ID or certificate result records it for the file you are looking at
        above; if the chef replaced the file meanwhile, nothing is saved.
      </p>
      <div className="flex flex-col gap-4">
        <Alert id={s.alertId} message={s.error} />
        <ReloadButton show={s.stale} onReload={onReload} />
        <ul className="flex flex-col gap-3">
          <CheckSelect
            name="id"
            label="Government ID check"
            current={app.checks.id}
            value={value.id}
            onChange={(v) => setEdits({ ...edits, id: v })}
            disabled={!id}
            error={s.fieldErrors.id ?? s.fieldErrors.idCheck}
            hint={id ? undefined : "No ID file has been uploaded."}
          />
          <CheckSelect
            name="food-handler"
            label="Food Handler Certificate check"
            current={app.checks.foodHandler}
            value={value.foodHandler}
            onChange={(v) => setEdits({ ...edits, foodHandler: v })}
            disabled={!fh}
            error={s.fieldErrors.foodHandler ?? s.fieldErrors.foodHandlerCheck}
            hint={fh ? undefined : "No certificate file has been uploaded."}
          />
          <CheckSelect
            name="police"
            label="Police check"
            current={app.checks.police}
            value={value.police}
            onChange={(v) => setEdits({ ...edits, police: v })}
            error={s.fieldErrors.policeCheck}
            hint="Not run in this prototype. This only records a placeholder result."
          />
        </ul>
        <button
          type="button"
          onClick={save}
          aria-disabled={s.busy}
          className={`${buttonCls} self-start`}
        >
          {s.busy ? "Please wait..." : "Save MOCK checks"}
        </button>
        <Notice message={s.notice} />
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Kitchen
// ---------------------------------------------------------------------------
export function KitchenSection({
  detail,
  chefId,
  onReload,
  onChanged,
}: SectionProps) {
  const app = detail.application;
  const s = useAdminSection("kitchen");
  const [note, setNote] = useState("");
  const rows = kitchenRows(app, detail.documents);
  const relevant =
    app.locationOptions.includes("chef_home") ||
    rows.length > 0 ||
    app.kitchenAddress !== null;
  if (!relevant) return null;

  function decide(decision: "approve" | "reject") {
    const { body, error } = buildKitchenBody(app, decision, note);
    if (!body) {
      s.fail("Check the highlighted fields.", {
        note: error ?? "Invalid note.",
      });
      return;
    }
    if (decision === "approve" && rows.some((r) => !r.url)) {
      s.fail(
        "You cannot approve a kitchen with a photo you could not open. Reload the application, or reject the kitchen with a note.",
      );
      return;
    }
    void s.run(
      async () => {
        await apiFetch<AdminChefActionResponse>(
          `/api/admin/chefs/${encodeURIComponent(chefId)}/kitchen-review`,
          { method: "POST", body: body satisfies KitchenReviewRequest },
        );
        setNote("");
        if (!(await onChanged())) throw new RefreshFailed();
      },
      decision === "approve"
        ? "MOCK kitchen review saved: cooking at the chef's home is on. Nothing was really verified."
        : "MOCK kitchen review saved: the kitchen was rejected and cooking at the chef's home is off.",
    );
  }

  return (
    <Section title="Kitchen (MOCK review)">
      <p className={hintCls}>
        <strong>MOCK:</strong> for chefs who cook at their own home. Your
        decision is recorded by hand; nobody inspects the real kitchen.
      </p>
      <ul className="flex flex-col gap-1">
        <CheckLine label="Kitchen check" status={app.checks.kitchen} />
        <li>
          Cooking at the chef&apos;s home is{" "}
          <strong data-testid="chef-home-state">
            {app.chefHomeEnabled ? "on" : "off"}
          </strong>
          .
        </li>
        <li>
          Kitchen address:{" "}
          {app.kitchenAddress
            ? `${app.kitchenAddress.line}, ${app.kitchenAddress.city} ${app.kitchenAddress.postalCode}`
            : "none stored"}
        </li>
        <li>
          Kitchen-hygiene acknowledgement <MockBadge>MOCK</MockBadge>{" "}
          {app.kitchenHygieneAckAt
            ? `acknowledged ${formatWhen(app.kitchenHygieneAckAt)}`
            : "not yet"}
        </li>
      </ul>
      {rows.length ? (
        <ul className="flex flex-col gap-3">
          {rows.map((r) => (
            <DocFile key={r.key} row={r} />
          ))}
        </ul>
      ) : (
        <p>No kitchen photos uploaded.</p>
      )}
      <div className="flex flex-col gap-4">
        <Alert id={s.alertId} message={s.error} />
        <ReloadButton show={s.stale} onReload={onReload} />
        <TextAreaField
          label="Note to the chef (required to reject, optional to approve)"
          name="kitchen-note"
          hint={`${REASON_MIN} to ${REASON_MAX} characters. The chef reads this as plain text.`}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          error={s.fieldErrors.note}
        />
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => decide("approve")}
            aria-disabled={s.busy}
            className={buttonCls}
          >
            Approve kitchen (MOCK)
          </button>
          <button
            type="button"
            onClick={() => decide("reject")}
            aria-disabled={s.busy}
            className={secondaryButtonCls}
          >
            Reject kitchen (MOCK)
          </button>
        </div>
        <Notice message={s.notice} />
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Approve and reject
// ---------------------------------------------------------------------------
export function DecisionSection({
  detail,
  chefId,
  onReload,
  onChanged,
}: SectionProps) {
  const app = detail.application;
  const approve = useAdminSection("approve");
  const reject = useAdminSection("reject");
  const [reason, setReason] = useState("");
  const resultRef = useRef<HTMLParagraphElement>(null);
  const base = `/api/admin/chefs/${encodeURIComponent(chefId)}`;

  function focusResult() {
    // The button that was used disappears when the status changes: keep focus on the result.
    setTimeout(() => resultRef.current?.focus(), 0);
  }

  function doApprove() {
    // A write without a body still carries Content-Type: application/json (apiFetch always sets it).
    void approve.run(async () => {
      await apiFetch<AdminChefActionResponse>(`${base}/approve`, {
        method: "POST",
      });
      if (!(await onChanged())) throw new RefreshFailed();
      focusResult();
    }, "Approved. The chef's status is now Approved. MOCK: nothing was really verified.");
  }

  function doReject(e: React.FormEvent) {
    e.preventDefault();
    const problem = reasonProblem(reason);
    if (problem) {
      reject.fail("Check the highlighted fields.", { reason: problem });
      return;
    }
    void reject.run(async () => {
      await apiFetch<AdminChefActionResponse>(`${base}/reject`, {
        method: "POST",
        body: { reason } satisfies RejectChefRequest,
      });
      setReason("");
      if (!(await onChanged())) throw new RefreshFailed();
      focusResult();
    }, "Rejected. The chef sees your reason and can fix the application and submit it again.");
  }

  return (
    <Section title="Decision">
      <p
        ref={resultRef}
        tabIndex={-1}
        data-testid="decision-state"
        className="font-medium"
      >
        {app.status === "pending" &&
          "This application is waiting for a decision."}
        {app.status === "approved" && "This chef is approved."}
        {app.status === "rejected" &&
          "This application was rejected. The chef has to update it and submit it again before it can be approved."}
      </p>

      {app.status === "pending" && (
        <div className="flex flex-col gap-3">
          <Alert id={approve.alertId} message={approve.error} />
          <ReloadButton show={approve.stale} onReload={onReload} />
          <p className={hintCls}>
            Approving needs both the ID and the certificate check recorded as
            Verified (MOCK), a complete application, and every uploaded file
            still in storage. It does not turn on cooking at the chef&apos;s
            home: that is the kitchen review.
          </p>
          <button
            type="button"
            onClick={doApprove}
            aria-disabled={approve.busy}
            className={`${buttonCls} self-start`}
          >
            {approve.busy ? "Please wait..." : "Approve chef"}
          </button>
          <Notice message={approve.notice} />
        </div>
      )}
      {app.status !== "pending" && <Notice message={approve.notice} />}

      {app.status !== "rejected" && (
        <form noValidate className="flex flex-col gap-3" onSubmit={doReject}>
          <Alert id={reject.alertId} message={reject.error} />
          <ReloadButton show={reject.stale} onReload={onReload} />
          <TextAreaField
            label="Reason for rejecting (shown to the chef)"
            name="reject-reason"
            hint={`${REASON_MIN} to ${REASON_MAX} characters, plain text. ${
              app.status === "approved"
                ? "Rejecting an approved chef changes their status to Rejected at once. "
                : ""
            }(${reason.trim().length} of ${REASON_MAX} used)`}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            error={reject.fieldErrors.reason}
          />
          <button
            type="submit"
            aria-disabled={reject.busy}
            className={`${secondaryButtonCls} self-start`}
          >
            {reject.busy ? "Please wait..." : "Reject application"}
          </button>
          <Notice message={reject.notice} />
        </form>
      )}
      {app.status === "rejected" && <Notice message={reject.notice} />}
    </Section>
  );
}
