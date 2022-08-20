BEGIN TRANSACTION;

INSERT INTO public.fact (hash, fact_type_id, data)
	(SELECT hash, fact_type_id, data
	 FROM (VALUES ('hash1', 1, '{ "data": 1 }'::jsonb), ('hash2', 2, '{ "data": 2 }'::jsonb)) AS v (hash, fact_type_id, data))
RETURNING fact_id, fact_type_id, hash;


INSERT INTO public.edge
	(role_id, successor_fact_id, predecessor_fact_id)
	(VALUES (1, 2, 3), (4, 5, 6))
ON CONFLICT DO NOTHING;


INSERT INTO public.ancestor
	(fact_id, ancestor_fact_id)
	SELECT 3, predecessor_fact_id
	FROM (VALUES (1), (2)) AS v (predecessor_fact_id)
UNION ALL
	SELECT 1, ancestor_fact_id
	FROM (VALUES (1), (2)) AS v (predecessor_fact_id)
	JOIN public.ancestor
		ON ancestor.fact_id = predecessor_fact_id
ON CONFLICT DO NOTHING;


ROLLBACK TRANSACTION;
