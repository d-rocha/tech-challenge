// Keep isolation, artifact locations, worker count and coverage failure policy immutable.
export function safeArguments(input) {
  const result = [];
  const valued = new Set(['--project', '--grep', '--grep-invert', '--max-failures', '-g']);
  for (let index = 0; index < input.length; index++) {
    const argument = input[index];
    if (argument === '--list' || argument === '-x') { result.push(argument); continue; }
    const equals = argument.indexOf('=');
    const flag = equals < 0 ? argument : argument.slice(0, equals);
    if (!valued.has(flag)) throw new Error(`Unsupported E2E argument: ${flag}`);
    const value = equals < 0 ? input[++index] : argument.slice(equals + 1);
    if (!value || value.startsWith('--')) throw new Error(`Missing value: ${flag}`);
    if (flag === '--project' && !['desktop', 'mobile'].includes(value)) throw new Error('Unknown E2E project');
    if (flag === '--max-failures' && !/^[1-9][0-9]*$/.test(value)) throw new Error('Invalid max-failures');
    result.push(flag === '-g' ? '--grep' : flag, value);
  }
  return result;
}
