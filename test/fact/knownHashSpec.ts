import { expect } from "chai";
import { Dehydration, HashMap } from "../../src/fact/hydrate";

describe("Known hash", () => {
    it("String field", () => {
        const hash = hashOf({
            type: "Skylane.Airline",
            identifier: "value"
        });
        expect(hash).to.equal("uXcsBceLFAkZdRD71Ztvc+QwASayHA0Zg7wC2mc3zl28N1hKTbGBfBA2OnEHAWo+0yYVeUnABMn9MCRH8cRHWg==");
    });

    it("Predecessor", () => {
        const hash = hashOf({
            type: "Skylane.Airline.Day",
            airline: {
                type: "Skylane.Airline",
                identifier: "value"
            },
            date: "2021-07-04T00:00:00.000Z"
        });
        expect(hash).to.equal("cQaErYsizavFrTIGjD1C0g3shMG/uq+hVUXzs/kCzcvev9gPrVDom3pbrszUsmeRelNv8bRdIvOb6AbaYrVC7w==");
    });

    it("Integer field", () => {
        const hash = hashOf({
            type: "Skylane.Flight",
            airlineDay: {
                type: "Skylane.Airline.Day",
                airline: {
                    type: "Skylane.Airline",
                    identifier: "value"
                },
                date: "2021-07-04T00:00:00.000Z"
            },
            flightNumber: 4247
        });
        expect(hash).to.equal("PyXT7pCvBq7Vw63kEZGgbIVJxqA7jhoO+QbmeM3YC9laayG0gjln58khyOd4D/cmxXzocPaIuwXGWusVJxqEjQ==");
    });
});

function hashOf(fact: HashMap) {
    const dehydration = new Dehydration();
    const record = dehydration.dehydrate(fact);
    return record.hash;
}