const args = process.argv.slice(2);
const command = args[0];

if (command === 'init') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('./init')
    .runInit()
    .catch((err: Error) => {
      console.error(err.message);
      process.exit(1);
    });
} else {
  console.log('Usage: npx @nestarc/tenancy <command>');
  console.log('');
  console.log('Commands:');
  console.log('  init    Scaffold RLS policies and module configuration');
  process.exit(0);
}
