import { parseRecipients } from "../src/services/csvParser";

describe("parseRecipients", () => {
  it("detects valid, invalid and duplicate emails from a CSV blob", () => {
    const csv = [
      "email",
      "alice@example.com",
      "bob@example.com",
      "not-an-email",
      "alice@example.com", // duplicate
      "carol@example.com",
    ].join("\n");

    const summary = parseRecipients(csv);

    expect(summary.valid).toBe(3); // alice, bob, carol
    expect(summary.duplicates).toBe(1);
    expect(summary.invalid).toBe(1);
    expect(summary.validEmails).toEqual(
      expect.arrayContaining(["alice@example.com", "bob@example.com", "carol@example.com"])
    );
  });

  it("handles freeform comma/newline separated text without a CSV header", () => {
    const text = "dev@company.com, qa@company.com\nsales@company.com";
    const summary = parseRecipients(text);
    expect(summary.valid).toBe(3);
    expect(summary.invalid).toBe(0);
    expect(summary.duplicates).toBe(0);
  });

  it("returns zero counts for empty input", () => {
    const summary = parseRecipients("");
    expect(summary.detected).toBe(0);
    expect(summary.valid).toBe(0);
  });

  it("is case-insensitive when detecting duplicates", () => {
    const summary = parseRecipients("Foo@Example.com\nfoo@example.com");
    expect(summary.valid).toBe(1);
    expect(summary.duplicates).toBe(1);
  });
});
