export class User {
  static Type = "Jinaga.User" as const;
  type = User.Type;

  constructor(
    public publicKey: string
  ) { }
}

export class UserName {
  static Type = "Jinaga.User.Name" as const;
  public type = UserName.Type;

  constructor(
    public prior: UserName[],
    public user: User,
    public value: string
  ) { }
}

export class Device {
  static Type = "Jinaga.Device" as const;
  public type = Device.Type;

  constructor(
    public publicKey: string
  ) { }
}