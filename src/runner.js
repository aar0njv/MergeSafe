// Reads .sql migration files from a directory and runs them
// sequentially. Polls diagnostics DURING each migration so
// fast-completing locks are captured before they are released.

import { readdir, readFile } from 'fs/promises';
import path from 'path';
import { collectDiagnostics } from './diagnostics.js';

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

        // Stores all diagnostic snapshots captured while this migration ran
        const diagnosticSnapshots = [];
        let polling = true;

        const pollDiagnostics = async () => {
            while (polling) {
                try {
                    const snapshot = await collectDiagnostics(pool);

                    if (snapshot.locks.length > 0 || snapshot.indexBuilds.length > 0) {
                        diagnosticSnapshots.push({
                            capturedAt: Date.now() - startTime,
                            ...snapshot,
                        });
                    }
                } catch { }

                await new Promise(resolve => setTimeout(resolve, 100));
            }
        };

        try {
            await client.query('BEGIN');
            const pollPromise = pollDiagnostics();
            await client.query(sql);

            polling = false;
            await pollPromise;

            await client.query('COMMIT');

            const durationMs = Date.now() - startTime;
            console.log(`${filename} completed in ${durationMs}ms`);
            console.log(`   Diagnostic snapshots captured: ${diagnosticSnapshots.length}`);

            results.push({
                filename,
                success: true,
                durationMs,
                diagnostics: diagnosticSnapshots,
            });

        } catch (err) {
            polling = false;

            await client.query('ROLLBACK');
            const durationMs = Date.now() - startTime;
            console.error(`${filename} failed: ${err.message}`);

            results.push({
                filename,
                success: false,
                durationMs,
                error: err.message,
                diagnostics: diagnosticSnapshots,
            });

        } finally {
            client.release();
        }
    }

    return results;
}