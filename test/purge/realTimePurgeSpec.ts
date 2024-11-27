import { JinagaClient, Model, PurgeConditions } from "../../src";
import { createModel as givenModel, Item, Order, OrderCancelled, Product, Store } from "../orderModel";

describe("Real-time purge", () => {
    it("Should find descendants if purge condition is not met", async () => {
        const model = givenModel();
        const j = givenClient(model);

        const store = await j.fact(new Store("storeId"));
        const order = await j.fact(new Order(store, new Date()));
        const item1 = await j.fact(new Item(order, new Product(store, "product1"), 1));
        const item2 = await j.fact(new Item(order, new Product(store, "product2"), 1));

        const itemsInOrder = model.given(Order).match(order =>
            order.successors(Item, item => item.order)
        );

        const items = await j.query(itemsInOrder, order);
        expect(items).toEqual([item1, item2]);
    });

    it("Should purge successors when condition is met", async () => {
        const model = givenModel();
        const j = givenClient(model);

        const store = await j.fact(new Store("storeId"));
        const order = await j.fact(new Order(store, new Date()));
        const item1 = await j.fact(new Item(order, new Product(store, "product1"), 1));
        const item2 = await j.fact(new Item(order, new Product(store, "product2"), 1));
        const orderCancelled = await j.fact(new OrderCancelled(order, new Date()));

        const itemsInOrder = model.given(Order).match(order =>
            order.successors(Item, item => item.order)
        );

        const items = await j.query(itemsInOrder, order);
        expect(items).toEqual([]);
    });

    it("Should not purge the trigger fact", async () => {
        const model = givenModel();
        const j = givenClient(model);

        const store = await j.fact(new Store("storeId"));
        const order = await j.fact(new Order(store, new Date()));
        const item1 = await j.fact(new Item(order, new Product(store, "product1"), 1));
        const item2 = await j.fact(new Item(order, new Product(store, "product2"), 1));
        const orderCancelled = await j.fact(new OrderCancelled(order, new Date()));

        const cancelOfOrder = model.given(Order).match(order =>
            order.successors(OrderCancelled, cancelled => cancelled.order)
        );

        const orders = await j.query(cancelOfOrder, order);
        expect(orders).toEqual([orderCancelled]);
    });
});

function givenClient(model: Model) {
    return createJinagaClient(p => p
        .whenExists(model.given(Order).match((order, facts) => facts.ofType(OrderCancelled)
            .join(orderCancelled => orderCancelled.order, order)
        ))
    );
}

function createJinagaClient(purgeConditions: (p: PurgeConditions) => PurgeConditions) {
    return JinagaClient.create({
        purgeConditions
    });
}
