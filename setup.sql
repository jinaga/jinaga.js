--
-- Create tables for a Jinaga database
--
-- Before executing, be sure you have created the database and the dev role.
--
-- CREATE DATABASE myapplication;
-- \connect myapplication
--
-- CREATE USER dev WITH
--   LOGIN
--   ENCRYPTED PASSWORD 'devpassword'
--   NOSUPERUSER
--   INHERIT
--   NOCREATEDB
--   NOCREATEROLE
--   NOREPLICATION
--   VALID UNTIL 'infinity';
--

-- \set appdatabase `echo "$APP_DATABASE"`

-- \connect :appdatabase

DO
$do$
BEGIN

CREATE EXTENSION IF NOT EXISTS intarray;

IF ((SELECT to_regclass('public.ancestor') IS NULL) AND
	(SELECT to_regclass('public.fact') IS NOT NULL)) THEN
	
	-- Move the legacy tables to the legacy schema

	CREATE SCHEMA legacy;

	ALTER TABLE public.edge
		SET SCHEMA legacy;

	ALTER TABLE public.fact
		SET SCHEMA legacy;

	ALTER TABLE public.signature
		SET SCHEMA legacy;

	ALTER TABLE public."user"
		SET SCHEMA legacy;

END IF;

--
-- Fact Type
--

IF (SELECT to_regclass('public.fact_type')) IS NULL THEN

    CREATE TABLE fact_type (
        fact_type_id serial PRIMARY KEY,
        name character varying(50) NOT NULL
    );


    ALTER TABLE public.fact_type OWNER TO postgres;

    CREATE UNIQUE INDEX ux_fact_type ON fact_type (name);

END IF;

--
-- Role
--

IF (SELECT to_regclass('public.role')) IS NULL THEN

    CREATE TABLE role (
        role_id serial PRIMARY KEY,
        defining_fact_type_id integer NOT NULL,
        CONSTRAINT fk_defining_fact_type_id
            FOREIGN KEY (defining_fact_type_id)
            REFERENCES fact_type (fact_type_id),
        name character varying(20) NOT NULL
    );


    ALTER TABLE public.role OWNER TO postgres;

    CREATE UNIQUE INDEX ux_role ON public.role USING btree (defining_fact_type_id, name);

END IF;

--
-- Fact
--

IF (SELECT to_regclass('public.fact') IS NULL) THEN

    CREATE TABLE public.fact (
        fact_id SERIAL PRIMARY KEY,
        fact_type_id integer NOT NULL,
        CONSTRAINT fk_fact_type_id
            FOREIGN KEY (fact_type_id)
            REFERENCES fact_type (fact_type_id),
        hash character varying(100),
        data jsonb,
        date_learned timestamp NOT NULL
            DEFAULT (now() at time zone 'utc')
    );


    ALTER TABLE public.fact OWNER TO postgres;

    CREATE UNIQUE INDEX ux_fact ON public.fact USING btree (hash, fact_type_id);

END IF;

--
-- Edge
--

IF (SELECT to_regclass('public.edge') IS NULL) THEN

    CREATE TABLE public.edge (
        role_id integer NOT NULL,
        CONSTRAINT fk_role_id
            FOREIGN KEY (role_id)
            REFERENCES role (role_id),
        successor_fact_id integer NOT NULL,
        CONSTRAINT fk_successor_fact_id
            FOREIGN KEY (successor_fact_id)
            REFERENCES fact (fact_id),
        predecessor_fact_id integer NOT NULL,
        CONSTRAINT fk_predecessor_fact_id
            FOREIGN KEY (predecessor_fact_id)
            REFERENCES fact (fact_id)
    );


    ALTER TABLE public.edge OWNER TO postgres;

    -- Most unique first, for fastest uniqueness check on insert.
    CREATE UNIQUE INDEX ux_edge ON public.edge USING btree (successor_fact_id, predecessor_fact_id, role_id);
    -- Covering index based on successor, favoring most likely members of WHERE clause.
    CREATE INDEX ix_successor ON public.edge USING btree (successor_fact_id, role_id, predecessor_fact_id);
    -- Covering index based on predecessor, favoring most likely members of WHERE clause.
    CREATE INDEX ix_predecessor ON public.edge USING btree (predecessor_fact_id, role_id, successor_fact_id);

END IF;

--
-- Ancestor
--

IF (SELECT to_regclass('public.ancestor') IS NULL) THEN

    CREATE TABLE public.ancestor (
        fact_id integer NOT NULL,
        CONSTRAINT fk_fact_id
            FOREIGN KEY (fact_id)
            REFERENCES fact (fact_id),
        ancestor_fact_id integer NOT NULL,
        CONSTRAINT fk_ancestor_fact_id
            FOREIGN KEY (ancestor_fact_id)
            REFERENCES fact (fact_id)
    );


    ALTER TABLE public.ancestor OWNER TO postgres;

    CREATE UNIQUE INDEX ux_ancestor ON public.ancestor USING btree (fact_id, ancestor_fact_id);

END IF;

--
-- Public Key
--

IF (SELECT to_regclass('public.public_key') IS NULL) THEN

    CREATE TABLE public.public_key (
        public_key_id serial PRIMARY KEY,
        public_key character varying(500) NOT NULL
    );


    ALTER TABLE public.public_key OWNER TO postgres;

    CREATE UNIQUE INDEX ux_public_key ON public.public_key (public_key);

END IF;

--
-- Signature
--

IF (SELECT to_regclass('public.signature') IS NULL) THEN

    CREATE TABLE public."signature" (
        fact_id integer NOT NULL,
        CONSTRAINT fk_fact_id
            FOREIGN KEY (fact_id)
            REFERENCES fact (fact_id),
        public_key_id integer NOT NULL,
        CONSTRAINT fk_public_key_id
            FOREIGN KEY (public_key_id)
            REFERENCES public_key (public_key_id),
        signature character varying(400),
        date_learned timestamp NOT NULL
            DEFAULT (now() at time zone 'utc')
    );


    ALTER TABLE public."signature" OWNER TO postgres;

    CREATE UNIQUE INDEX ux_signature ON public."signature" USING btree (fact_id, public_key_id);

END IF;

--
-- User
--

IF (SELECT to_regclass('public.user') IS NULL) THEN

    CREATE TABLE public."user" (
        provider character varying(100),
        user_identifier character varying(50),
        private_key character varying(1800),
        public_key character varying(500)
    );


    ALTER TABLE public."user" OWNER TO postgres;

    CREATE UNIQUE INDEX ux_user ON public."user" USING btree (user_identifier, provider);
    CREATE UNIQUE INDEX ux_user_public_key ON public."user" (public_key);

END IF;

IF (SELECT to_regclass('legacy.fact') IS NOT NULL) THEN

	INSERT INTO public."user"
		(provider, user_identifier, private_key, public_key)
	SELECT provider, user_id, private_key, public_key
	FROM legacy."user"
	ON CONFLICT DO NOTHING;

	INSERT INTO public.fact_type
		(name)
	SELECT DISTINCT type
	FROM legacy.fact
    WHERE type IS NOT NULL
	ON CONFLICT DO NOTHING;
	
	INSERT INTO public.role
		(defining_fact_type_id, name)
	SELECT DISTINCT f.fact_type_id, e.role
	FROM legacy.edge e
	JOIN public.fact_type f
	  ON f.name = e.successor_type
	ON CONFLICT DO NOTHING;
	
	INSERT INTO public.fact
		(fact_type_id, hash, data, date_learned)
	SELECT
		t.fact_type_id,
		f.hash,
		('{"fields":' || (('{"a":' || f.fields::text || '}')::json ->> 'a') ||
		 ',"predecessors":' || (('{"a":' || f.predecessors::text || '}')::json ->> 'a') || '}')::jsonb,
		f.date_learned
	FROM legacy.fact f
	JOIN public.fact_type t
	  ON t.name = f.type
	ON CONFLICT DO NOTHING;
	
	INSERT INTO public.edge
	  (role_id, successor_fact_id, predecessor_fact_id)
	SELECT r.role_id, s.fact_id, p.fact_id
	FROM legacy.edge e
	JOIN public.fact_type st
	  ON st.name = e.successor_type
	JOIN public.fact s
	  ON s.fact_type_id = st.fact_type_id
	  AND s.hash = e.successor_hash
	JOIN public.fact_type pt
	  ON pt.name = e.predecessor_type
	JOIN public.fact p
	  ON p.fact_type_id = pt.fact_type_id
	  AND p.hash = e.predecessor_hash
	JOIN public.role r
	  ON r.defining_fact_type_id = st.fact_type_id
	  AND r.name = e.role
	ON CONFLICT DO NOTHING;
	
	INSERT INTO public.ancestor
		(fact_id, ancestor_fact_id)
	WITH RECURSIVE a(fact_id, ancestor_fact_id) AS (
		SELECT e.successor_fact_id, e.predecessor_fact_id
		FROM public.edge e
		UNION ALL
		SELECT e.successor_fact_id, a.ancestor_fact_id
		FROM public.edge e
		JOIN a ON a.fact_id = e.predecessor_fact_id
	)
	SELECT DISTINCT a.fact_id, a.ancestor_fact_id
	FROM a
	ON CONFLICT DO NOTHING;
	
	INSERT INTO public.public_key
		(public_key)
	SELECT DISTINCT public_key
	FROM legacy.signature
	ON CONFLICT DO NOTHING;
	
	INSERT INTO public.signature
		(fact_id, public_key_id, signature, date_learned)
	SELECT f.fact_id, pk.public_key_id, s.signature, s.date_learned
	FROM legacy.signature s
	JOIN public.fact_type t
	  ON t.name = s.type
	JOIN public.fact f
	  ON f.fact_type_id = t.fact_type_id AND f.hash = s.hash
	JOIN public.public_key pk
	  ON pk.public_key = s.public_key
	ON CONFLICT DO NOTHING;

END IF;

END
$do$
