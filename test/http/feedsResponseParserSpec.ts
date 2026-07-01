import { parseFeedsResponse } from "@src";

describe("parseFeedsResponse (issue #207 W3)", () => {
  it("parses a response with only feeds (old replicator)", () => {
    const response = parseFeedsResponse({ feeds: ["abc", "def"] });
    expect(response.feeds).toEqual(["abc", "def"]);
    expect(response.decisions).toBeUndefined();
  });

  it("parses per-feed decisions when present", () => {
    const response = parseFeedsResponse({
      feeds: ["abc", "def"],
      decisions: [
        { feed: "abc", decision: "authorized", reason: "" },
        { feed: "def", decision: "reactive", reason: "pending authorization" },
        { feed: "ghi", decision: "denied", code: "no-matching-rule", reason: "No rules apply to this feed." }
      ]
    });
    expect(response.feeds).toEqual(["abc", "def"]);
    expect(response.decisions).toHaveLength(3);
    expect(response.decisions![1]).toEqual({
      feed: "def",
      decision: "reactive",
      reason: "pending authorization"
    });
    expect(response.decisions![2].code).toBe("no-matching-rule");
  });

  it("rejects an unknown decision value", () => {
    expect(() => parseFeedsResponse({
      feeds: [],
      decisions: [{ feed: "abc", decision: "maybe", reason: "" }]
    })).toThrow(/'decision'/);
  });

  it("rejects a non-array feeds property", () => {
    expect(() => parseFeedsResponse({ feeds: "abc" })).toThrow(/'feeds'/);
  });

  it("rejects non-string feed entries", () => {
    expect(() => parseFeedsResponse({ feeds: [1, 2] })).toThrow(/'feeds'/);
  });
});
