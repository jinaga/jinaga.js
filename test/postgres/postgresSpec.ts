import { expect } from 'chai';
import { describe, it } from 'mocha';
import 'source-map-support/register';
import { dehydrateReference } from '../../src/fact/hydrate';
import { addFactType, addRole, emptyFactTypeMap, emptyRoleMap, getFactTypeId, getRoleId } from "../../src/postgres/maps";
import { sqlFromSteps } from '../../src/postgres/sql';
import { fromDescriptiveString } from '../../src/query/descriptive-string';
import { Direction, ExistentialCondition, Join, PropertyCondition, Step } from "../../src/query/steps";
import { distinct } from "../../src/util/fn";

describe('Postgres', () => {

  const start = dehydrateReference({ type: 'Root' });
  const startHash = 'fSS1hK7OGAeSX4ocN3acuFF87jvzCdPN3vLFUtcej0lOAsVV859UIYZLRcHUoMbyd/J31TdVn5QuE7094oqUPg==';

  function sqlFor(descriptiveString: string) {
    const query = fromDescriptiveString(descriptiveString);
    const factTypes = allFactTypes(query.steps).filter(t => t !== 'Unknown').reduce(
      (f, factType, i) => addFactType(f, factType, i + 1),
      emptyFactTypeMap());
    let roleMap = allRoles(query.steps, 'Root').reduce(
      (r, role, i) => addRole(r, getFactTypeId(factTypes, role.type), role.role, i + 1),
      emptyRoleMap());
    const sqlQuery = sqlFromSteps(start, query.steps, factTypes, roleMap);
    return sqlQuery ? { sql: sqlQuery.sql, parameters: sqlQuery.parameters, pathLength: sqlQuery.pathLength, empty: sqlQuery.empty, factTypes, roleMap } : null;
  }

  it('should parse empty query', () => {
    expect(sqlFor('')).to.equal(null);
  });

  it('should error on successor query', () => {
    const parse = () => sqlFor('S.predecessor');
    expect(parse).to.throw(Error, 'Missing type for role predecessor');
  });

  it('should error on predecessor query', () => {
    const parse = () => sqlFor('P.parent');
    expect(parse).to.throw(Error, 'Missing final type');
  });

  it('should parse successor query with type', () => {
    const { sql, parameters, pathLength, factTypes, roleMap } = sqlFor('S.predecessor F.type="IntegrationTest.Successor"');
    expect(sql).to.equal(
      'SELECT f2.hash as hash2 ' +
      'FROM public.fact f1 ' +
      'JOIN public.edge e1 ON e1.predecessor_fact_id = f1.fact_id AND e1.role_id = $3 ' +
      'JOIN public.fact f2 ON f2.fact_id = e1.successor_fact_id ' +
      'WHERE f1.fact_type_id = $1 AND f1.hash = $2'
    );
    expect(parameters[0]).to.equal(getFactTypeId(factTypes, 'Root'));
    expect(parameters[1]).to.equal(startHash);
    expect(parameters[2]).to.equal(getRoleId(roleMap, getFactTypeId(factTypes, 'IntegrationTest.Successor'), 'predecessor'));
    expect(pathLength).to.equal(1);
  });

  it('should parse predecessor query with type', () => {
    const { sql, parameters, pathLength, factTypes, roleMap } = sqlFor('P.parent F.type="Parent"');
    expect(sql).to.equal(
      'SELECT f2.hash as hash2 ' +
      'FROM public.fact f1 ' +
      'JOIN public.edge e1 ON e1.successor_fact_id = f1.fact_id AND e1.role_id = $3 ' +
      'JOIN public.fact f2 ON f2.fact_id = e1.predecessor_fact_id ' +
      'WHERE f1.fact_type_id = $1 AND f1.hash = $2'
    );
    expect(parameters[0]).to.equal(getFactTypeId(factTypes, 'Root'));
    expect(parameters[1]).to.equal(startHash);
    expect(parameters[2]).to.equal(getRoleId(roleMap, getFactTypeId(factTypes, 'Root'), 'parent'));
    expect(pathLength).to.equal(1);
  });

  it('should parse successor query with existential', () => {
    const { sql, parameters, pathLength, factTypes, roleMap } = sqlFor('S.predecessor F.type="IntegrationTest.Successor" E(S.successor F.type="IntegrationTest.Grandchild")');
    expect(sql).to.equal(
      'SELECT f2.hash as hash2 ' +
      'FROM public.fact f1 ' +
      'JOIN public.edge e1 ON e1.predecessor_fact_id = f1.fact_id AND e1.role_id = $3 ' +
      'JOIN public.fact f2 ON f2.fact_id = e1.successor_fact_id ' +
      'WHERE f1.fact_type_id = $1 AND f1.hash = $2 ' +
      'AND EXISTS (SELECT 1 ' +
      'FROM public.edge e2 ' +
      'WHERE e2.predecessor_fact_id = e1.successor_fact_id AND e2.role_id = $4)'
    );
      expect(parameters[0]).to.equal(getFactTypeId(factTypes, 'Root'));
      expect(parameters[1]).to.equal(startHash);
      expect(parameters[2]).to.equal(getRoleId(roleMap, getFactTypeId(factTypes, 'IntegrationTest.Successor'), 'predecessor'));
      expect(parameters[3]).to.equal(getRoleId(roleMap, getFactTypeId(factTypes, 'IntegrationTest.Grandchild'), 'successor'));
      expect(pathLength).to.equal(1);
  });

  it('should parse successor query with negative existential', () => {
    const { sql, parameters, pathLength, factTypes, roleMap } = sqlFor('S.predecessor F.type="IntegrationTest.Successor" N(S.successor F.type="IntegrationTest.Grandchild")');
    expect(sql).to.equal(
      'SELECT f2.hash as hash2 ' +
      'FROM public.fact f1 ' +
      'JOIN public.edge e1 ON e1.predecessor_fact_id = f1.fact_id AND e1.role_id = $3 ' +
      'JOIN public.fact f2 ON f2.fact_id = e1.successor_fact_id ' +
      'WHERE f1.fact_type_id = $1 AND f1.hash = $2 ' +
      'AND NOT EXISTS (SELECT 1 ' +
      'FROM public.edge e2 ' +
      'WHERE e2.predecessor_fact_id = e1.successor_fact_id AND e2.role_id = $4)'
    );
    expect(parameters[0]).to.equal(getFactTypeId(factTypes, 'Root'));
    expect(parameters[1]).to.equal(startHash);
    expect(parameters[2]).to.equal(getRoleId(roleMap, getFactTypeId(factTypes, 'IntegrationTest.Successor'), 'predecessor'));
    expect(parameters[3]).to.equal(getRoleId(roleMap, getFactTypeId(factTypes, 'IntegrationTest.Grandchild'), 'successor'));
    expect(pathLength).to.equal(1);
  });

  it('should parse successor query with existential predecessor', () => {
    const { sql, parameters, pathLength, factTypes, roleMap } = sqlFor('S.parent F.type="Child" E(P.uncle F.type="Uncle")');
    expect(sql).to.equal(
      'SELECT f2.hash as hash2 ' +
      'FROM public.fact f1 ' +
      'JOIN public.edge e1 ON e1.predecessor_fact_id = f1.fact_id AND e1.role_id = $3 ' +
      'JOIN public.fact f2 ON f2.fact_id = e1.successor_fact_id ' +
      'WHERE f1.fact_type_id = $1 AND f1.hash = $2 ' +
      'AND EXISTS (SELECT 1 ' +
      'FROM public.edge e2 ' +
      'WHERE e2.successor_fact_id = e1.successor_fact_id AND e2.role_id = $4)'
    );
    expect(parameters[0]).to.equal(getFactTypeId(factTypes, 'Root'));
    expect(parameters[1]).to.equal(startHash);
    expect(parameters[2]).to.equal(getRoleId(roleMap, getFactTypeId(factTypes, 'Child'), 'parent'));
    expect(parameters[3]).to.equal(getRoleId(roleMap, getFactTypeId(factTypes, 'Child'), 'uncle'));
    expect(pathLength).to.equal(1);
  });

  it('should parse successor query with negative existential predecessor', () => {
    const { sql, parameters, pathLength, factTypes, roleMap } = sqlFor('S.parent F.type="Child" N(P.uncle F.type="Uncle")');
    expect(sql).to.equal(
      'SELECT f2.hash as hash2 ' +
      'FROM public.fact f1 ' +
      'JOIN public.edge e1 ON e1.predecessor_fact_id = f1.fact_id AND e1.role_id = $3 ' +
      'JOIN public.fact f2 ON f2.fact_id = e1.successor_fact_id ' +
      'WHERE f1.fact_type_id = $1 AND f1.hash = $2 ' +
      'AND NOT EXISTS (SELECT 1 ' +
      'FROM public.edge e2 ' +
      'WHERE e2.successor_fact_id = e1.successor_fact_id AND e2.role_id = $4)'
    );
    expect(parameters[0]).to.equal(getFactTypeId(factTypes, 'Root'));
    expect(parameters[1]).to.equal(startHash);
    expect(parameters[2]).to.equal(getRoleId(roleMap, getFactTypeId(factTypes, 'Child'), 'parent'));
    expect(parameters[3]).to.equal(getRoleId(roleMap, getFactTypeId(factTypes, 'Child'), 'uncle'));
    expect(pathLength).to.equal(1);
  });

  it('should parse consecutive existential queries', () => {
    const { sql, parameters, factTypes, roleMap } = sqlFor('S.parent F.type="Child" N(S.condition F.type="Condition") N(S.other F.type="Other")');
    expect(sql).to.equal(
      'SELECT f2.hash as hash2 ' +
      'FROM public.fact f1 ' +
      'JOIN public.edge e1 ON e1.predecessor_fact_id = f1.fact_id AND e1.role_id = $3 ' +
      'JOIN public.fact f2 ON f2.fact_id = e1.successor_fact_id ' +
      'WHERE f1.fact_type_id = $1 AND f1.hash = $2 ' +
      'AND NOT EXISTS (SELECT 1 ' +
      'FROM public.edge e2 ' +
      'WHERE e2.predecessor_fact_id = e1.successor_fact_id AND e2.role_id = $4) ' +
      'AND NOT EXISTS (SELECT 1 ' +
      'FROM public.edge e3 ' +
      'WHERE e3.predecessor_fact_id = e1.successor_fact_id AND e3.role_id = $5)'
    );
    expect(parameters).to.deep.equal([
      getFactTypeId(factTypes, 'Root'),
      startHash,
      getRoleId(roleMap, getFactTypeId(factTypes, 'Child'), 'parent'),
      getRoleId(roleMap, getFactTypeId(factTypes, 'Condition'), 'condition'),
      getRoleId(roleMap, getFactTypeId(factTypes, 'Other'), 'other')
    ]);
  });

  it('should parse zig-zag pipeline', () => {
    const { sql, parameters, pathLength, factTypes, roleMap } = sqlFor('S.user F.type="Assignment" P.project F.type="Project" S.project F.type="Task" S.task F.type="Task.Title"');
    expect(sql).to.equal(
      'SELECT f2.hash as hash2, f3.hash as hash3 ' +
      'FROM public.fact f1 ' +
      'JOIN public.edge e1 ON e1.predecessor_fact_id = f1.fact_id AND e1.role_id = $3 ' +
      'JOIN public.fact f2 ON f2.fact_id = e1.successor_fact_id ' +
      'JOIN public.edge e2 ON e2.successor_fact_id = e1.successor_fact_id AND e2.role_id = $4 ' +
      'JOIN public.edge e3 ON e3.predecessor_fact_id = e2.predecessor_fact_id AND e3.role_id = $5 ' +
      'JOIN public.edge e4 ON e4.predecessor_fact_id = e3.successor_fact_id AND e4.role_id = $6 ' +
      'JOIN public.fact f3 ON f3.fact_id = e4.successor_fact_id ' +
      'WHERE f1.fact_type_id = $1 AND f1.hash = $2'
    );
    expect(parameters).to.deep.equal([
      getFactTypeId(factTypes, 'Root'),
      startHash,
      getRoleId(roleMap, getFactTypeId(factTypes, 'Assignment'), 'user'),
      getRoleId(roleMap, getFactTypeId(factTypes, 'Assignment'), 'project'),
      getRoleId(roleMap, getFactTypeId(factTypes, 'Task'), 'project'),
      getRoleId(roleMap, getFactTypeId(factTypes, 'Task.Title'), 'task')
    ]);
    expect(pathLength).to.equal(2);
  });

  it('should parse query with unknown successor type', () => {
    const { empty } = sqlFor('S.root F.type="Unknown"');
    expect(empty).to.be.true;
  });

  it('should parse query with unknown predecessor type', () => {
    const { empty } = sqlFor('S.root F.type="Assignment" P.unknown F.type="Unknown" P.user F.type="Jinaga.User"');
    expect(empty).to.be.true;
  });

  it('should parse query with some unknown types', () => {
    const { empty } = sqlFor('S.root F.type="Unknown" P.user F.type="Jinaga.User"');
    expect(empty).to.be.true;
  });
});

function allFactTypes(steps: Step[]): string[] {
  const factTypes = steps
    .filter(step => step instanceof PropertyCondition && step.name === 'type')
    .map(step => (step as PropertyCondition).value);
  const childFactTypes = steps
    .filter(step => step instanceof ExistentialCondition)
    .flatMap(step => allFactTypes((step as ExistentialCondition).steps));
  return [...factTypes, ...childFactTypes].filter(distinct);
}

function allRoles(steps: Step[], initialType: string) {
  let roles: { type: string; role: string }[] = [];
  let type: string = initialType;
  let role: string = undefined;

  for (const step of steps) {
    if (step instanceof PropertyCondition) {
      if (step.name === 'type') {
        type = step.value;
        if (role) {
          roles.push({ type, role });
          role = undefined;
        }
      }
    }
    else if (step instanceof Join) {
      if (step.direction === Direction.Predecessor) {
        roles.push({ type, role: step.role });
        role = undefined;
      }
      else {
        role = step.role;
      }
      type = undefined;
    }
    else if (step instanceof ExistentialCondition) {
      roles = roles.concat(allRoles(step.steps, type));
    }
  }

  return roles;
}