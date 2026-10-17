// Reads .sql migration files from a directory and runs them
// sequentially. Returns an array of results for each file.

import { readdir, readFile } from 'fs/promises';
import path from 'path';

export async function runMigrations(pool, migrationsDir) {
    const results = [];

    const allFiles = await readdir(migrationsDir);
    const sqlFiles = allFiles
        .filter(f => f.endsWith('.sql'))
        .sort();

    if (sqlFiles.length === 0) {
        console.log('No .sql migration files found in directory:', migrationsDir);
        return results;
    }

    console.log(`Found ${sqlFiles.length} migration(s) to run.`);

    for (const filename of sqlFiles) {

        const filePath = path.join(migrationsDir, filename);
        const sql = await readFile(filePath, 'utf8');

        console.log(`\nRunning migration: ${filename}`);

        const startTime = Date.now();
        const client = await pool.connect();

        try {
            await client.query('BEGIN');
            await client.query(sql);
            await client.query('COMMIT');

            const durationMs = Date.now() - startTime;
            console.log(`✅ ${filename} completed in ${durationMs}ms`);
            results.push({ filename, success: true, durationMs });

        } catch (err) {
            await client.query('ROLLBACK');
            const durationMs = Date.now() - startTime;
            console.error(`${filename} failed: ${err.message}`);
            results.push({ filename, success: false, durationMs, error: err.message });
        } finally {
            client.release();
        }
    }
    return results;
}
