import { main } from './run';

main(process.argv.slice(2)).then((code) => {
  process.exitCode = code;
});
