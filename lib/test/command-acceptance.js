import fs from 'fs';
import path from 'path';
import { exec, spawn } from 'child_process';
import tmp from 'tmp';
import walkSync from 'walk-sync';
import mkdirp from 'mkdirp';
import dedent from 'dedent-js';
import eachDir from '../utils/each-dir';
import createDebug from 'debug';

const debug = createDebug('denali:test:command-acceptance');

export default class CommandAcceptanceTest {

  constructor(command, options = {}) {
    this.command = command;
    this.dir = options.dir || tmp.dirSync({ unsafeCleanup: true }).name;
    this.environment = options.environment || 'development';
    this.projectRoot = path.dirname(process.cwd());
    this.denaliPath = path.join(this.projectRoot, 'node_modules', '.bin', 'denali');

    // This is a special case for when we are running Denali's own test suite.
    // In _every_ other scenario (app or addon running tests), Denali would be
    // a dependency, and therefore node_modules/.bin/denali should exist. But
    // when running Denali's own test suite, that won't exist, since Denali
    // isn't a dependency of itself. So we special case this to find the actual
    // executable instead.
    if (!fs.existsSync(this.denaliPath)) {
      this.denaliPath = path.join(this.projectRoot, 'dist-test', 'node_modules', 'denali', 'bin', 'denali');
    }

    if (options.populateWithDummy !== false) {
      debug(`populating tmp directory for "${ command }" command with dummy app`);
      if (fs.existsSync(path.join(this.dir, 'node_modules'))) {
        // If node_modules already exists, the user must have passed in a tmp
        // directory of their own that they previous messed with.
        throw new Error('You tried to run a CommandAcceptanceTest against a directory that already has an app in it. Did you forget to specify { populateWithDummy: false }?');
      }
      // Create a tmp copy of our dummy app to test our blueprint against
      let dummyDir = path.join(this.projectRoot, 'test', 'dummy');
      walkSync(dummyDir).forEach((dummyFile) => {
        if (dummyFile.charAt(dummyFile.length - 1) === '/') {
          mkdirp.sync(path.join(this.dir, dummyFile));
        } else {
          fs.writeFileSync(path.join(this.dir, dummyFile), fs.readFileSync(path.join(dummyDir, dummyFile)));
        }
      });
      // Symlink dependencies for dummy app to the addon's dependencies
      mkdirp.sync(path.join(this.dir, 'node_modules'));
      eachDir(path.join(this.projectRoot, 'node_modules'), (dep) => {
        fs.symlinkSync(path.join(this.projectRoot, 'node_modules', dep), path.join(this.dir, 'node_modules', dep));
      });
      // Symlink the addon under test as a dependency of this dummy app
      let projectName = require(path.join(this.projectRoot, 'package.json')).name;
      fs.unlinkSync(path.join(this.dir, 'node_modules', projectName));
      fs.symlinkSync(path.join(this.projectRoot, 'dist-test', 'node_modules', projectName), path.join(this.dir, 'node_modules', projectName));
      debug('tmp directory populated');
    }
  }

  run(options = {}) {
    return new Promise((resolve, reject) => {
      exec(`${ this.denaliPath } ${ this.command }`, {
        env: Object.assign({}, process.env, {
          DENALI_ENV: this.environment,
          NODE_ENV: this.environment
        }, options.env || {}),
        cwd: this.dir
      }, (err, stdout, stderr) => {
        if (err || (options.failOnStderr && stderr.length > 0)) {
          err = err || new Error();
          err.message += dedent`
            ====> stdout:
            ${ stdout }
            ====> stderr:
            ${ stderr }
          `;
          return reject(err);
        }
        resolve({ stdout, stderr, dir: this.dir });
      });
    });
  }

  spawn(options = {}) {
    return new Promise((resolve, reject) => {

      this.spawnedCommand = spawn(this.denaliPath, this.command.split(' '), {
        env: Object.assign({}, process.env, {
          DENALI_ENV: this.environment,
          NODE_ENV: this.environment
        }, options.env || {}),
        cwd: this.dir,
        stdio: 'pipe'
      });

      // Cleanup spawned processes if our process is killed
      let cleanup = this.cleanup.bind(this);
      process.on('exit', cleanup.bind(this));

      // Buffer up the output so the polling timer can check it
      let stdoutBuffer = '';
      let stderrBuffer = '';
      this.spawnedCommand.stdout.on('data', (d) => {
        stdoutBuffer += d.toString();
      });
      this.spawnedCommand.stderr.on('data', (d) => {
        stderrBuffer += d.toString();
      });

      // Handle errors from the child process
      this.spawnedCommand.stdout.on('error', reject);
      this.spawnedCommand.stderr.on('error', reject);
      this.spawnedCommand.on('error', reject);

      // Poll periodically to check the results
      this.pollOutput = setInterval(() => {
        if (stderrBuffer.length > 0 && options.failOnStderr) {
          process.removeListener('exit', cleanup);
          this.cleanup();
          let error = new Error('Command printed to stderr, and failOnStderr enabled:\n');
          error.message += dedent`
            ====> stdout:
            ${ stdoutBuffer }
            ====> stderr:
            ${ stderrBuffer }
          `;
          reject(error);
        }
        let passed = options.checkOutput(stdoutBuffer, stderrBuffer, this.dir);
        if (passed) {
          process.removeListener('exit', cleanup);
          this.cleanup();
          resolve();
        }
      }, options.pollInterval || 50);

      // Ensure the test fails if we don't pass the test after a while
      let timeout = options.timeout || (process.env.CI ? 10 * 60 * 1000 : 3 * 60 * 1000);
      this.fallbackTimeout = setTimeout(() => {
        process.removeListener('exit', cleanup);
        this.cleanup();
        let message = `Timeout of ${ (timeout / 1000) / 60 } minutes exceeded for spawned command: ${ this.command }\n`;
        message += dedent`
          ====> stdout:
          ${ stdoutBuffer }
          ====> stderr:
          ${ stderrBuffer }
        `;
        reject(new Error(message));
      }, timeout);

    });
  }

  cleanup() {
    this.spawnedCommand.kill();
    clearInterval(this.pollOutput);
    clearTimeout(this.fallbackTimeout);
  }

}
