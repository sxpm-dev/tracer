#!/usr/bin/env node

import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { anthropic } from '@ai-sdk/anthropic';
import { openai } from '@ai-sdk/openai';
import { generateText } from 'ai';

const DEFAULT_DECODE_INSTRUCTIONS = `The attached PNG is a compact data token.

Decode it before answering:
- Ignore image file headers, EXIF/metadata, PNG chunks, and container bytes.
- Load the image as decoded raster pixels.
- Read pixels left-to-right, top-to-bottom.
- For each pixel, append exactly the RGB channel bytes in R,G,B order.
- Ignore alpha if present.
- The resulting RGB byte stream contains zlib-wrapped DEFLATE data at byte offset 30.
- Decompress from byte offset 30.
- The decompressed outer payload starts with magic bytes plus a JSON manifest.
- After the manifest, extract each file blob by manifest offset/compressedSize.
- Each file blob is DEFLATE-compressed. Try raw DEFLATE first, then zlib-wrapped DEFLATE.
- Do not print full extracted files unless the question explicitly asks for them.
- Use the extracted file contents as the data source for the user's question.`;

const RESPONSE_CONTRACT = `Return only a JSON object with this shape:
{
  "answer": <direct answer to the user's question>,
  "extractedValues": <object or array of the concrete values you found>,
  "evidence": [<short quotes, paths, or JSON locations that support the answer>],
  "confidence": "low" | "medium" | "high",
  "notes": [<important caveats, empty if none>]
}`;

function usage() {
  return `Usage:
  yarn bench:llm-token --json ./big.json --token ./token.png --question "Extract X and group by Y"
  yarn bench:llm-token --json ./big.json --token ./token.png --question-file ./question.txt --providers openai,anthropic

Required env:
  OPENAI_API_KEY       for --providers openai
  ANTHROPIC_API_KEY    for --providers anthropic

Optional env:
  OPENAI_MODEL         default: gpt-5.4-mini
  ANTHROPIC_MODEL      default: claude-sonnet-4-5-20250929

Options:
  --json <path>              Raw JSON file for the baseline text request.
  --token <path>             PNG token image for the compressed-image request.
  --question <text>          Question to ask both requests.
  --question-file <path>     Read the question from a file.
  --providers <list>         openai,anthropic by default.
  --out <dir>                Output directory. Default: ./tmp/llm-token-benchmark
  --max-output <number>      Max output tokens per call. Default: 2000
  --temperature <number>     Default: 0
  --decode-instructions <path>
                             Override the image-token decode instructions.
  --dry-run                  Validate inputs and print planned calls without API requests.
  --help                     Show this help.
`;
}

function parseArgs(argv) {
  const args = {
    providers: ['openai', 'anthropic'],
    out: path.resolve('tmp/llm-token-benchmark'),
    maxOutput: 2000,
    temperature: 0,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const value = argv[++i];
      if (!value) throw new Error(`Missing value for ${arg}`);
      return value;
    };

    if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg === '--json') args.jsonPath = path.resolve(next());
    else if (arg === '--token') args.tokenPath = path.resolve(next());
    else if (arg === '--question') args.question = next();
    else if (arg === '--question-file') args.questionFile = path.resolve(next());
    else if (arg === '--providers') args.providers = next().split(',').map((v) => v.trim()).filter(Boolean);
    else if (arg === '--out') args.out = path.resolve(next());
    else if (arg === '--max-output') args.maxOutput = Number(next());
    else if (arg === '--temperature') args.temperature = Number(next());
    else if (arg === '--decode-instructions') args.decodeInstructionsPath = path.resolve(next());
    else if (arg === '--dry-run') args.dryRun = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
}

function requireFile(filePath, label) {
  if (!filePath) throw new Error(`Missing ${label}`);
  if (!existsSync(filePath)) throw new Error(`${label} does not exist: ${filePath}`);
}

function makeProvider(name) {
  if (name === 'openai') {
    if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is required for provider openai');
    const modelId = process.env.OPENAI_MODEL ?? 'gpt-5.4-mini';
    return { provider: name, modelId, model: openai(modelId) };
  }

  if (name === 'anthropic') {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is required for provider anthropic');
    const modelId = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-5-20250929';
    return { provider: name, modelId, model: anthropic(modelId) };
  }

  throw new Error(`Unsupported provider: ${name}`);
}

function rawJsonPrompt(jsonText, question) {
  return `You are analyzing the JSON document below.

Question:
${question}

${RESPONSE_CONTRACT}

JSON document:
${jsonText}`;
}

function tokenPrompt(decodeInstructions, question) {
  return `${decodeInstructions}

Question:
${question}

${RESPONSE_CONTRACT}`;
}

async function runCall({ providerConfig, mode, messages, maxOutput, temperature }) {
  const startedAt = performance.now();
  try {
    const result = await generateText({
      model: providerConfig.model,
      messages,
      maxOutputTokens: maxOutput,
      temperature,
    });

    return {
      provider: providerConfig.provider,
      model: providerConfig.modelId,
      mode,
      ok: true,
      elapsedMs: Math.round(performance.now() - startedAt),
      finishReason: result.finishReason,
      usage: result.totalUsage ?? result.usage,
      text: result.text,
      warnings: result.warnings ?? [],
    };
  } catch (error) {
    return {
      provider: providerConfig.provider,
      model: providerConfig.modelId,
      mode,
      ok: false,
      elapsedMs: Math.round(performance.now() - startedAt),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function extractJson(text) {
  if (!text) return { ok: false, reason: 'empty response' };

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : text.trim();

  try {
    return { ok: true, value: JSON.parse(candidate) };
  } catch {
    const first = candidate.indexOf('{');
    const last = candidate.lastIndexOf('}');
    if (first >= 0 && last > first) {
      try {
        return { ok: true, value: JSON.parse(candidate.slice(first, last + 1)) };
      } catch {
        // Fall through to the text comparison path.
      }
    }
  }

  return { ok: false, reason: 'response was not parseable JSON' };
}

function normalizeForCompare(value) {
  if (Array.isArray(value)) return value.map(normalizeForCompare);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, normalizeForCompare(value[key])]),
    );
  }
  if (typeof value === 'string') return value.trim().replace(/\s+/g, ' ');
  return value;
}

function compareOutputs(raw, token) {
  if (!raw?.ok || !token?.ok) {
    return { ok: false, reason: 'one or both calls failed' };
  }

  const rawJson = extractJson(raw.text);
  const tokenJson = extractJson(token.text);

  if (rawJson.ok && tokenJson.ok) {
    const rawComparable = normalizeForCompare(rawJson.value.extractedValues ?? rawJson.value.answer ?? rawJson.value);
    const tokenComparable = normalizeForCompare(tokenJson.value.extractedValues ?? tokenJson.value.answer ?? tokenJson.value);
    return {
      ok: JSON.stringify(rawComparable) === JSON.stringify(tokenComparable),
      kind: 'json',
      rawParseable: true,
      tokenParseable: true,
      rawComparable,
      tokenComparable,
    };
  }

  const rawText = normalizeForCompare(raw.text ?? '');
  const tokenText = normalizeForCompare(token.text ?? '');
  return {
    ok: rawText === tokenText,
    kind: 'text',
    rawParseable: rawJson.ok,
    tokenParseable: tokenJson.ok,
    rawParseReason: rawJson.reason,
    tokenParseReason: tokenJson.reason,
  };
}

function summarizeUsage(result) {
  if (!result?.usage) return 'usage=n/a';
  const usage = result.usage;
  return [
    `input=${usage.inputTokens ?? 'n/a'}`,
    `output=${usage.outputTokens ?? 'n/a'}`,
    `reasoning=${usage.outputTokenDetails?.reasoningTokens ?? usage.reasoningTokens ?? 'n/a'}`,
    `total=${usage.totalTokens ?? 'n/a'}`,
  ].join(' ');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage());
    return;
  }

  requireFile(args.jsonPath, '--json file');
  requireFile(args.tokenPath, '--token file');
  if (!args.question && !args.questionFile) throw new Error('Missing --question or --question-file');

  const question = args.question ?? (await readFile(args.questionFile, 'utf8')).trim();
  const decodeInstructions = args.decodeInstructionsPath
    ? await readFile(args.decodeInstructionsPath, 'utf8')
    : DEFAULT_DECODE_INSTRUCTIONS;
  const jsonText = await readFile(args.jsonPath, 'utf8');
  const tokenImage = await readFile(args.tokenPath);

  JSON.parse(jsonText);

  await mkdir(args.out, { recursive: true });

  const providerNames = args.providers;
  const providers = args.dryRun
    ? providerNames.map((provider) => ({
      provider,
      modelId: provider === 'openai'
        ? (process.env.OPENAI_MODEL ?? 'gpt-5.4-mini')
        : (process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-5-20250929'),
    }))
    : providerNames.map(makeProvider);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const runDir = path.join(args.out, timestamp);
  await mkdir(runDir, { recursive: true });

  const metadata = {
    startedAt: new Date().toISOString(),
    jsonPath: args.jsonPath,
    tokenPath: args.tokenPath,
    jsonBytes: Buffer.byteLength(jsonText),
    tokenBytes: tokenImage.byteLength,
    question,
    providers: providers.map(({ provider, modelId }) => ({ provider, model: modelId })),
    maxOutput: args.maxOutput,
    temperature: args.temperature,
  };

  await writeFile(path.join(runDir, 'metadata.json'), JSON.stringify(metadata, null, 2));

  if (args.dryRun) {
    console.log('Dry run: no API requests were sent.');
    console.log(`JSON bytes: ${metadata.jsonBytes}`);
    console.log(`Token image bytes: ${metadata.tokenBytes}`);
    console.log(`Question chars: ${question.length}`);
    console.log(`Decode instruction chars: ${decodeInstructions.length}`);
    console.log(`Planned calls: ${providers.length * 2}`);
    console.log(`Wrote ${path.join(runDir, 'metadata.json')}`);
    return;
  }

  const results = [];
  for (const providerConfig of providers) {
    const rawMessages = [
      {
        role: 'user',
        content: rawJsonPrompt(jsonText, question),
      },
    ];
    const tokenMessages = [
      {
        role: 'user',
        content: [
          { type: 'text', text: tokenPrompt(decodeInstructions, question) },
          { type: 'image', image: tokenImage, mediaType: 'image/png' },
        ],
      },
    ];

    console.log(`Running ${providerConfig.provider}/${providerConfig.modelId} raw-json...`);
    const raw = await runCall({
      providerConfig,
      mode: 'raw-json',
      messages: rawMessages,
      maxOutput: args.maxOutput,
      temperature: args.temperature,
    });
    results.push(raw);
    console.log(`  ${raw.ok ? 'ok' : 'failed'} ${raw.elapsedMs}ms ${summarizeUsage(raw)}`);

    console.log(`Running ${providerConfig.provider}/${providerConfig.modelId} token-image...`);
    const token = await runCall({
      providerConfig,
      mode: 'token-image',
      messages: tokenMessages,
      maxOutput: args.maxOutput,
      temperature: args.temperature,
    });
    results.push(token);
    console.log(`  ${token.ok ? 'ok' : 'failed'} ${token.elapsedMs}ms ${summarizeUsage(token)}`);
  }

  const validations = {};
  for (const providerConfig of providers) {
    const raw = results.find((result) => result.provider === providerConfig.provider && result.mode === 'raw-json');
    const token = results.find((result) => result.provider === providerConfig.provider && result.mode === 'token-image');
    validations[providerConfig.provider] = compareOutputs(raw, token);
  }

  const report = {
    metadata,
    results,
    validations,
    completedAt: new Date().toISOString(),
  };

  await writeFile(path.join(runDir, 'report.json'), JSON.stringify(report, null, 2));
  await writeFile(
    path.join(runDir, 'summary.md'),
    [
      '# LLM Token Benchmark',
      '',
      `JSON bytes: ${metadata.jsonBytes}`,
      `Token PNG bytes: ${metadata.tokenBytes}`,
      '',
      '## Calls',
      '',
      ...results.map((result) => [
        `### ${result.provider} / ${result.model} / ${result.mode}`,
        '',
        `Status: ${result.ok ? 'ok' : 'failed'}`,
        `Elapsed: ${result.elapsedMs}ms`,
        `Usage: ${summarizeUsage(result)}`,
        result.error ? `Error: ${result.error}` : '',
        '',
        '```text',
        result.text ?? '',
        '```',
        '',
      ].join('\n')),
      '## Validation',
      '',
      '```json',
      JSON.stringify(validations, null, 2),
      '```',
      '',
    ].join('\n'),
  );

  console.log('');
  console.log(`Wrote ${path.join(runDir, 'report.json')}`);
  console.log(`Wrote ${path.join(runDir, 'summary.md')}`);
  console.log('Validation:');
  console.log(JSON.stringify(validations, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  console.error('');
  console.error(usage());
  process.exitCode = 1;
});
