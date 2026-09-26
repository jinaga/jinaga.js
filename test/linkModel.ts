import { User, buildModel } from "@src";

// A fact that links two others, where authority lives on a workspace reachable
// from each side. A rule that constrains both endpoints joins one unknown to
// two predecessor paths of the given.

export class Workspace {
  static Type = "Workspace" as const;
  type = Workspace.Type;

  constructor(
    public creator: User,
    public identifier: string
  ) { }
}

export class Owner {
  static Type = "Owner" as const;
  type = Owner.Type;

  constructor(
    public workspace: Workspace,
    public user: User
  ) { }
}

export class Item {
  static Type = "Item" as const;
  type = Item.Type;

  constructor(
    public workspace: Workspace,
    public label: string
  ) { }
}

export class Link {
  static Type = "Link" as const;
  type = Link.Type;

  constructor(
    public item: Item,
    public parent: Item
  ) { }
}

export const model = buildModel(b => b
  .type(User)
  .type(Workspace, x => x
    .predecessor("creator", User)
  )
  .type(Owner, x => x
    .predecessor("workspace", Workspace)
    .predecessor("user", User)
  )
  .type(Item, x => x
    .predecessor("workspace", Workspace)
  )
  .type(Link, x => x
    .predecessor("item", Item)
    .predecessor("parent", Item)
  )
);
