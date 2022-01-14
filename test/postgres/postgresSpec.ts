import { expect } from 'chai';
import { describe, it } from 'mocha';
import 'source-map-support/register';
import { dehydrateReference } from '../../src/fact/hydrate';
import { addFactType, addRole, emptyFactTypeMap, emptyRoleMap, getFactId, getFactTypeId, getRoleId } from "../../src/postgres/maps";
import { sqlFromSteps } from '../../src/postgres/sql';
import { fromDescriptiveString } from '../../src/query/descriptive-string';
import { Query } from "../../src/query/query";
import { Direction, ExistentialCondition, Join, PropertyCondition, Step } from "../../src/query/steps";
import { distinct } from "../../src/util/fn";

describe('Postgres', () => {

  const start = dehydrateReference({ type: 'Root' });
  const startHash = 'fSS1hK7OGAeSX4ocN3acuFF87jvzCdPN3vLFUtcej0lOAsVV859UIYZLRcHUoMbyd/J31TdVn5QuE7094oqUPg==';

  function sqlFor(descriptiveString: string) {
    const query = fromDescriptiveString(descriptiveString);
    const factTypes = allFactTypes(query.steps).reduce(
      (f, factType, i) => addFactType(f, factType, i + 1),
      emptyFactTypeMap());
    let roleMap = allRoles(query.steps, 'Root').reduce(
      (r, role, i) => addRole(r, getFactTypeId(factTypes, role.type), role.role, i + 1),
      emptyRoleMap());
    const sqlQuery = sqlFromSteps(start, query.steps, factTypes, roleMap);
    return sqlQuery ? { sql: sqlQuery.sql, parameters: sqlQuery.parameters, pathLength: sqlQuery.pathLength, factTypes, roleMap } : null;
  }

  it('should parse empty query', () => {
    expect(sqlFor('')).to.equal(null);
  });

  it('should error on successor query', () => {
    const parse = () => sqlFor('S.predecessor');
    expect(parse).to.throw(Error, 'Missing type for role predecessor');
  });

  it('should parse predecessor query', () => {
    const { sql, parameters, pathLength, factTypes, roleMap } = sqlFor('P.parent');
    expect(sql).to.equal(
      'SELECT f2.hash ' +
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

  it('should parse successor query with type', () => {
    const { sql, parameters, pathLength, factTypes, roleMap } = sqlFor('S.predecessor F.type="IntegrationTest.Successor"');
    expect(sql).to.equal(
      'SELECT f2.hash ' +
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
      'SELECT f2.hash ' +
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
      'SELECT f2.hash ' +
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
      'SELECT f2.hash ' +
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
    const { sql, parameters, pathLength, factTypes, roleMap } = sqlFor('S.parent F.type="Child" E(P.uncle)');
    expect(sql).to.equal(
      'SELECT e1.successor_type AS type0, e1.successor_hash AS hash0 ' +
      'FROM public.edge e1  ' +
      'WHERE e1.predecessor_type = $1 AND e1.predecessor_hash = $2 AND e1.role = $3 ' +
        'AND EXISTS (SELECT 1 ' +
          'FROM public.edge e2  ' +
          'WHERE e2.successor_type = e1.successor_type AND e2.successor_hash = e1.successor_hash ' +
            'AND e2.role = $4)'
    );
    expect(parameters[0]).to.equal(getFactTypeId(factTypes, 'Root'));
    expect(parameters[1]).to.equal(startHash);
    expect(parameters[2]).to.equal(getRoleId(roleMap, getFactTypeId(factTypes, 'Child'), 'parent'));
    expect(parameters[3]).to.equal(getRoleId(roleMap, getFactTypeId(factTypes, 'Child'), 'uncle'));
    expect(pathLength).to.equal(1);
  });

  it('should parse successor query with negative existential predecessor', () => {
    const { sql, parameters, pathLength, factTypes, roleMap } = sqlFor('S.parent F.type="Child" N(P.uncle)');
    expect(sql).to.equal(
      'SELECT e1.successor_type AS type0, e1.successor_hash AS hash0 ' +
      'FROM public.edge e1  ' +
      'WHERE e1.predecessor_type = $1 AND e1.predecessor_hash = $2 AND e1.role = $3 ' +
        'AND NOT EXISTS (SELECT 1 ' +
          'FROM public.edge e2  ' +
          'WHERE e2.successor_type = e1.successor_type AND e2.successor_hash = e1.successor_hash ' +
            'AND e2.role = $4)'
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
      'SELECT e1.successor_type AS type0, e1.successor_hash AS hash0 ' +
        'FROM public.edge e1  ' +
        'WHERE e1.predecessor_type = $1 AND e1.predecessor_hash = $2 AND e1.role = $3 ' +
          'AND NOT EXISTS (SELECT 1 ' +
            'FROM public.edge e2  ' +
            'WHERE e2.predecessor_type = e1.successor_type AND e2.predecessor_hash = e1.successor_hash ' +
              'AND e2.role = $4) ' +
          'AND NOT EXISTS (SELECT 1 ' +
            'FROM public.edge e3  ' +
            'WHERE e3.predecessor_type = e1.successor_type AND e3.predecessor_hash = e1.successor_hash ' +
              'AND e3.role = $5)'
    );
    expect(parameters).to.deep.equal([
      getFactTypeId(factTypes, 'Root'),
      startHash,
      getRoleId(roleMap, getFactTypeId(factTypes, 'Child'), 'parent'),
      getRoleId(roleMap, getFactTypeId(factTypes, 'Condition'), 'condition'),
      getRoleId(roleMap, getFactTypeId(factTypes, 'Other'), 'other')
    ]);
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