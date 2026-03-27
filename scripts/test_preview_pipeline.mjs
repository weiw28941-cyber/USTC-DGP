import { spawn } from 'node:child_process';

function runNodeScript(scriptPath) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', ['--experimental-default-type=module', scriptPath], {
      cwd: process.cwd(),
      stdio: 'inherit'
    });
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${scriptPath} exited with code ${code}`));
      }
    });
    child.on('error', reject);
  });
}

async function main() {
  await runNodeScript('scripts/webui_execution_selftest.mjs');
  await runNodeScript('scripts/server_output_page_selftest.mjs');
  console.log('test_preview_pipeline passed');
}

main().catch((error) => {
  console.error('test_preview_pipeline failed:', error);
  process.exitCode = 1;
});
