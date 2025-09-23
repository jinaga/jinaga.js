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
class Parent {
    constructor(id) {
        this.id = id;
        this.type = Parent.Type;
    }
}
Parent.Type = "Parent";
class ChildVersion1 {
    constructor(parent, name) {
        this.parent = parent;
        this.name = name;
        this.type = ChildVersion1.Type;
    }
}
ChildVersion1.Type = "Child";
class ChildVersion2 {
    constructor(parent, name, age) {
        this.parent = parent;
        this.name = name;
        this.age = age;
        this.type = ChildVersion2.Type;
    }
}
ChildVersion2.Type = "Child";
const model = (0, _src_1.buildModel)(b => b
    .type(Parent)
    .type(ChildVersion2, m => m
    .predecessor("parent", Parent)));
const childrenOfParentAsFacts = model.given(Parent).match((parent, facts) => facts.ofType(ChildVersion2)
    .join(child => child.parent, parent));
const childrenOfParentWithFields = model.given(Parent).match((parent, facts) => facts.ofType(ChildVersion2)
    .join(child => child.parent, parent)
    .select(child => ({
    name: child.name,
    age: child.age
})));
describe("versioning", () => {
    it("should read version 1 into version 2", () => __awaiter(void 0, void 0, void 0, function* () {
        const j = _src_1.JinagaTest.create({
            model,
            initialState: [
                new Parent("parent"),
                new ChildVersion1(new Parent("parent"), "child")
            ]
        });
        const parent = yield j.fact(new Parent("parent"));
        const children = yield j.query(childrenOfParentWithFields, parent);
        expect(children).toHaveLength(1);
        expect(children[0].name).toEqual("child");
        expect(children[0].age).toBeUndefined();
    }));
    it("should have the same hash", () => __awaiter(void 0, void 0, void 0, function* () {
        const j = _src_1.JinagaTest.create({
            model,
            initialState: [
                new Parent("parent"),
                new ChildVersion1(new Parent("parent"), "child")
            ]
        });
        const parent = yield j.fact(new Parent("parent"));
        const children = yield j.query(childrenOfParentAsFacts, parent);
        expect(children).toHaveLength(1);
        expect(j.hash(children[0])).toEqual(j.hash(new ChildVersion1(new Parent("parent"), "child")));
    }));
});
//# sourceMappingURL=versioningSpec.js.map