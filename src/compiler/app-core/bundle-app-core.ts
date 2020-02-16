import * as d from '../../declarations';
import { componentEntryPlugin } from '../rollup-plugins/component-entry';
import { createOnWarnFn, getDependencies, loadRollupDiagnostics } from '@utils';
import { cssTransformer } from '../rollup-plugins/css-transformer';
import { globalScriptsPlugin } from '../rollup-plugins/global-scripts';
import { loaderPlugin } from '../rollup-plugins/loader';
import { imagePlugin } from '../rollup-plugins/image-plugin';
import { inMemoryFsRead } from '../rollup-plugins/in-memory-fs-read';
import { OutputChunk, OutputOptions, RollupBuild, RollupOptions, TreeshakingOptions } from 'rollup'; // types only
import { pluginHelper } from '../rollup-plugins/plugin-helper';
import { stencilBuildConditionalsPlugin } from '../rollup-plugins/stencil-build-conditionals';
import { stencilClientPlugin } from '../rollup-plugins/stencil-client';
import { stencilExternalRuntimePlugin } from '../rollup-plugins/stencil-external-runtime';
import { HYDRATED_CSS } from '../../runtime/runtime-constants';


export const bundleApp = async (config: d.Config, compilerCtx: d.CompilerCtx, buildCtx: d.BuildCtx, build: d.Build, bundleAppOptions: d.BundleAppOptions) => {
  const external = bundleAppOptions.skipDeps
    ? getDependencies(buildCtx)
    : [];

  try {
    const treeshake: TreeshakingOptions | boolean = !config.devMode && config.rollupConfig.inputOptions.treeshake !== false
      ? {
        unknownGlobalSideEffects: false,
        propertyReadSideEffects: false,
        tryCatchDeoptimization: false,
      }
      : false;
    const rollupOptions: RollupOptions = {
      ...config.rollupConfig.inputOptions,

      input: bundleAppOptions.inputs,
      plugins: [
        stencilExternalRuntimePlugin(bundleAppOptions.externalRuntime),
        loaderPlugin({
          '@stencil/core': DEFAULT_CORE,
          '@core-entrypoint': DEFAULT_ENTRY,
          ...bundleAppOptions.loader
        }),
        stencilClientPlugin(config),
        stencilBuildConditionalsPlugin(build, config.fsNamespace),
        globalScriptsPlugin(config, compilerCtx),
        componentEntryPlugin(config, compilerCtx, buildCtx, build, buildCtx.entryModules),
        config.sys.rollup.plugins.commonjs({
          include: /node_modules/,
          sourceMap: false,
          ...config.commonjs
        }),
        ...config.rollupPlugins,
        pluginHelper(config, buildCtx),
        config.sys.rollup.plugins.nodeResolve({
          mainFields: ['collection:main', 'jsnext:main', 'es2017', 'es2015', 'module', 'main'],
          browser: true,
          ...config.nodeResolve
        }),
        config.sys.rollup.plugins.json(),
        imagePlugin(config, buildCtx),
        cssTransformer(config, compilerCtx, buildCtx),
        inMemoryFsRead(config, compilerCtx),
        config.sys.rollup.plugins.replace({
          'process.env.NODE_ENV': config.devMode ? '"development"' : '"production"'
        }),
      ],
      treeshake,
      cache: bundleAppOptions.cache,
      onwarn: createOnWarnFn(buildCtx.diagnostics),
      external
    };

    const rollupBuild: RollupBuild = await config.sys.rollup.rollup(rollupOptions);
    return rollupBuild;

  } catch (e) {
    if (!buildCtx.hasError) {
      loadRollupDiagnostics(compilerCtx, buildCtx, e);
    }
  }

  return undefined;
};

export const generateRollupOutput = async (build: RollupBuild, options: OutputOptions, config: d.Config, entryModules: d.EntryModule[]): Promise<d.RollupResult[]> => {
  if (build == null) {
    return null;
  }

  const { output } = await build.generate(options);
  return output
    .filter(chunk => !('isAsset' in chunk))
    .map((chunk: OutputChunk) => {
      let code = chunk.code;
      const isCore = Object.keys(chunk.modules).includes('@stencil/core');
      const hydratedFlag = config.hydratedFlag;
      if (hydratedFlag) {
        const hydratedFlagHead = getHydratedFlagHead(hydratedFlag);
        if (HYDRATED_CSS !== hydratedFlagHead) {
          code = code.replace(HYDRATED_CSS, hydratedFlagHead);
          if (hydratedFlag.name !== 'hydrated') {
            code = code.replace(`.classList.add("hydrated")`, `.classList.add("${hydratedFlag.name}")`);
            code = code.replace(`.classList.add('hydrated')`, `.classList.add('${hydratedFlag.name}')`);
            code = code.replace(`.setAttribute("hydrated",`, `.setAttribute("${hydratedFlag.name}",`);
            code = code.replace(`.setAttribute('hydrated',`, `.setAttribute('${hydratedFlag.name}',`);
          }
        }
      }

      return {
        fileName: chunk.fileName,
        code: code,
        moduleFormat: options.format,
        entryKey: chunk.name,
        imports: chunk.imports,
        isEntry: !!chunk.isEntry,
        isComponent: !!chunk.isEntry && entryModules.some(m => m.entryKey === chunk.name),
        isBrowserLoader: chunk.isEntry && chunk.name === config.fsNamespace,
        isIndex: chunk.isEntry && chunk.name === 'index',
        isCore,
      };
    });
};

export const DEFAULT_CORE = `
export * from '@stencil/core/platform';
import globals from '@stencil/core/global-scripts';
export { globals };
`;

export const DEFAULT_ENTRY = `
export * from '@stencil/core';
`;

export const getHydratedFlagHead = (h: d.HydratedFlag) => {
  // {visibility:hidden}.hydrated{visibility:inherit}

  let initial: string;
  let hydrated: string;

  if (!String(h.initialValue) || h.initialValue === '' || h.initialValue == null) {
    initial = '';
  } else {
    initial = `{${h.property}:${h.initialValue}}`;
  }

  const selector = h.selector === 'attribute' ?
    `[${h.name}]` :
    `.${h.name}`;

  if (!String(h.hydratedValue) || h.hydratedValue === '' || h.hydratedValue == null) {
    hydrated = '';
  } else {
    hydrated = `${selector}{${h.property}:${h.hydratedValue}}`;
  }

  return initial + hydrated;
};
