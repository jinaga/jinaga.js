const { parseSpecification } = require("../dist/specification/specification-parser");
const fs = require("fs");

try {
    var input = fs.readFileSync(0, 'utf-8');
    var specification = parseSpecification(input);
    console.log(JSON.stringify(specification, null, 2));
} catch (e) {
    console.error(e);
}