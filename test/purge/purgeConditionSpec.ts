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

    it("should handle nested purge conditions correctly", async () => {
        const model = createModel();
        const j = createJinagaClient(p => p
            .whenExists(model.given(Order).match((order, facts) =>
                facts.ofType(OrderCancelled)
                    .join(orderCancelled => orderCancelled.order, order)
                    .notExists(orderCancelled =>
                        facts.ofType(OrderCancelledReason)
                            .join(reason => reason.orderCancelled, orderCancelled))
            ))
        );
        const store = await j.fact(new Store("storeId"));

        const ordersInStore = model.given(Store).match((store, facts) =>
            facts.ofType(Order)
                .join(order => order.store, store)
                .notExists(order =>
                    facts.ofType(OrderCancelled)
                        .join(orderCancelled => orderCancelled.order, order)
                        .notExists(orderCancelled =>
                            facts.ofType(OrderCancelledReason)
                                .join(reason => reason.orderCancelled, orderCancelled)))
        );

        const orders = await j.query(ordersInStore, store);
        expect(orders).toEqual([]);
    });

    it("should handle multiple purge conditions correctly", async () => {
        const model = createModel();
        const j = createJinagaClient(p => p
            .whenExists(model.given(Order).match((order, facts) =>
                facts.ofType(OrderCancelled)
                    .join(orderCancelled => orderCancelled.order, order)
            ))
            .whenExists(model.given(Order).match((order, facts) =>
                facts.ofType(OrderShipped)
                    .join(orderShipped => orderShipped.order, order)
            ))
        );
        const store = await j.fact(new Store("storeId"));

        const ordersInStore = model.given(Store).match((store, facts) =>
            facts.ofType(Order)
                .join(order => order.store, store)
                .notExists(order =>
                    facts.ofType(OrderCancelled)
                        .join(orderCancelled => orderCancelled.order, order))
                .notExists(order =>
                    facts.ofType(OrderShipped)
                        .join(orderShipped => orderShipped.order, order))
        );

        const orders = await j.query(ordersInStore, store);
        expect(orders).toEqual([]);
    });

    it("should handle negative existential conditions correctly", async () => {
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

    it("should handle positive existential conditions correctly", async () => {
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
                .exists(order =>
                    facts.ofType(OrderCancelled)
                        .join(orderCancelled => orderCancelled.order, order))
        );

        const orders = await j.query(ordersInStore, store);
        expect(orders).toEqual([]);
    });

    it("should handle complex joins and conditions correctly", async () => {
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
                .exists(order =>
                    facts.ofType(Item)
                        .join(item => item.order, order)
                        .join(item => item.product, "productA"))
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
        .type(OrderCancelledReason, x => x
            .predecessor("orderCancelled", OrderCancelled)
        )
        .type(OrderShipped, x => x
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

class OrderCancelledReason {
    static Type = "Order.Cancelled.Reason" as const;
    type = OrderCancelledReason.Type;

    constructor(
        public orderCancelled: OrderCancelled,
        public reason: string
    ) { }
}

class OrderShipped {
    static Type = "Order.Shipped" as const;
    type = OrderShipped.Type;

    constructor(
        public order: Order,
        public shippedAt: Date | string
    ) { }
}
