import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { generateRecording, sampleIdentity } from './dashboard-samples/generate.mjs';
import { scenarios } from './dashboard-samples/scenarios.mjs';
import { launchDashboard, repositoryRoot } from './dashboard.mjs';

const { values, positionals } = parseArgs({allowPositionals:true,options:{samples:{type:'string',default:'1000000'},recordings:{type:'string'},port:{type:'string'},'generate-only':{type:'boolean'},help:{type:'boolean'}}});
if (values.help) {
  console.log(`yarn dashboard:sample [all|editor|maps|game|video] [--samples 1000000] [--generate-only] [--port 4178] [--recordings directory]\nDefaults: all four scenarios, 1M observations each, repo .recordings, then launch. Existing samples are reused.`);
} else {
  if (positionals.length > 1) throw new Error('Choose one domain or all');
  const selected = positionals[0] ?? 'all';
  const domains = selected === 'all' ? Object.keys(scenarios) : [selected];
  const samples = Number(values.samples);
  for (const domain of domains) sampleIdentity(domain,samples);
  if (values.port !== undefined && (!Number.isInteger(Number(values.port)) || Number(values.port) < 0 || Number(values.port) > 65535)) throw new Error('Invalid port');
  const directory = resolve(repositoryRoot, values.recordings ?? '.recordings');
  console.log(`Synthetic recordings: ${directory}\n${domains.length} scenario(s), ${samples.toLocaleString()} observations each. No production data.`);
  for (const domain of domains) {
    const result = await generateRecording(directory, domain, samples, count=>console.log(`  ${domain}: ${count.toLocaleString()} / ${samples.toLocaleString()}`));
    console.log(`${result.reused ? 'Reused' : 'Created'} ${result.title}: ${result.eventCount.toLocaleString()} events, ${result.browserSampleCount} browser, ${result.cpuSampleCount} CPU, ${result.extensionSampleCount} custom samples (${(result.sampleGenerator.bytes/1024/1024).toFixed(1)} MiB).`);
  }
  if (!values['generate-only']) await launchDashboard(['--recordings', directory, ...(values.port === undefined ? [] : ['--port', values.port])]);
}
