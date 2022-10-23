import { ModelMap } from '../../src/watch/model-map';

class TestModel {
    constructor(
        public field: string
    ) {}
}

describe('ModelMap', () => {

    let map: ModelMap<TestModel> = null!;
    const path = [{type: 'type', hash: 'hash'}];

    beforeEach(() => {
        map = new ModelMap<TestModel>();
    });

    it('should be empty', () => {
        expect(map.hasModel(path)).toBeFalsy();
    });

    it('should take model', () => {
        map.setModel(path, new TestModel('test'));
        expect(map.hasModel(path)).toBeTruthy();
    });

    it('should handle model after setting', () => {
        map.setModel(path, new TestModel('test'));
        let model: TestModel | null = null;
        map.withModel(path, m => {
            model = m;
        });
        expect(model).not.toBeNull();
        expect(model!.field).toEqual('test');
    });

    it('should handle model before setting', () => {
        let model: TestModel | null = null;
        map.withModel(path, m => {
            model = m;
        });
        map.setModel(path, new TestModel('test'));
        expect(model).not.toBeNull();
        expect(model!.field).toEqual('test');
    });

    it('should handle model before and after setting', () => {
        let model1: TestModel | null = null;
        let model2: TestModel | null = null;
        map.withModel(path, m => {
            model1 = m;
        });
        map.setModel(path, new TestModel('test'));
        map.withModel(path, m => {
            model2 = m;
        });
        expect(model1).not.toBeNull();
        expect(model1!.field).toEqual('test');
        expect(model2).not.toBeNull();
        expect(model2!.field).toEqual('test');
    });

    it('should remove model', () => {
        map.setModel(path, new TestModel('test'));
        const model = map.removeModel(path);
        expect(model).not.toBeNull();
        expect(model!.field).toEqual('test');
        expect(map.hasModel(path)).toBeFalsy();
    });

    it('should take a function', () => {
        const map = new ModelMap<() => string>();
        map.setModel(path, () => 'Executed');
        let result: string | null = null;
        map.withModel(path, m => {
            result = m();
        });
        expect(result).toEqual('Executed');
    });

    it('should remove a function', () => {
        const map = new ModelMap<() => string>();
        map.setModel(path, () => 'Executed');
        const model = map.removeModel(path);
        expect(model).not.toBeNull();
        let result = model!();
        expect(result).toEqual('Executed');
        expect(map.hasModel(path)).toBeFalsy();
    });

});