import { buildModel, DistributionRules, JinagaTest, LabelOf, User } from "@src";

describe("Distribution rules in unit tests", () => {
    it("should pass when distribution rule allows", async () => {
        const loggedInUser = new User("user1");
        const jinaga = JinagaTest.create({
            model,
            user: loggedInUser,
            distribution,
            initialState: [
                loggedInUser
            ]
        });

        const namesSpec = model.given(User).match(user => UserName.current(user));
        const names = await jinaga.query(namesSpec, loggedInUser);
        expect(names).toStrictEqual([]);
    });

    it("should return empty result when querying as a different user", async () => {
        const user1 = new User("user1");
        const user2 = new User("user2");
        const userName = new UserName(user1, "User One", []);
        const jinaga = JinagaTest.create({
            model,
            user: user2,
            distribution,
            initialState: [
                user1,
                user2,
                userName
            ]
        });

        const namesSpec = model.given(User).match(user => UserName.current(user));
        const result = await jinaga.query(namesSpec, user1);
        expect(result).toStrictEqual([]);
    });
});

class UserName {
    static Type = "UserName" as const;
    type = UserName.Type;

    constructor(
        public user: User,
        public value: string,
        public prior: UserName[]) {}

    static current(user: LabelOf<User>) {
        return user.successors(UserName, userName => userName.user)
            .notExists(userName => userName.successors(UserName, next => next.prior));
    }
}

const model = buildModel(b => b
    .type(User)
    .type(UserName, f => f
        .predecessor("user", User)
        .predecessor("prior", UserName)
    )
);

function distribution(r: DistributionRules) {
    return r
        .share(model.given(User).match(user => UserName.current(user)))
        .with(model.given(User).match(user => user));
}