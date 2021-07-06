import { Dehydration, HashMap } from "../../src/fact/hydrate";

describe("Known hash", () => {
    it("String field", () => {
        const hash = hashOf({
            type: "Skylane.Airline",
            identifier: "value"
        });
        expect(hash).toEqual("uXcsBceLFAkZdRD71Ztvc+QwASayHA0Zg7wC2mc3zl28N1hKTbGBfBA2OnEHAWo+0yYVeUnABMn9MCRH8cRHWg==");
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
        expect(hash).toEqual("cQaErYsizavFrTIGjD1C0g3shMG/uq+hVUXzs/kCzcvev9gPrVDom3pbrszUsmeRelNv8bRdIvOb6AbaYrVC7w==");
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
        expect(hash).toEqual("PyXT7pCvBq7Vw63kEZGgbIVJxqA7jhoO+QbmeM3YC9laayG0gjln58khyOd4D/cmxXzocPaIuwXGWusVJxqEjQ==");
    });

    it("Empty predecessor list", () => {
        const hash = hashOf({
            type: "Skylane.Passenger.Name",
            passenger: {
                type: "Skylane.Passenger",
                airline: {
                    type: "Skylane.Airline",
                    identifier: "IA"
                },
                user: {
                    type: "Jinaga.User",
                    publicKey: "---PUBLIC KEY---"
                }
            },
            value: "Charles Rane",
            prior: []
        });
        expect(hash).toEqual("GsMMA/8Nv401P6RXvugFYzYCemGehnXSFZuaKNcoVFoXKmxzMJkpqI9rs/SRlKHZlnRP1QsBxFWKFt6143OpYA==");
    });

    it("Single predecessor list", () => {
        const passenger = {
            type: "Skylane.Passenger",
            airline: {
                type: "Skylane.Airline",
                identifier: "IA"
            },
            user: {
                type: "Jinaga.User",
                publicKey: "---PUBLIC KEY---"
            }
        };
        const first = <HashMap>{
            type: "Skylane.Passenger.Name",
            passenger,
            value: "Charles Rane",
            prior: []
        };
        const hash = hashOf({
            type: "Skylane.Passenger.Name",
            passenger,
            value: "Charley Rane",
            prior: [ first ]
        });
        expect(hash).toEqual("BYLtR7XddbhchlyBdGdrnRHGkPsDecynDjLHFvqtKH7zug46ymxNDpPC4QNb+T14Bhzs8M1F3VfCnlgzinNHPg==");
    });

    it.only("Multiple predecessor list", () => {
        const passenger = {
            type: "Skylane.Passenger",
            airline: {
                type: "Skylane.Airline",
                identifier: "IA"
            },
            user: {
                type: "Jinaga.User",
                publicKey: "---PUBLIC KEY---"
            }
        };
        const first = <HashMap>{
            type: "Skylane.Passenger.Name",
            passenger,
            value: "Charles Rane",
            prior: []
        };
        const middle = [1,2,3,4,5,6,7,8,9,10]
            .map(id => ({
                type: "Skylane.Passenger.Name",
                passenger,
                value: `Charley Rane ${id}`,
                prior: [ first ]
            }));
        const hash = hashOf({
            type: "Skylane.Passenger.Name",
            passenger,
            value: "Charley Rane",
            prior: middle
        });
        expect(hash).toEqual("4Os8M2Tt7+lCEe6WQ6iAJwQ/wbmK6CTLqwF8DCS6Bc4tgXE268BanI0sHDeSYhbKYbSDAyRzarMkrciveBoDTQ==");
    });
});

function hashOf(fact: HashMap) {
    const dehydration = new Dehydration();
    const record = dehydration.dehydrate(fact);
    return record.hash;
}