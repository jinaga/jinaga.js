import { AuthorizationRules } from "../authorization/authorizationRules";
import { Jinaga as j } from "../jinaga";
import { ensure } from "../query/query-parser";

export class User {
  static Type = "Jinaga.User";
  type = User.Type;

  constructor(
    public publicKey: string
  ) { }
}

export class UserName {
  static Type = "Jinaga.User.Name";
  public type = UserName.Type;

  constructor(
    public prior: UserName[],
    public user: User,
    public value: string
  ) { }

  static namesForUser(user: User) {
    return j.match(<UserName>{
      type: UserName.Type,
      user
    }).suchThat(UserName.nameIsCurrent);
  }

  static nameIsCurrent(userName: UserName) {
    return j.notExists(<UserName>{
      type: UserName.Type,
      prior: [userName]
    });
  }

  static user(n: UserName) {
    ensure(n).has("user", User);
    return j.match(n.user);
  }
}
