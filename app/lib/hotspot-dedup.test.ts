import { describe, it, expect } from "vitest";
import {
  tokenizeBody,
  jaccardSimilarity,
  findDuplicate,
  precomputeExistingTokens,
  JACCARD_THRESHOLD,
} from "./hotspot-dedup";

describe("tokenizeBody", () => {
  it("returns empty set for null / undefined / empty input", () => {
    expect(tokenizeBody(null).size).toBe(0);
    expect(tokenizeBody(undefined).size).toBe(0);
    expect(tokenizeBody("").size).toBe(0);
    expect(tokenizeBody("   ").size).toBe(0);
  });

  it("lowercases tokens", () => {
    const tokens = tokenizeBody("USB-C Port");
    expect(tokens.has("usb")).toBe(true);
    expect(tokens.has("c")).toBe(false); // single-char tokens dropped
    expect(tokens.has("port")).toBe(true);
  });

  it("splits on whitespace and common punctuation", () => {
    const tokens = tokenizeBody("Hello, world! How are you?");
    expect(tokens.has("hello")).toBe(true);
    expect(tokens.has("world")).toBe(true);
    expect(tokens.has("how")).toBe(true);
    expect(tokens.has("are")).toBe(true);
    expect(tokens.has("you")).toBe(true);
  });

  it("drops tokens shorter than 2 chars", () => {
    const tokens = tokenizeBody("a b cd ef ghi");
    expect(tokens.has("a")).toBe(false);
    expect(tokens.has("b")).toBe(false);
    expect(tokens.has("cd")).toBe(true);
    expect(tokens.has("ef")).toBe(true);
    expect(tokens.has("ghi")).toBe(true);
  });
});

describe("jaccardSimilarity", () => {
  it("returns 0 for two empty sets", () => {
    expect(jaccardSimilarity(new Set(), new Set())).toBe(0);
  });

  it("returns 0 when one set is empty", () => {
    expect(jaccardSimilarity(new Set(["a", "b"]), new Set())).toBe(0);
    expect(jaccardSimilarity(new Set(), new Set(["a"]))).toBe(0);
  });

  it("returns 1.0 for identical sets", () => {
    const set = new Set(["one", "two", "three"]);
    expect(jaccardSimilarity(set, new Set(set))).toBe(1);
  });

  it("computes intersection over union correctly", () => {
    const a = new Set(["one", "two", "three"]);
    const b = new Set(["two", "three", "four"]);
    // intersection = {two, three} (size 2), union = {one, two, three, four} (size 4) → 0.5
    expect(jaccardSimilarity(a, b)).toBe(0.5);
  });
});

describe("findDuplicate — exact title match", () => {
  it("matches case-insensitive trimmed title", () => {
    const existing = [{ title: "USB-C port" }];
    expect(findDuplicate({ title: "USB-C Port" }, existing)).toBe(existing[0]);
    expect(findDuplicate({ title: "  usb-c port  " }, existing)).toBe(existing[0]);
  });

  it("does NOT match when both titles are empty/missing", () => {
    expect(findDuplicate({ title: "" }, [{ title: "" }])).toBe(null);
    expect(findDuplicate({}, [{}])).toBe(null);
    expect(findDuplicate({ title: null }, [{ title: null }])).toBe(null);
  });

  it("does NOT match different titles", () => {
    expect(findDuplicate({ title: "Port A" }, [{ title: "Port B" }])).toBe(null);
  });
});

describe("findDuplicate — body Jaccard match", () => {
  it("matches when body Jaccard >= 0.70", () => {
    // Identical core sentence + small added phrase on one side keeps
    // similarity well above the 0.70 threshold.
    const existing = [
      {
        title: "Existing",
        body: "USB-C port supports power delivery and data transfer at 45 watts.",
      },
    ];
    const candidate = {
      title: "Different title",
      body: "USB-C port supports power delivery and data transfer.",
    };
    expect(findDuplicate(candidate, existing)).toBe(existing[0]);
  });

  it("does not match low-similarity bodies", () => {
    const existing = [{ title: "A", body: "The kettle boils water quickly using an induction element." }];
    const candidate = { title: "B", body: "USB-C provides 45 watt power delivery for laptops and tablets." };
    expect(findDuplicate(candidate, existing)).toBe(null);
  });

  it("returns the first matching existing hotspot when multiple match", () => {
    const a = { title: "First", body: "shared body text token list goes here exactly identical content" };
    const b = { title: "Second", body: "shared body text token list goes here exactly identical content" };
    const candidate = { title: "Candidate", body: "shared body text token list goes here exactly identical content" };
    expect(findDuplicate(candidate, [a, b])).toBe(a);
  });

  it("ignores body comparison when candidate body is empty", () => {
    const existing = [{ title: "A", body: "some words to fill the body" }];
    expect(findDuplicate({ title: "B", body: "" }, existing)).toBe(null);
  });
});

describe("findDuplicate — uses precomputed tokens when provided", () => {
  it("returns same result with or without precomputed tokens", () => {
    const existing = [{ title: "Existing", body: "the system supports rapid power delivery via usb-c" }];
    // Add a single word to push union without changing intersection — keeps Jaccard >= 0.70.
    const candidate = { title: "Candidate", body: "the system supports rapid power delivery via usb-c port" };
    const precomputed = precomputeExistingTokens(existing);
    expect(findDuplicate(candidate, existing)).toBe(existing[0]);
    expect(findDuplicate(candidate, existing, precomputed)).toBe(existing[0]);
  });
});

describe("JACCARD_THRESHOLD", () => {
  it("is the spec value 0.70", () => {
    expect(JACCARD_THRESHOLD).toBe(0.7);
  });
});
