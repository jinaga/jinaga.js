import { parseFeedsResponse, parseLoadMessage, parseSaveMessage, ValidationError } from "@src";

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

  it("rejects an unknown denial code", () => {
    expect(() => parseFeedsResponse({
      feeds: [],
      decisions: [{ feed: "abc", decision: "denied", code: "not-a-real-code", reason: "" }]
    })).toThrow(/code/);
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

  it("throws a ValidationError so callers can classify without matching prose (issue #234)", () => {
    expect(() => parseFeedsResponse({ feeds: "abc" })).toThrow(ValidationError);
    expect(() => parseSaveMessage({ facts: "abc" })).toThrow(ValidationError);
    expect(() => parseLoadMessage("not an object")).toThrow(ValidationError);
  });

  // `typeof null === 'object'`, and so is an array, so these once slipped past
  // the guard and failed later as a bare TypeError — unclassifiable downstream.
  it.each([null, [], ["abc"]])("rejects %p as a message with a ValidationError", (message) => {
    expect(() => parseFeedsResponse(message)).toThrow(ValidationError);
    expect(() => parseSaveMessage(message)).toThrow(ValidationError);
    expect(() => parseLoadMessage(message)).toThrow(ValidationError);
  });

  it("rejects a null or array fact reference with a ValidationError", () => {
    expect(() => parseLoadMessage({ references: [null] }))
      .toThrow("Expected FactReference to be an object.");
    expect(() => parseLoadMessage({ references: [["Test.Type", "hash"]] }))
      .toThrow("Expected FactReference to be an object.");
  });

  it("rejects a null fact record, fields map, or predecessor collection with a ValidationError", () => {
    expect(() => parseSaveMessage({ facts: [null] }))
      .toThrow("Expected FactRecord to be an object.");
    expect(() => parseSaveMessage({ facts: [{ type: "Test.Type", hash: "abc", fields: null }] }))
      .toThrow("Expected an object 'fields' property.");
    expect(() => parseSaveMessage({ facts: [{ type: "Test.Type", hash: "abc", fields: {}, predecessors: null }] }))
      .toThrow("Expected PredecessorCollection to be an object.");
  });

  it("rejects a null feed decision with a ValidationError", () => {
    expect(() => parseFeedsResponse({ feeds: [], decisions: [null] }))
      .toThrow("Expected FeedDecision to be an object.");
  });
});
