import * as d from '../../declarations';
import { generateRollupOutput } from '../app-core/bundle-app-core';
import { generateLazyModules } from '../component-lazy/generate-lazy-module';
import { getAppBrowserCorePolyfills } from '../app-core/app-polyfills';
import { OutputOptions, RollupBuild } from 'rollup';
import { relativeImport } from '@utils';

export async function generateSystem(config: d.Config, compilerCtx: d.CompilerCtx, buildCtx: d.BuildCtx, rollupBuild: RollupBuild, outputTargets: d.OutputTargetDistLazy[]) {
  const systemOutputs = outputTargets.filter(o => !!o.systemDir);

  if (systemOutputs.length > 0) {
    const esmOpts: OutputOptions = {
      format: 'system',
      entryFileNames: config.hashFileNames ? 'p-[hash].system.js' : '[name].system.js',
      chunkFileNames: config.hashFileNames ? 'p-[hash].system.js' : '[name]-[hash].system.js',
      preferConst: true
    };
    const results = await generateRollupOutput(rollupBuild, esmOpts, config, buildCtx.entryModules) as d.RollupChunkResult[];
    if (results != null) {
      const destinations = systemOutputs.map(o => o.esmDir);
      await generateLazyModules(config, compilerCtx, buildCtx, destinations, results, 'es5', true, '.system');
      await generateSystemLoaders(config, compilerCtx, results, systemOutputs);
    }
  }
}

function generateSystemLoaders(config: d.Config, compilerCtx: d.CompilerCtx, rollupResult: d.RollupResult[], systemOutputs: d.OutputTargetDistLazy[]) {
  const loaderFilename = rollupResult.find(r => r.type === 'chunk' && r.isBrowserLoader).fileName;

  return Promise.all(
    systemOutputs.map((o) => writeSystemLoader(config, compilerCtx, loaderFilename, o))
  );
}

async function writeSystemLoader(config: d.Config, compilerCtx: d.CompilerCtx, loaderFilename: string, outputTarget: d.OutputTargetDistLazy) {
  if (outputTarget.systemLoaderFile) {
    const entryPointPath = config.sys.path.join(outputTarget.systemDir, loaderFilename);
    const relativePath = relativeImport(config, outputTarget.systemLoaderFile, entryPointPath);
    const loaderContent = await getSystemLoader(config, compilerCtx, relativePath, outputTarget.polyfills);
    await compilerCtx.fs.writeFile(outputTarget.systemLoaderFile, loaderContent);
  }
}

async function getSystemLoader(config: d.Config, compilerCtx: d.CompilerCtx, corePath: string, includePolyfills: boolean) {
  const polyfills = includePolyfills ? await getAppBrowserCorePolyfills(config, compilerCtx) : '/* polyfills excluded */';
  return `
'use strict';
(function () {
  var currentScript = document.currentScript;

  // !currentScript
  // IE11 since it doesnt support document.currentScript

  // !currentScript.hasAttribute('nomodule')
  // Bundled or doesn't have "nomodule" attribute

  // !('onbeforeload' in currentScript)
  // Not Safari

  // ('onbeforeload' in currentScript) && !history.scrollRestoration
  // Safari 10.x supports "module" but does not support async/await
  // so it should use the es5/system build while Safari >=11 should use esm build
  // 'onbeforeload' in currentScript only true for Safari
  // history.scrollRestoration support added in Safari 11

  if (!currentScript || !currentScript.hasAttribute('nomodule') || !('onbeforeload' in currentScript) || (('onbeforeload' in currentScript) && !history.scrollRestoration)) {

    ${polyfills}

    // Figure out currentScript (for IE11, since it does not support currentScript)
    var regex = /\\/${config.fsNamespace}(\\.esm)?\\.js($|\\?|#)/;
    var scriptElm = currentScript || Array.from(document.querySelectorAll('script')).find(function(s) {
      return regex.test(s.src) || s.getAttribute('data-stencil-namespace') === "${config.fsNamespace}";
    });

    var resourcesUrl = scriptElm ? scriptElm.getAttribute('data-resources-url') || scriptElm.src : '';
    var start = function() {
      var url = new URL('${corePath}', resourcesUrl);
      System.import(url.href);
    };

    if (window.__cssshim) {
      window.__cssshim.i().then(start);
    } else {
      start();
    }

    // Note: using .call(window) here because the self-executing function needs
    // to be scoped to the window object for the ES6Promise polyfill to work
  }
}).call(window);
`;
}
