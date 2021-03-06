import { Builder } from './lib';
import fs from 'fs';
import path from 'path';
import BabelTree from 'broccoli-babel-transpiler';
import Funnel from 'broccoli-funnel';
import MergeTree from 'broccoli-merge-trees';
import LintTree from './lib/cli/lint-tree';

export default class DenaliBuilder extends Builder {

  isDevelopingAddon = false;

  unbuiltDirs = [
    'bin',
    'blueprints',
    'commands'
  ];

  processSelf(tree, dir) {
    tree = this.lintTree(tree, dir);
    tree = this.transpileTree(tree, dir);
    return tree;
  }

  lintTree(tree, dir) {
    if (this.project.lint) {
      // If it's in test environment, generate test modules for each linted file
      if (this.project.environment === 'test') {
        let lintTestTree = new LintTree(tree, { generateTests: true, rootDir: dir });
        lintTestTree = new Funnel(lintTestTree, { destDir: 'test/lint' });
        return new MergeTree([ lintTestTree, tree ]);
      }
      // Otherwise, just lint and move on
      return new LintTree(tree, { rootDir: dir });
    }
    return tree;
  }

  transpileTree(tree, dir) {
    let babelrcPath = path.join(dir, '.babelrc');
    let options;
    if (fs.existsSync(babelrcPath)) {
      options = JSON.parse(fs.readFileSync(babelrcPath, 'utf-8'));
    } else {
      options = {
        presets: [ 'latest' ],
        plugins: [
          'transform-class-properties',
          'transform-async-to-generator'
        ],
        ignore: [
          'blueprints/*/files/**',
          'test/dummy/**'
        ]
      };
    }
    options.sourceMaps = 'inline';
    options.sourceRoot = dir;
    return new BabelTree(tree, options);
  }

}
