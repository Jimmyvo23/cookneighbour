"use client";
// "My allergy profile" (T-067, D-38): the customer's saved allergies and dietary notes, from
// GET/PUT/DELETE /api/me/intake (contract 4A). They fill in the booking form so the customer does
// not type them each time; the booking still keeps its own copy.
//
// Privacy wording is limited to what the code enforces: a chef never reads the saved profile (a
// chef sees only the answers sent with a booking request), and a booking keeps its own copy. It
// says nothing else about who can read the profile (open question Q-38).
import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ApiClientError, apiFetch } from "@/lib/api/client";
import type { SavedIntakeResponse } from "@/lib/api/types";
import {
  emptyDraft,
  intakeProblems,
  type BookingDraft,
  type FieldErrors,
} from "@/lib/booking/form";
import { draftFromSaved, intakeFromDraft } from "@/lib/booking/savedIntake";
import {
  buttonCls,
  cardCls,
  hintCls,
  secondaryButtonCls,
} from "@/components/chef/parts";
import { IntakeFields } from "@/components/booking/IntakeFields";
import {
  ErrorSummary,
  FieldScopeProvider,
  dangerBoxCls,
} from "@/components/booking/parts";
import { NOTICE_BOX_CLS, useAnnounce } from "@/components/booking/useAnnounce";

const linkCls = "font-medium underline";

type State =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; saved: SavedIntakeResponse };

/** Server field keys (plain, contract 4A) to the form's question keys. */
function toFormKey(k: string): string {
  if (k === "dietaryNotes" || k === "noDietaryNeeds")
    return "intake.dietaryNotes";
  return "intake.allergies";
}

export function SavedIntakeView() {
  const scope = useId();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [draft, setDraft] = useState<BookingDraft>(emptyDraft);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [focusTick, setFocusTick] = useState(0);
  const summaryRef = useRef<HTMLDivElement>(null);
  const failureRef = useRef<HTMLDivElement>(null);
  const deleteRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLParagraphElement>(null);
  const savedStateRef = useRef<HTMLParagraphElement>(null);
  const afterDelete = useRef(false);
  const wasConfirming = useRef(false);
  const { announce, notice } = useAnnounce();
  const seq = useRef(0);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    setState({ kind: "loading" });
    try {
      const r = await apiFetch<SavedIntakeResponse>("/api/me/intake");
      if (mine !== seq.current) return;
      setDraft(
        r.intake
          ? { ...emptyDraft(), ...draftFromSaved(r.intake) }
          : emptyDraft(),
      );
      setState({ kind: "ready", saved: r });
    } catch {
      if (mine !== seq.current) return;
      setState({ kind: "error" });
    }
  }, []);

  useEffect(() => {
    void load(); // eslint-disable-line react-hooks/set-state-in-effect -- loads from the API after mount
  }, [load]);

  useEffect(() => {
    document.title = "My allergy profile — CookNeighbour";
  }, []);

  // After any error focus moves to the failure message, else to the error summary (one owner).
  useEffect(() => {
    if (!focusTick) return;
    (failureRef.current ?? summaryRef.current)?.focus();
  }, [focusTick]);

  // The Delete button leaves the page while the question is open, so focus moves to the question
  // (T-076). Cancelling puts focus back on the button that opened it. After a successful delete the
  // saved-state line takes focus (the button and the question are gone).
  useEffect(() => {
    if (confirming) confirmRef.current?.focus();
    else if (wasConfirming.current) {
      if (afterDelete.current) {
        afterDelete.current = false;
        savedStateRef.current?.focus();
      } else deleteRef.current?.focus();
    }
    wasConfirming.current = confirming;
  }, [confirming]);

  const patch = (p: Partial<BookingDraft>, clear: string[] = []) => {
    setDraft((d) => ({ ...d, ...p }));
    setFailure(null);
    if (clear.length)
      setErrors((e) => {
        const n = { ...e };
        for (const k of clear) delete n[k];
        return n;
      });
  };

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setFailure(null);
    const local = intakeProblems(draft);
    setErrors(local);
    if (Object.keys(local).length) {
      setFocusTick((t) => t + 1);
      return;
    }
    setBusy(true);
    try {
      const r = await apiFetch<SavedIntakeResponse>("/api/me/intake", {
        method: "PUT",
        body: intakeFromDraft(draft),
      });
      setState({ kind: "ready", saved: r });
      if (r.intake) setDraft({ ...emptyDraft(), ...draftFromSaved(r.intake) });
      announce(
        "Saved. Your allergy profile will fill in the booking form from now on.",
      );
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 422) {
        const fields: FieldErrors = {};
        for (const [k, m] of Object.entries(err.fields))
          fields[toFormKey(k)] ??= m;
        setErrors(
          Object.keys(fields).length
            ? fields
            : { "intake.allergies": "Check your answers and try again." },
        );
      } else if (err instanceof ApiClientError && err.status === 401) {
        setFailure("Your session ended. Log in again to save your profile.");
      } else {
        setFailure(
          "Your allergy profile could not be saved. Your answers are still on this page. Try again.",
        );
      }
      setFocusTick((t) => t + 1);
    } finally {
      setBusy(false);
    }
  }

  async function onDelete() {
    if (busy) return;
    setFailure(null);
    setBusy(true);
    try {
      const r = await apiFetch<SavedIntakeResponse>("/api/me/intake", {
        method: "DELETE",
      });
      afterDelete.current = true;
      setConfirming(false);
      setErrors({});
      setDraft(emptyDraft());
      setState({ kind: "ready", saved: r });
      announce("Your saved allergy profile was deleted.");
    } catch {
      setFailure(
        "Your allergy profile could not be deleted. It is still saved. Try again.",
      );
      setFocusTick((t) => t + 1);
    } finally {
      setBusy(false);
    }
  }

  const saved = state.kind === "ready" ? state.saved : null;
  return (
    <FieldScopeProvider value={`pf${scope}-`}>
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-5 px-4 py-8">
        <h1 className="text-2xl font-semibold tracking-tight">
          My allergy profile
        </h1>
        <p className={hintCls}>
          Save your allergies and dietary needs once, and the booking form fills
          them in for you. You can still change them for each booking. A chef
          only sees the answers you send with a booking request. Your saved
          profile is not shown to chefs, and changing or deleting it does not
          change a request you already sent.
        </p>

        {notice("profile-status", NOTICE_BOX_CLS)}

        {state.kind === "loading" && (
          <p role="status" data-testid="loading">
            Loading your allergy profile...
          </p>
        )}
        {state.kind === "error" && (
          <div
            role="alert"
            data-testid="load-error"
            className="flex flex-col gap-3"
          >
            <p>Your allergy profile did not load. Nothing was changed.</p>
            <p>
              <button
                type="button"
                className={secondaryButtonCls}
                onClick={() => void load()}
              >
                Try again
              </button>
            </p>
          </div>
        )}

        {saved && (
          <form
            onSubmit={onSave}
            noValidate
            aria-label="Allergy profile"
            className="flex flex-col gap-5"
          >
            <ErrorSummary errors={errors} innerRef={summaryRef} />
            {failure && (
              <div
                ref={failureRef}
                tabIndex={-1}
                role="alert"
                data-testid="profile-error"
                className={dangerBoxCls}
              >
                {failure}
              </div>
            )}
            <section aria-labelledby={`${scope}-h`} className={cardCls}>
              <h2 id={`${scope}-h`} className="text-lg font-semibold">
                Allergies and dietary needs
              </h2>
              <p
                data-testid="saved-state"
                ref={savedStateRef}
                tabIndex={-1}
                className={hintCls}
              >
                {saved.intake
                  ? `Saved on ${new Date(saved.savedAt ?? "").toLocaleDateString("en-CA", { timeZone: "America/Toronto", dateStyle: "medium" })}.`
                  : "Nothing is saved yet."}
              </p>
              <IntakeFields draft={draft} errors={errors} patch={patch} />
            </section>
            <div className="flex flex-wrap gap-3">
              <button type="submit" disabled={busy} className={buttonCls}>
                {busy && !confirming ? "Saving..." : "Save profile"}
              </button>
              {saved.intake && !confirming && (
                <button
                  ref={deleteRef}
                  type="button"
                  disabled={busy}
                  className={secondaryButtonCls}
                  onClick={() => setConfirming(true)}
                >
                  Delete saved profile
                </button>
              )}
            </div>
            {saved.intake && confirming && (
              <div
                role="group"
                aria-label="Confirm delete"
                className="flex flex-col gap-3 rounded-md border-2 border-danger p-3"
              >
                <p ref={confirmRef} tabIndex={-1} data-testid="confirm-delete">
                  Delete your saved allergy profile? The booking form will be
                  empty next time. Requests you already sent keep their answers.
                </p>
                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    disabled={busy}
                    className={buttonCls}
                    onClick={() => void onDelete()}
                  >
                    Yes, delete it
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    className={secondaryButtonCls}
                    onClick={() => setConfirming(false)}
                  >
                    Keep it
                  </button>
                </div>
              </div>
            )}
          </form>
        )}

        <p>
          <Link href="/bookings" className={linkCls}>
            Back to my bookings
          </Link>
        </p>
      </main>
    </FieldScopeProvider>
  );
}
