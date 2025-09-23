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
describe("Distribution rules in unit tests", () => {
    it("should pass when distribution rule allows", () => __awaiter(void 0, void 0, void 0, function* () {
        const loggedInUser = new _src_1.User("user1");
        const jinaga = _src_1.JinagaTest.create({
            model,
            user: loggedInUser,
            distribution,
            initialState: [
                loggedInUser
            ]
        });
        const namesSpec = model.given(_src_1.User).match(user => UserName.current(user));
        const names = yield jinaga.query(namesSpec, loggedInUser);
        expect(names).toStrictEqual([]);
    }));
    it("should throw when querying as a different user", () => __awaiter(void 0, void 0, void 0, function* () {
        const user1 = new _src_1.User("user1");
        const user2 = new _src_1.User("user2");
        const jinaga = _src_1.JinagaTest.create({
            model,
            user: user2,
            distribution,
            initialState: [
                user1,
                user2
            ]
        });
        const namesSpec = model.given(_src_1.User).match(user => UserName.current(user));
        yield expect(jinaga.query(namesSpec, user1)).rejects.toThrow();
    }));
});
class UserName {
    constructor(user, value, prior) {
        this.user = user;
        this.value = value;
        this.prior = prior;
        this.type = UserName.Type;
    }
    static current(user) {
        return user.successors(UserName, userName => userName.user)
            .notExists(userName => userName.successors(UserName, next => next.prior));
    }
}
UserName.Type = "UserName";
const model = (0, _src_1.buildModel)(b => b
    .type(_src_1.User)
    .type(UserName, f => f
    .predecessor("user", _src_1.User)
    .predecessor("prior", UserName)));
function distribution(r) {
    return r
        .share(model.given(_src_1.User).match(user => UserName.current(user)))
        .with(model.given(_src_1.User).match(user => user));
}
//# sourceMappingURL=distributionUnitTestSpec.js.map