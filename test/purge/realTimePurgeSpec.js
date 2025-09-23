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
describe("Real-time purge", () => {
    it("Should find descendants if purge condition is not met", () => __awaiter(void 0, void 0, void 0, function* () {
        const model = (0, orderModel_1.createModel)();
        const j = givenClientWithPurgeCondition(model);
        const store = yield j.fact(new orderModel_1.Store("storeId"));
        const order = yield j.fact(new orderModel_1.Order(store, new Date()));
        const item1 = yield j.fact(new orderModel_1.Item(order, new orderModel_1.Product(store, "product1"), 1));
        const item2 = yield j.fact(new orderModel_1.Item(order, new orderModel_1.Product(store, "product2"), 1));
        const itemsInOrder = model.given(orderModel_1.Order).match(order => order.successors(orderModel_1.Item, item => item.order));
        const items = yield j.query(itemsInOrder, order);
        expect(items).toEqual([item1, item2]);
    }));
    it("Should purge successors when condition is met", () => __awaiter(void 0, void 0, void 0, function* () {
        const model = (0, orderModel_1.createModel)();
        const j = givenClientWithPurgeCondition(model);
        const store = yield j.fact(new orderModel_1.Store("storeId"));
        const order = yield j.fact(new orderModel_1.Order(store, new Date()));
        const item1 = yield j.fact(new orderModel_1.Item(order, new orderModel_1.Product(store, "product1"), 1));
        const item2 = yield j.fact(new orderModel_1.Item(order, new orderModel_1.Product(store, "product2"), 1));
        const orderCancelled = yield j.fact(new orderModel_1.OrderCancelled(order, new Date()));
        const itemsInOrder = model.given(orderModel_1.Order).match(order => order.successors(orderModel_1.Item, item => item.order));
        const items = yield j.query(itemsInOrder, order);
        expect(items).toEqual([]);
    }));
    it("Should not purge the trigger fact", () => __awaiter(void 0, void 0, void 0, function* () {
        const model = (0, orderModel_1.createModel)();
        const j = givenClientWithPurgeCondition(model);
        const store = yield j.fact(new orderModel_1.Store("storeId"));
        const order = yield j.fact(new orderModel_1.Order(store, new Date()));
        const item1 = yield j.fact(new orderModel_1.Item(order, new orderModel_1.Product(store, "product1"), 1));
        const item2 = yield j.fact(new orderModel_1.Item(order, new orderModel_1.Product(store, "product2"), 1));
        const orderCancelled = yield j.fact(new orderModel_1.OrderCancelled(order, new Date()));
        const cancelOfOrder = model.given(orderModel_1.Order).match(order => order.successors(orderModel_1.OrderCancelled, cancelled => cancelled.order));
        const cancels = yield j.query(cancelOfOrder, order);
        expect(cancels).toEqual([orderCancelled]);
    }));
    it("Should not purge ancestors of the trigger fact", () => __awaiter(void 0, void 0, void 0, function* () {
        const model = (0, orderModel_1.createModel)();
        const j = createJinagaClient(p => p
            .whenExists(model.given(orderModel_1.Order).match(order => order.successors(orderModel_1.OrderCancelledReason, reason => reason.orderCancelled.order))));
        const store = yield j.fact(new orderModel_1.Store("storeId"));
        const order = yield j.fact(new orderModel_1.Order(store, new Date()));
        const item1 = yield j.fact(new orderModel_1.Item(order, new orderModel_1.Product(store, "product1"), 1));
        const item2 = yield j.fact(new orderModel_1.Item(order, new orderModel_1.Product(store, "product2"), 1));
        const orderCancelled = yield j.fact(new orderModel_1.OrderCancelled(order, new Date()));
        const reason = yield j.fact(new orderModel_1.OrderCancelledReason(orderCancelled, "reason"));
        const cancelOfOrder = model.given(orderModel_1.Order).match(order => order.successors(orderModel_1.OrderCancelled, cancelled => cancelled.order));
        const cancels = yield j.query(cancelOfOrder, order);
        expect(cancels).toEqual([orderCancelled]);
    }));
});
function givenClientWithPurgeCondition(model) {
    return createJinagaClient(p => p
        .whenExists(model.given(orderModel_1.Order).match((order, facts) => facts.ofType(orderModel_1.OrderCancelled)
        .join(orderCancelled => orderCancelled.order, order))));
}
function createJinagaClient(purgeConditions) {
    return _src_1.JinagaClient.create({
        purgeConditions
    });
}
//# sourceMappingURL=realTimePurgeSpec.js.map