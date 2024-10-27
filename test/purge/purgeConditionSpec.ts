import { buildModel, JinagaClient } from "../../src";

describe("Purge conditions", () => {
    it("should allow a specification when no purge conditions are specified", async () => {
        var j = JinagaClient.create({});
        var model = buildModel(b => b
            .type(Store)
            .type(Order, x => x
                .predecessor("store", Store)
            )
            .type(Item, x => x
                .predecessor("order", Order)
            )
            .type(OrderCancelled, x => x
                .predecessor("order", Order)
            )
        );
        var store = await j.fact(new Store("storeId"));

        var ordersInStore = model.given(Store).match((store, facts) =>
            facts.ofType(Order)
                .join(order => order.store, store)
        );

        var orders = await j.query(ordersInStore, store);
        expect(orders).toEqual([]);
    });
});

class Store {
    static Type = "Store" as const;
    type = Store.Type;

    constructor(
        public identifier: string
    ) { }
}

class Order {
    static Type = "Order" as const;
    type = Order.Type;

    constructor(
        public store: Store,
        public createdAt: Date | string
    ) { }
}

class Item {
    static Type = "Order.Item" as const;
    type = Item.Type;

    constructor(
        public order: Order,
        public product: string,
        public quantity: number
    ) { }
}

class OrderCancelled {
    static Type = "Order.Cancelled" as const;
    type = OrderCancelled.Type;

    constructor(
        public order: Order,
        public cancelledAt: Date | string
    ) { }
}