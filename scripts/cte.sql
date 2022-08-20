WITH new_fact AS (
    SELECT hash, fact_type_id, data
    FROM (VALUES ($1, $2::integer, $3::jsonb))
        AS fv (hash, fact_type_id, data)
),
new_edge AS (
    SELECT successor_hash, successor_fact_type_id, predecessor_hash, predecessor_fact_type_id, role_id
    FROM (VALUES ($4, $5::integer, $6, $7::integer, $8::integer))
        AS ev (successor_hash, successor_fact_type_id, predecessor_hash, predecessor_fact_type_id, role_id)
),
inserted_fact AS (
    INSERT INTO public.fact (hash, fact_type_id, data)
    SELECT hash, fact_type_id, data
    FROM new_fact
    RETURNING fact_id, fact_type_id, hash
),
edge_id AS (
    SELECT
        new_edge.role_id,
        successor.fact_id AS successor_fact_id,
        predecessor.fact_id AS predecessor_fact_id
    FROM new_edge
    JOIN inserted_fact AS successor
        ON successor.hash = new_edge.successor_hash
        AND successor.fact_type_id = new_edge.successor_fact_type_id
    JOIN (
        SELECT fact_id, fact_type_id, hash
        FROM inserted_fact
        UNION ALL
        SELECT fact_id, fact_type_id, hash
        FROM public.fact
    ) AS predecessor
        ON predecessor.hash = new_edge.predecessor_hash
        AND predecessor.fact_type_id = new_edge.predecessor_fact_type_id
),
inserted_edge AS (
    INSERT INTO public.edge
        (role_id, successor_fact_id, predecessor_fact_id)
    SELECT role_id, successor_fact_id, predecessor_fact_id
    FROM edge_id ON CONFLICT DO NOTHING
),
inserted_ancestor AS (
    INSERT INTO public.ancestor
        (fact_id, ancestor_fact_id)
        SELECT edge_id.successor_fact_id, edge_id.predecessor_fact_id
        FROM edge_id
    UNION ALL
        SELECT edge_id.successor_fact_id, ancestor_fact_id
        FROM edge_id
        JOIN public.ancestor
            ON ancestor.fact_id = edge_id.predecessor_fact_id
    ON CONFLICT DO NOTHING
)
SELECT fact_id, fact_type_id, hash
FROM inserted_fact;