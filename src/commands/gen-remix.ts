import fs from 'fs'
import path from 'path'

type PackageExports = {
  version: string
  values: string[]
  types: string[]
  overrides: string[]
}

function usage() {
  console.log(`
  Usage:
    $ gen-remix [options]

  Options:
    --config PATH       Config path (default: ./gen-remix.config.json)
    --packages PACKAGES List of packages to export
    --output PATH       Output path (default: ./app/remix.ts)
  `)
}

export default async function () {
  let configPath = `gen-remix.config.json`
  let outputPath = './app/remix.ts'
  let packages: string[] = []
  let capture = null
  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i]
    if (arg.startsWith('--')) {
      capture = null
      switch (arg) {
        case '--config':
          configPath = process.argv[i++]
          break
        case '--output':
          outputPath = process.argv[i++]
          break
        case '--packages':
          capture = packages
          break
        default:
          usage()
          break
      }
    } else if (capture) {
      capture.push(arg)
    }
  }
  let config
  if (!fs.existsSync(configPath)) {
    if (!packages.length) {
      usage()
      return
    }
    config = { exports: packages, overrides: {} }
  } else {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
  }
  const hasOverrides = config.overrides && Object.keys(config.overrides).length
  console.log('🚀 Generating remix.ts exports...')

  // read package exports
  const exports: Record<string, PackageExports> = {}
  for (const packageName of config.exports) {
    console.log(`📦 ${packageName}`)
    const packageJson = JSON.parse(
      fs.readFileSync(`node_modules/${packageName}/package.json`, 'utf8'),
    )
    exports[packageName] = {
      version: packageJson.version,
      values: [],
      types: [],
      overrides: [],
    }
    let typings = packageJson.typings
    if (!typings) {
      typings = path.dirname(packageJson.main) + '/index.d.ts'
    }
    const content = fs.readFileSync(
      path.join(`node_modules/${packageName}`, typings),
      'utf8',
    )
    const lines = content
      .replace(/\n/g, ' ')
      .replace(/(export\s+(type\s*)?{)/g, '\n$1')
      .split('\n')
      .filter(line => line.trim().length > 0)
    for (let line of lines) {
      const match = line.match(/^export(\s+type)?\s*{(.*)}/)
      if (match) {
        const list = match[1] ? 'types' : 'values'
        const exportList = match[2]
          .split(',')
          .map(s => s.trim())
          .filter(Boolean)
        for (let exportName of exportList) {
          const alias = exportName.match(/^(\w+)\s+as\s+(\w+)$/)
          if (alias) {
            exportName = alias[2]
          }
          exports[packageName][list].push(exportName)
        }
      }
    }
  }
  // write remix.ts
  let output = `// This file was generated by gen-remix.ts at ${new Date().toISOString()}\n`
  for (const packageName of Object.keys(exports)) {
    output += `\n// ${packageName}@${exports[packageName].version}`
  }
  // overrides: {
  //   "<source-package>": [
  //     "<original-package>": {
  //       "<original-export>": "<new-source-export>",
  //       ...
  //     },
  //     "<original-package>": {
  //       "<original-export>": "<new-source-export>",
  //       ...
  //     }
  //   ],
  //   ...
  // }"

  let exportOverrides: [string, string][] = []
  if (hasOverrides) {
    output += `\n\n// import overrides`
    for (const sourcePackage of Object.keys(config.overrides)) {
      const sourceOverrides = config.overrides[sourcePackage]
      let imports: string[] = []
      // import source values
      for (const originalPackage of Object.keys(sourceOverrides)) {
        imports = [
          ...imports,
          ...(Object.values(sourceOverrides[originalPackage]) as string[]),
        ]
      }
      output += `\nimport {\n${imports
        .map(i => `  ${i},`)
        .join('\n')}\n} from "${sourcePackage}";`
    }
    for (const sourcePackage of Object.keys(config.overrides)) {
      const sourceOverrides = config.overrides[sourcePackage]
      exports[sourcePackage].overrides = Object.values(sourceOverrides)
        .flatMap((overrides: any) =>
          Object.entries(overrides).filter(
            ([target, source]: any) => target === source,
          ),
        )
        .map(([target, source]: any) => source)

      // import source values
      for (const originalPackage of Object.keys(sourceOverrides)) {
        exports[originalPackage].overrides = Object.keys(
          sourceOverrides[originalPackage],
        )
        exportOverrides = [
          ...exportOverrides,
          ...(Object.entries(sourceOverrides[originalPackage]) as [
            string,
            string,
          ][]),
        ]
      }
    }
  }

  let allExports: string[] = []
  output += `\n\n// export packages`
  for (const packageName of Object.keys(exports)) {
    const currValues = exports[packageName].values.filter(
      // eslint-disable-next-line no-loop-func
      e =>
        !exports[packageName].overrides.includes(e) && !allExports.includes(e),
    )
    allExports = [...allExports, ...currValues]
    output += `\nexport {\n${currValues
      .map(e => `  ${e},`)
      .join('\n')}\n} from "${packageName}";`

    if (exports[packageName].types.length) {
      const currTypes = exports[packageName].types.filter(
        // eslint-disable-next-line no-loop-func
        e =>
          !exports[packageName].overrides.includes(e) &&
          !allExports.includes(e),
      )
      allExports = [...allExports, ...currTypes]
      output += `\nexport type {\n${currTypes
        .map(e => `  ${e},`)
        .join('\n')}\n} from "${packageName}";`
    }
  }
  if (hasOverrides) {
    output += `\n\n// export overrides`
    output += `\nexport {\n${exportOverrides
      .map(
        ([source, target]) =>
          `  ${source === target ? target : `${target} as ${source}`},`,
      )
      .join('\n')}\n};`
  }
  console.log(`📝 Writing ${outputPath}...`)
  fs.writeFileSync(outputPath, output, 'utf8')
  console.log('🏁 Done!')
}
