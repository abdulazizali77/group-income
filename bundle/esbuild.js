const { copyFile } = require('fs/promises')
const path = require('path')
const { resolve } = path

async function build (grunt) {
  // FIXME: all filename references SHOULD be options
  // const backendIndex = '../backend/index.js'
  // './backend/index.js'
  const backendIndexFile = grunt.option('backendEntryPointFile')

  const distRootDir = grunt.option('distRootDir')
  const distAssetsDir = grunt.option('distAssetsDir')//'dist/assets'

  const srcServiceWorkerDir = grunt.option('srcServiceWorkerDir')//'frontend/controller/serviceworkers'
  const srcRootDir = grunt.option('srcRootDir')//'frontend'

  const srcAssetsDir = grunt.option('srcAssetsDir')
  // '../frontend/assets/style'
  const srcAssetsStyleDir = grunt.option('srcAssetsStyleDir')
  const srcComponentsDir = grunt.option('srcComponentsDir')
  const srcContainersDir = grunt.option('srcContainersDir')
  const srcControllersDir = grunt.option('srcControllersDir')
  const srcModelsDir = grunt.option('srcModelsDir')
  const srcPagesDir = grunt.option('srcPagesDir')
  const srcSvgDir = grunt.option('srcSvgDir')
  const srcUtilsDir = grunt.option('srcUtilsDir')
  const srcViewUtilsDir = grunt.option('srcViewUtilsDir')
  const srcViewsDir = grunt.option('srcViewsDir')
  const srcVueJSFile = grunt.option('srcVueJSFile')


  // grunt.option('srcRootDir') + '/main.js'
  const srcMainEntryPointFiles = grunt.option('srcMainEntryPointFiles')
  // './frontend/controller/serviceworkers/primary.js'
  const srcServiceWorkerEntryPointFiles = grunt.option('srcServiceWorkerEntryPointFiles')

  // FIXME: all filename references SHOULD be options

  const distAssetsCSSDir = grunt.option('distAssetsCSSDir')
  const distAssetsJSDir = grunt.option('distAssetsJSDir')

  // './node_modules/vue-slider-component'
  const vueSliderComponent = grunt.option('vueSliderComponent')
  const development = grunt.option('ENV_NODE_ENV') === 'development'
  const production = !development

  const aliasPluginOptions = {
    entries: {
      '@assets': srcAssetsDir,
      '@components': srcComponentsDir,
      '@containers': srcContainersDir,
      '@controller': srcControllersDir,
      '@model': srcModelsDir,
      '@pages': srcPagesDir,
      '@svgs': srcSvgDir,
      '@utils': srcUtilsDir,
      '@view-utils': srcViewUtilsDir,
      '@views': srcViewsDir,
      'vue': srcVueJSFile,
      '~': '.'
    }
  }

  // https://esbuild.github.io/api/
  const esbuildOptionBags = {
    // Native options that are shared between our esbuild tasks.
    default: {
      bundle: true,
      chunkNames: '[name]-[hash]-cached',
      // pass in these params
      define: {
        'process.env.BUILD': "'web'",
        'process.env.CI': grunt.option('ENV_CI'),
        'process.env.GI_VERSION': grunt.option('ENV_GI_VERSION'),
        'process.env.LIGHTWEIGHT_CLIENT': grunt.option('ENV_LIGHTWEIGHT_CLIENT'),
        'process.env.NODE_ENV': grunt.option('ENV_NODE_ENV'),
        'process.env.EXPOSE_SBP': grunt.option('ENV_EXPOSE_SBP')
      },

      external: ['crypto', '*.eot', '*.ttf', '*.woff', '*.woff2'],
      format: 'esm',
      incremental: true,
      loader: {
        '.eot': 'file',
        '.ttf': 'file',
        '.woff': 'file',
        '.woff2': 'file'
      },
      minifyIdentifiers: production,
      minifySyntax: production,
      minifyWhitespace: production,
      outdir: distAssetsJSDir,
      sourcemap: true,
      // Warning: split mode has still a few issues. See https://github.com/okTurtles/group-income/pull/1196
      splitting: !grunt.option('no-chunks'),
      watch: false // Not using esbuild's own watch mode since it involves polling.
    },
    // Native options used when building the main entry point.
    main: {
      assetNames: '../css/[name]',
      entryPoints: [...srcMainEntryPointFiles]
    },
    // Native options used when building our service worker(s).
    serviceWorkers: {
      entryPoints: [...srcServiceWorkerEntryPointFiles]
    }
  }

  // Additional options which are not part of the esbuild API.
  const esbuildOtherOptionBags = {
    main: {
      // Our `index.html` file is designed to load its CSS from `dist/assets/css`;
      // however, esbuild outputs `main.css` and `main.css.map` along `main.js`,
      // making a post-build copying operation necessary.

      postoperation: async ({ fileEventName, filePath } = {}) => {
        console.log('esbuildOtherOptionBags postoperation')
        // Only after a fresh build or a rebuild caused by a CSS file event.
        if (!fileEventName || ['.css', '.sass', '.scss'].includes(path.extname(filePath))) {
          await copyFile(`${distAssetsJSDir}/main.css`, `${distAssetsCSSDir}/main.css`).then((res) => {
            console.log('esbuildOtherOptionBags postoperation ' + res)
          })
          if (development) {
            console.log('esbuildOtherOptionBags postoperation')
            await copyFile(`${distAssetsJSDir}/main.css.map`, `${distAssetsCSSDir}/main.css.map`).then((res) => {
              console.log('esbuildOtherOptionBags postoperation ' + development + ' ' + res)
            })
          }
        }
      }
    }
  }

  // By default, `flow-remove-types` doesn't process files which don't start with a `@flow` annotation,
  // so we have to pass the `all` option since we don't use `@flow` annotations.
  const flowRemoveTypesPluginOptions = {
    all: true,
    cache: new Map()
  }

  // https://github.com/sass/dart-sass#javascript-api

  const sassPluginOptions = {
    cache: false, // Enabling it causes an error: "Cannot read property 'resolveDir' of undefined".
    sourceMap: development, // This option has currently no effect.
    outputStyle: development ? 'expanded' : 'compressed',
    loadPaths: [
      resolve('../node_modules'), // So we can write `@import 'vue-slider-component/lib/theme/default.scss';` in .vue <style>.
      resolve(srcAssetsStyleDir) // So we can write `@import '_variables.scss';` in .vue <style> section.
    ],
    // This option has currently no effect, so I had to add at-import path aliasing in the Vue plugin.
    importer (url, previous, done) {
      // So we can write `@import '@assets/style/_variables.scss'` in the <style> section of .vue components too.
      return url.startsWith('@assets/')
        ? { file: resolve(srcAssetsDir, url.slice('@assets/'.length)) }
        : null
    }
  }

  const svgInlineVuePluginOptions = {
    // This map's keys will be relative SVG file paths without leading dot,
    // while its values will be corresponding compiled JS strings.
    cache: new Map(),
    debug: false
  }

  const vuePluginOptions = {
    aliases: {
      ...aliasPluginOptions.entries,
      // So we can write @import 'vue-slider-component/lib/theme/default.scss'; in .vue <style>.
      'vue-slider-component': vueSliderComponent
    },
    // This map's keys will be relative Vue file paths without leading dot,
    // while its values will be corresponding compiled JS strings.
    cache: new Map(),
    debug: false,
    flowtype: flowRemoveTypesPluginOptions
  }

  const aliasPlugin = require('../scripts/esbuild-plugins/alias-plugin.js')(aliasPluginOptions)
  const flowRemoveTypesPlugin = require('../scripts/esbuild-plugins/flow-remove-types-plugin.js')(flowRemoveTypesPluginOptions)
  const sassPlugin = require('esbuild-sass-plugin').sassPlugin(sassPluginOptions)
  const svgPlugin = require('../scripts/esbuild-plugins/vue-inline-svg-plugin.js')(svgInlineVuePluginOptions)
  const vuePlugin = require('../scripts/esbuild-plugins/vue-plugin.js')(vuePluginOptions)
  const { createEsbuildTask } = require('../scripts/esbuild-commands.js')

  const buildMain = createEsbuildTask({
    ...esbuildOptionBags.default,
    ...esbuildOptionBags.main,
    plugins: [aliasPlugin, flowRemoveTypesPlugin, sassPlugin, svgPlugin, vuePlugin]
  }, esbuildOtherOptionBags.main)

  const buildServiceWorkers = createEsbuildTask({
    ...esbuildOptionBags.default,
    ...esbuildOptionBags.serviceWorkers,
    plugins: [aliasPlugin, flowRemoveTypesPlugin]
  })

  return await Promise.all([buildMain.run(), buildServiceWorkers.run()])
    .then(res => {
      console.log('build finished ' + res)
    })
    .catch(error => {
      console.log(error.message)
      process.exit(1)
    })
}

// export {build, rebuild}
Object.assign(module.exports, {
  build
})
