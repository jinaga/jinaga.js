export type Primitive =
    | null
    | undefined
    | string
    | number
    | boolean
    | symbol
    | bigint;

type TemplateElement<T> =
    T extends Primitive ? T :
    T extends object ? { [P in keyof T]?: TemplateElement<T[P]> } :
    never;

export type Template<T> = TemplateElement<T> | TemplateElement<T>[] | undefined;