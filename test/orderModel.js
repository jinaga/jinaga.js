"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OrderShipped = exports.OrderCancelledReason = exports.OrderCancelled = exports.Item = exports.Product = exports.Order = exports.Store = exports.createModel = void 0;
const _src_1 = require("@src");
function createModel() {
    return (0, _src_1.buildModel)(b => b
        .type(Store)
        .type(Order, x => x
        .predecessor("store", Store))
        .type(Item, x => x
        .predecessor("order", Order)
        .predecessor("product", Product))
        .type(OrderCancelled, x => x
        .predecessor("order", Order))
        .type(OrderCancelledReason, x => x
        .predecessor("orderCancelled", OrderCancelled))
        .type(OrderShipped, x => x
        .predecessor("order", Order)));
}
exports.createModel = createModel;
class Store {
    constructor(identifier) {
        this.identifier = identifier;
        this.type = Store.Type;
    }
}
exports.Store = Store;
Store.Type = "Store";
class Order {
    constructor(store, createdAt) {
        this.store = store;
        this.createdAt = createdAt;
        this.type = Order.Type;
    }
}
exports.Order = Order;
Order.Type = "Order";
class Product {
    constructor(store, identifier) {
        this.store = store;
        this.identifier = identifier;
        this.type = Product.Type;
    }
}
exports.Product = Product;
Product.Type = "Product";
class Item {
    constructor(order, product, quantity) {
        this.order = order;
        this.product = product;
        this.quantity = quantity;
        this.type = Item.Type;
    }
}
exports.Item = Item;
Item.Type = "Order.Item";
class OrderCancelled {
    constructor(order, cancelledAt) {
        this.order = order;
        this.cancelledAt = cancelledAt;
        this.type = OrderCancelled.Type;
    }
}
exports.OrderCancelled = OrderCancelled;
OrderCancelled.Type = "Order.Cancelled";
class OrderCancelledReason {
    constructor(orderCancelled, reason) {
        this.orderCancelled = orderCancelled;
        this.reason = reason;
        this.type = OrderCancelledReason.Type;
    }
}
exports.OrderCancelledReason = OrderCancelledReason;
OrderCancelledReason.Type = "Order.Cancelled.Reason";
class OrderShipped {
    constructor(order, shippedAt) {
        this.order = order;
        this.shippedAt = shippedAt;
        this.type = OrderShipped.Type;
    }
}
exports.OrderShipped = OrderShipped;
OrderShipped.Type = "Order.Shipped";
//# sourceMappingURL=orderModel.js.map