import { buildModel } from "../src";

export function createModel() {
    return buildModel(b => b
        .type(Store)
        .type(Order, x => x
            .predecessor("store", Store)
        )
        .type(Item, x => x
            .predecessor("order", Order)
            .predecessor("product", Product)
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
export class Store {
    static Type = "Store" as const;
    type = Store.Type;

    constructor(
        public identifier: string
    ) {}
}
export class Order {
    static Type = "Order" as const;
    type = Order.Type;

    constructor(
        public store: Store,
        public createdAt: Date | string
    ) {}
}
export class Product {
    static Type = "Product" as const;
    type = Product.Type;

    constructor(
        public store: Store,
        public identifier: string
    ) {}
}
export class Item {
    static Type = "Order.Item" as const;
    type = Item.Type;

    constructor(
        public order: Order,
        public product: Product,
        public quantity: number
    ) {}
}
export class OrderCancelled {
    static Type = "Order.Cancelled" as const;
    type = OrderCancelled.Type;

    constructor(
        public order: Order,
        public cancelledAt: Date | string
    ) {}
}
export class OrderCancelledReason {
    static Type = "Order.Cancelled.Reason" as const;
    type = OrderCancelledReason.Type;

    constructor(
        public orderCancelled: OrderCancelled,
        public reason: string
    ) {}
}
export class OrderShipped {
    static Type = "Order.Shipped" as const;
    type = OrderShipped.Type;

    constructor(
        public order: Order,
        public shippedAt: Date | string
    ) {}
}
