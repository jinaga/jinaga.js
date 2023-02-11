export function toJSON(value: any) {
    if (hasProperty(value, "toJSON")) {
        return value.toJSON();
    }
    else {
        return value;
    }
}

function hasProperty(value: any, name: string) {
    while (value !== null) {
        if (typeof(value) !== "object") {
            return false;
        }
        if (value.hasOwnProperty(name)) {
            return true;
        }
        value = Object.getPrototypeOf(value);
    }
    return false;
}