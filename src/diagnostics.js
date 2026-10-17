// Queries PostgreSQL system catalogs to capture runtime metrics
// during and after migration execution.

// --- QUERY 1: Lock Analysis ---

const LOCK_QUERY = `
  SELECT
    pl.pid,
    pl.mode,
    pl.granted,
    pc.relname AS table_name,
    psa.query,
    psa.state,
    ROUND(
      EXTRACT(EPOCH FROM (NOW() - psa.query_start)) * 1000
    )::BIGINT AS duration_ms,
    psa.wait_event_type,
    psa.wait_event
  FROM      pg_locks          pl
  JOIN      pg_class          pc  ON pc.oid  = pl.relation
  JOIN      pg_stat_activity  psa ON psa.pid = pl.pid
  WHERE     pl.locktype  = 'relation'
    AND     pc.relkind   = 'r'
    AND     psa.pid     <> pg_backend_pid()
  ORDER BY  duration_ms DESC NULLS LAST;
`;

// --- QUERY 2: Table Snapshot ---
const SNAPSHOT_QUERY = `
  SELECT
    psu.relname       AS table_name,
    pc.relfilenode    AS file_node,
    psu.n_live_tup    AS live_rows,
    psu.n_dead_tup    AS dead_rows
  FROM  pg_stat_user_tables psu
  JOIN  pg_class pc ON pc.relname = psu.relname
  ORDER BY psu.relname;
`;

// --- QUERY 3: Index Build Progress ---
const INDEX_BUILD_QUERY = `
  SELECT
    pc.relname          AS table_name,
    pi.relname          AS index_name,
    pci.command,
    pci.phase,
    pci.blocks_done,
    pci.blocks_total,
    pci.tuples_done,
    pci.tuples_total
  FROM  pg_stat_progress_create_index pci
  JOIN  pg_class pc  ON pc.oid = pci.relid
  JOIN  pg_class pi  ON pi.oid = pci.index_relid;
`;

// Takes a snapshot of all user tables before a migration runs
export async function snapshotTables(pool) {
    const result = await pool.query(SNAPSHOT_QUERY);
    return result.rows;
}

// Collects all live diagnostic data: locks + index builds
export async function collectDiagnostics(pool) {
    const [lockResult, indexResult] = await Promise.all([
        pool.query(LOCK_QUERY),
        pool.query(INDEX_BUILD_QUERY),
    ]);

    const seen = new Set();
    const uniqueLocks = lockResult.rows.filter(lock => {
        const key = `${lock.pid}-${lock.table_name}-${lock.mode}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
    return {
        locks: uniqueLocks,
        indexBuilds: indexResult.rows,
    };
}

// Compares before/after table snapshots to detect rewrites
// A changed relfilenode means PostgreSQL physically rewrote the table
export function detectRewrites(beforeSnapshot, afterSnapshot) {
    const rewrites = [];

    for (const after of afterSnapshot) {
        const before = beforeSnapshot.find(b => b.table_name === after.table_name);
        if (before && before.file_node !== after.file_node) {
            rewrites.push({
                table_name: after.table_name,
                before_file_node: before.file_node,
                after_file_node: after.file_node,
                live_rows: after.live_rows,
            });
        }
    }

    return rewrites;
}