// Import check WITHOUT shell -e; Windows PowerShell quoting can strip JS string quotes.
// This file only verifies the npm export; it never opens Chrome, tabs or sessions.
import { connectViaExtension } from 'playwriter';
if (typeof connectViaExtension !== 'function') {
  console.error('Playwriter 0.12.0: connectViaExtension indisponivel.');
  process.exit(3);
}
console.log('OK: API do Playwriter carregada. Chrome ainda nao foi manipulado.');
