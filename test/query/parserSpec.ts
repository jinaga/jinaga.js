import 'source-map-support/register';

import { Jinaga } from '../../src/jinaga';
import { Query } from '../../src/query/query';
import { ConditionOf, Preposition, SpecificationOf, ensure } from '../../src/query/query-parser';
import { AuthenticationNoOp } from './AuthenticationNoOp';

describe('Query parser', () => {

    const j = new Jinaga(new AuthenticationNoOp(), null);

    function tasksInList(l: List): SpecificationOf<Task> {
        return j.match({
            type: 'Task',
            list: l
        });
    }

    function completionsInList(l: List): SpecificationOf<Completion> {
        return j.match({
            type: 'Completion',
            task: {
                type: 'Task',
                list: l
            }
        });
    }

    function listOfTask(t: Task): SpecificationOf<List> {
        ensure(t).has("list", "List");
        return j.match(t.list);
    }

    function listOfCompletion(c: Completion): SpecificationOf<List> {
        ensure(c).has("task", "Task");
        ensure(c.task!).has("list", "List");
        return j.match(c.task?.list);
    }

    function taskIsNotCompleted(t: Task): ConditionOf<Completion> {
        return j.notExists({
            type: 'Completion',
            task: t
        });
    }

    function stillCompletedTasksInList(l: List) {
        return j.match({
            type: 'Task',
            list: l
        }).suchThat(taskIsStillCompleted);
    }

    function taskIsStillCompleted(t: Task) {
        return j.notExists({
            type: 'Completion',
            task: t
        }).suchThat(completionIsNotRevoked);
    }

    function completionIsNotRevoked(c: Completion) {
        return j.notExists({
            type: 'Revocation',
            completion: c
        });
    }

    function taskIsCompleted(t: Task): ConditionOf<Completion> {
        return j.exists({
            type: 'Completion',
            task: t
        });
    }

    function uncompletedTasksInList(l: List): SpecificationOf<Completion> {
        return j.match({
            type: 'Task',
            list: l
        }).suchThat(taskIsNotCompleted);
    }

    function completedTasksInList(l: List): SpecificationOf<Completion> {
        return j.match({
            type: 'Task',
            list: l
        }).suchThat(taskIsCompleted);
    }

    function completedTasksInListWithArray(l: List): SpecificationOf<Task> {
        return j.match({
            type: 'Task',
            list: <any>[l]
        }).suchThat(taskIsCompleted);
    }

    function uncompletedTasksInListAlt(l: List): SpecificationOf<Task> {
        return j.match({
            type: 'Task',
            list: l
        }).suchThat(j.not(taskIsCompleted));
    }

    function completedTasksInListAlt(l: List): SpecificationOf<Task> {
        return j.match({
            type: 'Task',
            list: l
        }).suchThat(j.not(taskIsNotCompleted));
    }

    type List = { type: string };
    type Task = { type: string, list?: List };
    type Completion = { type: string, task?: Task };
    
    type S = {};
    type A = {};
    type B = {};
    
    function con1(a: A) {
        return j.exists({
            type: "B",
            y: a
        });
    }
    
    function con2(b: B) {
        return j.exists({
            type: "C",
            z: b
        });
    }

    function parseQuery<T, U>(preposition: Preposition<T, U>) {
        return new Query(preposition.steps);
    }
    
    it('should parse to a successor query', () => {
        const query = parseQuery(j.for(tasksInList));
        expect(query.toDescriptiveString()).toEqual('S.list F.type="Task"');
    });

    it('should find two successors', () => {
        var query = parseQuery(j.for(completionsInList));
        expect(query.toDescriptiveString()).toEqual('S.list F.type="Task" S.task F.type="Completion"');
    });

    it('should find predecessor', () => {
        var query = parseQuery(j.for(listOfTask));
        expect(query.toDescriptiveString()).toEqual('P.list F.type="List"');
    });

    it('should find two predecessors', () => {
        var query = parseQuery(j.for(listOfCompletion));
        expect(query.toDescriptiveString()).toEqual('P.task F.type="Task" P.list F.type="List"');
    });

    it('should parse a negative existential condition', () => {
        var query = parseQuery(j.for(uncompletedTasksInList));
        expect(query.toDescriptiveString()).toEqual('S.list F.type="Task" N(S.task F.type="Completion")');
    });

    it('should parse a positive existential condition', () => {
        var query = parseQuery(j.for(completedTasksInList));
        expect(query.toDescriptiveString()).toEqual('S.list F.type="Task" E(S.task F.type="Completion")');
    });

    it('should parse a negative outside of template function', () => {
        var query = parseQuery(j.for(uncompletedTasksInListAlt));
        expect(query.toDescriptiveString()).toEqual('S.list F.type="Task" N(S.task F.type="Completion")');
    });

    it('should parse a double negative', () => {
        var query = parseQuery(j.for(completedTasksInListAlt));
        expect(query.toDescriptiveString()).toEqual('S.list F.type="Task" E(S.task F.type="Completion")');
    });

    it('should chain to find siblings', () => {
        var query = parseQuery(j.for(listOfTask).then(uncompletedTasksInList));
        expect(query.toDescriptiveString()).toEqual('P.list F.type="List" S.list F.type="Task" N(S.task F.type="Completion")');
    })

    it('should allow array with one predecessor', () => {
        var query = parseQuery(j.for(completedTasksInListWithArray));
        expect(query.toDescriptiveString()).toEqual('S.list F.type="Task" E(S.task F.type="Completion")');
    });

    it('should parse nested conditions', () => {
        const query = parseQuery(j.for(stillCompletedTasksInList));
        expect(query.toDescriptiveString()).toEqual('S.list F.type="Task" N(S.task F.type="Completion" N(S.completion F.type="Revocation"))');
    })

    it('should allow positive conjunction', () => {
        function conjoin(s: S) {
            return j.match({
                type: "A",
                x: s
            }).suchThat(con1).suchThat(con2);
        }

        var query = parseQuery(j.for(conjoin));
        expect(query.toDescriptiveString()).toEqual('S.x F.type="A" E(S.y F.type="B") E(S.z F.type="C")');
    });

    it('should allow positive with negative conjunction', () => {
        function conjoin(s: S) {
            return j.match({
                type: "A",
                x: s
            }).suchThat(con1).suchThat(j.not(con2));
        }

        var query = parseQuery(j.for(conjoin));
        expect(query.toDescriptiveString()).toEqual('S.x F.type="A" E(S.y F.type="B") N(S.z F.type="C")');
    });

    it('should allow negative conjunction', () => {
        function conjoin(s: S) {
            return j.match({
                type: "A",
                x: s
            }).suchThat(j.not(con1)).suchThat(j.not(con2));
        }

        var query = parseQuery(j.for(conjoin));
        expect(query.toDescriptiveString()).toEqual('S.x F.type="A" N(S.y F.type="B") N(S.z F.type="C")');
    });

    it('should allow condition', () => {
        function conjoin(s: S) {
            return j.match({
                type: "A",
                x: s
            }).suchThat(j.not(con1));
        }

        var query = parseQuery(j.for(conjoin));
        expect(query.toDescriptiveString()).toEqual('S.x F.type="A" N(S.y F.type="B")');
    });

    it('should parse nested predecessors', () => {
        function grandchildren(s: any) {
            return j.match({
                type: 'Child',
                parent: {
                    type: 'Parent',
                    grandparent: s
                }
            });
        }

        const query = parseQuery(j.for(grandchildren));
        expect(query.toDescriptiveString()).toEqual('S.grandparent F.type="Parent" S.parent F.type="Child"');
    });

    it('should parse consecutive existential conditions', () => {
        function ideaAbstractsInCompany(c: any) {
            return Jinaga.match({
                type: 'ImprovingU.Abstract',
                idea: {
                    type: 'ImprovingU.Idea',
                    semester: {
                        type: 'ImprovingU.Semester',
                        office: {
                            type: 'ImprovingU.Office',
                            company: c
                        }
                    }
                }
            }).suchThat(ideaAbstractIsCurrent).suchThat(ideaAbstractNotMigrated);
        }
        
        function ideaAbstractIsCurrent(next: any) {
            return Jinaga.notExists({
                type: 'ImprovingU.Abstract',
                prior: [next]
            });
        }
        
        function ideaAbstractNotMigrated(a: any) {
            return Jinaga.notExists({
                type: 'ImprovingU.Abstract.Migration',
                oldAbstract: a
            });
        }

        const query = parseQuery(j.for(ideaAbstractsInCompany));
        expect(query.toDescriptiveString()).toEqual(
            'S.company F.type="ImprovingU.Office" ' +
            'S.office F.type="ImprovingU.Semester" ' +
            'S.semester F.type="ImprovingU.Idea" ' +
            'S.idea F.type="ImprovingU.Abstract" ' +
            'N(S.prior F.type="ImprovingU.Abstract") ' +
            'N(S.oldAbstract F.type="ImprovingU.Abstract.Migration")'
        );
    });
});