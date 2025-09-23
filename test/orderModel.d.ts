export declare function createModel(): import("@src").Model;
export declare class Store {
    identifier: string;
    static Type: "Store";
    type: "Store";
    constructor(identifier: string);
}
export declare class Order {
    store: Store;
    createdAt: Date | string;
    static Type: "Order";
    type: "Order";
    constructor(store: Store, createdAt: Date | string);
}
export declare class Product {
    store: Store;
    identifier: string;
    static Type: "Product";
    type: "Product";
    constructor(store: Store, identifier: string);
}
export declare class Item {
    order: Order;
    product: Product;
    quantity: number;
    static Type: "Order.Item";
    type: "Order.Item";
    constructor(order: Order, product: Product, quantity: number);
}
export declare class OrderCancelled {
    order: Order;
    cancelledAt: Date | string;
    static Type: "Order.Cancelled";
    type: "Order.Cancelled";
    constructor(order: Order, cancelledAt: Date | string);
}
export declare class OrderCancelledReason {
    orderCancelled: OrderCancelled;
    reason: string;
    static Type: "Order.Cancelled.Reason";
    type: "Order.Cancelled.Reason";
    constructor(orderCancelled: OrderCancelled, reason: string);
}
export declare class OrderShipped {
    order: Order;
    shippedAt: Date | string;
    static Type: "Order.Shipped";
    type: "Order.Shipped";
    constructor(order: Order, shippedAt: Date | string);
}
//# sourceMappingURL=orderModel.d.ts.map