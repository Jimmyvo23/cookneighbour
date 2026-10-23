"use client";
// Customer search (T-040): a form, a results list (the main view, it works without the map) and an
// optional OpenStreetMap map. Built against docs/api-contract.md section 7 (v1.3). Everything on
// this page is public data: no address, phone or email is ever shown.
//
// Honest limits shown to the customer: "dietary needs" means allergens to avoid (A-17). Diets such
// as vegetarian or halal are not supported yet (Q-18). The date filter does not remove dates that
// are already booked (that arrives with bookings).
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ApiClientError, apiFetch } from "@/lib/api/client";
import type {
  PostalPrefix,
  PostalPrefixListResponse,
  PublicChefSearchQuery,
  PublicChefSearchItem,
  PublicChefSearchResponse,
} from "@/lib/api/types";
import { ALLERGEN_CHOICES } from "@/lib/chef/dishes";
import { torontoToday } from "@/lib/domain/dishes";
import {
  buildPins,
  buildQuery,
  chefPath,
  cityNames,
  dateWindow,
  emptySearchForm,
  firstErrorField,
  formErrorsFromApi,
  mergePage,
  parseSavedForm,
  queryString,
  resultsOrderLabel,
  SAVED_SEARCH_KEY,
  serializeForm,
  searchPoint,
  validateSearchForm,
  type FieldErrors,
  type SearchFormValues,
} from "@/lib/search/search";
import { FormAlert, SubmitButton } from "@/components/forms";
import { ResultCard } from "@/components/search/ResultCard";
import { ResultsMap } from "@/components/search/ResultsMap";
import { secondaryButtonCls } from "@/components/chef/parts";
import {
  EmptyPlate,
  HeroArt,
  PotMark,
  SprigMark,
} from "@/components/Ornaments";
import Link from "next/link";

type Results =
  | { kind: "idle" }
  | { kind: "loading" }
  | {
      kind: "ready";
      query: PublicChefSearchQuery;
      items: PublicChefSearchItem[];
      nextCursor: string | null;
    };

type Focus =
  | { kind: "heading" }
  | { kind: "item"; id: string }
  | { kind: "field"; name: string }
  | { kind: "alert" };

const inputCls = "control";

/** A labelled control with a hint and an error. `children` receives the props the control needs. */
function Field({
  label,
  name,
  hint,
  error,
  children,
}: {
  label: string;
  name: string;
  hint?: string;
  error?: string;
  children: (p: {
    id: string;
    "aria-invalid": true | undefined;
    "aria-describedby": string | undefined;
    "data-field": string;
  }) => React.ReactNode;
}) {
  const id = useId();
  const describedBy =
    [hint ? `${id}-hint` : "", error ? `${id}-error` : ""]
      .filter(Boolean)
      .join(" ") || undefined;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="font-bold">
        {label}
      </label>
      {hint && (
        <p id={`${id}-hint`} className="hint">
          {hint}
        </p>
      )}
      {children({
        id,
        "aria-invalid": error ? true : undefined,
        "aria-describedby": describedBy,
        "data-field": name,
      })}
      {error && (
        <p id={`${id}-error`} className="error-text">
          {error}
        </p>
      )}
    </div>
  );
}

function describeSearchError(err: unknown): string {
  if (err instanceof ApiClientError) {
    if (err.status === 422) return "Check the highlighted search fields.";
    if (err.code === "NETWORK" || err.code === "TIMEOUT") return err.message;
    if (err.status >= 500)
      return "The search is not working right now. Try again in a moment.";
    return err.message;
  }
  return "Something went wrong. Please try again.";
}

export function SearchView() {
  const [values, setValues] = useState<SearchFormValues>(emptySearchForm);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [results, setResults] = useState<Results>({ kind: "idle" });
  const [moreBusy, setMoreBusy] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  const [prefixes, setPrefixes] = useState<PostalPrefix[] | null>(null);
  const [prefixesFailed, setPrefixesFailed] = useState(false);
  const [today, setToday] = useState<string | null>(null);
  const [mapOpen, setMapOpen] = useState(false);
  const [activeCity, setActiveCity] = useState<string | null>(null);
  const [focus, setFocus] = useState<Focus | null>(null);

  const formRef = useRef<HTMLFormElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const alertId = useId();
  const mapId = useId();
  // Only the newest search may change the screen (a slow answer to an older search is ignored).
  const seq = useRef(0);

  // The GTA areas feed the city picker, the postal-code check and the map. Loaded once. The list
  // of results works without them.
  useEffect(() => {
    let current = true;
    apiFetch<PostalPrefixListResponse>("/api/reference/postal-prefixes").then(
      (r) => {
        if (!current) return;
        setPrefixes(r.items);
        setPrefixesFailed(false);
      },
      () => {
        if (current) setPrefixesFailed(true);
      },
    );
    return () => {
      current = false;
    };
  }, []);

  // The browser clock only sets the date picker's limits and a quick message (the server's window
  // is final). Read after the first render so the prerendered page never holds a stale date.
  // The map opens by itself on wide screens; on a phone it starts collapsed.
  useEffect(() => {
    setToday(torontoToday()); // eslint-disable-line react-hooks/set-state-in-effect -- browser clock, after mount
    if (window.matchMedia("(min-width: 1024px)").matches) setMapOpen(true);
  }, []);

  // Move focus after the screen has changed.
  useEffect(() => {
    if (!focus) return;
    if (focus.kind === "heading") headingRef.current?.focus();
    else if (focus.kind === "item")
      listRef.current
        ?.querySelector<HTMLElement>(
          `[data-chef-link="${CSS.escape(focus.id)}"]`,
        )
        ?.focus();
    else if (focus.kind === "field")
      formRef.current
        ?.querySelector<HTMLElement>(`[data-field="${CSS.escape(focus.name)}"]`)
        ?.focus();
    else document.getElementById(alertId)?.focus();
    setFocus(null); // eslint-disable-line react-hooks/set-state-in-effect -- one-shot focus request
  }, [focus, alertId]);

  const cities = useMemo(
    () => (prefixes ? cityNames(prefixes) : []),
    [prefixes],
  );
  const window_ = today ? dateWindow(today) : null;

  function set<K extends keyof SearchFormValues>(k: K, v: SearchFormValues[K]) {
    setValues((prev) => ({ ...prev, [k]: v }));
  }

  /** Field errors from the server (or the quick check), then focus to the first one. */
  function showErrors(fields: FieldErrors) {
    const mapped = formErrorsFromApi(fields);
    const first = firstErrorField(mapped);
    const known = first !== null && first !== "cursor" && first !== "limit";
    setErrors(mapped);
    setFormError(
      known
        ? "Check the highlighted search fields."
        : "That search was not valid.",
    );
    setFocus(
      known && first !== "locationType"
        ? { kind: "field", name: first }
        : { kind: "alert" },
    );
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    await runSearch(values);
  }

  /** Runs a search. `restoring` is a repeat of the last search when the page is opened again
   *  (back from a chef page): the server checks it, and nothing steals focus. */
  async function runSearch(v: SearchFormValues, restoring = false) {
    if (!restoring) {
      const local = validateSearchForm(v, {
        today: today ?? torontoToday(),
        prefixes,
      });
      setFormError(null);
      setErrors({});
      setMoreError(null);
      if (Object.keys(local).length) {
        showErrors(local);
        return;
      }
    }
    const query = buildQuery(v);
    const mine = ++seq.current;
    setResults({ kind: "loading" });
    setActiveCity(null);
    try {
      const r = await apiFetch<PublicChefSearchResponse>(
        `/api/chefs?${queryString(query)}`,
      );
      if (mine !== seq.current) return;
      setResults({
        kind: "ready",
        query,
        items: r.items,
        nextCursor: r.nextCursor,
      });
      try {
        sessionStorage.setItem(SAVED_SEARCH_KEY, serializeForm(v));
      } catch {
        // Storage can be blocked: the search still works, it is just not remembered.
      }
      if (!restoring) setFocus({ kind: "heading" });
    } catch (err) {
      if (mine !== seq.current) return;
      setResults({ kind: "idle" });
      if (restoring) {
        try {
          sessionStorage.removeItem(SAVED_SEARCH_KEY);
        } catch {
          // ignore
        }
        setFormError(
          "Your last search could not be repeated. Press Find chefs to try again.",
        );
      } else if (err instanceof ApiClientError && err.status === 422) {
        showErrors(err.fields);
      } else {
        setFormError(describeSearchError(err));
        setFocus({ kind: "alert" });
      }
    }
  }

  // Back from a chef page: fill the form with the last search and run it again.
  useEffect(() => {
    let saved: ReturnType<typeof parseSavedForm> = null;
    try {
      saved = parseSavedForm(sessionStorage.getItem(SAVED_SEARCH_KEY));
    } catch {
      // Storage blocked: start with an empty form.
    }
    if (!saved) return;
    setValues(saved); // eslint-disable-line react-hooks/set-state-in-effect -- restore once after mount
    void runSearch(saved, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once on mount
  }, []);

  async function loadMore() {
    if (results.kind !== "ready" || !results.nextCursor || moreBusy) return;
    const { query, nextCursor, items } = results;
    const mine = seq.current;
    setMoreBusy(true);
    setMoreError(null);
    try {
      const r = await apiFetch<PublicChefSearchResponse>(
        `/api/chefs?${queryString(query, nextCursor)}`,
      );
      if (mine !== seq.current) return; // a newer search replaced this list
      const merged = mergePage(items, r.items);
      setResults({
        kind: "ready",
        query,
        items: merged.items,
        nextCursor: r.nextCursor,
      });
      // To the first new result, so a keyboard user continues where the new ones begin.
      if (merged.firstNewId) setFocus({ kind: "item", id: merged.firstNewId });
    } catch (err) {
      if (mine !== seq.current) return;
      setMoreError(
        err instanceof ApiClientError && err.status === 422
          ? "Could not load more results. Run the search again."
          : describeSearchError(err),
      );
    } finally {
      setMoreBusy(false);
    }
  }

  const ready = results.kind === "ready" ? results : null;
  const pins = useMemo(
    () => (ready && prefixes ? buildPins(ready.items, prefixes) : []),
    [ready, prefixes],
  );
  const origin = useMemo(
    () => (ready && prefixes ? searchPoint(ready.query, prefixes) : null),
    [ready, prefixes],
  );
  const selectedPin = pins.find((p) => p.city === activeCity) ?? null;

  const anywhere = !values.postalCode.trim() && !values.city.trim();

  return (
    <main className="flex w-full flex-1 flex-col">
      <div className="hero">
        <div className="mx-auto grid w-full max-w-6xl items-center gap-6 px-4 lg:grid-cols-[1.25fr_0.75fr]">
          <div className="flex flex-col gap-4">
            <h1>
              Find a home cook
              <span className="title-rule" aria-hidden="true" />
            </h1>
            <p className="hero-tagline max-w-xl">
              Home-cooked food from your own culture, made by a neighbour.
            </p>
            <p className="max-w-prose text-lg text-[var(--hero-ink)]">
              Everything is optional. Tell us where you are and what you would
              like to eat, and we list approved home cooks, nearest first.
            </p>
          </div>
          <HeroArt className="hero-art mx-auto w-full max-w-[11rem] sm:max-w-md lg:max-w-lg" />
        </div>
      </div>

      <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-4 pb-12">
        <form
          ref={formRef}
          onSubmit={onSubmit}
          noValidate
          aria-label="Search for a chef"
          className="recipe-card relative z-10 -mt-[4.5rem] grid items-start gap-6 p-6 sm:p-9 lg:grid-cols-[1.35fr_1fr_0.7fr] lg:[&_.hint]:min-h-[3em]"
        >
          <div className="-mb-6 lg:col-span-full has-[.alert-box]:mb-0">
            <FormAlert message={formError} id={alertId} />
          </div>

          {/* Where, The food and the button share one row on wide screens. */}
          <fieldset className="flex flex-col gap-3">
            <legend className="group-title mb-3">Where</legend>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Postal code"
                name="postalCode"
                hint="Greater Toronto Area only, for example L5B 1A1 or just L5B."
                error={errors.postalCode}
              >
                {(p) => (
                  <input
                    {...p}
                    type="text"
                    autoComplete="postal-code"
                    value={values.postalCode}
                    onChange={(e) => set("postalCode", e.target.value)}
                    className={`${inputCls} control-lg`}
                  />
                )}
              </Field>
              <Field
                label="Or a city"
                name="city"
                hint={
                  prefixesFailed
                    ? "The list of cities could not be loaded. Use a postal code."
                    : "Use a postal code or a city, not both."
                }
                error={errors.city}
              >
                {(p) => (
                  <select
                    {...p}
                    value={values.city}
                    onChange={(e) => set("city", e.target.value)}
                    disabled={!prefixes}
                    className={`${inputCls} control-lg`}
                  >
                    <option value="">
                      {prefixes ? "No city chosen" : "Loading cities..."}
                    </option>
                    {cities.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
            </div>
          </fieldset>

          <fieldset className="flex flex-col gap-3">
            <legend className="group-title mb-3">The food</legend>
            <Field
              label="Cuisine"
              name="cuisine"
              hint="For example Vietnamese, Italian or Ghanaian."
              error={errors.cuisine}
            >
              {(p) => (
                <input
                  {...p}
                  type="text"
                  value={values.cuisine}
                  onChange={(e) => set("cuisine", e.target.value)}
                  className={`${inputCls} control-lg`}
                />
              )}
            </Field>
          </fieldset>

          {/* On a phone the button comes last (after the filters); here it sits in the hero row. */}
          <div className="order-last lg:order-none lg:self-end">
            <SubmitButton busy={results.kind === "loading"} className="btn-lg">
              Find chefs
            </SubmitButton>
          </div>

          {anywhere && (
            <p className="hint lg:col-span-full">
              With no postal code or city we list all approved chefs, best rated
              first, without distances.
            </p>
          )}

          <hr className="section-rule lg:col-span-full" />

          <div className="grid gap-8 lg:col-span-full lg:grid-cols-[1fr_1.35fr]">
            <div className="flex flex-col gap-6">
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-1 font-bold">
                  Where should the cooking happen?
                </legend>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                  <label className="tile">
                    <input
                      type="radio"
                      name="locationType"
                      data-field="locationType"
                      checked={values.locationType === "customer_home"}
                      onChange={() => set("locationType", "customer_home")}
                      className="size-5"
                    />
                    At my home
                  </label>
                  <label className="tile">
                    <input
                      type="radio"
                      name="locationType"
                      checked={values.locationType === "chef_home"}
                      onChange={() => set("locationType", "chef_home")}
                      className="size-5"
                    />
                    At the chef&apos;s home
                  </label>
                </div>
                <p className="hint">
                  {values.locationType === "customer_home"
                    ? 'Chefs who cannot reach you but cook at their own home are still listed, marked "Chef\'s home only".'
                    : "Only chefs whose kitchen an admin has approved are listed, wherever they are. The kitchen review is a MOCK check in this prototype."}
                </p>
              </fieldset>

              <Field
                label="Language the chef speaks (optional)"
                name="language"
                error={errors.language}
              >
                {(p) => (
                  <input
                    {...p}
                    type="text"
                    value={values.language}
                    onChange={(e) => set("language", e.target.value)}
                    className={inputCls}
                  />
                )}
              </Field>
            </div>

            <fieldset
              data-field="avoidAllergens"
              tabIndex={-1}
              aria-describedby={`${alertId}-allergens-note${errors.avoidAllergens ? ` ${alertId}-allergens-error` : ""}`}
              className="flex flex-col gap-1"
            >
              <legend className="font-bold">
                Allergens to avoid (optional)
              </legend>
              <p id={`${alertId}-allergens-note`} className="hint">
                We show chefs who have at least one dish without any allergen
                you tick. This is a shortcut, not an allergy guarantee: you will
                fill in an allergy form when you book. Diets such as vegetarian
                or halal are not supported yet.
              </p>
              {errors.avoidAllergens && (
                <p id={`${alertId}-allergens-error`} className="error-text">
                  {errors.avoidAllergens}
                </p>
              )}
              <div className="grid gap-x-4 sm:grid-cols-2">
                {ALLERGEN_CHOICES.map((a) => (
                  <label
                    key={a.value}
                    className="flex min-h-11 items-center gap-2"
                  >
                    <input
                      type="checkbox"
                      checked={values.avoidAllergens.includes(a.value)}
                      onChange={(e) =>
                        set(
                          "avoidAllergens",
                          e.target.checked
                            ? [...values.avoidAllergens, a.value]
                            : values.avoidAllergens.filter(
                                (x) => x !== a.value,
                              ),
                        )
                      }
                      className="size-5"
                    />
                    {a.label}
                  </label>
                ))}
              </div>
            </fieldset>
          </div>

          <fieldset className="flex flex-col gap-4 rounded-xl bg-sunken p-4 sm:p-5 lg:col-span-full">
            <legend className="mb-1 px-1 font-display text-lg font-bold text-muted">
              Price and date
            </legend>
            <div className="grid items-end gap-4 sm:grid-cols-3">
              <Field
                label="Lowest hourly rate ($)"
                name="minRate"
                error={errors.minRate}
              >
                {(p) => (
                  <input
                    {...p}
                    type="text"
                    inputMode="decimal"
                    value={values.minRate}
                    onChange={(e) => set("minRate", e.target.value)}
                    className={inputCls}
                  />
                )}
              </Field>
              <Field
                label="Highest hourly rate ($)"
                name="maxRate"
                error={errors.maxRate}
              >
                {(p) => (
                  <input
                    {...p}
                    type="text"
                    inputMode="decimal"
                    value={values.maxRate}
                    onChange={(e) => set("maxRate", e.target.value)}
                    className={inputCls}
                  />
                )}
              </Field>
              <Field
                label="Day you need a chef (optional)"
                name="date"
                hint={
                  window_ ? `From ${window_.min} to ${window_.max}.` : undefined
                }
                error={errors.date}
              >
                {(p) => (
                  <input
                    {...p}
                    type="date"
                    min={window_?.min}
                    max={window_?.max}
                    value={values.date}
                    onChange={(e) => set("date", e.target.value)}
                    className={inputCls}
                  />
                )}
              </Field>
            </div>
            <p className="hint">
              The day filter shows chefs who marked that day as free and are not
              already booked on it. Same-day booking is not possible.
            </p>
          </fieldset>
        </form>

        <section
          aria-labelledby={`${alertId}-results`}
          className="flex flex-col gap-4"
        >
          <div className="flex items-center gap-3">
            <h2
              id={`${alertId}-results`}
              ref={headingRef}
              tabIndex={-1}
              className="text-3xl"
            >
              Results
            </h2>
            <SprigMark className="h-8 w-14 shrink-0" />
          </div>
          <p role="status" data-testid="results-status" className="font-bold">
            {results.kind === "loading" && "Searching..."}
            {ready &&
              (ready.items.length === 0
                ? "No chefs match this search."
                : `Showing ${ready.items.length} ${ready.items.length === 1 ? "chef" : "chefs"}${ready.nextCursor ? ". More are available." : "."}`)}
          </p>

          {results.kind === "loading" && (
            <div aria-hidden="true" className="flex flex-col gap-4">
              <PotMark className="size-14 self-start" />
              {[0, 1].map((i) => (
                <div key={i} className="chef-card flex gap-5 p-5">
                  <div className="skeleton size-32 shrink-0" />
                  <div className="flex flex-1 flex-col gap-3">
                    <div className="skeleton h-7 w-2/3" />
                    <div className="skeleton h-5 w-1/3" />
                    <div className="skeleton h-5 w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {results.kind === "idle" && (
            <div className="flex items-center gap-4">
              <EmptyPlate className="size-24 shrink-0" />
              <p className="hint">
                Press &quot;Find chefs&quot; to see results.
              </p>
            </div>
          )}

          {ready && ready.items.length === 0 && (
            <div
              data-testid="empty-state"
              className="card flex flex-col items-start gap-3 p-6 sm:flex-row sm:items-center sm:gap-6"
            >
              <EmptyPlate className="size-28 shrink-0" />
              <div>
                <p className="font-display text-xl font-bold">
                  No approved chefs match.
                </p>
                <ul className="mt-2 list-disc pl-5">
                  <li>Remove the price, day or allergen filters.</li>
                  <li>Try a bigger area, such as the whole city.</li>
                  <li>
                    Try &quot;At the chef&apos;s home&quot; if you can travel to
                    a kitchen.
                  </li>
                </ul>
              </div>
            </div>
          )}

          {ready && ready.items.length > 0 && (
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
              <div className="flex min-w-0 flex-1 flex-col gap-4">
                <ol
                  ref={listRef}
                  aria-label={resultsOrderLabel(ready.query)}
                  className="flex flex-col gap-5"
                >
                  {ready.items.map((item) => (
                    <ResultCard
                      key={item.id}
                      item={item}
                      mapOpen={mapOpen && pins.length > 0}
                      selected={
                        activeCity !== null &&
                        item.serviceCity?.trim().toLowerCase() ===
                          activeCity.trim().toLowerCase()
                      }
                      onShowOnMap={(city) =>
                        setActiveCity((c) => (c === city ? null : city))
                      }
                    />
                  ))}
                </ol>
                {moreError && (
                  <p role="alert" className="error-text">
                    {moreError}
                  </p>
                )}
                {ready.nextCursor && (
                  <div>
                    <button
                      type="button"
                      onClick={loadMore}
                      aria-disabled={moreBusy}
                      className={secondaryButtonCls}
                    >
                      {moreBusy ? "Loading..." : "Load more"}
                    </button>
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-3 lg:sticky lg:top-4 lg:w-[26rem] lg:shrink-0">
                <div>
                  <button
                    type="button"
                    onClick={() => setMapOpen((o) => !o)}
                    aria-expanded={mapOpen}
                    aria-controls={mapId}
                    className={secondaryButtonCls}
                  >
                    {mapOpen ? "Hide map" : "Show map"}
                  </button>
                </div>
                <div
                  id={mapId}
                  hidden={!mapOpen}
                  className="flex flex-col gap-3"
                >
                  {mapOpen &&
                    (prefixes ? (
                      <>
                        <ResultsMap
                          pins={pins}
                          origin={origin}
                          activeCity={activeCity}
                          onSelect={(city) =>
                            setActiveCity((c) => (c === city ? null : city))
                          }
                        />
                        <p className="hint">
                          A number is how many of these chefs work around a
                          city. Pins are at the middle of the city&apos;s postal
                          areas, never at a home or kitchen.
                          {origin &&
                            ` The orange dot is your search area (${origin.label}).`}
                        </p>
                        <div aria-live="polite" data-testid="map-selection">
                          {selectedPin ? (
                            <div className="rounded-lg border-2 border-primary bg-surface p-3">
                              <p className="font-semibold">
                                {selectedPin.city}: {selectedPin.items.length}{" "}
                                {selectedPin.items.length === 1
                                  ? "chef"
                                  : "chefs"}
                              </p>
                              <ul className="mt-1 list-disc pl-5">
                                {selectedPin.items.map((i) => (
                                  <li key={i.id}>
                                    <Link
                                      href={chefPath(i.id)}
                                      className="underline"
                                    >
                                      {i.displayName}
                                    </Link>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          ) : (
                            <p className="hint">
                              Select a pin to mark its chefs in the list.
                            </p>
                          )}
                        </div>
                      </>
                    ) : (
                      <p role="status" className="card p-4">
                        {prefixesFailed
                          ? "The map could not be set up. The list has everything you need."
                          : "Loading the map..."}
                      </p>
                    ))}
                </div>
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
