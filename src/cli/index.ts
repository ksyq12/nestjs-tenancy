const args = process.argv.slice(2);
const command = args[0];
const flags = new Set(args.slice(1));

if (command === 'init') {
  const dryRun = flags.has('--dry-run');

  require('./init')
    .runInit({ dryRun })
    .catch((err: Error) => {
      console.error(err.message);
      process.exit(1);
    });
} else if (command === 'check') {
  const { runCheck } = require('./check');
  const dbSettingKeyArg = args.find((a: string) => a.startsWith('--db-setting-key='));
  const dbSettingKey = dbSettingKeyArg ? dbSettingKeyArg.split('=')[1] : undefined;
  const result = runCheck({ dbSettingKey });
  process.exit(result.inSync ? 0 : 1);
} else {
  console.log('Usage: npx @nestarc/tenancy <command> [options]');
  console.log('');
  console.log('Commands:');
  console.log('  init [--dry-run]                    Scaffold RLS policies and module configuration');
  console.log('  check [--db-setting-key=<key>]      Check if tenancy-setup.sql is in sync with Prisma schema');
  process.exit(0);
}
