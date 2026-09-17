#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { deflateRawSync, deflateSync, inflateRawSync, inflateSync } from 'node:zlib';
import sharp from 'sharp';

const MAGIC = Buffer.from([0xc0, 0xde, 0xae]);
const DEFAULT_OUT = path.resolve('tmp/llm-token-fixture');
const DEFAULT_RECORDS = 2200;

function usage() {
  return `Usage:
  yarn bench:llm-token:fixture
  yarn bench:llm-token:fixture --records 5000 --out ./tmp/my-fixture

Options:
  --records <number>   Number of synthetic event records. Default: ${DEFAULT_RECORDS}
  --out <dir>          Output directory. Default: ${DEFAULT_OUT}
  --help               Show this help.
`;
}

function parseArgs(argv) {
  const args = {
    records: DEFAULT_RECORDS,
    out: DEFAULT_OUT,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const value = argv[++i];
      if (!value) throw new Error(`Missing value for ${arg}`);
      return value;
    };

    if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg === '--records') args.records = Number(next());
    else if (arg === '--out') args.out = path.resolve(next());
    else throw new Error(`Unknown argument: ${arg}`);
  }

  if (!Number.isInteger(args.records) || args.records < 100) {
    throw new Error('--records must be an integer >= 100');
  }

  return args;
}

function seededValue(seed) {
  let value = seed >>> 0;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  return value >>> 0;
}

function pick(items, index) {
  return items[index % items.length];
}

function buildDataset(recordCount) {
  const regions = ['NA', 'EMEA', 'APAC', 'LATAM'];
  const products = ['Tracer', 'Runtime Context', 'Docs', 'Telemetry Bridge', 'Token Pack'];
  const tiers = ['free', 'team', 'business', 'enterprise'];
  const channels = ['direct', 'partner', 'marketplace', 'community'];
  const records = [];

  const target = {
    region: 'APAC',
    product: 'Token Pack',
    tier: 'enterprise',
  };

  let targetRevenue = 0;
  let targetRefunds = 0;
  let targetUsers = 0;

  for (let i = 0; i < recordCount; i += 1) {
    const hash = seededValue(i + 42);
    const region = pick(regions, hash);
    const product = pick(products, hash >>> 3);
    const tier = pick(tiers, hash >>> 6);
    const channel = pick(channels, hash >>> 9);
    const monthlyActiveUsers = 20 + (hash % 900);
    const conversionRate = Number(((hash % 1900) / 10000 + 0.03).toFixed(4));
    const refundRate = Number((((hash >>> 11) % 450) / 10000).toFixed(4));
    const revenue = Number((monthlyActiveUsers * conversionRate * (tier === 'enterprise' ? 620 : tier === 'business' ? 180 : tier === 'team' ? 48 : 9)).toFixed(2));
    const refunds = Number((revenue * refundRate).toFixed(2));

    if (region === target.region && product === target.product && tier === target.tier) {
      targetRevenue += revenue;
      targetRefunds += refunds;
      targetUsers += monthlyActiveUsers;
    }

    records.push({
      id: `evt_${String(i + 1).padStart(5, '0')}`,
      month: `2026-${String((i % 12) + 1).padStart(2, '0')}`,
      accountId: `acct_${String((hash % 530) + 1).padStart(4, '0')}`,
      region,
      product,
      tier,
      channel,
      monthlyActiveUsers,
      conversionRate,
      refundRate,
      revenue,
      refunds,
      netRevenue: Number((revenue - refunds).toFixed(2)),
      featureFlags: {
        streaming: Boolean(hash & 1),
        imageToken: Boolean(hash & 2),
        auditExport: Boolean(hash & 4),
      },
      notes: `Synthetic benchmark row ${i + 1}. Use only for LLM token transport comparison.`,
    });
  }

  const expected = {
    filter: target,
    matchingRecords: records.filter((record) => (
      record.region === target.region
      && record.product === target.product
      && record.tier === target.tier
    )).length,
    totalRevenue: Number(targetRevenue.toFixed(2)),
    totalRefunds: Number(targetRefunds.toFixed(2)),
    netRevenue: Number((targetRevenue - targetRefunds).toFixed(2)),
    totalMonthlyActiveUsers: targetUsers,
  };

  return {
    dataset: {
      schemaVersion: 1,
      generatedAt: '2026-05-15T00:00:00.000Z',
      description: 'Large synthetic SaaS event dataset for raw JSON vs image-token LLM benchmarking.',
      records,
      expectedAnswers: {
        apacEnterpriseTokenPackNetRevenue: expected,
      },
    },
    expected,
  };
}

function makeArchive(jsonBuffer) {
  const compressedFile = deflateRawSync(jsonBuffer, { level: 9 });
  const manifest = {
    version: 1,
    files: [
      {
        path: 'big-dataset.json',
        compressor: 'deflate-9',
        level: 9,
        compressedSize: compressedFile.byteLength,
        originalSize: jsonBuffer.byteLength,
        offset: 0,
      },
    ],
  };

  const header = Buffer.concat([
    MAGIC,
    Buffer.from('Twitter\n', 'utf8'),
    Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'),
    Buffer.from('\n', 'utf8'),
  ]);

  const outerPayload = Buffer.concat([header, compressedFile]);
  return deflateSync(outerPayload, { level: 9 });
}

function makeRgbStream(deflatedOuter) {
  const prefix = Buffer.alloc(30);
  prefix.write('linear-deflate-c3-token-v1', 0, 'ascii');
  const stream = Buffer.concat([prefix, deflatedOuter]);
  const paddedLength = Math.ceil(stream.byteLength / 3) * 3;
  return Buffer.concat([stream, Buffer.alloc(paddedLength - stream.byteLength)]);
}

async function writeTokenPng(rgbStream, outPath) {
  const pixelCount = rgbStream.byteLength / 3;
  const width = Math.ceil(Math.sqrt(pixelCount));
  const height = Math.ceil(pixelCount / width);
  const fullRgb = Buffer.alloc(width * height * 3);
  rgbStream.copy(fullRgb);

  await sharp(fullRgb, {
    raw: {
      width,
      height,
      channels: 3,
    },
  }).png().toFile(outPath);

  return { width, height, pixelCount };
}

async function verifyToken(tokenPath, expectedJsonBuffer, outerLength) {
  const { data, info } = await sharp(tokenPath)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const stream = Buffer.from(data);
  const outer = inflateSync(stream.subarray(30, 30 + outerLength));
  const manifestStart = outer.indexOf(Buffer.from('{', 'utf8'));
  const manifestEnd = outer.indexOf(Buffer.from('\n}\n', 'utf8'), manifestStart) + 2;
  const manifest = JSON.parse(outer.subarray(manifestStart, manifestEnd).toString('utf8'));
  const blobStart = manifestEnd + 1;
  const file = manifest.files[0];
  const compressedFile = outer.subarray(blobStart + file.offset, blobStart + file.offset + file.compressedSize);
  const decoded = inflateRawSync(compressedFile);

  return {
    ok: decoded.equals(expectedJsonBuffer),
    image: { width: info.width, height: info.height, channels: info.channels },
    manifest,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage());
    return;
  }

  await mkdir(args.out, { recursive: true });

  const { dataset, expected } = buildDataset(args.records);
  const jsonText = `${JSON.stringify(dataset, null, 2)}\n`;
  const jsonBuffer = Buffer.from(jsonText, 'utf8');

  const jsonPath = path.join(args.out, 'big-dataset.json');
  const tokenPath = path.join(args.out, 'big-dataset-token.png');
  const questionPath = path.join(args.out, 'question.txt');
  const expectedPath = path.join(args.out, 'expected-answer.json');
  const readmePath = path.join(args.out, 'README.md');

  const outer = makeArchive(jsonBuffer);
  const rgbStream = makeRgbStream(outer);
  const imageInfo = await writeTokenPng(rgbStream, tokenPath);

  const question = [
    'In the provided dataset, filter records where region is APAC, product is Token Pack, and tier is enterprise.',
    'Return the matching record count, total revenue, total refunds, net revenue, and total monthly active users.',
    'Group the answer under the key apacEnterpriseTokenPackNetRevenue.',
  ].join(' ');

  await writeFile(jsonPath, jsonText);
  await writeFile(questionPath, `${question}\n`);
  await writeFile(expectedPath, `${JSON.stringify(expected, null, 2)}\n`);

  const verification = await verifyToken(tokenPath, jsonBuffer, outer.byteLength);
  if (!verification.ok) {
    throw new Error('Generated token verification failed');
  }

  await writeFile(readmePath, [
    '# LLM Token Benchmark Fixture',
    '',
    `Records: ${args.records}`,
    `JSON bytes: ${jsonBuffer.byteLength}`,
    `Token PNG bytes: ${(await readFile(tokenPath)).byteLength}`,
    `Token image: ${imageInfo.width}x${imageInfo.height}`,
    '',
    'Run:',
    '',
    '```bash',
    `yarn bench:llm-token --json ${jsonPath} --token ${tokenPath} --question-file ${questionPath}`,
    '```',
    '',
  ].join('\n'));

  console.log(`Wrote ${jsonPath}`);
  console.log(`Wrote ${tokenPath}`);
  console.log(`Wrote ${questionPath}`);
  console.log(`Wrote ${expectedPath}`);
  console.log(`JSON bytes: ${jsonBuffer.byteLength}`);
  console.log(`Token PNG bytes: ${(await readFile(tokenPath)).byteLength}`);
  console.log(`Token image: ${imageInfo.width}x${imageInfo.height}`);
  console.log(`Expected answer: ${JSON.stringify(expected)}`);
  console.log(`Verification: ${verification.ok ? 'ok' : 'failed'}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  console.error('');
  console.error(usage());
  process.exitCode = 1;
});
