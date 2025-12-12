import tsParser from "@typescript-eslint/parser";

const eslintConfig = [
  {
    ignores: ["dist/**", "node_modules/**"],
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: import.meta.dirname,
        ecmaVersion: 2022,
        sourceType: "module",
      },
    },
  },
];

export default eslintConfig;
