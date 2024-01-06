import { JinagaTest, buildModel } from "../../src";

class Parent {
  static Type = "Parent";
  type = Parent.Type;

  constructor(
    public readonly id: string
  ) {}
}

interface Child {
  parent: Parent;
  name: string;
}

class ChildVersion1 implements Child {
  static Type = "Child";
  type = ChildVersion1.Type;

  constructor(
    public readonly parent: Parent,
    public readonly name: string
  ) {}
}

class ChildVersion2 implements Child {
  static Type = "Child";
  type = ChildVersion2.Type;

  constructor(
    public readonly parent: Parent,
    public readonly name: string,
    public readonly age: number | undefined
  ) {}
}

const model = buildModel(b => b
  .type(Parent)
  .type(ChildVersion2, m => m
    .predecessor("parent", Parent)
  )
);

const childrenOfParent = model.given(Parent).match((parent, facts) =>
  facts.ofType(ChildVersion2)
    .join(child => child.parent, parent)
    .select(child => ({
      name: child.name,
      age: child.age
    }))
);

describe("versioning", () => {
  it("should read version 1 into version 2", async () => {
    const j = JinagaTest.create({
      model,
      initialState: [
        new Parent("parent"),
        new ChildVersion1(new Parent("parent"), "child")
      ]
    });

    const parent = await j.fact(new Parent("parent"));
    const children = await j.query(childrenOfParent, parent);

    expect(children).toHaveLength(1);
    expect(children[0].name).toEqual("child");
    expect(children[0].age).toBeUndefined();
  });
});