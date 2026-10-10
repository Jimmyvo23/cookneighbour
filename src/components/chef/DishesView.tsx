"use client";
// Chef dish menu (T-034): list, create, edit, deactivate and reactivate (nothing is deleted).
// Built against docs/api-contract.md section 5A. Validation reuses the server's pure rules
// (src/lib/domain/dishes.ts through src/lib/chef/dishes.ts); the server stays the authority.
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { apiFetch, isMockEnabled } from "@/lib/api/client";
import type { ChefDishListResponse, Dish, MeResponse } from "@/lib/api/types";
import {
  ALLERGEN_CHOICES,
  LIMITS,
  MAX_ACTIVE_DISHES,
  activeCount,
  buildDishBody,
  describeDishError,
  dishPhotoUrl,
  dishToForm,
  eatByText,
  uploadRejected,
  emptyDishForm,
  formFieldErrors,
  formatDollars,
  formatMinutes,
  type DishFormValues,
} from "@/lib/chef/dishes";
import {
  UPLOAD_RULES,
  uploadForChef,
  validateUploadFile,
} from "@/lib/chef/upload";
import { SubmitButton, TextField } from "@/components/forms";
import {
  Alert,
  CheckboxRow,
  Notice,
  TextAreaField,
  buttonCls,
  cardCls,
  hintCls,
  secondaryButtonCls,
  useSection,
} from "@/components/chef/parts";

type Editing = null | { kind: "new" } | { kind: "edit"; id: string };

export function DishesView() {
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "error"; message: string }
    | { kind: "ready"; dishes: Dish[]; userId: string }
  >({ kind: "loading" });

  useEffect(() => {
    let current = true;
    Promise.all([
      apiFetch<MeResponse>("/api/me"),
      apiFetch<ChefDishListResponse>("/api/chef/dishes"),
    ]).then(
      ([me, list]) => {
        if (current)
          setState({
            kind: "ready",
            dishes: list.items,
            userId: me.profile.id,
          });
      },
      (err) => {
        if (current)
          setState({ kind: "error", message: describeDishError(err) });
      },
    );
    return () => {
      current = false;
    };
  }, []);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-5 px-4 py-6">
      <h1 className="text-2xl font-semibold tracking-tight">Your dishes</h1>
      {state.kind === "loading" && <p role="status">Loading your dishes...</p>}
      {state.kind === "error" && (
        <div
          role="alert"
          className="rounded-md border border-red-700 bg-red-50 p-3 text-sm text-red-900 dark:bg-red-950 dark:text-red-100"
        >
          {state.message}
        </div>
      )}
      {state.kind === "ready" && (
        <Menu
          dishes={state.dishes}
          userId={state.userId}
          setDishes={(dishes) => setState({ ...state, dishes })}
        />
      )}
    </main>
  );
}

function Menu({
  dishes,
  userId,
  setDishes,
}: {
  dishes: Dish[];
  userId: string;
  setDishes: (d: Dish[]) => void;
}) {
  const [editing, setEditing] = useState<Editing>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [focusTick, setFocusTick] = useState(0);
  const toggle = useSection();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const active = activeCount(dishes);

  // After the editor closes it is gone, so keyboard focus goes to the menu heading.
  useEffect(() => {
    if (focusTick) headingRef.current?.focus();
  }, [focusTick]);

  const editingDish =
    editing?.kind === "edit"
      ? (dishes.find((d) => d.id === editing.id) ?? null)
      : null;

  function saved(dish: Dish, wasNew: boolean) {
    setDishes(
      wasNew
        ? [dish, ...dishes]
        : dishes.map((d) => (d.id === dish.id ? dish : d)),
    );
    setEditing(null);
    setMessage(`${dish.name} was ${wasNew ? "added" : "saved"}.`);
    setFocusTick((t) => t + 1);
  }

  return (
    <>
      <p className={hintCls}>
        Add the dishes you cook. Customers will pick from your active dishes.
        You need at least one active dish with a photo to submit your{" "}
        <Link
          className="font-medium text-emerald-800 underline dark:text-emerald-300"
          href="/chef/apply"
        >
          application
        </Link>
        . Dishes are never deleted; deactivate one to hide it.
      </p>

      {editing && (editing.kind === "new" || editingDish) && (
        <DishEditor
          key={editing.kind === "new" ? "new" : editing.id}
          dish={editingDish}
          userId={userId}
          onSaved={saved}
          onCancel={() => {
            setEditing(null);
            setMessage(null);
            setFocusTick((t) => t + 1);
          }}
        />
      )}

      <section aria-labelledby="menu-heading" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2
            id="menu-heading"
            ref={headingRef}
            tabIndex={-1}
            className="text-lg font-semibold"
          >
            Menu
          </h2>
          <button
            type="button"
            className={buttonCls}
            disabled={editing?.kind === "new"}
            onClick={() => {
              setMessage(null);
              setEditing({ kind: "new" });
            }}
          >
            Add a dish
          </button>
        </div>
        <p data-testid="active-count" className={hintCls}>
          {active} of {MAX_ACTIVE_DISHES} active dishes.
        </p>
        <Notice message={message ?? toggle.notice} />
        <Alert id={toggle.alertId} message={toggle.error} />
        {dishes.length === 0 ? (
          <p>You have no dishes yet. Choose &quot;Add a dish&quot; to start.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {dishes.map((d) => (
              <DishCard
                key={d.id}
                dish={d}
                busy={toggle.busy}
                onEdit={() => {
                  setMessage(null);
                  setEditing({ kind: "edit", id: d.id });
                }}
                onToggle={() =>
                  void toggle.run(
                    async () => {
                      setMessage(null);
                      const next = await apiFetch<Dish>(
                        `/api/chef/dishes/${d.id}`,
                        { method: "PATCH", body: { isActive: !d.isActive } },
                      );
                      setDishes(dishes.map((x) => (x.id === d.id ? next : x)));
                    },
                    d.isActive
                      ? `${d.name} is now inactive.`
                      : `${d.name} is active again.`,
                    { describe: describeDishError },
                  )
                }
              />
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

/** The photo, or a plain placeholder when there is none or it cannot be loaded. */
export function DishPhoto({
  dish,
}: {
  dish: Pick<Dish, "name" | "photoPath">;
}) {
  const url = dishPhotoUrl(
    dish.photoPath,
    // MOCK photo paths are made up: never ask a real storage project for them.
    isMockEnabled() ? undefined : process.env.NEXT_PUBLIC_SUPABASE_URL,
  );
  const [failed, setFailed] = useState(false);
  if (url && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- user-uploaded Storage file; no fixed host for next/image
      <img
        src={url}
        alt={`Photo of ${dish.name}`}
        width={96}
        height={96}
        className="size-24 shrink-0 rounded-md object-cover"
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <div
      role="img"
      aria-label={`No photo to show for ${dish.name}`}
      data-testid="dish-photo-fallback"
      className="flex size-24 shrink-0 items-center justify-center rounded-md border border-dashed border-zinc-500 p-1 text-center text-xs text-zinc-700 dark:text-zinc-300"
    >
      {dish.photoPath ? "Photo not available" : "No photo yet"}
    </div>
  );
}

function DishCard({
  dish,
  busy,
  onEdit,
  onToggle,
}: {
  dish: Dish;
  busy: boolean;
  onEdit: () => void;
  onToggle: () => void;
}) {
  const nameId = useId();
  return (
    <li>
      <article
        aria-labelledby={nameId}
        className={`${cardCls} ${dish.isActive ? "" : "bg-zinc-50 dark:bg-zinc-900"}`}
      >
        <div className="flex gap-3">
          <DishPhoto dish={dish} />
          <div className="flex min-w-0 flex-col gap-1">
            <h3 id={nameId} className="text-base font-semibold break-words">
              {dish.name}{" "}
              <span
                data-testid="dish-status"
                className={`ml-1 rounded-md border px-2 py-0.5 text-xs font-bold ${
                  dish.isActive
                    ? "border-emerald-800 text-emerald-900 dark:text-emerald-200"
                    : "border-zinc-600 text-zinc-800 dark:text-zinc-200"
                }`}
              >
                {dish.isActive ? "Active" : "Inactive"}
              </span>
            </h3>
            <p className="text-sm">{dish.cuisine}</p>
            <p className="text-sm">
              {formatMinutes(dish.cookMinutes)} to cook, ingredients about{" "}
              {formatDollars(dish.ingredientCostCents)}, {dish.servings}{" "}
              {dish.servings === 1 ? "serving" : "servings"}
            </p>
            <p className="text-sm">{eatByText(dish.shelfLifeDays)}</p>
            <p className="text-sm">
              Allergens:{" "}
              {dish.allergens.length
                ? dish.allergens.join(", ")
                : "none listed"}
            </p>
            {dish.description && (
              <p className="text-sm break-words whitespace-pre-line">
                {dish.description}
              </p>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={secondaryButtonCls}
            aria-disabled={busy}
            aria-label={`Edit ${dish.name}`}
            onClick={() => !busy && onEdit()}
          >
            Edit
          </button>
          <button
            type="button"
            className={secondaryButtonCls}
            aria-disabled={busy}
            aria-label={`${dish.isActive ? "Deactivate" : "Reactivate"} ${dish.name}`}
            onClick={() => !busy && onToggle()}
          >
            {dish.isActive ? "Deactivate" : "Reactivate"}
          </button>
        </div>
      </article>
    </li>
  );
}

function DishEditor({
  dish,
  userId,
  onSaved,
  onCancel,
}: {
  dish: Dish | null;
  userId: string;
  onSaved: (d: Dish, wasNew: boolean) => void;
  onCancel: () => void;
}) {
  const s = useSection();
  const [v, setV] = useState<DishFormValues>(
    dish ? dishToForm(dish) : emptyDishForm(),
  );
  const headingRef = useRef<HTMLHeadingElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // A photo that was uploaded but whose save failed is reused on retry, not uploaded again.
  const uploaded = useRef<{ file: File; path: string } | null>(null);
  const fileId = useId();
  const fileHintId = useId();
  const e = s.fieldErrors;
  const set = <K extends keyof DishFormValues>(k: K, val: DishFormValues[K]) =>
    setV((cur) => ({ ...cur, [k]: val }));
  const rule = UPLOAD_RULES.dish_photo;

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <section aria-labelledby="editor-heading" className={cardCls}>
      <h2
        id="editor-heading"
        ref={headingRef}
        tabIndex={-1}
        className="text-lg font-semibold"
      >
        {dish ? `Edit ${dish.name}` : "Add a dish"}
      </h2>
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(ev) => {
          ev.preventDefault();
          if (s.busy) return;
          const file = fileRef.current?.files?.[0];
          const fileProblem = file
            ? validateUploadFile("dish_photo", file)
            : null;
          const built = buildDishBody(v, { mode: dish ? "update" : "create" });
          if (!built.body || fileProblem) {
            s.fail("Check the highlighted fields.", {
              ...built.errors,
              ...(fileProblem ? { photoPath: fileProblem } : {}),
            });
            return;
          }
          const body = { ...built.body };
          void s.run(
            async () => {
              if (file) {
                if (uploaded.current?.file !== file)
                  uploaded.current = {
                    file,
                    path: await uploadForChef("dish_photo", userId, file),
                  };
                body.photoPath = uploaded.current.path;
              }
              let saved: Dish;
              try {
                saved = dish
                  ? await apiFetch<Dish>(`/api/chef/dishes/${dish.id}`, {
                      method: "PATCH",
                      body,
                    })
                  : await apiFetch<Dish>("/api/chef/dishes", {
                      method: "POST",
                      body,
                    });
              } catch (err) {
                // Drop the upload only when the server refused that path; any other failure keeps it for the retry.
                if (uploadRejected(err)) uploaded.current = null;
                throw err;
              }
              onSaved(saved, !dish);
            },
            "Dish saved.",
            { describe: describeDishError, fields: formFieldErrors },
          );
        }}
      >
        <Alert id={s.alertId} message={s.error} />
        <TextField
          label="Dish name"
          name="name"
          autoComplete="off"
          value={v.name}
          onChange={(ev) => set("name", ev.target.value)}
          error={e.name}
          hint="For example Pho bo. Up to 120 characters."
        />
        <TextField
          label="Cuisine"
          name="cuisine"
          autoComplete="off"
          value={v.cuisine}
          onChange={(ev) => set("cuisine", ev.target.value)}
          error={e.cuisine}
          hint="For example Vietnamese. Up to 40 characters."
        />
        <TextAreaField
          label="Description (optional)"
          name="description"
          value={v.description}
          onChange={(ev) => set("description", ev.target.value)}
          error={e.description}
          hint="What is in it and how it tastes. Up to 1000 characters."
        />
        <TextField
          label="Cooking time (minutes)"
          name="cookMinutes"
          inputMode="numeric"
          value={v.cookMinutes}
          onChange={(ev) => set("cookMinutes", ev.target.value)}
          error={e.cookMinutes}
          hint={`${LIMITS.cookMinutes[0]} to ${LIMITS.cookMinutes[1]} minutes. One visit should stay under 6 hours in total.`}
        />
        <TextField
          label="Estimated ingredient cost (CAD dollars)"
          name="ingredientCostCents"
          inputMode="decimal"
          value={v.cost}
          onChange={(ev) => set("cost", ev.target.value)}
          error={e.ingredientCostCents}
          hint="About what the groceries for one batch cost, for example 25.00. From $0.00 to $500.00."
        />
        <TextField
          label="Servings"
          name="servings"
          inputMode="numeric"
          value={v.servings}
          onChange={(ev) => set("servings", ev.target.value)}
          error={e.servings}
          hint={`${LIMITS.servings[0]} to ${LIMITS.servings[1]}.`}
        />
        <TextField
          label="Eat-by days (shelf life)"
          name="shelfLifeDays"
          inputMode="numeric"
          value={v.shelfLifeDays}
          onChange={(ev) => set("shelfLifeDays", ev.target.value)}
          error={e.shelfLifeDays}
          hint={`How many days after cooking the meal should be eaten. ${LIMITS.shelfLifeDays[0]} to ${LIMITS.shelfLifeDays[1]}; 2 is the usual default. This is not food-safety advice.`}
        />
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium">
            Allergens in this dish
          </legend>
          <p className={hintCls}>
            Tick every allergen this dish contains. Add any others below.
          </p>
          {ALLERGEN_CHOICES.map((a) => (
            <CheckboxRow
              key={a.value}
              id={`allergen-${a.value.replace(/\s+/g, "-")}`}
              checked={v.allergens.includes(a.value)}
              onChange={(on) =>
                set(
                  "allergens",
                  on
                    ? [...v.allergens, a.value]
                    : v.allergens.filter((x) => x !== a.value),
                )
              }
            >
              {a.label}
            </CheckboxRow>
          ))}
        </fieldset>
        <TextField
          label="Other allergens (optional)"
          name="otherAllergens"
          autoComplete="off"
          value={v.otherAllergens}
          onChange={(ev) => set("otherAllergens", ev.target.value)}
          error={e.allergens}
          hint="Separate with commas, for example celery, lupin. Up to 14 allergens in total."
        />
        <div className="flex flex-col gap-1">
          <label htmlFor={fileId} className="text-sm font-medium">
            Dish photo
          </label>
          <p id={fileHintId} className={hintCls}>
            {dish?.photoPath
              ? "A photo is saved. Choose a file to replace it. "
              : "Add a clear photo of the dish (needed for your application). "}
            {rule.allowedText}. Anyone with the link can open dish photos.
          </p>
          {dish && (
            <div className="my-1">
              <DishPhoto dish={dish} />
            </div>
          )}
          <input
            ref={fileRef}
            id={fileId}
            type="file"
            accept={Object.keys(rule.types).join(",")}
            aria-describedby={[fileHintId, e.photoPath ? `${fileId}-error` : ""]
              .filter(Boolean)
              .join(" ")}
            aria-invalid={e.photoPath ? true : undefined}
            className="min-h-11 text-base"
          />
          {e.photoPath && (
            <p
              id={`${fileId}-error`}
              className="text-sm font-medium text-red-700 dark:text-red-400"
            >
              {e.photoPath}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <SubmitButton busy={s.busy}>
            {dish ? "Save dish" : "Add dish"}
          </SubmitButton>
          <button
            type="button"
            className={secondaryButtonCls}
            disabled={s.busy}
            onClick={onCancel}
          >
            Cancel
          </button>
        </div>
        <Notice message={s.notice} />
      </form>
    </section>
  );
}
