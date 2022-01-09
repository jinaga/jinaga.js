import { expect } from 'chai';
import { describe, it } from 'mocha';
import 'source-map-support/register';
import { dehydrateReference } from '../../src/fact/hydrate';
import { addFactType, addRole, emptyFactTypeMap, emptyRoleMap } from "../../src/postgres/maps";
import { sqlFromSteps } from '../../src/postgres/sql';
import { fromDescriptiveString } from '../../src/query/descriptive-string';

describe.only('Postgres', () => {

  const start = dehydrateReference({ type: 'Root' });
  const startHash = 'fSS1hK7OGAeSX4ocN3acuFF87jvzCdPN3vLFUtcej0lOAsVV859UIYZLRcHUoMbyd/J31TdVn5QuE7094oqUPg==';

  function sqlFor(descriptiveString: string) {
    const query = fromDescriptiveString(descriptiveString);
    let factTypes = emptyFactTypeMap();
    factTypes = addFactType(factTypes, 'Root', 1);
    factTypes = addFactType(factTypes, 'IntegrationTest.Successor', 2);
    let roleMap = emptyRoleMap();
    roleMap = addRole(roleMap, 2, 'predecessor', 1);
    const sqlQuery = sqlFromSteps(start, query.steps, factTypes, roleMap);
    return sqlQuery;
  }

  it('should parse empty query', () => {
    expect(sqlFor('')).to.equal(null);
  });

  it('should error on successor query', () => {
    const parse = () => sqlFor('S.predecessor');
    expect(parse).to.throw(Error, 'Missing type for role predecessor');
  });

  it('should parse predecessor query', () => {
    const { sql, parameters, pathLength } = sqlFor('P.parent');
    expect(sql).to.equal(
      'SELECT e1.predecessor_type AS type0, e1.predecessor_hash AS hash0 ' +
      'FROM public.edge e1  ' +
      'WHERE e1.successor_type = $1 AND e1.successor_hash = $2 AND e1.role = $3'
    );
    expect(parameters[0]).to.equal('Root');
    expect(parameters[1]).to.equal(startHash);
    expect(parameters[2]).to.equal('parent');
    expect(pathLength).to.equal(1);
  });

  it('should parse successor query with type', () => {
    const { sql, parameters, pathLength } = sqlFor('S.predecessor F.type="IntegrationTest.Successor"');
    expect(sql).to.equal(
      'SELECT f2.hash ' +
      'FROM public.fact f1 ' +
      'JOIN public.edge e1 ON e1.predecessor_fact_id = f1.fact_id AND e1.role_id = %3 ' +
      'JOIN public.fact f2 ON f2.fact_id = e1.successor_fact_id ' +
      'WHERE f1.fact_type_id = $1 AND f1.hash = $2'
    );
      expect(parameters[0]).to.equal(1);
      expect(parameters[1]).to.equal(startHash);
      expect(parameters[2]).to.equal(1);
      expect(pathLength).to.equal(1);
  });

  it('should parse predecessor query with type', () => {
    const { sql, parameters, pathLength } = sqlFor('P.parent F.type="Parent"');
    expect(sql).to.equal(
      'SELECT e1.predecessor_type AS type0, e1.predecessor_hash AS hash0 ' +
      'FROM public.edge e1  ' +
      'WHERE e1.successor_type = $1 AND e1.successor_hash = $2 AND e1.role = $3 ' +
        'AND e1.predecessor_type = $4'
    );
    expect(parameters[0]).to.equal('Root');
    expect(parameters[1]).to.equal(startHash);
    expect(parameters[2]).to.equal('parent');
    expect(parameters[3]).to.equal('Parent');
    expect(pathLength).to.equal(1);
  });

  it('should parse successor query with existential', () => {
    const { sql, parameters, pathLength } = sqlFor('S.child E(S.grandchild)');
    expect(sql).to.equal(
      'SELECT e1.successor_type AS type0, e1.successor_hash AS hash0 ' +
      'FROM public.edge e1  ' +
      'WHERE e1.predecessor_type = $1 AND e1.predecessor_hash = $2 AND e1.role = $3 ' +
        'AND EXISTS (SELECT 1 ' +
          'FROM public.edge e2  ' +
          'WHERE e2.predecessor_type = e1.successor_type AND e2.predecessor_hash = e1.successor_hash ' +
            'AND e2.role = $4)'
    );
      expect(parameters[0]).to.equal('Root');
      expect(parameters[1]).to.equal(startHash);
      expect(parameters[2]).to.equal('child');
      expect(parameters[3]).to.equal('grandchild');
      expect(pathLength).to.equal(1);
  });

  it('should parse successor query with negative existential', () => {
    const { sql, parameters, pathLength } = sqlFor('S.child N(S.grandchild)');
    expect(sql).to.equal(
      'SELECT e1.successor_type AS type0, e1.successor_hash AS hash0 ' +
      'FROM public.edge e1  ' +
      'WHERE e1.predecessor_type = $1 AND e1.predecessor_hash = $2 AND e1.role = $3 ' +
        'AND NOT EXISTS (SELECT 1 ' +
          'FROM public.edge e2  ' +
          'WHERE e2.predecessor_type = e1.successor_type AND e2.predecessor_hash = e1.successor_hash ' +
            'AND e2.role = $4)'
    );
      expect(parameters[0]).to.equal('Root');
      expect(parameters[1]).to.equal(startHash);
      expect(parameters[2]).to.equal('child');
      expect(parameters[3]).to.equal('grandchild');
      expect(pathLength).to.equal(1);
  });

  it('should parse successor query with existential predecessor', () => {
    const { sql, parameters, pathLength } = sqlFor('S.child E(P.uncle)');
    expect(sql).to.equal(
      'SELECT e1.successor_type AS type0, e1.successor_hash AS hash0 ' +
      'FROM public.edge e1  ' +
      'WHERE e1.predecessor_type = $1 AND e1.predecessor_hash = $2 AND e1.role = $3 ' +
        'AND EXISTS (SELECT 1 ' +
          'FROM public.edge e2  ' +
          'WHERE e2.successor_type = e1.successor_type AND e2.successor_hash = e1.successor_hash ' +
            'AND e2.role = $4)'
    );
      expect(parameters[0]).to.equal('Root');
      expect(parameters[1]).to.equal(startHash);
      expect(parameters[2]).to.equal('child');
      expect(parameters[3]).to.equal('uncle');
      expect(pathLength).to.equal(1);
  });

  it('should parse successor query with negative existential predecessor', () => {
    const { sql, parameters, pathLength } = sqlFor('S.child N(P.uncle)');
    expect(sql).to.equal(
      'SELECT e1.successor_type AS type0, e1.successor_hash AS hash0 ' +
      'FROM public.edge e1  ' +
      'WHERE e1.predecessor_type = $1 AND e1.predecessor_hash = $2 AND e1.role = $3 ' +
        'AND NOT EXISTS (SELECT 1 ' +
          'FROM public.edge e2  ' +
          'WHERE e2.successor_type = e1.successor_type AND e2.successor_hash = e1.successor_hash ' +
            'AND e2.role = $4)'
    );
      expect(parameters[0]).to.equal('Root');
      expect(parameters[1]).to.equal(startHash);
      expect(parameters[2]).to.equal('child');
      expect(parameters[3]).to.equal('uncle');
      expect(pathLength).to.equal(1);
  });

  it('should parse consecutive existential queries', () => {
    const { sql, parameters } = sqlFor('S.child N(S.condition) N(S.other)');
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
      'Root',
      startHash,
      'child',
      'condition',
      'other'
    ]);
  });

  it('should parse migration query', () => {
    const query =
      'S.company F.type="ImprovingU.Office" ' +
      'S.office F.type="ImprovingU.Semester" ' +
      'S.semester F.type="ImprovingU.Idea" ' +
      'S.idea F.type="ImprovingU.Abstract" ' +
      'N(S.prior F.type="ImprovingU.Abstract") ' +
      'N(S.oldAbstract F.type="ImprovingU.Abstract.Migration")'

    const { sql, parameters } = sqlFor(query);
    expect(sql).to.equal(
      'SELECT ' +
        'e1.successor_type AS type0, e1.successor_hash AS hash0, ' +
        'e2.successor_type AS type1, e2.successor_hash AS hash1, ' +
        'e3.successor_type AS type2, e3.successor_hash AS hash2, ' +
        'e4.successor_type AS type3, e4.successor_hash AS hash3 ' +
      'FROM public.edge e1  ' +
      'JOIN public.edge e2 ' +
        'ON e2.predecessor_hash = e1.successor_hash ' +
          'AND e2.predecessor_type = e1.successor_type ' +
      'JOIN public.edge e3 ' +
        'ON e3.predecessor_hash = e2.successor_hash ' +
          'AND e3.predecessor_type = e2.successor_type ' +
      'JOIN public.edge e4 ' +
        'ON e4.predecessor_hash = e3.successor_hash ' +
          'AND e4.predecessor_type = e3.successor_type ' +
      'WHERE e1.predecessor_type = $1 AND e1.predecessor_hash = $2 ' +
        'AND e1.role = $3 AND e1.successor_type = $4 ' +
        'AND e2.role = $5 AND e2.successor_type = $6 ' +
        'AND e3.role = $7 AND e3.successor_type = $8 ' +
        'AND e4.role = $9 AND e4.successor_type = $10 ' +
        'AND NOT EXISTS (SELECT 1 ' +
          'FROM public.edge e5  ' +
          'WHERE e5.predecessor_type = e4.successor_type ' +
            'AND e5.predecessor_hash = e4.successor_hash ' +
            'AND e5.role = $11 AND e5.successor_type = $12) ' +
        'AND NOT EXISTS (SELECT 1 ' +
          'FROM public.edge e6  ' +
            'WHERE e6.predecessor_type = e4.successor_type AND e6.predecessor_hash = e4.successor_hash ' +
            'AND e6.role = $13 AND e6.successor_type = $14)'
    );
    expect(parameters).to.deep.equal([
      'Root',
      startHash,
      'company',
      'ImprovingU.Office',
      'office',
      'ImprovingU.Semester',
      'semester',
      'ImprovingU.Idea',
      'idea',
      'ImprovingU.Abstract',
      'prior',
      'ImprovingU.Abstract',
      'oldAbstract',
      'ImprovingU.Abstract.Migration'
    ]);
  });
});