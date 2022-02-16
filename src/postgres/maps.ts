export type FactTypeMap = Map<string, number>;

export function emptyFactTypeMap() {
    return new Map<string, number>();
}

export function copyFactTypeMap(map: FactTypeMap) {
    return new Map<string, number>(map);
}

export function addFactType(map: FactTypeMap, name: string, fact_type_id: number) {
    return map.set(name, fact_type_id);
}

export function getFactTypeId(map: FactTypeMap, name: string) {
    return map.get(name);
}

export function mergeFactTypes(map1: FactTypeMap, map2: FactTypeMap) {
    return new Map<string, number>([...map1, ...map2]);
}

export type RoleMap = Map<number, Map<string, number>>;

export function emptyRoleMap() {
    return new Map<number, Map<string, number>>();
}

export function copyRoleMap(map: RoleMap) {
    return new Map<number, Map<string, number>>(map);
}

export function addRole(map: RoleMap, defining_fact_type_id: number, name: string, role_id: number) {
    const factTypeRoles = map.get(defining_fact_type_id) || new Map<string, number>();
    const modifiedFactTypeRoles = factTypeRoles.set(name, role_id);
    return map.set(defining_fact_type_id, modifiedFactTypeRoles);
}

export function hasRole(map: RoleMap, defining_fact_type_id: number, name: string) {
    const roleMap = map.get(defining_fact_type_id);
    return roleMap && roleMap.has(name);
}

export function getRoleId(map: RoleMap, defining_fact_type_id: number, name: string) {
    const roleMap = map.get(defining_fact_type_id);
    return roleMap && roleMap.get(name);
}

export function mergeRoleMaps(map1: RoleMap, map2: RoleMap) {
    let merged = new Map<number, Map<string, number>>(map1);
    for (const [defining_fact_type_id, roleMap] of map2) {
        const mergedRoleMap = merged.get(defining_fact_type_id) || new Map<string, number>();
        const mergedFactTypeRoles = new Map<string, number>([...mergedRoleMap, ...roleMap]);
        merged = merged.set(defining_fact_type_id, mergedFactTypeRoles);
    }
    return merged;
}

export type FactMap = Map<string, Map<number, number>>;

export function emptyFactMap() {
    return new Map<string, Map<number, number>>();
}

export function addFact(map: FactMap, hash: string, fact_type_id: number, fact_id: number) {
    const typeMap = map.get(hash) || new Map<number, number>();
    const modifiedTypeMap = typeMap.set(fact_type_id, fact_id);
    return map.set(hash, modifiedTypeMap);
}

export function hasFact(map: FactMap, hash: string, fact_type_id: number) {
    const typeMap = map.get(hash);
    return typeMap && typeMap.has(fact_type_id);
}

export function getFactId(map: FactMap, hash: string, fact_type_id: number) {
    const typeMap = map.get(hash) || new Map<number, number>();
    return typeMap.get(fact_type_id);
}

export type PublicKeyMap = Map<string, number>;

export function emptyPublicKeyMap() {
    return new Map<string, number>();
}

export function getPublicKeyId(publicKeyMap: PublicKeyMap, publicKey: string) {
    return publicKeyMap.get(publicKey);
}
