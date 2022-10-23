import { fromDescriptiveString } from '../../src/query/descriptive-string';
import { invertQuery } from '../../src/query/inverter';

describe("QueryInverter", () => {
    it("the identity query does not affect any others", () => {
        var inverses = invertQuery(fromDescriptiveString(""));
        expect(inverses.length).toEqual(0);
    });

    it("a predecessor query cannot affect anything: the successor does not yet exist", () => {
        var inverses = invertQuery(fromDescriptiveString("P.project"));
        expect(inverses.length).toEqual(0);
    });

    it("a successor query affects its predecessor; it adds the new fact itself", () => {
        var inverses = invertQuery(fromDescriptiveString("S.project F.type=\"Task\""));
        expect(inverses.length).toEqual(1);
        expect(inverses[0].affected.toDescriptiveString()).toEqual("F.type=\"Task\" P.project");
        expect(inverses[0].added?.toDescriptiveString()).toEqual("");
        expect(inverses[0].removed).toBeNull();
    });

    it("a grandchild query affects its grandparent", () => {
        var inverses = invertQuery(fromDescriptiveString("S.project S.task F.type=\"Completed\""));
        expect(inverses.length).toEqual(1);
        expect(inverses[0].affected.toDescriptiveString()).toEqual("F.type=\"Completed\" P.task P.project");
        expect(inverses[0].added?.toDescriptiveString()).toEqual("");
        expect(inverses[0].removed).toBeNull();
    });

    it("a grandchild query can have field conditions", () => {
        var inverses = invertQuery(fromDescriptiveString("F.type=\"Project\" S.project F.type=\"Task\" S.task F.type=\"Completion\""));
        expect(inverses.length).toEqual(1);
        expect(inverses[0].affected.toDescriptiveString()).toEqual("F.type=\"Completion\" P.task F.type=\"Task\" P.project F.type=\"Project\"");
        expect(inverses[0].added?.toDescriptiveString()).toEqual("");
        expect(inverses[0].removed).toBeNull();
    });

    it("a query may begin with a field condition", () => {
        var inverses = invertQuery(fromDescriptiveString("F.type=\"Project\" S.project F.type=\"Task\""));
        expect(inverses.length).toEqual(1);
        expect(inverses[0].affected.toDescriptiveString()).toEqual("F.type=\"Task\" P.project F.type=\"Project\"");
        expect(inverses[0].added?.toDescriptiveString()).toEqual("");
        expect(inverses[0].removed).toBeNull();
    });

    it("a field value is applied to the affected query", () => {
        var inverses = invertQuery(fromDescriptiveString("S.user F.type=\"Assignment\" P.project"));
        expect(inverses.length).toEqual(1);

        expect(inverses[0].affected.toDescriptiveString()).toEqual("F.type=\"Assignment\" P.user");
        expect(inverses[0].added?.toDescriptiveString()).toEqual("P.project");
        expect(inverses[0].removed).toBeNull();
    });

    it("an existential successor query affects the predecessor; it removes the child", () => {
        var inverses = invertQuery(fromDescriptiveString("F.type=\"Project\" S.project F.type=\"Task\" N(S.task F.type=\"TaskCompleted\")"));
        expect(inverses.length).toEqual(2);
        expect(inverses[0].affected.toDescriptiveString()).toEqual("F.type=\"Task\" P.project F.type=\"Project\"");
        expect(inverses[0].added?.toDescriptiveString()).toEqual("");
        expect(inverses[0].removed).toBeNull();
        expect(inverses[1].affected.toDescriptiveString()).toEqual("F.type=\"TaskCompleted\" P.task F.type=\"Task\" P.project F.type=\"Project\"");
        expect(inverses[1].removed?.toDescriptiveString()).toEqual("F.type=\"TaskCompleted\" P.task");
        expect(inverses[1].added).toBeNull();
    });

    it("an existential query for successor is always false for a new fact", () => {
        var inverses = invertQuery(fromDescriptiveString("F.type=\"Project\" S.project F.type=\"Task\" E(S.task F.type=\"TaskCompleted\")"));
        expect(inverses.length).toEqual(1);
        expect(inverses[0].affected.toDescriptiveString()).toEqual("F.type=\"TaskCompleted\" P.task F.type=\"Task\" P.project F.type=\"Project\"");
        expect(inverses[0].added?.toDescriptiveString()).toEqual("F.type=\"TaskCompleted\" P.task");
        expect(inverses[0].removed).toBeNull();
    });

    it("added does not start with existential query", () => {
        var inverses = invertQuery(fromDescriptiveString('S.project F.type="Task" N(S.task F.type="TaskCompleted") N(S.oldTask F.type="Task.Migration")'));
        expect(inverses.map(i => ({
            appliedToType: i.appliedToType,
            affected: i.affected.toDescriptiveString(),
            added: i.added ? i.added.toDescriptiveString() : null,
            removed: i.removed ? i.removed.toDescriptiveString() : null
        }))).toEqual([
            {
                appliedToType: 'Task',
                affected: 'F.type="Task" P.project',
                added: '',
                removed: null
            },
            {
                appliedToType: 'TaskCompleted',
                affected: 'F.type="TaskCompleted" P.task F.type="Task" P.project',
                added: null,
                removed: 'F.type="TaskCompleted" P.task N(S.oldTask F.type="Task.Migration")'
            },
            {
                appliedToType: 'Task.Migration',
                affected: 'F.type="Task.Migration" P.oldTask F.type="Task" P.project',
                added: null,
                removed: 'F.type="Task.Migration" P.oldTask'
            }
        ]);
    });

    it("first existential query is never satisfied", () => {
        var inverses = invertQuery(fromDescriptiveString('S.project F.type="Task" E(S.task F.type="TaskCompleted") N(S.oldTask F.type="Task.Migration")'));
        expect(inverses.map(i => ({
            appliedToType: i.appliedToType,
            affected: i.affected.toDescriptiveString(),
            added: i.added ? i.added.toDescriptiveString() : null,
            removed: i.removed ? i.removed.toDescriptiveString() : null
        }))).toEqual([
            {
                appliedToType: 'TaskCompleted',
                affected: 'F.type="TaskCompleted" P.task F.type="Task" P.project',
                added: 'F.type="TaskCompleted" P.task N(S.oldTask F.type="Task.Migration")',
                removed: null
            },
            {
                appliedToType: 'Task.Migration',
                affected: 'F.type="Task.Migration" P.oldTask F.type="Task" P.project',
                added: null,
                removed: 'F.type="Task.Migration" P.oldTask'
            }
        ]);
    });

    it("second existential query is never satisfied", () => {
        var inverses = invertQuery(fromDescriptiveString('S.project F.type="Task" N(S.task F.type="TaskCompleted") E(S.oldTask F.type="Task.Migration")'));
        expect(inverses.map(i => ({
            appliedToType: i.appliedToType,
            affected: i.affected.toDescriptiveString(),
            added: i.added ? i.added.toDescriptiveString() : null,
            removed: i.removed ? i.removed.toDescriptiveString() : null
        }))).toEqual([
            {
                appliedToType: 'TaskCompleted',
                affected: 'F.type="TaskCompleted" P.task F.type="Task" P.project',
                added: null,
                removed: 'F.type="TaskCompleted" P.task E(S.oldTask F.type="Task.Migration")'
            },
            {
                appliedToType: 'Task.Migration',
                affected: 'F.type="Task.Migration" P.oldTask F.type="Task" P.project',
                added: 'F.type="Task.Migration" P.oldTask',
                removed: null
            }
        ]);
    });
});
