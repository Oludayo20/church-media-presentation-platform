/**
 * Architectural rules from docs/ARCHITECTURE.md §11, enforced in CI.
 * Run: pnpm depcruise
 * @type {import('dependency-cruiser').IConfiguration}
 */
module.exports = {
  forbidden: [
    {
      name: "engine-no-react",
      comment:
        "The presentation engine must stay React-free so the audience output cannot be stalled by UI re-renders (ARCHITECTURE.md §2.3).",
      severity: "error",
      from: { path: "^packages/presentation-engine" },
      to: { path: "node_modules/(react|react-dom)/" },
    },
    {
      name: "packages-not-import-apps",
      comment: "Shared packages must never depend on an application.",
      severity: "error",
      from: { path: "^packages/" },
      to: { path: "^apps/" },
    },
    {
      name: "renderer-no-node-builtins",
      comment:
        "Renderers are sandboxed: no Node built-ins. Talk to main via window.cmp (DOCUMENTATION.md §2.2).",
      severity: "error",
      from: { path: "^apps/desktop/src/" },
      to: { dependencyTypes: ["core"] },
    },
    {
      name: "renderer-no-electron-or-main-code",
      comment:
        "Renderers must not import electron or main/preload process code.",
      severity: "error",
      from: { path: "^apps/desktop/src/" },
      to: { path: "(node_modules/electron/|^apps/desktop/electron/)" },
    },
    {
      name: "browser-packages-no-node",
      comment:
        "Packages that run inside renderers must not use Node built-ins.",
      severity: "error",
      from: {
        path: "^packages/(presentation-engine|design-system|shared-types|shared-validation)/",
      },
      to: { dependencyTypes: ["core"] },
    },
    {
      name: "database-main-process-only",
      comment:
        "Only the Electron main process may touch the database (DOCUMENTATION.md §2).",
      severity: "error",
      from: {
        path: "^(apps/desktop/src|apps/desktop/electron/preload|packages/presentation-engine|packages/design-system)/",
      },
      to: { path: "^packages/database/" },
    },
    {
      name: "shared-types-is-a-leaf",
      comment: "shared-types depends on nothing.",
      severity: "error",
      from: { path: "^packages/shared-types/" },
      to: { path: "^(packages|apps)/", pathNot: "^packages/shared-types/" },
    },
    {
      name: "not-to-unresolvable",
      comment:
        "Every import must resolve — this also catches packages a workspace package uses without declaring them in its own package.json.",
      severity: "error",
      from: {},
      to: { couldNotResolve: true },
    },
    {
      name: "no-circular",
      severity: "error",
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: { path: "(^|/)(out|dist|release)/" },
    tsPreCompilationDeps: true,
    combinedDependencies: true,
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default", "types"],
      extensions: [".ts", ".tsx", ".js", ".mjs", ".cjs", ".json"],
    },
  },
};
