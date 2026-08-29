-- Lo ejecuta el contenedor de Postgres en la primera inicialización.
--
-- btree_gist no es opcional: es lo que permite combinar `cisterna_id WITH =`
-- y `periodo WITH &&` en la misma restricción de exclusión (§5.1). Sin él,
-- las reglas 1 y 2 —una cisterna o un conductor no pueden estar en dos viajes
-- que se superpongan— vuelven a depender de que la aplicación no tenga bugs.
CREATE EXTENSION IF NOT EXISTS postgis;      -- georreferenciación (§5.2)
CREATE EXTENSION IF NOT EXISTS btree_gist;   -- restricciones de exclusión (§5.1)
CREATE EXTENSION IF NOT EXISTS pgcrypto;     -- cédula y datos bancarios (§7)
