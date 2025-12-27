const path = require('path');

const rootDir = path.resolve(__dirname, '..', '..');
const highsScriptPath = path
  .resolve(rootDir, 'assets', 'vendor', 'highs', 'highs.js')
  .replace(/\\/g, '/');

global.window = global;
global.document = {
  getElementsByTagName: (tag) => (tag === 'script' ? [{ src: highsScriptPath }] : [])
};

global.window.highs = require(highsScriptPath);
global.window.LPModel = require(path.resolve(rootDir, 'assets', 'vendor', 'lp-model', 'lp-model.min.js'));
require(path.resolve(rootDir, 'scripts', 'fertilizer-data.js'));
require(path.resolve(rootDir, 'scripts', 'fertilizer-core.js'));

const { runTests } = require(path.resolve(rootDir, 'scripts', 'tests', 'stock-solution-maker.test.js'));

if (typeof runTests !== 'function') {
  console.error('Test runner not found. Ensure stock-solution-maker.test.js exports runTests.');
  process.exitCode = 1;
} else {
  runTests()
    .then(({ failed }) => {
      if (failed > 0) {
        process.exitCode = 1;
      }
    })
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    });
}
