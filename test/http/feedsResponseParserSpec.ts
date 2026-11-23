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

  // Issue #439. Replicas are peers, and a newer peer may report a code or a
  // decision kind an older one has never heard of. Rejecting the whole
  // response for an unknown *value* would make every `query`, `watch` and
  // `subscribe` of that specification fail over a field the client does not
  // even need, so an unknown value gets a defined, safe meaning instead
  // (Art. 3). Only a malformed *shape* is still rejected.
  it("tolerates a code this client does not know, carrying it through raw (issue #439)", () => {
    const response = parseFeedsResponse({
      feeds: ["abc"],
      decisions: [{ feed: "abc", decision: "denied", code: "some-future-code", reason: "A future replicator said so." }]
    });
    expect(response.feeds).toEqual(["abc"]);
    expect(response.decisions).toEqual([
      { feed: "abc", decision: "denied", code: "some-future-code", reason: "A future replicator said so." }
    ]);
  });

  it("reads a decision kind this client does not know as denied (issue #439)", () => {
    const response = parseFeedsResponse({
      feeds: ["abc"],
      decisions: [{ feed: "abc", decision: "some-future-kind", reason: "A future replicator said so." }]
    });
    expect(response.feeds).toEqual(["abc"]);
    expect(response.decisions).toEqual([
      { feed: "abc", decision: "denied", reason: "A future replicator said so." }
    ]);
  });

  // An unknown kind makes the code that accompanied it uninterpretable too:
  // the client cannot tell what the code was asserting about. Dropping it is
  // what makes the denial non-structural by representation rather than by a
  // rule applied downstream, which is what the issue's decision asks for.
  it("drops the code that accompanied an unknown decision kind, known or not (issue #439)", () => {
    for (const code of ["no-matching-rule", "spec-more-restrictive-than-rule", "principal-excluded", "some-future-code"]) {
      const response = parseFeedsResponse({
        feeds: ["abc"],
        decisions: [{ feed: "abc", decision: "some-future-kind", code, reason: "A future replicator said so." }]
      });
      expect(response.decisions).toEqual([
        { feed: "abc", decision: "denied", reason: "A future replicator said so." }
      ]);
    }
  });

  it("never reads an unknown decision kind as authorized, whatever it is called (issue #439)", () => {
    for (const kind of ["some-future-kind", "Authorized", "authorised", "authorized-ish", ""]) {
      const response = parseFeedsResponse({
        feeds: [],
        decisions: [{ feed: "abc", decision: kind, reason: "" }]
      });
      expect(response.decisions![0].decision).toBe("denied");
    }
  });

  it("still rejects a malformed decision shape rather than a merely unknown value (issue #439)", () => {
    // A non-string `decision` or `code` is not an unknown value, it is the
    // wrong shape, and so is an absent `decision`.
    expect(() => parseFeedsResponse({
      feeds: [],
      decisions: [{ feed: "abc", decision: 42, reason: "" }]
    })).toThrow(ValidationError);
    expect(() => parseFeedsResponse({
      feeds: [],
      decisions: [{ feed: "abc", reason: "" }]
    })).toThrow(ValidationError);
    expect(() => parseFeedsResponse({
      feeds: [],
      decisions: [{ feed: "abc", decision: "denied", code: 7, reason: "" }]
    })).toThrow(ValidationError);
    expect(() => parseFeedsResponse({
      feeds: [],
      decisions: [{ feed: "abc", decision: "some-future-kind", code: 7, reason: "" }]
    })).toThrow(ValidationError);
    expect(() => parseFeedsResponse({
      feeds: [],
      decisions: [{ feed: "abc", decision: "denied", code: "some-future-code", reason: 7 }]
    })).toThrow(ValidationError);
    expect(() => parseFeedsResponse({
      feeds: [],
      decisions: [{ feed: 7, decision: "denied", reason: "" }]
    })).toThrow(ValidationError);
    expect(() => parseFeedsResponse({
      decisions: [{ feed: "abc", decision: "denied", reason: "" }]
    })).toThrow(ValidationError);
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
