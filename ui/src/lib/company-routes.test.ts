import { describe, expect, it } from "vitest";
import {
  applyCompanyPrefix,
  extractCompanyPrefixFromPath,
  isBoardPathWithoutPrefix,
  toCompanyRelativePath,
} from "./company-routes";

describe("Knowledge company routing", () => {
  it("recognizes Knowledge as a board route, not a company prefix", () => {
    expect(isBoardPathWithoutPrefix("/knowledge")).toBe(true);
    expect(extractCompanyPrefixFromPath("/knowledge")).toBeNull();
  });

  it("adds the selected company prefix", () => {
    expect(applyCompanyPrefix("/knowledge", "dob")).toBe("/DOB/knowledge");
  });

  it("preserves existing company prefixes and URL suffixes", () => {
    expect(applyCompanyPrefix("/NEW/knowledge?view=all#top", "DOB"))
      .toBe("/NEW/knowledge?view=all#top");
    expect(applyCompanyPrefix("/knowledge?view=all#top", "DOB"))
      .toBe("/DOB/knowledge?view=all#top");
  });

  it("removes company scope for relative navigation", () => {
    expect(toCompanyRelativePath("/DOB/knowledge")).toBe("/knowledge");
  });
});
