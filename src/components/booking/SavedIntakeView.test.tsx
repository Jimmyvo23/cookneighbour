// @vitest-environment jsdom
// T-067: the saved allergy profile page (view, save, update, delete) against contract 4A.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SavedIntakeView } from "@/components/booking/SavedIntakeView";
import {
  apiError,
  callsTo,
  harness,
  json,
  routes,
  type Harness,
} from "@/components/booking/testkit";

const SAVED = {
  noAllergies: false,
  allergens: ["peanuts"],
  allergyNotes: "EpiPen",
  noDietaryNeeds: true,
  dietaryNotes: "",
};
const AT = "2030-01-05T15:00:00.000Z";

let h: Harness;
beforeEach(() => {
  h = harness();
});
afterEach(() => h.cleanup());

const box = (label: string) =>
  [...h.host.querySelectorAll("input")].find((i) =>
    i.labels?.[0]?.textContent?.includes(label),
  ) as HTMLInputElement;
const area = (label: string) =>
  [...h.host.querySelectorAll("textarea")].find((i) =>
    i.labels?.[0]?.textContent?.includes(label),
  ) as HTMLTextAreaElement;

describe("SavedIntakeView", () => {
  it("shows an empty state when nothing is saved", async () => {
    routes(h.fetchMock, {
      "GET /api/me/intake": json(200, { intake: null, savedAt: null }),
    });
    await h.mount(<SavedIntakeView />);
    expect(h.text()).toContain("Nothing is saved yet");
    expect(h.button("Delete saved profile")).toBeNull();
  });

  it("fills the form from the saved profile and shows the save date", async () => {
    routes(h.fetchMock, {
      "GET /api/me/intake": json(200, { intake: SAVED, savedAt: AT }),
    });
    await h.mount(<SavedIntakeView />);
    expect(box("Peanuts").checked).toBe(true);
    expect(area("Other allergies").value).toBe("EpiPen");
    expect(box("I have no dietary needs").checked).toBe(true);
    expect(h.text()).toContain("Jan 5, 2030");
  });

  it("saves a new profile with PUT and says so in a status message that takes focus", async () => {
    routes(h.fetchMock, {
      "GET /api/me/intake": json(200, { intake: null, savedAt: null }),
      "PUT /api/me/intake": (b) => json(200, { intake: b, savedAt: AT })(b),
    });
    await h.mount(<SavedIntakeView />);
    await h.click(box("I have no allergies"));
    await h.click(box("I have no dietary needs"));
    await h.click(h.button("Save profile"));
    expect(callsTo(h.fetchMock, "/api/me/intake")[1]).toEqual([
      "/api/me/intake",
      "PUT",
      {
        noAllergies: true,
        allergens: [],
        allergyNotes: "",
        noDietaryNeeds: true,
        dietaryNotes: "",
      },
    ]);
    const s = h.q("profile-status")!;
    expect(s.textContent).toContain("Saved");
    expect(document.activeElement).toBe(s);
    expect(h.button("Delete saved profile")).not.toBeNull();
  });

  it("refuses a blank form in the browser, with an alert and focus, and sends nothing", async () => {
    routes(h.fetchMock, {
      "GET /api/me/intake": json(200, { intake: null, savedAt: null }),
    });
    await h.mount(<SavedIntakeView />);
    await h.click(h.button("Save profile"));
    expect(callsTo(h.fetchMock, "/api/me/intake")).toHaveLength(1);
    expect(h.host.querySelector('[role="alert"]')).not.toBeNull();
    expect(document.activeElement?.getAttribute("data-testid")).toBe(
      "error-summary",
    );
  });

  it("shows server field errors (plain keys) next to the right question", async () => {
    routes(h.fetchMock, {
      "GET /api/me/intake": json(200, { intake: SAVED, savedAt: AT }),
      "PUT /api/me/intake": apiError(422, "VALIDATION_FAILED", "Check", {
        fields: { allergyNotes: "Too long." },
      }),
    });
    await h.mount(<SavedIntakeView />);
    await h.type(area("Other allergies"), "x");
    await h.click(h.button("Save profile"));
    expect(h.text()).toContain("Too long.");
    expect(document.activeElement?.getAttribute("data-testid")).toBe(
      "error-summary",
    );
  });

  it("keeps the form and shows an alert when the save fails", async () => {
    routes(h.fetchMock, {
      "GET /api/me/intake": json(200, { intake: SAVED, savedAt: AT }),
      "PUT /api/me/intake": apiError(500, "INTERNAL", "boom"),
    });
    await h.mount(<SavedIntakeView />);
    await h.click(h.button("Save profile"));
    expect(h.q("profile-error")?.textContent).toMatch(/could not be saved/i);
    expect(document.activeElement).toBe(h.q("profile-error"));
    expect(box("Peanuts").checked).toBe(true);
  });

  it("deletes only after a second, explicit press", async () => {
    routes(h.fetchMock, {
      "GET /api/me/intake": json(200, { intake: SAVED, savedAt: AT }),
      "DELETE /api/me/intake": json(200, { intake: null, savedAt: null }),
    });
    await h.mount(<SavedIntakeView />);
    await h.click(h.button("Delete saved profile"));
    expect(callsTo(h.fetchMock, "/api/me/intake")).toHaveLength(1);
    // T-076: the button that opened the question is gone, so focus moves to the question.
    expect(document.activeElement).toBe(h.q("confirm-delete"));
    await h.click(h.button("Yes, delete it"));
    expect(callsTo(h.fetchMock, "/api/me/intake")[1][1]).toBe("DELETE");
    // T-076: the question and its buttons are gone; focus must not fall to <body>.
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement).toBe(h.q("saved-state"));
    expect(h.q("profile-status")?.textContent).toContain("deleted");
    expect(h.text()).toContain("Nothing is saved yet");
    expect(box("Peanuts").checked).toBe(false);
  });

  it("can cancel the delete", async () => {
    routes(h.fetchMock, {
      "GET /api/me/intake": json(200, { intake: SAVED, savedAt: AT }),
    });
    await h.mount(<SavedIntakeView />);
    await h.click(h.button("Delete saved profile"));
    await h.click(h.button("Keep it"));
    expect(h.button("Yes, delete it")).toBeNull();
    expect(h.button("Delete saved profile")).not.toBeNull();
  });

  it("offers a retry when loading fails", async () => {
    routes(h.fetchMock, {});
    await h.mount(<SavedIntakeView />);
    expect(h.host.querySelector('[role="alert"]')?.textContent).toMatch(
      /did not load/i,
    );
    expect(h.button("Try again")).not.toBeNull();
  });

  it("does not promise anything about who can read the profile beyond the chef rule", async () => {
    routes(h.fetchMock, {
      "GET /api/me/intake": json(200, { intake: SAVED, savedAt: AT }),
    });
    await h.mount(<SavedIntakeView />);
    const t = h.text();
    expect(t).not.toMatch(
      /\b(private|secret|nobody|no one|admin|confidential)\b/i,
    );
    expect(t).toMatch(/chef only sees the answers you send/i);
  });
});
