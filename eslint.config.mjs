// Flat config built on the plugins' NATIVE flat configs. We deliberately avoid
// eslint-config-next's legacy shareable config (next/core-web-vitals via
// FlatCompat): it loads @rushstack/eslint-patch, which fails to patch ESLint 9.x
// ("calling module was not recognized"). @next/eslint-plugin-next ships its own
// flat config that needs no patch.
import next from "@next/eslint-plugin-next";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

const eslintConfig = [
  { ignores: [".next/**", "node_modules/**", "out/**", "next-env.d.ts"] },
  ...tseslint.configs.recommended,
  next.flatConfig.coreWebVitals,
  // Register react-hooks manually (object-form plugins) so we don't depend on the
  // plugin's bundled config shape, which has changed across major versions.
  {
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
];

export default eslintConfig;
