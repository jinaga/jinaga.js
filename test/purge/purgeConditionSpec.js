"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const _src_1 = require("@src");
const orderModel_1 = require("../orderModel");
describe("Purge conditions", () => {
    it("should allow a specification when no purge conditions are specified", () => __awaiter(void 0, void 0, void 0, function* () {
        const j = createJinagaClient(p => p);
        const model = (0, orderModel_1.createModel)();
        const store = yield j.fact(new orderModel_1.Store("storeId"));
        const ordersInStore = model.given(orderModel_1.Store).match((store, facts) => facts.ofType(orderModel_1.Order)
            .join(order => order.store, store));
        const orders = yield j.query(ordersInStore, store);
        expect(orders).toEqual([]);
    }));
    it("should throw if the specification does not include the purge condition", () => __awaiter(void 0, void 0, void 0, function* () {
        const model = (0, orderModel_1.createModel)();
        const j = createJinagaClient(p => p
            .whenExists(model.given(orderModel_1.Order).match((order, facts) => facts.ofType(orderModel_1.OrderCancelled)
            .join(orderCancelled => orderCancelled.order, order))));
        const store = yield j.fact(new orderModel_1.Store("storeId"));
        const ordersInStore = model.given(orderModel_1.Store).match((store, facts) => facts.ofType(orderModel_1.Order)
            .join(order => order.store, store));
        const orders = j.query(ordersInStore, store);
        yield expect(orders).rejects.toThrow();
    }));
    it("should throw if the specification passes through the purge root", () => __awaiter(void 0, void 0, void 0, function* () {
        const model = (0, orderModel_1.createModel)();
        const j = createJinagaClient(p => p
            .whenExists(model.given(orderModel_1.Order).match((order, facts) => facts.ofType(orderModel_1.OrderCancelled)
            .join(orderCancelled => orderCancelled.order, order))));
        const store = yield j.fact(new orderModel_1.Store("storeId"));
        const shipmentsInStore = model.given(orderModel_1.Store).match(store => store.successors(orderModel_1.OrderShipped, shipped => shipped.order.store));
        const shipments = j.query(shipmentsInStore, store);
        yield expect(shipments).rejects.toThrow(`The match for Order.Shipped passes through types that should have purge conditions:
!E (p1: Order) {
    u1: Order.Cancelled [
        u1->order: Order = p1
    ]
}
`);
    }));
    it("should allow a specification when the purge condition is included", () => __awaiter(void 0, void 0, void 0, function* () {
        const model = (0, orderModel_1.createModel)();
        const j = createJinagaClient(p => p
            .whenExists(model.given(orderModel_1.Order).match((order, facts) => facts.ofType(orderModel_1.OrderCancelled)
            .join(orderCancelled => orderCancelled.order, order))));
        const store = yield j.fact(new orderModel_1.Store("storeId"));
        const ordersInStore = model.given(orderModel_1.Store).match((store, facts) => facts.ofType(orderModel_1.Order)
            .join(order => order.store, store)
            .notExists(order => facts.ofType(orderModel_1.OrderCancelled)
            .join(orderCancelled => orderCancelled.order, order)));
        const orders = yield j.query(ordersInStore, store);
        expect(orders).toEqual([]);
    }));
    it("should disallow reversible purge conditions", () => __awaiter(void 0, void 0, void 0, function* () {
        const model = (0, orderModel_1.createModel)();
        const jConstructor = () => createJinagaClient(p => p
            .whenExists(model.given(orderModel_1.Order).match((order, facts) => facts.ofType(orderModel_1.OrderCancelled)
            .join(orderCancelled => orderCancelled.order, order)
            .notExists(orderCancelled => facts.ofType(orderModel_1.OrderCancelledReason)
            .join(reason => reason.orderCancelled, orderCancelled)))));
        expect(jConstructor).toThrow("A specified purge condition would reverse the purge of Order with Order.Cancelled.Reason.");
    }));
    it("should handle multiple purge conditions correctly", () => __awaiter(void 0, void 0, void 0, function* () {
        const model = (0, orderModel_1.createModel)();
        const j = createJinagaClient(p => p
            .whenExists(model.given(orderModel_1.Order).match((order, facts) => facts.ofType(orderModel_1.OrderCancelled)
            .join(orderCancelled => orderCancelled.order, order)))
            .whenExists(model.given(orderModel_1.Order).match((order, facts) => facts.ofType(orderModel_1.OrderShipped)
            .join(orderShipped => orderShipped.order, order))));
        const store = yield j.fact(new orderModel_1.Store("storeId"));
        const ordersInStore = model.given(orderModel_1.Store).match((store, facts) => facts.ofType(orderModel_1.Order)
            .join(order => order.store, store)
            .notExists(order => facts.ofType(orderModel_1.OrderCancelled)
            .join(orderCancelled => orderCancelled.order, order))
            .notExists(order => facts.ofType(orderModel_1.OrderShipped)
            .join(orderShipped => orderShipped.order, order)));
        const orders = yield j.query(ordersInStore, store);
        expect(orders).toEqual([]);
    }));
    it("should handle negative existential conditions correctly", () => __awaiter(void 0, void 0, void 0, function* () {
        const model = (0, orderModel_1.createModel)();
        const j = createJinagaClient(p => p
            .whenExists(model.given(orderModel_1.Order).match((order, facts) => facts.ofType(orderModel_1.OrderCancelled)
            .join(orderCancelled => orderCancelled.order, order))));
        const store = yield j.fact(new orderModel_1.Store("storeId"));
        const ordersInStore = model.given(orderModel_1.Store).match((store, facts) => facts.ofType(orderModel_1.Order)
            .join(order => order.store, store)
            .notExists(order => facts.ofType(orderModel_1.OrderCancelled)
            .join(orderCancelled => orderCancelled.order, order)));
        const orders = yield j.query(ordersInStore, store);
        expect(orders).toEqual([]);
    }));
    it("should fail on positive existential conditions", () => __awaiter(void 0, void 0, void 0, function* () {
        const model = (0, orderModel_1.createModel)();
        const j = createJinagaClient(p => p
            .whenExists(model.given(orderModel_1.Order).match((order, facts) => facts.ofType(orderModel_1.OrderCancelled)
            .join(orderCancelled => orderCancelled.order, order))));
        const store = yield j.fact(new orderModel_1.Store("storeId"));
        const ordersInStore = model.given(orderModel_1.Store).match((store, facts) => facts.ofType(orderModel_1.Order)
            .join(order => order.store, store)
            .exists(order => facts.ofType(orderModel_1.OrderCancelled)
            .join(orderCancelled => orderCancelled.order, order)));
        const orders = j.query(ordersInStore, store);
        yield expect(orders).rejects.toThrow(`The match for Order is missing purge conditions:
!E (p1: Order) {
    u1: Order.Cancelled [
        u1->order: Order = p1
    ]
}
`);
    }));
    it("should handle complex joins and conditions correctly", () => __awaiter(void 0, void 0, void 0, function* () {
        const model = (0, orderModel_1.createModel)();
        const j = createJinagaClient(p => p
            .whenExists(model.given(orderModel_1.Order).match((order, facts) => facts.ofType(orderModel_1.OrderCancelled)
            .join(orderCancelled => orderCancelled.order, order))));
        const store = yield j.fact(new orderModel_1.Store("storeId"));
        const productA = yield j.fact(new orderModel_1.Product(store, "productA"));
        const ordersInStore = model.given(orderModel_1.Store, orderModel_1.Product).match((store, product, facts) => facts.ofType(orderModel_1.Order)
            .join(order => order.store, store)
            .notExists(order => facts.ofType(orderModel_1.OrderCancelled)
            .join(orderCancelled => orderCancelled.order, order))
            .exists(order => facts.ofType(orderModel_1.Item)
            .join(item => item.order, order)
            .join(item => item.product, product)));
        const orders = yield j.query(ordersInStore, store, productA);
        expect(orders).toEqual([]);
    }));
});
function createJinagaClient(purgeConditions) {
    return _src_1.JinagaClient.create({
        purgeConditions
    });
}
//# sourceMappingURL=purgeConditionSpec.js.map