import { buildModel, JinagaClient, PurgeConditions } from "../../src";

describe("Purge conditions", () => {
    it("should allow a specification when no purge conditions are specified", async () => {
        const j = createJinagaClient(p => p);
        const model = createModel();
        const store = await j.fact(new Store("storeId"));

        const ordersInStore = model.given(Store).match((store, facts) =>
            facts.ofType(Order)
                .join(order => order.store, store)
        );

        const orders = await j.query(ordersInStore, store);
        expect(orders).toEqual([]);
    });

    it("should throw if the specification does not include the purge condition", async () => {
        const model = createModel();
        const j = createJinagaClient(p => p
            .whenExists(model.given(Order).match((order, facts) =>
                facts.ofType(OrderCancelled)
                    .join(orderCancelled => orderCancelled.order, order)
            ))
        );
        const store = await j.fact(new Store("storeId"));

        const ordersInStore = model.given(Store).match((store, facts) =>
            facts.ofType(Order)
                .join(order => order.store, store)
        );

        const orders = j.query(ordersInStore, store);
        await expect(orders).rejects.toThrow();
    });

    it("should allow a specification when the purge condition is included", async () => {
        const model = createModel();
        const j = createJinagaClient(p => p
            .whenExists(model.given(Order).match((order, facts) =>
                facts.ofType(OrderCancelled)
                    .join(orderCancelled => orderCancelled.order, order)
            ))
        );
        const store = await j.fact(new Store("storeId"));

        const ordersInStore = model.given(Store).match((store, facts) =>
            facts.ofType(Order)
                .join(order => order.store, store)
                .notExists(order =>
                    facts.ofType(OrderCancelled)
                        .join(orderCancelled => orderCancelled.order, order))
        );

        const orders = await j.query(ordersInStore, store);
        expect(orders).toEqual([]);
    });
});

function createJinagaClient(purgeConditions: (p: PurgeConditions) => PurgeConditions) {
    return JinagaClient.create({
        purgeConditions
    });
}

function createModel() {
    return buildModel(b => b
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
}

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
