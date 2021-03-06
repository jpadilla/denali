import fs from 'fs';
import path from 'path';
import upperFirst from 'lodash/upperFirst';
import Funnel from 'broccoli-funnel';
import MergeTree from 'broccoli-merge-trees';
import PackageTree from './package-tree';
import discoverAddons from '../utils/discover-addons';
import createDebug from 'debug';

const debug = createDebug('denali:builder');


export default class Builder {

  static buildersCache = {};

  static createFor(dir, project, preseededAddons) {
    if (!this.buildersCache[dir]) {
      // Use the local denali-build.js if present
      let denaliBuildPath = path.join(dir, 'denali-build');
      if (fs.existsSync(`${ denaliBuildPath }.js`)) {
        let LocalBuilder = require(denaliBuildPath);
        LocalBuilder = LocalBuilder.default || LocalBuilder;
        this.buildersCache[dir] = new LocalBuilder(dir, project, preseededAddons);
      } else {
        this.buildersCache[dir] = new this(dir, project, preseededAddons);
      }
    }
    return this.buildersCache[dir];
  }

  ignoreVulnerabilities = [
    [ 'broccoli@0.16.9' ]
  ];

  packageFiles = [
    'package.json',
    'README.md',
    'CHANGELOG.md',
    'LICENSE',
    'denali-build.js'
  ];

  unbuiltDirs = [
    'blueprints',
    'commands'
  ];

  constructor(dir, project, preseededAddons) {
    this.dir = dir;
    this.displayDir = `./${ path.relative(project.dir, dir) }`;
    debug(`creating builder for ${ this.displayDir }`);
    this.pkg = require(path.join(this.dir, 'package.json'));
    this.project = project;
    this.isAddon = this.pkg.keywords && this.pkg.keywords.includes('denali-addon');
    this.addons = discoverAddons(this.dir, { preseededAddons, root: this.project.dir });
  }

  sourceDirs() {
    let dirs = [ 'app', 'config', 'lib' ];
    if (this.project.environment === 'test') {
      dirs.push('test');
    }
    return dirs;
  }

  treeFor(dir) {
    return dir;
  }

  _prepareSelf() {
    // Get the various source dirs we'll use. This is important because broccoli
    // cannot pick files at the root of the project directory.
    let dirs = this.sourceDirs();

    // Give any subclasses a chance to override the source directories by defining
    // a treeFor* method
    let sourceTrees = dirs.map((dir) => {
      let treeFor = this[`treeFor${ upperFirst(dir) }`] || this.treeFor;
      let tree = treeFor.call(this, path.join(this.dir, dir));
      if (typeof tree !== 'string' || fs.existsSync(tree)) {
        return new Funnel(tree, { annotation: dir, destDir: dir });
      }
      return false;
    }).filter(Boolean);

    // Copy top level files into our build output (this special tree is
    // necessary because broccoli can't pick a file from the root dir).
    sourceTrees.push(new PackageTree(this, { files: this.packageFiles }));

    // Combine everything into our unified source tree, ready for building
    return new MergeTree(sourceTrees, { overwrite: true });
  }

  toTree() {
    let tree = this._prepareSelf();

    // Find child addons
    this.childBuilders = this.addons.map((addonDir) => Builder.createFor(addonDir, this.project));

    // Run processParent hooks
    this.childBuilders.forEach((builder) => {
      if (builder.processParent) {
        tree = builder.processParent(tree, this.dir);
      }
    });

    // Run processSelf hooks
    if (this.processSelf) {
      tree = this.processSelf(tree, this.dir);
    }

    let unbuiltTrees = [];
    this.unbuiltDirs.forEach((dir) => {
      if (fs.existsSync(path.join(this.dir, dir))) {
        unbuiltTrees.push(new Funnel(path.join(this.dir, dir), { destDir: dir }));
      }
    });
    if (unbuiltTrees.length > 0) {
      tree = new MergeTree(unbuiltTrees.concat(tree), { overwrite: true });
    }

    return tree;
  }

}
