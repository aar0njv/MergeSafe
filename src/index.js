
import * as core from '@actions/core';
import path from 'path';
import pg from 'pg';
const { Pool } = pg;

import { runMigrations } from './runner.js';
import { snapshotTables, detectRewrites } from './diagnostics.js';


try {
    const { default: dotenv } = await import('dotenv');
    dotenv.config();
} catch { }



async function main() {
    const dbConfig = {
        host: core.getInput('db-host') || process.env.DB_HOST || 'localhost',
        port: parseInt(core.getInput('db-port') || process.env.DB_PORT || '5432'),
        database: core.getInput('db-name') || process.env.POSTGRES_DB,
        user: core.getInput('db-username') || process.env.POSTGRES_USER,
        password: core.getInput('db-password') || process.env.POSTGRES_PASSWORD,
    };
    const rawMigrationDir = process.env.MIGRATIONS_DIR || './migrations';
    const migrationsDir = path.resolve(rawMigrationDir);

    const pool = new Pool(dbConfig);

    try {
        const testClient = await pool.connect();
        console.log('Connected to PostgreSQL successfully.\n');
        testClient.release();
    } catch (err) {
        console.error('Failed to connect to PostgreSQL.');
        console.error('Check your DB_HOST, POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB.');
        console.error('Error:', err.message);
        process.exit(1); // exit with failure code — stops the GitHub Actions job
    }


    try {

        console.log('pre-migration snapshot of all tables...');
        const beforeSnapshot = await snapshotTables(pool);
        console.log(`   Captured ${beforeSnapshot.length} table(s).\n`);

        console.log('Running migrations...\n');
        const migrationResults = await runMigrations(pool, migrationsDir);

        const afterSnapshot = await snapshotTables(pool);
        const rewrites = detectRewrites(beforeSnapshot, afterSnapshot);

        console.log('\n========================================');
        console.log('         MIGRATION RESULTS              ');
        console.log('========================================');

        for (const r of migrationResults) {
            console.log(`${r.filename}`);
            console.log(`     Status:   ${r.success ? 'SUCCESS' : 'FAILED'}`);
            console.log(`     Duration: ${r.durationMs}ms`);

            if (r.error) console.log(`     Error:    ${r.error}`);

            console.log('');
        }

        console.log('========================================');
        console.log('           LOCK ANALYSIS                ');
        console.log('========================================');

        let anyLocksFound = false;

        for (const r of migrationResults) {

            const reportedLocks = new Set();
            const peakDurations = {};

            for (const snapshot of r.diagnostics) {
                for (const lock of snapshot.locks) {
                    const key = `${lock.table_name}-${lock.mode}`;
                    if (!peakDurations[key] || lock.duration_ms > peakDurations[key].duration_ms) {
                        peakDurations[key] = { ...lock, capturedAt: snapshot.capturedAt };
                    }
                }
            }

            for (const [key, lock] of Object.entries(peakDurations)) {
                anyLocksFound = true;
                const isCritical = lock.mode === 'AccessExclusiveLock' || lock.mode === 'ShareLock';
                const danger = isCritical ? 'CRITICAL' : 'INFO';
                console.log(`${danger}`);
                console.log(`   Migration:    ${r.filename}`);
                console.log(`   Table:        ${lock.table_name}`);
                console.log(`   Mode:         ${lock.mode}`);
                console.log(`   Peak Duration: ${lock.duration_ms}ms`);
                console.log(`   Query:        ${lock.query}`);
                console.log('');
            }
        }

        if (!anyLocksFound) console.log('No significant locks detected.\n');

        console.log('========================================');
        console.log('          INDEX BUILD ANALYSIS          ');
        console.log('========================================');

        let anyIndexBuilds = false;
        for (const r of migrationResults) {
            for (const snapshot of r.diagnostics) {
                for (const idx of snapshot.indexBuilds) {
                    anyIndexBuilds = true;
                    const danger = idx.command === 'CREATE INDEX' ? 'BLOCKING' : 'CONCURRENT';
                    console.log(`${danger}  [captured at +${snapshot.capturedAt}ms]`);
                    console.log(`   Migration: ${r.filename}`);
                    console.log(`   Table:     ${idx.table_name}`);
                    console.log(`   Index:     ${idx.index_name}`);
                    console.log(`   Command:   ${idx.command}`);
                    console.log(`   Phase:     ${idx.phase}`);
                    console.log('');
                }
            }
        }

        if (!anyIndexBuilds) {
            console.log('No in-progress index builds captured.');
            console.log('Check LOCK ANALYSIS for AccessExclusiveLock entries.\n');
        }

        console.log('========================================');
        console.log('         TABLE REWRITE DETECTION        ');
        console.log('========================================');

        if (rewrites.length === 0) {
            console.log('No table rewrites detected.\n');
        } else {
            for (const rw of rewrites) {
                console.log(`REWRITE DETECTED`);
                console.log(`   Table:            ${rw.table_name}`);
                console.log(`   Live rows:        ${rw.live_rows}`);
                console.log(`   File node BEFORE: ${rw.before_file_node}`);
                console.log(`   File node AFTER:  ${rw.after_file_node}`);
                console.log('');
            }
        }

        const anyFailed = migrationResults.some(r => !r.success);
        if (anyFailed) {
            console.error('One or more migrations failed. Exiting with error.');
            process.exit(1);
        }

        console.log('========================================');
        console.log('   MergeSafe completed successfully');
        console.log('========================================');
    } finally {
        await pool.end();
    }
}


main();