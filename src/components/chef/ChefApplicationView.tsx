"use client";
// Chef application UI (T-033): profile, documents, kitchen, acknowledgements, submit, status.
// Built against docs/api-contract.md section 5. Every check status here is a MOCK: nothing is
// verified automatically; an admin records the outcome by hand (T-035).
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { apiFetch, isMockEnabled } from "@/lib/api/client";
import type {
  ChefApplication,
  LocationType,
  MeResponse,
  MockCheckStatus,
  RegisterDocumentRequest,
  RegisterDocumentResponse,
  RemoveDocumentRequest,
  SubmitApplicationResponse,
  UpdateChefApplicationRequest,
} from "@/lib/api/types";
import {
  buildKitchenPatch,
  buildProfilePatch,
  centsToDollars,
  checkStatusText,
  describeError,
  describeMissing,
  statusView,
} from "@/lib/chef/form";
import {
  UPLOAD_RULES,
  UploadError,
  browserUploader,
  mockUploader,
  uploadChefFile,
  validateUploadFile,
} from "@/lib/chef/upload";
import type { StorageTarget } from "@/lib/domain/chef-application";
import { displayNameProblem } from "@/lib/validation/auth";
import { MockBadge } from "@/components/MockBadge";
import { SubmitButton, TextField } from "@/components/forms";
import {
  Alert,
  CheckboxRow,
  Notice,
  Section,
  TextAreaField,
  buttonCls,
  cardCls,
  hintCls,
  secondaryButtonCls,
  useSection,
} from "@/components/chef/parts";

const linkCls = "font-medium text-emerald-800 underline dark:text-emerald-300";

// Wording of the two acknowledgements: confirmed by Jimmy as the prototype wording (D-14). It is
// still not legal text; the UI says so next to each statement.
const ALLERGEN_STATEMENT =
  "I understand that customers can have food allergies. I will read each customer's allergy and dietary form before I accept a booking, and I will tell the customer about any allergen in the dishes I cook.";
const HYGIENE_STATEMENT =
  "I will keep my kitchen clean, wash my hands, keep raw and cooked food apart, and store food safely.";

type Setter = (a: ChefApplication) => void;

async function patchApplication(body: UpdateChefApplicationRequest) {
  return apiFetch<ChefApplication>("/api/chef/application", {
    method: "PATCH",
    body,
  });
}

/** Upload a file to Storage with a fresh name. Returns the object path. */
async function uploadFile(
  target: StorageTarget,
  userId: string,
  file: File,
): Promise<string> {
  const uploader = isMockEnabled() ? mockUploader : await browserUploader(); // MOCK: no storage
  const { path } = await uploadChefFile(target, userId, file, uploader);
  return path;
}

export function ChefApplicationView() {
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "error"; message: string }
    | { kind: "ready"; app: ChefApplication; userId: string }
  >({ kind: "loading" });

  useEffect(() => {
    let current = true;
    Promise.all([
      apiFetch<MeResponse>("/api/me"),
      apiFetch<ChefApplication>("/api/chef/application"),
    ]).then(
      ([me, app]) => {
        if (current) setState({ kind: "ready", app, userId: me.profile.id });
      },
      (err) => {
        if (current) setState({ kind: "error", message: describeError(err) });
      },
    );
    return () => {
      current = false;
    };
  }, []);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-5 px-4 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">
        Chef application
      </h1>
      {state.kind === "loading" && (
        <p role="status">Loading your application...</p>
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
        <Body
          app={state.app}
          userId={state.userId}
          setApp={(app) => setState({ ...state, app })}
        />
      )}
    </main>
  );
}

function Body({
  app,
  userId,
  setApp,
}: {
  app: ChefApplication;
  userId: string;
  setApp: Setter;
}) {
  const chefHome = app.locationOptions.includes("chef_home");
  return (
    <>
      <StatusPanel app={app} />
      <NameSection app={app} setApp={setApp} />
      <ProfileSection app={app} userId={userId} setApp={setApp} />
      <DocumentsSection app={app} userId={userId} setApp={setApp} />
      {chefHome && <KitchenSection app={app} userId={userId} setApp={setApp} />}
      <AllergenSection app={app} setApp={setApp} />
      <SubmitSection app={app} setApp={setApp} />
    </>
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
      <span className="font-medium">{checkStatusText(status)}</span>
    </li>
  );
}

function StatusPanel({ app }: { app: ChefApplication }) {
  const v = statusView(app);
  const tone =
    v.kind === "approved"
      ? "border-emerald-700 bg-emerald-50 text-emerald-950 dark:bg-emerald-950 dark:text-emerald-100"
      : v.kind === "rejected"
        ? "border-red-700 bg-red-50 text-red-950 dark:bg-red-950 dark:text-red-100"
        : "border-zinc-400 bg-zinc-50 text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100";
  return (
    <section
      aria-labelledby="status-heading"
      className={`flex flex-col gap-3 rounded-lg border-2 p-4 ${tone}`}
    >
      <h2 id="status-heading" className="text-lg font-semibold">
        Status: <span data-testid="application-status">{v.title}</span>
      </h2>
      <p>{v.text}</p>
      <div>
        <p className="font-medium">Checks</p>
        <p className="text-sm">
          MOCK: these checks are simulated. Nothing is verified automatically;
          an admin sets each result by hand.
        </p>
        <ul className="mt-2 flex flex-col gap-2">
          <CheckLine label="Government ID check" status={app.checks.id} />
          <CheckLine
            label="Food Handler Certificate check"
            status={app.checks.foodHandler}
          />
          {app.locationOptions.includes("chef_home") && (
            <CheckLine label="Kitchen check" status={app.checks.kitchen} />
          )}
          <CheckLine
            label="Police check (not run in this prototype)"
            status={app.checks.police}
          />
        </ul>
      </div>
    </section>
  );
}

function NameSection({
  app,
  setApp,
}: {
  app: ChefApplication;
  setApp: Setter;
}) {
  const s = useSection();
  const [name, setName] = useState(
    app.displayName === "New user" ? "" : app.displayName,
  );
  return (
    <Section title="Display name">
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          const trimmed = name.trim();
          const problem = displayNameProblem(trimmed);
          if (problem) {
            s.fail("Check the highlighted fields.", { displayName: problem });
            return;
          }
          void s.run(async () => {
            await apiFetch("/api/me", {
              method: "PATCH",
              body: { displayName: trimmed },
            });
            setApp(await apiFetch<ChefApplication>("/api/chef/application"));
          }, "Name saved.");
        }}
      >
        <Alert id={s.alertId} message={s.error} />
        <TextField
          label="Display name"
          name="displayName"
          autoComplete="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={s.fieldErrors.displayName}
          hint="Shown publicly on your chef profile."
        />
        <SubmitButton busy={s.busy}>Save name</SubmitButton>
        <Notice message={s.notice} />
      </form>
    </Section>
  );
}

function ProfileSection({
  app,
  userId,
  setApp,
}: {
  app: ChefApplication;
  userId: string;
  setApp: Setter;
}) {
  const s = useSection();
  const [bio, setBio] = useState(app.bio ?? "");
  const [cuisines, setCuisines] = useState(app.cuisines.join(", "));
  const [languages, setLanguages] = useState(app.languages.join(", "));
  const [rate, setRate] = useState(centsToDollars(app.hourlyRateCents));
  const [prefix, setPrefix] = useState(app.servicePostalPrefix ?? "");
  const [radius, setRadius] = useState(String(app.serviceRadiusKm));
  const [options, setOptions] = useState<LocationType[]>(app.locationOptions);
  const toggle = (o: LocationType, on: boolean) =>
    setOptions((cur) =>
      on ? [...new Set([...cur, o])] : cur.filter((x) => x !== o),
    );
  const e = s.fieldErrors;

  return (
    <Section title="Profile and service area">
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(ev) => {
          ev.preventDefault();
          if (s.busy) return;
          const built = buildProfilePatch({
            bio,
            cuisines,
            languages,
            rate,
            prefix,
            radius,
            locationOptions: options,
          });
          if (!built.body) {
            s.fail("Check the highlighted fields.", built.errors);
            return;
          }
          const body = built.body;
          void s.run(
            async () => setApp(await patchApplication(body)),
            "Profile saved.",
          );
        }}
      >
        <Alert id={s.alertId} message={s.error} />
        <TextAreaField
          label="Bio"
          name="bio"
          value={bio}
          onChange={(ev) => setBio(ev.target.value)}
          error={e.bio}
          hint="A few sentences about you and your cooking. Shown publicly."
        />
        <TextField
          label="Cuisines"
          name="cuisines"
          value={cuisines}
          onChange={(ev) => setCuisines(ev.target.value)}
          error={e.cuisines}
          hint="Separate with commas, for example Vietnamese, Thai. Up to 10."
        />
        <TextField
          label="Languages you speak"
          name="languages"
          value={languages}
          onChange={(ev) => setLanguages(ev.target.value)}
          error={e.languages}
          hint="Separate with commas, for example English, Vietnamese."
        />
        <TextField
          label="Hourly rate (CAD per hour)"
          name="hourlyRateCents"
          inputMode="decimal"
          value={rate}
          onChange={(ev) => setRate(ev.target.value)}
          error={e.hourlyRateCents}
          hint="Between $5.00 and $200.00."
        />
        <TextField
          label="Postal code area you serve"
          name="servicePostalPrefix"
          autoComplete="off"
          maxLength={3}
          value={prefix}
          onChange={(ev) => setPrefix(ev.target.value)}
          error={e.servicePostalPrefix}
          hint="The first 3 characters of a Greater Toronto Area postal code, for example L5B."
        />
        <TextField
          label="Service radius (km)"
          name="serviceRadiusKm"
          inputMode="numeric"
          value={radius}
          onChange={(ev) => setRadius(ev.target.value)}
          error={e.serviceRadiusKm}
          hint="How far you will travel to a customer's home."
        />
        <fieldset
          className="flex flex-col gap-2"
          aria-describedby={
            e.locationOptions ? "field-locationOptions-error" : undefined
          }
        >
          <legend className="text-sm font-medium">Where you can cook</legend>
          <CheckboxRow
            id="loc-customer"
            invalid={Boolean(e.locationOptions)}
            checked={options.includes("customer_home")}
            onChange={(on) => toggle("customer_home", on)}
          >
            At the customer&apos;s home
          </CheckboxRow>
          <CheckboxRow
            id="loc-chef"
            checked={options.includes("chef_home")}
            onChange={(on) => toggle("chef_home", on)}
          >
            At my home (needs a kitchen address, kitchen photos and a kitchen
            review)
          </CheckboxRow>
          {e.locationOptions && (
            <p
              id="field-locationOptions-error"
              className="text-sm font-medium text-red-700 dark:text-red-400"
            >
              {e.locationOptions}
            </p>
          )}
        </fieldset>
        <SubmitButton busy={s.busy}>Save profile</SubmitButton>
        <Notice message={s.notice} />
      </form>
      <ProfilePhoto app={app} userId={userId} setApp={setApp} />
    </Section>
  );
}

function ProfilePhoto({
  app,
  userId,
  setApp,
}: {
  app: ChefApplication;
  userId: string;
  setApp: Setter;
}) {
  return (
    <div className="flex flex-col gap-2 border-t border-zinc-300 pt-4 dark:border-zinc-700">
      <h3 className="font-medium">Profile photo</h3>
      <p className={hintCls}>
        {app.photoPath ? "A profile photo is saved." : "No profile photo yet."}{" "}
        Your photo appears on your chef profile, and anyone with its link can
        open it.
      </p>
      <UploadControl
        label="Choose a profile photo"
        buttonText={app.photoPath ? "Replace photo" : "Upload photo"}
        target="profile_photo"
        userId={userId}
        onUploaded={async (path) =>
          setApp(await patchApplication({ photoPath: path }))
        }
      />
    </div>
  );
}

function DocumentsSection({
  app,
  userId,
  setApp,
}: {
  app: ChefApplication;
  userId: string;
  setApp: Setter;
}) {
  const register =
    (kind: RegisterDocumentRequest["kind"]) => async (path: string) => {
      const r = await apiFetch<RegisterDocumentResponse>(
        "/api/chef/application/documents",
        {
          method: "POST",
          body: { kind, path } satisfies RegisterDocumentRequest,
        },
      );
      setApp(r.application);
    };
  return (
    <Section title="Documents">
      <p className={hintCls}>
        Your ID and certificate are stored in a private folder. Only
        CookNeighbour admins can open them, and you cannot view them again after
        uploading. <strong>MOCK:</strong> no one checks them automatically in
        this prototype. If a file was already reviewed, uploading a new one
        sends its check back to pending review.
      </p>
      <div className="flex flex-col gap-2">
        <h3 className="font-medium">Government ID</h3>
        <p className={hintCls}>
          {app.documents.idDocumentPath ? "A file is saved." : "No file yet."}{" "}
          <span className="inline-flex items-center gap-1">
            ID check <MockBadge>MOCK</MockBadge>{" "}
            {checkStatusText(app.checks.id)}
          </span>
        </p>
        <UploadControl
          label="Choose your government ID file"
          buttonText={app.documents.idDocumentPath ? "Replace ID" : "Upload ID"}
          target="id_document"
          userId={userId}
          onUploaded={register("id_document")}
        />
      </div>
      <div className="flex flex-col gap-2">
        <h3 className="font-medium">Food Handler Certificate</h3>
        <p className={hintCls}>
          {app.documents.foodHandlerPath ? "A file is saved." : "No file yet."}{" "}
          <span className="inline-flex items-center gap-1">
            Certificate check <MockBadge>MOCK</MockBadge>{" "}
            {checkStatusText(app.checks.foodHandler)}
          </span>
        </p>
        <UploadControl
          label="Choose your Food Handler Certificate file"
          buttonText={
            app.documents.foodHandlerPath
              ? "Replace certificate"
              : "Upload certificate"
          }
          target="food_handler"
          userId={userId}
          onUploaded={register("food_handler")}
        />
      </div>
    </Section>
  );
}

function KitchenSection({
  app,
  userId,
  setApp,
}: {
  app: ChefApplication;
  userId: string;
  setApp: Setter;
}) {
  const addr = useSection();
  const photos = useSection();
  const hygiene = useSection();
  const [line, setLine] = useState(app.kitchenAddress?.line ?? "");
  const [city, setCity] = useState(app.kitchenAddress?.city ?? "");
  const [postal, setPostal] = useState(app.kitchenAddress?.postalCode ?? "");
  const [ack, setAck] = useState(false);
  const [headingTick, setHeadingTick] = useState(0);
  useEffect(() => {
    if (headingTick) document.getElementById("kitchen-photos-heading")?.focus();
  }, [headingTick]);
  const e = addr.fieldErrors;
  const paths = app.documents.kitchenPhotoPaths;
  return (
    <Section title="Your kitchen (cooking at your home)">
      <p className={hintCls}>
        Kitchen check <MockBadge>MOCK</MockBadge>{" "}
        {checkStatusText(app.checks.kitchen)}. Cooking at your home is switched
        on by an admin after a MOCK kitchen review. It is currently{" "}
        <strong>{app.chefHomeEnabled ? "on" : "off"}</strong>. Changing your
        kitchen address or photos switches it off and sends the kitchen back for
        review. Your kitchen address is not shown on your public chef profile.
      </p>
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(ev) => {
          ev.preventDefault();
          if (addr.busy) return;
          const built = buildKitchenPatch({ line, city, postalCode: postal });
          if (!built.body) {
            addr.fail("Check the highlighted fields.", built.errors);
            return;
          }
          const body = built.body;
          void addr.run(
            async () => setApp(await patchApplication(body)),
            "Kitchen address saved.",
          );
        }}
      >
        <Alert id={addr.alertId} message={addr.error} />
        <TextField
          label="Kitchen street address"
          name="kitchenAddress.line"
          autoComplete="off"
          value={line}
          onChange={(ev) => setLine(ev.target.value)}
          error={e["kitchenAddress.line"]}
        />
        <TextField
          label="Kitchen city"
          name="kitchenAddress.city"
          autoComplete="off"
          value={city}
          onChange={(ev) => setCity(ev.target.value)}
          error={e["kitchenAddress.city"]}
        />
        <TextField
          label="Kitchen postal code"
          name="kitchenAddress.postalCode"
          autoComplete="off"
          value={postal}
          onChange={(ev) => setPostal(ev.target.value)}
          error={e["kitchenAddress.postalCode"]}
          hint="Greater Toronto Area only, for example L5B 1M2."
        />
        <SubmitButton busy={addr.busy}>Save kitchen address</SubmitButton>
        <Notice message={addr.notice} />
      </form>

      <div className="flex flex-col gap-2 border-t border-zinc-300 pt-4 dark:border-zinc-700">
        <h3 id="kitchen-photos-heading" tabIndex={-1} className="font-medium">
          Kitchen photos ({paths.length} of 10)
        </h3>
        <p className={hintCls}>
          Add at least one clear photo of your kitchen. Removing a photo takes
          it off your application and also tries to delete the file (if that
          fails, the file may stay stored). You cannot replace a photo in place:
          add a new one instead.
        </p>
        <Alert id={photos.alertId} message={photos.error} />
        <Notice message={photos.notice} />
        <ul className="flex flex-col gap-2">
          {paths.map((p, i) => (
            <li key={p} className="flex items-center justify-between gap-2">
              <span>Kitchen photo {i + 1}</span>
              <button
                type="button"
                className={secondaryButtonCls}
                disabled={photos.busy}
                aria-label={`Remove kitchen photo ${i + 1}`}
                onClick={() =>
                  void photos.run(
                    async () => {
                      const r = await apiFetch<RegisterDocumentResponse>(
                        "/api/chef/application/documents",
                        {
                          method: "DELETE",
                          body: {
                            kind: "kitchen_photo",
                            path: p,
                          } satisfies RemoveDocumentRequest,
                        },
                      );
                      setApp(r.application);
                      // The Remove button is gone now: keep keyboard focus in this section.
                      setHeadingTick((t) => t + 1);
                    },
                    `Kitchen photo ${i + 1} removed.`,
                  )
                }
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
        <UploadControl
          label="Choose a kitchen photo"
          buttonText="Add kitchen photo"
          target="kitchen_photo"
          userId={userId}
          onUploaded={async (path) => {
            const r = await apiFetch<RegisterDocumentResponse>(
              "/api/chef/application/documents",
              {
                method: "POST",
                body: {
                  kind: "kitchen_photo",
                  path,
                } satisfies RegisterDocumentRequest,
              },
            );
            setApp(r.application);
          }}
        />
      </div>

      <div className="flex flex-col gap-2 border-t border-zinc-300 pt-4 dark:border-zinc-700">
        <h3 className="flex flex-wrap items-center gap-2 font-medium">
          Kitchen hygiene acknowledgement <MockBadge>MOCK</MockBadge>
        </h3>
        <p className={hintCls} id="hygiene-statement">
          {HYGIENE_STATEMENT} (MOCK: nobody checks this in the prototype. This
          is not legal advice.)
        </p>
        {app.kitchenHygieneAckAt ? (
          <p>
            Acknowledged on{" "}
            {new Date(app.kitchenHygieneAckAt).toLocaleDateString("en-CA")}.
          </p>
        ) : (
          <form
            noValidate
            className="flex flex-col gap-3"
            onSubmit={(ev) => {
              ev.preventDefault();
              if (!ack) {
                hygiene.fail("Tick the box to acknowledge the statement.");
                return;
              }
              void hygiene.run(
                async () =>
                  setApp(
                    await patchApplication({ acknowledgeKitchenHygiene: true }),
                  ),
                "Acknowledgement saved.",
              );
            }}
          >
            <Alert id={hygiene.alertId} message={hygiene.error} />
            <CheckboxRow
              id="ack-hygiene"
              checked={ack}
              onChange={setAck}
              describedBy="hygiene-statement"
            >
              I acknowledge the kitchen-hygiene statement
            </CheckboxRow>
            <SubmitButton busy={hygiene.busy}>
              Save acknowledgement
            </SubmitButton>
            <Notice message={hygiene.notice} />
          </form>
        )}
      </div>
    </Section>
  );
}

function AllergenSection({
  app,
  setApp,
}: {
  app: ChefApplication;
  setApp: Setter;
}) {
  const s = useSection();
  const [ack, setAck] = useState(false);
  return (
    <Section title="Allergen awareness">
      <p className={hintCls} id="allergen-statement">
        {ALLERGEN_STATEMENT} (This is not legal advice.)
      </p>
      {app.allergenAckAt ? (
        <p>
          Acknowledged on{" "}
          {new Date(app.allergenAckAt).toLocaleDateString("en-CA")}.
        </p>
      ) : (
        <form
          noValidate
          className="flex flex-col gap-3"
          onSubmit={(ev) => {
            ev.preventDefault();
            if (!ack) {
              s.fail("Tick the box to acknowledge the statement.");
              return;
            }
            void s.run(
              async () =>
                setApp(
                  await patchApplication({
                    acknowledgeAllergenStatement: true,
                  }),
                ),
              "Acknowledgement saved.",
            );
          }}
        >
          <Alert id={s.alertId} message={s.error} />
          <CheckboxRow
            id="ack-allergen"
            checked={ack}
            onChange={setAck}
            describedBy="allergen-statement"
          >
            I acknowledge the allergen-awareness statement
          </CheckboxRow>
          <SubmitButton busy={s.busy}>Save acknowledgement</SubmitButton>
          <Notice message={s.notice} />
        </form>
      )}
    </Section>
  );
}

function SubmitSection({
  app,
  setApp,
}: {
  app: ChefApplication;
  setApp: Setter;
}) {
  const s = useSection();
  const approved = app.status === "approved";
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className={cardCls}>
      <h2 id={headingId} className="text-lg font-semibold">
        Submit for review
      </h2>
      {app.missing.length > 0 ? (
        <div>
          <p className="font-medium">Still needed before you can submit:</p>
          <ul className="list-disc pl-6" data-testid="missing-list">
            {app.missing.map((m) => (
              <li key={m}>
                {describeMissing(m)}
                {m === "sampleDish" && (
                  <>
                    {" "}
                    <Link className={linkCls} href="/chef/dishes">
                      Add a dish
                    </Link>
                  </>
                )}
                {m === "phoneVerified" && (
                  <>
                    {" "}
                    <Link className={linkCls} href="/verify-phone">
                      Verify your phone
                    </Link>
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p>Everything needed is in place.</p>
      )}
      <form
        noValidate
        className="flex flex-col gap-3"
        onSubmit={(ev) => {
          ev.preventDefault();
          void s.run(async () => {
            const r = await apiFetch<SubmitApplicationResponse>(
              "/api/chef/application/submit",
              { method: "POST" },
            );
            setApp(r.application);
          }, "Submitted. MOCK: nothing is verified automatically; an admin reviews it by hand.");
        }}
      >
        <Alert id={s.alertId} message={s.error} />
        <button
          type="submit"
          className={buttonCls}
          disabled={s.busy || approved}
        >
          {s.busy
            ? "Please wait..."
            : approved
              ? "Already approved"
              : app.status === "rejected"
                ? "Submit again"
                : "Submit application"}
        </button>
        <Notice message={s.notice} />
      </form>
    </section>
  );
}

/** File input plus an upload button. Validates the file, uploads it under a fresh name, then calls
 *  `onUploaded(path)` to register it with the API. Errors are shown and take focus. */
function UploadControl({
  label,
  buttonText,
  target,
  userId,
  onUploaded,
}: {
  label: string;
  buttonText: string;
  target: StorageTarget;
  userId: string;
  onUploaded: (path: string) => Promise<void>;
}) {
  const s = useSection();
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const hintId = useId();
  const rule = UPLOAD_RULES[target];
  return (
    <form
      noValidate
      className="flex flex-col gap-2"
      onSubmit={(ev) => {
        ev.preventDefault();
        const file = inputRef.current?.files?.[0];
        const problem = validateUploadFile(target, file);
        if (problem || !file) {
          s.fail(problem ?? "Choose a file first.");
          return;
        }
        void s.run(async () => {
          const path = await uploadFile(target, userId, file);
          try {
            await onUploaded(path);
          } catch (err) {
            throw new UploadError(
              `${describeError(err)} The file was uploaded but not added to your application. Choose the file and try again.`,
            );
          }
          if (inputRef.current) inputRef.current.value = "";
        }, "Uploaded and saved.");
      }}
    >
      <Alert id={s.alertId} message={s.error} />
      <label htmlFor={inputId} className="text-sm font-medium">
        {label}
      </label>
      <p id={hintId} className={hintCls}>
        {rule.allowedText}.
      </p>
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept={Object.keys(rule.types).join(",")}
        aria-describedby={hintId}
        className="min-h-11 text-base"
      />
      <button type="submit" className={secondaryButtonCls} disabled={s.busy}>
        {s.busy ? "Uploading..." : buttonText}
      </button>
      <Notice message={s.notice} />
    </form>
  );
}
