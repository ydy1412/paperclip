import { describe, expect, it } from "vitest";
import { assertMarketingAsideBinding, parseMarketingAsideProfiles } from "../services/marketing-aside-profiles.js";
describe("Aside marketing profile discovery", () => {
  it("reads explicit account bindings without retaining email addresses or changing defaults", () => {
    const rows = parseMarketingAsideProfiles("* u0 private@example.com signed in profiles: Profile 0\n provider: google\n u1 work@example.com signed in profiles: Profile 1\n provider: google");
    expect(rows).toEqual([{ asideAccountId: "u0", browserProfileName: "Profile 0", signedIn: true }, { asideAccountId: "u1", browserProfileName: "Profile 1", signedIn: true }]);
    expect(JSON.stringify(rows)).not.toContain("example.com");
    expect(() => assertMarketingAsideBinding(rows, { asideAccountId: "u1", browserProfileName: "Profile 1" })).not.toThrow();
    expect(() => assertMarketingAsideBinding(rows, { asideAccountId: "u1", browserProfileName: "Profile 0" })).toThrow();
  });
  it("does not turn multiple profiles, signed-out accounts or an unknown CLI shape into authorization", () => {
    const rows = parseMarketingAsideProfiles("u1 work@example.com signed in profiles: Profile 1, Profile 2\nu2 hidden@example.com signed out profiles: Profile 3\ndefault: some profile");
    expect(rows).toEqual([{ asideAccountId: "u2", browserProfileName: "Profile 3", signedIn: false }]);
    expect(() => assertMarketingAsideBinding(rows, { asideAccountId: "u2", browserProfileName: "Profile 3" })).toThrow();
  });
});
