import { MongoClient, BSON } from 'mongodb';
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Command Line Flags
const args = process.argv.slice(2);
const isFullDrop = args.includes('--full') || args.includes('--drop') || args.includes('--force');
const colFilterIdx = args.indexOf('--collections');
const filterCols = colFilterIdx !== -1 && args[colFilterIdx + 1] ? args[colFilterIdx + 1].split(',').map(s => s.trim()) : null;

const LOCAL_MONGO_URI = process.env.LOCAL_MONGO_URI || 'mongodb://127.0.0.1:27017';
const BACKUP_DIR = path.join(__dirname, '..', 'database', 'atlas_backup', 'latest');

// Ensure indexes on local collection if missing
async function ensureIndexes(col, metaPath) {
  if (!fs.existsSync(metaPath)) return;
  try {
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    if (!meta.indexes || !Array.isArray(meta.indexes)) return;

    const existing = await col.indexes().catch(() => []);
    const existingNames = new Set(existing.map(i => i.name));

    for (const idx of meta.indexes) {
      if (idx.name === '_id_' || existingNames.has(idx.name)) continue;
      const keys = idx.key;
      const options = { name: idx.name };
      if (idx.unique) options.unique = true;
      if (idx.sparse) options.sparse = true;
      if (idx.expireAfterSeconds !== undefined) options.expireAfterSeconds = idx.expireAfterSeconds;

      await col.createIndex(keys, options).catch(() => {});
    }
  } catch (err) {
    console.warn(`    Warning checking indexes for ${col.collectionName}:`, err.message);
  }
}

// Full import of collection from jsonl
async function fullImportCollection(col, jsonlPath, metaPath) {
  await col.drop().catch(() => {});

  if (!fs.existsSync(jsonlPath)) {
    console.log(`  [!] Skipping ${col.collectionName} (no data file found)`);
    return 0;
  }

  const fileStream = fs.createReadStream(jsonlPath, { encoding: 'utf-8' });
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  let batch = [];
  const BATCH_SIZE = 5000;
  let totalInserted = 0;

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const doc = BSON.EJSON.parse(trimmed);
      batch.push(doc);

      if (batch.length >= BATCH_SIZE) {
        await col.insertMany(batch, { ordered: false });
        totalInserted += batch.length;
        batch = [];
        process.stdout.write(`    Restoring [${col.collectionName}]: ${totalInserted.toLocaleString()} docs...\r`);
      }
    } catch (err) {
      console.warn(`    Warning: Failed to parse line in ${col.collectionName}:`, err.message);
    }
  }

  if (batch.length > 0) {
    await col.insertMany(batch, { ordered: false });
    totalInserted += batch.length;
    batch = [];
  }

  await ensureIndexes(col, metaPath);
  console.log(`  -> Restored [${col.collectionName}]: ${totalInserted.toLocaleString()} documents & indexes`);
  return totalInserted;
}

// Upsert deltas into local collection
async function applyDeltasToCollection(col, deltasPath, metaPath) {
  if (!fs.existsSync(deltasPath)) return 0;

  const fileStream = fs.createReadStream(deltasPath, { encoding: 'utf-8' });
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  let batch = [];
  const BATCH_SIZE = 1000;
  let totalUpserted = 0;

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const doc = BSON.EJSON.parse(trimmed);
      if (doc._id) {
        batch.push({
          replaceOne: {
            filter: { _id: doc._id },
            replacement: doc,
            upsert: true
          }
        });
      }

      if (batch.length >= BATCH_SIZE) {
        await col.bulkWrite(batch, { ordered: false });
        totalUpserted += batch.length;
        batch = [];
      }
    } catch (err) {
      console.warn(`    Warning: Failed to parse delta line:`, err.message);
    }
  }

  if (batch.length > 0) {
    await col.bulkWrite(batch, { ordered: false });
    totalUpserted += batch.length;
    batch = [];
  }

  await ensureIndexes(col, metaPath);
  console.log(`  ✓ Applied deltas to [${col.collectionName}]: ${totalUpserted.toLocaleString()} docs upserted`);
  return totalUpserted;
}

async function restoreCollection(db, collectionName, dbPath, manifestInfo) {
  const col = db.collection(collectionName);
  const jsonlPath = path.join(dbPath, `${collectionName}.jsonl`);
  const deltasPath = path.join(dbPath, `${collectionName}.deltas.jsonl`);
  const metaPath = path.join(dbPath, `${collectionName}.metadata.json`);

  if (!fs.existsSync(jsonlPath) && !fs.existsSync(deltasPath)) {
    return { name: collectionName, count: 0, status: 'SKIPPED' };
  }

  // Force / full drop mode
  if (isFullDrop) {
    const count = await fullImportCollection(col, jsonlPath, metaPath);
    return { name: collectionName, count, status: 'FULL_RESTORE' };
  }

  // Check if collection already exists in local DB
  const localCount = await col.countDocuments();

  // If collection does not exist or is empty, check if backup file is also empty
  if (localCount === 0) {
    if (fs.existsSync(jsonlPath) && fs.statSync(jsonlPath).size > 0) {
      const count = await fullImportCollection(col, jsonlPath, metaPath);
      return { name: collectionName, count, status: 'INITIAL_IMPORT' };
    } else {
      await ensureIndexes(col, metaPath);
      return { name: collectionName, count: 0, status: 'SKIPPED_EMPTY' };
    }
  }

  // If a delta file exists with recent changes, apply deltas
  if (fs.existsSync(deltasPath) && fs.statSync(deltasPath).size > 0) {
    const count = await applyDeltasToCollection(col, deltasPath, metaPath);
    return { name: collectionName, count, status: 'DELTAS_APPLIED' };
  }

  // Check manifest if available
  if (manifestInfo) {
    const colManifest = manifestInfo.collections?.find(c => c.name === collectionName);
    if (colManifest) {
      if (colManifest.status === 'UP_TO_DATE' || colManifest.deltaCount === 0) {
        console.log(`  ✓ [${collectionName}]: Up to date (${localCount.toLocaleString()} docs, skipped)`);
        await ensureIndexes(col, metaPath);
        return { name: collectionName, count: 0, status: 'SKIPPED_UP_TO_DATE' };
      }
    }
  }

  // Untouched collection that already exists locally with matching or existing data
  console.log(`  ✓ [${collectionName}]: Intact in local MongoDB (${localCount.toLocaleString()} docs, skipped)`);
  await ensureIndexes(col, metaPath);
  return { name: collectionName, count: 0, status: 'SKIPPED_INTACT' };
}

async function restore() {
  const startTime = Date.now();
  console.log('====================================================');
  console.log('       FAST RESTORE ATLAS BACKUP TO LOCAL MONGODB   ');
  console.log('====================================================');
  console.log(`Mode:               ${isFullDrop ? 'FULL DROP & REBUILD (--full)' : 'SMART INCREMENTAL (Default)'}`);
  console.log(`Source Backup Dir:  ${BACKUP_DIR}`);
  console.log(`Local Mongo Target: ${LOCAL_MONGO_URI}`);
  if (filterCols) console.log(`Filter Collections: [${filterCols.join(', ')}]`);
  console.log('====================================================\n');

  if (!fs.existsSync(BACKUP_DIR)) {
    console.error(`Error: Backup directory not found at ${BACKUP_DIR}`);
    process.exit(1);
  }

  // Load manifest if available
  const manifestPath = path.join(BACKUP_DIR, 'manifest.json');
  let manifest = null;
  if (fs.existsSync(manifestPath)) {
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    } catch (e) {}
  }

  const client = new MongoClient(LOCAL_MONGO_URI);

  try {
    await client.connect();
    console.log('[+] Connected to local MongoDB instance successfully.\n');

    const dbFolders = fs.readdirSync(BACKUP_DIR, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name);

    let grandTotalDocs = 0;
    let collectionsSkipped = 0;
    let collectionsUpdated = 0;

    for (const dbName of dbFolders) {
      console.log(`====================================================`);
      console.log(`PROCESSING DATABASE: ${dbName}`);
      console.log(`====================================================`);

      const db = client.db(dbName);
      const dbPath = path.join(BACKUP_DIR, dbName);

      const files = fs.readdirSync(dbPath);
      let jsonlFiles = files.filter(f => f.endsWith('.jsonl') && !f.endsWith('.deltas.jsonl'));
      if (filterCols) {
        jsonlFiles = jsonlFiles.filter(f => filterCols.includes(f.replace('.jsonl', '')));
      }
      jsonlFiles.sort();

      const dbManifest = manifest?.databases?.find(d => d.name === dbName);

      for (const jsonlFile of jsonlFiles) {
        const colName = jsonlFile.replace('.jsonl', '');
        const result = await restoreCollection(db, colName, dbPath, dbManifest);
        grandTotalDocs += result.count;
        if (result.status.startsWith('SKIPPED')) {
          collectionsSkipped++;
        } else {
          collectionsUpdated++;
        }
      }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log('\n====================================================');
    console.log('            LOCAL RESTORE COMPLETE!                 ');
    console.log('====================================================');
    console.log(`Time Elapsed:        ${elapsed}s`);
    console.log(`Collections Updated: ${collectionsUpdated}`);
    console.log(`Collections Skipped: ${collectionsSkipped}`);
    console.log(`Documents Modified:  ${grandTotalDocs.toLocaleString()}`);
    console.log(`Databases:           ${dbFolders.join(', ')}`);
    console.log('====================================================\n');

  } catch (err) {
    console.error('[!] Error restoring to local MongoDB:', err);
    process.exit(1);
  } finally {
    await client.close();
  }
}

restore();
