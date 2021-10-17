export type Primitive =
    | null
    | undefined
    | string
    | number
    | boolean
    | symbol
    | bigint;

export type Template<T> =
    T extends Primitive ? T :
    T extends object ? { [P in keyof T]?: Template<T[P]> } :
    never;