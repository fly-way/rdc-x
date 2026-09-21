import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { base } from './common.mjs';
const tests = fs.readdirSync(path.join(base, 'test')).filter(n => n.endsWith('.test.ts')).map(n => 'test/' + n);
const jobs = [
  ['TypeScript build', ['node_modules/typescript/bin/tsc']],
  ['Automated tests', ['--import', 'tsx', '--test', '--test-reporter=tap', ...tests]],
  ['Running instance checks', ['scripts/doctor.mjs']]
];
let report = 'RDC-X verification\n' + new Date().toISOString() + '\nNode ' + process.version + '\n';
for (const [label, args] of jobs) {
  const result = spawnSync(process.execPath, args, { cwd: base, encoding: 'utf8', windowsHide: true, timeout: 60000, maxBuffer: 5 * 1024 * 1024 });
  const output = String(result.stdout ?? '') + String(result.stderr ?? '');
  report += '\n=== ' + label + ' ===\n' + output + '\nEXIT CODE: ' + result.status + '\n';
  if (label === 'Automated tests') fs.writeFileSync(path.join(base, 'TEST-REPORT.txt'), output, 'utf8');
  console.log(label + ': ' + (result.status === 0 ? 'PASS' : 'FAIL'));
  if (result.status !== 0) { process.exitCode = 1; console.error(output); break; }
}
fs.writeFileSync(path.join(base, 'VERIFICATION.txt'), report, 'utf8');
console.log('Saved TEST-REPORT.txt and VERIFICATION.txt.');
