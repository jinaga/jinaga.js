function safeFlatten<U>(results: U[][]) {
  const flat = results.reduce((a, b) =>
    (!a || a.length === 0) ? b :
    (!b || b.length === 0) ? a :
      a.concat(b));
  return flat ? flat : [];
}

export async function flattenAsync<T, U>(collection: T[], selector: (element: T) => Promise<U[]>) {
    if (collection.length === 0) {
        return [];
    }
    else {
        const results = await Promise.all(collection.map(selector));
        return safeFlatten(results);
    }
}

export function flatten<T, U>(collection: T[], selector: (element: T) => U[]) {
    if (collection.length === 0) {
        return [];
    }
    else {
        return safeFlatten(collection.map(selector));
    }
}

export async function mapAsync<T, U>(collection: T[], action: (element: T) => Promise<U>) {
    if (collection.length === 0) {
        return [];
    }
    else {
        return await Promise.all(collection.map(action));
    }
}

export async function filterAsync<T>(collection: T[], predicate: (element: T) => Promise<boolean>) {
    if (collection.length === 0) {
        return [];
    }
    else {
        const filters = await Promise.all(collection.map(async element => ({
            include: await predicate(element),
            element
        })));

        return filters.filter(f => f.include).map(f => f.element);
    }
}

export function findIndex<T>(array: T[], predicate: ((element: T) => boolean)): number {
    for (let index = 0; index < array.length; index++) {
        if (predicate(array[index])) {
            return index;
        }
    }

    return -1;
}

export function distinct<T>(value: T, index: number, self: T[]) { 
    return self.indexOf(value) === index;
}