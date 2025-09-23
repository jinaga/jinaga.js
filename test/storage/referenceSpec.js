"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("source-map-support/register");
const _src_1 = require("@src");
describe('Fact reference', () => {
    it('should find unique in empty list', () => {
        const unique = (0, _src_1.uniqueFactReferences)([]);
        expect(unique.length).toEqual(0);
    });
    it('should find unique in singleton', () => {
        const unique = (0, _src_1.uniqueFactReferences)([{ type: '', hash: '' }]);
        expect(unique.length).toEqual(1);
    });
    it('should find unique in double', () => {
        const unique = (0, _src_1.uniqueFactReferences)([{ type: '', hash: '' }, { type: '', hash: '' }]);
        expect(unique.length).toEqual(1);
    });
    it('should find unique in same type', () => {
        const unique = (0, _src_1.uniqueFactReferences)([{ type: 'a', hash: '' }, { type: 'a', hash: '' }]);
        expect(unique.length).toEqual(1);
    });
    it('should find unique in different type', () => {
        const unique = (0, _src_1.uniqueFactReferences)([{ type: 'a', hash: '' }, { type: 'b', hash: '' }]);
        expect(unique.length).toEqual(2);
    });
    it('should find unique in same hash', () => {
        const unique = (0, _src_1.uniqueFactReferences)([{ type: 'a', hash: 'x' }, { type: 'a', hash: 'x' }]);
        expect(unique.length).toEqual(1);
    });
    it('should find unique in different hash', () => {
        const unique = (0, _src_1.uniqueFactReferences)([{ type: 'a', hash: 'x' }, { type: 'a', hash: 'y' }]);
        expect(unique.length).toEqual(2);
    });
});
//# sourceMappingURL=referenceSpec.js.map