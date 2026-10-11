// The API types (types.ts is types-only and cannot import domain code at run time) repeat a few
// unions of the domain rules. These compile-time checks fail the build when they drift apart.
import { describe, expect, it } from "vitest";
import type { BookingIssueCode as ApiIssueCode } from "./types";
import type { BookingIssueCode as DomainIssueCode } from "../domain/bookingValidation";
import type { BookingStatus as ApiStatus } from "./types";
import type { BookingStatus as DomainStatus } from "../domain/cancellation";

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const issueCodesMatch: Same<ApiIssueCode, DomainIssueCode> = true;
// The API has one more status than the domain's FreeTrialEvent base: `expired` is stored now.
const statusMatches: Same<ApiStatus, DomainStatus | "expired"> = true;

describe("API types follow the domain unions", () => {
  it("issue codes and statuses are the same sets", () => {
    expect(issueCodesMatch && statusMatches).toBe(true);
  });
});
