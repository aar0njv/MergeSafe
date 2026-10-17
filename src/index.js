
import path from 'path';
import pg from 'pg';
const { Pool } = pg;

import { runMigrations } from './runner.js';
import { snapshotTables, collectDiagnostics, detectRewrites } from './diagnostics.js';


try {
    const { default: dotenv } = await import('dotenv');
    dotenv.config();
} catch { }



async function main() {

    const dbConfig = {
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '5432'),
        database: process.env.POSTGRES_DB,
        user: process.env.POSTGRES_USER,
        password: process.env.POSTGRES_PASSWORD,
    };

    const migrationsDir = process.env.MIGRATIONS_DIR
        ? path.resolve(process.env.MIGRATIONS_DIR)
        : path.resolve('./migrations');

    console.log('========================================');
    console.log('        MigrateCheck Starting           ');
    console.log('========================================');
    console.log(`Host:              ${dbConfig.host}:${dbConfig.port}`);
    console.log(`Database:          ${dbConfig.database}`);
    console.log(`Migrations folder: ${migrationsDir}`);
    console.log('========================================\n');


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

        console.log('Collecting diagnostics from system catalogs...');
        const diagnostics = await collectDiagnostics(pool);
        const afterSnapshot = await snapshotTables(pool);
        const rewrites = detectRewrites(beforeSnapshot, afterSnapshot);

        console.log('\n========================================');
        console.log('         MIGRATION RESULTS              ');
        console.log('========================================');
        for (const r of migrationResults) {
            const status = r.success ? 'SUCCESS' : 'FAILED';
            console.log(`${r.filename}`);
            console.log(`     Status:   ${status}`);
            console.log(`     Duration: ${r.durationMs}ms`);
            if (r.error) {
                console.log(`     Error:    ${r.error}`);
            }
            console.log('');
        }


        console.log('========================================');
        console.log('           LOCK ANALYSIS                ');
        console.log('========================================');
        if (diagnostics.locks.length === 0) {
            console.log('No significant locks detected.\n');
        } else {
            for (const lock of diagnostics.locks) {
                const danger = lock.mode === 'AccessExclusiveLock' ? 'CRITICAL' : 'INFO';
                console.log(`${danger}`);
                console.log(`   Table:    ${lock.table_name}`);
                console.log(`   Mode:     ${lock.mode}`);
                console.log(`   Granted:  ${lock.granted}`);
                console.log(`   Duration: ${lock.duration_ms}ms`);
                console.log(`   Query:    ${lock.query}`);
                console.log('');
            }
        }


        console.log('========================================');
        console.log('          INDEX BUILD ANALYSIS          ');
        console.log('========================================');
        if (diagnostics.indexBuilds.length === 0) {
            console.log('No in-progress index builds captured.');
            console.log('   (Fast builds may have completed before snapshot.)');
            console.log('   Check LOCK ANALYSIS above for AccessExclusiveLock entries.\n');
        } else {
            for (const idx of diagnostics.indexBuilds) {
                const danger = idx.command === 'CREATE INDEX' ? 'BLOCKING' : 'CONCURRENT';
                console.log(`${danger}`);
                console.log(`   Table:   ${idx.table_name}`);
                console.log(`   Index:   ${idx.index_name}`);
                console.log(`   Command: ${idx.command}`);
                console.log(`   Phase:   ${idx.phase}`);
                console.log(`   Progress: ${idx.blocks_done}/${idx.blocks_total} blocks`);
                console.log('');
            }
        }


        console.log('========================================');
        console.log('         TABLE REWRITE DETECTION        ');
        console.log('========================================');
        if (rewrites.length === 0) {
            console.log('No table rewrites detected.\n');
        } else {
            for (const rw of rewrites) {
                console.log(`REWRITE DETECTED`);
                console.log(`   Table:           ${rw.table_name}`);
                console.log(`   Live rows:       ${rw.live_rows}`);
                console.log(`   File node BEFORE: ${rw.before_file_node}`);
                console.log(`   File node AFTER:  ${rw.after_file_node}`);
                console.log('');
            }
        }


        // Exit with code 1 if any migration failed
        const anyFailed = migrationResults.some(r => !r.success);
        if (anyFailed) {
            console.error('One or more migrations failed. Exiting with error.');
            process.exit(1);
        }

        console.log('========================================');
        console.log('   MigrateCheck completed successfully');
        console.log('========================================');

    } finally {
        // Always close the pool — whether we succeeded or failed
        await pool.end();
    }
}


main();