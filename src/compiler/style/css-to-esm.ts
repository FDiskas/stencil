import * as d from '../../declarations';
import { DEFAULT_STYLE_MODE, catchError, createVarName, normalizePath } from '@utils';
import { createStencilImportPath } from '../transformers/stencil-import-path';
import { getScopeId } from '../style/scope-css';
import { scopeCss } from '../../utils/shadow-css';
import { stripComments } from './style-utils';
import MagicString from 'magic-string';
import path from 'path';


export const transformCssToEsm = async (input: d.TransformCssToEsmInput) => {
  const results: d.TransformCssToEsmOutput = {
    code: input.code,
    map: null,
    diagnostics: []
  };

  try {
    const s = new MagicString('');
    const defaultVarName = createCssVarName(input.filePath, input.modeName);
    const varNames = new Set([defaultVarName]);

    if (input.encapsulation === 'scoped') {
      const scopeId = getScopeId(input.tagName, input.modeName);
      results.code = scopeCss(results.code, scopeId, input.commentOriginalSelector);
    }

    const cssImports = getCssImports(varNames, results.code, input.filePath, input.modeName);
    cssImports.forEach(cssImport => {
      // remove the original css @imports
      results.code = results.code.replace(cssImport.srcImportText, '');

      const importPath = createStencilImportPath(input.tagName, input.encapsulation, input.modeName, cssImport.filePath, input.filePath);
      s.append(`import ${cssImport.varName} from '${importPath}';\n`);
    });

    s.append(`const ${defaultVarName} = `);

    cssImports.forEach(cssImport => {
      s.append(`${cssImport.varName} + `);
    });

    s.append(`${JSON.stringify(results.code)};\n`);

    s.append(`export default ${defaultVarName};`);

    results.code = s.toString();

  } catch (e) {
    catchError(results.diagnostics, e);
  }

  return results;
};


const getCssImports = (varNames: Set<string>, cssText: string, filePath: string, modeName: string) => {
  const cssImports: d.CssToEsmImportData[] = [];

  if (!cssText.includes('@import')) {
    // no @import at all, so don't bother
    return cssImports;
  }

  cssText = stripComments(cssText);

  const dir = path.dirname(filePath);

  let r: RegExpExecArray;
  while (r = CSS_IMPORT_RE.exec(cssText)) {
    const cssImportData: d.CssToEsmImportData = {
      srcImportText: r[0],
      url: r[4].replace(/[\"\'\)]/g, ''),
      filePath: null,
      varName: null
    };

    if (!isLocalCssImport(cssImportData.srcImportText)) {
      // do nothing for @import url(http://external.css)
      continue;

    } else if (isCssNodeModule(cssImportData.url)) {
      // do not resolve this path cuz it starts with node resolve id ~
      continue;

    } else if (path.isAbsolute(cssImportData.url)) {
      // absolute path already
      cssImportData.filePath = normalizePath(cssImportData.url);

    } else {
      // relative path
      cssImportData.filePath = normalizePath(path.resolve(dir, cssImportData.url));
    }

    cssImportData.varName = createCssVarName(filePath, modeName);

    if (varNames.has(cssImportData.varName)) {
      cssImportData.varName += (varNames.size);
    }
    varNames.add(cssImportData.varName);

    cssImports.push(cssImportData);
  }

  return cssImports;
};

const CSS_IMPORT_RE = /(@import)\s+(url\()?\s?(.*?)\s?\)?([^;]*);?/gi;

const isCssNodeModule = (url: string) => {
  return url.startsWith('~');
};

const isLocalCssImport = (srcImport: string) => {
  srcImport = srcImport.toLowerCase();

  if (srcImport.includes('url(')) {
    srcImport = srcImport.replace(/\"/g, '');
    srcImport = srcImport.replace(/\'/g, '');
    srcImport = srcImport.replace(/\s/g, '');
    if (srcImport.includes('url(http') || srcImport.includes('url(//')) {
      return false;
    }
  }

  return true;
};

const createCssVarName = (filePath: string, modeName: string) => {
  let varName = path.basename(filePath);
  if (modeName && modeName !== DEFAULT_STYLE_MODE && !varName.includes(modeName)) {
    varName = modeName + '-' + varName;
  }
  return createVarName(varName);
};
