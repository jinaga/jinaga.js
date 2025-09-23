"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const _src_1 = require("@src");
const companyModel_1 = require("../companyModel");
describe("missing fact handling", () => {
    let creator;
    let company;
    let office;
    let j;
    beforeEach(() => {
        creator = new _src_1.User("--- PUBLIC KEY GOES HERE ---");
        company = new companyModel_1.Company(creator, "TestCo");
        office = new companyModel_1.Office(company, "TestOffice");
        j = _src_1.JinagaTest.create({
            initialState: [
                creator,
                company,
                office
            ]
        });
    });
    it("should return empty result when querying with non-persisted given", () => __awaiter(void 0, void 0, void 0, function* () {
        // Create a company that is not persisted
        const nonPersistedCompany = new companyModel_1.Company(creator, "NonPersistedCo");
        // Create a specification that uses the non-persisted company as given
        const specification = companyModel_1.model.given(companyModel_1.Company).match((company, facts) => facts.ofType(companyModel_1.Office)
            .join(office => office.company, company));
        // This should return an empty result instead of throwing an error
        const result = yield j.query(specification, nonPersistedCompany);
        expect(result).toEqual([]);
    }));
    it("should return empty result when fact projection references missing fact", () => __awaiter(void 0, void 0, void 0, function* () {
        // Create a company that is not persisted
        const nonPersistedCompany = new companyModel_1.Company(creator, "NonPersistedCo");
        // Create a specification that selects the company fact itself
        const specification = companyModel_1.model.given(companyModel_1.Company).select((company, facts) => company);
        // This should return an empty result instead of throwing an error
        const result = yield j.query(specification, nonPersistedCompany);
        expect(result).toEqual([]);
    }));
    it("should return empty result when querying with fact that has persisted predecessors", () => __awaiter(void 0, void 0, void 0, function* () {
        // Create a specification that looks for offices belonging to a given company
        const specification = companyModel_1.model.given(companyModel_1.Company).match((company, facts) => facts.ofType(companyModel_1.Office)
            .join(office => office.company, company));
        // This should work for the persisted company
        const persistedResult = yield j.query(specification, company);
        expect(persistedResult.length).toBe(1);
        expect(persistedResult[0].identifier).toBe(office.identifier);
        expect(persistedResult[0].type).toBe(office.type);
        // Create a company that was not in initial state
        const newCompany = new companyModel_1.Company(creator, "NewCo");
        // Querying with a company that wasn't persisted should return empty result
        const newCompanyResult = yield j.query(specification, newCompany);
        expect(newCompanyResult).toEqual([]);
    }));
});
//# sourceMappingURL=missingFactSpec.js.map