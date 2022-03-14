BEGIN TRANSACTION;


INSERT INTO public.fact (hash, fact_type_id, data)
	VALUES ('hash1', 1, '{ "data": 1 }'::jsonb), ('hash2', 2, '{ "data": 2 }'::jsonb)
ON CONFLICT DO NOTHING;


INSERT INTO public.edge
	(role_id, successor_fact_id, predecessor_fact_id)
SELECT v.role_id, successor.fact_id, predecessor.fact_id
FROM (VALUES ('hash2', 2, 'hash1', 1, 1)) AS v (successor_hash, successor_fact_type_id, predecessor_hash, predecessor_fact_type_id, role_id)
JOIN public.fact AS successor
	ON successor.hash = v.successor_hash AND successor.fact_type_id = v.successor_fact_type_id
JOIN public.fact AS predecessor
	ON predecessor.hash = v.predecessor_hash AND predecessor.fact_type_id = v.predecessor_fact_type_id
ON CONFLICT DO NOTHING;


WITH e AS (
	SELECT successor.fact_id AS successor_fact_id, predecessor.fact_id AS predecessor_fact_id
	FROM (VALUES ('hash2', 2, 'hash1', 1)) AS v (successor_hash, successor_fact_type_id, predecessor_hash, predecessor_fact_type_id)
	JOIN public.fact AS successor
		ON successor.hash = v.successor_hash AND successor.fact_type_id = v.successor_fact_type_id
	JOIN public.fact AS predecessor
		ON predecessor.hash = v.predecessor_hash AND predecessor.fact_type_id = v.predecessor_fact_type_id
)
INSERT INTO public.ancestor
	(fact_id, ancestor_fact_id)
	SELECT e.successor_fact_id, e.predecessor_fact_id
	FROM e
UNION ALL
	SELECT e.successor_fact_id, ancestor_fact_id
	FROM e
	JOIN public.ancestor
		ON ancestor.fact_id = e.predecessor_fact_id
ON CONFLICT DO NOTHING;


SELECT fact.fact_id, v.fact_type_id, v.hash
FROM public.fact
JOIN (VALUES ('hash1', 1), ('hash2', 2)) AS v (hash, fact_type_id)
	ON fact.hash = v.hash AND fact.fact_type_id = v.fact_type_id;


ROLLBACK TRANSACTION;
