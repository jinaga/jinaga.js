import { JinagaClient, PurgeConditions } from "../../src";
import { createModel, Store, Order, OrderCancelled, OrderCancelledReason, OrderShipped, Product, Item } from "../orderModel";

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

    it("should throw if the specification passes through the purge root", async () => {
        const model = createModel();
        const j = createJinagaClient(p => p
            .whenExists(model.given(Order).match((order, facts) =>
                facts.ofType(OrderCancelled)
                    .join(orderCancelled => orderCancelled.order, order)
            ))
        );
        const store = await j.fact(new Store("storeId"));

        const shipmentsInStore = model.given(Store).match(store =>
            store.successors(OrderShipped, shipped => shipped.order.store)
        );

        const shipments = j.query(shipmentsInStore, store);
        await expect(shipments).rejects.toThrow(
`The match for Order.Shipped passes through types that should have purge conditions:
!E (p1: Order) {
    u1: Order.Cancelled [
        u1->order: Order = p1
    ]
}
`);
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

    it("should disallow reversible purge conditions", async () => {
        const model = createModel();
        const jConstructor = () => createJinagaClient(p => p
            .whenExists(model.given(Order).match((order, facts) =>
                facts.ofType(OrderCancelled)
                    .join(orderCancelled => orderCancelled.order, order)
                    .notExists(orderCancelled =>
                        facts.ofType(OrderCancelledReason)
                            .join(reason => reason.orderCancelled, orderCancelled))
            ))
        );
        expect(jConstructor).toThrow("A specified purge condition would reverse the purge of Order with Order.Cancelled.Reason.");
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

    it("should fail on positive existential conditions", async () => {
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

        const orders = j.query(ordersInStore, store);
        await expect(orders).rejects.toThrow(
`The match for Order is missing purge conditions:
!E (p1: Order) {
    u1: Order.Cancelled [
        u1->order: Order = p1
    ]
}
`);
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
        const productA = await j.fact(new Product(store, "productA"));

        const ordersInStore = model.given(Store, Product).match((store, product, facts) =>
            facts.ofType(Order)
                .join(order => order.store, store)
                .notExists(order =>
                    facts.ofType(OrderCancelled)
                        .join(orderCancelled => orderCancelled.order, order))
                .exists(order =>
                    facts.ofType(Item)
                        .join(item => item.order, order)
                        .join(item => item.product, product))
        );

        const orders = await j.query(ordersInStore, store, productA);
        expect(orders).toEqual([]);
    });
});

function createJinagaClient(purgeConditions: (p: PurgeConditions) => PurgeConditions) {
    return JinagaClient.create({
        purgeConditions
    });
}
